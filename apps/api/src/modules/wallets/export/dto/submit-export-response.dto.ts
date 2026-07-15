import { ApiProperty } from '@nestjs/swagger';
import {
  WALLET_EXPORT_ITEM_STATUSES,
  WALLET_EXPORT_STATUSES,
  WalletExportItemStatus,
  WalletExportStatus,
} from '../export-status.types';

export class SubmitExportItemResultDto {
  @ApiProperty() itemId!: string;
  @ApiProperty({ enum: [...WALLET_EXPORT_ITEM_STATUSES] })
  status!: WalletExportItemStatus;
  @ApiProperty({ required: false }) txHash?: string;
  @ApiProperty({ required: false }) ledger?: number;
  @ApiProperty({ required: false, description: 'Mapped error code for a failed item' })
  errorCode?: string;
}

/**
 * Result of a submit. `status` is the export roll-up (`completed` when every item confirmed + the
 * live-balance-zero gate passed, else `submitting`). Per-item detail drives the FE's partial-settlement
 * UI + resume (re-`/export` the still-pending items).
 */
export class SubmitExportResponseDto {
  @ApiProperty() exportId!: string;
  @ApiProperty({ enum: [...WALLET_EXPORT_STATUSES] })
  status!: WalletExportStatus;
  @ApiProperty({ description: 'Whether the wallet was latched to exported this call' })
  walletExported!: boolean;
  @ApiProperty({ type: [SubmitExportItemResultDto] }) items!: SubmitExportItemResultDto[];

  static create(data: {
    exportId: string;
    status: WalletExportStatus;
    walletExported: boolean;
    items: SubmitExportItemResultDto[];
  }): SubmitExportResponseDto {
    const dto = new SubmitExportResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
