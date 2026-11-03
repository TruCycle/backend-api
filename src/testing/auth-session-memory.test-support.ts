import type { EntityManager, Repository } from 'typeorm';
import type { AuthSession } from '../modules/auth/auth-session.entity';
import type { User } from '../modules/users/user.entity';

type Row = Record<string, unknown>;
type Target = { name: string };
// Synthetic transaction/rollback model only; not proof of PostgreSQL locking.
export function authSessionMemory(targets: { user: Target; session: Target; role: Target }, initialUsers: User[]) {
  let state = { users: new Map(initialUsers.map(user => [user.id, structuredClone(user)])),
    sessions: new Map<string, AuthSession>(), links: new Map<string, string[]>() };
  let tail = Promise.resolve();
  const events: Array<{ operation: string; entity: string; options?: unknown }> = [];
  const controls = { failCommit: false, failReads: false };
  function match(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, expected]) => {
      const value = row[key];
      if (expected && typeof expected === 'object' && 'type' in expected) {
        const operator = expected as { type: string; value: unknown };
        if (operator.type === 'isNull') return value === null || value === undefined;
        if (operator.type === 'moreThan') return Number(value) > Number(operator.value);
        if (operator.type === 'in') return (operator.value as unknown[]).includes(value);
      }
      return value === expected;
    });
  }
  function repo(target: Target) {
    const collection = () => target.name === targets.user.name ? state.users : state.sessions;
    return {
      manager,
      create: (value: Row) => ({ ...value }),
      findOne: async (options: { where: Row; lock?: unknown }) => {
        events.push({ operation: 'findOne', entity: target.name, options });
        if (controls.failReads) throw new Error('synthetic private database diagnostic');
        return [...collection().values()].find(row => match(row as unknown as Row, options.where)) ?? null;
      },
      find: async (options: { where: Row }) => {
        events.push({ operation: 'find', entity: target.name, options });
        if (controls.failReads) throw new Error('synthetic private database diagnostic');
        if (target.name === targets.role.name) {
          const id = (options.where.user as { id: string }).id;
          return (state.links.get(id) ?? ['customer']).map(code => ({ role: { code } }));
        }
        return [...collection().values()].filter(row => match(row as unknown as Row, options.where));
      },
      save: async (value: Row) => {
        events.push({ operation: 'save', entity: target.name });
        (collection() as unknown as Map<string, Row>).set(value.id as string, value);
        return value;
      },
      update: async (where: Row, patch: Row) => {
        events.push({ operation: 'update', entity: target.name, options: { where, patch } });
        for (const row of collection().values()) if (match(row as unknown as Row, where)) Object.assign(row, patch);
        return { affected: 1 };
      },
    };
  }
  const manager = {
    queryRunner: { isTransactionActive: true },
    getRepository: (target: Target) => repo(target),
    transaction: <T>(work: (tx: EntityManager) => Promise<T>) => {
      const current = tail.then(async () => {
        const backup = structuredClone(state);
        events.push({ operation: 'begin', entity: 'transaction' });
        try {
          const result = await work(manager as unknown as EntityManager);
          if (controls.failCommit) { controls.failCommit = false; throw Error('synthetic commit failure'); }
          events.push({ operation: 'commit', entity: 'transaction' }); return result;
        } catch (error) { state = backup; events.push({ operation: 'rollback', entity: 'transaction' }); throw error; }
      });
      tail = current.then(() => undefined, () => undefined);
      return current;
    },
  };
  return { repository: repo(targets.session) as unknown as Repository<AuthSession>, manager: manager as unknown as EntityManager,
    get users() { return state.users; }, get sessions() { return state.sessions; }, get links() { return state.links; }, events, controls };
}
