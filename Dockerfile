# The Next.js app (storefront + admin) for the local Docker setup (docs/DOCKER.md).
# Built by docker-compose.yml, which mounts .env.docker as .env.production for the build only:
# NEXT_PUBLIC_* values and the NEST_ROUTES rewrites are fixed at build time.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN --mount=type=secret,id=env,target=/app/.env.production npm run build
# next start writes its data cache under .next/cache
RUN chown -R node:node /app/.next
ENV NODE_ENV=production \
    NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
