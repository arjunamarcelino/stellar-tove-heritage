import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';

@Entity('stages')
export class Stage extends BaseEntity {
  @Column({ name: 'title', type: 'varchar', length: 255 })
  title!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'order', type: 'integer' })
  order!: number;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  get isEffectivelyActive(): boolean {
    if (!this.isActive) return false;
    if (this.startsAt && this.startsAt.getTime() > Date.now()) return false;
    return true;
  }
}
