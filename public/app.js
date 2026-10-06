(() => {
  'use strict';

  // ---------- Icons (Material icons, inline SVG) ----------
  const ICONS = {
    mic: 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
    micOff: 'M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z',
    cam: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
    camOff: 'M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z',
    share: 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zm-7-3.53v-2.19c-2.78 0-4.61.85-6 2.72.56-2.67 2.11-5.33 6-5.87V7l4 3.73-4 3.74z',
    rec: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-13a5 5 0 1 0 0 10 5 5 0 1 0 0-10z',
    stop: 'M6 6h12v12H6z',
    leave: 'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z',
    chat: 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
    people: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
  const setIcon = (el, name) => {
    const badge = el.querySelector('.badge, .dot');
    el.innerHTML = svg(name);
    if (badge) el.appendChild(badge);
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- State ----------
  const roomId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const state = {
    name: '',
    myId: null,
    localStream: new MediaStream(),
    micTrack: null,
    camTrack: null,
    screenTrack: null,
    micOn: true,
    camOn: true,
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    recorder: null,
    chatUnread: false,
    panel: null, // 'chat' | 'people' | null
  };
  /** id -> { id, name, pc, stream, tile, audio, video, sharing, recording, queue, pendingCandidates } */
  const peers = new Map();
  let socket = null;
  let localTile = null;

  document.title = `Meeting · ${roomId}`;

  // ---------- Toasts ----------
  function toast(message, ms = 3500, link) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    if (link) {
      const a = document.createElement('a');
      a.href = link.href;
      a.target = '_blank';
      a.textContent = link.label;
      el.append(' ', a);
    }
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  // ---------- Media ----------
  async function acquireMedia() {
    const attempts = [
      { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
      { audio: true, video: false },
      { audio: false, video: true },
    ];
    let lastError;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera/mic access requires HTTPS or localhost.');
    }
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  /** The video track we currently send to peers (screen share wins over camera). */
  const outgoingVideo = () => state.screenTrack || state.camTrack;

  function trackFor(kind) {
    return kind === 'audio' ? state.micTrack : outgoingVideo();
  }

  // ---------- Pre-join ----------
  async function initPrejoin() {
    $('pre-code').textContent = `Meeting code: ${roomId}`;
    $('code-label').textContent = roomId;
    $('name').value = localStorage.getItem('meeting:name') || '';
    setIcon($('pre-mic'), 'mic');
    setIcon($('pre-cam'), 'cam');

    try {
      const stream = await acquireMedia();
      state.micTrack = stream.getAudioTracks()[0] || null;
      state.camTrack = stream.getVideoTracks()[0] || null;
      state.localStream = stream;
    } catch (err) {
      showPreError(
        `Couldn't access your camera or microphone (${err.message || err.name}). ` +
          'You can still join to watch and listen.'
      );
    }
    state.micOn = Boolean(state.micTrack);
    state.camOn = Boolean(state.camTrack);
    $('preview').srcObject = state.localStream;
    renderPrejoinButtons();

    const cfg = await fetch('/config').then((r) => r.json()).catch(() => null);
    if (cfg?.iceServers) state.iceServers = cfg.iceServers;

    const updateJoin = () => ($('join').disabled = !$('name').value.trim());
    $('name').addEventListener('input', updateJoin);
    $('name').addEventListener('keydown', (e) => e.key === 'Enter' && !$('join').disabled && join());
    updateJoin();
    $('pre-mic').onclick = () => { toggleMic(); renderPrejoinButtons(); };
    $('pre-cam').onclick = () => { toggleCam(); renderPrejoinButtons(); };
    $('join').onclick = join;
    $('name').focus();
  }

  function showPreError(msg) {
    $('pre-error').textContent = msg;
    $('pre-error').hidden = false;
  }

  function renderPrejoinButtons() {
    renderToggle($('pre-mic'), state.micOn, Boolean(state.micTrack), 'mic', 'microphone');
    renderToggle($('pre-cam'), state.camOn, Boolean(state.camTrack), 'cam', 'camera');
    $('preview-off').hidden = state.camOn;
    $('preview').hidden = !state.camOn;
  }

  function renderToggle(btn, on, available, icon, label) {
    setIcon(btn, on ? icon : `${icon}Off`);
    btn.classList.toggle('off', !on);
    btn.disabled = !available;
    btn.title = available ? `Turn ${on ? 'off' : 'on'} ${label}` : `No ${label} found`;
  }

  // ---------- Join / leave ----------
  function join() {
    state.name = $('name').value.trim().slice(0, 40);
    localStorage.setItem('meeting:name', state.name);
    $('join').disabled = true;
    $('join').textContent = 'Joining…';

    socket = io();
    socket.on('connect_error', () => toast('Connection problem — retrying…'));
    socket.on('peer-joined', (p) => {
      createPeer(p, false);
      toast(`${p.name} joined`);
    });
    socket.on('peer-left', ({ id }) => removePeer(id, true));
    socket.on('peer-state', updatePeerState);
    socket.on('signal', onSignal);
    socket.on('chat', onChat);
    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') toast('Disconnected from server');
    });

    socket.emit('join', { roomId, name: state.name, audio: state.micOn, video: state.camOn }, (res) => {
      if (res.error) {
        socket.disconnect();
        $('join').textContent = 'Join now';
        $('join').disabled = false;
        showPreError(res.error);
        return;
      }
      state.myId = res.id;
      enterMeeting();
      for (const p of res.peers) createPeer(p, true);
    });
  }

  function enterMeeting() {
    $('prejoin').hidden = true;
    $('meeting').hidden = false;
    $('preview').srcObject = null;

    localTile = createTile({ id: 'local', name: `${state.name} (You)`, isLocal: true });
    localTile.video.srcObject = new MediaStream(state.camTrack ? [state.camTrack] : []);
    renderLocalTile();
    layoutGrid();
    renderControls();
    renderPeople();

    $('btn-mic').onclick = () => { toggleMic(); renderControls(); };
    $('btn-cam').onclick = () => { toggleCam(); renderControls(); };
    $('btn-share').onclick = () => (state.screenTrack ? stopShare() : startShare());
    $('btn-rec').onclick = () => (state.recorder ? stopRecording() : startRecording());
    $('btn-leave').onclick = leave;
    $('btn-chat').onclick = () => togglePanel('chat');
    $('btn-people').onclick = () => togglePanel('people');
    $('panel-close').onclick = () => togglePanel(null);
    $('btn-copy').onclick = copyLink;
    $('chat-form').onsubmit = sendChat;
    setIcon($('btn-copy'), 'copy');
    setIcon($('btn-chat'), 'chat');
    setIcon($('btn-people'), 'people');
    setIcon($('panel-close'), 'close');
    setIcon($('chat-send'), 'send');
    setIcon($('btn-leave'), 'leave');
    setIcon($('btn-share'), 'share');

    if (!MeetingRecorder.isSupported()) {
      $('btn-rec').disabled = true;
      $('btn-rec').title = 'Recording is not supported in this browser';
    }

    const tickClock = () =>
      ($('time').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    tickClock();
    setInterval(tickClock, 5000);
    setInterval(updateRecBanner, 500);

    window.addEventListener('beforeunload', (e) => {
      if (state.recorder) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('resize', layoutGrid);
  }

  async function leave() {
    let note = '';
    if (state.recorder) {
      const file = await stopRecording();
      if (file) note = `Your recording was saved as ${file}.`;
      if (state.lastRecordingId) {
        $('studio-link').href = `/studio#${state.lastRecordingId}`;
        $('studio-link').hidden = false;
      }
    }
    socket?.disconnect();
    for (const id of [...peers.keys()]) removePeer(id, false);
    state.localStream.getTracks().forEach((t) => t.stop());
    state.screenTrack?.stop();
    $('meeting').hidden = true;
    $('left').hidden = false;
    $('left-note').textContent = note;
  }

  // ---------- Controls ----------
  function toggleMic() {
    if (!state.micTrack) return;
    state.micOn = !state.micOn;
    state.micTrack.enabled = state.micOn;
    broadcastState();
  }

  function toggleCam() {
    if (!state.camTrack) return;
    state.camOn = !state.camOn;
    state.camTrack.enabled = state.camOn;
    broadcastState();
  }

  function broadcastState() {
    socket?.emit('state', {
      audio: state.micOn,
      video: state.camOn,
      sharing: Boolean(state.screenTrack),
      recording: Boolean(state.recorder),
    });
  }

  function renderControls() {
    renderToggle($('btn-mic'), state.micOn, Boolean(state.micTrack), 'mic', 'microphone');
    renderToggle($('btn-cam'), state.camOn, Boolean(state.camTrack), 'cam', 'camera');
    const sharing = Boolean(state.screenTrack);
    $('btn-share').classList.toggle('active', sharing);
    $('btn-share').title = sharing ? 'Stop presenting' : 'Present now';
    const recording = Boolean(state.recorder);
    setIcon($('btn-rec'), recording ? 'stop' : 'rec');
    $('btn-rec').classList.toggle('recording', recording);
    if (MeetingRecorder.isSupported()) {
      $('btn-rec').title = recording ? 'Stop recording & download' : 'Record meeting';
    }
    renderLocalTile();
    renderPeople();
  }

  async function copyLink() {
    const url = `${location.origin}/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Meeting link copied');
    } catch {
      prompt('Copy this meeting link:', url);
    }
  }

  // ---------- Screen share ----------
  async function startShare() {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      state.screenTrack = display.getVideoTracks()[0];
      state.screenTrack.contentHint = 'detail';
      state.screenTrack.onended = stopShare;
    } catch (err) {
      if (err.name !== 'NotAllowedError') toast(`Couldn't share screen: ${err.message}`);
      return;
    }
    await replaceOutgoingVideo();
    localTile.video.srcObject = new MediaStream([state.screenTrack]);
    renderControls();
    broadcastState();
    toast('You are presenting to everyone');
  }

  async function stopShare() {
    if (!state.screenTrack) return;
    state.screenTrack.onended = null;
    state.screenTrack.stop();
    state.screenTrack = null;
    await replaceOutgoingVideo();
    localTile.video.srcObject = new MediaStream(state.camTrack ? [state.camTrack] : []);
    renderControls();
    broadcastState();
  }

  async function replaceOutgoingVideo() {
    const track = outgoingVideo();
    await Promise.all(
      [...peers.values()].flatMap(({ pc }) =>
        pc.getTransceivers()
          .filter((t) => t.receiver.track.kind === 'video' && t.sender)
          .map((t) => t.sender.replaceTrack(track).catch(() => {}))
      )
    );
  }

  // ---------- Peers / WebRTC ----------
  function createPeer(info, initiator) {
    if (peers.has(info.id)) return peers.get(info.id);
    const pc = new RTCPeerConnection({ iceServers: state.iceServers });
    const peer = {
      ...info,
      pc,
      stream: new MediaStream(),
      queue: Promise.resolve(),
      pendingCandidates: [],
    };
    peer.tile = createTile({ id: info.id, name: info.name, isLocal: false });
    peer.tile.video.srcObject = peer.stream;
    peers.set(info.id, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('signal', { to: info.id, data: { candidate } });
    };
    pc.ontrack = ({ track }) => {
      for (const old of peer.stream.getTracks()) {
        if (old.kind === track.kind && old !== track) peer.stream.removeTrack(old);
      }
      peer.stream.addTrack(track);
      peer.tile.video.srcObject = peer.stream; // nudge Safari to pick up new tracks
      peer.tile.video.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      peer.tile.el.classList.toggle('connecting', !['connected', 'completed'].includes(pc.connectionState));
      if (pc.connectionState === 'failed' && initiator) {
        pc.restartIce();
        negotiate(peer);
      }
    };

    if (initiator) {
      for (const kind of ['audio', 'video']) {
        const track = trackFor(kind);
        pc.addTransceiver(track || kind, { direction: 'sendrecv' });
      }
      negotiate(peer);
    }

    renderPeerTile(peer);
    layoutGrid();
    renderPeople();
    return peer;
  }

  function negotiate(peer) {
    peer.queue = peer.queue
      .then(async () => {
        await peer.pc.setLocalDescription(await peer.pc.createOffer());
        socket.emit('signal', { to: peer.id, data: { description: peer.pc.localDescription } });
      })
      .catch((err) => console.error('negotiation failed', err));
  }

  function onSignal({ from, data }) {
    const peer = peers.get(from) || createPeer({ id: from, name: 'Guest' }, false);
    // Process signals for each peer strictly in order.
    peer.queue = peer.queue
      .then(() => handleSignal(peer, data))
      .catch((err) => console.error('signal error', err));
  }

  async function handleSignal(peer, data) {
    const { pc } = peer;
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        // Attach our tracks to the transceivers created by the offer.
        for (const t of pc.getTransceivers()) {
          const kind = t.receiver.track.kind;
          t.direction = 'sendrecv';
          await t.sender.replaceTrack(trackFor(kind));
        }
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('signal', { to: peer.id, data: { description: pc.localDescription } });
      }
      for (const c of peer.pendingCandidates.splice(0)) {
        await pc.addIceCandidate(c).catch(() => {});
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pendingCandidates.push(data.candidate);
    }
  }

  function removePeer(id, announce) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.tile.el.remove();
    peers.delete(id);
    if (announce) toast(`${peer.name} left`);
    layoutGrid();
    renderPeople();
    updateRecBanner();
  }

  function updatePeerState(info) {
    const peer = peers.get(info.id);
    if (!peer) return;
    const wasRecording = peer.recording;
    const wasSharing = peer.sharing;
    Object.assign(peer, info);
    if (!wasRecording && peer.recording) toast(`${peer.name} started recording this meeting`);
    if (wasRecording && !peer.recording) toast(`${peer.name} stopped recording`);
    if (!wasSharing && peer.sharing) toast(`${peer.name} is presenting`);
    renderPeerTile(peer);
    layoutGrid();
    renderPeople();
    updateRecBanner();
  }

  // ---------- Tiles ----------
  function createTile({ id, name, isLocal }) {
    const el = document.createElement('div');
    el.className = 'tile' + (isLocal ? ' local' : ' connecting');
    el.dataset.id = id;
    el.innerHTML = `
      <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
      <div class="avatar"><span></span></div>
      <div class="tile-name"></div>
      <div class="tile-mic" hidden>${svg('micOff')}</div>`;
    $('grid').appendChild(el);
    const tile = {
      el,
      video: el.querySelector('video'),
      avatar: el.querySelector('.avatar'),
      nameEl: el.querySelector('.tile-name'),
      micEl: el.querySelector('.tile-mic'),
    };
    setTileName(tile, name);
    return tile;
  }

  function setTileName(tile, name) {
    tile.nameEl.textContent = name;
    tile.avatar.querySelector('span').textContent = (name || '?').trim().charAt(0).toUpperCase();
    tile.avatar.querySelector('span').style.background = MeetingRecorder.colorFor(name.replace(' (You)', ''));
  }

  function renderLocalTile() {
    if (!localTile) return;
    const sharing = Boolean(state.screenTrack);
    const showVideo = sharing || (state.camOn && Boolean(state.camTrack));
    localTile.el.classList.toggle('video-off', !showVideo);
    localTile.el.classList.toggle('screen', sharing);
    localTile.micEl.hidden = state.micOn;
    layoutGrid();
  }

  function renderPeerTile(peer) {
    setTileName(peer.tile, peer.name);
    const showVideo = peer.sharing || peer.video;
    peer.tile.el.classList.toggle('video-off', !showVideo);
    peer.tile.el.classList.toggle('screen', Boolean(peer.sharing));
    peer.tile.micEl.hidden = Boolean(peer.audio);
  }

  function layoutGrid() {
    const grid = $('grid');
    const tiles = [...grid.children];
    const featured = tiles.find((t) => t.classList.contains('screen'));
    grid.classList.toggle('presenting', Boolean(featured) && tiles.length > 1);
    tiles.forEach((t) => t.classList.toggle('featured', t === featured && tiles.length > 1));
    if (featured && tiles.length > 1) {
      grid.style.gridTemplateColumns = '';
      grid.style.gridTemplateRows = `repeat(${tiles.length - 1}, minmax(0, 1fr))`;
      return;
    }
    const n = tiles.length || 1;
    const { width, height } = grid.getBoundingClientRect();
    // Pick the column count that gives the largest 16:9 tiles.
    let best = 1;
    let bestArea = 0;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min(width / cols, ((height / rows) * 16) / 9);
      if (w > bestArea) {
        bestArea = w;
        best = cols;
      }
    }
    grid.style.gridTemplateColumns = `repeat(${best}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${Math.ceil(n / best)}, minmax(0, 1fr))`;
  }

  // ---------- Recording ----------
  function recordingTiles() {
    const tiles = [];
    const localSharing = Boolean(state.screenTrack);
    tiles.push({
      video: localTile.video,
      name: state.name,
      showVideo: localSharing || (state.camOn && Boolean(state.camTrack)),
      contain: localSharing,
    });
    for (const p of peers.values()) {
      tiles.push({ video: p.tile.video, name: p.name, showVideo: p.sharing || p.video, contain: Boolean(p.sharing) });
    }
    return tiles;
  }

  function recordingAudio() {
    const tracks = [];
    if (state.micTrack) tracks.push(state.micTrack); // muted mic = disabled track = silence
    for (const p of peers.values()) tracks.push(...p.stream.getAudioTracks());
    return tracks;
  }

  function fileStamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
      `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
    );
  }

  async function startRecording() {
    const recorder = new MeetingRecorder({
      getTiles: recordingTiles,
      getAudio: recordingAudio,
      fileName: `meeting-${roomId}-${fileStamp()}`,
    });
    try {
      await recorder.start();
    } catch (err) {
      console.error(err);
      toast(`Couldn't start recording: ${err.message}`);
      return;
    }
    state.recorder = recorder;
    renderControls();
    broadcastState();
    updateRecBanner();
    toast('Recording started — the file will download when you stop');
  }

  async function stopRecording() {
    const recorder = state.recorder;
    if (!recorder) return null;
    state.recorder = null;
    $('btn-rec').disabled = true;
    let file = null;
    try {
      file = await recorder.stop();
      let studio;
      try {
        state.lastRecordingId = await RecordingStore.save({ name: file, blob: recorder.lastBlob });
        studio = { href: `/studio#${state.lastRecordingId}`, label: 'Make shorts →' };
      } catch (err) {
        console.warn('Could not keep recording for Studio', err);
      }
      toast(`Recording saved to your Downloads: ${file}`, 9000, studio);
    } catch (err) {
      console.error(err);
      toast(`Recording failed: ${err.message}`);
    }
    $('btn-rec').disabled = false;
    renderControls();
    broadcastState();
    updateRecBanner();
    return file;
  }

  function updateRecBanner() {
    const others = [...peers.values()].filter((p) => p.recording).map((p) => p.name);
    const banner = $('rec-banner');
    if (state.recorder) {
      const s = Math.floor(state.recorder.elapsedMs / 1000);
      const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      $('rec-text').textContent = `You are recording · ${time}`;
      banner.hidden = false;
    } else if (others.length) {
      $('rec-text').textContent = `${others.join(', ')} ${others.length > 1 ? 'are' : 'is'} recording`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  // ---------- Side panel: chat & people ----------
  function togglePanel(which) {
    state.panel = state.panel === which ? null : which;
    $('panel').hidden = !state.panel;
    $('chat-view').hidden = state.panel !== 'chat';
    $('people-view').hidden = state.panel !== 'people';
    $('panel-title').textContent = state.panel === 'people' ? 'People' : 'In-call messages';
    $('btn-chat').classList.toggle('active', state.panel === 'chat');
    $('btn-people').classList.toggle('active', state.panel === 'people');
    if (state.panel === 'chat') {
      state.chatUnread = false;
      $('chat-dot').hidden = true;
      $('chat-input').focus();
    }
    requestAnimationFrame(layoutGrid);
  }

  function sendChat(e) {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text) return;
    socket.emit('chat', text);
    $('chat-input').value = '';
  }

  function onChat({ from, name, text, at }) {
    const mine = from === state.myId;
    const el = document.createElement('div');
    el.className = 'message';
    const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.innerHTML = `<div class="meta"><strong>${escapeHtml(mine ? 'You' : name)}</strong> <span>${time}</span></div>
      <div class="text">${escapeHtml(text)}</div>`;
    const box = $('messages');
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    if (state.panel !== 'chat' && !mine) {
      $('chat-dot').hidden = false;
      toast(`${name}: ${text.length > 60 ? text.slice(0, 57) + '…' : text}`);
    }
  }

  function renderPeople() {
    const list = $('people');
    if (!list) return;
    const rows = [
      { name: `${state.name} (You)`, audio: state.micOn, recording: Boolean(state.recorder), sharing: Boolean(state.screenTrack) },
      ...[...peers.values()].map((p) => ({ name: p.name, audio: p.audio, recording: p.recording, sharing: p.sharing })),
    ];
    list.innerHTML = rows
      .map(
        (r) => `<li>
          <span class="avatar-sm" style="background:${MeetingRecorder.colorFor(r.name.replace(' (You)', ''))}">${escapeHtml(r.name.charAt(0).toUpperCase())}</span>
          <span class="person-name">${escapeHtml(r.name)}
            ${r.sharing ? '<em>Presenting</em>' : ''}${r.recording ? '<em class="red">Recording</em>' : ''}</span>
          <span class="person-mic ${r.audio ? '' : 'off'}">${svg(r.audio ? 'mic' : 'micOff')}</span>
        </li>`
      )
      .join('');
    $('people-count').textContent = rows.length;
  }

  initPrejoin();
})();
