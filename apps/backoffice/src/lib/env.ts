import 'server-only';

import { z } from 'zod';

const envSchema = z.object({
  BACKEND_API_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse({
      BACKEND_API_URL: process.env.BACKEND_API_URL,
      NODE_ENV: process.env.NODE_ENV,
    });
  }
  return _env;
}
