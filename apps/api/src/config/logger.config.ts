import { registerAs } from '@nestjs/config';

export const loggerConfig = registerAs('logger', () => ({
  level: process.env.LOG_LEVEL
    ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  prettyPrint: process.env.NODE_ENV === 'development' && canRequire('pino-pretty'),
}));

function canRequire(mod: string): boolean {
  try { require.resolve(mod); return true; } catch { return false; }
}
