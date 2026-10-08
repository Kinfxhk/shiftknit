# SPDX-License-Identifier: AGPL-3.0-or-later
# ShiftKnit container image: builds the static site and serves it with a tiny Node
# server (no other runtime dependencies). Publish the port on the host loopback, e.g.
#   docker build -t shiftknit . && docker run --rm -p 127.0.0.1:4883:4883 shiftknit
# then open http://127.0.0.1:4883/

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
# Only the built site, the static server and the licence texts are shipped.
COPY --from=build /app/packages/web/dist ./site
COPY --from=build /app/packages/cli/src/serve.ts ./serve.ts
COPY --from=build /app/LICENSE /app/NOTICE /app/THIRD_PARTY_NOTICES.md ./
# Inside the container the server listens on all interfaces so the port can be
# forwarded; keep the published port on 127.0.0.1 unless you mean to share it.
ENV SHIFTKNIT_DIST=/app/site \
    SHIFTKNIT_HOST=0.0.0.0 \
    SHIFTKNIT_PORT=4883
USER node
EXPOSE 4883
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4883/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "serve.ts"]
