import { WorldEngine } from './engine/world.js';
import { NetClient } from './engine/net.js';
import { InputManager } from './engine/input.js';
import { ProceduralGenerator } from './engine/generator.js';

const canvas      = document.getElementById('world');
const chatLog     = document.getElementById('chat-log');
const chatInput   = document.getElementById('chat-input');
const playerCount = document.getElementById('player-count');
const worldName   = document.getElementById('world-name');
const hud         = document.getElementById('hud');
const loadScreen  = document.getElementById('load-screen');
const fade        = document.getElementById('fade');
const pauseMenu   = document.getElementById('pause-menu');
const pauseWorldName  = document.getElementById('pause-world-name');
const pausePlayerCount = document.getElementById('pause-player-count');
const btnResume   = document.getElementById('btn-resume');
const btnLeave    = document.getElementById('btn-leave');
const sensSlider  = document.getElementById('sensitivity');
const sensVal     = document.getElementById('sens-val');
const fovSlider   = document.getElementById('fov-slider');
const fovVal      = document.getElementById('fov-val');
const btnMenuTouch      = document.getElementById('btn-menu-touch');
const btnChatTouch      = document.getElementById('btn-chat-touch');
const btnEnterPortal    = document.getElementById('btn-enter-portal');
const mobileChatOverlay = document.getElementById('mobile-chat-overlay');
const mobileChatLog     = document.getElementById('mobile-chat-log');
const mobileChatInput   = document.getElementById('mobile-chat-input');
const mobileChatSend    = document.getElementById('mobile-chat-send');
const touchUI           = document.getElementById('touch-ui');

let engine, input, net;
let myPlayerId = null;
let lastSent = 0;
let chatOpen = false;
let paused = false;
let transitioning = false;

// ── Pause menu ──────────────────────────────────────────────
function openPause() {
  if (chatOpen) return;
  paused = true;
  pauseMenu.classList.add('open');
  pauseWorldName.textContent = worldName.textContent;
  pausePlayerCount.textContent = playerCount.textContent;
  document.exitPointerLock();
}

function closePause() {
  paused = false;
  pauseMenu.classList.remove('open');
  if (input && !input.isTouch) canvas.requestPointerLock();
}

btnResume.addEventListener('click', closePause);
btnLeave.addEventListener('click', () => { closePause(); enterPortal('hub'); });
btnMenuTouch?.addEventListener('click', () => paused ? closePause() : openPause());

sensSlider.addEventListener('input', () => {
  const v = parseFloat(sensSlider.value);
  sensVal.textContent = v.toFixed(1);
  if (input) input.sensitivity = v;
});

fovSlider.addEventListener('input', () => {
  const v = parseInt(fovSlider.value);
  fovVal.textContent = v;
  if (engine) { engine.camera.fov = v; engine.camera.updateProjectionMatrix(); }
});

// Q or Escape toggles pause (Escape closes chat first if open)
window.addEventListener('keydown', e => {
  if (e.code === 'KeyQ' && !chatOpen) {
    paused ? closePause() : openPause();
    e.preventDefault();
    return;
  }
  if (e.code === 'Escape') {
    if (chatOpen) { closeChat(); return; }
    if (paused)   { closePause(); return; }
  }
  if (e.code === 'KeyT' && !chatOpen && !paused && document.pointerLockElement) {
    document.exitPointerLock();
    chatOpen = true;
    chatInput.style.display = 'block';
    chatInput.focus();
    e.preventDefault();
  }
});

// ── Chat ─────────────────────────────────────────────────────
chatInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') {
    const text = chatInput.value.trim();
    if (text) net?.sendChat(text);
    chatInput.value = '';
    closeChat();
    e.preventDefault();
  }
});

// Use touchend (not click) — look-zone's preventDefault swallows click on mobile
btnEnterPortal.addEventListener('touchend', (e) => {
  e.preventDefault();
  const p = btnEnterPortal._portal;
  if (!p || transitioning) return;
  transitioning = true;
  btnEnterPortal.classList.remove('visible');
  const dest = p.target || p.targetWorld;
  if (dest) enterPortal(dest);
});
// Desktop fallback
btnEnterPortal.addEventListener('click', () => {
  const p = btnEnterPortal._portal;
  if (!p || transitioning) return;
  transitioning = true;
  btnEnterPortal.classList.remove('visible');
  const dest = p.target || p.targetWorld;
  if (dest) enterPortal(dest);
});

