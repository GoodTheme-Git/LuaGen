import * as THREE from '/node_modules/three/build/three.module.js';
import { WorldUIPanel } from './worldui.js';

export class WorldEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.objects = new Map(); // id -> mesh
    this.panels  = new Map(); // id -> WorldUIPanel
    this.collidables = [];
    this.labels = [];
    this._initRenderer();
    this._initScene();
    this._initPhysics();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 500);
    this.camera.position.set(0, 3, 8);
  }

  _initPhysics() {
    this.gravity = -20;
    this.playerVel = new THREE.Vector3();
    this.playerPos = new THREE.Vector3(0, 2, 0);
    this.onGround = false;
    this.playerHeight = 1.7;
    this.playerRadius = 0.4;
    this.generatedCollidables = []; // populated by ProceduralGenerator
  }

  _resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  loadWorld(data) {
    this.scene.clear();
    this.objects.clear();
    this.panels.forEach(p => p.dispose());
    this.panels.clear();
    this.collidables = [];
    this.labels = [];
    this.portals = []; // { zone: {min,max}, target, label }

    // Sky / fog
    const skyColor = new THREE.Color(data.skyColor || '#1a1a2e');
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(data.fogColor || '#1a1a2e', data.fogNear || 40, data.fogFar || 120);

    this.gravity = data.gravity || -20;

    const spawn = data.spawnPoint || { x: 0, y: 1, z: 0 };
    this.playerPos.set(spawn.x, spawn.y + 1, spawn.z);
    this.playerVel.set(0, 0, 0);

    // Lights
    for (const l of (data.lights || [])) {
      if (l.type === 'ambient') {
        this.scene.add(new THREE.AmbientLight(l.color, l.intensity));
      } else if (l.type === 'directional') {
        const dl = new THREE.DirectionalLight(l.color, l.intensity);
        dl.position.set(l.pos[0], l.pos[1], l.pos[2]);
        dl.castShadow = true;
        dl.shadow.mapSize.set(2048, 2048);
        dl.shadow.camera.near = 1;
        dl.shadow.camera.far = 300;
        dl.shadow.camera.left = -80;
        dl.shadow.camera.right = 80;
        dl.shadow.camera.top = 80;
        dl.shadow.camera.bottom = -80;
        this.scene.add(dl);
      } else if (l.type === 'point') {
        const pl = new THREE.PointLight(l.color, l.intensity, l.distance || 30);
        pl.position.set(l.pos[0], l.pos[1], l.pos[2]);
        this.scene.add(pl);
      }
    }

    // Objects
    for (const obj of (data.objects || [])) {
      this._spawnObject(obj);
    }
  }

  _spawnObject(obj) {
    let mesh;

    if (obj.type === 'ground') {
      const geo = new THREE.PlaneGeometry(obj.size[0], obj.size[1], 40, 40);
      const mat = new THREE.MeshStandardMaterial({ color: obj.color || '#222', roughness: 0.9 });
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;

      // Grid overlay
      const grid = new THREE.GridHelper(obj.size[0], 40, obj.gridColor || '#333', obj.gridColor || '#333');
      grid.position.y = 0.01;
      this.scene.add(grid);

      // Ground is always a collidable flat plane at y=0
      this.groundY = 0;
    } else if (obj.type === 'box') {
      const [sx, sy, sz] = obj.size;
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const params = { color: obj.color || '#888', roughness: 0.7 };
      if (obj.emissive) { params.emissive = obj.emissive; params.emissiveIntensity = obj.emissiveIntensity || 0.3; }
      const mat = new THREE.MeshStandardMaterial(params);
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...obj.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (obj.collidable) {
        this.collidables.push({
          mesh,
          min: new THREE.Vector3(obj.pos[0] - sx / 2, obj.pos[1] - sy / 2, obj.pos[2] - sz / 2),
          max: new THREE.Vector3(obj.pos[0] + sx / 2, obj.pos[1] + sy / 2, obj.pos[2] + sz / 2),
        });
      }

      if (obj.label) {
        this._addLabel(obj.label, new THREE.Vector3(obj.pos[0], obj.pos[1] + obj.size[1] / 2 + 0.3, obj.pos[2]));
      }
    } else if (obj.type === 'portal') {
      const [px, py, pz] = obj.pos;
      const w = obj.size?.[0] ?? 4;
      const h = obj.size?.[1] ?? 5;
      const thick = 0.3;
      const color = obj.color || '#00ffcc';
      const emissive = color;

      const frameMat = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.6, roughness: 0.3 });

      // Frame: left post, right post, top beam
      const parts = [
        new THREE.BoxGeometry(thick, h, thick),   // left
        new THREE.BoxGeometry(thick, h, thick),   // right
        new THREE.BoxGeometry(w + thick, thick, thick), // top
      ];
      const offsets = [[-w / 2, h / 2, 0], [w / 2, h / 2, 0], [0, h, 0]];
      for (let i = 0; i < parts.length; i++) {
        const m = new THREE.Mesh(parts[i], frameMat);
        m.position.set(px + offsets[i][0], py + offsets[i][1], pz + offsets[i][2]);
        m.castShadow = true;
        this.scene.add(m);
      }

      // Inner shimmer plane
      const innerGeo = new THREE.PlaneGeometry(w - thick, h - thick);
      const innerMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
      });
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.position.set(px, py + h / 2, pz);
      this.scene.add(inner);
      if (obj.id) this.objects.set(obj.id + '_inner', inner);

      // Point light inside portal
      const pl = new THREE.PointLight(color, 1.5, 10);
      pl.position.set(px, py + h / 2, pz);
      this.scene.add(pl);

      // Label
      const labelText = obj.label || (obj.targetWorld ? '→ ' + obj.targetWorld : '→ Portal');
      this._addLabel(labelText, new THREE.Vector3(px, py + h + 0.4, pz));

      // Proximity radius — trigger when player centre is within this distance
      const radius = (w / 2) + 2.0;
      this.portals.push({
        pos: new THREE.Vector3(px, py + h / 2, pz),
        radius,
        target: obj.target || null,
        targetWorld: obj.targetWorld || null,
        label: obj.label || null,
        id: obj.id,
        _inner: innerMat,
        _light: pl,
      });
    } else if (obj.type === 'sphere') {
      const geo = new THREE.SphereGeometry(obj.radius || 1, 32, 32);
      const params = { color: obj.color || '#888', roughness: 0.4, metalness: 0.2 };
      if (obj.emissive) { params.emissive = obj.emissive; params.emissiveIntensity = obj.emissiveIntensity || 0.3; }
      const mat = new THREE.MeshStandardMaterial(params);
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...obj.pos);
      mesh.castShadow = true;
    }

    if (obj.type === 'panel') {
      const panel = new WorldUIPanel(obj);
      this.scene.add(panel.mesh);
      if (obj.id) {
        this.panels.set(obj.id, panel);
        this.objects.set(obj.id, panel.mesh);
      }
      return;
    }

    if (mesh) {
      this.scene.add(mesh);
      if (obj.id) this.objects.set(obj.id, mesh);
    }
  }

  // Update a panel's text item from a Lua event
  setPanelText(panelId, itemIndex, text) {
    this.panels.get(panelId)?.setText(itemIndex, text);
  }

  _addLabel(text, pos) {
    // Canvas-based text sprite
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.roundRect(0, 0, 512, 64, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.scale.set(6, 0.75, 1);
    this.scene.add(sprite);
    this.labels.push(sprite);
  }

  // Called from Lua via bridge
  setObjectPos(id, x, y, z) {
    const mesh = this.objects.get(id);
    if (mesh) mesh.position.set(x, y, z);
  }

  setObjectRotation(id, x, y, z) {
    const mesh = this.objects.get(id);
    if (mesh) {
      mesh.rotation.x = THREE.MathUtils.degToRad(x);
      mesh.rotation.y = THREE.MathUtils.degToRad(y);
      mesh.rotation.z = THREE.MathUtils.degToRad(z);
    }
  }

  setObjectColor(id, hex) {
    const mesh = this.objects.get(id);
    if (mesh) mesh.material.color.set(hex);
  }

  // Tick physics + render
  tick(dt, input, yaw) {
    this._t = (this._t || 0) + dt;
    this._updatePlayer(dt, input, yaw);
    this._updateCamera(yaw);
    this._animatePortals(this._t);
    if (this.generator) this.generator.update(this.playerPos);
    this.renderer.render(this.scene, this.camera);

    const portal = this._checkPortals();
    return { pos: this.playerPos.clone(), onGround: this.onGround, portal };
  }

  _animatePortals(t) {
    for (const p of this.portals) {
      p._inner.opacity = 0.15 + Math.abs(Math.sin(t * 1.8)) * 0.25;
      p._light.intensity = 1.0 + Math.sin(t * 2.3) * 0.5;
    }
  }

  _checkPortals() {
    const pos = this.playerPos;
    for (const p of this.portals) {
      const dx = pos.x - p.pos.x;
      const dz = pos.z - p.pos.z;
      if (Math.sqrt(dx * dx + dz * dz) < p.radius) return p;
    }
    return null;
  }

  _updatePlayer(dt, input, yaw) {
    const speed = input.sprint ? 12 : 6;
    const dir = new THREE.Vector3();

    if (input.forward) dir.z -= 1;
    if (input.backward) dir.z += 1;
    if (input.left) dir.x -= 1;
    if (input.right) dir.x += 1;

    if (dir.lengthSq() > 0) {
      dir.normalize();
      dir.applyEuler(new THREE.Euler(0, yaw, 0));
      this.playerVel.x = dir.x * speed;
      this.playerVel.z = dir.z * speed;
    } else {
      this.playerVel.x *= 0.8;
      this.playerVel.z *= 0.8;
    }

    if (input.jump && this.onGround) {
      this.playerVel.y = 10;
      this.onGround = false;
    }

    this.playerVel.y += this.gravity * dt;

    const next = this.playerPos.clone().addScaledVector(this.playerVel, dt);
    this.onGround = false;

    // Ground check
    if (next.y - this.playerHeight < (this.groundY || 0)) {
      next.y = (this.groundY || 0) + this.playerHeight;
      this.playerVel.y = 0;
      this.onGround = true;
    }

    // Box collisions (simplified: push out on Y axis for standing)
    for (const col of this.collidables) {
      const top = col.max.y;
      const footY = next.y - this.playerHeight;

      const inX = next.x > col.min.x - this.playerRadius && next.x < col.max.x + this.playerRadius;
      const inZ = next.z > col.min.z - this.playerRadius && next.z < col.max.z + this.playerRadius;
      const wasAbove = this.playerPos.y - this.playerHeight >= top - 0.05;
      const nowBelow = footY < top;

      if (inX && inZ && wasAbove && nowBelow && this.playerVel.y <= 0) {
        next.y = top + this.playerHeight;
        this.playerVel.y = 0;
        this.onGround = true;
      }
    }

    // XZ wall collision (all collidable boxes)
    const allCols = [...this.collidables, ...this.generatedCollidables];
    for (const col of allCols) {
      this._resolveAABB(next, col);
    }

    this.playerPos.copy(next);
  }

  _resolveAABB(pos, col) {
    const pr = this.playerRadius;
    const ph = this.playerHeight;

    const pMinX = pos.x - pr, pMaxX = pos.x + pr;
    const pMinY = pos.y - ph, pMaxY = pos.y + 0.2;
    const pMinZ = pos.z - pr, pMaxZ = pos.z + pr;

    const overlapX = Math.min(pMaxX, col.max.x) - Math.max(pMinX, col.min.x);
    const overlapY = Math.min(pMaxY, col.max.y) - Math.max(pMinY, col.min.y);
    const overlapZ = Math.min(pMaxZ, col.max.z) - Math.max(pMinZ, col.min.z);

    if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return;

    const fromAbove = this.playerPos.y - ph >= col.max.y - 0.12;
    if (fromAbove && overlapY <= overlapX && overlapY <= overlapZ) {
      pos.y = col.max.y + ph;
      this.playerVel.y = 0;
      this.onGround = true;
    } else if (overlapX < overlapZ) {
      pos.x += pos.x > (col.min.x + col.max.x) / 2 ? overlapX : -overlapX;
      this.playerVel.x = 0;
    } else {
      pos.z += pos.z > (col.min.z + col.max.z) / 2 ? overlapZ : -overlapZ;
      this.playerVel.z = 0;
    }
  }

  _updateCamera(yaw) {
    const pitch = -0.15;
    const offset = new THREE.Vector3(0, 0.6, 0);
    this.camera.position.copy(this.playerPos).add(offset);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
  }

  addRemotePlayer(id, pos, rot) {
    const geo = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color: '#' + (id.charCodeAt(0) * 0x112233 & 0xffffff).toString(16).padStart(6, '0') });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    this.scene.add(mesh);
    this.objects.set('_player_' + id, mesh);
  }

  updateRemotePlayer(id, pos, rot) {
    const mesh = this.objects.get('_player_' + id);
    if (mesh) {
      mesh.position.set(pos.x, pos.y - 0.85, pos.z);
      mesh.rotation.y = rot;
    }
  }

  removeRemotePlayer(id) {
    const mesh = this.objects.get('_player_' + id);
    if (mesh) { this.scene.remove(mesh); this.objects.delete('_player_' + id); }
  }

  impulse(x, y, z) {
    this.playerVel.x += x;
    this.playerVel.y += y;
    this.playerVel.z += z;
  }
}
