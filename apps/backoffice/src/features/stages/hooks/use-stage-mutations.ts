import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useMountedRef } from '@/hooks/use-mounted-ref';
import { stageKeys } from '@/lib/query-keys';

import { createStage, updateStage, deleteStage } from '../api';
import type { StageFormData } from '../schemas';

export function useCreateStage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();

  return useMutation({
    mutationFn: (data: StageFormData) => createStage(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: stageKeys.lists() });
      toast.success('Stage created successfully');
      if (mountedRef.current) {
        router.push('/missions');
      }
    },
  });
}

export function useUpdateStage(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<StageFormData>) => updateStage(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: stageKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: stageKeys.lists() });
      toast.success('Stage updated successfully');
    },
  });
}

export function useDeleteStage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();

  return useMutation({
    mutationFn: (id: string) => deleteStage(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: stageKeys.lists() });
      toast.success('Stage deleted successfully');
      if (mountedRef.current) {
        router.push('/missions');
      }
    },
  });
}