btnChatTouch?.addEventListener('click', () => {
  if (chatOpen) return;
  openMobileChat();
});

// ── Mobile chat ───────────────────────────────────────────────
function openMobileChat() {
  chatOpen = true;
  mobileChatOverlay.classList.add('open');
  touchUI.style.pointerEvents = 'none'; // freeze joystick while typing
  mobileChatInput.focus();

  // Keep overlay above the software keyboard using visualViewport
  function reposition() {
    const vv = window.visualViewport;
    if (!vv) return;
    const bottom = window.innerHeight - vv.height - vv.offsetTop;
    mobileChatOverlay.style.transform = `translateY(-${bottom}px)`;
  }
  reposition();
  window.visualViewport?.addEventListener('resize', reposition);
  mobileChatOverlay._reposition = reposition;
}

function closeMobileChat() {
  chatOpen = false;
  mobileChatOverlay.classList.remove('open');
  mobileChatOverlay.style.transform = '';
  touchUI.style.pointerEvents = '';
  window.visualViewport?.removeEventListener('resize', mobileChatOverlay._reposition);
  mobileChatInput.value = '';
}

function sendMobileChat() {
  const text = mobileChatInput.value.trim();
  if (text) net?.sendChat(text);
  mobileChatInput.value = '';
  closeMobileChat();
}

mobileChatSend.addEventListener('click', sendMobileChat);
mobileChatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { sendMobileChat(); e.preventDefault(); }
  if (e.key === 'Escape') { closeMobileChat(); e.preventDefault(); }
});

function closeChat() {
  chatOpen = false;
  chatInput.style.display = 'none';
  if (input && !input.isTouch) canvas.requestPointerLock();
}

