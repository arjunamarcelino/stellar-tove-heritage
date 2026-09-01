import { z } from 'zod';

import { passwordSchema } from '@/lib/validation';

export const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type User = z.infer<typeof userSchema>;

export const createUserSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: passwordSchema,
  firstName: z.string().max(255).optional().or(z.literal('')),
  lastName: z.string().max(255).optional().or(z.literal('')),
});

export type CreateUserData = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    firstName: z.string().max(255).or(z.literal('')),
    lastName: z.string().max(255).or(z.literal('')),
  })
  .partial();

export type UpdateUserData = z.infer<typeof updateUserSchema>;
