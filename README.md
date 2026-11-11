# Stellarr

[Experimental] [DEVELOPMENT] The self-hosted Discord alternative for your friends. Fast, solid, and fully yours.

## Documentation

Full documentation lives in [`docs/`](docs/README.md):

- [Requirements](docs/install/requirements.md)
- [Quick start](docs/install/quick-start.md)
- [Configuration](docs/install/configuration.md)
- [Reverse proxy and TLS](docs/install/reverse-proxy-and-tls.md)
- [Upgrading](docs/install/upgrading.md)
- [Architecture](docs/ARCHITECTURE.md)
- [RTC and ports](docs/RTC_AND_PORTS.md)
- [Stellarr RTC v1](docs/RTC_STANDARD.md)
- [Stellarr Media (SFU)](docs/STELLARR_MEDIA.md)
- [Localization](docs/LOCALIZATION.md)

## Repository layout

| Directory | Contents |
| --- | --- |
| `web/` | Next.js web client |
| `cockpit/` | [Stellarr Cockpit](cockpit/README.md), the instance operator panel (`/cockpit/`) |
| `server/` | ASP.NET Core control plane, SignalR hub, and tests |
| `media/` | [Stellarr Media](media/README.md), the Rust WebRTC SFU (`stellarr-media`) |
| `infra/` | Container entrypoint, Nginx, coturn, supervisord, and TLS scripts |
| `docs/` | VitePress documentation site |
| `branding/` | [Logo, mascot, and brand guidelines](branding/README.md) |

## License

Code is licensed under the [MIT License](LICENSE). See [`branding/README.md`](branding/README.md#name-and-logo) for use of the Stellarr name, logo, and mascot.
