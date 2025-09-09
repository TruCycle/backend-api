import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePickupOrderAndItem1700000000005 implements MigrationInterface {
  name = 'CreatePickupOrderAndItem1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // status enum for pickup orders
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pickup_status_enum') THEN
          CREATE TYPE pickup_status_enum AS ENUM (
            'draft','placed','scheduled','assigned','picked_up','delivered','cancelled'
          );
        END IF;
      END $$;
    `);

    // pickup_order table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pickup_order (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        customer_id uuid NOT NULL,
        origin_address_id uuid NULL,
        zone_id uuid NULL,
        status pickup_status_enum NOT NULL DEFAULT 'draft',
        scheduled_at timestamptz NULL,
        placed_at timestamptz NULL,
        channel text NULL,
        notes text NULL,
        geom geometry(Point,4326) NOT NULL,
        cancel_reason text NULL,
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_pickup_order_customer FOREIGN KEY (customer_id) REFERENCES "user"(id) ON DELETE RESTRICT,
        CONSTRAINT fk_pickup_order_origin_address FOREIGN KEY (origin_address_id) REFERENCES address(id) ON DELETE SET NULL,
        CONSTRAINT fk_pickup_order_zone FOREIGN KEY (zone_id) REFERENCES service_zone(id) ON DELETE SET NULL
      )
    `);

    // Composite index per architecture
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pickup_order_status_zone_sched ON pickup_order(status, zone_id, scheduled_at)`,
    );

    // pickup_item table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pickup_item (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id uuid NOT NULL,
        material_code text NULL,
        quantity numeric(12,3) NULL,
        unit text NULL,
        weee jsonb NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_pickup_item_order FOREIGN KEY (order_id) REFERENCES pickup_order(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_pickup_item_order ON pickup_item(order_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pickup_item_order`);
    await queryRunner.query(`DROP TABLE IF EXISTS pickup_item`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pickup_order_status_zone_sched`);
    await queryRunner.query(`DROP TABLE IF EXISTS pickup_order`);
    await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pickup_status_enum') THEN DROP TYPE pickup_status_enum; END IF; END $$;`);
  }
}

