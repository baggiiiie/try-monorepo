# --- Build stage ---
FROM node:22-slim AS build

WORKDIR /app

# Copy root package files for workspace setup
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci

# Copy source code
COPY server/ server/
COPY client/ client/

# Build server and client
RUN npm run build

# --- Production stage ---
FROM node:22-slim AS production

WORKDIR /app

# sharp needs some native libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy root workspace files
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=5s \
  CMD wget -q --spider http://localhost:8787/api/health || exit 1

CMD ["node", "server/dist/index.js"]
