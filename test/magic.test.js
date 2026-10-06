const test = require('node:test');
const assert = require('node:assert/strict');
const Magic = require('../public/magic.js');

const RATE = 16000;

/** Synthetic audio: `pattern` is a list of [seconds, loud?] pieces. */
function audio(pattern) {
  const total = pattern.reduce((s, [d]) => s + d, 0);
  const out = new Float32Array(Math.round(total * RATE));
  let i = 0;
  for (const [d, loud] of pattern) {
    const n = Math.round(d * RATE);
    for (let k = 0; k < n; k++, i++) {
      out[i] = loud ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) : 0.001 * Math.sin(i);
    }
  }
  return out;
}

const words = (list) => list.map(([text, start, end]) => ({ text, start, end }));

test('detects long silences but keeps short pauses', () => {
  const env = Magic.envelope(audio([[2, true], [0.4, false], [2, true], [3, false], [2, true]]), RATE);
  const silences = Magic.silentRanges(env, 0.8);
  assert.equal(silences.length, 1);
  assert.ok(Math.abs(silences[0][0] - 4.4) < 0.15, `start ${silences[0][0]}`);
  assert.ok(Math.abs(silences[0][1] - 7.4) < 0.15, `end ${silences[0][1]}`);
});

test('does not cut anything from audio without dynamics', () => {
  const env = Magic.envelope(audio([[5, true]]), RATE);
  assert.deepEqual(Magic.silentRanges(env, 0.5), []);
});

test('planEdit removes silence (with padding) and filler words', () => {
  const env = Magic.envelope(audio([[2, true], [3, false], [3, true]]), RATE);
  const w = words([['Hello', 0.1, 0.6], ['there.', 0.7, 1.9], ['Um,', 5.1, 5.5], ['so', 5.6, 5.9], ['yes.', 6, 7.8]]);
  const plan = Magic.planEdit({ env, words: w, duration: 8, minSilence: 0.8, pad: 0.2 });
  assert.deepEqual([...plan.fillers], [2]);
  // Silence 2-5 s becomes a cut of 2.2-4.8, and the "Um" at 5.1-5.5 is cut too.
  assert.ok(plan.removed.some(([s, e]) => Math.abs(s - 2.2) < 0.15 && Math.abs(e - 4.8) < 0.15));
  assert.ok(plan.removed.some(([s, e]) => s <= 5.1 && e >= 5.5));
  assert.ok(plan.keptDuration > 4 && plan.keptDuration < 5.5, `kept ${plan.keptDuration}`);
  // Kept and removed ranges tile the whole timeline.
  const all = [...plan.kept, ...plan.removed].sort((a, b) => a[0] - b[0]);
  assert.equal(all[0][0], 0);
  assert.equal(all.at(-1)[1], 8);
  for (let i = 1; i < all.length; i++) assert.ok(Math.abs(all[i][0] - all[i - 1][1]) < 1e-9);
});

test('planEdit with everything off keeps the whole video', () => {
  const env = Magic.envelope(audio([[2, true], [3, false], [3, true]]), RATE);
  const plan = Magic.planEdit({ env, words: [], duration: 8, removeSilence: false, removeFillers: false });
  assert.deepEqual(plan.kept, [[0, 8]]);
  assert.equal(plan.cuts, 0);
});

test('sentences split on punctuation and long pauses', () => {
  const s = Magic.sentences(words([['Hi', 0, 0.3], ['all.', 0.4, 0.8], ['So', 1, 1.2], ['today', 1.3, 1.6], ['we', 3, 3.2], ['ship?', 3.3, 3.6]]));
  assert.deepEqual(s.map((x) => x.text), ['Hi all.', 'So today', 'we ship?']);
  assert.equal(s[2].wordStart, 4);
});

test('local clip finder prefers hooks, avoids small talk and never overlaps', () => {
  const sents = [];
  let t = 0;
  const add = (text, d) => {
    sents.push({ text, start: t, end: t + d });
    t += d + 0.3;
  };
  add('Can you hear me okay? Let me share my screen.', 6);
  add('Thanks everyone, any questions before we start?', 6);
  add("Here's the biggest mistake most people make with pricing.", 6);
  add('They never test it, and that costs them a lot of money.', 7);
  add('The secret is to actually talk to customers every week!', 7);
  add('Okay, next week we can follow up on the calendar invite. Bye.', 6);
  const clips = Magic.findClipsLocally({ sentences: sents, env: null, count: 3, minLength: 15, maxLength: 30 });
  assert.ok(clips.length >= 1);
  assert.equal(clips[0].start, sents[2].start, `best clip starts with the hook, got ${JSON.stringify(clips[0])}`);
  for (const c of clips) assert.ok(c.end - c.start >= 15 && c.end - c.start <= 30);
  for (let i = 0; i < clips.length; i++)
    for (let j = i + 1; j < clips.length; j++)
      assert.ok(clips[i].end <= clips[j].start || clips[j].end <= clips[i].start, 'clips overlap');
  assert.match(clips[0].title, /biggest mistake/);
});

test('utterances come from audio when there is no transcript', () => {
  const env = Magic.envelope(audio([[1, false], [2, true], [2, false], [3, true]]), RATE);
  const u = Magic.utterances(env);
  assert.equal(u.length, 2);
  assert.ok(Math.abs(u[1].start - 5) < 0.2);
});

test('caption groups stay short and groupAt/wordAt find the right entries', () => {
  const w = words([['one', 0, 0.2], ['two', 0.3, 0.5], ['three', 0.6, 0.8], ['four', 0.9, 1], ['five.', 1.1, 1.3], ['six', 3, 3.2]]);
  const g = Magic.captionGroups(w, { maxWords: 4 });
  assert.deepEqual(g.map((x) => x.words.length), [4, 1, 1]);
  assert.equal(Magic.groupAt(g, 0.25), g[0]);
  assert.equal(Magic.groupAt(g, 2.5), null); // held 0.5 s after "five." then cleared
  assert.equal(Magic.wordAt(w, 0.65), 2);
  assert.equal(Magic.wordAt(w, 2), -1);
});

test('formatting helpers', () => {
  assert.equal(Magic.fmtTime(75), '1:15');
  assert.equal(Magic.fmtTime(3725), '1:02:05');
  assert.equal(Magic.slug("Here's the BIG secret!"), 'here-s-the-big-secret');
});
