# Meeting

A Google Meet–style video meeting app you can run yourself. Start a meeting, share the link, and **record the call straight to your computer**. Recordings are made in your browser and downloaded as a video file; nothing is uploaded to a server.

## Features

- **Video & audio calls**: peer-to-peer WebRTC, up to 8 people per meeting
- **Meeting links**: Meet-style codes like `abc-defg-hij`; join by code or link
- **Pre-join screen**: camera preview, mic/camera toggles, name entry
- **Screen sharing**: the presenter takes the main stage
- **Local recording**: records every participant's video as a grid (or presenter + filmstrip) plus everyone's mixed audio. When you stop, a file like `meeting-abc-defg-hij-2026-10-06_16-34-37.webm` is saved to your Downloads folder
- Everyone in the call sees a **"… is recording"** banner while a recording is running
- In-call **chat**, a **participants** list, mute indicators, and copy-link
- **Studio** (`/studio`), for turning a recording into content:
  - **Magic Clips**: finds the best moments and exports them as vertical 9:16 shorts (1080×1920) with a title and animated word-by-word captions. Claude picks the clips when an API key is set; otherwise a built-in algorithm does.
  - **Magic Edit**: removes long silences and filler words ("um", "uh") and exports the tightened video, optionally with burned-in captions

## Deploy to Railway

