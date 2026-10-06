/**
 * Renders selected time ranges of a video to a new file, entirely in the browser.
 *
 * Main path (Chrome, Edge, Safari 16.4+, Firefox 130+): decodes the source frame by
 * frame with WebCodecs (Mediabunny reads and writes the files), draws each frame onto a canvas (where
 * cropping, titles and captions happen), and encodes the result. It is
 * frame-accurate and never drops frames, however slow or busy the computer is.
 *
 * Fallback (no WebCodecs): plays each segment on a hidden <video> and records the
 * canvas in real time with MediaRecorder.
 */
import {
  Input,
  BlobSource,
  ALL_FORMATS,
  EncodedPacketSink,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSource,
  AudioBufferSource,
  Quality,
  getFirstEncodableVideoCodec,
  getFirstEncodableAudioCodec,
} from '/vendor/mediabunny.mjs';

const abortError = () => new DOMException('Render cancelled', 'AbortError');
const WINDOW_S = 2; // interleave video and audio in 2-second steps to keep memory flat

/** Picks MP4 (H.264 + AAC) when possible since that's what social platforms want. */
async function chooseFormat(width, height, hasAudio) {
  const avc = await getFirstEncodableVideoCodec(['avc'], { width, height });
  if (avc) {
    const audio = hasAudio ? await getFirstEncodableAudioCodec(['aac', 'opus']) : null;
    return { format: new Mp4OutputFormat({ fastStart: 'in-memory' }), video: avc, audio };
  }
  const video = await getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], { width, height });
  if (!video) return null;
  const audio = hasAudio ? await getFirstEncodableAudioCodec(['opus', 'vorbis']) : null;
  return { format: new WebMOutputFormat(), video, audio };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Index of key packets, built once by scanning packet metadata. (Mediabunny's own
 * key-packet lookup and decode helpers misbehave on Chrome's MediaRecorder WebM
 * files, which have no seek index, so decoding is done here with WebCodecs.)
 */
async function keyIndex(packetSink) {
  const keys = [];
  for await (const p of packetSink.packets(undefined, undefined, { metadataOnly: true })) {
    if (p.type === 'key') keys.push(p.timestamp);
  }
  return keys;
}

/** Decodes a run of packets starting from the key packet at or before `from`. */
class DecodeStream {
  constructor(packetSink, keys, from) {
    this.sink = packetSink;
    this.keys = keys;
    this.from = from;
    this.queue = [];
    this.done = false;
    this.error = null;
    this.notify = null;
  }

  async start(makeDecoder) {
    let key = this.keys[0] ?? 0;
    for (const k of this.keys) if (k <= this.from + 1e-6) key = k;
    const first = await this.sink.getPacket(key);
    this.iter = this.sink.packets(first ?? undefined);
    this.decoder = makeDecoder(
      (out) => {
        this.queue.push(out);
        this.notify?.();
      },
      (err) => (this.error = err)
    );
  }

  /** Feeds one more packet (or flushes at the end). Returns false when there's nothing left. */
  async pump() {
    if (this.error) throw this.error;
    if (this.done) return false;
    const r = await this.iter.next();
    if (r.done) {
      await this.decoder.flush();
      this.done = true;
      return true;
    }
    this.decode(r.value);
    if (this.decoder.decodeQueueSize > 6) await new Promise((res) => this.decoder.addEventListener('dequeue', res, { once: true }));
    if (!this.queue.length) await Promise.race([new Promise((res) => (this.notify = res)), sleep(4)]);
    return true;
  }

  close() {
    for (const item of this.queue) item.close?.();
    this.queue = [];
    if (this.decoder?.state !== 'closed') this.decoder?.close();
    this.iter?.return?.();
  }
}

class VideoFrameStream extends DecodeStream {
  async open(config) {
    await this.start((output, error) => {
      const d = new VideoDecoder({ output, error });
      d.configure(config);
      return d;
    });
    this.current = null;
    return this;
  }

  decode(packet) {
    this.decoder.decode(packet.toEncodedVideoChunk());
  }

  /** The frame on screen at time t (the latest frame starting at or before t). Times must increase. */
  async frameAt(t) {
    const limit = Math.round((t + 1e-4) * 1e6);
    for (;;) {
      while (this.queue.length && this.queue[0].timestamp <= limit) {
        this.current?.close();
        this.current = this.queue.shift();
      }
      if (this.queue.length || !(await this.pump())) return this.current ?? this.queue[0] ?? null;
    }
  }

