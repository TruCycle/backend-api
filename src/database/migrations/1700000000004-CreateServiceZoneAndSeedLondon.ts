import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServiceZoneAndSeedLondon1700000000004 implements MigrationInterface {
  name = 'CreateServiceZoneAndSeedLondon1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS service_zone (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        geom geometry(Polygon,4326) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        min_order_value numeric(12,2),
        notes text
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS service_zone_geom_gist ON service_zone USING GIST (geom)`,
    );

    // Seed a rough bounding polygon for Greater London if not exists
    // Bounds approx: lon: [-0.51037, 0.33401], lat: [51.28676, 51.69187]
    await queryRunner.query(
      `INSERT INTO service_zone (name, geom, active, notes)
       SELECT 'London',
         ST_GeomFromText('POLYGON((
           -0.51037 51.28676,
            0.33401 51.28676,
            0.33401 51.69187,
           -0.51037 51.69187,
           -0.51037 51.28676
         ))', 4326),
         true,
         'Seeded rectangular boundary for London (approx)'
       WHERE NOT EXISTS (SELECT 1 FROM service_zone WHERE name = 'London')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS service_zone_geom_gist`);
    await queryRunner.query(`DROP TABLE IF EXISTS service_zone`);
  }
}

