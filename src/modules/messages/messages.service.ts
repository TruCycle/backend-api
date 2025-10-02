import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MessageRoom } from './message-room.entity';
import { Message, MessageCategory } from './message.entity';
import { MessagesMediaService } from './messages-media.service';
import { MessagesPresenceService } from './messages-presence.service';
import { MessagesGateway } from './messages.gateway';
import { SendImageMessageDto } from './dto/send-image-message.dto';
import { GeneralMessageDto } from './dto/general-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { User } from '../users/user.entity';

export type MessageDirection = 'incoming' | 'outgoing' | 'general';

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

    return this.mapRoom(room, currentUserId);
  }

  async listActiveRooms(userId: string): Promise<ActiveRoomViewModel[]> {
    const rooms = await this.rooms.find({
      where: [
        { userOne: { id: userId }, deleted: false },
        { userTwo: { id: userId }, deleted: false },
      ],
      order: { updatedAt: 'DESC' },
    });

    const results: ActiveRoomViewModel[] = [];
    for (const room of rooms) {
      results.push(await this.mapRoom(room, userId));
    }
    return results;
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
    const room = await this.getRoomOrFail(roomId, authorId);
    let message = this.messages.create({
      room,
      sender: { id: authorId } as User,
      category: MessageCategory.GENERAL,
      text: dto.text,
      caption: dto.title ?? null,
    });
    message = await this.messages.save(message);
    message = await this.messages.findOneOrFail({
      where: { id: message.id },
      relations: ['room', 'room.userOne', 'room.userTwo', 'sender'],
    });
    const view = this.mapMessageForUser(message, authorId);
    await this.broadcastRealtimeMessage(message);
    await this.touchRoom(room.id);
    return view;
  }

  async listMessages(
    roomId: string,
    userId: string,
    query: ListMessagesQueryDto,
  ): Promise<ListMessagesResult> {
    const room = await this.getRoomOrFail(roomId, userId);
    const limit = query.limit ?? 50;

    let cursorCreatedAt: Date | null = null;
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
      builder.andWhere('message.createdAt < :cursor', { cursor: cursorCreatedAt });
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
    await this.getRoomOrFail(roomId, userId);
    await this.messages.delete({ room: { id: roomId } });
    if (this.gateway) {
      this.gateway.emitRoomCleared(roomId);
    }
  }

  async deleteRoom(roomId: string, userId: string): Promise<void> {
    const room = await this.getRoomOrFail(roomId, userId);
    await this.messages.delete({ room: { id: room.id } });
    await this.rooms.delete({ id: room.id });
    if (this.gateway) {
      this.gateway.emitRoomDeleted(roomId);
    }
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

  private async mapRoom(room: MessageRoom, viewerId?: string): Promise<ActiveRoomViewModel> {
    const participants = [room.userOne, room.userTwo].map((user) => ({
      id: user.id,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
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
            firstName: message.sender.firstName ?? null,
            lastName: message.sender.lastName ?? null,
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
    this.gateway.broadcastMessage(message.room.id, payloads);
  }

  private async touchRoom(roomId: string): Promise<void> {
    await this.rooms.update({ id: roomId }, { updatedAt: new Date() });
  }
}
