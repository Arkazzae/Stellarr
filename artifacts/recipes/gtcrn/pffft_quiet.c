/* pffft.c without its diagnostics.
 *
 * pffft's source holds a self-test of its SIMD macros, which prints with
 * printf and fprintf, and nothing here calls it. The linker cannot tell
 * before it drops what is unused: the references make it take in the C
 * library's stdio, whose exit handler imports four WASI functions that
 * gtcrn.wasm must not import. So the stdio calls are made to vanish before
 * the source is read, and the self-test stays in as dead code the linker
 * then drops.
 */
#include <stdio.h>

#define printf(...) 0
#define fprintf(...) 0
#define fwrite(...) 0

#include "pffft.c"
