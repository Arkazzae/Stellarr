# Documentation

Stellarr is a self-hosted text, voice, and video chat for small groups, packaged as a single Docker container.

> [!TIP]
> To try Stellarr locally on your machine in a few minutes, start with the [Quick start](install/quick-start.md). Before exposing an instance to friends over the internet, check the [Requirements](install/requirements.md#behind-nat) for `PUBLIC_IP` and UDP port forwarding.

## Self-hosting

- [Requirements](install/requirements.md): host resources, published ports, and NAT forwarding for voice calls.
- [Quick start](install/quick-start.md): start a local instance with Docker Compose, create the owner account, and test voice.
- [Platforms](install/platforms.md): what any installation gives the container, and the platforms with a template of their own.
  - [Unraid](install/unraid.md): install from the Unraid template and keep its port variables in step with the port mappings.
- [Configuration](install/configuration.md): environment variables for production and development stacks.
- [Operator CLI](install/cli.md): inspect health, edit settings, rotate secrets, and manage accounts and sessions via `docker exec` or on a stopped volume.
- [Account security](install/account-security.md): second steps and passkeys, the instance policy, trusted devices, identity providers, and recovering a locked-out account.
- [Reverse proxy and TLS](install/reverse-proxy-and-tls.md): custom TLS certificates, reverse proxy configuration, and non-HTTP WebRTC ports.
- [Upgrading](install/upgrading.md): volume backups, image upgrades, rollbacks, and version migrations.

## Administration

- [Automatic backups](admin/backups.md): schedules, verification, the local checkpoint, and a recovery drill.
- [Cloudflare R2 offsite backups](admin/cloudflare-r2.md): the R2 integration, its Worker relay, bucket policies, and a Deploy to Cloudflare button.

## Reference

- [Architecture](architecture.md): container processes, how requests and call media flow through them, and persistent storage.
- [RTC and ports](rtc-and-ports.md): port mappings, NAT/TURN behavior, audio/video pipeline, and call diagnostics.
- [Voice and RTC protocol](rtc-protocol.md): SignalR voice signaling, client state, audio processing, screen sharing, and camera profiles.
- [Stellarr Media](stellarr-media.md): Rust SFU media server, SDP negotiation rules, track directory, and loopback control API.
- [Localization](localization.md): interface locales, server message catalogs, and local in-browser chat translation.

## Component guides

- [Stellarr Cockpit](../cockpit/README.md): operator panel development, locale resolution, and build checks.
- [Stellarr Media crate](../media/README.md): building and testing the `stellarr-media` binary and the [Chromium smoke suite](../media/smoke/README.md).
- [Branding](../branding/README.md): logo, mascot, color palette, typography, and trademark policy.
