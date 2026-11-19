/* PCM front-end around the onnx2c-generated GTCRN model.
 *
 * From gtcrn_dsp.c of sapphi-red/gtcrn-wasm 0.0.3 (MIT, Copyright (c) 2026
 * sapphi-red), which artifacts/NOTICES keeps the licence of. What changed:
 * the Emscripten header and attribute are gone, since build.sh exports by
 * the linker's flags, and only what the worklet calls is exported.
 *
 * STFT: n_fft 512, hop 256, sqrt(periodic hann) window, 50% overlap-add
 * (window^2 sums to 1), matching upstream gtcrn/stream processing.
 *
 * pffft real-FFT ordered layout: fwd out[0]=Re(bin0), out[1]=Re(bin256),
 * out[2k],out[2k+1]=Re,Im of bin k (k=1..255); backward takes the same
 * layout and is unscaled (scale by 1/512 here). */
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "pffft.h"

#define FFT_SIZE 512
#define HOP 256
#define BINS 257
#define HOST_HOP (HOP * 3)
#define RESAMPLER_TAPS 63
#define RESAMPLER_HISTORY (RESAMPLER_TAPS - 1)
#define RESAMPLER_DELAY (RESAMPLER_TAPS / 2)

void entry(const float tensor_mix[1][257][1][2],
           const float tensor_conv_cache[2][1][16][16][33],
           const float tensor_tra_cache[2][3][1][1][16],
           const float tensor_inter_cache[2][1][33][16],
           float tensor_enh[1][257][1][2],
           float tensor_conv_cache_out[2][1][16][16][33],
           float tensor_tra_cache_out[2][3][1][1][16],
           float tensor_inter_cache_out[2][1][33][16]);

#define CONV_N (2 * 16 * 16 * 33)
#define TRA_N (2 * 3 * 16)
#define INTER_N (2 * 33 * 16)

typedef struct {
  PFFFT_Setup *fft;
  float *fft_buf;  /* aligned, FFT_SIZE floats, in/out of pffft */
  float win[FFT_SIZE];
  float in_buf[FFT_SIZE];   /* sliding input window (last 2 hops) */
  float ola_tail[HOP];      /* overlap-add carry-over */
  float mix[BINS][2];
  float enh[BINS][2];
  float conv[CONV_N], conv_o[CONV_N];
  float tra[TRA_N], tra_o[TRA_N];
  float inter[INTER_N], inter_o[INTER_N];
  float down_coeff[RESAMPLER_TAPS];
  float up_coeff[3][RESAMPLER_TAPS];
  float down_history[RESAMPLER_HISTORY];
  float up_history[RESAMPLER_HISTORY];
  float down_work[RESAMPLER_HISTORY + HOST_HOP];
  float up_work[RESAMPLER_HISTORY + HOP];
} GtcrnState;

static float sinc(float x) {
  if (fabsf(x) < 1e-6f) return 1.0f;
  return sinf((float)M_PI * x) / ((float)M_PI * x);
}

static float resampler_window(int index) {
  return 0.5f - 0.5f * cosf(2.0f * (float)M_PI * index /
                             (RESAMPLER_TAPS - 1));
}

static void init_resampler(GtcrnState *st) {
  float sum = 0.0f;
  const float cutoff = 1.0f / 6.0f;
  const float center = (float)RESAMPLER_DELAY;
  for (int k = 0; k < RESAMPLER_TAPS; k++) {
    const float offset = (float)k - center;
    st->down_coeff[k] = 2.0f * cutoff * sinc(2.0f * cutoff * offset) *
                        resampler_window(k);
    sum += st->down_coeff[k];
  }
  for (int k = 0; k < RESAMPLER_TAPS; k++) st->down_coeff[k] /= sum;

  for (int phase = 0; phase < 3; phase++) {
    sum = 0.0f;
    const float fraction = (float)phase / 3.0f;
    for (int k = 0; k < RESAMPLER_TAPS; k++) {
      const float offset = fraction - center + (float)k;
      st->up_coeff[phase][k] = sinc(offset) * resampler_window(k);
      sum += st->up_coeff[phase][k];
    }
    for (int k = 0; k < RESAMPLER_TAPS; k++) st->up_coeff[phase][k] /= sum;
  }
}

static void resample_down(GtcrnState *st, const float input[HOST_HOP],
                           float output[HOP]) {
  memcpy(st->down_work, st->down_history,
         sizeof(float) * RESAMPLER_HISTORY);
  memcpy(st->down_work + RESAMPLER_HISTORY, input,
         sizeof(float) * HOST_HOP);
  for (int n = 0; n < HOP; n++) {
    const int position = RESAMPLER_HISTORY + n * 3 + 2;
    float value = 0.0f;
    for (int k = 0; k < RESAMPLER_TAPS; k++)
      value += st->down_work[position - k] * st->down_coeff[k];
    output[n] = value;
  }
  memcpy(st->down_history, st->down_work + HOST_HOP,
         sizeof(float) * RESAMPLER_HISTORY);
}

