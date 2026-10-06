// Runs Whisper speech-to-text in the browser with Transformers.js.
// Receives 16 kHz mono PCM, posts back word-level timestamps.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;

const MODELS = ['onnx-community/whisper-base_timestamped', 'Xenova/whisper-base'];
const SAMPLE_RATE = 16000;
const MAX_CHUNK_S = 29;
const MIN_CHUNK_S = 18;

let asr = null;

async function hasWebGPU() {
  try {
    return Boolean(await navigator.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

async function load() {
  if (asr) return asr;
  const progress = (p) => {
    if (p.status === 'progress' && p.total) {
      self.postMessage({ type: 'loading', file: p.file, loaded: p.loaded, total: p.total });
    }
  };
  const gpu = await hasWebGPU();
  const attempts = [];
  for (const model of MODELS) {
    if (gpu) attempts.push({ model, device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
    attempts.push({ model, device: 'wasm', dtype: 'q8' });
  }
  let lastError;
  for (const { model, device, dtype } of attempts) {
    try {
      asr = await pipeline('automatic-speech-recognition', model, { device, dtype, progress_callback: progress });
      self.postMessage({ type: 'ready', model, device });
      return asr;
    } catch (err) {
      lastError = err;
      console.warn(`Could not load ${model} on ${device}`, err);
    }
  }
  throw lastError;
}

/** Splits audio into <30 s chunks, cutting at the quietest moment so words aren't split. */
function chunkBoundaries(audio) {
  const total = audio.length;
  const bounds = [];
  const win = Math.round(SAMPLE_RATE * 0.05);
  let start = 0;
  while (start < total) {
    const hardEnd = start + MAX_CHUNK_S * SAMPLE_RATE;
    if (hardEnd >= total) {
      bounds.push([start, total]);
      break;
    }
    let best = hardEnd;
    let bestEnergy = Infinity;
    for (let pos = start + MIN_CHUNK_S * SAMPLE_RATE; pos + win < hardEnd; pos += win) {
      let e = 0;
      for (let i = pos; i < pos + win; i++) e += audio[i] * audio[i];
      if (e < bestEnergy) {
        bestEnergy = e;
        best = pos + Math.round(win / 2);
      }
    }
    bounds.push([start, best]);
    start = best;
  }
  return bounds;
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'transcribe') return;
  try {
    const transcriber = await load();
    const audio = data.audio;
    const bounds = chunkBoundaries(audio);
    const words = [];
    for (let i = 0; i < bounds.length; i++) {
      const [s, e] = bounds[i];
      const offset = s / SAMPLE_RATE;
      const options = { return_timestamps: 'word' };
      if (data.language && data.language !== 'auto') {
        options.language = data.language;
        options.task = 'transcribe';
      }
      const out = await transcriber(audio.subarray(s, e), options);
      for (const c of out.chunks ?? []) {
        const text = c.text.trim();
        const [ws, we] = c.timestamp;
        if (!text || ws == null) continue;
        const end = we ?? ws + 0.3;
        words.push({ text, start: +(offset + ws).toFixed(3), end: +(offset + end).toFixed(3) });
      }
      self.postMessage({ type: 'progress', done: i + 1, total: bounds.length });
    }
    self.postMessage({ type: 'done', words });
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};
