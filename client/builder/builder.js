import * as THREE from '/node_modules/three/build/three.module.js';

// ── State ──────────────────────────────────────────────────────
let worldId   = new URLSearchParams(location.search).get('world') || 'demo';
let worldData = null;
let selected  = null;   // object data (from worldData.objects)
let dirty     = false;

// THREE objects
let scene, camera, renderer, raycaster;
let meshMap   = new Map();  // objectId -> { mesh, helper }
let allMeshes = [];         // for raycasting
let boxHelper = null;

// Camera fly state
const keys = {};
let camYaw = Math.PI, camPitch = 0;
let rightDrag = false, lastMX = 0, lastMY = 0;

// ── Boot ───────────────────────────────────────────────────────
const canvas   = document.getElementById('builder-canvas');
const objList  = document.getElementById('object-list');
const propsDiv = document.getElementById('props-content');
const saveStatus = document.getElementById('save-status');
const selInfo  = document.getElementById('selection-info');

initThree();
populateWorldSelector();
loadWorld(worldId);
bindToolbar();
bindWorldSettings();
loop();

// ── Three.js init ──────────────────────────────────────────────
function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d0d1a');

  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
  camera.position.set(0, 8, 20);

  raycaster = new THREE.Raycaster();

  window.addEventListener('resize', resize);
  resize();

  // Camera controls
  window.addEventListener('keydown', e => { keys[e.code] = true; });
  window.addEventListener('keyup',   e => { keys[e.code] = false; });

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (e.button === 2) { rightDrag = true; lastMX = e.clientX; lastMY = e.clientY; }
    if (e.button === 0) pickObject(e);
  });
  window.addEventListener('mouseup', e => { if (e.button === 2) rightDrag = false; });
  window.addEventListener('mousemove', e => {
    if (!rightDrag) return;
    camYaw   -= (e.clientX - lastMX) * 0.004;
    camPitch -= (e.clientY - lastMY) * 0.004;
    camPitch  = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, camPitch));
    lastMX = e.clientX; lastMY = e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    camera.position.addScaledVector(dir, -e.deltaY * 0.05);
    e.preventDefault();
  }, { passive: false });
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ── Render loop ────────────────────────────────────────────────
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Fly camera
  const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? 20 : 8;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();

  if (keys['KeyW']) camera.position.addScaledVector(dir, speed * dt);
  if (keys['KeyS']) camera.position.addScaledVector(dir, -speed * dt);
  if (keys['KeyA']) camera.position.addScaledVector(right, -speed * dt);
  if (keys['KeyD']) camera.position.addScaledVector(right, speed * dt);
  if (keys['KeyQ'] || keys['KeyE']) camera.position.y += (keys['KeyE'] ? 1 : -1) * speed * dt;

  camera.rotation.order = 'YXZ';
  camera.rotation.y = camYaw;
  camera.rotation.x = camPitch;

  renderer.render(scene, camera);
}

// ── World loading ──────────────────────────────────────────────
async function populateWorldSelector() {
  const sel = document.getElementById('world-selector');
  const worlds = await fetch('/api/worlds').then(r => r.json()).catch(() => []);
  sel.innerHTML = worlds.map(w => `<option value="${w.id}" ${w.id === worldId ? 'selected' : ''}>${w.id}</option>`).join('');
  sel.addEventListener('change', () => { worldId = sel.value; loadWorld(worldId); });
}

async function loadWorld(id) {
  worldData = await fetch(`/api/world/${id}`).then(r => r.json());
  worldId = id;
  dirty = false;
  setSaveStatus('saved');
  rebuildScene();
  rebuildObjectList();
  syncWorldSettings();
  select(null);
  document.title = `Builder — ${worldData.name || id}`;
}

