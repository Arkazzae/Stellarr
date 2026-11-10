#!/usr/bin/env bash
# Keeps the TLS pair in $STELLARR_DATA_ROOT/tls usable.
#
#   prepare  run once by the entrypoint before the services start
#   watch    run by supervisord; re-checks the pair periodically and reloads
#            nginx and TURN when a renewal changed the certificate
#
# Only a self-signed certificate is managed here. A pair that an administrator
# supplied is never overwritten: it can only produce a warning or an error.
set -Eeuo pipefail

mode="${1:-prepare}"
data_root="${STELLARR_DATA_ROOT:-/data/stellarr}"
public_host="${PUBLIC_HOST:-localhost}"
tls_root="$data_root/tls"
fullchain="$tls_root/fullchain.pem"
private_key="$tls_root/privkey.pem"
# Present while the pair on disk is one this script generated.
generated_marker="$tls_root/.stellarr-self-signed"
renew_before_seconds="${TLS_RENEW_BEFORE_SECONDS:-2592000}"
check_interval_seconds="${TLS_RENEW_CHECK_SECONDS:-43200}"
foreign_warning_seconds=604800

mkdir -p "$tls_root"

host_is_ip_address() {
  [[ "$public_host" =~ ^[0-9]+(\.[0-9]+){3}$ ]] ||
    [[ "$public_host" == *:* && "$public_host" =~ ^[0-9a-fA-F:.]+$ ]]
}

expires_within() {
  ! openssl x509 -in "$fullchain" -noout -checkend "$1" >/dev/null 2>&1
}

certificate_is_self_signed() {
  local subject issuer
  subject="$(openssl x509 -in "$fullchain" -noout -subject -nameopt RFC2253 2>/dev/null || true)"
  issuer="$(openssl x509 -in "$fullchain" -noout -issuer -nameopt RFC2253 2>/dev/null || true)"
  [[ -n "$subject" && "${subject#subject=}" == "${issuer#issuer=}" ]] &&
    openssl verify -CAfile "$fullchain" "$fullchain" >/dev/null 2>&1
}

certificate_matches_host() {
  if host_is_ip_address; then
    openssl verify -CAfile "$fullchain" -verify_ip "$public_host" "$fullchain" >/dev/null 2>&1
  else
    openssl verify -CAfile "$fullchain" -verify_hostname "$public_host" "$fullchain" >/dev/null 2>&1
  fi
}

certificate_matches_key() {
  local from_certificate from_key
  from_certificate="$(openssl x509 -in "$fullchain" -pubkey -noout 2>/dev/null || true)"
  from_key="$(openssl pkey -in "$private_key" -pubout 2>/dev/null || true)"
  [[ -n "$from_certificate" && "$from_certificate" == "$from_key" ]]
}

generate_self_signed_certificate() {
  local san new_key new_chain
  if host_is_ip_address; then
    san="IP:$public_host"
  else
    san="DNS:$public_host"
  fi

  # Written next to the live files so that the final mv is an atomic rename.
  new_key="$(mktemp "$tls_root/.privkey.XXXXXX")"
  new_chain="$(mktemp "$tls_root/.fullchain.XXXXXX")"
  if ! openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 \
    -keyout "$new_key" -out "$new_chain" \
    -subj "/CN=$public_host" -addext "subjectAltName=$san"
  then
    rm -f "$new_key" "$new_chain"
    return 1
  fi

  chmod 600 "$new_key" || return 1
  mv -f "$new_key" "$private_key" || return 1
  mv -f "$new_chain" "$fullchain" || return 1
  touch "$generated_marker" || return 1
  echo "Generated a 365-day self-signed TLS certificate for $public_host. Mount a trusted certificate for remote use."
}

prepare_certificate() {
  if [[ ! -s "$fullchain" || ! -s "$private_key" ]]; then
    generate_self_signed_certificate
    return
  fi

  if ! openssl x509 -in "$fullchain" -noout >/dev/null 2>&1; then
    if [[ -f "$generated_marker" ]]; then
      generate_self_signed_certificate
      return
    fi
    echo "TLS certificate is unreadable. Replace $fullchain with a valid certificate." >&2
    return 1
  fi

  local managed=false
  if certificate_is_self_signed; then
    managed=true
  elif [[ -f "$generated_marker" ]]; then
    # An administrator replaced the generated pair with a trusted one. The
    # marker belongs to the old files and must not allow overwriting theirs.
    rm -f "$generated_marker"
  fi

  if ! certificate_matches_key; then
    if [[ "$managed" == "true" ]]; then
      generate_self_signed_certificate
      return
    fi
    echo "TLS certificate does not match its private key. Replace the mounted certificate pair." >&2
    return 1
  fi

  if [[ "$managed" == "true" ]]; then
    if expires_within "$renew_before_seconds" || ! certificate_matches_host; then
      generate_self_signed_certificate
    else
      # Also marks a self-signed pair from before the marker existed.
      touch "$generated_marker"
    fi
  elif expires_within "$foreign_warning_seconds"; then
    echo "Mounted TLS certificate expires within seven days; replace it before it expires." >&2
  fi
}

reload_tls_consumers() {
  /usr/sbin/nginx -s reload || echo "Could not reload nginx after TLS renewal." >&2
  /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf restart turn ||
    echo "Could not restart TURN after TLS renewal." >&2
}

fingerprint() {
  openssl x509 -in "$fullchain" -noout -fingerprint -sha256 2>/dev/null || true
}

watch_certificate() {
  trap 'exit 0' TERM INT
  local before after
  while true; do
    # Sleeping in the background keeps the trap responsive.
    sleep "$check_interval_seconds" &
    wait $!
    [[ -f "$generated_marker" ]] || continue
    before="$(fingerprint)"
    if ! prepare_certificate; then
      echo "Managed TLS certificate check failed; retrying later." >&2
      continue
    fi
    after="$(fingerprint)"
    if [[ -n "$after" && "$after" != "$before" ]]; then
      reload_tls_consumers
    fi
  done
}

case "$mode" in
  prepare) prepare_certificate ;;
  watch) watch_certificate ;;
  *)
    echo "Usage: $0 prepare|watch" >&2
    exit 2
    ;;
esac
