# syntax=docker/dockerfile:1.8

# One image runs the whole instance: nginx, the API, coturn and the Stellarr
# Media server, supervised by Stellarr Init (init/), which runs as PID 1. nginx
# also serves the web client and the operator panel, Cockpit, under /cockpit,
# both built as static files. It builds for linux/amd64 and linux/arm64.
#
# Stages whose output is architecture-neutral (the web build and the portable
# API publish) run on the build machine's own platform, so a multi-platform
# build does not emulate them. The two Rust stages run there too and
# cross-compile for the target, because compiling Rust under emulation would
# not fit in the release job.

# The recipes of artifacts/recipes/ build some of the files the browser loads
# from source. Each has a stage, or a few, that fetch its pinned inputs and
# run its build file, and a FROM scratch stage, recipe-<name>, that holds only
# its outputs; web-build copies those into the recipe's out/ folder before the
# build checks them against artifacts/manifest.json. `docker buildx bake
# recipes` (docker-bake.hcl) builds the same stages into
# artifacts/recipes/<name>/out/ for development and for CI's recipes job,
# which hands them to the image job in place of these stages.
#
# A recipe's stages hold every pin of that recipe: a toolchain image or base
# image by the digest of its multi-platform index, each source by commit, and
# each other download by its sha256. Fetching is done in steps of its own;
# the compile runs with --network=none, so it can only use what was pinned.
# The manifest records one sha256 per output, so the bytes must not depend on
# the machine: by default the stages run on the build machine's platform,
# and RECIPE_PLATFORM moves them to another one to prove that, as
# `docker buildx bake recipes --set '*.args.RECIPE_PLATFORM=linux/amd64'`.
# A recipe whose toolchain is a different build on each host pins its stages
# to linux/amd64 instead, and says so beside them.
ARG RECIPE_PLATFORM=$BUILDPLATFORM

# SpeexDSP's preprocessor, the Speex noise suppressor (artifacts/recipes/speex/).
FROM --platform=$RECIPE_PLATFORM ghcr.io/webassembly/wasi-sdk:wasi-sdk-33@sha256:f4d3519a6d4b36e8fd541019e13cb8d232980d9586e2b185f872ab97ea15bcfd AS recipe-speex-build
ADD https://github.com/xiph/speexdsp.git#7a158783df74efe7c2d1c6ee8363c1e695c71226 /src/speexdsp
COPY artifacts/recipes/speex/ /src/recipe/
RUN --network=none sh /src/recipe/build.sh /src/speexdsp /out

# On RECIPE_PLATFORM like the build, not on the target: web-build, which
# copies from it, then stays one stage for every platform of the image.
FROM --platform=$RECIPE_PLATFORM scratch AS recipe-speex
COPY --from=recipe-speex-build /out/ /

# The Bergamot translation engine, Mozilla's Marian for the web, with its
# Emscripten glue (artifacts/recipes/bergamot/). Pinned to linux/amd64, not
# RECIPE_PLATFORM: emsdk's Emscripten 3.1.8 for amd64 is clang 15.0.0 from
# llvm-project 80ec0ebf with wasm-opt version_106-10-g22d24fda9, for arm64
# llvm-project 3b983359 with version_106-26-ge6a62de43, and the two give
# different WASM from the same sources. The amd64 one gives Mozilla's bytes.
# The toolchain and the sources are not ADDed here: toolchain.sh and
# sources.sh name each download and commit and check them, the first a
# Debian snapshot and two archives by sha256, the second the commits of
# mozilla/translations and the four submodules the build compiles, which keep
# their .git because the build reads their revision.
FROM --platform=linux/amd64 debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS recipe-bergamot-build
COPY artifacts/recipes/bergamot/toolchain.sh /src/recipe/
RUN sh /src/recipe/toolchain.sh
COPY artifacts/recipes/bergamot/sources.sh /src/recipe/
RUN sh /src/recipe/sources.sh
COPY artifacts/recipes/bergamot/build.sh /src/recipe/
RUN --network=none sh /src/recipe/build.sh /out

FROM --platform=linux/amd64 scratch AS recipe-bergamot
COPY --from=recipe-bergamot-build /out/ /

# Xiph's RNNoise with its model, the RNNoise noise suppressor
# (artifacts/recipes/rnnoise/). The model is not in the repository: the
# commit's model_version names the archive by its sha256, and its
# download_model.sh fetches it from media.xiph.org, which this pins instead.
FROM --platform=$RECIPE_PLATFORM ghcr.io/webassembly/wasi-sdk:wasi-sdk-33@sha256:f4d3519a6d4b36e8fd541019e13cb8d232980d9586e2b185f872ab97ea15bcfd AS recipe-rnnoise-build
ADD https://github.com/xiph/rnnoise.git#70f1d256acd4b34a572f999a05c87bf00b67730d /src/rnnoise
ADD --checksum=sha256:0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37 \
    https://media.xiph.org/rnnoise/models/rnnoise_data-0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37.tar.gz \
    /src/rnnoise_data.tar.gz
