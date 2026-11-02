import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  async rewrites() {
    // The API is the NestJS app in api/ (NEST_URL). afterFiles: app/api/internal/revalidate, the
    // one route left in Next.js, is matched first.
    return {
      beforeFiles: [],
      afterFiles: [{ source: "/api/:path*", destination: `${process.env.NEST_URL}/api/:path*` }],
      fallback: [],
    };
  },
  // ENV ("local" or "production") as seen by browser, server and edge code; read it via lib/app-env.ts.
  env: {
    NEXT_PUBLIC_APP_ENV: process.env.ENV || "local",
  },
  experimental: {
    // Keep visited pages in the client router cache so back/forward and revisits are instant.
    staleTimes: { dynamic: 30, static: 180 },
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // ⚠️ Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      // Uploaded files (Cloudflare R2; local storage in Docker): FILES_PUBLIC_URL, read at build.
      ...(process.env.FILES_PUBLIC_URL
        ? [(({ protocol, hostname, port, pathname }: URL) => ({
            protocol: protocol.replace(':', '') as 'http' | 'https',
            hostname,
            port,
            pathname: `${pathname.replace(/\/$/, '')}/**`,
          }))(new URL(process.env.FILES_PUBLIC_URL))]
        : []),
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'via.placeholder.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

// Sentry: build-time setup and source map upload. Uploads only run when
// SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set (on Netlify); without
// them the build works as before and stack traces show minified code.
export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "kachabiti",

  project: process.env.SENTRY_PROJECT || "kachabiti-web",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
