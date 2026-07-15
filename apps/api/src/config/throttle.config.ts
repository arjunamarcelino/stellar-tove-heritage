import { registerAs } from '@nestjs/config';

export const throttleConfig = registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
}));

export type ThrottleConfig = ReturnType<typeof throttleConfig>;
