import { ApiProperty } from '@nestjs/swagger';
import {
  EXPORT_TOKEN_KINDS,
  WALLET_EXPORT_ITEM_STATUSES,
  ExportTokenKind,
  WalletExportItemStatus,
} from '../export-status.types';

/** Reconciliation state for the FE — explicit `pending`/`submitting` so it never blind-resubmits. */
export type ExportReadState = 'none' | 'pending' | 'submitting' | 'confirmed' | 'failed';

export class ExportStatusItemDto {
  @ApiProperty() tokenContract!: string;
  @ApiProperty({ enum: [...EXPORT_TOKEN_KINDS] }) tokenKind!: ExportTokenKind;
  @ApiProperty({ enum: [...WALLET_EXPORT_ITEM_STATUSES] })
  status!: WalletExportItemStatus;
  @ApiProperty({ required: false }) txHash?: string;
}

export class ExportStatusResponseDto {
  @ApiProperty({ required: false, description: 'Active/last export id, or null when none' })
  exportId!: string | null;
  @ApiProperty({ enum: ['none', 'pending', 'submitting', 'confirmed', 'failed'] })
  state!: ExportReadState;
  @ApiProperty({ required: false, description: 'The self-custody target once the wallet is exported' })
  selfCustodyAddress?: string;
  @ApiProperty({ type: [ExportStatusItemDto] }) items!: ExportStatusItemDto[];

  static create(data: {
    exportId: string | null;
    state: ExportReadState;
    selfCustodyAddress?: string;
    items: ExportStatusItemDto[];
  }): ExportStatusResponseDto {
    const dto = new ExportStatusResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
