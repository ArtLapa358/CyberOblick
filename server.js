const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const avatarConfigs = new Map();
const signalingRooms = new Map();

app.post('/api/avatar/save', (req, res) => {
  const { userId, config } = req.body;
  if (!config) return res.status(400).json({ error: 'Config required' });
  const id = uuidv4();
  avatarConfigs.set(id, { id, userId: userId || 'anon', config, createdAt: new Date().toISOString() });
  res.json({ success: true, id });
});
app.get('/api/avatar/:id', (req, res) => {
  const r = avatarConfigs.get(req.params.id);
  r ? res.json(r) : res.status(404).json({ error: 'Not found' });
});

const teamPresets = [
  { id: 'navi', name: 'Natus Vincere', colors: ['#FFDE00', '#1A1A1A'] },
  { id: 'spirit', name: 'Team Spirit', colors: ['#E31E24', '#FFFFFF'] },
  { id: 'vp', name: 'Virtus.pro', colors: ['#FF6B00', '#1A1A1A'] },
  { id: 'g2', name: 'G2 Esports', colors: ['#ED1C24', '#000000'] },
  { id: 'fnatic', name: 'Fnatic', colors: ['#FF5900', '#000000'] },
  { id: 'custom', name: 'Свой стиль', colors: ['#00F0FF', '#8B00FF'] }
];
app.get('/api/teams', (req, res) => res.json(teamPresets));

app.post('/api/rtc/room', (req, res) => {
  const roomId = uuidv4().slice(0, 8);
  signalingRooms.set(roomId, {
    id: roomId,
    peers: new Map(),
    pendingViewers: [],
    createdAt: Date.now(),
    active: true
  });
  res.json({ roomId });
});

app.get('/api/rtc/room/:roomId', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    id: room.id,
    active: room.active,
    createdAt: room.createdAt,
    viewers: room.peers.size
  });
});

app.get('/api/rtc/rooms', (req, res) => {
  const rooms = [];
  signalingRooms.forEach(r => {
    if (r.active) rooms.push({ id: r.id, createdAt: r.createdAt, viewers: r.peers.size });
  });
  res.json(rooms);
});

app.post('/api/rtc/room/:roomId/join', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.active) return res.status(410).json({ error: 'Stream ended' });

  const peerId = uuidv4().slice(0, 12);
  room.peers.set(peerId, {
    peerId,
    offer: null,
    answer: null,
    streamerCandidates: [],
    viewerCandidates: [],
    createdAt: Date.now()
  });
  room.pendingViewers.push(peerId);
  res.json({ peerId });
});

app.get('/api/rtc/room/:roomId/pending-viewers', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  // Atomic drain of the queue
  const pending = room.pendingViewers.splice(0, room.pendingViewers.length);
  res.json({ peerIds: pending });
});

app.post('/api/rtc/room/:roomId/peer/:peerId/offer', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const peer = room.peers.get(req.params.peerId);
  if (!peer) return res.status(404).json({ error: 'Peer not found' });
  peer.offer = req.body;
  res.json({ success: true });
});

app.get('/api/rtc/room/:roomId/peer/:peerId/offer', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const peer = room.peers.get(req.params.peerId);
  if (!peer) return res.status(404).json({ error: 'Peer not found' });
  res.json(peer.offer || null);
});

app.post('/api/rtc/room/:roomId/peer/:peerId/answer', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const peer = room.peers.get(req.params.peerId);
  if (!peer) return res.status(404).json({ error: 'Peer not found' });
  peer.answer = req.body;
  res.json({ success: true });
});

app.get('/api/rtc/room/:roomId/peer/:peerId/answer', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const peer = room.peers.get(req.params.peerId);
  if (!peer) return res.status(404).json({ error: 'Peer not found' });
  res.json(peer.answer || null);
});

app.post('/api/rtc/room/:roomId/peer/:peerId/candidate/:role', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const peer = room.peers.get(req.params.peerId);
  if (!peer) return res.status(404).json({ error: 'Peer not found' });
  const key = req.params.role === 'viewer' ? 'viewerCandidates' : 'streamerCandidates';
  peer[key].push(req.body);
  res.json({ success: true });
});

app.get('/api/rtc/room/:roomId/peer/:peerId/candidates/:role', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const peer = room.peers.get(req.params.peerId);
  if (!peer) return res.status(404).json({ error: 'Peer not found' });
  const key = req.params.role === 'viewer' ? 'viewerCandidates' : 'streamerCandidates';
  const since = parseInt(req.query.since) || 0;
  res.json(peer[key].slice(since));
});

app.post('/api/rtc/room/:roomId/close', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (room) room.active = false;
  res.json({ success: true });
});

app.post('/api/rtc/room/:roomId/peer/:peerId/leave', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.json({ success: true });
  room.peers.delete(req.params.peerId);
  res.json({ success: true });
});

app.post('/api/export', (req, res) => {
  const { resolution, tier } = req.body;
  const isPro = tier === 'pro';
  if (resolution === '1080p' && !isPro) {
    return res.status(403).json({ error: 'Pro required' });
  }
  res.json({ success: true, watermark: !isPro, resolution: resolution || '720p', format: 'mp4' });
});

setInterval(() => {
  const now = Date.now();
  signalingRooms.forEach((room, key) => {
    if (now - room.createdAt > 60 * 60 * 1000) signalingRooms.delete(key);
  });
}, 30 * 60 * 1000);

app.get('/watch/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  🎮 КиберОблик v2.1                 ║`);
  console.log(`  ║  http://localhost:${PORT}              ║`);
  console.log(`  ║  Viewer: /watch/<roomId>             ║`);
  console.log(`  ║  Multi-viewer: ON                    ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});

module.exports = app;