function rebuildScene() {
  // Clear
  while (scene.children.length) scene.remove(scene.children[0]);
  meshMap.clear();
  allMeshes = [];
  boxHelper = null;

  scene.background = new THREE.Color(worldData.skyColor || '#0d0d1a');
  scene.fog = new THREE.Fog(worldData.fogColor || '#0d0d1a', worldData.fogNear || 40, worldData.fogFar || 120);

  // Lights
  scene.add(new THREE.AmbientLight('#ffffff', 0.4));
  const dl = new THREE.DirectionalLight('#ffffff', 0.8);
  dl.position.set(50, 100, 50);
  scene.add(dl);

  // Grid
  scene.add(new THREE.GridHelper(200, 40, '#1a1a3a', '#1a1a3a'));

  // Objects
  for (const obj of (worldData.objects || [])) spawnMesh(obj);
}

const TYPE_COLORS = {
  box: '#4488ff', sphere: '#ff8844', ground: '#44aa44',
  portal: '#00ffcc', panel: '#ffaa00',
};

function spawnMesh(obj) {
  let mesh;

  if (obj.type === 'ground') {
    const geo = new THREE.PlaneGeometry(obj.size?.[0] || 200, obj.size?.[1] || 200);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: obj.color || '#222', side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
  } else if (obj.type === 'box') {
    const [sx, sy, sz] = obj.size || [1, 1, 1];
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshStandardMaterial({ color: obj.color || '#888', roughness: 0.7 })
    );
    mesh.position.set(...(obj.pos || [0, 0, 0]));
  } else if (obj.type === 'sphere') {
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(obj.radius || 1, 24, 24),
      new THREE.MeshStandardMaterial({ color: obj.color || '#888' })
    );
    mesh.position.set(...(obj.pos || [0, 0, 0]));
  } else if (obj.type === 'portal') {
    const [px, py, pz] = obj.pos || [0, 0, 0];
    const w = obj.size?.[0] || 4, h = obj.size?.[1] || 5;
    const color = obj.color || '#00ffcc';
    const geo = new THREE.BoxGeometry(w, h, 0.2);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.35, emissive: color, emissiveIntensity: 0.3 }));
    mesh.position.set(px, py + h / 2, pz);
  } else if (obj.type === 'panel') {
    const [px, py, pz] = obj.pos || [0, 0, 0];
    const pw = obj.size?.[0] || 4, ph = obj.size?.[1] || 2;
    mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, ph),
      new THREE.MeshBasicMaterial({ color: obj.background || '#1a1a2e', side: THREE.DoubleSide })
    );
    mesh.position.set(px, py + ph / 2, pz);
  }

  if (mesh) {
    mesh.castShadow = true;
    scene.add(mesh);
    if (obj.id) {
      meshMap.set(obj.id, mesh);
      mesh.userData.objId = obj.id;
      allMeshes.push(mesh);
    }
  }
  return mesh;
}

// ── Selection ──────────────────────────────────────────────────
function pickObject(e) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(allMeshes);
  if (hits.length > 0) {
    const id = hits[0].object.userData.objId;
    const obj = worldData.objects.find(o => o.id === id);
    select(obj);
  } else {
    select(null);
  }
}

function select(obj) {
  selected = obj;

  // Remove old helper
  if (boxHelper) { scene.remove(boxHelper); boxHelper = null; }

  if (obj && meshMap.has(obj.id)) {
    boxHelper = new THREE.BoxHelper(meshMap.get(obj.id), 0xe94560);
    scene.add(boxHelper);
    selInfo.textContent = `Selected: ${obj.id} (${obj.type})`;
  } else {
    selInfo.textContent = '';
  }

  // Highlight list
  document.querySelectorAll('.obj-item').forEach(el => {
    el.classList.toggle('selected', obj && el.dataset.id === obj.id);
  });

  renderProps(obj);
}

