import { z } from 'zod';

// Validated once at boot: a missing or malformed variable stops the server with its name.
const schema = z.object({
  DATABASE_URL: z.string().url(),
  // Signs the session JWTs (lib/auth-session.ts); middleware.ts needs the same value.
  AUTH_SECRET: z.string().min(32),
  // The storefront's address, for links in e-mails (never taken from the request's Host).
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  GMAIL_USER: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  // LISTEN for notifications needs a direct or session-mode connection (not a transaction pooler).
  LISTEN_DATABASE_URL: z.string().url().optional(),
  // Web Push: { publicKey, privateKey } as JWK (the Edge Function's format), and the contact.
  VAPID_KEYS: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@kachabity.com'),
  // S3-compatible file storage (AWS S3 in production; SeaweedFS locally). Buckets: products
  // (public), documents. S3 bucket names are global, hence the names can be set.
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_PRODUCTS_BUCKET: z.string().default('products'),
  S3_DOCUMENTS_BUCKET: z.string().default('documents'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Public address of the products bucket, without a trailing slash.
  FILES_PUBLIC_URL: z.string().url().optional(),
  OWNER_EMAILS: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  NEXT_URL: z.string().url().optional(),
  REVALIDATE_SECRET: z.string().min(16).optional(),
  // External systems may read GET /api/stock/inventory with this key in x-api-key.
  STOCK_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  ENV: z.enum(['local', 'production']).default('local'),
  PORT: z.coerce.number().int().default(4000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n  ');
    console.error(`Invalid environment:\n  ${problems}`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
