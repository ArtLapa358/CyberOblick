/**
 * КиберОблик v2.0 — Server (Node.js + Express)
 * WebRTC Signaling + Viewer page + MP4 export
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check (required by most cloud hosts)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: '2.0' });
});

const avatarConfigs = new Map();
const signalingRooms = new Map();

// ── Avatar API ──
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

// ── Teams ──
const teamPresets = [
  { id: 'navi', name: 'Natus Vincere', colors: ['#FFDE00', '#1A1A1A'] },
  { id: 'spirit', name: 'Team Spirit', colors: ['#E31E24', '#FFFFFF'] },
  { id: 'vp', name: 'Virtus.pro', colors: ['#FF6B00', '#1A1A1A'] },
  { id: 'g2', name: 'G2 Esports', colors: ['#ED1C24', '#000000'] },
  { id: 'fnatic', name: 'Fnatic', colors: ['#FF5900', '#000000'] },
  { id: 'custom', name: 'Свой стиль', colors: ['#00F0FF', '#8B00FF'] }
];
app.get('/api/teams', (req, res) => res.json(teamPresets));

// ══════════════════════════════════════════
//  WebRTC Signaling (with viewer support)
// ══════════════════════════════════════════

app.post('/api/rtc/room', (req, res) => {
  const roomId = uuidv4().slice(0, 8);
  signalingRooms.set(roomId, {
    id: roomId, offers: [], answers: [],
    candidates: { streamer: [], viewer: [] },
    createdAt: Date.now(), active: true
  });
  res.json({ roomId });
});

// Room info for viewer
app.get('/api/rtc/room/:roomId', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ id: room.id, active: room.active, createdAt: room.createdAt });
});

// Active rooms list
app.get('/api/rtc/rooms', (req, res) => {
  const rooms = [];
  signalingRooms.forEach(r => { if (r.active) rooms.push({ id: r.id, createdAt: r.createdAt }); });
  res.json(rooms);
});

// SDP offer (streamer → server)
app.post('/api/rtc/room/:roomId/offer', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  room.offers.push(req.body);
  res.json({ success: true });
});
app.get('/api/rtc/room/:roomId/offer', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room.offers[room.offers.length - 1] || null);
});

// SDP answer (viewer → server)
app.post('/api/rtc/room/:roomId/answer', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  room.answers.push(req.body);
  res.json({ success: true });
});
app.get('/api/rtc/room/:roomId/answer', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room.answers[room.answers.length - 1] || null);
});

// ICE candidates by role
app.post('/api/rtc/room/:roomId/candidate/:role', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const role = req.params.role === 'viewer' ? 'viewer' : 'streamer';
  room.candidates[role].push(req.body);
  res.json({ success: true });
});
app.get('/api/rtc/room/:roomId/candidates/:role', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const role = req.params.role === 'viewer' ? 'viewer' : 'streamer';
  const since = parseInt(req.query.since) || 0;
  res.json(room.candidates[role].slice(since));
});

// Close room
app.post('/api/rtc/room/:roomId/close', (req, res) => {
  const room = signalingRooms.get(req.params.roomId);
  if (room) room.active = false;
  res.json({ success: true });
});

// ── Export ──
app.post('/api/export', (req, res) => {
  const { resolution, tier } = req.body;
  const isPro = tier === 'pro';
  if (resolution === '1080p' && !isPro) {
    return res.status(403).json({ error: 'Pro required' });
  }
  res.json({ success: true, watermark: !isPro, resolution: resolution || '720p', format: 'mp4' });
});

// Cleanup
setInterval(() => {
  const now = Date.now();
  signalingRooms.forEach((room, key) => {
    if (now - room.createdAt > 60 * 60 * 1000) signalingRooms.delete(key);
  });
}, 30 * 60 * 1000);

// Watch page
app.get('/watch/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  🎮 КиберОблик v2.0                 ║`);
  console.log(`  ║  Listening on ${HOST}:${PORT}       ║`);
  console.log(`  ║  Viewer: /watch/<roomId>             ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});

module.exports = app;
