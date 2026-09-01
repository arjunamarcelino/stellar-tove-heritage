import { ApiPropertyOptional } from '@nestjs/swagger';
import { SocialLinksDto } from './social-links.dto';
import { BIO_MAX_LENGTH, STATEMENT_MAX_LENGTH } from '../constants/social-links.constant';

/**
 * Swagger shape for `PATCH /me` (TOV-30). Documents the partial-update contract; the route validates the
 * RAW request body in the service (not this DTO instance) so null-vs-absent presence is reliable and the
 * 422 `VALIDATION_FAILED` + `errors[]` shape can be produced. Every field is optional; explicit `null`
 * clears it, absence leaves it unchanged.
 */
export class UpdateMeProfileDto {
  @ApiPropertyOptional({ maxLength: BIO_MAX_LENGTH, nullable: true, description: 'Short bio; null clears.' })
  bio?: string | null;

  @ApiPropertyOptional({
    maxLength: STATEMENT_MAX_LENGTH,
    nullable: true,
    description: 'Collector statement; null clears.',
  })
  statement?: string | null;

  @ApiPropertyOptional({
    type: () => SocialLinksDto,
    nullable: true,
    description: 'Replace-whole-object; null clears all.',
  })
  socialLinks?: SocialLinksDto | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'A READY image id to activate as the avatar; null removes it.',
  })
  profileImageId?: string | null;
}
