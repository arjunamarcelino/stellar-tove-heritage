import { ApiProperty } from '@nestjs/swagger';
import { WALLET_ROTATION_ITEM_STATUSES, WalletRotationItemStatus } from '../rotation-status.types';

/**
 * Reconciliation state for the FE — explicit `pending`/`submitting` so it never blind-resubmits. Single-source
 * `as const` tuple feeds both the TS union and the Swagger enum (todo 435 — no hand-repeated literals).
 */
export const ROTATION_READ_STATES = ['none', 'pending', 'submitting', 'confirmed', 'failed'] as const;
export type RotationReadState = (typeof ROTATION_READ_STATES)[number];

export class RotateTransferStatusItemDto {
  @ApiProperty() tokenContract!: string;
  @ApiProperty({ enum: [...WALLET_ROTATION_ITEM_STATUSES] })
  status!: WalletRotationItemStatus;
  @ApiProperty({ required: false }) txHash?: string;
}

export class RotateTransferStatusResponseDto {
  @ApiProperty({ required: false, description: 'Active/last rotation id, or null when none' })
  rotationId!: string | null;
  @ApiProperty({ enum: [...ROTATION_READ_STATES] })
  state!: RotationReadState;
  @ApiProperty({ required: false, description: 'The destination settlement wallet address (frozen at initiate)' })
  destinationAddress?: string;
  @ApiProperty({ required: false, description: "The destination wallet's id — lock the FE selector to this on resume" })
  destinationWalletId?: string;
  @ApiProperty({ type: [RotateTransferStatusItemDto] }) items!: RotateTransferStatusItemDto[];

  static create(data: {
    rotationId: string | null;
    state: RotationReadState;
    destinationAddress?: string;
    destinationWalletId?: string;
    items: RotateTransferStatusItemDto[];
  }): RotateTransferStatusResponseDto {
    const dto = new RotateTransferStatusResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}

/** Result of canceling an active rotation (clears the one-active latch). */
export class CancelRotateTransferResponseDto {
  @ApiProperty() canceledId!: string;

  static create(data: { canceledId: string }): CancelRotateTransferResponseDto {
    const dto = new CancelRotateTransferResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
