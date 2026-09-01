import { useMutation } from '@tanstack/react-query';

import { login } from '../api';
import type { LoginCredentials } from '../schemas';

export function useLogin() {
  return useMutation({
    mutationFn: (credentials: LoginCredentials) => login(credentials),
    onSuccess: () => {
      // Intentional hard redirect to ensure clean state after authentication
      window.location.href = '/';
    },
  });
}
