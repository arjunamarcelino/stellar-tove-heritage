import { z } from 'zod';

export const stageFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(2000).optional().or(z.literal('')),
  order: z.coerce.number().int().min(1, 'Order must be at least 1'),
  isActive: z.boolean(),
  startsAt: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date' })
    .nullable()
    .optional(),
});

export type StageFormData = z.infer<typeof stageFormSchema>;

export const stageSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  order: z.number(),
  isActive: z.boolean(),
  startsAt: z.string().nullable(),
  createdBy: z.string(),
  updatedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Stage = z.infer<typeof stageSchema>;
