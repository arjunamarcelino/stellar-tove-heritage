import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useMountedRef } from '@/hooks/use-mounted-ref';
import { adminKeys } from '@/lib/query-keys';

import { createAdmin, deleteAdmin, updateAdmin } from '../api';
import type { RegisterAdminData, UpdateAdminData } from '../schemas';

export function useCreateAdmin() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();

  return useMutation({
    mutationFn: (data: RegisterAdminData) => createAdmin(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.lists() });
      toast.success('Admin created successfully');
      if (mountedRef.current) {
        router.push('/admins');
      }
    },
  });
}

export function useUpdateAdmin(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateAdminData) => updateAdmin(id, data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.detail(id) }),
        queryClient.invalidateQueries({ queryKey: adminKeys.lists() }),
      ]);
      toast.success('Admin updated successfully');
    },
  });
}

export function useDeleteAdmin() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();

  return useMutation({
    mutationFn: (id: string) => deleteAdmin(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.lists() });
      toast.success('Admin deleted successfully');
      if (mountedRef.current) {
        router.push('/admins');
      }
    },
  });
}