  close() {
    this.current?.close();
    this.current = null;
    super.close();
  }
}

class AudioStream extends DecodeStream {
  async open(config, rate, channels) {
    this.rate = rate;
    this.channels = channels;
    await this.start((output, error) => {
      const d = new AudioDecoder({ output, error });
      d.configure(config);
      return d;
    });
    return this;
  }

  decode(packet) {
    this.decoder.decode(packet.toEncodedAudioChunk());
  }

  /** Exactly `length` samples covering [from, from + length / rate); silence where there's no audio. */
  async read(from, length) {
    const { rate, channels } = this;
    const out = Array.from({ length: channels }, () => new Float32Array(length));
    const to = from + length / rate;
    for (;;) {
      while (this.queue.length) {
        const data = this.queue[0];
        const start = data.timestamp / 1e6;
        const end = start + data.numberOfFrames / data.sampleRate;
        if (end <= from) {
          data.close();
          this.queue.shift();
          continue;
        }
        if (start >= to) break;
        const a = Math.max(from, start);
        const b = Math.min(to, end);
        const dst = Math.max(0, Math.round((a - from) * rate));
        const src = Math.max(0, Math.round((a - start) * data.sampleRate));
        const n = Math.min(length - dst, Math.round((b - a) * rate), data.numberOfFrames - src);
        if (n > 0) {
          for (let c = 0; c < channels; c++) {
            const tmp = new Float32Array(n);
            data.copyTo(tmp, {
              planeIndex: Math.min(c, data.numberOfChannels - 1),
              frameOffset: src,
              frameCount: n,
              format: 'f32-planar',
            });
            out[c].set(tmp, dst);
          }
        }
        if (end > to) {
          const buf = new AudioBuffer({ length: Math.max(1, length), numberOfChannels: channels, sampleRate: rate });
          out.forEach((d, c) => buf.copyToChannel(d, c));
          return buf;
        }
        data.close();
        this.queue.shift();
      }
      if (!(await this.pump())) break;
    }
    const buf = new AudioBuffer({ length: Math.max(1, length), numberOfChannels: channels, sampleRate: rate });
    out.forEach((d, c) => buf.copyToChannel(d, c));
    return buf;
  }
}

async function renderWithWebCodecs({ blob, segments, width, height, draw, onProgress, signal, canvas, fps }) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack || !(await videoTrack.canDecode())) throw new Error("This browser can't decode the video.");
    let audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack && !(await audioTrack.canDecode())) audioTrack = null;

    const choice = await chooseFormat(width, height, Boolean(audioTrack));
    if (!choice) throw new Error('No video encoder available in this browser.');
    if (!choice.audio) audioTrack = null;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const output = new Output({ format: choice.format, target: new BufferTarget() });
    const videoSource = new CanvasSource(canvas, { codec: choice.video, bitrate: new Quality('high'), keyFrameInterval: 2 });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource = null;
    let rate = 48000;
    let channels = 2;
    if (audioTrack) {
      rate = await audioTrack.getSampleRate();
      channels = Math.min(2, await audioTrack.getNumberOfChannels());
      audioSource = new AudioBufferSource({ codec: choice.audio, bitrate: new Quality('high') });
      output.addAudioTrack(audioSource);
    }
    await output.start();

    const videoPackets = new EncodedPacketSink(videoTrack);
    const videoKeys = await keyIndex(videoPackets);
    const videoConfig = await videoTrack.getDecoderConfig();
    let audioPackets = null;
    let audioKeys = null;
    let audioConfig = null;
    if (audioTrack) {
      audioPackets = new EncodedPacketSink(audioTrack);
      audioKeys = await keyIndex(audioPackets);
      audioConfig = await audioTrack.getDecoderConfig();
    }
    const totalFrames = segments.reduce((n, [s, e]) => n + Math.max(1, Math.round((e - s) * fps)), 0);
    let written = 0;
    const open = [];

    try {
      for (const [start, end] of segments) {
        const count = Math.max(1, Math.round((end - start) * fps));
        const video = await new VideoFrameStream(videoPackets, videoKeys, start).open(videoConfig);
        open.push(video);
        let audio = null;
        if (audioPackets) {
          audio = await new AudioStream(audioPackets, audioKeys, Math.max(0, start - 0.2)).open(audioConfig, rate, channels);
          open.push(audio);
        }
        for (let w = 0; w < count; w += WINDOW_S * fps) {
          const n = Math.min(WINDOW_S * fps, count - w);
          for (let k = 0; k < n; k++) {
            if (signal?.aborted) throw abortError();
            const t = start + (w + k) / fps;
            const frame = await video.frameAt(t);
            if (frame) draw(ctx, frame, t);
            await videoSource.add((written + k) / fps, 1 / fps);
          }
          if (audio) {
            // Exactly as many samples as the video frames cover, so cuts never drift out of sync.
            const samples = Math.round(((written + n) * rate) / fps) - Math.round((written * rate) / fps);
            await audioSource.add(await audio.read(start + w / fps, samples));
          }
          written += n;
          onProgress?.(written / totalFrames);
        }
        while (open.length) open.pop().close();
      }
      await output.finalize();
    } catch (err) {
      await output.cancel().catch(() => {});
      throw err;
    } finally {
      for (const stream of open) stream.close();
    }
    return new Blob([output.target.buffer], { type: choice.format.mimeType });
  } finally {
    input.dispose?.();
  }
}

