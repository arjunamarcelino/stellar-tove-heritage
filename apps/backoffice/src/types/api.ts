export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string = 'UNKNOWN_ERROR',
  ) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);
    this.name = 'ApiError';
  }
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface MissionListParams extends PaginationParams {
  stageId?: string;
}

export interface SubmissionFilterParams {
  status?: string;
  missionId?: string;
  userId?: string;
}

export interface ArtworkListParams extends PaginationParams {
  /** CSV of lifecycle statuses to filter by (e.g. "verified,fractionalized"). */
  status?: string;
}

export interface OfferingListParams extends PaginationParams {
  /** CSV of offering statuses to filter by (e.g. "planned" or "planned,approved"). */
  status?: string;
  artworkId?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