static void resample_up(GtcrnState *st, const float input[HOP],
                         float output[HOST_HOP]) {
  memcpy(st->up_work, st->up_history, sizeof(float) * RESAMPLER_HISTORY);
  memcpy(st->up_work + RESAMPLER_HISTORY, input, sizeof(float) * HOP);
  for (int n = 0; n < HOST_HOP; n++) {
    const int position = RESAMPLER_HISTORY + n / 3;
    const int phase = n % 3;
    float value = 0.0f;
    for (int k = 0; k < RESAMPLER_TAPS; k++)
      value += st->up_work[position - k] * st->up_coeff[phase][k];
    output[n] = value;
  }
  memcpy(st->up_history, st->up_work + HOP,
         sizeof(float) * RESAMPLER_HISTORY);
}

GtcrnState *gtcrn_create(void) {
  GtcrnState *st = calloc(1, sizeof(GtcrnState));
  if (!st) return NULL;
  st->fft = pffft_new_setup(FFT_SIZE, PFFFT_REAL);
  st->fft_buf = pffft_aligned_malloc(FFT_SIZE * sizeof(float));
  if (!st->fft || !st->fft_buf) {
    if (st->fft) pffft_destroy_setup(st->fft);
    if (st->fft_buf) pffft_aligned_free(st->fft_buf);
    free(st);
    return NULL;
  }
  for (int n = 0; n < FFT_SIZE; n++) {
    float hann = 0.5f * (1.0f - cosf(2.0f * (float)M_PI * n / FFT_SIZE));
    st->win[n] = sqrtf(hann);
  }
  init_resampler(st);
  return st;
}

void gtcrn_destroy(GtcrnState *st) {
  if (!st) return;
  pffft_destroy_setup(st->fft);
  pffft_aligned_free(st->fft_buf);
  free(st);
}

static void gtcrn_model_run(const float *mix, const float *conv, const float *tra,
                     const float *inter, float *enh, float *conv_o,
                     float *tra_o, float *inter_o) {
  entry((const float(*)[257][1][2])mix, (const float(*)[1][16][16][33])conv,
        (const float(*)[3][1][1][16])tra, (const float(*)[1][33][16])inter,
        (float(*)[257][1][2])enh, (float(*)[1][16][16][33])conv_o,
        (float(*)[3][1][1][16])tra_o, (float(*)[1][33][16])inter_o);
}

static void gtcrn_process_model(GtcrnState *st, const float input[HOP],
                                float output[HOP]) {
  /* Slide the analysis window one hop and append the new samples. */
  memmove(st->in_buf, st->in_buf + HOP, HOP * sizeof(float));
  memcpy(st->in_buf + HOP, input, HOP * sizeof(float));

  /* Windowed forward FFT -> mix[257][2]. */
  for (int n = 0; n < FFT_SIZE; n++)
    st->fft_buf[n] = st->in_buf[n] * st->win[n];
  pffft_transform_ordered(st->fft, st->fft_buf, st->fft_buf, NULL,
                          PFFFT_FORWARD);
  st->mix[0][0] = st->fft_buf[0];
  st->mix[0][1] = 0.0f;
  st->mix[FFT_SIZE / 2][0] = st->fft_buf[1];
  st->mix[FFT_SIZE / 2][1] = 0.0f;
  for (int k = 1; k < FFT_SIZE / 2; k++) {
    st->mix[k][0] = st->fft_buf[2 * k];
    st->mix[k][1] = st->fft_buf[2 * k + 1];
  }

  gtcrn_model_run((const float *)st->mix, st->conv, st->tra, st->inter,
                  (float *)st->enh, st->conv_o, st->tra_o, st->inter_o);
  memcpy(st->conv, st->conv_o, sizeof(st->conv));
  memcpy(st->tra, st->tra_o, sizeof(st->tra));
  memcpy(st->inter, st->inter_o, sizeof(st->inter));

  /* Inverse FFT (imag parts of DC/Nyquist are dropped, as in irfft). */
  st->fft_buf[0] = st->enh[0][0];
  st->fft_buf[1] = st->enh[FFT_SIZE / 2][0];
  for (int k = 1; k < FFT_SIZE / 2; k++) {
    st->fft_buf[2 * k] = st->enh[k][0];
    st->fft_buf[2 * k + 1] = st->enh[k][1];
  }
  pffft_transform_ordered(st->fft, st->fft_buf, st->fft_buf, NULL,
                          PFFFT_BACKWARD);

  /* Scale, synthesis-window, overlap-add; emit one hop. */
  for (int n = 0; n < FFT_SIZE; n++)
    st->fft_buf[n] *= st->win[n] / FFT_SIZE;
  for (int n = 0; n < HOP; n++) {
    output[n] = st->ola_tail[n] + st->fft_buf[n];
    st->ola_tail[n] = st->fft_buf[HOP + n];
  }
}

void gtcrn_process_48k(GtcrnState *st, const float *input, float *output) {
  float model_input[HOP];
  float model_output[HOP];
  resample_down(st, input, model_input);
  gtcrn_process_model(st, model_input, model_output);
  resample_up(st, model_output, output);
}
