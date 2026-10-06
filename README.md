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

## How it works

- `server.js` is an Express + Socket.IO **signaling server**. It tracks who is in each room and relays WebRTC offers, answers and ICE candidates, plus chat and mute/recording state. Media never passes through it.
- `public/app.js` is the meeting client. Each participant opens a direct `RTCPeerConnection` to every other participant (a mesh). Screen sharing swaps the outgoing video track with `replaceTrack`, so no renegotiation is needed.
- `public/recorder.js` (`MeetingRecorder`) draws every participant's video onto a 1280×720 `<canvas>` 30 times a second. It mixes all audio tracks through the Web Audio API and records `canvas.captureStream()` + the mixed audio with `MediaRecorder`. When recording stops, it writes the duration into the WebM header so the file is seekable, then triggers a download.

## Project layout

```
server.js            signaling server + routes (/new, /:roomId, /config, /health)
railway.json         Railway build/deploy settings
public/index.html    home page (new meeting / join with code)
public/room.html     pre-join + meeting UI
public/app.js        WebRTC, controls, chat, participants
public/recorder.js   canvas/audio compositing + local recording download
public/style.css     styles
```
