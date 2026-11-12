# Unraid

Stellarr has an Unraid template, [`deploy/unraid/stellarr.xml`](../../deploy/unraid/stellarr.xml). It starts the same container as [`docker-compose.yml`](../../docker-compose.yml), with the same defaults and resource limits. [Platforms](platforms.md) describes what the settings do on any platform; this page covers what is specific to Unraid.

## Add the template

Stellarr is not listed in Community Applications. In the Unraid terminal, save the template as a user template:

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-Stellarr.xml \
  https://raw.githubusercontent.com/Arkazzae/Stellarr/main/deploy/unraid/stellarr.xml
```

Then open **Docker → Add Container** and choose **Stellarr** under **Template**. Fill in the settings below and select **Apply**.

## Before the first start

Fill in **Domain** and **Public IP**, which decide who can connect. See [Address](platforms.md#address).

The template has a port mapping and a variable for each port browsers are told about. When you change a host port, set its variable to the same number:

| Port mapping | Variable |
| --- | --- |
| **HTTPS port** (`8443`) | **HTTPS host port** (`PUBLIC_HTTPS_PORT`) |
| **Voice media port** (`49000`) | **Voice media host port** (`Rtc__MediaPort`) |
| **TURN port** (`3478`) | **TURN host port** (`Rtc__TurnPort`, advanced) |
| **TURNS port** (`5349`) | **TURNS host port** (`Rtc__TurnsPort`, advanced) |

Keep the host side of **TURN relay ports** equal to the container range, `49160-49200`. The Unraid web interface itself uses ports 80 and 443, so the default host ports stay clear of them.

For calls from outside your network, forward UDP `49000`, `3478` and `49160-49200` from the router to the Unraid server on the same external ports, and either the HTTPS port or a [reverse proxy](reverse-proxy-and-tls.md) in front of it.

Set **Interface language** and **Server language** to the same value, `en` or `pl`. Unraid passes its own time zone to the container, and Stellarr starts with it as the instance time zone.

## First start

Once the container is running, open **WebUI** from its menu on the Docker page. Accept the warning about the self-signed certificate, then create the owner account as in the [Quick start](quick-start.md). For a certificate browsers trust, see [Reverse proxy and TLS](reverse-proxy-and-tls.md).

## Data and backups

The **Data** path is `/mnt/user/appdata/stellarr` by default. Keep the `appdata` share on a pool drive, and back up the whole folder with the container stopped, as described in [Image and data](platforms.md#image-and-data).

## Operator CLI

The container is named after the template, so the [operator CLI](cli.md) runs as:

```bash
docker exec -it Stellarr stellarr doctor
```

## Updates

The template follows `latest`. When the Docker page shows an update, **Apply update** pulls the image and restarts the container with the same settings. To stay on one release line, change **Repository** to a version tag such as `ghcr.io/arkazzae/stellarr:1.2`. Read [Upgrading](upgrading.md) before moving to a new major version.