// ── Properties panel ───────────────────────────────────────────
function renderProps(obj) {
  if (!obj) {
    propsDiv.innerHTML = '<div id="no-selection">Click an object<br>to edit its properties</div>';
    return;
  }

  const common = (label, key, type = 'text', extra = '') => `
    <div class="prop-row">
      <span class="prop-label">${label}</span>
      <input type="${type}" class="prop-input" data-key="${key}" value="${obj[key] ?? ''}" ${extra}>
    </div>`;

  const vec3 = (label, key) => {
    const v = obj[key] || [0, 0, 0];
    return `
    <div class="prop-group-label">${label}</div>
    <div class="prop-row">
      <span class="prop-label">X</span><input type="number" step="0.5" class="prop-input" data-key="${key}.0" value="${v[0]}">
      <span class="prop-label" style="width:16px;text-align:center">Y</span><input type="number" step="0.5" class="prop-input" data-key="${key}.1" value="${v[1]}">
      <span class="prop-label" style="width:16px;text-align:center">Z</span><input type="number" step="0.5" class="prop-input" data-key="${key}.2" value="${v[2]}">
    </div>`;
  };

  let html = `
    <div class="prop-group">
      <div class="prop-group-label">Identity</div>
      ${common('ID', 'id')}
      <div class="prop-row"><span class="prop-label">Type</span><span style="color:#555;font-size:12px">${obj.type}</span></div>
    </div>
    <div class="prop-group">
      ${vec3('Position', 'pos')}
    </div>`;

  if (obj.type === 'box') html += `
    <div class="prop-group">
      <div class="prop-group-label">Size (W H D)</div>
      <div class="prop-row">
        <input type="number" step="0.5" min="0.1" class="prop-input" data-key="size.0" value="${(obj.size||[1,1,1])[0]}">
        <input type="number" step="0.5" min="0.1" class="prop-input" data-key="size.1" value="${(obj.size||[1,1,1])[1]}">
        <input type="number" step="0.5" min="0.1" class="prop-input" data-key="size.2" value="${(obj.size||[1,1,1])[2]}">
      </div>
    </div>`;

  if (obj.type === 'sphere') html += `
    <div class="prop-group">
      <div class="prop-group-label">Radius</div>
      <div class="prop-row"><input type="number" step="0.1" min="0.1" class="prop-input" data-key="radius" value="${obj.radius ?? 1}"></div>
    </div>`;

  if (obj.type === 'portal') html += `
    <div class="prop-group">
      <div class="prop-group-label">Portal Size (W H)</div>
      <div class="prop-row">
        <input type="number" step="0.5" class="prop-input" data-key="size.0" value="${(obj.size||[4,5])[0]}">
        <input type="number" step="0.5" class="prop-input" data-key="size.1" value="${(obj.size||[4,5])[1]}">
      </div>
      <div class="prop-group-label" style="margin-top:6px">Target World</div>
      <div class="prop-row"><input type="text" class="prop-input" data-key="targetWorld" value="${obj.targetWorld||''}"></div>
      <div class="prop-group-label" style="margin-top:4px">Or full URL</div>
      <div class="prop-row"><input type="text" class="prop-input" data-key="target" value="${obj.target||''}"></div>
    </div>`;

  if (obj.type === 'panel') html += `
    <div class="prop-group">
      <div class="prop-group-label">Panel Size (W H)</div>
      <div class="prop-row">
        <input type="number" step="0.5" class="prop-input" data-key="size.0" value="${(obj.size||[4,2])[0]}">
        <input type="number" step="0.5" class="prop-input" data-key="size.1" value="${(obj.size||[4,2])[1]}">
      </div>
    </div>`;

  if (['box', 'sphere', 'portal', 'panel'].includes(obj.type)) html += `
    <div class="prop-group">
      <div class="prop-group-label">Appearance</div>
      <div class="prop-row">
        <span class="prop-label">Color</span>
        <input type="color" class="prop-input" data-key="color" value="${obj.color || '#888888'}">
      </div>`;

  if (obj.type === 'box') html += `
      <div class="prop-row">
        <span class="prop-label">Label</span>
        <input type="text" class="prop-input" data-key="label" value="${obj.label || ''}">
      </div>
      <div class="prop-row" style="gap:8px">
        <input type="checkbox" class="prop-checkbox" data-key="collidable" id="chk-col" ${obj.collidable ? 'checked' : ''}>
        <label for="chk-col" style="font-size:12px;cursor:pointer">Collidable</label>
      </div>`;

  html += `</div><button class="delete-btn" id="btn-delete">🗑 Delete Object</button>`;

  propsDiv.innerHTML = html;

  // Bind inputs
  propsDiv.querySelectorAll('input').forEach(input => {
    const ev = input.type === 'color' ? 'input' : 'change';
    input.addEventListener(ev, () => applyProp(input));
  });
  document.getElementById('btn-delete')?.addEventListener('click', deleteSelected);
}

