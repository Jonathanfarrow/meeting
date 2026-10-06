import * as Renderer from '/render.js';

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SHORT_W = 1080;
  const SHORT_H = 1920;

  const state = {
    name: '',
    url: null,
    duration: 0,
    width: 0,
    height: 0,
    audio: null, // Float32Array, 16 kHz mono
    env: null,
    words: [],
    sentences: [],
    clips: [],
    plan: null,
    claude: false,
    previewClip: null,
    rendering: null, // AbortController
    tab: 'clips',
  };

  // ---------- Toasts ----------
  function toast(message, ms = 4000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  // ---------- Choosing a source ----------
  async function showPicker() {
    $('pick').hidden = false;
    $('workspace').hidden = true;
    let items = [];
    try {
      items = await RecordingStore.list();
    } catch (err) {
      console.warn('IndexedDB unavailable', err);
    }
    $('recent').innerHTML = '';
    $('recent-empty').hidden = items.length > 0;
    for (const item of items) {
      const li = document.createElement('li');
      const when = new Date(item.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      li.innerHTML = `<button class="recent-open"><strong></strong><span class="muted small">${when} · ${(item.size / 1e6).toFixed(1)} MB</span></button>
        <button class="icon-btn recent-del" title="Remove from this list"><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>`;
      li.querySelector('strong').textContent = item.name;
      li.querySelector('.recent-open').onclick = () => (location.hash = String(item.id));
      li.querySelector('.recent-del').onclick = async () => {
        await RecordingStore.remove(item.id);
        showPicker();
      };
      $('recent').appendChild(li);
    }
  }

  async function openFromHash() {
    const id = Number(location.hash.slice(1));
    if (!id) return showPicker();
    try {
      const item = await RecordingStore.get(id);
      if (!item) throw new Error('not found');
      await loadSource(item.blob, item.name);
    } catch {
      toast('That recording is no longer stored in this browser.');
      history.replaceState(null, '', '/studio');
      showPicker();
    }
  }

  async function loadSource(blob, name) {
    if (state.url) URL.revokeObjectURL(state.url);
    Object.assign(state, {
      name,
      url: URL.createObjectURL(blob),
      blob,
      audio: null,
      env: null,
      words: [],
      sentences: [],
      clips: [],
      plan: null,
      previewClip: null,
    });
    $('pick').hidden = true;
    $('workspace').hidden = false;
    $('file-name').textContent = name;
    $('clips').innerHTML = '';
    $('ai-note').textContent = '';
    renderTranscript();
    document.title = `Studio · ${name}`;

    const player = $('player');
    state.duration = await Renderer.loadVideo(player, state.url);
    state.width = player.videoWidth;
    state.height = player.videoHeight;
    $('file-duration').textContent = Magic.fmtTime(state.duration);
    $('export-edit').disabled = !state.width;
    resizeTimeline();

    setProgress(0, 'Reading audio…');
    try {
      state.audio = await decodeAudio(blob);
      state.env = Magic.envelope(state.audio, 16000);
      setProgress(null);
    } catch (err) {
      console.error(err);
      setProgress(null);
      toast("Couldn't read this file's audio. Magic features need an audio track.");
    }
    updatePlan();
  }

  async function decodeAudio(blob) {
    const buf = await blob.arrayBuffer();
    // An OfflineAudioContext at 16 kHz resamples while decoding, which keeps memory low.
    const ctx = new OfflineAudioContext(1, 16000, 16000);
    const decoded = await ctx.decodeAudioData(buf);
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
    const out = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < data.length; i++) out[i] += data[i] / decoded.numberOfChannels;
    }
    return out;
  }

  // ---------- Transcription ----------
  function setProgress(fraction, text) {
    const box = $('analyze-progress');
    if (fraction === null) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $('analyze-bar').style.width = `${Math.round(fraction * 100)}%`;
    $('analyze-status').textContent = text;
  }

  function transcribe() {
    if (!state.audio) return toast('No audio to transcribe.');
    $('transcribe').disabled = true;
    setProgress(0, 'Loading speech model…');
    const worker = new Worker('/transcribe-worker.js', { type: 'module' });
    const files = new Map();
    worker.onmessage = ({ data }) => {
      if (data.type === 'loading') {
        files.set(data.file, data);
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        setProgress(loaded / total, `Downloading speech model… ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
      } else if (data.type === 'ready') {
        setProgress(0, `Transcribing (${data.device === 'webgpu' ? 'GPU' : 'CPU'})…`);
      } else if (data.type === 'progress') {
        setProgress(data.done / data.total, `Transcribing… ${Math.round((100 * data.done) / data.total)}%`);
      } else if (data.type === 'done') {
        worker.terminate();
        setTranscript(data.words);
        setProgress(null);
        $('transcribe').disabled = false;
        $('transcribe').textContent = 'Re-transcribe';
        toast(`Transcribed ${data.words.length} words`);
      } else if (data.type === 'error') {
        worker.terminate();
        setProgress(null);
        $('transcribe').disabled = false;
        toast(`Transcription failed: ${data.message}`, 7000);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      setProgress(null);
      $('transcribe').disabled = false;
      toast(`Couldn't start transcription: ${e.message || 'worker error'}`, 7000);
    };
    // Send a copy so the main thread keeps its audio.
    const audio = state.audio.slice();
    worker.postMessage({ type: 'transcribe', audio, language: $('language').value }, [audio.buffer]);
  }

  function setTranscript(words) {
    state.words = words;
    state.sentences = Magic.sentences(words);
    renderTranscript();
    updatePlan();
  }

  function renderTranscript() {
    const box = $('transcript');
    if (!state.words.length) {
      box.innerHTML =
        '<p class="muted small">Click <strong>Transcribe</strong> to see the transcript. It\'s used for captions, filler-word removal and smarter clips.</p>';
      return;
    }
    const frag = document.createDocumentFragment();
    state.sentences.forEach((s) => {
      const p = document.createElement('p');
      const time = document.createElement('span');
      time.className = 'ts';
      time.textContent = Magic.fmtTime(s.start);
      time.dataset.t = s.start;
      p.appendChild(time);
      for (let i = s.wordStart; i <= s.wordEnd; i++) {
        const w = document.createElement('span');
        w.className = 'w';
        w.dataset.i = i;
        w.textContent = state.words[i].text + ' ';
        p.appendChild(w);
      }
      frag.appendChild(p);
    });
    box.innerHTML = '';
    box.appendChild(frag);
    markCutWords();
  }

  function markCutWords() {
    const fillers = state.plan?.fillers ?? new Set();
    for (const el of $('transcript').querySelectorAll('.w')) {
      el.classList.toggle('cut', fillers.has(Number(el.dataset.i)));
    }
  }

  $('transcript').addEventListener('click', (e) => {
    const t = e.target.dataset.t ?? state.words[e.target.dataset.i]?.start;
    if (t !== undefined) {
      $('player').currentTime = Number(t);
      $('player').play();
    }
  });

  // ---------- Magic Edit ----------
  function updatePlan() {
    if (!state.duration) return;
    state.plan = Magic.planEdit({
      env: state.env,
      words: state.words,
      duration: state.duration,
      removeSilence: $('cut-silence').checked,
      minSilence: Number($('silence-min').value),
      removeFillers: $('cut-fillers').checked,
    });
    const { keptDuration, cuts } = state.plan;
    const saved = state.duration - keptDuration;
    $('edit-stats').innerHTML = state.env
      ? `<div><span class="big">${Magic.fmtTime(state.duration)} → ${Magic.fmtTime(keptDuration)}</span></div>
         <div class="muted small">${cuts} cut${cuts === 1 ? '' : 's'} · ${Magic.fmtTime(saved)} removed (${Math.round((100 * saved) / state.duration)}%)${
           !state.words.length && $('cut-fillers').checked ? ' · transcribe to also find filler words' : ''
         }</div>`
      : '<div class="muted small">Waiting for audio…</div>';
    markCutWords();
    drawTimeline();
  }

  for (const id of ['cut-silence', 'silence-min', 'cut-fillers']) $(id).addEventListener('change', updatePlan);

  async function exportEdit() {
    if (!state.plan?.kept.length) return toast('Nothing left to export. Try loosening the settings.');
    const scale = Math.min(1, 1920 / state.width);
    const width = Math.round((state.width * scale) / 2) * 2;
    const height = Math.round((state.height * scale) / 2) * 2;
    const captions = $('edit-captions').checked && state.words.length ? Magic.captionGroups(state.words, { maxWords: 7, maxChars: 42 }) : null;
    await runRender({
      title: 'Exporting edited video',
      segments: state.plan.kept,
      width,
      height,
      draw: (ctx, video, t) => drawLandscape(ctx, video, t, width, height, captions),
      fileName: `${baseName()}-edited`,
    });
  }

  // ---------- Magic Clips ----------
  async function findClips() {
    if (!state.env && !state.words.length) return toast('Still reading audio, try again in a moment.');
    const count = Number($('clip-count').value);
    const [minLength, maxLength] = $('clip-length').value.split('-').map(Number);
    const btn = $('find-clips');
    btn.disabled = true;
    let clips = null;
    let source = 'algorithm';

    if (state.claude && state.sentences.length) {
      btn.textContent = 'Claude is watching…';
      try {
        const res = await fetch('/api/clips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sentences: state.sentences.map(({ start, end, text }) => ({ start, end, text })),
            count,
            minLength,
            maxLength,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        clips = body.clips;
        source = 'claude';
      } catch (err) {
        toast(`Claude couldn't pick clips (${err.message.replace(/\.$/, '')}). Using the built-in finder instead.`, 6000);
      }
    }
    if (!clips) {
      const sents = state.sentences.length ? state.sentences : Magic.utterances(state.env);
      clips = Magic.findClipsLocally({ sentences: sents, env: state.env, count, minLength, maxLength });
    }
    btn.disabled = false;
    btn.textContent = 'Find clips again';

    state.clips = clips.map((c) => ({ ...c }));
    $('ai-note').textContent =
      source === 'claude'
        ? `Picked by Claude from your transcript.`
        : state.words.length
          ? 'Picked by the built-in finder (pace, hooks, energy).'
          : 'Picked from audio energy only. Transcribe first for smarter clips and captions.';
    renderClips();
    drawTimeline();
  }

  function renderClips() {
    const box = $('clips');
    box.innerHTML = '';
    if (!state.clips.length) {
      box.innerHTML = '<p class="muted small">No good clips found. Try a shorter length.</p>';
      return;
    }
    state.clips.forEach((clip, i) => {
      const el = document.createElement('div');
      el.className = 'clip';
      el.innerHTML = `
        <div class="clip-head">
          <span class="score" title="Score">${clip.score}</span>
          <h3 contenteditable="true" spellcheck="false" title="Click to edit the title"></h3>
        </div>
        <p class="small muted meta"></p>
        <p class="small reason"></p>
        ${clip.caption ? '<details class="small"><summary>Post caption</summary><p class="caption"></p><button class="btn text copy">Copy</button></details>' : ''}
        <div class="trim small">
          <span>Start</span><button data-d="start:-1">−1s</button><button data-d="start:1">+1s</button>
          <span>End</span><button data-d="end:-1">−1s</button><button data-d="end:1">+1s</button>
        </div>
        <div class="clip-actions">
          <button class="btn text preview">Preview</button>
          <button class="btn primary export">Export short</button>
        </div>`;
      const title = el.querySelector('h3');
      title.textContent = clip.title;
      title.addEventListener('input', () => (clip.title = title.textContent.trim()));
      title.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), title.blur()));
      el.querySelector('.reason').textContent = clip.reason;
      const meta = el.querySelector('.meta');
      const updateMeta = () =>
        (meta.textContent = `${Magic.fmtTime(clip.start)} – ${Magic.fmtTime(clip.end)} · ${Math.round(clip.end - clip.start)} s`);
      updateMeta();
      if (clip.caption) {
        el.querySelector('.caption').textContent = clip.caption;
        el.querySelector('.copy').onclick = () => navigator.clipboard.writeText(clip.caption).then(() => toast('Caption copied'));
      }
      el.querySelector('.trim').addEventListener('click', (e) => {
        const d = e.target.dataset.d;
        if (!d) return;
        const [edge, delta] = d.split(':');
        clip[edge] = Math.max(0, Math.min(state.duration, clip[edge] + Number(delta)));
        if (clip.end - clip.start < 3) clip[edge] -= Number(delta);
        updateMeta();
        drawTimeline();
      });
      el.querySelector('.preview').onclick = () => previewClip(clip);
      el.querySelector('.export').onclick = () => exportClip(clip, i);
      box.appendChild(el);
    });
  }

  function previewClip(clip) {
    const player = $('player');
    state.previewClip = clip;
    player.currentTime = clip.start;
    player.play();
    player.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function exportClip(clip, i) {
    if (!state.width) return toast('This file has no video track to export.');
    const words = state.words.filter((w) => w.end > clip.start && w.start < clip.end);
    const captions = $('clip-captions').checked && words.length ? Magic.captionGroups(words) : null;
    const opts = {
      layout: $('clip-layout').value,
      title: $('clip-title').checked ? clip.title : '',
      captions,
      bg: document.createElement('canvas'),
    };
    await runRender({
      title: `Exporting short ${i + 1}: ${clip.title}`,
      segments: [[clip.start, clip.end]],
      width: SHORT_W,
      height: SHORT_H,
      preferMp4: true,
      draw: (ctx, video, t) => drawShort(ctx, video, t, opts),
      fileName: `short-${i + 1}-${Magic.slug(clip.title)}`,
    });
  }

  // ---------- Drawing ----------
  function wrapLines(ctx, words, maxWidth) {
    const lines = [];
    let line = [];
    for (const w of words) {
      const test = [...line, w].map((x) => x.text ?? x).join(' ');
      if (line.length && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = [w];
      } else line.push(w);
    }
    if (line.length) lines.push(line);
    return lines;
  }

  function drawCaptions(ctx, groups, t, centerX, y, maxWidth, fontSize) {
    const g = Magic.groupAt(groups, t);
    if (!g) return;
    ctx.font = `900 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const words = g.words.map((w) => ({ ...w, text: w.text.toUpperCase() }));
    const lines = wrapLines(ctx, words, maxWidth);
    const lineH = fontSize * 1.15;
    const space = ctx.measureText(' ').width;
    lines.forEach((line, li) => {
      const widths = line.map((w) => ctx.measureText(w.text).width);
      const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
      let x = centerX - total / 2;
      const ly = y + (li - (lines.length - 1) / 2) * lineH;
      line.forEach((w, wi) => {
        const active = t >= w.start && t <= w.end + 0.05;
        ctx.lineWidth = fontSize * 0.16;
        ctx.strokeStyle = '#000';
        ctx.strokeText(w.text, x, ly);
        ctx.fillStyle = active ? '#FFD60A' : '#fff';
        ctx.fillText(w.text, x, ly);
        x += widths[wi] + space;
      });
    });
  }

  function drawTitle(ctx, title, centerX, y, maxWidth) {
    if (!title) return;
    const size = 64;
    ctx.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    const lines = wrapLines(ctx, title.split(/\s+/), maxWidth).slice(0, 3);
    const lineH = size * 1.2;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l.join(' ')).width));
    const boxH = lines.length * lineH + 40;
    const top = y - boxH / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(centerX - widest / 2 - 32, top, widest + 64, boxH, 24) : ctx.rect(centerX - widest / 2 - 32, top, widest + 64, boxH);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    lines.forEach((l, i) => ctx.fillText(l.join(' '), centerX, top + 20 + lineH * (i + 0.5)));
    ctx.textAlign = 'left';
  }

  // `frame` is a decoded VideoFrame or, in the real-time fallback, the <video> itself.
  const frameSize = (frame) => [
    frame.displayWidth || frame.videoWidth || frame.width || 16,
    frame.displayHeight || frame.videoHeight || frame.height || 9,
  ];

  function drawShort(ctx, video, t, { layout, title, captions, bg }) {
    const W = SHORT_W;
    const H = SHORT_H;
    const [vw, vh] = frameSize(video);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (layout === 'fill') {
      const s = Math.max(W / vw, H / vh);
      ctx.drawImage(video, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
      const grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H * 0.55, W, H * 0.45);
      drawTitle(ctx, title, W / 2, 260, W - 160);
      if (captions) drawCaptions(ctx, captions, t, W / 2, H * 0.72, W - 140, 84);
      return;
    }

    // Blurred background: draw tiny, then scale up (cheap blur).
    bg.width = 27;
    bg.height = 48;
    const bctx = bg.getContext('2d');
    const bs = Math.max(bg.width / vw, bg.height / vh);
    bctx.drawImage(video, (bg.width - vw * bs) / 2, (bg.height - vh * bs) / 2, vw * bs, vh * bs);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bg, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);

    const s = W / vw;
    const dh = vh * s;
    const y = (H - dh) / 2 - 40;
    ctx.drawImage(video, 0, y, W, dh);
    drawTitle(ctx, title, W / 2, Math.max(180, y - 170), W - 160);
    if (captions) drawCaptions(ctx, captions, t, W / 2, Math.min(H - 220, y + dh + 190), W - 140, 80);
  }

  function drawLandscape(ctx, video, t, W, H, captions) {
    ctx.drawImage(video, 0, 0, W, H);
    if (captions) {
      const size = Math.round(H * 0.055);
      drawCaptions(ctx, captions, t, W / 2, H - size * 2.2, W * 0.85, size);
    }
  }

  // ---------- Rendering ----------
  function baseName() {
    return state.name.replace(/\.[a-z0-9]+$/i, '') || 'video';
  }

  async function runRender({ title, segments, width, height, draw, fileName, preferMp4 = false }) {
    if (state.rendering) return toast('Already exporting, please wait.');
    $('player').pause();
    const controller = new AbortController();
    state.rendering = controller;
    const total = segments.reduce((s, [a, b]) => s + b - a, 0);
    const canvas = document.createElement('canvas');
    $('render-stage').innerHTML = '';
    $('render-stage').appendChild(canvas);
    $('render-stage').classList.toggle('portrait', height > width);
    $('render-title').textContent = title;
    $('render-bar').style.width = '0%';
    $('render-status').textContent = `Preparing ${Magic.fmtTime(total)} of video… Keep this tab open.`;
    $('render-modal').hidden = false;
    $('render-cancel').onclick = () => controller.abort();

    try {
      const blob = await Renderer.render({
        blob: state.blob,
        segments,
        width,
        height,
        draw,
        canvas,
        preferMp4,
        signal: controller.signal,
        onProgress: (f) => {
          $('render-bar').style.width = `${(f * 100).toFixed(1)}%`;
          $('render-status').textContent = `${Math.round(f * 100)}% of ${Magic.fmtTime(total)} rendered. Keep this tab open.`;
        },
      });
      const name = `${fileName}.${Renderer.extensionFor(blob)}`;
      MeetingRecorder.download(blob, name);
      toast(`Saved ${name} to your Downloads`, 6000);
    } catch (err) {
      if (err.name === 'AbortError') toast('Export cancelled');
      else {
        console.error(err);
        toast(`Export failed: ${err.message}`, 7000);
      }
    } finally {
      state.rendering = null;
      $('render-modal').hidden = true;
    }
  }

  // ---------- Timeline ----------
  const timeline = $('timeline');

  function resizeTimeline() {
    const dpr = window.devicePixelRatio || 1;
    timeline.width = Math.round(timeline.clientWidth * dpr);
    timeline.height = Math.round(timeline.clientHeight * dpr);
    drawTimeline();
  }

  function drawTimeline() {
    const ctx = timeline.getContext('2d');
    const W = timeline.width;
    const H = timeline.height;
    ctx.clearRect(0, 0, W, H);
    if (!state.duration) return;
    const x = (t) => (t / state.duration) * W;

    if (state.env) {
      const { db, floor, speech } = state.env;
      const bars = Math.min(W, db.length);
      const per = db.length / bars;
      ctx.fillStyle = '#5f6368';
      for (let b = 0; b < bars; b++) {
        let peak = -Infinity;
        for (let i = Math.floor(b * per); i < Math.floor((b + 1) * per); i++) peak = Math.max(peak, db[i]);
        const level = Math.max(0, Math.min(1, (peak - floor) / Math.max(1, speech - floor + 6)));
        const h = Math.max(1, level * H * 0.8);
        ctx.fillRect((b / bars) * W, (H - h) / 2, Math.max(1, W / bars - 0.5), h);
      }
    }
    if (state.tab === 'edit' && state.plan) {
      ctx.fillStyle = 'rgba(234, 67, 53, 0.45)';
      for (const [s, e] of state.plan.removed) ctx.fillRect(x(s), 0, Math.max(1, x(e) - x(s)), H);
    }
    if (state.tab === 'clips') {
      state.clips.forEach((c, i) => {
        ctx.fillStyle = 'rgba(138, 180, 248, 0.35)';
        ctx.fillRect(x(c.start), 0, x(c.end) - x(c.start), H);
        ctx.fillStyle = '#8ab4f8';
        ctx.fillRect(x(c.start), 0, 2, H);
        ctx.font = `${Math.round(H * 0.28)}px system-ui`;
        ctx.fillText(String(i + 1), x(c.start) + 6, H * 0.3);
      });
    }
    const p = x($('player').currentTime);
    ctx.fillStyle = '#fff';
    ctx.fillRect(p - 1, 0, 2, H);
  }

  timeline.addEventListener('click', (e) => {
    const rect = timeline.getBoundingClientRect();
    $('player').currentTime = ((e.clientX - rect.left) / rect.width) * state.duration;
  });
  window.addEventListener('resize', resizeTimeline);

  // ---------- Playback loop: playhead, transcript highlight, previews ----------
  let lastWord = -1;
  function loop() {
    const player = $('player');
    const t = player.currentTime;
    if (!player.paused) {
      if (state.previewClip && t >= state.previewClip.end) {
        player.pause();
        state.previewClip = null;
      }
      if ($('preview-edit').checked && state.plan) {
        const cut = state.plan.removed.find(([s, e]) => t >= s && t < e - 0.05);
        if (cut) player.currentTime = cut[1];
      }
    }
    if (state.words.length) {
      const i = Magic.wordAt(state.words, t);
      if (i !== lastWord) {
        $('transcript').querySelector('.w.now')?.classList.remove('now');
        const el = i >= 0 && $('transcript').querySelector(`.w[data-i="${i}"]`);
        if (el) {
          el.classList.add('now');
          if (!player.paused) el.scrollIntoView({ block: 'nearest' });
        }
        lastWord = i;
      }
    }
    drawTimeline();
    requestAnimationFrame(loop);
  }

  // ---------- Wiring ----------
  $('file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) {
      history.replaceState(null, '', '/studio');
      loadSource(f, f.name);
    }
  });
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) {
      history.replaceState(null, '', '/studio');
      loadSource(f, f.name);
    }
  });
  $('change-file').onclick = () => {
    $('player').pause();
    history.replaceState(null, '', '/studio');
    showPicker();
  };
  $('transcribe').onclick = transcribe;
  $('find-clips').onclick = findClips;
  $('export-edit').onclick = exportEdit;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.onclick = () => {
      state.tab = tab.dataset.tab;
      for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
      $('tab-clips').hidden = state.tab !== 'clips';
      $('tab-edit').hidden = state.tab !== 'edit';
      drawTimeline();
    };
  }
  window.addEventListener('hashchange', openFromHash);
  window.addEventListener('beforeunload', (e) => {
    if (state.rendering) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  fetch('/api/ai')
    .then((r) => r.json())
    .then((r) => {
      state.claude = r.claude;
      if (!r.claude) $('find-clips').title = 'Claude is not configured on this server; using the built-in clip finder';
    })
    .catch(() => {});

  // Test hook: lets automated tests inject a transcript without downloading the speech model.
  window.__studio = { setTranscript, state };

  openFromHash();
  requestAnimationFrame(loop);
})();