// ---------- Real-time fallback (MediaRecorder) ----------

const once = (el, event) => new Promise((resolve) => el.addEventListener(event, resolve, { once: true }));

/** Loads a video and makes sure its duration is known (MediaRecorder files often report Infinity). */
export async function loadVideo(video, src) {
  video.src = src;
  if (video.readyState < 1) await once(video, 'loadedmetadata');
  if (!Number.isFinite(video.duration)) {
    video.currentTime = 1e101;
    await once(video, 'durationchange');
    video.currentTime = 0;
    await once(video, 'seeked');
  }
  return video.duration;
}

async function renderRealtime({ blob, segments, width, height, draw, onProgress, signal, canvas, fps }) {
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t)
  );
  const src = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.playsInline = true;
  await loadVideo(video, src);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const audioCtx = new AudioContext();
  await audioCtx.resume();
  const dest = audioCtx.createMediaStreamDestination();
  audioCtx.createMediaElementSource(video).connect(dest);
  const recorder = new MediaRecorder(
    new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]),
    { ...(mime && { mimeType: mime }), videoBitsPerSecond: 6_000_000 }
  );
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = once(recorder, 'stop');
  const total = segments.reduce((s, [a, b]) => s + b - a, 0) || 1;
  let done = 0;
  const tick = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.round(1000 / fps)})`])));
  tick.onmessage = () => draw(ctx, video, video.currentTime);
  try {
    recorder.start(1000);
    recorder.pause();
    for (const [start, end] of segments) {
      if (signal?.aborted) throw abortError();
      video.currentTime = start;
      await once(video, 'seeked');
      recorder.resume();
      await video.play();
      while (video.currentTime < end && !video.ended) {
        if (signal?.aborted) throw abortError();
        await new Promise((r) => setTimeout(r, 30));
        onProgress?.((done + video.currentTime - start) / total);
      }
      video.pause();
      recorder.pause();
      done += end - start;
    }
    recorder.stop();
    await stopped;
  } finally {
    tick.terminate();
    if (recorder.state !== 'inactive') recorder.stop();
    audioCtx.close();
    URL.revokeObjectURL(src);
  }
  const type = (recorder.mimeType || 'video/webm').split(';')[0];
  let out = new Blob(chunks, { type });
  if (type === 'video/webm') out = await MeetingRecorder.fixWebmDuration(out, total * 1000);
  return out;
}

/**
 * @param {object} o
 * @param {Blob} o.blob                source video file
 * @param {Array<[number, number]>} o.segments  source time ranges to keep, in order
 * @param {number} o.width, o.height   output size
 * @param {(ctx, frame, t) => void} o.draw  draws one output frame; `frame` is a canvas or video element
 * @param {(fraction) => void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 * @param {HTMLCanvasElement} [o.canvas]  canvas to draw on (lets the UI show a live preview)
 * @returns {Promise<Blob>}
 */
export async function render(options) {
  const opts = { fps: 30, canvas: document.createElement('canvas'), ...options };
  if (typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined') {
    try {
      return await renderWithWebCodecs(opts);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('WebCodecs render failed, falling back to real-time rendering', err);
    }
  }
  return renderRealtime(opts);
}

export const extensionFor = (blob) => (blob.type.includes('mp4') ? 'mp4' : 'webm');
