# Documentation

Stellarr is a self-hosted text, voice, and video chat for small groups, deployed as a single Docker container.

## Install

- [Requirements](install/requirements.md): host resources, published ports, and NAT forwarding for voice.
- [Quick start](install/quick-start.md): start a local instance with Docker Compose, create accounts, and test voice.
- [Configuration](install/configuration.md): environment variables for production and development stacks.
- [Reverse proxy and TLS](install/reverse-proxy-and-tls.md): custom TLS certificates, reverse proxy configuration, and non-HTTP RTC ports.
- [Upgrading](install/upgrading.md): backups, image upgrades, rollbacks, and version migrations.

## Understand

- [Architecture](ARCHITECTURE.md): container processes, responsibilities, and topology boundaries.
- [RTC and ports](RTC_AND_PORTS.md): port mappings, NAT/TURN behavior, audio/video pipeline overview, and troubleshooting.
- [Stellarr RTC v1](RTC_STANDARD.md): versioned signaling, state, audio, screen-share, and camera specification.
- [Stellarr Media](STELLARR_MEDIA.md): Rust SFU media server specification, hub signaling, and internal control API.
- [Localization](LOCALIZATION.md): interface locales, server message catalogs, and local Bergamot chat translation.

## Component guides

- [Stellarr Cockpit](../cockpit/README.md): operator panel development, locale resolution, and checks.
- [Stellarr Media crate](../media/README.md): running and testing the `stellarr-media` binary and [Chromium smoke suite](../media/smoke/README.md).
- [Branding](../branding/README.md): logo, mascot, color palette, typography, and trademark policy.
