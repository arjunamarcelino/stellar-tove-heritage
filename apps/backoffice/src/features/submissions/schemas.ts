import { z } from 'zod';

export const submissionStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

export const submissionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  missionId: z.string(),
  status: submissionStatusSchema,
  fileUrl: z.string().nullable(),
  linkUrl: z.string().nullable(),
  textContent: z.string().nullable(),
  adminNotes: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Submission = z.infer<typeof submissionSchema>;

export const reviewFormSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  adminNotes: z
    .string()
    .max(2000)
    .refine((val) => !/<[^>]*>/.test(val), 'HTML is not allowed')
    .optional()
    .or(z.literal('')),
});

export type ReviewFormData = z.infer<typeof reviewFormSchema>;
