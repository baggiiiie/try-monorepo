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

# --- Build libheif from source (Debian's version is too old for spatial photos) ---
FROM debian:bookworm-slim AS heif-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake pkg-config git ca-certificates \
    libde265-dev libx265-dev libjpeg-dev libpng-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch v1.19.7 https://github.com/strukturag/libheif.git /tmp/libheif \
    && cd /tmp/libheif && mkdir build && cd build \
    && cmake .. -DCMAKE_INSTALL_PREFIX=/usr/local -DWITH_EXAMPLES=ON -DCMAKE_BUILD_TYPE=Release \
    && make -j$(nproc) && make install

# --- Production stage ---
FROM node:22-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    libde265-0 libx265-199 libjpeg62-turbo libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=heif-build /usr/local/bin/heif-convert /usr/local/bin/
COPY --from=heif-build /usr/local/lib/libheif* /usr/local/lib/
RUN ldconfig

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
