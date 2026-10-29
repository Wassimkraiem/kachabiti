# Environment Variables Example

Copy this to `.env.local` for local development, or set it on the server. The Next.js app (web) and the NestJS API (api) read the same file in Docker; `api/.env.example` lists what the API needs.

## Required Variables

```env
# Postgres 17, as the role that owns the tables (api only).
DATABASE_URL=postgresql://kachabity:password@db:5432/kachabity
# Where the web app reaches the API (server side and the /api rewrite).
NEST_URL=http://localhost:4000
# Shared by web and api: the api refreshes the storefront cache (POST /api/internal/revalidate).
REVALIDATE_SECRET=
NEXT_URL=http://localhost:3000

# Gmail SMTP Configuration (for sending emails)
GMAIL_USER=your-email@gmail.com
# Optional: send through another mailbox's SMTP (port 465, TLS), e.g. smtp.hostinger.com for business@kachabiti.com;
# GMAIL_USER / GMAIL_APP_PASSWORD are then that mailbox's address and password
SMTP_HOST=
GMAIL_APP_PASSWORD=your-16-character-app-password

# Signs the session cookies issued by the NestJS auth API (/api/auth/*). The same value on the
# Next.js server (middleware reads the sessions) and on NestJS; at least 32 random characters,
# e.g. node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))".
# Changing it signs everyone out within 15 minutes (their sessions renew with the new key).
AUTH_SECRET=

# File storage (NestJS): AWS S3, or any S3-compatible service. Buckets products (public, served at
# FILES_PUBLIC_URL) and documents (private, signed links); their real names in the two *_BUCKET vars.
# Without keys, NestJS signs with the EC2 instance role (production). The Next.js build also reads
# FILES_PUBLIC_URL to allow those images in next/image.
S3_ENDPOINT=https://s3.<region>.amazonaws.com
S3_REGION=<region>
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PRODUCTS_BUCKET=products
S3_DOCUMENTS_BUCKET=documents
FILES_PUBLIC_URL=https://<products bucket>.s3.<region>.amazonaws.com

# Desktop notifications (NestJS sends Web Push): the same values the send-push Edge Function had.
VAPID_KEYS={"publicKey":{...},"privateKey":{...}}
VAPID_SUBJECT=mailto:you@yourdomain.com
# NestJS LISTENs for new notifications; set this only when DATABASE_URL goes through a
# transaction pooler (PgBouncer), with a direct URL.
LISTEN_DATABASE_URL=
```

## Optional Variables

```env
# Back-office roles that don't depend on the account (comma-separated emails, server only).
# Owners can do everything, are the only ones who manage other owners, and receive owner
# alerts (deletes and unusual actions by admins and staff). Admins can do everything else.
OWNER_EMAILS=you@yourdomain.com
ADMIN_EMAILS=manager@yourdomain.com

# Custom recipient for contact forms (defaults to GMAIL_USER)
CONTACT_TO_EMAIL=business@yourdomain.com

# Site Configuration
NEXT_PUBLIC_SITE_URL=https://yourdomain.com

# Optional external stock API key. Send it as the `x-api-key` request header
# when calling GET /api/stock/inventory. Keep this value secret.
STOCK_API_KEY=replace-with-a-long-random-key

# Colissimo delivery (Admin → Delivery). Both tokens come from the Colissimo sender
# account, Paramètres → APIs. Server-only: keep them secret.
COLISSIMO_ADD_TOKEN=your-colissimo-add-token
COLISSIMO_TRACKING_TOKEN=your-colissimo-tracking-token
# Owner → Colissimo account: your colissimodelivery.tn website login, used read-only to list every parcel
# of the account and its history (the API can't); optional, the page says when it's missing
COLISSIMO_PORTAL_USER=
COLISSIMO_PORTAL_PASSWORD=

NEXT_PUBLIC_PHONE=+216 55 558 648
NEXT_PUBLIC_ADRESS=Your Address
NEXT_PUBLIC_LOCATION=Your Location

# Social Media Links
NEXT_PUBLIC_FACEBOOK_URL=https://www.facebook.com/profile.php?id=61562718525332
NEXT_PUBLIC_INSTAGRAM_URL=https://www.instagram.com/kachabitii/
NEXT_PUBLIC_TIKTOK_URL=https://www.tiktok.com/@kachabitii

# Currency & Shipping
NEXT_PUBLIC_FREE_SHIPPING_THRESHOLD=100
NEXT_PUBLIC_DEFAULT_SHIPPING_COST=7
NEXT_PUBLIC_CURRENCY=TND
NEXT_PUBLIC_WALLET_NAME=Your Wallet Name

# Deployment environment: "local" on developer machines, "production" on Netlify.
# Read in code through lib/app-env.ts; also used as the Sentry environment.
ENV=local

# Sentry error monitoring (settings per ENV in lib/sentry-options.ts; `next dev` never reports).
# Projects: kachabiti-front-end-prod, kachabiti-backend-prod, kachabiti-local.
# The local project is shared by browser and backend. Production uses one project per runtime.
NEXT_PUBLIC_SENTRY_DSN_LOCAL=https://<local-key>@<org>.ingest.sentry.io/<local-project-id>
NEXT_PUBLIC_SENTRY_DSN_FRONTEND_PRODUCTION=https://<frontend-key>@<org>.ingest.sentry.io/<frontend-project-id>
NEXT_PUBLIC_SENTRY_DSN_BACKEND_PRODUCTION=https://<backend-key>@<org>.ingest.sentry.io/<backend-project-id>
# Optional legacy fallback for existing deployments:
# NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project-id>
# Build-time only, for readable stack traces (source map upload). Set on Netlify.
# Token: Sentry → Settings → Auth Tokens (Organization token). Server-only, keep secret.
SENTRY_AUTH_TOKEN=sntrys_...
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug

# Messenger / Instagram / WhatsApp (NestJS only; optional, the CRM works by hand without them)
META_APP_SECRET=
META_VERIFY_TOKEN=
META_PAGE_ACCESS_TOKEN=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
# Support bot (docs/SUPPORT-BOT.md). META_APP_ID tells our own replies apart from Business Suite's.
META_APP_ID=
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
# Optional: the bot's knowledge base is also searched by meaning (Voyage AI embeddings); without it, by words only
VOYAGE_API_KEY=pa-...
# Optional: Langfuse traces of every bot turn (customer details are masked before sending).
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

## How to Get Gmail App Password

See `GMAIL-SMTP-SETUP.md` for detailed instructions.
