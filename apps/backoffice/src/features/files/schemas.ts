import { z } from 'zod';

export const URL_PATH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_UPLOAD_SIZE = MAX_FILE_SIZE + 1024 * 1024; // 1 MB margin for multipart overhead
export const ACCEPTED_FILE_TYPE = 'application/pdf';

export const fileSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  urlPath: z.string(),
  fileSize: z.number(),
  originalFilename: z.string(),
  isActive: z.boolean(),
  createdBy: z.string(),
  updatedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FileRecord = z.infer<typeof fileSchema>;

export const createFileSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must be at most 255 characters'),
  urlPath: z
    .string()
    .min(3, 'URL path must be at least 3 characters')
    .max(255, 'URL path must be at most 255 characters')
    .regex(URL_PATH_PATTERN, 'Only lowercase letters, numbers, and hyphens'),
});

export type CreateFileData = z.infer<typeof createFileSchema>;

export const updateFileSchema = createFileSchema.extend({ isActive: z.boolean() }).partial();

export type UpdateFileData = z.infer<typeof updateFileSchema>;
