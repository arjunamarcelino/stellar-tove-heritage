import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { IsBase64Url } from '@common/validators/is-base64url.validator';
import { MaxLength, MinLength } from 'class-validator';

/**
 * One signed holding. Carries ONLY the WebAuthn assertion — no `txXdr`: the server verifies the
 * assertion against the unsigned tx it stored for `itemId` at build time (the body tx is never trusted).
 */
export class SubmitExportItemDto {
  @ApiProperty() @IsUUID() itemId!: string;

  @ApiProperty({ description: 'WebAuthn authenticatorData (base64url)' })
  @IsBase64Url()
  @MinLength(48)
  @MaxLength(2048)
  authenticatorData!: string;

  @ApiProperty({ description: 'WebAuthn clientDataJSON (base64url)' })
  @IsBase64Url()
  @MaxLength(4096)
  clientDataJSON!: string;

  @ApiProperty({ description: 'WebAuthn ECDSA signature, DER (base64url)' })
  @IsBase64Url()
  @MaxLength(256)
  signature!: string;
}

/** Submit signed assertions for one or more of an export's holdings. Partial submits are allowed. */
export class SubmitExportDto {
  @ApiProperty() @IsUUID() exportId!: string;

  @ApiProperty({ type: [SubmitExportItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SubmitExportItemDto)
  items!: SubmitExportItemDto[];
}
