# Build from the repository root, because the API compiles shared files from lib/:
#   docker build -f api/Dockerfile -t kachabity-api .
FROM node:22-alpine AS build
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY lib /app/lib
# Shared lib/ files import packages (nodemailer…) that live in api/node_modules.
RUN ln -s /app/api/node_modules /app/node_modules
COPY api ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/api/dist ./dist
# Migrations run from this image at deploy time: node scripts/migrate.mjs (baseline for an empty database).
COPY api/scripts ./scripts
COPY supabase/migrations /app/supabase/migrations
COPY db/baseline.sql /app/db/baseline.sql
USER node
EXPOSE 4000
CMD ["node", "dist/api/src/main.js"]