COPY artifacts/recipes/rnnoise/ /src/recipe/
RUN --network=none sh /src/recipe/build.sh /src/rnnoise /src/rnnoise_data.tar.gz /out

FROM --platform=$RECIPE_PLATFORM scratch AS recipe-rnnoise
COPY --from=recipe-rnnoise-build /out/ /

# GTCRN's model and its 48 kHz front-end, the GTCRN noise suppressor
# (artifacts/recipes/gtcrn/). Three steps, each a stage:
#
# - tools: Python with the locked packages and the C++ packages onnx2c needs.
#   The packages are fetched here and nowhere else. Debian's come from
#   snapshot.debian.org at the date this image's own sources name, so the
#   same list gives the same versions; Python's from artifacts/recipes/gtcrn/
#   requirements.txt, which pip installs only when every hash matches.
# - generate: the model's C, from upstream's ONNX file, with no network.
# - build: the compile, in the wasi-sdk image, with no network.
#
# The sources of generate are three repositories at a commit each: the model
# (Xiaobin-Rong/gtcrn), the tool that turns it into C (kraiskil/onnx2c, with
# its submodules, which the commit names) and the script that prepares the
# graph for the tool (sapphi-red/gtcrn-wasm at its 0.0.3 commit, which also
# holds the hand-written GRU the build compiles). The FFT, pffft, is fetched
# by the build stage.
FROM --platform=$RECIPE_PLATFORM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS recipe-gtcrn-tools
# The image's own sources name the snapshots its package lists were cut from,
# both of 2026-11-04 21:23:39 UTC; these are the same, over http because the
# image has no certificates yet, and apt checks the signatures.
RUN printf '%s\n' \
      'Types: deb' \
      'URIs: http://snapshot.debian.org/archive/debian/20261104T212339Z' \
      'Suites: bookworm bookworm-updates' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      '' \
      'Types: deb' \
      'URIs: http://snapshot.debian.org/archive/debian-security/20261104T212339Z' \
      'Suites: bookworm-security' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      > /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::Check-Valid-Until=false update \
 && apt-get install -y --no-install-recommends cmake g++ git make libprotobuf-dev protobuf-compiler \
 && rm -rf /var/lib/apt/lists/*
COPY artifacts/recipes/gtcrn/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /tmp/requirements.txt

FROM --platform=$RECIPE_PLATFORM recipe-gtcrn-tools AS recipe-gtcrn-generate
ADD https://github.com/Xiaobin-Rong/gtcrn.git#502ebfab64da7c4a9af78dcb9c6ceef1ebb01c73 /src/gtcrn
ADD https://github.com/kraiskil/onnx2c.git#1154edbefb891129948bd494188109d68da9d5d7 /src/onnx2c
ADD https://github.com/sapphi-red/gtcrn-wasm.git#24662ff13f184b96edf91f1568e186341a8ac988 /src/gtcrn-wasm
COPY artifacts/recipes/gtcrn/generate.sh /src/recipe/generate.sh
RUN --network=none sh /src/recipe/generate.sh /src/gtcrn /src/onnx2c /src/gtcrn-wasm /out

# Only the generated C, so that the compile stage copies nothing else of the
# generation's image, and so that `--target recipe-gtcrn-c` shows it.
FROM --platform=$RECIPE_PLATFORM scratch AS recipe-gtcrn-c
COPY --from=recipe-gtcrn-generate /out/ /

FROM --platform=$RECIPE_PLATFORM ghcr.io/webassembly/wasi-sdk:wasi-sdk-33@sha256:f4d3519a6d4b36e8fd541019e13cb8d232980d9586e2b185f872ab97ea15bcfd AS recipe-gtcrn-build
# v1.3.0, the release of 2026-11-10: it has a WebAssembly SIMD path.
ADD https://github.com/marton78/pffft.git#179a48d486cbee8ec5416e5c163ad575c2efe1f1 /src/pffft
ADD https://github.com/sapphi-red/gtcrn-wasm.git#24662ff13f184b96edf91f1568e186341a8ac988 /src/gtcrn-wasm
COPY --from=recipe-gtcrn-c / /src/generated/
COPY artifacts/recipes/gtcrn/ /src/recipe/
RUN --network=none sh /src/recipe/build.sh /src/pffft /src/gtcrn-wasm /src/generated /out

FROM --platform=$RECIPE_PLATFORM scratch AS recipe-gtcrn
COPY --from=recipe-gtcrn-build /out/ /

# web/ holds both apps, the web client and Cockpit (web/src/cockpit/). It is a
# workspace of one npm project with the shared packages/: the root
# package-lock.json covers all of them. The stage copies every workspace
# manifest, because npm ci checks the lockfile against all of them, but
# installs only web/, which links the shared packages it depends on. The
# manifests come before the sources, so that editing a source file keeps the
# install layer cached.
FROM --platform=$BUILDPLATFORM node:26-bookworm-slim AS web-build
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY packages/stellarr-icons/package.json packages/stellarr-icons/
COPY packages/stellarr-router/package.json packages/stellarr-router/
COPY packages/stellarr-ui/package.json packages/stellarr-ui/
RUN npm ci --workspace stellarr-web
COPY packages/ packages/
# The prebuild hook copies the browser's binaries from artifacts/ into public/
# and fails the build on any that differ from artifacts/manifest.json: the
# committed ones, and those the recipes build, each into its out/ folder.
COPY artifacts/ artifacts/
COPY --from=recipe-speex / artifacts/recipes/speex/out/
COPY --from=recipe-bergamot / artifacts/recipes/bergamot/out/
COPY --from=recipe-rnnoise / artifacts/recipes/rnnoise/out/
COPY --from=recipe-gtcrn / artifacts/recipes/gtcrn/out/
COPY web/ web/
WORKDIR /src/web
# The build writes both apps to dist/. nginx sends the .gz file beside the
# original to a browser that accepts gzip, so the text formats and the WASM are
# compressed here once, at the highest level, instead of on every request. -n
# leaves the name and time out of each archive, so the same input gives the
# same file.
RUN npm run build \
    && find dist -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.json' \
         -o -name '*.svg' -o -name '*.wasm' \) -exec gzip -9 -k -n {} +

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
# The CLI references the API project, so its publish repeats the API's: the
# assemblies, appsettings.json, the native libraries. Only Stellarr.Cli.dll and
# its .pdb, .deps.json and .runtimeconfig.json are its own. The image ships one
# folder, the API's, with the CLI's own files added to it. Every file both
# publishes hold must be byte for byte the same, or the build stops here: the
# CLI must never run against an assembly it was not built with.
RUN <<'EOF'
set -eu
cd /out/cli
find . -type f | sort > /tmp/cli-files
differing=0
while IFS= read -r file; do
  if [ -e "/out/api/$file" ] && ! cmp -s "$file" "/out/api/$file"; then
    echo "The CLI and the API publish different copies of ${file#./}." >&2
    differing=1
  fi
done < /tmp/cli-files
if [ "$differing" -ne 0 ]; then
  exit 1
fi
while IFS= read -r file; do
  if [ ! -e "/out/api/$file" ]; then
    echo "Adding the CLI's ${file#./} to the API's folder."
    mkdir -p "/out/api/$(dirname "$file")"
    cp -p "$file" "/out/api/$file"
  fi
done < /tmp/cli-files
EOF

# The portable publish carries native libraries for some thirty platforms in
# runtimes/, about 95 MB, and a platform loads only its own: SQLite's
# libe_sqlite3.so, and libsodium.so, which NSec.Cryptography loads for the
# Ed25519 passkeys of Fido2. This stage runs once per target platform, still on
# the build machine, and keeps what the API's and the CLI's deps files list for
# the target's runtime identifier, its static archives aside. .NET takes native
# libraries from that one identifier's folder and does not check that the other
# files the deps files list are on disk. The build stops here if a listed
# library is missing or built for another machine, or if the deps files list
# anything under the identifiers .NET falls back to (linux, unix-<arch>, unix,
# any), which this would delete.
FROM api-build AS api-platform
ARG TARGETARCH
RUN <<'EOF'
set -eu
case "$TARGETARCH" in
  amd64) rid=linux-x64 machine="3e 00" ;;
  arm64) rid=linux-arm64 machine="b7 00" ;;
  *) echo "The API ships for amd64 and arm64, not $TARGETARCH." >&2; exit 1 ;;
esac
cd /out/api
listed=$(grep -ho '"runtimes/[^"]*"' Stellarr.Api.deps.json Stellarr.Cli.deps.json | tr -d '"' | sort -u)
fallback=$(printf '%s\n' "$listed" | grep -E '^runtimes/(linux|unix|unix-[^/]+|any)/' || true)
if [ -n "$fallback" ]; then
  printf 'The deps files list files for a fallback identifier, which this stage would remove:\n%s\n' "$fallback" >&2
  exit 1
fi
keep=$(printf '%s\n' "$listed" | grep "^runtimes/$rid/" | grep -v '\.a$' || true)
if [ -z "$keep" ]; then
  echo "The deps files list no native library for $rid." >&2
  exit 1
fi
echo "Keeping the files .NET loads on $rid (pruned on $(uname -m)):"
for file in $keep; do
  if [ ! -f "$file" ]; then
    echo "$file is listed for $rid but was not published." >&2
    exit 1
  fi
  case "$file" in
    *.so)
      # ELF magic, a shared object (e_type 3) and the target's e_machine.
      magic=$(od -An -tx1 -N4 "$file" | tr -s ' ' | sed 's/^ //')
      header=$(od -An -tx1 -j16 -N4 "$file" | tr -s ' ' | sed 's/^ //')
      if [ "$magic" != "7f 45 4c 46" ] || [ "$header" != "03 00 $machine" ]; then
        echo "$file is not a shared library for $rid." >&2
        exit 1
      fi
      ;;
  esac
  echo "  $file"
  mkdir -p "/tmp/kept/$(dirname "$file")"
  cp -p "$file" "/tmp/kept/$file"
done
rm -rf runtimes
mv /tmp/kept/runtimes runtimes
if [ "$(find runtimes -type f | sort)" != "$keep" ]; then
  echo "runtimes/ does not hold exactly the files kept for $rid." >&2
  exit 1
fi
EOF

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

# The Rust toolchain on the build machine with what a cross build for the
# target needs: the Rust target, and the target's C compiler and C library,
# which link both binaries and which aws-lc-rs, the crypto backend of str0m,
# compiles with. Bookworm's glibc 2.36 is older than the 2.39 of the final
# image, so every symbol the binaries link against is there at run time.
FROM --platform=$BUILDPLATFORM rust:1-slim-bookworm AS rust-cross
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
  *) echo "Stellarr's Rust builds for amd64 and arm64, not $TARGETARCH." >&2; exit 1 ;;
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

FROM rust-cross AS media-build
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

# Stellarr Init, the process manager that runs as PID 1. It depends on libc
# alone, which compiles in seconds, so it needs no stage of stubs. The whole
# crate is copied, tests included: Cargo.toml names the test targets, and a
# missing one fails the manifest check even when only the binary is built.
FROM rust-cross AS init-build
WORKDIR /src/init
COPY init/ ./
RUN cargo build --release --locked --target "$(cat /etc/rust-target)" --bin stellarr-init \
    && install -D "target/$(cat /etc/rust-target)/release/stellarr-init" /out/stellarr-init

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

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates coturn nginx openssl \
    && rm -rf /var/lib/apt/lists/*

COPY infra/nginx.conf /etc/nginx/nginx.conf.template
COPY infra/turnserver.conf.template /etc/turnserver.conf.template
COPY --from=init-build /out/stellarr-init /usr/local/bin/stellarr-init
COPY --chmod=0755 infra/entrypoint.sh /usr/local/bin/stellarr-entrypoint
COPY --chmod=0755 infra/tls-maintenance.sh /usr/local/bin/stellarr-tls-maintenance
COPY --chmod=0755 infra/stellarr-cli.sh /usr/local/bin/stellarr

# The API, with the operator CLI's own files added and the native libraries of
# the target platform alone.
COPY --from=api-platform /out/api /opt/stellarr/api
# The two apps, which nginx serves: the web client's document at the top,
# Cockpit's in cockpit/, the build's own files in static/, and the folders of
# web/public/ beside them.
COPY --from=web-build /src/web/dist /opt/stellarr/web
COPY --from=media-build /out/stellarr-media /opt/stellarr/media/stellarr-media
# The origin, hash and licence of every prebuilt browser file travel with the
# image, next to the notices they refer to.
COPY artifacts/NOTICES artifacts/manifest.json /usr/share/doc/stellarr/artifacts/

ENV STELLARR_DATA_ROOT=/data/stellarr
# 49000/udp is the single UDP port of Stellarr Media and carries every call.
# The media server's control API (5200/tcp) listens on loopback and is not
# exposed.
EXPOSE 80 443 3478/tcp 3478/udp 5349/tcp 5349/udp 49000/udp 49160-49200/udp
VOLUME ["/data/stellarr"]

# Healthy means every critical service is ready, as stellarr-init reports it.
# The manager asks each one again every ten seconds and counts it as failing
# after three misses in a row, about 45 seconds: the API with its database on
# /health/ready, nginx for a page it serves, the media server's control API on
# /v1/health, and coturn for a STUN binding answer. A service that exits, or
# cannot start, fails at once. The manager already waits out a slow answer, so
# Docker needs fewer misses of its own than when it asked the services itself.
# The client answers within three seconds, or exits 1 when the manager does
# not.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["/usr/local/bin/stellarr-init", "health"]

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Stellarr" \
      org.opencontainers.image.description="Self-hosted text and voice chat for small groups" \
      org.opencontainers.image.source="https://github.com/Arkazzae/stellarr" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENTRYPOINT ["/usr/local/bin/stellarr-entrypoint"]