function applyProp(input) {
  const key = input.dataset.key;
  if (!key || !selected) return;

  let val;
  if (input.type === 'checkbox') val = input.checked;
  else if (input.type === 'number') val = parseFloat(input.value);
  else val = input.value;

  // Handle nested array keys like "pos.0"
  if (key.includes('.')) {
    const [arrKey, idx] = key.split('.');
    if (!selected[arrKey]) selected[arrKey] = [0, 0, 0];
    selected[arrKey][parseInt(idx)] = val;
  } else {
    selected[key] = val;
  }

  // Refresh mesh
  const mesh = meshMap.get(selected.id);
  if (mesh) {
    scene.remove(mesh);
    meshMap.delete(selected.id);
    allMeshes.splice(allMeshes.indexOf(mesh), 1);
  }
  if (boxHelper) { scene.remove(boxHelper); boxHelper = null; }
  const newMesh = spawnMesh(selected);
  if (newMesh) {
    boxHelper = new THREE.BoxHelper(newMesh, 0xe94560);
    scene.add(boxHelper);
  }

  markDirty();
  rebuildObjectList();
}

function deleteSelected() {
  if (!selected) return;
  worldData.objects = worldData.objects.filter(o => o !== selected);
  const mesh = meshMap.get(selected.id);
  if (mesh) { scene.remove(mesh); meshMap.delete(selected.id); allMeshes.splice(allMeshes.indexOf(mesh), 1); }
  if (boxHelper) { scene.remove(boxHelper); boxHelper = null; }
  selected = null;
  markDirty();
  rebuildObjectList();
  renderProps(null);
  selInfo.textContent = '';
}

// ── Object list ────────────────────────────────────────────────
function rebuildObjectList() {
  objList.innerHTML = '';
  const objects = (worldData.objects || []).filter(o => o.id);
  for (const obj of objects) {
    const el = document.createElement('div');
    el.className = 'obj-item' + (selected?.id === obj.id ? ' selected' : '');
    el.dataset.id = obj.id;
    const dot = document.createElement('div');
    dot.className = 'obj-type-dot';
    dot.style.background = TYPE_COLORS[obj.type] || '#555';
    const label = document.createElement('span');
    label.className = 'obj-id';
    label.textContent = obj.id;
    const type = document.createElement('span');
    type.className = 'obj-type-label';
    type.textContent = obj.type;
    el.append(dot, label, type);
    el.addEventListener('click', () => select(obj));
    objList.appendChild(el);
  }
}

// ── Add objects ────────────────────────────────────────────────
function bindToolbar() {
  document.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', () => addObject(btn.dataset.type));
  });
  document.getElementById('btn-save').addEventListener('click', saveWorld);
  document.getElementById('btn-reload').addEventListener('click', () => loadWorld(worldId));
  document.getElementById('btn-new-world').addEventListener('click', newWorld);

  // Ctrl+S
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); saveWorld(); }
    if (e.code === 'Delete' && selected && document.activeElement === document.body) deleteSelected();
  });
}

