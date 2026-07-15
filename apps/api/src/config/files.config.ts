import { registerAs } from '@nestjs/config';

export const filesConfig = registerAs('files', () => ({
  signedUrlTtl: parseInt(process.env.FILES_SIGNED_URL_TTL ?? '3600', 10),
}));

export type FilesConfig = ReturnType<typeof filesConfig>;
