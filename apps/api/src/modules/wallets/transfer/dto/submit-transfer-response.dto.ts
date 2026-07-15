import { ApiProperty } from '@nestjs/swagger';

/** Result of a submitted transfer. `status` is the terminal on-chain outcome. */
export class SubmitTransferResponseDto {
  @ApiProperty({ description: 'Submitted transaction hash (hex)' })
  txHash!: string;

  @ApiProperty({ description: 'Ledger the transaction was applied in' })
  ledger!: number;

  @ApiProperty({ description: 'Terminal status', enum: ['SUCCESS'] })
  status!: string;

  static create(data: { txHash: string; ledger: number; status: string }): SubmitTransferResponseDto {
    const dto = new SubmitTransferResponseDto();
    Object.assign(dto, data);
    return dto;
  }
}
