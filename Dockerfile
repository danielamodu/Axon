# Axon dashboard — full product in one container.
# Express API + Vite static UI + Prisma (Postgres via DATABASE_URL).
# Build: docker build -t axon-dashboard .
# Run:   docker run -p 3000:3000 --env-file .env axon-dashboard
FROM node:20-slim

WORKDIR /app

# Install workspace deps first (better layer caching)
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/watcher/package.json packages/watcher/package.json
COPY packages/x402-gateway/package.json packages/x402-gateway/package.json
RUN npm ci

# Copy source and build
COPY . .
# Prisma client (schema lives in packages/watcher; output is shared at /app/node_modules)
RUN npm --workspace=packages/watcher run db:generate
# Static UI -> apps/dashboard/dist/public (served by Express)
RUN npm --workspace=@axon/dashboard run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "--workspace=@axon/dashboard", "run", "start"]