1. Push this repo to GitHub.
2. In [Railway](https://railway.com), click **New Project → Deploy from GitHub repo** and pick this repo. Railway detects Node, runs `npm install`, and starts the app with `npm start`. Settings come from `railway.json`, including the `/health` health check.
3. Open the service → **Settings → Networking → Generate Domain**. You'll get a URL like `https://meeting-production.up.railway.app`.
4. Open that URL, click **New meeting**, and share the link. Railway serves HTTPS, so camera and mic work for everyone.

Notes for Railway:

- **Keep it at 1 replica.** Meeting rooms are kept in the server's memory, so everyone in a meeting must reach the same instance. `railway.json` sets `numReplicas: 1`.
- **Redeploying ends ongoing meetings.** People have to rejoin with the same link. Recordings are saved in each person's browser, so they are not lost; anyone recording should stop and save before you redeploy.
- **Bandwidth is low.** Video and audio go directly between participants' browsers, not through Railway. The server only passes small connection messages.
- **Add a TURN server for reliability (recommended).** Without one, calls between people on strict networks (corporate Wi-Fi, some mobile carriers) can fail to connect. Railway can't host a TURN relay, because it needs UDP. Use a hosted one instead, such as [Metered](https://www.metered.ca/stun-turn), [Twilio](https://www.twilio.com/stun-turn) or [Cloudflare](https://developers.cloudflare.com/realtime/turn/). Then add these variables in the Railway **Variables** tab:

  ```
  TURN_URL=turn:your-turn-host:3478,turns:your-turn-host:443?transport=tcp
  TURN_USERNAME=...
  TURN_CREDENTIAL=...
  ```

### Recording

1. In a meeting, click the **record** button (the circle in the bottom bar).
2. Click it again (now a square) to stop. Your browser downloads the file right away.
3. Leaving the meeting while recording stops the recording and saves the file first.

Recording happens entirely in the browser of the person who clicked record. The file goes to *their* Downloads folder and never touches the server. Chrome, Edge and Firefox save **WebM** (VP9/VP8 + Opus), which plays in Chrome, Firefox, VLC and most modern players. Safari saves **MP4**.

Keep the meeting tab open while recording. The recorder keeps running in a background tab, but browsers may lower the frame rate there.

## Studio: Magic Clips & Magic Edit

Open **Studio** from the home page, or click **Make shorts →** after you stop a recording. Your last 5 meeting recordings are kept in the browser and listed there. You can also drop in any video file.

1. **Transcribe**: speech-to-text (Whisper) runs *in the browser*. The first time, it downloads an ~80 MB model from Hugging Face; after that it's cached. It uses the GPU (WebGPU) when available and falls back to the CPU. The transcript gives you clickable timestamps, captions and filler-word detection.
2. **Magic Clips**: choose how many clips and how long, then **Find clips**. Each clip gets a score, a title (click to edit), a reason, a ready-to-post caption, ±1 s trim buttons, **Preview**, and **Export short**.
3. **Magic Edit**: choose the silence threshold and whether to remove filler words, check the before → after length, preview with the cuts applied, then **Export edited video**.

Exports render on the user's computer with WebCodecs, frame by frame. They are frame-accurate and usually faster than real time. Chrome and Edge produce **MP4 (H.264/AAC)**, which is ready for TikTok, Reels and Shorts; browsers without an H.264 encoder produce WebM. Browsers without WebCodecs fall back to real-time recording.

**What leaves the computer:** only the transcript *text*, and only when you click **Find clips** with Claude enabled. Video and audio never do.

### Enabling Claude for Magic Clips

Add an Anthropic API key to the Railway service's **Variables**:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The server sends Claude the numbered transcript sentences with timestamps. Claude returns the best non-overlapping clips, each with a title, a caption, a reason and a score, as structured JSON. Without a key, or if a request fails, the Studio uses the built-in clip finder automatically. It scores windows by hook phrases, questions, pace, vocal energy and dead air, and penalizes small talk. Each visitor is limited to `CLIPS_RATE_LIMIT` requests per 10 minutes (default 10) so a public deployment can't run up your bill.

## Run locally (for development)

Requires Node.js 20+.

```bash
npm install
npm start      # http://localhost:3000
```

Open a meeting link in two tabs to test a call with yourself. Camera and mic only work on `localhost` or HTTPS, so for other devices use your Railway URL. You can also serve HTTPS directly with `SSL_KEY=key.pem SSL_CERT=cert.pem npm start`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP(S) port (Railway sets this automatically) |
| `MAX_PEERS` | `8` | Max people per meeting (mesh calls get heavy beyond ~8) |
| `SSL_KEY` / `SSL_CERT` | none | Paths to a key and certificate to serve HTTPS |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | none | Optional TURN relay (comma-separate multiple URLs) |
| `ANTHROPIC_API_KEY` | none | Lets Claude pick Magic Clips (otherwise the built-in finder is used) |
| `CLIPS_MODEL` | `claude-opus-5-5` | Claude model used for clip picking |
| `CLIPS_RATE_LIMIT` | `10` | Max clip-finding requests per visitor per 10 minutes |

## How it works

- `server.js` is an Express + Socket.IO **signaling server**. It tracks who is in each room and relays WebRTC offers, answers and ICE candidates, plus chat and mute/recording state. Media never passes through it.
- `public/app.js` is the meeting client. Each participant opens a direct `RTCPeerConnection` to every other participant (a mesh). Screen sharing swaps the outgoing video track with `replaceTrack`, so no renegotiation is needed.
- `public/studio.js` is the Studio UI. `public/magic.js` holds the editing algorithms: loudness-based silence detection, filler words, sentence building, the local clip scorer and caption grouping. They are pure functions with unit tests in `test/`. `public/transcribe-worker.js` runs Whisper (Transformers.js) in a Web Worker. `public/render.js` decodes the source with WebCodecs, draws every output frame (crop, blurred background, title, captions), and encodes and muxes MP4/WebM with [Mediabunny](https://mediabunny.dev). `clips.js` is the `/api/clips` endpoint that asks Claude for clips.
- `public/recorder.js` (`MeetingRecorder`) draws every participant's video onto a 1280×720 `<canvas>` 30 times a second. It mixes all audio tracks through the Web Audio API and records `canvas.captureStream()` + the mixed audio with `MediaRecorder`. When recording stops, it writes the duration into the WebM header so the file is seekable, then triggers a download.

## Project layout

```
server.js            signaling server + routes (/new, /:roomId, /config, /health)
railway.json         Railway build/deploy settings
public/index.html    home page (new meeting / join with code)
public/room.html     pre-join + meeting UI
public/app.js        WebRTC, controls, chat, participants
public/recorder.js   canvas/audio compositing + local recording download
public/storage.js    keeps recent recordings in IndexedDB for the Studio
public/studio.html   Studio page (Magic Clips / Magic Edit)
public/studio.js     Studio UI, timeline, transcript, previews, export drawing
public/magic.js      silence/filler detection, clip scoring, captions (unit-tested)
public/render.js     frame-accurate WebCodecs renderer (+ real-time fallback)
public/transcribe-worker.js  in-browser Whisper transcription
clips.js             /api/clips: Claude picks the best clips from the transcript
test/                unit tests (npm test)
public/style.css     styles
```
