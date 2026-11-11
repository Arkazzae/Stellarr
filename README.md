# Stellarr

<p align="center">
  <img src="branding/film/stellarr.webp" width="800" alt="A one-minute tour of Stellarr: the astronaut mascot turns into the logo, friends plan a game night in a text channel, a Polish message is translated in the browser, four people talk in a voice channel while one of them shares a screen, the interface switches through its six palettes, the owner checks the instance in Cockpit, and one docker compose command starts the single container.">
</p>
<p align="center"><sub>Real screens of the web client and Cockpit, recorded on a local instance with made-up people. Sources in <a href="branding/film/"><code>branding/film/</code></a>.</sub></p>

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
| `branding/` | [Logo, mascot, and brand guidelines](branding/README.md), and the [README film](branding/film/README.md) |

## License

Code is licensed under the [MIT License](LICENSE). See [`branding/README.md`](branding/README.md#name-and-logo) for use of the Stellarr name, logo, and mascot.
