import { registerAs } from '@nestjs/config';

export const supabaseConfig = registerAs('supabase', () => ({
  url: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'files',
}));

export type SupabaseConfig = ReturnType<typeof supabaseConfig>;
