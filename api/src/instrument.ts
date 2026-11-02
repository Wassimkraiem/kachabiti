import * as Sentry from '@sentry/nestjs';
import { config } from './config';

// Loaded first by main.ts. Reports only when SENTRY_DSN is set (production).
if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.ENV,
    tracesSampleRate: 0.1,
  });
}
