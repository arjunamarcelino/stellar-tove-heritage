import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useMountedRef } from '@/hooks/use-mounted-ref';
import { userKeys } from '@/lib/query-keys';

import { createUser, deleteUser, updateUser } from '../api';
import type { CreateUserData, UpdateUserData } from '../schemas';

export function useCreateUser() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();

  return useMutation({
    mutationFn: (data: CreateUserData) => createUser(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      toast.success('User created successfully');
      if (mountedRef.current) {
        router.push('/users');
      }
    },
  });
}

export function useUpdateUser(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateUserData) => updateUser(id, data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: userKeys.detail(id) }),
        queryClient.invalidateQueries({ queryKey: userKeys.lists() }),
      ]);
      toast.success('User updated successfully');
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();

  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSettled: async (_data, _error, id) => {
      queryClient.removeQueries({ queryKey: userKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
    onSuccess: () => {
      toast.success('User deactivated successfully');
      if (mountedRef.current) {
        router.push('/users');
      }
    },
  });
}
