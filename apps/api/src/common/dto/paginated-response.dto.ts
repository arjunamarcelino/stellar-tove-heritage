import { ApiProperty } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 25 })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}

export class PaginatedResponseDto<T> {
  data!: T[];

  @ApiProperty({ type: PaginationMeta })
  meta!: PaginationMeta;

  static create<T>(data: T[], total: number, page: number, limit: number): PaginatedResponseDto<T> {
    const response = new PaginatedResponseDto<T>();
    response.data = data;
    response.meta = {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
    return response;
  }
}