// ── World init ───────────────────────────────────────────────
async function init(worldId) {
  transitioning = false;
  paused = false;
  pauseMenu.classList.remove('open');
  loadScreen.style.display = 'flex';
  loadScreen.textContent = 'Loading world data...';
  hud.style.display = 'none';

  if (worldId.startsWith('http')) {
    await fadeOut();
    location.href = worldId;
    return;
  }

  let worldData;
  try {
    const res = await fetch(`/api/world/${worldId}`);
    if (!res.ok) throw new Error(`World "${worldId}" not found.`);
    worldData = await res.json();
  } catch (e) {
    loadScreen.textContent = 'Error: ' + e.message;
    return;
  }

  worldName.textContent = worldData.name || worldId;
  document.title = `${worldData.name || worldId} — LuaGen`;
  loadScreen.textContent = 'Building world...';

  if (engine) { engine.generator?.dispose(); }
  if (input) input.dispose();
  if (net) net.ws?.close();
  btnEnterPortal.classList.remove('visible');

  engine = new WorldEngine(canvas);
  engine.loadWorld(worldData);
  engine.camera.fov = parseInt(fovSlider.value);
  engine.camera.updateProjectionMatrix();

  input = new InputManager(canvas);
  input.sensitivity = parseFloat(sensSlider.value);

  if (worldData.generator === 'backrooms') {
    engine.generator = new ProceduralGenerator(engine, worldData.seed, (levelName) => {
      addChat(`[Backrooms] Entering ${levelName}...`);
      worldName.textContent = levelName;
    });
  }

  loadScreen.textContent = 'Connecting...';

  net = new NetClient(worldId, {
    init: (msg) => {
      myPlayerId = msg.playerId;
      for (const [id, state] of Object.entries(msg.objectStates || {})) {
        if (state.pos) engine.setObjectPos(id, ...state.pos);
      }
      loadScreen.style.display = 'none';
      hud.style.display = 'flex';
      if (input.isTouch) {
        addChat('[World] Joystick left · Drag right to look · ↑ jump');
      } else {
        addChat('[World] Click to capture mouse · T chat · Q pause');
      }
      for (const p of msg.players) {
        if (p.id !== myPlayerId) engine.addRemotePlayer(p.id, p.pos, p.rot || 0);
      }
      updatePlayerCount(msg.players.length);
      fadeIn();
    },
    join:   (msg) => { engine.addRemotePlayer(msg.player.id, msg.player.pos, msg.player.rot || 0); addChat(`[World] ${msg.player.name} joined.`); updatePlayerCount(null, +1); },
    leave:  (msg) => { engine.removeRemotePlayer(msg.playerId); addChat(`[World] A player left.`); updatePlayerCount(null, -1); },
    move:   (msg) => { if (msg.playerId !== myPlayerId) engine.updateRemotePlayer(msg.playerId, msg.pos, msg.rot); },
    chat:   (msg) => { addChat(`${msg.name}: ${msg.text}`); },
    rename: () => {},
    event:  (msg) => {
      if (msg.name === 'setPos')   engine.setObjectPos(msg.data.id, msg.data.x, msg.data.y, msg.data.z);
      if (msg.name === 'setRot')   engine.setObjectRotation(msg.data.id, msg.data.x, msg.data.y, msg.data.z);
      if (msg.name === 'setColor') engine.setObjectColor(msg.data.id, msg.data.hex);
      if (msg.name === 'impulse')  engine.impulse(msg.data.x, msg.data.y, msg.data.z);
    },
    error: (msg) => { loadScreen.style.display = 'flex'; loadScreen.textContent = 'Error: ' + msg.message; },
  });
  net.worldId = worldId;

  // Render loop
  let last = performance.now();
  const wsWorldId = worldId;
  function frame() {
    requestAnimationFrame(frame);
    if (net.worldId !== wsWorldId) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (chatOpen || paused) {
      engine.renderer.render(engine.scene, engine.camera);
      return;
    }

    const { pos, portal } = engine.tick(dt, input.get(), input.yaw);

    if (now - lastSent > 100) {
      net.sendMove({ x: pos.x, y: pos.y, z: pos.z }, input.yaw);
      lastSent = now;
    }

    if (portal && !transitioning) {
      if (input.isTouch) {
        btnEnterPortal.textContent = '→ ' + (portal.targetWorld || portal.target || 'Portal');
        btnEnterPortal.classList.add('visible');
        btnEnterPortal._portal = portal;
        btnEnterPortal._hideAt = null; // reset any pending hide
      } else {
        transitioning = true;
        const dest = portal.target || portal.targetWorld;
        if (dest) enterPortal(dest);
      }
    } else if (!portal && btnEnterPortal._portal && !transitioning) {
      // Grace period — player may drift out of zone while reaching for the button
      if (!btnEnterPortal._hideAt) btnEnterPortal._hideAt = now + 2000;
      if (now > btnEnterPortal._hideAt) {
        btnEnterPortal.classList.remove('visible');
        btnEnterPortal._portal = null;
        btnEnterPortal._hideAt = null;
      }
    }
  }
  requestAnimationFrame(frame);
}

async function enterPortal(dest) {
  document.exitPointerLock();
  addChat(`[Portal] Travelling to ${dest}...`);
  await fadeOut();
  if (!dest.startsWith('http')) {
    history.pushState({}, '', `?world=${dest}`);
    await init(dest);
  } else {
    location.href = dest;
  }
}

window.addEventListener('popstate', () => {
  const id = new URLSearchParams(location.search).get('world') || 'demo';
  init(id);
});

function addChat(text) {
  for (const log of [chatLog, mobileChatLog]) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    if (log.children.length > 50) log.removeChild(log.firstChild);
  }
}

let pcount = 0;
function updatePlayerCount(absolute, delta) {
  if (absolute !== null) pcount = absolute;
  else pcount += delta;
  const txt = pcount + (pcount === 1 ? ' player' : ' players');
  playerCount.textContent = txt;
  pausePlayerCount.textContent = txt;
}

function fadeOut() {
  fade.style.transition = 'opacity 0.4s';
  fade.style.opacity = '1';
  return new Promise(r => setTimeout(r, 420));
}
function fadeIn() {
  fade.style.transition = 'opacity 0.6s';
  fade.style.opacity = '0';
}

const startWorld = new URLSearchParams(location.search).get('world') || 'demo';
init(startWorld);
