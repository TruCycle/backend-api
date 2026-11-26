import { EntityManager, Repository } from 'typeorm';
import { RewardsService } from './rewards.service';
import { LedgerEntry, LedgerPurpose } from './ledger-entry.entity';
import { Wallet, WalletStatus } from './wallet.entity';
import { User } from '../users/user.entity';

describe('Reward credit transaction and idempotency', () => {
  const wallet = {id:'wallet',currency:'PTS',availableAmount:'10.00',status:WalletStatus.ACTIVE} as Wallet;
  let service: RewardsService;
  let transactionState: { isTransactionActive: boolean };
  let manager: EntityManager;
  let wallets: {findOne: jest.Mock;update: jest.Mock};
  let ledger: {create: jest.Mock;createQueryBuilder: jest.Mock};
  let insert: {insert:jest.Mock;into:jest.Mock;values:jest.Mock;orIgnore:jest.Mock;returning:jest.Mock;execute:jest.Mock};
  beforeEach(() => {
    wallets={findOne:jest.fn().mockResolvedValue(wallet),update:jest.fn()};
    insert={insert:jest.fn(),into:jest.fn(),values:jest.fn(),orIgnore:jest.fn(),returning:jest.fn(),execute:jest.fn().mockResolvedValue({raw:[{id:'entry'}]})};
    for (const method of ['insert','into','values','orIgnore','returning'] as const) insert[method].mockReturnValue(insert);
    ledger={create:jest.fn(x=>x),createQueryBuilder:jest.fn(()=>insert)};
    transactionState = { isTransactionActive: true };
    manager={queryRunner:transactionState,getRepository:jest.fn(entity=>entity===Wallet?wallets:ledger)} as unknown as EntityManager;
    service=new RewardsService({} as Repository<Wallet>,{} as Repository<LedgerEntry>,{} as Repository<User>);
  });
  it('reads locked current balance, not caller stale balance', async () => {
    wallets.findOne.mockResolvedValue({...wallet,availableAmount:'25.00'});
    await service.credit(manager,{...wallet,availableAmount:'0.00'},5,LedgerPurpose.CLAIM_COMPLETE_DONOR,'claim');
    expect(wallets.findOne).toHaveBeenCalledWith({where:{id:'wallet'},lock:{mode:'pessimistic_write'}});
    expect(wallets.update).toHaveBeenCalledWith('wallet',{availableAmount:'30.00'});
  });
  it('ignores a duplicate insert without changing balance or aborting transaction', async () => {
    insert.execute.mockResolvedValue({raw:[]});
    expect(await service.credit(manager,wallet,5,LedgerPurpose.CLAIM_COMPLETE_DONOR,'same-claim')).toBeNull();
    expect(insert.orIgnore).toHaveBeenCalled();expect(wallets.update).not.toHaveBeenCalled();
  });
  it.each([NaN,Infinity,-1,0])('does not create invalid %s credit', async amount => {
    expect(await service.credit(manager,wallet,amount,LedgerPurpose.CLAIM_COMPLETE_DONOR,'claim')).toBeNull();
    expect(insert.execute).not.toHaveBeenCalled();
  });
  it('requires an enclosing transaction', async () => {
    transactionState.isTransactionActive = false;
    await expect(service.credit(manager,wallet,1,LedgerPurpose.CLAIM_COMPLETE_DONOR,'claim')).rejects.toThrow('active transaction');
    expect(insert.execute).not.toHaveBeenCalled();
  });
  it('propagates insert failure without writing balance', async () => {
    insert.execute.mockRejectedValue(new Error('synthetic failure'));
    await expect(service.credit(manager,wallet,1,LedgerPurpose.CLAIM_COMPLETE_DONOR,'claim')).rejects.toThrow('synthetic failure');
    expect(wallets.update).not.toHaveBeenCalled();
  });
});
