# Recipes

A recipe builds one or more of the files in [`../manifest.json`](../manifest.json) from source, in place of a file committed under `../files/`. The others are still committed copies of third-party builds.

| Recipe | Builds | From |
| --- | --- | --- |
| [`speex/`](speex/) | `speex.wasm`, served at `/audio/speex.wasm` | SpeexDSP's preprocessor, with wasi-sdk |
| [`bergamot/`](bergamot/) | `bergamot-translator.wasm` and its glue `bergamot-translator.js`, served under `/codecs/bergamot/` | Mozilla's Bergamot translation engine at v0.6.0, with Emscripten 3.1.8 on linux/amd64 |
| [`rnnoise/`](rnnoise/) | `rnnoise.wasm`, served at `/audio/rnnoise.wasm` | Xiph's RNNoise with its newest model compiled in, with wasi-sdk, matrix products in WebAssembly SIMD |
| [`gtcrn/`](gtcrn/) | `gtcrn.wasm`, served at `/audio/gtcrn.wasm` | The GTCRN streaming model, converted to C by onnx2c in a pinned Python and Debian image, with wasi-sdk and pffft's WebAssembly SIMD path |

## Building them

```sh
docker buildx bake recipes
```

From the repository root, with Docker and its buildx plugin (Docker Desktop has both). It builds every recipe named in [`../../docker-bake.hcl`](../../docker-bake.hcl) into its `out/` folder, from the same Dockerfile stages the image build runs. Run it once in a fresh checkout or worktree, and again after a recipe changes, before `npm run dev`, `npm test` or `npm run build` in `web/`. Those run [`../assemble.mjs`](../assemble.mjs) first, which reads the outputs from `out/` and refuses a missing one or one whose bytes differ from the manifest; it never starts Docker itself. The `web` service of `docker-compose.dev.yml` sees the outputs through its bind mount, so the same command, run on the host, serves it too.

A build that is already cached takes seconds. A cold one fetches the recipe's toolchain first; Speex's, the wasi-sdk image, is 776 MB compressed. Bergamot's is a 318 MB Emscripten archive; the recipe runs emulated on an arm64 machine (see "A reproducible result"), and a cold build of it took 13 to 28 minutes on a busy Apple one.

## What a recipe is

A folder `artifacts/recipes/<name>/`, where `<name>` is lower case letters, digits and dashes, holding:

1. **A build file** that turns the pinned inputs into the output files and nothing else, such as `build.sh`, with whatever small sources or headers of our own the build needs. It runs inside the recipe's stage, never on the host. It names the WebAssembly features the output may use and fails when the output would use another (see "Pin the WebAssembly features" below), as it fails on an import the worklet cannot satisfy.
2. **The outputs the manifest names**, which the build writes flat into `artifacts/recipes/<name>/out/`. That folder is ignored by git and left out of the Docker context.

and its stages in the root [`Dockerfile`](../../Dockerfile), which hold every pin of the recipe in one place:

- the image the stage starts from, a toolchain image or a plain base image, by tag and the digest of its multi-platform index, so that an arm64 and an amd64 build machine both resolve it;
- each source by full commit hash, with `ADD <repository>.git#<commit>`, which BuildKit fetches by that commit (an archive GitHub generates is not byte-stable, so it is never pinned by hash);
- each other download, a toolchain installed into a base image among them, by URL and sha256: with `ADD --checksum=sha256:<hash> <url>`, which BuildKit checks, or fetched by a step of the build file that checks the sha256 itself.

The digest has to be in the `FROM` line, so the pins sit in the Dockerfile rather than in the recipe's folder; a build file that downloads names its own URLs and hashes, and the stage says so beside its `RUN`. Nothing is taken from a branch, a "latest" tag or a package manager without a lock (Debian's packages are pinned through snapshot.debian.org at a date).

Fetching and building are separate steps. A step that needs the network fetches and checks inputs; the compile runs as `RUN --network=none`, so it can use nothing that was not pinned, and a step that changes does not repeat the steps before it. Speex fetches with `ADD` alone and compiles in one network-free step; a recipe with a toolchain to install, sources to fetch and a long compile has a `RUN` for each. Each step should leave in its layer only what the next one needs: a build tree left behind is copied by every cache that holds the layer.

## A reproducible result

The manifest records one sha256 per output and the assemble step refuses anything else, so the same inputs must give the same bytes on every machine and in every run. By default a recipe's stages run on the build machine's platform, `$RECIPE_PLATFORM`: arm64 on an Apple machine, amd64 on the CI runner. Prove that this holds for a new recipe before anything is built on it:

```sh
docker buildx build --no-cache --target recipe-<name> --output type=local,dest=/tmp/a .
docker buildx build --no-cache --target recipe-<name> --output type=local,dest=/tmp/b .
docker buildx bake recipes --set '*.args.RECIPE_PLATFORM=linux/amd64'
```

The last runs the stages on the other platform, emulated; all three must give the manifest's sha256, and the `recipes` job's summary in CI shows the runner's.

