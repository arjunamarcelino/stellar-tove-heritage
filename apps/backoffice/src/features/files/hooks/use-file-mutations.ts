import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useMountedRef } from '@/hooks/use-mounted-ref';
import { fileKeys } from '@/lib/query-keys';

import { createFile, deleteFile, updateFile } from '../api';

export function useCreateFile() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.();
    };
  }, []);

  const mutation = useMutation({
    mutationFn: (formData: FormData) => {
      const { promise, abort } = createFile(formData, (percent) => {
        if (mountedRef.current) setProgress(percent);
      });
      abortRef.current = abort;
      return promise;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: fileKeys.lists() });
      toast.success('File uploaded successfully');
      if (mountedRef.current) {
        router.push('/files');
      }
    },
    onSettled: () => {
      abortRef.current = null;
      if (mountedRef.current) setProgress(0);
    },
  });

  return { ...mutation, progress };
}

export function useUpdateFile(id: string) {
  const queryClient = useQueryClient();
  const mountedRef = useMountedRef();
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.();
    };
  }, []);

  const mutation = useMutation({
    mutationFn: (formData: FormData) => {
      const { promise, abort } = updateFile(id, formData, (percent) => {
        if (mountedRef.current) setProgress(percent);
      });
      abortRef.current = abort;
      return promise;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fileKeys.detail(id) }),
        queryClient.invalidateQueries({ queryKey: fileKeys.lists() }),
      ]);
      toast.success('File updated successfully');
    },
    onSettled: () => {
      abortRef.current = null;
      if (mountedRef.current) setProgress(0);
    },
  });

  return { ...mutation, progress };
}

export function useDeleteFile() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mountedRef = useMountedRef();

  return useMutation({
    mutationFn: (id: string) => deleteFile(id),
    onSuccess: async (_data, id) => {
      queryClient.removeQueries({ queryKey: fileKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: fileKeys.lists() });
      toast.success('File deleted successfully');
      if (mountedRef.current) {
        router.push('/files');
      }
    },
  });
}
