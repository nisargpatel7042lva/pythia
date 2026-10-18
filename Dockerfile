# PYTHIA resolver service (long-running Node process + HTTP API). Build from the repo root:
#   fly deploy        (uses fly.toml)
FROM node:24-slim

WORKDIR /app

# Workspace manifests first so the dependency layer caches.
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/package.json
COPY frontend/package.json frontend/package.json
COPY packages/eerc-core/package.json packages/eerc-core/package.json
COPY resolver/package.json resolver/package.json

RUN npm ci --workspace=@pythia/resolver --workspace=@pythia/eerc-core --include-workspace-root

COPY packages/eerc-core packages/eerc-core
COPY resolver resolver

RUN npm run build -w @pythia/eerc-core

WORKDIR /app/resolver
ENV NODE_ENV=production
# Persistent state (encrypted pool keystore + SQLite ledger) lives on the mounted volume.
ENV POOL_KEYSTORE_PATH=/data/keystore LEDGER_DB_PATH=/data/ledger.sqlite
CMD ["npx", "tsx", "src/index.ts"]
