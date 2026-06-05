const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { LuaWorldRunner } = require('./lua-runner');

const app = express();
app.use(express.json({ limit: '10mb' }));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const WORLDS_DIR = path.join(__dirname, '..', 'worlds');

// Serve client files
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use('/sdk', express.static(path.join(__dirname, '..', 'sdk')));
app.use('/node_modules', express.static(path.join(__dirname, '..', 'node_modules')));

// Builder
app.get('/builder', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'client', 'builder', 'index.html')));

// Save world from builder
app.post('/api/world/:id/save', (req, res) => {
  const id = req.params.id.replace(/[^a-z0-9_-]/gi, '');
  const dir = path.join(WORLDS_DIR, id);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'World not found' });
  const data = req.body;
  if (!data || !data.objects) return res.status(400).json({ error: 'Invalid world data' });
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify(data, null, 2));
  delete worlds[id]; // clear cache so next visit reloads
  res.json({ ok: true });
});

// World manifest API
app.get('/api/worlds', (req, res) => {
  const worlds = fs.readdirSync(WORLDS_DIR)
    .filter(d => fs.existsSync(path.join(WORLDS_DIR, d, 'world.json')))
    .map(d => {
      const meta = JSON.parse(fs.readFileSync(path.join(WORLDS_DIR, d, 'world.json')));
      return { id: d, name: meta.name, description: meta.description, thumbnail: meta.thumbnail };
    });
  res.json(worlds);
});

// Serve world data
app.get('/api/world/:id', (req, res) => {
  const worldPath = path.join(WORLDS_DIR, req.params.id, 'world.json');
  if (!fs.existsSync(worldPath)) return res.status(404).json({ error: 'World not found' });
  res.sendFile(worldPath);
});

app.get('/api/world/:id/script', (req, res) => {
  const scriptPath = path.join(WORLDS_DIR, req.params.id, 'main.lua');
  if (!fs.existsSync(scriptPath)) return res.json({ script: '' });
  res.type('text/plain').send(fs.readFileSync(scriptPath, 'utf8'));
});

// Status endpoint — used by luagen CLI
const _startTime = Date.now();
app.get('/api/status', (req, res) => {
  const worldList = Object.entries(worlds).map(([id, w]) => {
    const meta = w.data || {};
    return {
      id,
      name: meta.name || id,
      players: w.players.size,
      playerList: [...w.players.values()].map(p => ({ id: p.id, name: p.name })),
    };
  });
  res.json({
    port: PORT,
    uptime: Math.floor((Date.now() - _startTime) / 1000),
    totalPlayers: worldList.reduce((n, w) => n + w.players, 0),
    worlds: worldList,
  });
});

// WebSocket: multiplayer state sync
const worlds = {}; // worldId -> { players: Map<ws, player>, runner: LuaWorldRunner }

function broadcastToWorld(world, msg, except = null) {
  const data = JSON.stringify(msg);
  for (const [ws] of world.players) {
    if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

async function getWorld(id) {
  if (worlds[id]) return worlds[id];

  const worldPath = path.join(WORLDS_DIR, id, 'world.json');
  if (!fs.existsSync(worldPath)) return null;

  const worldData = JSON.parse(fs.readFileSync(worldPath));
  const world = { players: new Map(), data: worldData };
  worlds[id] = world;

  // Start Lua runner
  const scriptPath = path.join(WORLDS_DIR, id, 'main.lua');
  const luaSource = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  world.runner = new LuaWorldRunner(id, worldData, (msg) => broadcastToWorld(world, msg));
  world.runner.loadScript(luaSource);

  return world;
}

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://localhost`);
  const worldId = url.searchParams.get('world') || 'demo';
  const playerId = Math.random().toString(36).slice(2, 9);
  const world = await getWorld(worldId);

  if (!world) { ws.send(JSON.stringify({ type: 'error', message: 'World not found' })); ws.close(); return; }

  const player = { id: playerId, pos: { x: 0, y: 1, z: 0 }, rot: 0, name: `Guest_${playerId}` };
  world.players.set(ws, player);

  // Send existing players + world object states to new joiner
  ws.send(JSON.stringify({
    type: 'init',
    playerId,
    players: [...world.players.values()],
    objectStates: world.runner?.getObjectStates() || {},
  }));
  broadcastToWorld(world, { type: 'join', player }, ws);
  world.runner?.onPlayerJoin(player);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'move') {
      player.pos = msg.pos;
      player.rot = msg.rot;
      broadcastToWorld(world, { type: 'move', playerId, pos: msg.pos, rot: msg.rot }, ws);
    } else if (msg.type === 'chat') {
      const text = String(msg.text).slice(0, 256);
      const suppressed = world.runner?.onChat(player, text);
      if (!suppressed) {
        broadcastToWorld(world, { type: 'chat', playerId, name: player.name, text });
        ws.send(JSON.stringify({ type: 'chat', playerId, name: player.name, text }));
      }
    } else if (msg.type === 'setName') {
      player.name = String(msg.name).slice(0, 32).replace(/[<>]/g, '');
      broadcastToWorld(world, { type: 'rename', playerId, name: player.name });
    } else if (msg.type === 'touch') {
      world.runner?.onTouch(player, msg.objectId);
    } else if (msg.type === 'event') {
      broadcastToWorld(world, { type: 'event', playerId, name: msg.name, data: msg.data }, ws);
    }
  });

  ws.on('close', () => {
    world.players.delete(ws);
    broadcastToWorld(world, { type: 'leave', playerId });
    world.runner?.onPlayerLeave(player);
  });
});

server.listen(PORT, () => {
  console.log(`\n  LuaGen server running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Worlds:  http://localhost:${PORT}?world=demo\n`);
});
