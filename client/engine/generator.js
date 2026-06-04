import * as THREE from '/node_modules/three/build/three.module.js';

// Seeded hash → float [0,1)
function hash(seed, x, z, salt = 0) {
  let h = (seed * 2654435761) ^ (x * 374761393) ^ (z * 668265263) ^ (salt * 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 0x100000000;
}

// Levels: aesthetics change as player moves away from origin
const LEVELS = [
  { name: 'Level 0', wallColor: '#c8b460', floorColor: '#7a6a45', ceilColor: '#d4c88a', lightColor: '#fff5cc', lightIntensity: 1.2, fogColor: '#b0a050', fogNear: 20, fogFar: 60 },
  { name: 'Level 1', wallColor: '#888888', floorColor: '#444444', ceilColor: '#aaaaaa', lightColor: '#88aaff', lightIntensity: 0.8, fogColor: '#334455', fogNear: 16, fogFar: 48 },
  { name: 'Level 2', wallColor: '#553322', floorColor: '#221111', ceilColor: '#442211', lightColor: '#ff4400', lightIntensity: 0.5, fogColor: '#220800', fogNear: 10, fogFar: 35 },
  { name: 'Level !', wallColor: '#112211', floorColor: '#0a0a08', ceilColor: '#0d1a0d', lightColor: '#00ff88', lightIntensity: 0.4, fogColor: '#010801', fogNear: 8, fogFar: 25 },
];

export class ProceduralGenerator {
  constructor(engine, seed, onLevelChange) {
    this.engine = engine;
    this.scene = engine.scene;
    this.collidables = engine.generatedCollidables;
    this.seed = seed ?? Math.floor(Math.random() * 0xfffffff);
    this.onLevelChange = onLevelChange || (() => {});

    this.ROOM = 12;      // room size in world units
    this.HEIGHT = 3.0;   // ceiling height
    this.WALL = 0.25;    // wall thickness
    this.DOOR_W = 3.0;   // doorway width
    this.DOOR_H = 2.4;   // doorway height
    this.LOAD_R = 4;     // chunk load radius
    this.UNLOAD_R = 6;

    this.chunks = new Map();  // "cx,cz" → { meshes, cols, lights }
    this._flickerT = 0;
    this._currentLevel = -1;
    this._mats = new Map();   // color → material (reuse)
  }

  _mat(color, emissive = false, emissiveIntensity = 0.8) {
    const key = color + (emissive ? '_e' : '');
    if (!this._mats.has(key)) {
      const m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        ...(emissive ? { emissive: color, emissiveIntensity } : {}),
      });
      this._mats.set(key, m);
    }
    return this._mats.get(key);
  }

  _box(cx, cy, cz, sx, sy, sz, color, emissive = false) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, this._mat(color, emissive));
    mesh.position.set(cx, cy, cz);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  _aabb(cx, cy, cz, sx, sy, sz) {
    return {
      min: new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      max: new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    };
  }

  // Deterministic: passage between two adjacent rooms
  _passage(ax, az, bx, bz) {
    const mx = Math.min(ax, bx), mz = Math.min(az, bz);
    const salt = ax === bx ? 11 : 22;
    // ~72% open — feels labyrinthine but not a dead-end nightmare
    return hash(this.seed, mx, mz, salt) > 0.28;
  }

  _level(cx, cz) {
    const dist = Math.sqrt(cx * cx + cz * cz);
    if (dist < 8)  return 0;
    if (dist < 20) return 1;
    if (dist < 40) return 2;
    return 3;
  }

  update(playerPos) {
    const S = this.ROOM;
    const cx = Math.floor(playerPos.x / S);
    const cz = Math.floor(playerPos.z / S);

    // Level transition
    const lvl = this._level(cx, cz);
    if (lvl !== this._currentLevel) {
      this._currentLevel = lvl;
      const L = LEVELS[lvl];
      this.scene.fog = new THREE.Fog(L.fogColor, L.fogNear, L.fogFar);
      this.scene.background = new THREE.Color(L.fogColor);
      this.onLevelChange(L.name);
    }

    // Load nearby
    for (let dx = -this.LOAD_R; dx <= this.LOAD_R; dx++) {
      for (let dz = -this.LOAD_R; dz <= this.LOAD_R; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        if (!this.chunks.has(key)) this._genChunk(cx + dx, cz + dz);
      }
    }

    // Unload far
    for (const [key, chunk] of this.chunks) {
      const [ccx, ccz] = key.split(',').map(Number);
      if (Math.abs(ccx - cx) > this.UNLOAD_R || Math.abs(ccz - cz) > this.UNLOAD_R) {
        this._unloadChunk(key, chunk);
      }
    }

    // Flicker lights
    this._flickerT += 0.016;
    if (Math.floor(this._flickerT * 4) % 60 === 0) {
      const keys = [...this.chunks.keys()];
      const randKey = keys[Math.floor(Math.random() * keys.length)];
      if (randKey) {
        const chunk = this.chunks.get(randKey);
        if (chunk?.flickerLight) {
          const orig = chunk.flickerLight._baseIntensity;
          chunk.flickerLight.intensity = Math.random() < 0.15 ? 0 : orig;
        }
      }
    }
  }

  _genChunk(cx, cz) {
    const S = this.ROOM;
    const H = this.HEIGHT;
    const W = this.WALL;
    const DW = this.DOOR_W;
    const DH = this.DOOR_H;
    const x0 = cx * S + S / 2;  // room center x
    const z0 = cz * S + S / 2;  // room center z
    const xL = cx * S;           // room left edge
    const zT = cz * S;           // room top edge

    const L = LEVELS[this._level(cx, cz)];
    const meshes = [], cols = [], lights = [];

    // Floor
    meshes.push(this._box(x0, 0, z0, S, W, S, L.floorColor));
    cols.push(this._aabb(x0, 0, z0, S, W, S));

    // Ceiling
    meshes.push(this._box(x0, H, z0, S, W, S, L.ceilColor));
    cols.push(this._aabb(x0, H, z0, S, W, S));

    // Fluorescent tube(s)
    const tubeCount = hash(this.seed, cx, cz, 5) > 0.3 ? 2 : 1;
    for (let i = 0; i < tubeCount; i++) {
      const tx = x0 + (i === 0 ? -S / 5 : S / 5);
      const tz = z0 + (hash(this.seed, cx, cz, 80 + i) - 0.5) * S * 0.4;
      meshes.push(this._box(tx, H - W / 2 - 0.02, tz, 0.15, 0.06, S * 0.55, L.lightColor, true));
      const pl = new THREE.PointLight(L.lightColor, L.lightIntensity, S * 2.2);
      pl.position.set(tx, H - 0.3, tz);
      pl._baseIntensity = L.lightIntensity;
      this.scene.add(pl);
      lights.push(pl);
      if (i === 0) { // one light per chunk can flicker
        const chunk_ref = { flickerLight: pl };
        this._pendingFlicker = chunk_ref;
      }
    }

    // Walls — four sides, with optional doorways
    const N = this._passage(cx, cz, cx, cz - 1);
    const S_ = this._passage(cx, cz, cx, cz + 1);
    const Ww = this._passage(cx, cz, cx - 1, cz);
    const E = this._passage(cx, cz, cx + 1, cz);

    this._wall(meshes, cols, xL + S / 2, zT,     'Z', N,  S, H, W, DW, DH, L.wallColor, cx, cz, 0);
    this._wall(meshes, cols, xL + S / 2, zT + S, 'Z', S_, S, H, W, DW, DH, L.wallColor, cx, cz, 1);
    this._wall(meshes, cols, xL,         zT + S / 2, 'X', Ww, S, H, W, DW, DH, L.wallColor, cx, cz, 2);
    this._wall(meshes, cols, xL + S,     zT + S / 2, 'X', E,  S, H, W, DW, DH, L.wallColor, cx, cz, 3);

    // Occasional pillar
    if (hash(this.seed, cx, cz, 999) > 0.75) {
      const px = xL + 2 + hash(this.seed, cx, cz, 400) * (S - 4);
      const pz = zT + 2 + hash(this.seed, cx, cz, 500) * (S - 4);
      const pw = 0.5;
      meshes.push(this._box(px, H / 2, pz, pw, H, pw, L.wallColor));
      cols.push(this._aabb(px, H / 2, pz, pw, H, pw));
    }

    // Water stain / damage patch
    if (hash(this.seed, cx, cz, 17) > 0.6) {
      const stainX = xL + 1 + hash(this.seed, cx, cz, 300) * (S - 2);
      const stainZ = zT + 1 + hash(this.seed, cx, cz, 301) * (S - 2);
      const sw = 1 + hash(this.seed, cx, cz, 302) * 2;
      const stainColor = this._darken(L.floorColor);
      meshes.push(this._box(stainX, W / 2 + 0.01, stainZ, sw, 0.01, sw, stainColor));
    }

    const chunk = { meshes, cols, lights, flickerLight: lights[0] || null };
    if (this._pendingFlicker) { chunk.flickerLight = this._pendingFlicker.flickerLight; this._pendingFlicker = null; }
    this.chunks.set(`${cx},${cz}`, chunk);
    this.collidables.push(...cols);
  }

  _wall(meshes, cols, cx, cz, axis, open, S, H, W, DW, DH, color, roomX, roomZ, side) {
    const sideW = (S - DW) / 2;
    const topH = H - DH;

    if (!open) {
      if (axis === 'Z') {
        meshes.push(this._box(cx, H / 2, cz, S, H, W, color));
        cols.push(this._aabb(cx, H / 2, cz, S, H, W));
      } else {
        meshes.push(this._box(cx, H / 2, cz, W, H, S, color));
        cols.push(this._aabb(cx, H / 2, cz, W, H, S));
      }
      return;
    }

    // Doorway: two side pillars + lintel above door
    if (axis === 'Z') {
      if (sideW > 0) {
        meshes.push(this._box(cx - S / 2 + sideW / 2, H / 2, cz, sideW, H, W, color));
        cols.push(this._aabb(cx - S / 2 + sideW / 2, H / 2, cz, sideW, H, W));
        meshes.push(this._box(cx + S / 2 - sideW / 2, H / 2, cz, sideW, H, W, color));
        cols.push(this._aabb(cx + S / 2 - sideW / 2, H / 2, cz, sideW, H, W));
      }
      if (topH > 0) {
        meshes.push(this._box(cx, DH + topH / 2, cz, DW, topH, W, color));
        cols.push(this._aabb(cx, DH + topH / 2, cz, DW, topH, W));
      }
    } else {
      if (sideW > 0) {
        meshes.push(this._box(cx, H / 2, cz - S / 2 + sideW / 2, W, H, sideW, color));
        cols.push(this._aabb(cx, H / 2, cz - S / 2 + sideW / 2, W, H, sideW));
        meshes.push(this._box(cx, H / 2, cz + S / 2 - sideW / 2, W, H, sideW, color));
        cols.push(this._aabb(cx, H / 2, cz + S / 2 - sideW / 2, W, H, sideW));
      }
      if (topH > 0) {
        meshes.push(this._box(cx, DH + topH / 2, cz, W, topH, DW, color));
        cols.push(this._aabb(cx, DH + topH / 2, cz, W, topH, DW));
      }
    }
  }

  _darken(hex) {
    const c = parseInt(hex.slice(1), 16);
    const r = Math.max(0, ((c >> 16) & 0xff) - 40);
    const g = Math.max(0, ((c >> 8) & 0xff) - 40);
    const b = Math.max(0, (c & 0xff) - 40);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  _unloadChunk(key, chunk) {
    for (const m of chunk.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    for (const l of chunk.lights) this.scene.remove(l);
    // Remove cols from generatedCollidables
    for (const col of chunk.cols) {
      const idx = this.collidables.indexOf(col);
      if (idx !== -1) this.collidables.splice(idx, 1);
    }
    this.chunks.delete(key);
  }

  dispose() {
    for (const [key, chunk] of this.chunks) this._unloadChunk(key, chunk);
    for (const m of this._mats.values()) m.dispose();
  }
}
