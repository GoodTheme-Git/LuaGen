export class NetClient {
  constructor(worldId, handlers) {
    this.worldId = worldId;
    this.handlers = handlers;
    this.playerId = null;
    this.ws = null;
    this._connect();
  }

  _connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${protocol}://${location.host}?world=${this.worldId}`);
    this.ws.onopen = () => console.log('[Net] Connected to world:', this.worldId);
    this.ws.onclose = () => {
      console.log('[Net] Disconnected, reconnecting in 3s...');
      setTimeout(() => this._connect(), 3000);
    };
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this.handlers[msg.type]?.(msg);
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendMove(pos, rot) { this.send({ type: 'move', pos, rot }); }
  sendChat(text) { this.send({ type: 'chat', text }); }
  setName(name) { this.send({ type: 'setName', name }); }
  sendEvent(name, data) { this.send({ type: 'event', name, data }); }
}
