import * as THREE from '/node_modules/three/build/three.module.js';

const CANVAS_SCALE = 128; // pixels per world unit

export class WorldUIPanel {
  constructor(obj) {
    this.obj = obj;
    const [pw, ph] = obj.size || [4, 2];
    this._pw = pw;
    this._ph = ph;

    // Offscreen canvas
    this._canvas = document.createElement('canvas');
    this._canvas.width  = Math.round(pw * CANVAS_SCALE);
    this._canvas.height = Math.round(ph * CANVAS_SCALE);
    this._ctx = this._canvas.getContext('2d');

    this._tex  = new THREE.CanvasTexture(this._canvas);
    this._mat  = new THREE.MeshBasicMaterial({ map: this._tex, transparent: true, side: THREE.DoubleSide });
    this._geo  = new THREE.PlaneGeometry(pw, ph);
    this.mesh  = new THREE.Mesh(this._geo, this._mat);

    const [px, py, pz] = obj.pos || [0, 0, 0];
    this.mesh.position.set(px, py + ph / 2, pz);

    this.render();
  }

  render() {
    const ctx = this._ctx;
    const W = this._canvas.width, H = this._canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    const bg = this.obj.background || '#1a1a2e';
    const border = this.obj.border || null;
    const bw = (this.obj.borderWidth || 2) * (CANVAS_SCALE / 64);
    const r = 12;

    ctx.beginPath();
    ctx.roundRect(bw, bw, W - bw * 2, H - bw * 2, r);
    ctx.fillStyle = bg;
    ctx.fill();

    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = bw;
      ctx.stroke();
    }

    // Items
    for (const item of (this.obj.items || [])) {
      const ix = item.x * W, iy = item.y * H;

      if (item.type === 'text') {
        const size = (item.fontSize || 24) * (CANVAS_SCALE / 64);
        ctx.font = `${item.bold ? 'bold ' : ''}${size}px 'Segoe UI', system-ui, sans-serif`;
        ctx.fillStyle = item.color || '#ffffff';
        ctx.textAlign  = item.align || 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.content || '', ix, iy);
      }

      if (item.type === 'rect') {
        ctx.fillStyle = item.color || '#ffffff';
        ctx.fillRect(
          item.x * W, item.y * H,
          (item.w || 0.5) * W, (item.h || 0.1) * H
        );
      }

      if (item.type === 'image' && item.src) {
        // Images are loaded async — skip for now
      }
    }

    this._tex.needsUpdate = true;
  }

  // Called from server Lua events to update content
  updateItem(index, patch) {
    const item = this.obj.items?.[index];
    if (!item) return;
    Object.assign(item, patch);
    this.render();
  }

  setText(index, text) {
    this.updateItem(index, { content: text });
  }

  dispose() {
    this._geo.dispose();
    this._mat.dispose();
    this._tex.dispose();
  }
}
