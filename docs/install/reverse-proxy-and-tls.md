# Reverse proxy and TLS

By default, the container terminates TLS itself using an auto-generated self-signed certificate. You can either mount your own CA-signed certificate into the container or terminate TLS on an external reverse proxy.

## Mount a custom TLS certificate

Both Nginx and `coturn` read the certificate and private key from `/data/stellarr/tls/`:

| Container path | Contents |
| --- | --- |
| `/data/stellarr/tls/fullchain.pem` | PEM leaf certificate followed by intermediate certificates |
| `/data/stellarr/tls/privkey.pem` | PEM private key |

CA-signed certificates are never overwritten by the container. Self-signed certificates are treated as container-managed and replaced when expiring within 30 days or when `STELLARR_DOMAIN` changes.

1. Place `fullchain.pem` and `privkey.pem` in a directory next to `docker-compose.yml` (for example, `./certs/`).
2. Create `docker-compose.override.yml` in the same directory:

   ```yaml
   services:
     stellarr:
       volumes:
         - ./certs:/data/stellarr/tls:ro
   ```

3. Set `STELLARR_DOMAIN` in `.env` to match the certificate's hostname, then recreate the container:

   ```bash
   docker compose up -d
   ```

4. Verify the served certificate chain:

   ```bash
   echo | openssl s_client -connect chat.example.com:8443 -servername chat.example.com 2>/dev/null | grep -E 'issuer=|Verify return code'
   ```

   Confirm that `issuer=` shows your CA and the output ends with `Verify return code: 0 (ok)`.

If the certificate is unreadable or does not match `privkey.pem`, the container logs an error and exits with status `1`. If a mounted CA-signed certificate expires within 7 days, the container logs a warning on startup.

> [!WARNING]
> Mount the directory (`./certs:/data/stellarr/tls:ro`), not individual files. Single-file bind mounts retain the original inode across atomic file replacements on the host, preventing renewals from propagating into the container. Also ensure the directory contains regular files rather than symlinks pointing outside the mount (such as Certbot `live/` symlinks; copy them with `cp -L`).

### Reloading after certificate renewal

After updating `fullchain.pem` and `privkey.pem` on the host, reload Nginx and restart `coturn`:

```bash
docker compose exec stellarr nginx -s reload
docker compose exec stellarr supervisorctl -c /etc/supervisor/supervisord.conf restart turn
```

> [!NOTE]
> Restarting `turn` drops any active TURN relay allocations, causing relayed voice participants to briefly reconnect.

### TURN over TLS (`turns:`)

Setting `STELLARR_TURNS_ENABLED=true` enables TURN over TLS/DTLS on `STELLARR_TURNS_PORT` (`5349` by default) using the same certificate pair. Browsers reject self-signed certificates on `turns:` connections, so enable it only with a CA-signed certificate.

## Run behind a reverse proxy

When an external reverse proxy terminates TLS on port `443` and forwards HTTP to the container's HTTP port (`8888` by default), set in `.env`:

```bash
STELLARR_DOMAIN=chat.example.com
STELLARR_PUBLIC_PORT=443
STELLARR_HTTP_PORT=127.0.0.1:8888
```

Binding `STELLARR_HTTP_PORT` to `127.0.0.1` prevents external clients from bypassing the proxy on port `8888`.

### Proxy requirements

| Requirement | Reason |
| --- | --- |
| `X-Forwarded-Proto: https` | Without this header, container Nginx redirects HTTP requests to `https://<host>:<STELLARR_HTTPS_PORT>/`. |
| Preserve `Host` (`$http_host`) | Used to construct invite URLs and the discovery origin when `STELLARR_PUBLIC_URL` is unset. |
| Forward `Upgrade` and `Connection` headers | Required for SignalR WebSocket connections under `/hubs/app`. |
| Allow request bodies up to `128 MiB` | Video uploads can be up to 100 MiB; container Nginx allows up to 128 MiB. |
| Read timeout above 20 seconds | SignalR sends a keep-alive every 15 seconds and WebSockets ping every 20 seconds. |

> [!NOTE]
> The ASP.NET Core API reads the TCP peer address of the incoming connection inside the container rather than `X-Forwarded-For`. Behind a reverse proxy, active session logs show the proxy's IP address and per-IP rate limits (such as 10 failed sign-in attempts per minute) are shared across all proxied clients.

### Example: Nginx

Place the `map` block in the `http` context:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name chat.example.com;
    ssl_certificate     /etc/ssl/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/ssl/chat.example.com/privkey.pem;
    client_max_body_size 128m;

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
    }
}
```

If the reverse proxy runs in the same Docker network, proxy to `http://stellarr:80` instead of `http://127.0.0.1:8888`.

Verify the setup by checking `curl https://chat.example.com/health` (returns `{"status":"ready"}`) and confirming in browser DevTools that `/hubs/app` upgrades with status `101 Switching Protocols`.

## What does not go through the proxy

An HTTP reverse proxy only handles HTTP and WebSocket traffic. WebRTC STUN, TURN, and media server traffic use UDP (and dedicated TURN TCP/TLS listeners) and must connect directly to the Docker host:

| Default port | Protocol | Purpose |
| --- | --- | --- |
| `49000` | UDP | Stellarr Media, which carries every call (`STELLARR_MEDIA_PORT`) |
| `3478` | UDP | STUN and TURN |
| `49160-49200` | UDP | TURN relay ports |
| `3478` | TCP | TURN over TCP (`STELLARR_TURN_TCP_ENABLED=true`) |
| `5349` | TCP, UDP | TURN over TLS/DTLS (`STELLARR_TURNS_ENABLED=true`) |

> [!IMPORTANT]
> Publish these UDP/TURN ports on the Docker host and forward them on your router. `STELLARR_DOMAIN` and `PUBLIC_IP` must resolve to the host reachable on these ports, not an HTTP-only CDN or tunnel. See [Requirements](requirements.md) and [RTC and ports](../rtc-and-ports.md).
