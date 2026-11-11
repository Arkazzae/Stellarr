# Quick start

Start Stellarr on one machine, create the first account, invite a second person
and put both in a voice channel. Both people use browsers on the same computer,
so nothing has to be opened on a router.

## Before you start

- Docker Engine with the Compose plugin. `docker compose version` prints a
  version when it is installed. [Requirements](requirements.md) lists the rest.
- Ports `8443`, `8888`, `3478`, `5349`, `49000` and `49160-49200` free on the
  machine. [Requirements](requirements.md#ports) lists them with the setting
  that moves each one. A taken port stops `docker compose up -d` with
  `failed to bind host port 0.0.0.0:8443/tcp: address already in use`. Change
  that port in `.env` in step 1, and use the new `STELLARR_HTTPS_PORT` in every
  address below.
- A second browser profile, or a private window, for the second person.

## 1. Download the compose file and the settings

```bash
mkdir stellarr && cd stellarr
curl -fsSLO https://raw.githubusercontent.com/Arkazzae/Stellarr/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Arkazzae/Stellarr/main/.env.example -o .env
```

The compose file runs the published image `ghcr.io/arkazzae/stellarr`. Every
setting in `.env` has a default, so you can leave the file as it is.

## 2. Start the container

```bash
docker compose up -d
```

Docker downloads the image, creates a network, the data volume
`stellarr-v2_stellarr_data` and the container `stellarr-v2`, and starts it. Then
check it:

```bash
docker compose ps
```

After about 15 seconds the status column reads `Up 15 seconds (healthy)`.

> [!NOTE]
> `healthy` means that the API answers. It says nothing about the web server in
> the same container, so step 3 is the real check. If the page does not load,
> read `docker compose logs`.

## 3. Open the address

Open `https://localhost:8443` in the browser.

The container generated a self-signed certificate on its first start. The log
says so:

```bash
docker compose logs --no-log-prefix | grep self-signed
```

```text
Generated a 365-day self-signed TLS certificate for localhost. Mount a trusted certificate for remote use.
```

No browser trusts that certificate, so the browser stops with a warning that the
connection is not private. Open the advanced options and continue to
`localhost`. For this machine that is safe. People on other machines need a
certificate their browsers trust: see
[Reverse proxy and TLS](reverse-proxy-and-tls.md).

The page that opens is `Log in`, with the fields `Username or email` and
`Password`, and the links `Forgot password` and `Create account`.

## 4. Create the first account

1. Select `Create account`.
2. Fill in `Display name`, `Username`, `Email`, `Password` and
   `Confirm password`. This walk-through uses Alice: display name `Alice`,
   username `alice`, e-mail `alice@example.com`. The username takes 3 to 32
   letters, numbers, dots, hyphens or underscores. The password needs at least
   8 characters.
3. Select `Create account`.

You arrive in a server named `Stellarr` with a text channel `general` and a
voice channel `voice`. The first message reads `Alice has joined the server.
Say hello!`.

On an empty instance the first account becomes the owner. Every later account
needs an invite.

## 5. Invite a second person

1. In the header of the channel list, select the person icon next to the server
   name, named `Invite to server`.
2. In the `Invite friends` window, select `New invite link`. A link appears:

   ```text
   https://localhost/invite/22b115a390a20370
   ```

3. Add the port to the link: `https://localhost:8443/invite/22b115a390a20370`.

> [!WARNING]
> The invite window builds the link from the host name without the port, so with
> any port other than 443 it points at the wrong address. Add the port by hand
> before you send the link.

Anyone who holds the link can join the server.

## 6. Join as the second person

In the second browser profile or the private window, open the link with the
port. Accept the certificate warning again. The page that opens is
`Create account`, and the invite is remembered. Fill it in as in step 4, for
example as Bob, with username `bob`. The second person arrives in the same
server, and the channel shows `Bob has joined the server. Say hello!`.

## 7. Talk in the voice channel

1. In both windows, select `voice` under `VOICE` in the channel list. Allow the
   microphone when the browser asks.
2. Each window now shows both names under `voice`, and the bottom left of the
   channel list reads `Connected` with the delay, for example `Good · 1 ms`, and
   the time in the call.
3. Speak. The other person hears you through the browser's audio output.

To leave, select `Disconnect`.

If the status stays on connecting, or a person outside your network cannot hear
the others, read [RTC and ports](../RTC_AND_PORTS.md). It lists what to check in
order.

## Stop or remove

```bash
docker compose stop      # stops the container and keeps everything
docker compose down      # removes the container and the network, keeps the data
```

> [!CAUTION]
> `docker compose down -v` also deletes the data volume: every account, message
> and upload.

## Next

- [Requirements](requirements.md): the ports to open so that friends outside your
  network can join, and what to set behind NAT.
- [Reverse proxy and TLS](reverse-proxy-and-tls.md): a certificate that browsers
  trust, and running behind a proxy.
- [Configuration](configuration.md): every setting.
- Cockpit, the operator panel, is at `https://localhost:8443/cockpit/`. The owner opens it.

## Build from source

To run your own changes, build the image from a checkout instead of downloading
it:

```bash
git clone https://github.com/Arkazzae/Stellarr.git
cd Stellarr
docker compose up -d --build
```

The build compiles the API, the web client and the operator panel inside Docker,
so the host needs neither .NET nor Node.js. The container that starts is the same
one, and steps 3 to 7 apply.
