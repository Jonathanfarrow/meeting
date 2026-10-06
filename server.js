const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const MAX_PEERS_PER_ROOM = Number(process.env.MAX_PEERS) || 8;
const ROOM_ID_RE = /^[a-z0-9-]{3,64}$/i;

const app = express();

// Serve over HTTPS when a cert is provided. Browsers only allow camera/mic
// access on secure origins, so this is needed when joining from other devices
// on your network (localhost works fine over plain HTTP).
const server =
  process.env.SSL_KEY && process.env.SSL_CERT
    ? https.createServer(
        { key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT) },
        app
      )
    : http.createServer(app);

const io = new Server(server);

function makeRoomId() {
  // Meet-style code, e.g. "abc-defg-hij"
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const pick = (n) =>
    Array.from(crypto.randomBytes(n), (b) => letters[b % letters.length]).join('');
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(','),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/new', (req, res) => res.redirect(`/${makeRoomId()}`));

app.get('/config', (req, res) => res.json({ iceServers: iceServers() }));

app.get('/:roomId', (req, res, next) => {
  if (!ROOM_ID_RE.test(req.params.roomId)) return next();
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// roomId -> Map(socketId -> participant info)
const rooms = new Map();

function clean(str, max) {
  return String(str ?? '').trim().slice(0, max);
}

io.on('connection', (socket) => {
  socket.on('join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const roomId = clean(payload?.roomId, 64).toLowerCase();
    if (!ROOM_ID_RE.test(roomId)) return ack({ error: 'Invalid meeting code.' });
    if (socket.data.roomId) return ack({ error: 'Already in a meeting.' });

    const room = rooms.get(roomId) ?? new Map();
    if (room.size >= MAX_PEERS_PER_ROOM) {
      return ack({ error: `This meeting is full (max ${MAX_PEERS_PER_ROOM} people).` });
    }

    const me = {
      id: socket.id,
      name: clean(payload?.name, 40) || 'Guest',
      audio: Boolean(payload?.audio),
      video: Boolean(payload?.video),
      sharing: false,
      recording: false,
    };
    const peers = [...room.values()];
    room.set(socket.id, me);
    rooms.set(roomId, room);
    socket.data.roomId = roomId;
    socket.join(roomId);

    // Tell existing peers first so they're ready when the newcomer's offers arrive.
    socket.to(roomId).emit('peer-joined', me);
    ack({ id: socket.id, peers });
  });

  socket.on('signal', ({ to, data } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.get(roomId)?.has(to)) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('state', (patch = {}) => {
    const roomId = socket.data.roomId;
    const me = rooms.get(roomId)?.get(socket.id);
    if (!me) return;
    for (const key of ['audio', 'video', 'sharing', 'recording']) {
      if (key in patch) me[key] = Boolean(patch[key]);
    }
    socket.to(roomId).emit('peer-state', me);
  });

  socket.on('chat', (text) => {
    const roomId = socket.data.roomId;
    const me = rooms.get(roomId)?.get(socket.id);
    const message = clean(text, 2000);
    if (!me || !message) return;
    io.to(roomId).emit('chat', { from: socket.id, name: me.name, text: message, at: Date.now() });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    room.delete(socket.id);
    if (room.size === 0) rooms.delete(roomId);
    socket.to(roomId).emit('peer-left', { id: socket.id });
  });
});

server.listen(PORT, () => {
  const scheme = server instanceof https.Server ? 'https' : 'http';
  console.log(`Meeting server running at ${scheme}://localhost:${PORT}`);
});
