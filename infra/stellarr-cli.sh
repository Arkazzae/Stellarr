#!/bin/sh
# The operator CLI published next to the API's runtime. The publish is
# architecture-neutral, so the image's own .NET runtime executes it; no apphost
# for the build machine's CPU is copied into a multi-architecture image.
exec /usr/bin/dotnet /opt/stellarr/cli/Stellarr.Cli.dll "$@"
