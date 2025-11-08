import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWalletAndLedger1700000000021 implements MigrationInterface {
  name = 'CreateWalletAndLedger1700000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_status_enum') THEN
          CREATE TYPE wallet_status_enum AS ENUM ('active','frozen');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_entry_type_enum') THEN
          CREATE TYPE ledger_entry_type_enum AS ENUM ('debit','credit');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_purpose_enum') THEN
          CREATE TYPE ledger_purpose_enum AS ENUM ('claim_complete_collector','claim_complete_donor');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS wallet (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        owner_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        currency char(3) NOT NULL,
        available_amount numeric(14,2) NOT NULL DEFAULT 0,
        pending_amount numeric(14,2) NOT NULL DEFAULT 0,
        status wallet_status_enum NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_wallet_owner_currency UNIQUE (owner_id, currency)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ledger_entry (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        wallet_id uuid NOT NULL REFERENCES wallet(id) ON DELETE CASCADE,
        type ledger_entry_type_enum NOT NULL,
        amount numeric(14,2) NOT NULL,
        currency char(3) NOT NULL,
        balance_after numeric(14,2) NOT NULL,
        purpose ledger_purpose_enum NOT NULL,
        ref text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_ledger_wallet_purpose_ref UNIQUE (wallet_id, purpose, ref)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS ledger_wallet_created_idx ON ledger_entry(wallet_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS ledger_wallet_created_idx');
    await queryRunner.query('DROP TABLE IF EXISTS ledger_entry');
    await queryRunner.query('DROP TABLE IF EXISTS wallet');
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_purpose_enum') THEN
          DROP TYPE ledger_purpose_enum;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_entry_type_enum') THEN
          DROP TYPE ledger_entry_type_enum;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_status_enum') THEN
          DROP TYPE wallet_status_enum;
        END IF;
      END $$;
    `);
  }
}

