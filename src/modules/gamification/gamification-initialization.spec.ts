import { EntityManager, Repository } from 'typeorm';

import { User } from '../users/user.entity';
import { GamificationService } from './gamification.service';
import { GamificationStreakType, UserStreak } from './user-streak.entity';
import { UserProgress } from './user-progress.entity';

function insertBuilder() {
  return { insert: jest.fn().mockReturnThis(), into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(), onConflict: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}) };
}

describe('Concurrent gamification initialisation', () => {
  const userId = 'reviewer-id';
  let service: GamificationService;
  let manager: EntityManager;
  let builder: ReturnType<typeof insertBuilder>;
  let progress: { findOne: jest.Mock; findOneOrFail: jest.Mock; createQueryBuilder: jest.Mock };
  let streaks: { find: jest.Mock; create: jest.Mock; save: jest.Mock };
  let users: { findOne: jest.Mock };

  beforeEach(() => {
    builder = insertBuilder();
    progress = { findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn(), createQueryBuilder: jest.fn().mockReturnValue(builder) };
    streaks = { find: jest.fn().mockResolvedValue([]), create: jest.fn(value => value), save: jest.fn() };
    users = { findOne: jest.fn().mockResolvedValue({ id: userId }) };
    manager = { getRepository: jest.fn((entity) => {
      if (entity === User) return users;
      if (entity === UserProgress) return progress;
      if (entity === UserStreak) return streaks;
      throw new Error('Unexpected repository');
    }) } as unknown as EntityManager;
    service = new GamificationService(users as unknown as Repository<User>,
      ...Array(9).fill({}) as [never, never, never, never, never, never, never, never, never]);
  });

  it('reads back the winning progress row without overwriting earned progress', async () => {
    const winner = { userId, totalPoints: 250, currentLevel: 2 };
    progress.findOneOrFail.mockResolvedValue(winner);
    expect(await service['ensureUserProgressRow'](manager, userId)).toBe(winner);
    expect(builder.onConflict).toHaveBeenCalledWith('("user_id") DO NOTHING');
    expect(builder.values).toHaveBeenCalledWith({ userId, totalPoints: 0, currentLevel: 1 });
    expect(progress.findOneOrFail).toHaveBeenCalledWith({ where: { userId } });
  });

  it('does not reinitialise an existing progress row', async () => {
    const existing = { userId, totalPoints: 60 };
    progress.findOne.mockResolvedValue(existing);
    expect(await service['ensureUserProgressRow'](manager, userId)).toBe(existing);
    expect(builder.execute).not.toHaveBeenCalled();
  });

  it('rejects missing users without attempting an insert', async () => {
    users.findOne.mockResolvedValue(null);
    await expect(service['ensureUserProgressRow'](manager, userId)).rejects.toThrow('User not found');
    expect(builder.execute).not.toHaveBeenCalled();
  });

  it('propagates unrelated database failures', async () => {
    builder.execute.mockRejectedValue(new Error('database unavailable'));
    await expect(service['ensureUserProgressRow'](manager, userId)).rejects.toThrow('database unavailable');
    expect(progress.findOneOrFail).not.toHaveBeenCalled();
  });

  it('initialises daily and weekly streaks inside the protected write path', async () => {
    await service['ensureStreakRows'](manager, userId);
    expect(streaks.save).toHaveBeenCalledTimes(2);
    for (const streakType of [GamificationStreakType.DAILY, GamificationStreakType.WEEKLY]) {
      expect(streaks.create).toHaveBeenCalledWith({ userId, user: {id:userId}, streakType, currentStreak: 0,
        longestStreak: 0, lastActivityDate: null, expiresAt: null });
    }
  });

  it('leaves an existing streak untouched when creating the missing cadence', async () => {
    streaks.find.mockResolvedValue([{ userId, streakType: GamificationStreakType.DAILY, currentStreak: 5 }]);
    await service['ensureStreakRows'](manager, userId);
    expect(streaks.save).toHaveBeenCalledTimes(1);
    expect(streaks.create).toHaveBeenCalledWith(expect.objectContaining({ streakType: GamificationStreakType.WEEKLY }));
  });

  it('waits for the account lock before running work with the transaction manager', async () => {
    let release!: (value: unknown) => void;
    const transaction = { query: jest.fn().mockReturnValue(new Promise(resolve => { release = resolve; })) };
    const outer = { transaction: jest.fn(async fn => fn(transaction)) } as unknown as EntityManager;
    const work = jest.fn().mockResolvedValue(undefined);
    const pending = service['withUserStateLock'](outer, userId, work);
    expect(work).not.toHaveBeenCalled();
    expect(transaction.query).toHaveBeenCalledWith('SELECT id FROM public."user" WHERE id = $1 FOR NO KEY UPDATE', [userId]);
    release([{id:userId}]); await pending;
    expect(work).toHaveBeenCalledWith(transaction);
  });

  it('does not run work for a missing locked account', async () => {
    const transaction = { query: jest.fn().mockResolvedValue([]) };
    const outer = { transaction: jest.fn(async fn => fn(transaction)) } as unknown as EntityManager;
    const work = jest.fn();
    await expect(service['withUserStateLock'](outer, userId, work)).rejects.toThrow('User not found');
    expect(work).not.toHaveBeenCalled();
  });

  it('propagates work failures to the enclosing transaction for rollback', async () => {
    const transaction = { query: jest.fn().mockResolvedValue([{id:userId}]) };
    const outer = { transaction: jest.fn(async fn => fn(transaction)) } as unknown as EntityManager;
    const failure = new Error('injected write failure');
    await expect(service['withUserStateLock'](outer, userId, jest.fn().mockRejectedValue(failure)))
      .rejects.toBe(failure);
  });
});
