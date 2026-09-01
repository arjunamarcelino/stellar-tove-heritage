import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { submissionKeys } from '@/lib/query-keys';

import { reviewSubmission } from '../api';
import type { ReviewFormData } from '../schemas';

export function useReviewSubmission(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ReviewFormData) => reviewSubmission(id, data),
    onSuccess: (_data, variables) => {
      const action = variables.status === 'accepted' ? 'accepted' : 'rejected';
      toast.success(`Submission ${action}`);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: submissionKeys.lists() });
      await queryClient.invalidateQueries({ queryKey: submissionKeys.detail(id) });
    },
  });
}
