import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum RoleCode {
  CUSTOMER = 'customer',
  COLLECTOR = 'collector',
  FACILITY = 'facility',
  ADMIN = 'admin',
  FINANCE = 'finance',
  PARTNER = 'partner',
}

@Entity('role')
@Unique(['code'])
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: RoleCode })
  code!: RoleCode;
}

