import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import {
  ProfileImageDerivatives,
  ProfileImageStatus,
} from '../constants/profile-image.constants';

/**
 * A collector's uploaded avatar image and its processing lifecycle (TOV-30, FR-01.09).
 *
 * Lifecycle: `pending` (signed URL minted) → `processing` (bytes committed + validated) →
 * `ready` (derivatives generated to the PRIVATE bucket) → activated (derivatives copied to the public
 * bucket, `users.profile_image_id` set) | `failed`. Publication to the public bucket happens only on
 * activation, never at `ready` — so an un-activated `ready` image has no public bytes.
 *
 * `source_path` is the private source-object key; `derivatives` holds the PRIVATE derivative keys. Neither
 * is ever serialized to a client (response DTOs map field-by-field). FK actions on this table's relationships
 * never fire under soft delete — the service nulls `users.profile_image_id` in-app and reads filter
 * `deleted_at IS NULL`.
 */
@Entity('profile_images')
export class ProfileImage extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // varchar+CHECK (native-enum-free, per house convention); the migration owns the CHECK.
  @Column({ name: 'status', type: 'varchar', length: 16, default: 'pending' })
  status!: ProfileImageStatus;

  @Column({ name: 'source_path', type: 'text' })
  sourcePath!: string;

  @Column({ name: 'derivatives', type: 'jsonb', default: () => `'{}'` })
  derivatives!: ProfileImageDerivatives;
}
