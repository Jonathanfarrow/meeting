/**
 * Editing algorithms for the Studio: silence detection, filler-word removal,
 * sentence building, a local (no-AI) clip finder, and caption grouping.
 * Pure functions, shared by the browser and the Node tests.
 */
const Magic = (() => {
  const FILLERS = new Set([
    'um', 'umm', 'ummm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'err', 'ah', 'ahh', 'hmm', 'hm', 'mm', 'mmm', 'mhm', 'eh',
  ]);

  const clean = (w) => w.toLowerCase().replace(/[^a-z']/g, '');

  // ---------- Audio analysis ----------

  /** Loudness envelope in dB, one value per `hop` seconds. */
  function envelope(samples, sampleRate, hop = 0.05) {
    const size = Math.max(1, Math.round(sampleRate * hop));
    const n = Math.ceil(samples.length / size);
    const db = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const end = Math.min(samples.length, (i + 1) * size);
      for (let j = i * size; j < end; j++) sum += samples[j] * samples[j];
      db[i] = 20 * Math.log10(Math.sqrt(sum / Math.max(1, end - i * size)) + 1e-8);
    }
    const levels = levelsOf(db);
    return { db, hop, ...levels };
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
  }

  /** Noise floor, speech level and the voice/silence threshold between them. */
  function levelsOf(db) {
    const sorted = Float32Array.from(db).sort();
    const floor = percentile(sorted, 0.1);
    const speech = percentile(sorted, 0.9);
    const range = speech - floor;
    return { floor, speech, threshold: floor + range * 0.3, dynamic: range >= 10 };
  }

  /** Boolean per frame: is someone speaking? Slightly dilated so word edges aren't clipped. */
  function voiceFrames(env) {
    const { db, threshold } = env;
    const raw = Array.from(db, (v) => v >= threshold);
    return raw.map((v, i) => v || raw[i - 1] || raw[i + 1] || false);
  }

  /** Silent stretches at least `minSilence` seconds long, as [start, end] pairs. */
  function silentRanges(env, minSilence = 0.8) {
    if (!env.dynamic) return []; // no clear difference between speech and silence
    const voice = voiceFrames(env);
    const ranges = [];
    let start = null;
    for (let i = 0; i <= voice.length; i++) {
      const silent = i < voice.length && !voice[i];
      if (silent && start === null) start = i;
      if (!silent && start !== null) {
        const s = start * env.hop;
        const e = i * env.hop;
        if (e - s >= minSilence) ranges.push([s, e]);
        start = null;
      }
    }
    return ranges;
  }

  function voiceRatio(env, voice, start, end) {
    const a = Math.max(0, Math.floor(start / env.hop));
    const b = Math.min(voice.length, Math.ceil(end / env.hop));
    if (b <= a) return 0;
    let v = 0;
    for (let i = a; i < b; i++) v += voice[i] ? 1 : 0;
    return v / (b - a);
  }

  function meanLoudness(env, voice, start, end) {
    const a = Math.max(0, Math.floor(start / env.hop));
    const b = Math.min(voice.length, Math.ceil(end / env.hop));
    let sum = 0;
    let n = 0;
    for (let i = a; i < b; i++) {
      if (voice[i]) {
        sum += env.db[i];
        n++;
      }
    }
    return n ? sum / n : env.floor;
  }

  // ---------- Magic Edit ----------

  function mergeRanges(ranges, joinGap = 0) {
    const sorted = ranges.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [s, e] of sorted) {
      const last = out[out.length - 1];
      if (last && s <= last[1] + joinGap) last[1] = Math.max(last[1], e);
      else out.push([s, e]);
    }
    return out;
  }

  function fillerIndexes(words = []) {
    const out = [];
    words.forEach((w, i) => FILLERS.has(clean(w.text)) && out.push(i));
    return out;
  }

  /**
   * Decide what to cut. Returns the removed ranges, the kept segments, and
   * which transcript words are cut as fillers.
   */
  function planEdit({ env, words = [], duration, removeSilence = true, minSilence = 0.8, removeFillers = true, pad = 0.2 }) {
    const removed = [];
    if (removeSilence && env) {
      for (const [s, e] of silentRanges(env, minSilence)) {
        // Leave a short natural pause on each side of the cut.
        const a = s === 0 ? 0 : s + pad;
        const b = e >= duration - env.hop ? duration : e - pad;
        if (b - a > 0.1) removed.push([a, b]);
      }
    }
    const fillers = removeFillers ? fillerIndexes(words) : [];
    for (const i of fillers) removed.push([Math.max(0, words[i].start - 0.03), Math.min(duration, words[i].end + 0.03)]);

    let merged = mergeRanges(removed, 0.1);
    let kept = [];
    let t = 0;
    for (const [s, e] of merged) {
      if (s > t) kept.push([t, s]);
      t = Math.max(t, e);
    }
    if (t < duration) kept.push([t, duration]);
    // Slivers of kept audio sound like glitches; fold them into the cut.
    kept = kept.filter(([s, e]) => e - s >= 0.15);
    merged = [];
    t = 0;
    for (const [s, e] of kept) {
      if (s > t) merged.push([t, s]);
      t = e;
    }
    if (t < duration) merged.push([t, duration]);
    const keptDuration = kept.reduce((sum, [s, e]) => sum + e - s, 0);
    return { removed: merged, kept, fillers: new Set(fillers), keptDuration, cuts: merged.length };
  }

  // ---------- Transcript structure ----------

  /** Groups words into sentences, using punctuation and pauses. */
  function sentences(words = [], { maxGap = 0.9, maxWords = 40 } = {}) {
    const out = [];
    let cur = null;
    words.forEach((w, i) => {
      if (!cur) cur = { start: w.start, end: w.end, wordStart: i, wordEnd: i, text: '' };
      cur.text += (cur.text ? ' ' : '') + w.text;
      cur.end = w.end;
      cur.wordEnd = i;
      const next = words[i + 1];
      const ended = /[.?!]["')\]]?$/.test(w.text);
      const pause = next && next.start - w.end > maxGap;
      if (!next || ended || pause || cur.wordEnd - cur.wordStart + 1 >= maxWords) {
        out.push(cur);
        cur = null;
      }
    });
    return out;
  }

  /** Without a transcript: speech bursts separated by pauses, as text-less "sentences". */
  function utterances(env, { maxGap = 0.7 } = {}) {
    const voice = voiceFrames(env);
    const out = [];
    let start = null;
    let lastVoice = -Infinity;
    for (let i = 0; i <= voice.length; i++) {
      const t = i * env.hop;
      if (i < voice.length && voice[i]) {
        if (start === null) start = t;
        else if (t - lastVoice > maxGap) {
          out.push({ start, end: lastVoice + env.hop, text: '' });
          start = t;
        }
        lastVoice = t;
      }
    }
    if (start !== null) out.push({ start, end: lastVoice + env.hop, text: '' });
    return out;
  }

  // ---------- Local clip finder (used when Claude isn't available) ----------

  const HOOK_START = /^(so |and )?(here'?s|the (secret|truth|problem|reason|biggest|best|worst|key)|what if|why |how |imagine|never|stop|nobody|everyone|most people|i (learned|realized|think|believe)|you (need|should|have to|can)|the one thing|let me tell you)/i;
  const POWER_WORDS = /\b(secret|mistake|lesson|important|never|always|best|worst|biggest|crazy|amazing|insane|incredible|love|hate|truth|why|tip|learned|problem|solution|money|actually|exactly|game.?changer|surprising|story|realized|wrong|fail|success)\b/gi;
  const SMALL_TALK = /\b(can you hear|on mute|you're muted|share my screen|see my screen|let me share|is it working|next week|calendar|follow up|talk soon|bye|good ?morning|thanks everyone|thank you all|wrap (it )?up|any questions)\b/i;

  function findClipsLocally({ sentences: sents, env, count = 5, minLength = 20, maxLength = 60 }) {
    if (!sents.length) return [];
    const voice = env ? voiceFrames(env) : null;
    const candidates = [];
    for (let i = 0; i < sents.length; i++) {
      for (let j = i; j < sents.length; j++) {
        const start = sents[i].start;
        const end = sents[j].end;
        const dur = end - start;
        if (dur > maxLength) break;
        if (dur < minLength) continue;
        candidates.push(scoreWindow(sents, i, j, env, voice));
      }
    }
    if (!candidates.length) {
      // Recording shorter than the minimum length: offer the whole thing.
      const last = sents.length - 1;
      candidates.push(scoreWindow(sents, 0, last, env, voice));
    }
    candidates.sort((a, b) => b.raw - a.raw);
    const max = candidates[0].raw;
    const min = candidates[candidates.length - 1].raw;
    const picked = [];
    for (const c of candidates) {
      if (picked.some((p) => c.start < p.end && c.end > p.start)) continue;
      c.score = Math.round((max === min ? 7 : 4 + (6 * (c.raw - min)) / (max - min)) * 10) / 10;
      picked.push(c);
      if (picked.length >= count) break;
    }
    return picked.map((c, n) => ({
      start: c.start,
      end: c.end,
      title: c.title || `Highlight ${n + 1}`,
      caption: c.caption,
      reason: c.reasons.length ? c.reasons.join(' · ') : 'Steady stretch of speech',
      score: Math.min(10, Math.round(c.score)),
    }));
  }

  function scoreWindow(sents, i, j, env, voice) {
    const start = sents[i].start;
    const end = sents[j].end;
    const dur = Math.max(1, end - start);
    const text = sents.slice(i, j + 1).map((s) => s.text).join(' ');
    const first = sents[i].text.trim();
    const words = text.split(/\s+/).filter(Boolean).length;
    const reasons = [];
    let raw = 0;

    if (text) {
      const wps = words / dur;
      raw += 2 - Math.min(2, Math.abs(wps - 2.6)); // natural, energetic pace
      if (wps > 2.2) reasons.push('Fast-paced');
      if (/\?$/.test(first)) {
        raw += 1.5;
        reasons.push('Opens with a question');
      }
      if (HOOK_START.test(first)) {
        raw += 2;
        reasons.push('Strong hook');
      }
      if (/\d/.test(first)) raw += 0.5;
      const power = (text.match(POWER_WORDS) || []).length;
      raw += Math.min(3, (power / (j - i + 1)) * 1.5);
      if (power >= 2) reasons.push('Punchy language');
      raw += Math.min(1, (text.match(/!/g) || []).length * 0.4);
      if (/[.!?]["')\]]?$/.test(sents[j].text.trim())) raw += 0.5; // ends on a complete thought
      if (SMALL_TALK.test(text)) raw -= 3;
    }
    if (env && voice) {
      const ratio = voiceRatio(env, voice, start, end);
      raw += ratio * 2;
      const loud = meanLoudness(env, voice, start, end);
      const energy = (loud - env.threshold) / Math.max(1, env.speech - env.threshold);
      raw += Math.max(-1, Math.min(1.5, energy * 1.5));
      if (energy > 0.8) reasons.push('High energy');
      if (ratio < 0.55) raw -= 1.5; // lots of dead air
    }

    const titleWords = first.replace(/[.,!?;:]+$/, '').split(/\s+/).filter(Boolean);
    const title = titleWords.slice(0, 9).join(' ') + (titleWords.length > 9 ? '…' : '');
    const caption = sents.slice(i, Math.min(j + 1, i + 2)).map((s) => s.text).join(' ').slice(0, 220);
    return { start, end, raw, title, caption, reasons: reasons.slice(0, 3) };
  }

  // ---------- Captions ----------

  /** Groups words into short caption lines for burned-in subtitles. */
  function captionGroups(words, { maxWords = 4, maxChars = 22, maxGap = 0.6 } = {}) {
    const groups = [];
    let cur = null;
    words.forEach((w, i) => {
      if (!cur) cur = { words: [], start: w.start, end: w.end };
      cur.words.push(w);
      cur.end = w.end;
      const next = words[i + 1];
      const chars = cur.words.reduce((n, x) => n + x.text.length + 1, 0);
      if (
        !next ||
        cur.words.length >= maxWords ||
        chars + (next?.text.length ?? 0) > maxChars ||
        next.start - w.end > maxGap ||
        /[.?!,]$/.test(w.text)
      ) {
        groups.push(cur);
        cur = null;
      }
    });
    return groups;
  }

  /** The caption group to show at time t (held briefly after it ends). */
  function groupAt(groups, t) {
    let lo = 0;
    let hi = groups.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (groups[mid].start <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return null;
    const g = groups[found];
    const next = groups[found + 1];
    const holdUntil = Math.min(g.end + 0.5, next ? next.start : Infinity);
    return t <= holdUntil ? g : null;
  }

  /** Index of the word being spoken at time t (or -1). */
  function wordAt(words, t) {
    let lo = 0;
    let hi = words.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid].end < t) lo = mid + 1;
      else if (words[mid].start > t) hi = mid - 1;
      else return mid;
    }
    return -1;
  }

  // ---------- Formatting ----------

  function fmtTime(t) {
    t = Math.max(0, t || 0);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  const slug = (s) =>
    String(s || 'clip')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'clip';

  return {
    envelope,
    levelsOf,
    silentRanges,
    planEdit,
    mergeRanges,
    fillerIndexes,
    sentences,
    utterances,
    findClipsLocally,
    captionGroups,
    groupAt,
    wordAt,
    fmtTime,
    slug,
  };
})();

if (typeof module !== 'undefined') module.exports = Magic;
