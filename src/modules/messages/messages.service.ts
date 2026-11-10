import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { safeFailure } from '../../common/utils/safe-log';

import { MessageRoom } from './message-room.entity';
import { Message, MessageCategory } from './message.entity';
import { MessagesMediaService } from './messages-media.service';
import { MessagesPresenceService } from './messages-presence.service';
import { MessagesGateway } from './messages.gateway';
import { SendImageMessageDto } from './dto/send-image-message.dto';
import { GeneralMessageDto } from './dto/general-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { User } from '../users/user.entity';
import { INSERT_READ_RECEIPTS_SQL, UNREAD_COUNTS_SQL } from './message-read-state';

export type MessageDirection = 'incoming' | 'outgoing' | 'general';

// Compatibility projection: existing HTTP/socket clients concatenate these name
// fields. Keep their shape while returning a label, never account name fields.
const MESSAGE_MEMBER_LABEL = 'Community member';

export interface MessageViewModel {
  id: string;
  roomId: string;
  direction: MessageDirection;
  category: MessageCategory;
  imageUrl: string | null;
  caption: string | null;
  text: string | null;
  createdAt: Date;
  sender: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  } | null;
}

export interface ActiveRoomViewModel {
  id: string;
  unreadCount: number;
  participants: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    online: boolean;
  }>;
  lastMessage: MessageViewModel | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListMessagesResult {
  messages: MessageViewModel[];
  nextCursor: string | null;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  constructor(
    @InjectRepository(MessageRoom) private readonly rooms: Repository<MessageRoom>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly media: MessagesMediaService,
    private readonly presence: MessagesPresenceService,
    @Optional()
    @Inject(forwardRef(() => MessagesGateway))
    private readonly gateway?: MessagesGateway,
  ) {}

  async ensureRoom(currentUserId: string, otherUserId: string): Promise<ActiveRoomViewModel> {
    if (currentUserId === otherUserId) {
      throw new BadRequestException('Cannot open a room with yourself');
    }

    const users = await this.users.findBy([{ id: currentUserId }, { id: otherUserId }]);
    const current = users.find((user) => user.id === currentUserId);
    const other = users.find((user) => user.id === otherUserId);

    if (!current || !other) {
      throw new NotFoundException('One or more users could not be found');
    }

    const pairKey = MessageRoom.buildPairKey(currentUserId, otherUserId);

    let room = await this.rooms.findOne({ where: { pairKey } });
    if (!room) {
      const [userOne, userTwo] = currentUserId < otherUserId ? [current, other] : [other, current];
      room = this.rooms.create({
        userOne,
        userTwo,
        pairKey,
        deleted: false,
      });
      room = await this.rooms.save(room);
    } else if (room.deleted) {
      room.deleted = false;
      room = await this.rooms.save(room);
    }

    const counts = await this.unreadCounts(currentUserId, [room.id]);
    return this.mapRoom(room, currentUserId, counts.get(room.id) ?? 0);
  }

  async listActiveRooms(userId: string): Promise<ActiveRoomViewModel[]> {
    const rooms = await this.rooms.find({
      where: [
        { userOne: { id: userId }, deleted: false },
        { userTwo: { id: userId }, deleted: false },
      ],
      order: { updatedAt: 'DESC' },
    });

    const counts = await this.unreadCounts(userId, rooms.map(room => room.id));
    const results: ActiveRoomViewModel[] = [];
    for (const room of rooms) {
      results.push(await this.mapRoom(room, userId, counts.get(room.id) ?? 0));
    }
    return results;
  }

  private async unreadCounts(userId: string, roomIds: string[]): Promise<Map<string, number>> {
    if (!roomIds.length) return new Map();
    const rows: Array<{ roomId: string; count: number }> = await this.messages.query(UNREAD_COUNTS_SQL, [userId, roomIds]);
    return new Map(rows.map(row => [row.roomId, Number(row.count)]));
  }

  async acknowledgeRead(roomId: string, userId: string, requestedIds: string[]): Promise<{ readMessageIds: string[]; unreadCount: number }> {
    const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!Array.isArray(requestedIds) || requestedIds.length < 1 || requestedIds.length > 100 ||
      requestedIds.some(id => typeof id !== 'string' || !validUuid.test(id))) throw new BadRequestException('Invalid viewed message IDs');
    const messageIds = [...new Set(requestedIds.map(id => id.toLowerCase()))];
    const result = await this.messages.manager.transaction(async manager => {
      await this.lockReadableRoom(manager, roomId, userId);
      const rows: Array<{ id: string; incoming: boolean }> = await manager.query(`SELECT id,
        (category='direct' AND "senderId" IS NOT NULL AND "senderId"<>$1::uuid) AS incoming
        FROM public.message WHERE "roomId"=$2::uuid AND id=ANY($3::uuid[])`, [userId, roomId, messageIds]);
      if (rows.length !== messageIds.length) throw new BadRequestException('Viewed messages must belong to this room');
      await manager.query(INSERT_READ_RECEIPTS_SQL, [userId, roomId, messageIds]);
      const counts: Array<{ roomId: string; count: number }> = await manager.query(UNREAD_COUNTS_SQL, [userId, [roomId]]);
      return { readMessageIds: rows.filter(row => row.incoming).map(row => row.id), unreadCount: Number(counts[0]?.count ?? 0) };
    });
    if (this.gateway) void this.gateway.emitReadState(userId, roomId, result.unreadCount)
      .catch(error => this.logger.warn(safeFailure('message_read_delivery', error)));
    return result;
  }

  async presenceRecipientIds(userId: string): Promise<string[]> {
    // Presence is private to existing conversation participants. Select only
    // the two account IDs; eager account profiles are unnecessary here.
    const rooms = await this.rooms.createQueryBuilder('room')
      .select('room.userOne', 'userOneId')
      .addSelect('room.userTwo', 'userTwoId')
      .where('room.deleted = :deleted', { deleted: false })
      .andWhere('(room.userOne = :userId OR room.userTwo = :userId)', { userId })
      .getRawMany<{ userOneId: string; userTwoId: string }>();
    const recipients = new Set([userId]);
    for (const room of rooms) {
      if (room.userOneId === userId) recipients.add(room.userTwoId);
      if (room.userTwoId === userId) recipients.add(room.userOneId);
    }
    return [...recipients];
  }

  async sendImageMessage(
    roomId: string,
    senderId: string,
    file: Express.Multer.File | undefined,
    dto: SendImageMessageDto,
  ): Promise<MessageViewModel> {
    const room = await this.getRoomOrFail(roomId, senderId);
    if (!file) {
      throw new BadRequestException('An image file is required');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are permitted');
    }

    const url = await this.media.uploadImage(file.buffer, file.originalname);
    let message = this.messages.create({
      room,
      sender: { id: senderId } as User,
      category: MessageCategory.DIRECT,
      imageUrl: url,
      caption: dto.caption ?? null,
    });
    message = await this.messages.save(message);
    message = await this.messages.findOneOrFail({
      where: { id: message.id },
      relations: ['room', 'room.userOne', 'room.userTwo', 'sender'],
    });

    const senderView = this.mapMessageForUser(message, senderId);
    await this.broadcastRealtimeMessage(message);
    await this.touchRoom(room.id);
    return senderView;
  }

  async createGeneralMessage(
    roomId: string,
    authorId: string,
    dto: GeneralMessageDto,
  ): Promise<MessageViewModel> {
    // General messages share the room lock with text/read/clear/delete. A
    // pre-upload or pre-transaction membership check is not a write barrier.
    const message = await this.messages.manager.transaction(async manager => {
      const room = await this.lockReadableRoom(manager, roomId, authorId);
      const messages = manager.getRepository(Message);
      const saved = await messages.save(messages.create({
        room, sender: { id: authorId } as User, category: MessageCategory.GENERAL,
        text: dto.text, caption: dto.title ?? null,
      }));
      const persisted = await messages.findOneOrFail({
        where: { id: saved.id }, loadEagerRelations: false,
        loadRelationIds: { relations: ['room', 'sender'], disableMixedMap: true },
      });
      persisted.room = room;
      await manager.getRepository(MessageRoom).update({ id: roomId }, { updatedAt: persisted.createdAt });
      return persisted;
    });
    const view = this.mapMessageForUser(message, authorId);
    void this.broadcastRealtimeMessage(message)
      .catch(error => this.logger.warn(safeFailure('message_realtime_delivery', error)));
    return view;
  }

  async createDirectTextMessage(
    roomId: string,
    authorId: string,
    text: string,
    clientMessageId?: string,
  ): Promise<MessageViewModel> {
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body || body.length > 4000) throw new BadRequestException('Message text must contain 1 to 4000 characters');
    if (clientMessageId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMessageId)) {
      throw new BadRequestException('Invalid message request id');
    }
    const id = (clientMessageId ?? randomUUID()).toLowerCase();
    // The existing primary UUID is the retry key. INSERT .. DO NOTHING cannot
    // overwrite a colliding row, unlike save() with a caller-provided identifier.
    const result = await this.messages.manager.transaction(async manager => {
      const rooms = manager.getRepository(MessageRoom);
      const room = await rooms.findOne({ where: { id: roomId }, loadEagerRelations: false,
        loadRelationIds: { relations: ['userOne', 'userTwo'], disableMixedMap: true }, lock: { mode: 'pessimistic_write' } });
      if (!room || room.deleted) throw new NotFoundException('Room not found');
      if (room.userOne.id !== authorId && room.userTwo.id !== authorId) throw new ForbiddenException('You do not have access to this room');
      const messages = manager.getRepository(Message);
      const inserted = await messages.createQueryBuilder().insert().values({ id, room: { id: roomId }, sender: { id: authorId },
        category: MessageCategory.DIRECT, text: body, caption: null, imageUrl: null, createdAt: () => 'clock_timestamp()' })
        .orIgnore().returning(['id']).execute();
      const message = await messages.findOneOrFail({ where: { id }, loadEagerRelations: false,
        loadRelationIds: { relations: ['room', 'sender'], disableMixedMap: true } });
      if (message.room.id !== roomId || message.sender?.id !== authorId || message.text !== body ||
          message.category !== MessageCategory.DIRECT || message.imageUrl || message.caption) {
        throw new ConflictException('Message request conflicts with an existing message');
      }
      message.room = room;
      const created = Array.isArray(inserted.raw) && inserted.raw.some((row: { id?: string }) => row.id === id);
      if (created) await rooms.update({ id: roomId }, { updatedAt: message.createdAt });
      return { message, created, view: this.mapMessageForUser(message, authorId) };
    });
    // A live-delivery failure after commit must not turn durable success into an
    // error that invites another send. History remains the source of truth.
    if (result.created) void this.broadcastRealtimeMessage(result.message)
      .catch(error => this.logger.warn(safeFailure('message_realtime_delivery', error)));
    return result.view;
  }

  async listMessages(
    roomId: string,
    userId: string,
    query: ListMessagesQueryDto,
  ): Promise<ListMessagesResult> {
    const room = await this.getRoomOrFail(roomId, userId);
    const limit = query.limit ?? 50;

    let cursorCreatedAt: Date | null = null;
    let cursorId: string | null = null;
    if (query.cursor) {
      const cursorMessage = await this.messages.findOne({
        where: { id: query.cursor },
        relations: ['room'],
      });
      if (!cursorMessage) {
        throw new NotFoundException('Cursor message not found');
      }
      if (cursorMessage.room.id !== roomId) {
        throw new BadRequestException('Cursor does not belong to this room');
      }
      cursorCreatedAt = cursorMessage.createdAt;
      cursorId = cursorMessage.id;
    }

    const builder = this.messages
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.room', 'room')
      .leftJoinAndSelect('room.userOne', 'userOne')
      .leftJoinAndSelect('room.userTwo', 'userTwo')
      .where('room.id = :roomId', { roomId: room.id })
      .orderBy('message.createdAt', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .take(limit + 1);

    if (cursorCreatedAt) {
      builder.andWhere('(message.createdAt < :cursor OR (message.createdAt = :cursor AND message.id < :cursorId))', { cursor: cursorCreatedAt, cursorId });
    }

    const records = await builder.getMany();
    const hasMore = records.length > limit;
    const slice = hasMore ? records.slice(0, limit) : records;
    const view = slice.map((msg) => this.mapMessageForUser(msg, userId));
    const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

    return {
      messages: view.reverse(),
      nextCursor,
    };
  }

  async searchMessages(roomId: string, userId: string, query: string): Promise<MessageViewModel[]> {
    if (!query || query.length < 3) {
      throw new BadRequestException('Query must be at least 3 characters');
    }
    await this.getRoomOrFail(roomId, userId);

    const results = await this.messages
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.room', 'room')
      .leftJoinAndSelect('room.userOne', 'userOne')
      .leftJoinAndSelect('room.userTwo', 'userTwo')
      .where('room.id = :roomId', { roomId })
      .andWhere(
        `(message.text ILIKE :term OR message.caption ILIKE :term)`,
        { term: `%${query}%` },
      )
      .orderBy('message.createdAt', 'DESC')
      .take(50)
      .getMany();

    return results.map((msg) => this.mapMessageForUser(msg, userId));
  }

  async deleteRoomMessages(roomId: string, userId: string): Promise<void> {
    const participants = await this.messages.manager.transaction(async manager => {
      const room = await this.lockReadableRoom(manager, roomId, userId);
      await manager.getRepository(Message).delete({ room: { id: roomId } });
      return [room.userOne.id, room.userTwo.id];
    });
    if (this.gateway) void this.gateway.emitRoomCleared(roomId, participants)
      .catch(error => this.logger.warn(safeFailure('message_clear_delivery', error)));
  }

  async deleteRoom(roomId: string, userId: string): Promise<void> {
    const participants = await this.messages.manager.transaction(async manager => {
      const room = await this.lockReadableRoom(manager, roomId, userId);
      await manager.getRepository(MessageRoom).delete({ id: roomId });
      return [room.userOne.id, room.userTwo.id];
    });
    if (this.gateway) void this.gateway.emitRoomDeleted(roomId, participants)
      .catch(error => this.logger.warn(safeFailure('message_delete_delivery', error)));
  }

  private async lockReadableRoom(manager: EntityManager, roomId: string, userId: string): Promise<MessageRoom> {
    const room = await manager.getRepository(MessageRoom).findOne({ where: { id: roomId }, loadEagerRelations: false,
      loadRelationIds: { relations: ['userOne', 'userTwo'], disableMixedMap: true }, lock: { mode: 'pessimistic_write' } });
    if (!room || room.deleted) throw new NotFoundException('Room not found');
    if (room.userOne.id !== userId && room.userTwo.id !== userId) throw new ForbiddenException('You do not have access to this room');
    return room;
  }

  async getRoomOrFail(roomId: string, userId: string): Promise<MessageRoom> {
    const room = await this.rooms.findOne({ where: { id: roomId } });
    if (!room || room.deleted) {
      throw new NotFoundException('Room not found');
    }
    if (room.userOne.id !== userId && room.userTwo.id !== userId) {
      throw new ForbiddenException('You do not have access to this room');
    }
    return room;
  }

  private async mapRoom(room: MessageRoom, viewerId?: string, unreadCount = 0): Promise<ActiveRoomViewModel> {
    const participants = [room.userOne, room.userTwo].map((user) => ({
      id: user.id,
      firstName: MESSAGE_MEMBER_LABEL,
      lastName: null,
      profileImageUrl: user.profileImageUrl ?? null,
      online: this.presence.isOnline(user.id),
    }));

    const lastMessage = await this.messages
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.room', 'lastRoom')
      .leftJoinAndSelect('lastRoom.userOne', 'lastUserOne')
      .leftJoinAndSelect('lastRoom.userTwo', 'lastUserTwo')
      .where('lastRoom.id = :roomId', { roomId: room.id })
      .orderBy('message.createdAt', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .getOne();

    return {
      id: room.id,
      unreadCount,
      participants,
      lastMessage: lastMessage
        ? this.mapMessageForUser(
            lastMessage,
            viewerId ?? lastMessage.sender?.id ?? room.userOne.id,
          )
        : null,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }

  private mapMessageForUser(message: Message, viewerId: string): MessageViewModel {
    const direction: MessageDirection =
      message.category === MessageCategory.GENERAL
        ? 'general'
        : message.sender?.id === viewerId
        ? 'outgoing'
        : 'incoming';

    return {
      id: message.id,
      roomId: message.room.id,
      direction,
      category: message.category,
      imageUrl: message.imageUrl ?? null,
      caption: message.caption ?? null,
      text: message.text ?? null,
      createdAt: message.createdAt,
      sender: message.sender
        ? {
            id: message.sender.id,
            firstName: MESSAGE_MEMBER_LABEL,
            lastName: null,
            profileImageUrl: message.sender.profileImageUrl ?? null,
          }
        : null,
    };
  }

  private async broadcastRealtimeMessage(message: Message): Promise<void> {
    if (!this.gateway) return;
    const participants = [message.room.userOne.id, message.room.userTwo.id];
    const payloads = participants.map((participantId) => ({
      userId: participantId,
      message: this.mapMessageForUser(message, participantId),
    }));
    await this.gateway.broadcastMessage(message.room.id, payloads);
  }

  private async touchRoom(roomId: string): Promise<void> {
    await this.rooms.update({ id: roomId }, { updatedAt: new Date() });
  }
}
