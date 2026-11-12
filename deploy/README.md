# Platform templates

Each folder here packages the production container for one platform, in that platform's own format. A platform that installs from a Compose file starts from [`docker-compose.yml`](../docker-compose.yml) rather than from a copy of it.

| Platform | Template | Guide |
| --- | --- | --- |
| Unraid | [`unraid/stellarr.xml`](unraid/stellarr.xml) | [docs/install/unraid.md](../docs/install/unraid.md) |

## Rules every template keeps

`docker-compose.yml` is the reference. A template starts the same container with the same settings, so that an instance behaves the same whichever way it was installed.

1. **Same image.** `ghcr.io/arkazzae/stellarr:latest` by default, with a version tag as the way to stay on one release line.
2. **Same data path.** One persistent folder or volume mounted at `/data/stellarr`.
3. **Same ports and default host ports.** Every port `docker-compose.yml` publishes, with its protocol and default host port. The TURN relay range keeps the same numbers on the host as in the container.
4. **Port variables that name the host side.** The container cannot see the port mappings, and it tells browsers the ports to use. Each template sets `PUBLIC_HTTPS_PORT`, `Rtc__MediaPort`, `Rtc__TurnPort` and `Rtc__TurnsPort` to the host side of the matching mapping, and tells the person installing it to change both together. [Platforms](../docs/install/platforms.md) lists the pairs.
5. **Defaults from `docker-compose.yml`.** Each variable a template sets has the default Compose gives it, under the container-side name (`Rtc__MediaPort`, not `STELLARR_MEDIA_PORT`). Both language variables, `STELLARR_LANGUAGE` and `Stellarr__Language`, are set, since Compose fills both from one value.
6. **No frozen defaults.** Many platforms keep the values a template wrote when the image is updated. A setting whose default lives in the code, such as the desktop client versions or the OIDC callback path, is left out, so that it keeps following the code.
7. **Same limits.** The memory, CPU and process limits of `docker-compose.yml` and `no-new-privileges`, where the platform can set them.
8. **Secrets masked.** Passwords and API keys use the platform's way of hiding a value, where it has one.

When a default in `docker-compose.yml` changes, change it in every template here as well.

## Adding a platform

1. Put the template in `deploy/<platform>/`, keeping the rules above.
2. Start the container with exactly the template's settings: its ports, variables and extra arguments, and a scratch volume. Check that it becomes healthy, that `http://localhost:8888/` redirects to the HTTPS host port, and that `docker exec <container> stellarr doctor` passes.
3. Write the guide in `docs/install/<platform>.md`, covering only what is specific to the platform, and link it from [`docs/README.md`](../docs/README.md), the table in [Platforms](../docs/install/platforms.md) and the table above.
