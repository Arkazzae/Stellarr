#!/usr/bin/env bash
# Container entrypoint: prepares the data volume, exports the settings the
# services read, renders the coturn and nginx configuration from their
# templates, and hands over to supervisord.
set -Eeuo pipefail
# Without this a failing `openssl rand` inside $(...) would yield an empty secret.
shopt -s inherit_errexit

data_root="${STELLARR_DATA_ROOT:-/data/stellarr}"
# STELLARR_DOMAIN is the name people reach the instance at; PUBLIC_HOST is its
# older name. Without either, TLS and TURN use localhost. The host is exported
# as PUBLIC_HOST too, so tls-maintenance.sh issues the certificate for it.
configured_domain="${STELLARR_DOMAIN:-${PUBLIC_HOST:-}}"
public_host="${configured_domain:-localhost}"
export PUBLIC_HOST="$public_host"
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

# Prints the external IPv4 address coturn and the media server should
# advertise, or nothing.
resolve_public_ip() {
  local requested="${PUBLIC_IP:-}" resolved
  case "$requested" in
    '') ;;
    auto)
      resolved="$(getent ahostsv4 "$public_host" 2>/dev/null | awk '$2 == "STREAM" { print $1; exit }')" || true
      is_ipv4_address "$resolved" ||
        fail "PUBLIC_IP=auto could not resolve a public IPv4 address for STELLARR_DOMAIN=$public_host."
      echo "Resolved STELLARR_DOMAIN=$public_host to the external IPv4 $resolved for TURN and the media server." >&2
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

require_port() {
  if [[ ! "$2" =~ ^[0-9]{1,5}$ ]] || (( 10#$2 < 1 || 10#$2 > 65535 )); then
    fail "$1 must be an integer between 1 and 65535."
  fi
}

# Prints the instance's public URL: the third argument as given when it is set,
# otherwise https:// with the host and, unless it is 443, the port.
public_url_for() {
  local host="$1" port="$2" explicit="$3"
  if [[ -n "$explicit" ]]; then
    printf '%s' "${explicit%/}"
    return
  fi
  [[ "$host" == *:* ]] && host="[$host]"
  if (( 10#$port == 443 )); then
    printf 'https://%s' "$host"
  else
    printf 'https://%s:%s' "$host" "$((10#$port))"
  fi
}

require_port PUBLIC_HTTPS_PORT "$public_https_port"
public_https_port=$((10#$public_https_port))
public_https_suffix=""
if (( public_https_port != 443 )); then
  public_https_suffix=":$public_https_port"
fi

turn_tcp_enabled="${Rtc__TurnTcpEnabled:-true}"
turn_tls_enabled="${Rtc__TurnsEnabled:-true}"
require_boolean Rtc__TurnTcpEnabled "$turn_tcp_enabled"
require_boolean Rtc__TurnsEnabled "$turn_tls_enabled"

# The host port of 49000/udp. A browser can only reach the port it is told, so
# the media server advertises this one and the API names it in the bootstrap.
media_port="${Rtc__MediaPort:-49000}"
require_port Rtc__MediaPort "$media_port"
media_port=$((10#$media_port))

public_ip="$(resolve_public_ip)"

mkdir -p "$data_root"/{db,files,keys,logs,secrets,tls} /run/nginx

turn_secret="${TURN_SHARED_SECRET:-$(read_or_create_secret turn-shared-secret)}"
media_control_secret="${STELLARR_MEDIA_CONTROL_SECRET:-$(read_or_create_secret media-control-secret)}"

export ConnectionStrings__Database="Data Source=$data_root/db/stellarr.db;Cache=Shared;Pooling=True"
export DataRoot="$data_root"
export Rtc__PublicHost="$public_host"

# The address in mail links and the desktop client's canonical origin: the
# domain on the HTTPS port browsers use. Behind a proxy that is 443, not the
# port this container publishes. STELLARR_PUBLIC_URL, when set, overrides it.
# Without a domain or a URL there is no public address: reset links stay off
# and desktop clients keep the address they connected to.
public_port="${STELLARR_PUBLIC_PORT:-$public_https_port}"
require_port STELLARR_PUBLIC_PORT "$public_port"
if [[ -n "$configured_domain" || -n "${STELLARR_PUBLIC_URL:-}" ]]; then
  public_url="$(public_url_for "$public_host" "$public_port" "${STELLARR_PUBLIC_URL:-}")"
  export Operations__PublicUrl="$public_url"
  export Desktop__CanonicalOrigin="$public_url"
  echo "The public address of this instance is $public_url." >&2
else
  echo "STELLARR_DOMAIN is not set, so the instance has no public address: reset links stay off and desktop clients keep the address they connected to." >&2
fi
export TURN_SHARED_SECRET="$turn_secret"
export Rtc__TurnSharedSecret="$turn_secret"

# Stellarr Media carries every call. Its candidates are the public address,
# when one is known, and the container's own address, which is where coturn
# relays a browser that needs TURN. STELLARR_MEDIA_ADVERTISE, when set,
# replaces both and is passed through.
export STELLARR_MEDIA_BIND="0.0.0.0:49000"
export STELLARR_MEDIA_PUBLIC_IP="$public_ip"
export STELLARR_MEDIA_PUBLIC_PORT="$media_port"
export STELLARR_MEDIA_CONTROL_BIND="127.0.0.1:5200"
export STELLARR_MEDIA_CONTROL_SECRET="$media_control_secret"
export STELLARR_MEDIA_LOG="${STELLARR_MEDIA_LOG:-info}"
export Rtc__MediaControlUrl="http://127.0.0.1:5200"
export Rtc__MediaControlSecret="$media_control_secret"
export Rtc__MediaPort="$media_port"

if [[ -z "$public_ip" && -z "${STELLARR_MEDIA_ADVERTISE:-}" ]]; then
  echo "PUBLIC_IP is empty, so the media server advertises only this container's own address." \
    "Voice from a browser outside this host reaches it only through TURN, and gets no connection when TURN is blocked too." \
    "Set PUBLIC_IP to the IPv4 address browsers reach this host at, or to 'auto'." >&2
fi

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
