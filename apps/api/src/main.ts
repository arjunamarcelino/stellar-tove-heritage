// Load .env into process.env before anything else, so the api-prefix constants
// (evaluated at module-import time, before ConfigModule runs) honor .env overrides.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Type } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import type { Application } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { appConfig } from '@config/app.config';
import { PUBLIC_MODULES } from '@modules/public-api.module';
import { BACKOFFICE_MODULES } from '@modules/backoffice/backoffice.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const appCfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);

  // Trust N reverse-proxy hops so ThrottlerGuard resolves the real client IP
  // (rate limiting anonymous traffic) instead of the proxy IP. A fixed hop count,
  // never `true`, so X-Forwarded-For can't be spoofed past the trusted hops.
  const expressApp = app.getHttpAdapter().getInstance() as Application;
  expressApp.set('trust proxy', appCfg.trustProxyHops);

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    }),
  );

  // Cookie parser for refresh tokens
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: appCfg.corsOrigin.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Route prefixes are applied per-area via RouterModule (see PublicApiModule /
  // BackofficeModule): public routes under `api/v1`, backoffice under
  // `api/backoffice/v1`. No global prefix.

  // Validation — NO enableImplicitConversion
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Two independent OpenAPI specs: one per API surface. Each is filtered to the
  // same module list that RouterModule prefixes, so paths render with the
  // correct prefix (`api/v1/...` vs `api/backoffice/v1/...`).
  const buildDoc = (title: string, description: string, include: Type<unknown>[]) =>
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(title)
        .setDescription(description)
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
      { include },
    );

  const publicDocument = buildDoc(
    'Tove Public API',
    'Tove RWA Tokenization Platform — Public API',
    [...PUBLIC_MODULES],
  );
  const backofficeDocument = buildDoc(
    'Tove Backoffice API',
    'Tove RWA Tokenization Platform — Backoffice API',
    [...BACKOFFICE_MODULES],
  );

  if (appCfg.nodeEnv === 'development') {
    // Swagger UI (development only)
    SwaggerModule.setup('docs/public', app, () => publicDocument);
    SwaggerModule.setup('docs/backoffice', app, () => backofficeDocument);
  } else {
    // Non-development: serve only the PUBLIC spec JSON (no Swagger UI). The
    // backoffice spec maps the privileged admin surface and is intentionally
    // NOT exposed outside development.
    const httpAdapter = app.getHttpAdapter();
    httpAdapter.get(`/${appCfg.apiPrefix}/docs/json`, (_req: unknown, res: { json: (body: unknown) => void }) => {
      res.json(publicDocument);
    });
  }

  await app.listen(appCfg.port);
}

void bootstrap();
