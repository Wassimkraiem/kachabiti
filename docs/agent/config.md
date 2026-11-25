# Configuration, env, fonts, images, Sentry

Moved verbatim from CLAUDE.md so it loads only when needed. Keep it accurate when you change this area.

## Configuration notes

- The env var names are listed in `ENV-EXAMPLE.md`. `ADMIN_EMAILS` and `SUPABASE_SERVICE_ROLE_KEY` are server-only. `AUTH_SECRET` (signs sessions) must be the same on the Next.js server and NestJS.
- `ENV` is the deployment environment: `local` on developer machines, `production` on the server. `next.config.ts` passes it to all code as `NEXT_PUBLIC_APP_ENV`; read it through `APP_ENV` / `isProduction` / `isLocal` in `lib/app-env.ts` rather than `NODE_ENV`, which is `production` for any build, including local ones.
- Fonts are self-hosted with `next/font/local` (`app/fonts/*.woff2`: Inter and Handlee Latin subsets, Reem Kufi Arabic + Latin, variable weights) and wired in `app/layout.tsx` and `lib/fonts.ts`. Don't switch back to `next/font/google`: Turbopack fails the build when the Google Fonts download is slow or offline.
- `next.config.ts` whitelists remote image hosts, including the file storage at `FILES_PUBLIC_URL` (read at build time). Add any new image source there.
- **Error monitoring (Sentry, `@sentry/nextjs` v11).** Init files: `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, loaded by `instrumentation.ts` (which also reports request errors); shared options and the PII scrubber are in `lib/sentry-options.ts`. It only reports from production builds (never `next dev`) with `NEXT_PUBLIC_SENTRY_DSN` set, and its environment tag and sample rates follow `ENV`. Thrown errors are captured automatically; where an error is caught and turned into a response or fallback, call `reportError(error, area)` from `lib/report-error.ts`, and never pass customer details. Browser events go through the `/monitoring` tunnel, which the middleware matcher excludes. In v11, `withSentryConfig` is imported from `@sentry/nextjs/config`.
- The many top-level `*.md` files are historical setup and fix notes. Treat them as background, not as the current source of truth.