function addObject(type) {
  // Place in front of camera
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const spawnPos = camera.position.clone().addScaledVector(dir, 6);
  const x = Math.round(spawnPos.x * 2) / 2;
  const z = Math.round(spawnPos.z * 2) / 2;

  const id = `${type}_${Date.now()}`;
  const defaults = {
    box:    { id, type: 'box',    pos: [x, 0, z], size: [2, 2, 2], color: '#4488ff', collidable: true },
    sphere: { id, type: 'sphere', pos: [x, 1, z], radius: 1, color: '#ff8844' },
    portal: { id, type: 'portal', pos: [x, 0, z], size: [4, 5], targetWorld: 'hub', color: '#00ffcc', label: '→ hub' },
    panel:  { id, type: 'panel',  pos: [x, 2, z], size: [4, 2], background: '#1a1a2e', border: '#e94560',
              items: [{ type: 'text', content: 'New Panel', color: '#ffffff', fontSize: 28, x: 0.5, y: 0.5, align: 'center' }] },
  };
  const obj = defaults[type];
  if (!obj) return;
  worldData.objects.push(obj);
  spawnMesh(obj);
  markDirty();
  rebuildObjectList();
  select(obj);
}

// ── World settings ─────────────────────────────────────────────
function syncWorldSettings() {
  document.getElementById('ws-sky').value = worldData.skyColor || '#1a1a2e';
  document.getElementById('ws-fog').value = worldData.fogColor || '#1a1a2e';
  document.getElementById('ws-gravity').value = worldData.gravity ?? -20;
  document.getElementById('ws-sx').value = worldData.spawnPoint?.x ?? 0;
  document.getElementById('ws-sz').value = worldData.spawnPoint?.z ?? 0;
}

function bindWorldSettings() {
  const apply = () => {
    worldData.skyColor = document.getElementById('ws-sky').value;
    worldData.fogColor = document.getElementById('ws-fog').value;
    worldData.gravity  = parseFloat(document.getElementById('ws-gravity').value);
    worldData.spawnPoint = {
      x: parseFloat(document.getElementById('ws-sx').value),
      y: worldData.spawnPoint?.y ?? 1,
      z: parseFloat(document.getElementById('ws-sz').value),
    };
    scene.background = new THREE.Color(worldData.skyColor);
    scene.fog = new THREE.Fog(worldData.fogColor, worldData.fogNear || 40, worldData.fogFar || 120);
    markDirty();
  };
  ['ws-sky','ws-fog','ws-gravity','ws-sx','ws-sz'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener(el.type === 'color' ? 'input' : 'change', apply);
  });
}

// ── Save & new world ───────────────────────────────────────────
async function saveWorld() {
  setSaveStatus('saving…');
  try {
    const res = await fetch(`/api/world/${worldId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(worldData),
    });
    const json = await res.json();
    if (json.ok) { dirty = false; setSaveStatus('saved'); }
    else setSaveStatus('error: ' + json.error);
  } catch (e) {
    setSaveStatus('error');
  }
}

async function newWorld() {
  const name = prompt('World name:');
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const res = await fetch(`/api/world/${id}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, description: '',
      skyColor: '#1a1a2e', fogColor: '#1a1a2e', fogNear: 40, fogFar: 120,
      gravity: -20, spawnPoint: { x: 0, y: 1, z: 0 },
      objects: [
        { type: 'ground', size: [200, 200], color: '#222', gridColor: '#333' },
        { id: 'platform', type: 'box', pos: [0, 0, 0], size: [10, 0.5, 10], color: '#0f3460', collidable: true },
      ],
      lights: [
        { type: 'ambient', color: '#ffffff', intensity: 0.4 },
        { type: 'directional', color: '#ffffff', intensity: 0.8, pos: [50, 100, 50] },
      ],
    }),
  });
  // World dir must exist — tell user to create it or handle server-side
  const json = await res.json().catch(() => ({}));
  if (json.ok) {
    await populateWorldSelector();
    loadWorld(id);
  } else {
    alert(`Could not create world "${id}".\nRun: luagen new "${name}" first, then reload.`);
  }
}

function markDirty() {
  dirty = true;
  setSaveStatus('unsaved');
}

function setSaveStatus(msg) {
  saveStatus.textContent = msg;
  saveStatus.style.color = msg === 'saved' ? '#00ffcc' : msg === 'unsaved' ? '#ffaa00' : '#e94560';
}

window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});
