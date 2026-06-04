export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.yaw = Math.PI; // face +Z where world content lives
    this.sensitivity = 1.0;
    this.locked = false;

    // Touch state
    this._stickId = null;
    this._stickOrigin = { x: 0, y: 0 };
    this._stickDelta = { x: 0, y: 0 };
    this._lookId = null;
    this._lookLast = { x: 0, y: 0 };
    this._touchJump = false;
    this._touchSprint = false;
    this.isTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);

    // Joystick UI refs
    this._jBase = document.getElementById('joystick-base');
    this._jNub  = document.getElementById('joystick-nub');

    this._setupKeyboard();
    this._setupMouse(canvas);
    if (this.isTouch) this._setupTouch();
  }

  _setupKeyboard() {
    window.addEventListener('keydown', e => { this.keys[e.code] = true; });
    window.addEventListener('keyup',   e => { this.keys[e.code] = false; });
  }

  _setupMouse(canvas) {
    canvas.addEventListener('click', () => {
      if (!this.isTouch && !this.locked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', e => {
      if (this.locked) this.yaw -= e.movementX * 0.002 * this.sensitivity;
    });
  }

  _setupTouch() {
    document.body.classList.add('touch-active');

    const jZone  = document.getElementById('joystick-zone');
    const lZone  = document.getElementById('look-zone');
    const btnJump   = document.getElementById('btn-jump');
    const btnSprint = document.getElementById('btn-sprint-touch');

    const MAX_DIST = 42;

    // Joystick zone — left half
    jZone.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this._stickId !== null) continue;
        this._stickId = t.identifier;
        this._stickOrigin = { x: t.clientX, y: t.clientY };
        this._stickDelta = { x: 0, y: 0 };
        this._jBase.style.left = (t.clientX - 55) + 'px';
        this._jBase.style.top  = (t.clientY - 55) + 'px';
        this._jBase.classList.add('active');
        this._jNub.style.transform = 'translate(0,0)';
      }
    }, { passive: false });

    jZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this._stickId) continue;
        let dx = t.clientX - this._stickOrigin.x;
        let dy = t.clientY - this._stickOrigin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > MAX_DIST) { dx = dx / dist * MAX_DIST; dy = dy / dist * MAX_DIST; }
        this._stickDelta = { x: dx / MAX_DIST, y: dy / MAX_DIST };
        this._jNub.style.transform = `translate(${dx}px,${dy}px)`;
      }
    }, { passive: false });

    const stickEnd = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this._stickId) {
          this._stickId = null;
          this._stickDelta = { x: 0, y: 0 };
          this._jBase.classList.remove('active');
        }
      }
    };
    jZone.addEventListener('touchend',    stickEnd, { passive: false });
    jZone.addEventListener('touchcancel', stickEnd, { passive: false });

    // Look zone — right half (drag to rotate camera)
    const LOOK_SENS = 0.005;
    lZone.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this._lookId !== null) continue;
        this._lookId = t.identifier;
        this._lookLast = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });

    lZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this._lookId) continue;
        const dx = t.clientX - this._lookLast.x;
        this.yaw -= dx * LOOK_SENS * this.sensitivity;
        this._lookLast = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });

    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._lookId) this._lookId = null;
      }
    };
    lZone.addEventListener('touchend',    lookEnd, { passive: false });
    lZone.addEventListener('touchcancel', lookEnd, { passive: false });

    // Jump & sprint buttons
    btnJump.addEventListener('touchstart',  e => { e.preventDefault(); this._touchJump = true; },  { passive: false });
    btnJump.addEventListener('touchend',    e => { e.preventDefault(); this._touchJump = false; }, { passive: false });
    btnJump.addEventListener('touchcancel', e => { e.preventDefault(); this._touchJump = false; }, { passive: false });

    btnSprint.addEventListener('touchstart',  e => { e.preventDefault(); this._touchSprint = true; },  { passive: false });
    btnSprint.addEventListener('touchend',    e => { e.preventDefault(); this._touchSprint = false; }, { passive: false });
    btnSprint.addEventListener('touchcancel', e => { e.preventDefault(); this._touchSprint = false; }, { passive: false });
  }

  get() {
    // Keyboard
    const kb = {
      forward:  this.keys['KeyW'] || this.keys['ArrowUp'],
      backward: this.keys['KeyS'] || this.keys['ArrowDown'],
      left:     this.keys['KeyA'] || this.keys['ArrowLeft'],
      right:    this.keys['KeyD'] || this.keys['ArrowRight'],
      jump:     this.keys['Space'],
      sprint:   this.keys['ShiftLeft'] || this.keys['ShiftRight'],
    };

    // Touch joystick overrides (threshold 0.25 so small drifts don't move)
    if (this.isTouch) {
      const { x, y } = this._stickDelta;
      if (Math.abs(x) > 0.25 || Math.abs(y) > 0.25) {
        kb.forward  = y < -0.25;
        kb.backward = y >  0.25;
        kb.left     = x < -0.25;
        kb.right    = x >  0.25;
      }
      if (this._touchJump)  kb.jump   = true;
      if (this._touchSprint) kb.sprint = true;
    }

    return kb;
  }
}
