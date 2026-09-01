import { z } from 'zod';

export const loginCredentialsSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginCredentials = z.infer<typeof loginCredentialsSchema>;

export const adminRoleSchema = z.enum(['admin', 'superadmin']);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: adminRoleSchema,
  firstName: z.string(),
  lastName: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type AuthUser = z.infer<typeof authUserSchema>;

export const backendTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

export type BackendTokenResponse = z.infer<typeof backendTokenResponseSchema>;

export const loginResponseSchema = z.object({
  success: z.literal(true),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;
