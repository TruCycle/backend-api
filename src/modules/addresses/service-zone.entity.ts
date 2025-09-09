import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('service_zone')
export class ServiceZone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'geometry', spatialFeatureType: 'Polygon', srid: 4326 })
  geom!: any; // GeoJSON Polygon

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'min_order_value', type: 'numeric', precision: 12, scale: 2, nullable: true })
  minOrderValue?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}

