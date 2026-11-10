#!/usr/bin/env bash
# Container entrypoint: prepares the data volume, exports the settings the
# services read, renders the coturn and nginx configuration from their
# templates, and hands over to supervisord.
set -Eeuo pipefail
# Without this a failing `openssl rand` inside $(...) would yield an empty secret.
shopt -s inherit_errexit

data_root="${STELLARR_DATA_ROOT:-/data/stellarr}"
public_host="${PUBLIC_HOST:-localhost}"
public_https_port="${PUBLIC_HTTPS_PORT:-443}"

fail() {
  echo "$*" >&2
  exit 1
}

is_ipv4_address() {
  local octets octet
  [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS=. read -r -a octets <<< "$1"
  for octet in "${octets[@]}"; do
    (( 10#$octet <= 255 )) || return 1
  done
}

# Prints the secret stored under secrets/<name>, creating it on first use. The
# files are read back on every later start, so they must never be renamed.
read_or_create_secret() {
  local file="$data_root/secrets/$1" pending
  if [[ ! -s "$file" ]]; then
    pending="$(mktemp "$file.XXXXXX")" # mode 600
    openssl rand -hex 32 > "$pending"
    mv -f "$pending" "$file"
  fi
  tr -d '\r\n' < "$file"
}

# Prints the external IPv4 address coturn should advertise, or nothing.
resolve_public_ip() {
  local requested="${PUBLIC_IP:-}" resolved
  case "$requested" in
    '') ;;
    auto)
      resolved="$(getent ahostsv4 "$public_host" 2>/dev/null | awk '$2 == "STREAM" { print $1; exit }')" || true
      is_ipv4_address "$resolved" ||
        fail "PUBLIC_IP=auto could not resolve a public IPv4 address for PUBLIC_HOST=$public_host."
      echo "Resolved PUBLIC_HOST=$public_host to TURN external IPv4 $resolved." >&2
      echo "$resolved"
      ;;
    *)
      is_ipv4_address "$requested" || fail "PUBLIC_IP must be an IPv4 address or the value 'auto'."
      echo "$requested"
      ;;
  esac
}

require_boolean() {
  case "$2" in
    true|false) ;;
    *) fail "$1 must be 'true' or 'false'." ;;
  esac
}

if [[ ! "$public_https_port" =~ ^[0-9]{1,5}$ ]] || (( 10#$public_https_port < 1 || 10#$public_https_port > 65535 )); then
  fail "PUBLIC_HTTPS_PORT must be an integer between 1 and 65535."
fi
public_https_port=$((10#$public_https_port))
public_https_suffix=""
if (( public_https_port != 443 )); then
  public_https_suffix=":$public_https_port"
fi

turn_tcp_enabled="${Rtc__TurnTcpEnabled:-true}"
turn_tls_enabled="${Rtc__TurnsEnabled:-true}"
require_boolean Rtc__TurnTcpEnabled "$turn_tcp_enabled"
require_boolean Rtc__TurnsEnabled "$turn_tls_enabled"
public_ip="$(resolve_public_ip)"

mkdir -p "$data_root"/{db,keys,logs,objects,secrets,tls} /run/nginx

rustfs_secret="${RUSTFS_SECRET_KEY:-$(read_or_create_secret rustfs-secret)}"
turn_secret="${TURN_SHARED_SECRET:-$(read_or_create_secret turn-shared-secret)}"

export RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-stellarr}"
export RUSTFS_SECRET_KEY="$rustfs_secret"
export RUSTFS_VOLUMES="$data_root/objects"
export RUSTFS_ADDRESS="127.0.0.1:9000"
export RUSTFS_CONSOLE_ENABLE="false"
export RUSTFS_OBS_LOGGER_LEVEL="warn"
export RUSTFS_OBS_LOG_DIRECTORY="$data_root/logs"

export Storage__Endpoint="http://127.0.0.1:9000"
export Storage__AccessKey="$RUSTFS_ACCESS_KEY"
export Storage__SecretKey="$RUSTFS_SECRET_KEY"
export Storage__Bucket="${RUSTFS_BUCKET:-stellarr-images}"
export ConnectionStrings__Database="Data Source=$data_root/db/stellarr.db;Cache=Shared;Pooling=True"
export DataRoot="$data_root"
export Rtc__PublicHost="$public_host"
export TURN_SHARED_SECRET="$turn_secret"
export Rtc__TurnSharedSecret="$turn_secret"

# The ASP.NET base image sets one of these, and it would conflict with
# ASPNETCORE_URLS.
unset ASPNETCORE_HTTP_PORTS ASPNETCORE_HTTPS_PORTS
export ASPNETCORE_URLS="http://127.0.0.1:5000"
export ASPNETCORE_ENVIRONMENT="${ASPNETCORE_ENVIRONMENT:-Production}"

# Where the Next.js standalone server listens.
export NODE_ENV="production"
export HOSTNAME="127.0.0.1"
export PORT="3000"

/usr/local/bin/stellarr-tls-maintenance prepare

# A disabled transport is closed in coturn, not merely left unadvertised.
turn_tcp_line="# TURN/TCP client listener enabled"
turn_tls_line="# TURN/TLS client listener enabled"
turn_dtls_line="# TURN/DTLS client listener enabled"
external_ip_line="# external-ip is not set; configure PUBLIC_IP when the host is behind NAT"
[[ "$turn_tcp_enabled" == "true" ]] || turn_tcp_line="no-tcp"
if [[ "$turn_tls_enabled" != "true" ]]; then
  turn_tls_line="no-tls"
  turn_dtls_line="no-dtls"
fi
if [[ -n "$public_ip" ]]; then
  external_ip_line="external-ip=$public_ip"
fi

sed \
  -e "s|__PUBLIC_HOST__|$public_host|g" \
  -e "s|__TURN_SHARED_SECRET__|$turn_secret|g" \
  -e "s|__EXTERNAL_IP_LINE__|$external_ip_line|g" \
  -e "s|__TURN_TCP_LINE__|$turn_tcp_line|g" \
  -e "s|__TURN_TLS_LINE__|$turn_tls_line|g" \
  -e "s|__TURN_DTLS_LINE__|$turn_dtls_line|g" \
  /etc/turnserver.conf.template > /etc/turnserver.conf

sed -e "s|__PUBLIC_HTTPS_SUFFIX__|$public_https_suffix|g" \
  /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
