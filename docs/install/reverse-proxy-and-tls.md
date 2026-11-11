# Reverse proxy and TLS

The container terminates TLS itself and starts with a self-signed certificate.
This page replaces that certificate with one that browsers trust, and shows how
to run the container behind a proxy that already holds your certificates.

## Use your own certificate

The container reads the certificate and the key from two files in the data
volume, and both Nginx and the TURN server use them:

| Path in the container | Content |
| --- | --- |
| `/data/stellarr/tls/fullchain.pem` | The certificate, followed by the intermediate certificates, in PEM format |
| `/data/stellarr/tls/privkey.pem` | The private key, in PEM format |

The container leaves a certificate that an authority signed alone. It treats any
self-signed pair as its own, including one you made, and replaces it when it
expires within 30 days or no longer matches `PUBLIC_HOST`.

1. Put both files in a folder next to `docker-compose.yml`, for example
   `certs/`, with the names above.

2. Create `docker-compose.override.yml` in the same folder as the compose file.
   Compose reads it automatically.

   ```yaml
   services:
     stellarr:
       volumes:
         - ./certs:/data/stellarr/tls:ro
   ```

3. Set `PUBLIC_HOST` in `.env` to the name on the certificate, then recreate the
   container:

   ```bash
   docker compose up -d
   ```

4. Check what the server presents:

   ```bash
   echo | openssl s_client -connect chat.example.com:8443 -servername chat.example.com 2>/dev/null | grep -E 'issuer=|Verify return code'
   ```

   The issuer is your certificate authority, and the last line reads
   `Verify return code: 0 (ok)`.

The container refuses to start with a pair it cannot use. A certificate that
does not match its key logs `TLS certificate does not match its private key.
Replace the mounted certificate pair.` and the container exits with status 1.
A certificate that expires within seven days logs a warning at start-up.

> [!WARNING]
> Mount the folder, not the two files. A file mount keeps pointing at the file
> as it was when the container started, so a renewal that replaces the file is
> not seen. A folder mount also needs real files: a symlink, such as the ones in
> the `live/` folder of an ACME client, leads outside the folder and does not
> resolve inside the container. Copy the files with `cp -L` instead.

### Renew a certificate you supplied

The container renews only the self-signed certificates it generated. After you
replace the files in `certs/`, make Nginx and the TURN server read them again:

```bash
docker compose exec stellarr nginx -s reload
docker compose exec stellarr supervisorctl -c /etc/supervisor/supervisord.conf restart turn
```

Restarting TURN closes the relays that are open at that moment.
`docker compose restart` does both and also restarts the rest of the container.

Until the reload, Nginx keeps serving the old certificate.

### TURN over TLS

`STELLARR_TURNS_ENABLED=true` offers TURN over TLS on `STELLARR_TURNS_PORT`. The
TURN server presents the same pair as Nginx, so the pair has to be one that
browsers trust.

## Run behind a reverse proxy

Use a proxy when something else already owns port 443 on the host, or when one
proxy holds the certificates for several sites. The proxy terminates TLS and
forwards plain HTTP to the container's HTTP port, `8888` by default.

Set these in `.env`:

```bash
PUBLIC_HOST=chat.example.com
STELLARR_PUBLIC_URL=https://chat.example.com
```

### What the proxy has to forward

| Requirement | Why |
| --- | --- |
| `X-Forwarded-Proto: https` | The container redirects every plain HTTP request without it to `https://<host>:<STELLARR_HTTPS_PORT>/`. With the defaults that is port 8443, the container's own HTTPS port with its self-signed certificate. Visitors land there, or on a closed port. |
| The `Host` header as the browser sent it | Invite links and the origin that desktop clients read are built from it. |
| `Upgrade` and `Connection` on `/hubs/` | The realtime connection is a WebSocket at `/hubs/app`. Without the headers the WebSocket closes at once and the client negotiates again, repeatedly. |
| Request bodies of at least 128 MiB | Uploads go through the proxy. The container accepts bodies up to 128 MiB, and a video may be 100 MiB. |
| A read timeout above 20 seconds | The server sends a keep-alive every 15 seconds on the hub and every 20 seconds on the WebSocket. |

Serve the proxy on port 443. The container builds invite links from the host
name without the port, so on any other port the links point at the wrong
address.

The API takes the client address from the connection to the container, so behind
a proxy it records the proxy's address for every request, whatever the proxy
sends in `X-Forwarded-For`. The sessions list of the operator panel shows that
address, and the limits per address apply to everyone behind the proxy
together: after 10 sign-in attempts in a minute from any of them, the next
attempt is answered with 429.

### Example: Nginx

The `map` block goes in the `http` context.

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

A proxy in the same Compose network can use `http://stellarr:80` instead of the
published port.

To check the result, open the site in a browser and look at the network panel
for the request to `/hubs/app`: it is a WebSocket with status 101 and stays open.
`curl https://chat.example.com/health` answers `{"status":"ready"}`.

### Keep the HTTP port on the host

A port published on all interfaces is a second way in that skips the proxy and
whatever it enforces. `STELLARR_HTTP_PORT` is placed in the port mapping as
written, so a value with an address publishes the port on that interface only:

```bash
STELLARR_HTTP_PORT=127.0.0.1:8888
```

The HTTPS port stays published on all interfaces.

## What does not go through the proxy

An HTTP proxy carries only HTTP. STUN, TURN and the relay ports use UDP and
their own TCP, so they go straight to the host:

| Port | Protocol | Used for |
| --- | --- | --- |
| `3478` | UDP | STUN and TURN |
| `49160-49200` | UDP | TURN relays |
| `3478` | TCP | TURN over TCP, with `STELLARR_TURN_TCP_ENABLED=true` |
| `5349` | TCP and UDP | TURN over TLS, with `STELLARR_TURNS_ENABLED=true` |

Publish them on the host as the compose file does, and forward them on the
router. `PUBLIC_HOST` has to name the machine that runs the container, not a
service that passes only HTTP, because browsers send TURN traffic to that name.
[Requirements](requirements.md) lists the ports and what to set behind NAT, and
[RTC and ports](../RTC_AND_PORTS.md) covers the TURN settings.
