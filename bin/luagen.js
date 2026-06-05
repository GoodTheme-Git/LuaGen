#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT     = path.join(__dirname, '..');
const PID_FILE = path.join(ROOT, '.luagen.pid');
const PKG      = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
const PORT     = process.env.PORT || 3000;

// ── ANSI colours (no deps) ───────────────────────────────────
const c = {
  red:    s => `\x1b[91m${s}\x1b[0m`,
  green:  s => `\x1b[92m${s}\x1b[0m`,
  yellow: s => `\x1b[93m${s}\x1b[0m`,
  cyan:   s => `\x1b[96m${s}\x1b[0m`,
  pink:   s => `\x1b[95m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

const LOGO = `
  ${c.pink(c.bold('LuaGen'))} ${c.dim('v' + PKG.version + ' — Decentralized 3D WebWorlds')}
`;

// ── HTTP helper ──────────────────────────────────────────────
function api(endpoint) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${endpoint}`, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function formatUptime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

// ── Commands ─────────────────────────────────────────────────
const commands = {

  help() {
    console.log(LOGO);
    const row = (cmd, desc) => console.log(`  ${c.cyan(cmd.padEnd(28))} ${c.dim(desc)}`);
    console.log(c.bold('Usage:') + '  luagen <command> [options]\n');
    row('all',                 'Show everything: status, worlds, players');
    row('builder [world]',     'Open the world builder in the browser');
    row('start',               'Start the server (foreground)');
    row('start --daemon',      'Start the server in the background');
    row('stop',                'Stop the background server');
    row('status',              'Show server status and worlds');
    row('players',             'List connected players');
    row('worlds',              'List available worlds');
    row('new <name>',          'Scaffold a new world');
    row('convert <file>',      'Convert a GLTF/GLB file to a world');
    row('version',             'Show version');
    row('help',                'Show this message');
    console.log();
    console.log(`  ${c.dim('Port defaults to 3000. Override with PORT=XXXX luagen start')}`);
    console.log();
  },

  version() {
    console.log(`luagen ${c.cyan(PKG.version)}`);
  },

  start() {
    const daemon = process.argv.includes('--daemon');

    if (daemon) {
      if (fs.existsSync(PID_FILE)) {
        const old = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
        try { process.kill(old, 0); console.log(c.yellow(`Server already running (PID ${old})`)); return; } catch {}
      }
      const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
        cwd: ROOT,
      });
      child.unref();
      fs.writeFileSync(PID_FILE, String(child.pid));
      console.log(`${c.green('✓')} Server started ${c.dim('(PID ' + child.pid + ')')}`);
      console.log(`  ${c.cyan('http://localhost:' + PORT + '?world=demo')}`);
      console.log(`  ${c.dim('luagen stop')} to shut down  ·  ${c.dim('luagen status')} to inspect`);
    } else {
      // Foreground — just hand off to the server
      process.chdir(ROOT);
      require(path.join(ROOT, 'server/index.js'));
    }
  },

  stop() {
    if (!fs.existsSync(PID_FILE)) {
      console.log(c.yellow('No background server found. (no .luagen.pid)'));
      console.log(c.dim('If you started with  luagen start  (no --daemon) use Ctrl+C instead.'));
      return;
    }
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
    try {
      process.kill(pid, 'SIGTERM');
      fs.unlinkSync(PID_FILE);
      console.log(`${c.green('✓')} Server stopped ${c.dim('(PID ' + pid + ')')}`);
    } catch (e) {
      console.log(c.red('✗ Could not stop server: ' + e.message));
      fs.unlinkSync(PID_FILE);
    }
  },

  async status() {
    try {
      const data = await api('/api/status');
      console.log(LOGO);
      console.log(`  ${c.green('●')} Running on port ${c.cyan(data.port)}  ·  uptime ${c.yellow(formatUptime(data.uptime))}  ·  ${c.cyan(data.totalPlayers)} player(s)\n`);
      if (data.worlds.length === 0) {
        console.log(`  ${c.dim('No worlds loaded yet — visit a URL to load one.')}`);
      } else {
        console.log(c.bold('  Loaded worlds:'));
        for (const w of data.worlds) {
          const dot = w.players > 0 ? c.green('●') : c.dim('○');
          console.log(`    ${dot} ${c.cyan(w.id.padEnd(16))} ${w.name}  ${c.dim('(' + w.players + ' players)')}`);
        }
      }
      console.log();
    } catch {
      console.log(`  ${c.red('●')} Server not running on port ${PORT}`);
      console.log(`  ${c.dim('luagen start  or  luagen start --daemon')}`);
    }
  },

  async players() {
    try {
      const data = await api('/api/status');
      if (data.totalPlayers === 0) {
        console.log(c.dim('No players connected.'));
        return;
      }
      for (const w of data.worlds) {
        if (w.players === 0) continue;
        console.log(`${c.cyan(w.id)} — ${w.name} ${c.dim('(' + w.players + ' players)')}`);
        for (const p of w.playerList) {
          console.log(`  ${c.dim('·')} ${p.name.padEnd(20)} ${c.dim(p.id)}`);
        }
      }
    } catch {
      console.log(c.red('✗') + ' Server not running on port ' + PORT);
    }
  },

  async worlds() {
    let list;
    let offline = false;
    try {
      list = await api('/api/worlds');
    } catch {
      offline = true;
      const dir = path.join(ROOT, 'worlds');
      list = fs.readdirSync(dir)
        .filter(d => fs.existsSync(path.join(dir, d, 'world.json')))
        .map(d => {
          const meta = JSON.parse(fs.readFileSync(path.join(dir, d, 'world.json')));
          return { id: d, name: meta.name, description: meta.description };
        });
    }
    console.log(c.bold('Worlds') + (offline ? c.dim(' (server offline — reading from disk)') : '') + '\n');
    for (const w of list) {
      console.log(`  ${c.cyan(w.id.padEnd(16))} ${w.name}`);
      if (w.description) console.log(`  ${' '.repeat(16)} ${c.dim(w.description)}`);
    }
    console.log();
    console.log(c.dim('  luagen new <name>  to create a world'));
    console.log(c.dim('  http://localhost:' + PORT + '?world=<id>  to visit one'));
    console.log();
  },

  new() {
    const name = process.argv[3];
    if (!name) {
      console.log(c.red('Usage: luagen new <world-name>'));
      process.exit(1);
    }
    const id  = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const dir = path.join(ROOT, 'worlds', id);
    if (fs.existsSync(dir)) {
      console.log(c.red(`✗ World "${id}" already exists at worlds/${id}/`));
      process.exit(1);
    }
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({
      name,
      description: 'A new WebWorld.',
      skyColor: '#1a1a2e',
      fogColor: '#1a1a2e',
      fogNear: 40,
      fogFar: 120,
      gravity: -20,
      spawnPoint: { x: 0, y: 1, z: 0 },
      objects: [
        { type: 'ground', size: [200, 200], color: '#222', gridColor: '#333' },
        { id: 'platform', type: 'box', pos: [0, 0, 0], size: [10, 0.5, 10], color: '#0f3460', collidable: true },
        { id: 'welcome', type: 'box', pos: [0, 2, -3], size: [6, 1.5, 0.2], color: '#533483', collidable: false, label: name },
      ],
      lights: [
        { type: 'ambient',     color: '#ffffff', intensity: 0.4 },
        { type: 'directional', color: '#ffffff', intensity: 0.8, pos: [50, 100, 50] },
      ],
    }, null, 2));

    fs.writeFileSync(path.join(dir, 'main.lua'), `-- ${name}\n\nfunction onPlayerJoin(player)\n  World.chat("[World] Welcome, " .. player.name .. "!")\nend\n\nfunction onTick(dt)\n  -- world logic here\nend\n`);

    console.log(`${c.green('✓')} World created: ${c.cyan(id)}\n`);
    console.log(`  ${c.dim('Edit world:')}   worlds/${id}/world.json`);
    console.log(`  ${c.dim('Edit script:')}  worlds/${id}/main.lua`);
    console.log(`  ${c.dim('Visit:')}        ${c.cyan('http://localhost:' + PORT + '?world=' + id)}`);
    console.log();
    console.log(c.dim('  Restart the server to load the new world.'));
    console.log();
  },

  async all() {
    console.log(LOGO);
    try {
      const [status, worlds] = await Promise.all([api('/api/status'), api('/api/worlds')]);
      const worldMap = Object.fromEntries(worlds.map(w => [w.id, w]));

      // Server line
      console.log(`  ${c.green('●')} Running on port ${c.cyan(status.port)}  ·  uptime ${c.yellow(formatUptime(status.uptime))}  ·  ${c.cyan(status.totalPlayers)} player(s)\n`);

      // Worlds + inline players
      console.log(c.bold('  Worlds:'));
      const loaded = new Set(status.worlds.map(w => w.id));
      for (const w of worlds) {
        const live = status.worlds.find(lw => lw.id === w.id);
        const dot  = live?.players > 0 ? c.green('●') : loaded.has(w.id) ? c.dim('○') : c.dim('·');
        const pStr = live?.players > 0 ? c.cyan(` ${live.players} player(s)`) : '';
        console.log(`    ${dot} ${c.cyan(w.id.padEnd(16))} ${w.name}${pStr}`);
        if (live?.players > 0) {
          for (const p of live.playerList) {
            console.log(`         ${c.dim('└')} ${p.name} ${c.dim(p.id)}`);
          }
        }
      }
      console.log();
    } catch {
      // Server offline — show worlds from disk only
      console.log(`  ${c.red('●')} Server not running on port ${PORT}\n`);
      const dir = path.join(ROOT, 'worlds');
      const list = fs.readdirSync(dir)
        .filter(d => fs.existsSync(path.join(dir, d, 'world.json')))
        .map(d => JSON.parse(fs.readFileSync(path.join(dir, d, 'world.json'))) && { id: d, ...JSON.parse(fs.readFileSync(path.join(dir, d, 'world.json'))) });
      console.log(c.bold('  Worlds') + c.dim(' (offline):'));
      for (const w of list) {
        console.log(`    ${c.dim('·')} ${c.cyan(w.id.padEnd(16))} ${w.name}`);
      }
      console.log();
      console.log(`  ${c.dim('luagen start  to bring the server up')}`);
      console.log();
    }
  },

  builder() {
    const world = process.argv[3] || 'demo';
    const url = `http://localhost:${PORT}/builder?world=${world}`;
    console.log(`${c.green('→')} Opening builder: ${c.cyan(url)}`);
    const open = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const { spawn } = require('child_process');
    spawn(open, [url], { stdio: 'ignore', detached: true }).unref();
  },

  convert() {
    const file = process.argv[3];
    if (!file) {
      console.log(c.red('Usage: luagen convert <file.gltf|file.glb> [output-dir]'));
      process.exit(1);
    }
    // Forward remaining argv then run converter
    process.argv[2] = file;
    process.argv[3] = process.argv[4];
    require(path.join(ROOT, 'tools/convert/gltf-to-world.js'));
  },
};

// ── Entry point ──────────────────────────────────────────────
const cmd = process.argv[2] || 'help';
const fn  = commands[cmd];
if (!fn) {
  console.log(`${c.red('✗')} Unknown command: ${c.bold(cmd)}`);
  console.log(`  Run ${c.cyan('luagen help')} to see available commands.`);
  process.exit(1);
}
Promise.resolve(fn()).catch(e => {
  console.error(c.red('Error: ' + e.message));
  process.exit(1);
});
