import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useMountedRef } from '@/hooks/use-mounted-ref';
import { missionKeys } from '@/lib/query-keys';

import { createMission, updateMission, deleteMission } from '../api';
import type { MissionFormData } from '../schemas';

export function useCreateMission(stageId: string) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();

  return useMutation({
    mutationFn: (data: MissionFormData) => createMission(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: missionKeys.listByStage(stageId) });
      toast.success('Mission created successfully');
      if (mountedRef.current) {
        router.push(`/missions/stages/${stageId}`);
      }
    },
  });
}

export function useUpdateMission(id: string, stageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<MissionFormData>) => updateMission(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: missionKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: missionKeys.listByStage(stageId) });
      toast.success('Mission updated successfully');
    },
  });
}

export function useDeleteMission(stageId: string) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();

  return useMutation({
    mutationFn: (id: string) => deleteMission(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: missionKeys.listByStage(stageId) });
      toast.success('Mission deleted successfully');
      if (mountedRef.current) {
        router.push(`/missions/stages/${stageId}`);
      }
    },
  });
}
