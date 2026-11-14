# syntax=docker/dockerfile:1.8

# One image runs the whole instance: nginx, the API, the Next.js server, coturn
# and the Stellarr Media server, supervised by supervisord. It builds for
# linux/amd64 and linux/arm64.
#
# Stages that produce architecture-neutral output (the operator panel and the
# portable API publish) run on the build machine's own platform, so a
# multi-platform build does not emulate them. The media stage runs there too and
# cross-compiles for the target, because compiling Rust under emulation would
# not fit in the release job. The web stage runs per target platform because
# the standalone server bundles native image-processing binaries.

# The web client and the operator panel are workspaces of one npm project: the
# root package-lock.json covers both and the shared packages/. Each stage copies
# every workspace manifest, because npm ci checks the lockfile against all of
# them, but installs only its own workspace, which links the shared package it
# depends on. The manifests come before the sources, so that editing a source
# file keeps the install layer cached. With the dependencies hoisted to
# /src/node_modules, Next.js traces from /src and the standalone output nests
# the app as web/server.js.
FROM node:26-bookworm-slim AS web-build
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY cockpit/package.json cockpit/
COPY packages/stellarr-ui/package.json packages/stellarr-ui/
RUN npm ci --workspace stellarr-web
COPY packages/ packages/
COPY web/ web/
WORKDIR /src/web
ARG NEXT_PUBLIC_GIPHY_API_KEY
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_GIPHY_API_KEY=${NEXT_PUBLIC_GIPHY_API_KEY}
RUN npm run build

FROM --platform=$BUILDPLATFORM node:26-bookworm-slim AS cockpit-build
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY cockpit/package.json cockpit/
COPY packages/stellarr-ui/package.json packages/stellarr-ui/
RUN npm ci --workspace stellarr-cockpit
COPY packages/ packages/
COPY cockpit/ cockpit/
WORKDIR /src/cockpit
RUN npm run build

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-noble AS api-build
ARG VERSION=2.0.0
WORKDIR /src
COPY global.json Directory.Build.props Stellarr.slnx ./
COPY server/Stellarr.Api/Stellarr.Api.csproj server/Stellarr.Api/packages.lock.json server/Stellarr.Api/
COPY server/Stellarr.Cli/Stellarr.Cli.csproj server/Stellarr.Cli/packages.lock.json server/Stellarr.Cli/
RUN dotnet restore server/Stellarr.Cli/Stellarr.Cli.csproj --locked-mode \
    && dotnet restore server/Stellarr.Api/Stellarr.Api.csproj --locked-mode
COPY server/Stellarr.Api/ server/Stellarr.Api/
COPY server/Stellarr.Cli/ server/Stellarr.Cli/
RUN dotnet publish server/Stellarr.Api/Stellarr.Api.csproj \
    -c Release -o /out/api --no-restore -p:UseAppHost=false -p:Version=${VERSION}
RUN dotnet publish server/Stellarr.Cli/Stellarr.Cli.csproj \
    -c Release -o /out/cli --no-restore -p:UseAppHost=false -p:Version=${VERSION}

# The media crate with every Rust file replaced by an empty stub. It changes
# only when the manifest, the lockfile or the set of files changes, so the
# dependencies compiled from it stay cached across source edits. Stubbing every
# file, not only src/main.rs, keeps targets that Cargo.toml names explicitly
# (a [[test]] with harness = false, say) from failing the manifest check.
FROM --platform=$BUILDPLATFORM rust:1-slim-bookworm AS media-skeleton
WORKDIR /src/media
COPY media/ ./
RUN <<'EOF'
set -eu
mkdir -p /skeleton
cp Cargo.toml Cargo.lock /skeleton/
if [ -d .cargo ]; then cp -R .cargo /skeleton/; fi
find . -name '*.rs' -type f | while read -r file; do
  mkdir -p "/skeleton/$(dirname "$file")"
  echo 'pub fn main() {}' > "/skeleton/$file"
done
EOF

# aws-lc-rs, the crypto backend of str0m, compiles C, so a cross build needs the
# target's C compiler and C library as well as the Rust target. Bookworm's
# glibc 2.36 is older than the 2.39 of the final image, so every symbol the
# binary links against is there at run time.
FROM --platform=$BUILDPLATFORM rust:1-slim-bookworm AS media-build
ARG BUILDARCH
ARG TARGETARCH
# RUSTUP_TOOLCHAIN pins the image's own toolchain even if the crate later adds
# a rust-toolchain.toml: the cross target below is installed for this one only.
ENV RUSTUP_TOOLCHAIN=${RUST_VERSION} \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc \
    CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
    AR_x86_64_unknown_linux_gnu=x86_64-linux-gnu-ar \
    AR_aarch64_unknown_linux_gnu=aarch64-linux-gnu-ar
