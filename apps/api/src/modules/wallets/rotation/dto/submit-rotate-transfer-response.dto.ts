import { ApiProperty } from '@nestjs/swagger';
import { ErrorCode } from '@common/enums/error-code.enum';
import {
  WALLET_ROTATION_ITEM_STATUSES,
  WALLET_ROTATION_STATUSES,
  WalletRotationItemStatus,
  WalletRotationStatus,
} from '../rotation-status.types';

export class SubmitRotateTransferItemResultDto {
  @ApiProperty() itemId!: string;
  @ApiProperty({ enum: [...WALLET_ROTATION_ITEM_STATUSES] })
  status!: WalletRotationItemStatus;
  @ApiProperty({ required: false }) txHash?: string;
  @ApiProperty({ required: false }) ledger?: number;
  @ApiProperty({ required: false, enum: ErrorCode, description: 'Mapped error code for a failed item' })
  errorCode?: ErrorCode;
}

/**
 * Result of a submit. `status` is the rotation roll-up (`completed` when every item confirmed + the
 * live-balance-zero gate passed over the frozen fraction set, else `submitting`). Per-item detail drives the
 * FE's partial-progress UI + resume (re-`/rotate-transfer` the still-pending items).
 */
export class SubmitRotateTransferResponseDto {
  @ApiProperty() rotationId!: string;
  @ApiProperty({ enum: [...WALLET_ROTATION_STATUSES] })
  status!: WalletRotationStatus;
  @ApiProperty({ type: [SubmitRotateTransferItemResultDto] }) items!: SubmitRotateTransferItemResultDto[];

  static create(data: {
    rotationId: string;
    status: WalletRotationStatus;
    items: SubmitRotateTransferItemResultDto[];
  }): SubmitRotateTransferResponseDto {
    const dto = new SubmitRotateTransferResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
