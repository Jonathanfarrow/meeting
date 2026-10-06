/**
 * MeetingRecorder composites every participant tile onto a canvas, mixes all
 * audio tracks with the Web Audio API, records the result with MediaRecorder
 * and downloads the finished file to the user's computer. Nothing is uploaded.
 *
 *   getTiles()  -> [{ video, name, showVideo, contain }]
 *   getAudio()  -> [MediaStreamTrack]
 */
class MeetingRecorder {
  constructor({ getTiles, getAudio, fileName, width = 1280, height = 720, fps = 30 }) {
    this.getTiles = getTiles;
    this.getAudio = getAudio;
    this.fileName = fileName;
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.recording = false;
  }

  static pickMimeType() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=avc1,mp4a',
      'video/mp4',
    ];
    return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? '';
  }

  static isSupported() {
    return Boolean(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
  }

  async start() {
    if (this.recording) return;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');

    this.audioCtx = new AudioContext();
    await this.audioCtx.resume();
    this.audioDest = this.audioCtx.createMediaStreamDestination();
    // A silent oscillator keeps the audio track producing samples even when
    // nobody is talking, which keeps audio and video in sync in the file.
    const silence = this.audioCtx.createGain();
    silence.gain.value = 0;
    this.oscillator = this.audioCtx.createOscillator();
    this.oscillator.connect(silence).connect(this.audioDest);
    this.oscillator.start();
    this.sources = new Map();
    this.syncAudio();

    this.draw();
    const output = new MediaStream([
      ...this.canvas.captureStream(this.fps).getVideoTracks(),
      ...this.audioDest.stream.getAudioTracks(),
    ]);

    this.mimeType = MeetingRecorder.pickMimeType();
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(output, {
      ...(this.mimeType && { mimeType: this.mimeType }),
      videoBitsPerSecond: 3_000_000,
      audioBitsPerSecond: 128_000,
    });
    this.mediaRecorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.stopped = new Promise((resolve) => (this.mediaRecorder.onstop = resolve));
    this.mediaRecorder.start(1000);

    // Drive frames from a worker timer: unlike requestAnimationFrame it keeps
    // ticking when the tab is in the background.
    const workerSrc = `setInterval(() => postMessage(0), ${Math.round(1000 / this.fps)});`;
    this.ticker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
    let frame = 0;
    this.ticker.onmessage = () => {
      this.draw();
      if (++frame % this.fps === 0) this.syncAudio();
    };

    this.startedAt = Date.now();
    this.recording = true;
  }

  /** Stops recording and downloads the file. Resolves with the file name. */
  async stop() {
    if (!this.recording) return null;
    this.recording = false;
    this.ticker.terminate();
    this.mediaRecorder.stop();
    await this.stopped;

    this.oscillator.stop();
    for (const node of this.sources.values()) node.disconnect();
    await this.audioCtx.close();

    const type = (this.mediaRecorder.mimeType || this.mimeType || 'video/webm').split(';')[0];
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const name = `${this.fileName}.${ext}`;
    let blob = new Blob(this.chunks, { type });
    this.chunks = [];
    if (ext === 'webm') blob = await MeetingRecorder.fixWebmDuration(blob, Date.now() - this.startedAt);
    MeetingRecorder.download(blob, name);
    this.lastBlob = blob;
    return name;
  }

  static download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /**
   * MediaRecorder writes WebM files without a duration, which makes them
   * unseekable in many players. Insert a Duration element into the Segment
   * Info header. Returns the original blob if anything looks unexpected.
   */
  static async fixWebmDuration(blob, durationMs) {
    try {
      const buf = new Uint8Array(await blob.slice(0, 1 << 16).arrayBuffer());
      const vint = (pos, keepMarker) => {
        const first = buf[pos];
        let len = 1;
        let mask = 0x80;
        while (len <= 8 && !(first & mask)) {
          len++;
          mask >>= 1;
        }
        if (len > 8 || pos + len > buf.length) throw new Error('bad vint');
        let value = keepMarker ? first : first & (mask - 1);
        let unknown = (first & (mask - 1)) === mask - 1;
        for (let i = 1; i < len; i++) {
          value = value * 256 + buf[pos + i];
          if (buf[pos + i] !== 0xff) unknown = false;
        }
        return { value, len, unknown };
      };
      const element = (pos) => {
        const id = vint(pos, true);
        const size = vint(pos + id.len, false);
        const start = pos + id.len + size.len;
        return { id: id.value, start, end: size.unknown ? Infinity : start + size.value };
      };

      const header = element(0);
      if (header.id !== 0x1a45dfa3) return blob;
      const segment = element(header.end);
      if (segment.id !== 0x18538067 || segment.end !== Infinity) return blob;

      let pos = segment.start;
      let info;
      while (pos < buf.length) {
        const el = element(pos);
        if (el.id === 0x1549a966) {
          info = { ...el, pos };
          break;
        }
        if (el.id === 0x1f43b675 || el.end === Infinity) return blob; // reached a Cluster
        pos = el.end;
      }
      if (!info || info.end > buf.length) return blob;

      let timecodeScale = 1_000_000;
      for (let p = info.start; p < info.end; ) {
        const el = element(p);
        if (el.id === 0x4489) return blob; // already has a duration
        if (el.id === 0x2ad7b1) {
          timecodeScale = 0;
          for (let i = el.start; i < el.end; i++) timecodeScale = timecodeScale * 256 + buf[i];
        }
        p = el.end;
      }

      const duration = new Uint8Array(11);
      duration.set([0x44, 0x89, 0x88]);
      new DataView(duration.buffer).setFloat64(3, (durationMs * 1_000_000) / timecodeScale);

      const contentLen = info.end - info.start + duration.length;
      const infoHeader = new Uint8Array(12);
      infoHeader.set([0x15, 0x49, 0xa9, 0x66, 0x01]); // ID + 8-byte size vint
      for (let i = 0, v = contentLen; i < 7; i++, v = Math.floor(v / 256)) infoHeader[11 - i] = v % 256;

      return new Blob(
        [blob.slice(0, info.pos), infoHeader, buf.slice(info.start, info.end), duration, blob.slice(info.end)],
        { type: blob.type }
      );
    } catch (err) {
      console.warn('Could not fix WebM duration', err);
      return blob;
    }
  }

  get elapsedMs() {
    return this.recording ? Date.now() - this.startedAt : 0;
  }

  /** Connects newly-arrived audio tracks to the mix and drops ended ones. */
  syncAudio() {
    const live = new Map(
      this.getAudio()
        .filter((t) => t && t.readyState === 'live')
        .map((t) => [t.id, t])
    );
    for (const [id, node] of this.sources) {
      if (!live.has(id)) {
        node.disconnect();
        this.sources.delete(id);
      }
    }
    for (const [id, track] of live) {
      if (this.sources.has(id)) continue;
      const node = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
      node.connect(this.audioDest);
      this.sources.set(id, node);
    }
  }

  draw() {
    const { ctx, width: W, height: H } = this;
    const tiles = this.getTiles();
    ctx.fillStyle = '#202124';
    ctx.fillRect(0, 0, W, H);
    if (!tiles.length) return;

    // A screen share takes the main stage, with everyone else in a strip on the right.
    const featured = tiles.find((t) => t.contain && t.showVideo);
    const gap = 8;
    if (featured && tiles.length > 1) {
      const others = tiles.filter((t) => t !== featured);
      const stripW = Math.round(W * 0.22);
      this.drawTile(featured, gap, gap, W - stripW - gap * 3, H - gap * 2);
      const tileH = Math.min((H - gap * (others.length + 1)) / others.length, (stripW * 9) / 16);
      const top = (H - (tileH * others.length + gap * (others.length - 1))) / 2;
      others.forEach((t, i) => this.drawTile(t, W - stripW - gap, top + i * (tileH + gap), stripW, tileH));
      return;
    }

    const n = tiles.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = (W - gap * (cols + 1)) / cols;
    const cellH = (H - gap * (rows + 1)) / rows;
    tiles.forEach((tile, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
      const offset = ((cols - inRow) * (cellW + gap)) / 2; // center an incomplete last row
      this.drawTile(tile, gap + offset + c * (cellW + gap), gap + r * (cellH + gap), cellW, cellH);
    });
  }

  drawTile(tile, x, y, w, h) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, 10) : ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#3c4043';
    ctx.fillRect(x, y, w, h);

    const v = tile.video;
    if (tile.showVideo && v && v.readyState >= 2 && v.videoWidth) {
      const scale = (tile.contain ? Math.min : Math.max)(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * scale;
      const dh = v.videoHeight * scale;
      if (tile.contain) {
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, w, h);
      }
      ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      const r = Math.min(w, h) * 0.18;
      ctx.fillStyle = MeetingRecorder.colorFor(tile.name);
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `500 ${Math.round(r)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((tile.name || '?').trim().charAt(0).toUpperCase(), x + w / 2, y + h / 2 + 1);
    }

    if (tile.name) {
      const fontSize = Math.max(12, Math.min(16, h / 14));
      ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = tile.name.length > 30 ? tile.name.slice(0, 29) + '…' : tile.name;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + 8, y + h - fontSize * 2 - 8, tw + 16, fontSize * 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 16, y + h - fontSize - 8);
    }
    ctx.restore();
  }

  static colorFor(name = '') {
    const palette = ['#1a73e8', '#e8710a', '#188038', '#a142f4', '#d93025', '#007b83', '#c5221f', '#9334e6'];
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return palette[hash % palette.length];
  }
}