RUN <<'EOF'
set -eu
case "$TARGETARCH" in
  amd64) arch=x86_64 cross_gcc=gcc-x86-64-linux-gnu ;;
  arm64) arch=aarch64 cross_gcc=gcc-aarch64-linux-gnu ;;
  *) echo "Stellarr Media builds for amd64 and arm64, not $TARGETARCH." >&2; exit 1 ;;
esac
# A native build already has gcc and libc6-dev in this image.
if [ "$BUILDARCH" != "$TARGETARCH" ]; then
  apt-get update
  apt-get install -y --no-install-recommends "$cross_gcc" "libc6-dev-$TARGETARCH-cross"
  rm -rf /var/lib/apt/lists/*
fi
rustup target add "$arch-unknown-linux-gnu"
echo "$arch-unknown-linux-gnu" > /etc/rust-target
EOF
WORKDIR /src/media
COPY --from=media-skeleton /skeleton/ ./
# The stub's own artifacts are removed in the same layer. The real sources keep
# the modification times of the checkout, older than these artifacts, so cargo
# would otherwise take the stub binary for up to date and ship it.
RUN cargo build --release --locked --target "$(cat /etc/rust-target)" \
    && cargo clean --release --locked --target "$(cat /etc/rust-target)" --package stellarr-media
COPY media/ ./
RUN cargo build --release --locked --target "$(cat /etc/rust-target)" \
    && install -D "target/$(cat /etc/rust-target)/release/stellarr-media" /out/stellarr-media

FROM node:26-bookworm-slim AS node-runtime

# Target of docker-compose.dev.yml: the SDK with the source bind-mounted.
FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS api-dev
WORKDIR /src/server/Stellarr.Api

# Target of docker-compose.dev.yml: the Rust toolchain and a file watcher that
# rebuilds and restarts the bind-mounted media crate. The dev stack mounts its
# own volume over the registry, so the copy left by the install is dropped.
FROM rust:1-slim-bookworm AS media-dev
RUN cargo install --locked watchexec-cli@2.8.0 \
    && rm -rf "$CARGO_HOME/registry"
WORKDIR /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble AS final

# libatomic1: the Node binary copied below links against it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates coturn curl libatomic1 nginx openssl supervisor \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

COPY infra/nginx.conf /etc/nginx/nginx.conf.template
COPY infra/turnserver.conf.template /etc/turnserver.conf.template
COPY infra/supervisord.conf /etc/supervisor/supervisord.conf
COPY --chmod=0755 infra/entrypoint.sh /usr/local/bin/stellarr-entrypoint
COPY --chmod=0755 infra/tls-maintenance.sh /usr/local/bin/stellarr-tls-maintenance
COPY --chmod=0755 infra/stellarr-cli.sh /usr/local/bin/stellarr

COPY --from=cockpit-build /src/cockpit/dist /srv/cockpit
COPY --from=api-build /out/api /opt/stellarr/api
COPY --from=api-build /out/cli /opt/stellarr/cli
# The standalone output holds node_modules beside web/server.js, so the app sits
# one level below /opt/stellarr/web, and the static files and public/ go beside
# that server.js.
COPY --from=web-build /src/web/.next/standalone /opt/stellarr/web
COPY --from=web-build /src/web/.next/static /opt/stellarr/web/web/.next/static
COPY --from=web-build /src/web/public /opt/stellarr/web/web/public
COPY --from=media-build /out/stellarr-media /opt/stellarr/media/stellarr-media

ENV STELLARR_DATA_ROOT=/data/stellarr
# 49000/udp is the single UDP port of Stellarr Media and carries every call.
# The media server's control API (5200/tcp) listens on loopback and is not
# exposed.
EXPOSE 80 443 3478/tcp 3478/udp 5349/tcp 5349/udp 49000/udp 49160-49200/udp
VOLUME ["/data/stellarr"]

# Healthy means both the API and the web client answer: either can fail on its own.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -kfsS -o /dev/null https://127.0.0.1/health && curl -kfsS -o /dev/null https://127.0.0.1/login || exit 1

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Stellarr" \
      org.opencontainers.image.description="Self-hosted text and voice chat for small groups" \
      org.opencontainers.image.source="https://github.com/Arkazzae/stellarr" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENTRYPOINT ["/usr/local/bin/stellarr-entrypoint"]