When two platforms give different bytes and nothing of the machine leaks in, look at the toolchain first: the same release can be a different compiler on each host. Compare what it reports on both (`clang --version`, `emcc -v`, `wasm-opt --version`, the libraries it links), not only its version number. Emscripten is the known case: emsdk serves a different archive per host for one release, with a different LLVM revision and wasm-opt build in each. wasi-sdk's image is not: on arm64 and amd64 it reports the same LLVM revision, 4434dabb, and carries byte-identical libraries, and Speex's bytes agree.

A recipe whose toolchain differs by host pins its platform: both its stages say `--platform=linux/amd64` instead of `$RECIPE_PLATFORM`, with a comment saying why. amd64 is the CI runner's own platform, so it costs nothing there; on an arm64 machine the stages run emulated, once per cache. Everything else stays the same: the bake file, the CI jobs and the image build take a pinned recipe beside the others, and `RECIPE_PLATFORM` no longer moves it.

What leaks into bytes, and how Speex keeps it out:

- **Paths.** `__FILE__` in asserts carries the build directory. Override the library's fatal-error hook so the file name is dropped, add `-ffile-prefix-map`, and have the build file fail when `strings` of the output shows a path.
- **Timestamps and parallelism.** Compile one file at a time; let no tool stamp the date.
- **The host's own math.** A compiler folds a call such as `exp(constant)` with the build machine's libm, not the target's. Speex had none to fold; the arm64 and amd64 runs are the test.

## Switching an artifact to a recipe

1. Add the folder, and its stages to the root `Dockerfile` beside Speex's: a build stage, `FROM --platform=$RECIPE_PLATFORM <image>@<digest> AS recipe-<name>-build` (or the platform the recipe pins), with its fetching steps and its network-free compile, and `FROM --platform=$RECIPE_PLATFORM scratch AS recipe-<name>`, which copies only the outputs. Without the platform the outputs stage would belong to each platform the image is built for, and `web-build`, which copies from it, would be built once per platform in a release. Copy in only the recipe's own folder, and after the steps that do not need it, so that editing the build file does not fetch the toolchain and the sources again, and so that the stages depend on that folder alone.
2. In the `web-build` stage, `COPY --from=recipe-<name> / artifacts/recipes/<name>/out/` before `npm run build`.
3. Add `<name>` to `RECIPES` in `docker-bake.hcl`.
4. Change the artifact's `source` in the manifest to `{ "recipe": "<name>", "output": "<file name>" }`, and update its `sha256`, `size`, `upstream` (the project, the pinned commit, and in `verified` what the bytes were checked against) and `license`. Its `id` and `path` stay, so the client does not change.
5. Write what is in the binary into `../NOTICES`: the copyright holders of the files compiled, and of every part of the C library that got linked in. `-Wl,--why-extract=<file>` on the link lists the archive members.
6. Delete the committed copy under `../files/`, and its line in `.gitignore` and `.dockerignore` if it is no longer assembled.

`web/src/stellarr/lib/artifacts.test.ts` fails when a recipe the manifest names lacks its stage, its copy into `web-build` or its place in the bake file. CI needs no edit: the `recipes` job builds the bake group, and the image job and the release workflow find each recipe by its folder.

## In CI

The `recipes` job of `.github/workflows/ci.yml` is the one job of a run that builds recipes. It runs the bake with a GitHub Actions cache per recipe (scope `recipe-<name>`) and uploads the outputs as the workflow artifact `recipe-outputs`. The `web` job puts them in place before its npm scripts. The `image` job hands each `out/` folder to the build as a context named `recipe-<name>`, which replaces that stage, so it never builds a recipe either. A run reads the caches of its own branch or pull request and of `main`, so a recipe that did not change costs seconds, and one that changed is built once, in the `recipes` job, whose timeout is sized for the slowest recipe. The release workflow reads `main`'s recipe caches.

A recipe's cache holds its outputs and nothing else (`mode=min`): a few kilobytes for Speex, about 5 MB for a translator. That is enough for a recipe that did not change to come whole from the cache, without its toolchain even being pulled, which a fresh builder showed for Speex. A recipe that changed starts again from its first step, which costs a recipe the minute or so its fetching takes and no more. `mode=max` would keep every layer of every step, the toolchain among them: Speex's first run with it wrote 776 MB of wasi-sdk's layers in 41 s, and a 1.5 GB toolchain would be as much again, in a repository cache whose limit is 10 GB and which the image job's own `mode=max` cache (3.4 GB on `main`) and CodeQL's databases (3.3 GB) mostly fill already. When the limit is passed, GitHub drops the entries read longest ago first; a recipe's output entry is read by every run, so it is among the last to go, and if it does go, the next run builds the recipe once, in this job.

## Things learned with Speex

