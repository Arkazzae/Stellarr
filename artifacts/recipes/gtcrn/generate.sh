#!/bin/sh
# Turns upstream's streaming GTCRN model into C: the first half of the
# gtcrn recipe. build.sh compiles what this writes.
#
#   generate.sh <gtcrn checkout> <onnx2c checkout> <gtcrn-wasm checkout> <output directory>
#
# It is the pipeline of gtcrn-wasm's build/build-wasm.sh up to the compile,
# run here on pinned inputs:
#
# 1. rewrite_gru.py takes the 10 unidirectional GRUs of gtcrn_simple.onnx
#    apart into matrix products and activations, which onnx2c can convert,
#    and splits the graph around the 4 bidirectional ones, which run as the
#    hand-written loop in gtcrn_gru.c. It checks the parts against
#    onnxruntime on the way.
# 2. onnx2c turns each of the three parts into C, weights included.
# 3. The C is compiled natively and run against the original model in
#    onnxruntime, over chained frames, so a conversion that drifted fails
#    here and not in a listener's ear.
#
# The output holds gtcrn_part{0,1,2}.c, gtcrn_glue.c and gtcrn_gru_weights.c.
# Nothing in it is committed: the tools and their inputs are pinned by the
# Dockerfile and the result is rebuilt each time.
set -eu

gtcrn=$(cd "$1" && pwd)
onnx2c=$(cd "$2" && pwd)
wasm=$(cd "$3" && pwd)/build
out=$4
# A fixed directory, not mktemp's: onnx2c writes its command line, paths
# included, into a comment of every file it generates.
work=/tmp/gtcrn-generate
rm -rf "$work"
mkdir -p "$work"

mkdir -p "$out"
# rewrite_gru.py walks sets of strings, whose order Python seeds anew in every
# process; it decides the order tensors are declared and passed in, and with it
# where the compiler puts them in the binary. Fix the seed.
export PYTHONHASHSEED=0
python3 "$wasm/rewrite_gru.py" "$gtcrn/stream/onnx_models/gtcrn_simple.onnx" "$work"
grep -q "void entry(const float tensor_mix\[1\]\[257\]\[1\]\[2\]" "$work/gtcrn_glue.c" \
  || { echo "The generated glue's entry signature changed; update gtcrn_dsp.c." >&2; exit 1; }

# onnx2c builds with -Werror, and Debian's GCC 12 reports a -Wrestrict that
# is not there (a known false positive of std::string in 12) in graph.cc.
# The warning cannot change what the tool writes.
cmake -S "$onnx2c" -B "$work/onnx2c-build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS=-Wno-error=restrict
cmake --build "$work/onnx2c-build" --parallel 4 --target onnx2c
for i in 0 1 2; do
  "$work/onnx2c-build/onnx2c" "$work/gtcrn_part$i.onnx" > "$work/gtcrn_part$i.c"
done

for i in 0 1 2; do
  cc -O1 -c "-Dentry=entry_p$i" "$work/gtcrn_part$i.c" -o "$work/native_part$i.o"
done
cc -O1 -o "$work/native_check" "$wasm/native_harness.c" "$wasm/gtcrn_gru.c" \
  "$work/gtcrn_glue.c" "$work/gtcrn_gru_weights.c" \
  "$work/native_part0.o" "$work/native_part1.o" "$work/native_part2.o" -lm
python3 "$wasm/check_native.py" "$work/native_check" "$gtcrn/stream/onnx_models/gtcrn_simple.onnx"

cp "$work"/gtcrn_part0.c "$work"/gtcrn_part1.c "$work"/gtcrn_part2.c \
   "$work"/gtcrn_glue.c "$work"/gtcrn_gru_weights.c "$out/"
rm -rf "$work"
