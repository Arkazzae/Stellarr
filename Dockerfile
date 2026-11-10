# syntax=docker/dockerfile:1.8

# One image runs the whole instance: nginx, the API, the Next.js server, RustFS
# object storage and coturn, supervised by supervisord. It builds for
# linux/amd64 and linux/arm64.
#
# Stages that produce architecture-neutral output (the operator panel and the
# portable API publish) run on the build machine's own platform, so a
# multi-platform build does not emulate them. The web stage runs per target
# platform because the standalone server bundles native image-processing
# binaries.

FROM node:26-bookworm-slim AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ARG NEXT_PUBLIC_GIPHY_API_KEY
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_GIPHY_API_KEY=${NEXT_PUBLIC_GIPHY_API_KEY}
RUN npm run build

FROM --platform=$BUILDPLATFORM node:26-bookworm-slim AS ops-build
WORKDIR /src/ops
COPY ops/package.json ops/package-lock.json ./
RUN npm ci
COPY ops/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-noble AS api-build
WORKDIR /src
COPY global.json Directory.Build.props Stellarr.slnx ./
COPY server/Stellarr.Api/Stellarr.Api.csproj server/Stellarr.Api/packages.lock.json server/Stellarr.Api/
RUN dotnet restore server/Stellarr.Api/Stellarr.Api.csproj --locked-mode
COPY server/Stellarr.Api/ server/Stellarr.Api/
RUN dotnet publish server/Stellarr.Api/Stellarr.Api.csproj \
    -c Release -o /out/api --no-restore -p:UseAppHost=false

FROM rustfs/rustfs:1.0.0-beta.11-preview.1 AS rustfs-bin
FROM node:26-bookworm-slim AS node-runtime

# Target of docker-compose.dev.yml: the SDK with the source bind-mounted.
FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS api-dev
WORKDIR /src/server/Stellarr.Api

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble AS final

# musl: the RustFS binary comes from an Alpine-based image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates coturn curl musl nginx openssl supervisor \
    && rm -rf /var/lib/apt/lists/*

COPY --from=rustfs-bin /usr/bin/rustfs /usr/bin/rustfs
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

COPY infra/nginx.conf /etc/nginx/nginx.conf.template
COPY infra/turnserver.conf.template /etc/turnserver.conf.template
COPY infra/supervisord.conf /etc/supervisor/supervisord.conf
COPY --chmod=0755 infra/entrypoint.sh /usr/local/bin/stellarr-entrypoint
COPY --chmod=0755 infra/tls-maintenance.sh /usr/local/bin/stellarr-tls-maintenance

COPY --from=ops-build /src/ops/dist /srv/ops
COPY --from=api-build /out/api /opt/stellarr/api
COPY --from=web-build /src/web/.next/standalone /opt/stellarr/web
COPY --from=web-build /src/web/.next/static /opt/stellarr/web/.next/static
COPY --from=web-build /src/web/public /opt/stellarr/web/public

ENV STELLARR_DATA_ROOT=/data/stellarr
# 49000/udp is reserved for a future media server; nothing listens on it yet.
EXPOSE 80 443 3478/tcp 3478/udp 5349/tcp 5349/udp 49000/udp 49160-49200/udp
VOLUME ["/data/stellarr"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -kfsS https://127.0.0.1/health >/dev/null || exit 1

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Stellarr" \
      org.opencontainers.image.description="Self-hosted text and voice chat for small groups" \
      org.opencontainers.image.source="https://github.com/Arkazzae/stellarr" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENTRYPOINT ["/usr/local/bin/stellarr-entrypoint"]
