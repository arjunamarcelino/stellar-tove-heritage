import type { SubmissionStatus } from './schemas';

export const submissionStatusVariant: Record<
  SubmissionStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  pending: 'outline',
  accepted: 'default',
  rejected: 'destructive',
};

export const submissionStatusLabel: Record<SubmissionStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  rejected: 'Rejected',
};
