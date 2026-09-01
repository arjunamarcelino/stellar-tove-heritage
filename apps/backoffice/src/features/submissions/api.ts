import { api } from '@/lib/api-client';
import type { PaginatedResponse } from '@/types/api';

import type { Submission, ReviewFormData } from './schemas';

export function getSubmissions(): Promise<PaginatedResponse<Submission>> {
  return api.get<PaginatedResponse<Submission>>('/api/submissions');
}

export function getSubmission(id: string): Promise<Submission> {
  return api.get<Submission>(`/api/submissions/${id}`);
}

export function reviewSubmission(id: string, data: ReviewFormData): Promise<Submission> {
  return api.patch<Submission>(`/api/submissions/${id}/review`, data);
}
