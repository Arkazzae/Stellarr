# Documentation

Stellarr is a self-hosted text and voice chat for a small group of friends. The
data of an instance stays on your own server.

## Install

- [Requirements](install/requirements.md): the host, the ports to publish and
  what voice needs behind NAT.
- [Quick start](install/quick-start.md): from a machine with Docker to two
  people in a voice channel.
- [Configuration](install/configuration.md): every setting of the compose files,
  with its default and effect.
- [Reverse proxy and TLS](install/reverse-proxy-and-tls.md): a certificate of
  your own, running behind a proxy, and what a proxy cannot carry.
- [Upgrading](install/upgrading.md): backing up, upgrading, going back, and
  installations that ran the Polish-only builds.

## Understand

- [Architecture](ARCHITECTURE.md): the processes inside the container, what
  each of them is responsible for, and why they ship as one image.
- [RTC and ports](RTC_AND_PORTS.md): the ports a host publishes, what NAT and a
  firewall mean for voice, how audio is encoded and cleaned up, and what to
  check when voice does not work.
- [Stellarr RTC v1](RTC_STANDARD.md): the versioned contract between the web
  client, the API and the voice layer.
- [Localization](LOCALIZATION.md): how the interface language, the instance
  default and the translation of messages work, and how to add a language.

One document lives next to the files it describes:

- [Branding](../branding/README.md): the logo, the mascot, the colours and the
  rules for using the name.
