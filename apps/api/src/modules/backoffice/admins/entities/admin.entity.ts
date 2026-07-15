import { Entity, Column, BeforeInsert, BeforeUpdate } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { AdminRole } from '@common/enums/admin-role.enum';

@Entity('admins')
export class Admin extends BaseEntity {
  @Column({ type: 'citext' })
  email!: string;

  @Column({ name: 'password_hash', length: 72 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 32, default: AdminRole.ADMIN })
  role!: AdminRole;

  @Column({ name: 'first_name', type: 'varchar', nullable: true })
  firstName: string | null = null;

  @Column({ name: 'last_name', type: 'varchar', nullable: true })
  lastName: string | null = null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 64, nullable: true })
  refreshTokenHash: string | null = null;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeEmail(): void {
    if (this.email) {
      this.email = this.email.toLowerCase().trim();
    }
  }

  @BeforeInsert()
  @BeforeUpdate()
  validatePasswordHash(): void {
    if (this.passwordHash && !this.passwordHash.startsWith('$2')) {
      throw new Error('passwordHash must be a bcrypt hash, not a plain-text password');
    }
  }
}
