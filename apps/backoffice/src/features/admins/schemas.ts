import { z } from 'zod';

import { adminRoleSchema } from '@/features/auth/schemas';
import { passwordSchema } from '@/lib/validation';

export const adminSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: adminRoleSchema,
  firstName: z.string(),
  lastName: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type Admin = z.infer<typeof adminSchema>;

export const registerAdminSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: passwordSchema,
  firstName: z.string().max(255).optional().or(z.literal('')),
  lastName: z.string().max(255).optional().or(z.literal('')),
  role: adminRoleSchema,
});

export type RegisterAdminData = z.infer<typeof registerAdminSchema>;

export const updateAdminSchema = z
  .object({
    firstName: z.string().max(255).or(z.literal('')),
    lastName: z.string().max(255).or(z.literal('')),
    role: adminRoleSchema,
  })
  .partial();

export type UpdateAdminData = z.infer<typeof updateAdminSchema>;
