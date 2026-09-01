import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger shape for `socialLinks` (TOV-30). Validation lives in `profile-validation.ts` (service-level, to
 * produce the 422 `VALIDATION_FAILED` + `errors[]` contract), so these carry docs only, not class-validator
 * decorators. twitter/instagram must be https on their platform domain; website is any https URL.
 */
export class SocialLinksDto {
  @ApiPropertyOptional({ example: 'https://x.com/collector', nullable: true })
  twitter?: string | null;

  @ApiPropertyOptional({ example: 'https://instagram.com/collector', nullable: true })
  instagram?: string | null;

  @ApiPropertyOptional({ example: 'https://collector.art', nullable: true })
  website?: string | null;
}
