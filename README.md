<h1 align="center">Stellarr</h1>

<p align="center">
  <strong>Talk on your own server.</strong><br>
  Self-hosted text, voice, video, and screen sharing for your group of friends — in one Docker container.
</p>

<p align="center">
  <a href="#try-it-locally">Try it locally</a> ·
  <a href="#inviting-friends-over-the-internet">Going online</a> ·
  <a href="https://docs.stellarr.online/">Documentation</a> ·
  <a href="docs/install/unraid.md">Unraid guide</a>
</p>

<p align="center">
  <img src="branding/film/stellarr.webp" width="820" alt="A one-minute tour of Stellarr: the astronaut mascot turns into the logo, friends plan a game night in a text channel, a Polish message is translated in the browser, four people talk in a voice channel while sharing a screen, the interface switches through its six palettes, the owner checks the instance in Cockpit, and one docker compose command starts the container.">
</p>

<p align="center">
  <sub>Experimental · In active development</sub>
</p>

---

## Why Stellarr

Stellarr is a private place for you and your friends to hang out, chat, jump on voice, and stream games together—without ads, subscriptions, or handing your conversations to someone else's cloud.

- **Chat that feels familiar** — Text channels, direct messages, threads, replies, reactions, polls, voice messages, custom emojis, and stickers.
- **Translated in your browser** — Friends writing in Polish and English? Translate chat messages locally in your browser without sending your conversations to external services.
- **Voice, video, and screen sharing** — Drop into a voice channel, turn on your camera, or share a game or movie up to 4K 60 fps with system audio and built-in noise reduction.
- **Six palettes** — Switch between *Midnight*, *Slate*, *Evergreen*, *Harbor*, *Amethyst*, and *Ink*, with full English and Polish interface support.
- **Cockpit included** — Manage users, two-factor sign-in, live logs, and automatic daily backups (with optional offsite copies on Cloudflare R2) from the built-in `/cockpit` panel.

## One container, one folder

Running a server for a handful of friends shouldn't mean maintaining a cluster of external services. Stellarr packs the web app, the `/cockpit` admin panel, the chat server, the voice and video server, and the database into **one Docker container** backed by **one folder** (`/data/stellarr`). You don't need to set up Postgres, Redis, or a separate media server, and backing up or moving your server is just copying a single volume.

## Try it locally

Make sure you have [Docker](https://docs.docker.com/get-docker/) installed, then run:

```bash
mkdir stellarr && cd stellarr
curl -fsSLO https://raw.githubusercontent.com/Arkazzae/Stellarr/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Arkazzae/Stellarr/main/.env.example -o .env
docker compose up -d
```

Open **`https://localhost:8443`** in your browser, accept the self-signed certificate warning, and create the owner account with the setup code from the container's log (`docker compose logs stellarr | grep "Setup code"`). To open the operator panel later, visit **`https://localhost:8443/cockpit`**.

### Inviting friends over the internet

Local testing works out of the box on your own computer. Before inviting friends from other devices:

1. Set `PUBLIC_IP` and `STELLARR_DOMAIN` in `.env`.
2. Forward the voice UDP ports on your router — see [Requirements](docs/install/requirements.md#behind-nat).
3. Configure a trusted HTTPS certificate so browsers allow microphone and screen sharing — see [Reverse proxy and TLS](docs/install/reverse-proxy-and-tls.md).

Running on **Unraid**? Follow the [Unraid setup guide](docs/install/unraid.md). Want the full step-by-step walkthrough? Start with the [Quick start](docs/install/quick-start.md).

## Documentation

Browse the full guides on the [**documentation site**](https://docs.stellarr.online/) or in [`docs/`](docs/README.md):

- **Getting started**: [Quick start](docs/install/quick-start.md) · [Requirements](docs/install/requirements.md) · [Configuration](docs/install/configuration.md) · [Reverse proxy & TLS](docs/install/reverse-proxy-and-tls.md) · [Unraid](docs/install/unraid.md) · [Upgrading](docs/install/upgrading.md)
- **Running your server**: [Account security](docs/admin/account-security.md) · [Automatic backups](docs/admin/backups.md) · [Cloudflare R2](docs/admin/cloudflare-r2.md) · [Notifications](docs/admin/notifications.md) · [Operator CLI](docs/admin/cli.md)
- **Internals**: [Architecture](docs/architecture.md) · [Voice & RTC](docs/rtc-protocol.md) · [Media server](docs/stellarr-media.md) · [Ports & NAT](docs/rtc-and-ports.md) · [Localization](docs/localization.md)

## License

Source code is licensed under the [MIT License](LICENSE). See [`branding/README.md`](branding/README.md#name-and-logo-policy) for usage rules for the Stellarr name, logo, and mascot.
