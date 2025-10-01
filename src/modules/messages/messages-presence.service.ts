import { Injectable } from '@nestjs/common';

interface PresenceState {
  sockets: Set<string>;
  lastSeen: Date;
}

@Injectable()
export class MessagesPresenceService {
  private readonly state = new Map<string, PresenceState>();

  markOnline(userId: string, socketId: string): boolean {
    const entry = this.state.get(userId) || { sockets: new Set<string>(), lastSeen: new Date() };
    const before = entry.sockets.size;
    entry.sockets.add(socketId);
    entry.lastSeen = new Date();
    this.state.set(userId, entry);
    return before === 0;
  }

  markOffline(userId: string, socketId: string): boolean {
    const entry = this.state.get(userId);
    if (!entry) {
      return false;
    }
    entry.sockets.delete(socketId);
    entry.lastSeen = new Date();
    if (entry.sockets.size === 0) {
      this.state.set(userId, entry);
      return true;
    }
    return false;
  }

  isOnline(userId: string): boolean {
    const entry = this.state.get(userId);
    return !!entry && entry.sockets.size > 0;
  }

  getLastSeen(userId: string): Date | null {
    const entry = this.state.get(userId);
    return entry ? entry.lastSeen : null;
  }
}