- **No generated JavaScript.** Build with wasi-sdk's clang for `wasm32-wasip1` with `-nostartfiles -Wl,--no-entry` and an explicit `-Wl,--export=` for each function the worklet calls, plus `malloc` and `free`. wasi-libc's libm and dlmalloc link in statically and import nothing; anything that reaches stdio or `exit` pulls in a WASI import, which the build file refuses, since the worklet instantiates the module with an empty import object. C++ with static constructors needs `__wasm_call_ctors` exported and called once.
- **Pin the WebAssembly features and check them.** A compiler's default CPU grows with its releases, and with it what a browser must support to load the binary. A recipe names its baseline CPU and every feature one by one, in the compile and in the link, and says beside them which browser releases they need: Speex gives clang `-mcpu=mvp` and `-m<feature>` for each of nine features, and wasm-ld `-Xlinker --features=<the same list>`, which refuses the link when any object, the C library's included, was built with a feature outside it. Read the list from what the build enables today, the `target_features` section of each object before the link strips it, and add nothing the binary does not use: no threads, and SIMD only where a recipe's own kernels are written for it (RNNoise adds `simd128`, which every browser the rest of the list already requires has). wasi-libc in the wasi-sdk 33 image is built for clang's `lime1` CPU, which brings `extended-const` into any link that takes it. Pass the list to the linker with `-Xlinker`: clang splits `-Wl,` at commas.
- **Configure by hand.** Instead of running autotools, compile only the files the output needs, with the macros the library's configure would have chosen: read its `configure.ac`, and the configuration of the build being replaced. A function the output never calls but a compiled file names (Speex's echo canceller) can be a stub that traps instead of another file compiled in.
- **Same output first.** Before anything else, compare the new build's output with the old one's, sample for sample: `npm run bench:voice-suppressor -w stellarr-web -- --engine <engine> --before <revision>` renders the fixtures through both in Chrome (see `web/bench/voice/README.md`). Speex came out identical on every fixture once the float build, the smallft FFT and `-O2` matched the old configure's choices; the one difference since is a deliberate one, the clamp of samples past full scale, which moves only the `clipping` fixture. `--write-outputs` keeps both outputs as WAV files, for judging a change by ear.
- **The worklet is ours.** Speex's compiles its small binary in its constructor; RNNoise's, which is megabytes, is compiled by the main thread and only instantiated in the constructor (see `noiseSuppression.ts`). Either cleans from the first render quantum, starts its port by assigning `onmessage` (the published worklets used `addEventListener`, which never starts it, so they never heard "destroy"), allocates nothing per quantum, and makes its typed-array views again when the module's memory grows.
- **bake writes only inside the repository** unless given `--allow=fs.write=<path>`; `--set '*.output=…'` to a folder elsewhere fails for that reason.

## Things learned with GTCRN

GTCRN has a generation step before the compile: upstream's ONNX model goes through a Python script and onnx2c to become C. Its stages (`recipe-gtcrn-tools`, `-generate`, `-c`, `-build`) split that as the rules above say: packages are fetched in one step, the generation and the compile run with `--network=none`, and no generated C is committed.

- **Debian packages need the image's own suites.** The image's sources name two snapshots of 2026-11-04, `debian` for bookworm and bookworm-updates and `debian-security` for bookworm-security. A snapshot of `bookworm` alone puts older perl and libc packages beside newer ones in the image, and apt refuses the install. Name the same snapshots, over http (the image has no certificates yet; apt checks the signatures).
- **Two cold builds of the same inputs gave different bytes, and the cause was Python.** `rewrite_gru.py` walks sets of strings, so the order tensors are declared and passed in changed from process to process, and the compiler placed two arrays in the other order: six bytes of the binary, two data addresses swapped. Found by building the generation stage several times and diffing the C, which is the quickest way to find this kind of leak; fixed with `PYTHONHASHSEED=0`, after which four generations gave the same C. onnx2c also writes its command line, paths included, into a comment of every file, so it runs in a fixed directory and not mktemp's.
- **Tool builds have their own traps.** onnx2c's timestamp submodule needs `git` installed to configure at all, and its `-Werror` fails on a false `-Wrestrict` in Debian's GCC 12; neither affects what it writes.
- **A library's self-test can pull in stdio.** pffft's source holds a printing self-test that nothing calls, but its references make the linker take in stdio, whose exit handler imports four WASI functions. `pffft_quiet.c` includes pffft with the printing calls made to vanish. The build file's import check caught it.
- **Platforms agree.** arm64 twice, cold, and amd64 emulated gave the same sha256, with the generation on Python wheels chosen by hash for each platform; no platform pin is needed.
- **Same output, bit for bit.** The model, the 768-sample frame, the resampler and the STFT are unchanged, and the new compiler, libm and pffft's WebAssembly SIMD path gave the same samples as the Emscripten build on every fixture within full scale (see `web/bench/voice/README.md`). `-O2` makes the module 477 KB and 0.20 ms of render per 10 ms of audio; `-Os` is 307 KB and 0.32 ms. A remote strip runs one per voice, so the CPU won.
