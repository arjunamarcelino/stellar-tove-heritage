import { z } from 'zod';

export const evidenceTypeSchema = z.enum(['file', 'url', 'text']);
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;

export const verificationMethodSchema = z.enum(['manual', 'auto_x_follow', 'auto_instagram_follow']);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

export const verificationConfigSchema = z.object({
  targetUsername: z
    .string()
    .min(1, 'Target username is required')
    .max(64)
    .regex(/^[a-zA-Z0-9._]+$/, 'Only letters, numbers, dots, and underscores'),
});

const baseMissionFields = {
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(2000).optional().or(z.literal('')),
  order: z.coerce.number().int().min(1, 'Order must be at least 1'),
  stageId: z.string().min(1),
  evidenceType: evidenceTypeSchema,
  isActive: z.boolean(),
};

export const missionFormSchema = z.discriminatedUnion('verificationMethod', [
  z.object({
    ...baseMissionFields,
    verificationMethod: z.literal('manual'),
    verificationConfig: z.null().optional(),
  }),
  z.object({
    ...baseMissionFields,
    verificationMethod: z.literal('auto_x_follow'),
    verificationConfig: verificationConfigSchema,
  }),
  z.object({
    ...baseMissionFields,
    verificationMethod: z.literal('auto_instagram_follow'),
    verificationConfig: verificationConfigSchema,
  }),
]);

export type MissionFormData = z.infer<typeof missionFormSchema>;

export const missionUpdateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(2000).optional().or(z.literal('')),
  order: z.coerce.number().int().min(1, 'Order must be at least 1'),
  evidenceType: evidenceTypeSchema,
  verificationMethod: verificationMethodSchema,
  verificationConfig: verificationConfigSchema.nullable().optional(),
  isActive: z.boolean(),
}).partial();

export const missionSchema = z.object({
  id: z.string(),
  stageId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  order: z.number(),
  evidenceType: evidenceTypeSchema,
  verificationMethod: verificationMethodSchema,
  verificationConfig: verificationConfigSchema.nullable(),
  isActive: z.boolean(),
  createdBy: z.string(),
  updatedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Mission = z.infer<typeof missionSchema>;
