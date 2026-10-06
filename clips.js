// Picks the best short-form clips from a meeting transcript using Claude.
// Only transcript text is sent; video and audio stay in the user's browser.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLIPS_MODEL || 'claude-opus-5-5';
const MAX_TRANSCRIPT_CHARS = 400_000; // roughly 3 hours of speech

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const CLIP_SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start_index: { type: 'integer', description: 'Index of the first sentence in the clip' },
          end_index: { type: 'integer', description: 'Index of the last sentence in the clip (inclusive)' },
          title: { type: 'string', description: 'Punchy on-screen title, max ~8 words' },
          caption: { type: 'string', description: 'Social post caption with 2-4 hashtags' },
          reason: { type: 'string', description: 'One sentence on why this moment works as a short' },
          score: { type: 'integer', description: 'Virality score from 1 (weak) to 10 (excellent)' },
        },
        required: ['start_index', 'end_index', 'title', 'caption', 'reason', 'score'],
        additionalProperties: false,
      },
    },
  },
  required: ['clips'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are an expert short-form video editor who turns long recordings (meetings, podcasts, interviews) into TikTok / YouTube Shorts / Reels clips.

You receive a transcript split into numbered sentences with timestamps. Choose the moments that would perform best as standalone shorts:
- Each clip must make sense to someone who hasn't seen the rest of the recording. Start where the thought starts, not mid-sentence or on a reply to an unseen question, and end once the point lands.
- Favour strong hooks in the first sentence (a bold claim, a surprising fact, a question, a story opening), clear insights, actionable advice, emotion, humour, or a satisfying payoff.
- Skip small talk, logistics ("can you hear me?", scheduling, goodbyes) and moments that depend on visuals.
- Clips must not overlap. Respect the requested length range using the timestamps.
- Order clips from best to worst. Return fewer clips than requested rather than padding with weak ones.

Titles are burned onto the video, so keep them short, specific and written in the speaker's language.`;

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function validateRequest(body) {
  const sentences = Array.isArray(body?.sentences) ? body.sentences : null;
  if (!sentences?.length) return 'No transcript provided.';
  if (sentences.length > 20_000) return 'Transcript is too long.';
  let chars = 0;
  for (const s of sentences) {
    if (typeof s?.text !== 'string' || !Number.isFinite(s.start) || !Number.isFinite(s.end)) {
      return 'Malformed transcript.';
    }
    chars += s.text.length;
  }
  if (chars > MAX_TRANSCRIPT_CHARS) return 'Transcript is too long.';
  return null;
}

async function findClips({ sentences, count = 5, minLength = 20, maxLength = 60 }) {
  count = Math.max(1, Math.min(10, Math.round(count)));
  minLength = Math.max(5, Math.min(300, Number(minLength) || 20));
  maxLength = Math.max(minLength + 5, Math.min(600, Number(maxLength) || 60));

  const transcript = sentences
    .map((s, i) => `[${i}] (${fmt(s.start)}-${fmt(s.end)}) ${s.text.trim()}`)
    .join('\n');

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: CLIP_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `<transcript>\n${transcript}\n</transcript>\n\nFind up to ${count} clips, each between ${minLength} and ${maxLength} seconds long.`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('Claude declined to process this transcript.'), { status: 422 });
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw Object.assign(new Error('Claude returned no clips.'), { status: 502 });

  const parsed = JSON.parse(text);
  const used = [];
  const clips = [];
  for (const c of parsed.clips ?? []) {
    const a = Math.max(0, Math.min(c.start_index, c.end_index));
    const b = Math.min(sentences.length - 1, Math.max(c.start_index, c.end_index));
    if (!sentences[a] || !sentences[b]) continue;
    const start = sentences[a].start;
    const end = sentences[b].end;
    if (end - start < 3) continue;
    if (used.some(([s, e]) => start < e && end > s)) continue; // drop overlaps
    used.push([start, end]);
    clips.push({
      start,
      end,
      title: String(c.title).slice(0, 120),
      caption: String(c.caption).slice(0, 600),
      reason: String(c.reason).slice(0, 400),
      score: Math.max(1, Math.min(10, Math.round(c.score))),
    });
    if (clips.length >= count) break;
  }
  return { clips, model: response.model };
}

// Small per-IP limiter so a public deployment can't run up the API bill.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.CLIPS_RATE_LIMIT) || 10;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return false;
}

function registerRoutes(app, express) {
  app.get('/api/ai', (req, res) => res.json({ claude: Boolean(client) }));

  app.post('/api/clips', express.json({ limit: '4mb' }), async (req, res) => {
    if (!client) return res.status(503).json({ error: 'Claude is not configured on this server.' });
    const invalid = validateRequest(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many requests, try again in a few minutes.' });

    try {
      res.json(await findClips(req.body));
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        return res.status(429).json({ error: 'Claude is busy right now, try again shortly.' });
      }
      if (err instanceof Anthropic.AuthenticationError) {
        console.error('Anthropic authentication failed - check ANTHROPIC_API_KEY');
        return res.status(503).json({ error: 'Claude is not configured correctly on this server.' });
      }
      if (err instanceof Anthropic.APIError) {
        console.error('Anthropic API error', err.status, err.message);
        return res.status(502).json({ error: 'Claude request failed.' });
      }
      console.error('Clip finding failed', err);
      res.status(err.status || 500).json({ error: err.message || 'Clip finding failed.' });
    }
  });
}

module.exports = { registerRoutes };
