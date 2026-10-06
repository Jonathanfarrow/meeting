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

## Run it

Requires Node.js 18+.

```bash
npm install
npm start
```

Open <http://localhost:3000>, click **New meeting**, and share the link. To test on one machine, open the link in a second tab or browser window.

### Recording

1. In a meeting, click the **record** button (the circle in the bottom bar).
2. Click it again (now a square) to stop. The browser downloads the file right away.
3. Leaving the meeting while recording stops the recording and saves the file first.

Chrome, Edge and Firefox save **WebM** (VP9/VP8 + Opus); it plays in Chrome, Firefox, VLC and most modern players. Safari saves **MP4**.

Keep the meeting tab open while recording. The recorder keeps running in a background tab, but browsers may lower the frame rate there.

## Joining from other devices

Browsers only allow camera and microphone access on `localhost` or over **HTTPS**. To join from a phone or another computer:

- **Quickest:** use a tunnel such as `npx localtunnel --port 3000` or `cloudflared tunnel --url http://localhost:3000`, then share the HTTPS URL it gives you.
- **Or** serve HTTPS directly with a certificate:

  ```bash
  SSL_KEY=certs/key.pem SSL_CERT=certs/cert.pem npm start
  ```

### TURN server (optional)

Calls connect directly between browsers using public STUN servers. That works on most networks. People behind strict corporate NATs or firewalls may need a TURN relay:

```bash
TURN_URL=turn:turn.example.com:3478 TURN_USERNAME=user TURN_CREDENTIAL=secret npm start
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP(S) port |
| `MAX_PEERS` | `8` | Max people per meeting (mesh calls get heavy beyond ~8) |
| `SSL_KEY` / `SSL_CERT` | none | Paths to a key and certificate to serve HTTPS |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | none | Optional TURN relay (comma-separate multiple URLs) |

## How it works

- `server.js` is an Express + Socket.IO **signaling server**. It tracks who is in each room and relays WebRTC offers, answers and ICE candidates, plus chat and mute/recording state. Media never passes through it.
- `public/app.js` is the meeting client. Each participant opens a direct `RTCPeerConnection` to every other participant (a mesh). Screen sharing swaps the outgoing video track with `replaceTrack`, so no renegotiation is needed.
- `public/recorder.js` (`MeetingRecorder`) draws every participant's video onto a 1280×720 `<canvas>` 30 times a second. It mixes all audio tracks through the Web Audio API and records `canvas.captureStream()` + the mixed audio with `MediaRecorder`. When recording stops, it writes the duration into the WebM header so the file is seekable, then triggers a download.

## Project layout

```
server.js            signaling server + routes (/new, /:roomId, /config)
public/index.html    home page (new meeting / join with code)
public/room.html     pre-join + meeting UI
public/app.js        WebRTC, controls, chat, participants
public/recorder.js   canvas/audio compositing + local recording download
public/style.css     styles
```
