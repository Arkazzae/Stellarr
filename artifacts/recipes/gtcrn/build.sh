#!/bin/sh
# Builds gtcrn.wasm: the GTCRN noise suppressor as a WebAssembly module that
# needs no JavaScript of its own. It imports nothing and exports its memory,
# malloc and free, and the three gtcrn_* functions the worklet calls
# (web/src/stellarr/lib/voice/capture/gtcrn/).
#
#   build.sh <pffft checkout> <gtcrn-wasm checkout> <generated C> <output directory>
#
# The root Dockerfile runs it in the recipe's stage, which pins the
# toolchain image and the sources. generate.sh wrote the model's C; this
# compiles it with
#
# - gtcrn_gru.c, from gtcrn-wasm: the four bidirectional GRUs, by hand;
# - gtcrn_dsp.c, ours, derived from gtcrn-wasm's: the STFT, the 3:1
#   resampler and the 768-sample frame the worklet feeds;
# - pffft, the FFT, in its WebAssembly SIMD form.
#
# The toolchain is wasi-sdk: clang, wasm-ld and wasi-libc, whose malloc and
# libm are linked in statically.
set -eu

pffft=$(cd "$1" && pwd)
wasm=$(cd "$2" && pwd)/build
generated=$(cd "$3" && pwd)
out=$4
recipe=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)

# The WebAssembly features the build may use, as RNNoise's build file names
# them (see there for why each, and which browsers they need): the Speex
# list plus simd128, which pffft's wasm path and the compiler's own
# vectorizer use. No relaxed SIMD (pffft would use fused multiply-add with
# it, which rounds differently) and no threads.
features="bulk-memory bulk-memory-opt call-indirect-overlong extended-const multivalue mutable-globals nontrapping-fptoint reference-types sign-ext simd128"
cpu="-mcpu=mvp"
for feature in $features; do cpu="$cpu -m$feature"; done

compile() {
  # $1 source, $2 object name, the rest extra flags. Relative names and the
  # prefix maps keep the build's directories out of what the compiler
  # records. $cpu is a list of flags, split on purpose. NDEBUG: pffft's
  # asserts would reach __assert_fail, which writes to stderr, an import.
  src=$1
  obj=$2
  shift 2
  /opt/wasi-sdk/bin/clang --target=wasm32-wasip1 -O2 $cpu -DNDEBUG \
    -ffile-prefix-map="$pffft"=pffft -ffile-prefix-map="$wasm"=gtcrn-wasm \
    -ffile-prefix-map="$generated"=generated -ffile-prefix-map="$recipe"=recipe -ffile-prefix-map="$work"=work \
    "$@" -c "$src" -o "$work/$obj.o"
}

# onnx2c's three parts each define `entry`; the glue calls them by the names
# gtcrn-wasm's build gives them.
for i in 0 1 2; do
  compile "$generated/gtcrn_part$i.c" "part$i" "-Dentry=entry_p$i"
done
compile "$generated/gtcrn_glue.c" glue
compile "$generated/gtcrn_gru_weights.c" weights
compile "$wasm/gtcrn_gru.c" gru
compile "$recipe/gtcrn_dsp.c" dsp -I"$pffft/include/pffft"
compile "$recipe/pffft_quiet.c" pffft -I"$pffft/include/pffft" -I"$pffft/src"
compile "$pffft/src/pffft_common.c" pffft_common -I"$pffft/include/pffft" -I"$pffft/src"

# The stack comes first in memory, so that a call deeper than it traps on
# the module's first address instead of writing over the data after it.
mkdir -p "$out"
/opt/wasi-sdk/bin/clang --target=wasm32-wasip1 -O2 $cpu -nostartfiles \
  -Xlinker --features="$(printf '%s' "$features" | tr ' ' ',')" \
  -Wl,--no-entry -Wl,--strip-all -Wl,--stack-first -Wl,-z,stack-size=131072 \
  -Wl,--export=malloc -Wl,--export=free \
  -Wl,--export=gtcrn_create \
  -Wl,--export=gtcrn_destroy \
  -Wl,--export=gtcrn_process_48k \
  "$work"/*.o \
  -o "$out/gtcrn.wasm"
rm -rf "$work"

# The worklet instantiates the module with an empty import object, so a
# single import (a WASI call pulled in through stdio, say) would fail every
# browser at run time; fail here instead.
headers=$(/opt/wasi-sdk/bin/llvm-objdump --section-headers "$out/gtcrn.wasm")
if printf '%s\n' "$headers" | grep -q ' IMPORT '; then
  echo "gtcrn.wasm imports something:" >&2
  /opt/wasi-sdk/bin/llvm-strings -n 5 "$out/gtcrn.wasm" | head -60 >&2
  exit 1
fi
if /opt/wasi-sdk/bin/llvm-strings "$out/gtcrn.wasm" | grep -q -e "$pffft" -e "$wasm" -e "$generated" -e "$recipe" -e "$work" -e '/opt/' -e '/tmp/'; then
  echo "gtcrn.wasm names a path of the build machine." >&2
  exit 1
fi
