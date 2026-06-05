const fengari = require('fengari');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

class LuaWorldRunner {
  constructor(worldId, worldData, broadcast) {
    this.worldId = worldId;
    this.worldData = worldData;
    this.broadcast = broadcast;
    this.L = null;
    this.timers = [];
    this._tickInterval = null;
    this._t = 0;
    this._objectStates = {}; // id -> { pos, rot, color }

    // Build initial object state map
    for (const obj of (worldData.objects || [])) {
      if (obj.id) {
        this._objectStates[obj.id] = {
          pos: obj.pos ? [...obj.pos] : [0, 0, 0],
          rot: [0, 0, 0],
          color: obj.color || '#888',
        };
      }
    }
  }

  loadScript(luaSource) {
    if (!luaSource || !luaSource.trim()) return;

    this.L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(this.L);

    this._bindAPI();

    const status = lauxlib.luaL_dostring(this.L, to_luastring(luaSource));
    if (status !== lua.LUA_OK) {
      const err = lua.lua_tojsstring(this.L, -1);
      console.error(`[LuaGen:${this.worldId}] Script error:`, err);
      this.L = null;
      return;
    }

    console.log(`[LuaGen:${this.worldId}] Script loaded.`);
    this._startTick();
  }

  _bindAPI() {
    const L = this.L;
    const self = this;

    // World table
    lua.lua_newtable(L);

    this._setFunc('chat', (L) => {
      const text = lua.lua_tojsstring(L, 1) || '';
      self.broadcast({ type: 'chat', playerId: '_world', name: '[World]', text });
      return 0;
    });

    this._setFunc('setPos', (L) => {
      const id = lua.lua_tojsstring(L, 1);
      const x = lua.lua_tonumber(L, 2);
      const y = lua.lua_tonumber(L, 3);
      const z = lua.lua_tonumber(L, 4);
      if (self._objectStates[id]) self._objectStates[id].pos = [x, y, z];
      self.broadcast({ type: 'event', name: 'setPos', data: { id, x, y, z } });
      return 0;
    });

    this._setFunc('setRotation', (L) => {
      const id = lua.lua_tojsstring(L, 1);
      const x = lua.lua_tonumber(L, 2);
      const y = lua.lua_tonumber(L, 3);
      const z = lua.lua_tonumber(L, 4);
      if (self._objectStates[id]) self._objectStates[id].rot = [x, y, z];
      self.broadcast({ type: 'event', name: 'setRot', data: { id, x, y, z } });
      return 0;
    });

    this._setFunc('setColor', (L) => {
      const id = lua.lua_tojsstring(L, 1);
      const hex = lua.lua_tojsstring(L, 2) || '#888';
      if (self._objectStates[id]) self._objectStates[id].color = hex;
      self.broadcast({ type: 'event', name: 'setColor', data: { id, hex } });
      return 0;
    });

    this._setFunc('setPanelText', (L) => {
      const id    = lua.lua_tojsstring(L, 1);
      const index = lua.lua_tonumber(L, 2) - 1; // Lua is 1-indexed
      const text  = lua.lua_tojsstring(L, 3) || '';
      self.broadcast({ type: 'event', name: 'setPanelText', data: { id, index, text } });
      return 0;
    });

    lua.lua_setglobal(L, to_luastring('World'));

    // Player table
    lua.lua_newtable(L);

    this._setFunc('impulse', (L) => {
      const playerId = lua.lua_tojsstring(L, 1);
      const x = lua.lua_tonumber(L, 2);
      const y = lua.lua_tonumber(L, 3);
      const z = lua.lua_tonumber(L, 4);
      self.broadcast({ type: 'event', playerId: '_world', name: 'impulse', data: { playerId, x, y, z } });
      return 0;
    });

    lua.lua_setglobal(L, to_luastring('Player'));
  }

  _setFunc(name, fn) {
    const L = this.L;
    lua.lua_pushstring(L, to_luastring(name));
    lua.lua_pushcfunction(L, fn);
    lua.lua_settable(L, -3);
  }

  _callLua(fnName, ...args) {
    if (!this.L) return;
    const L = this.L;
    lua.lua_getglobal(L, to_luastring(fnName));
    if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) { lua.lua_pop(L, 1); return; }

    for (const a of args) {
      if (typeof a === 'number') lua.lua_pushnumber(L, a);
      else if (typeof a === 'string') lua.lua_pushstring(L, to_luastring(a));
      else if (typeof a === 'object') {
        lua.lua_newtable(L);
        for (const [k, v] of Object.entries(a)) {
          lua.lua_pushstring(L, to_luastring(k));
          if (typeof v === 'number') lua.lua_pushnumber(L, v);
          else if (typeof v === 'string') lua.lua_pushstring(L, to_luastring(v));
          else lua.lua_pushnil(L);
          lua.lua_settable(L, -3);
        }
      }
    }

    const status = lua.lua_pcall(L, args.length, 1, 0);
    if (status !== lua.LUA_OK) {
      console.error(`[LuaGen:${this.worldId}] ${fnName} error:`, lua.lua_tojsstring(L, -1));
    }
    const result = lua.lua_toboolean(L, -1);
    lua.lua_pop(L, 1);
    return result;
  }

  _startTick() {
    const TICK_HZ = 10;
    let last = Date.now();
    this._tickInterval = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      this._t += dt;
      try { this._callLua('onTick', dt); } catch (e) { console.error('[LuaRunner tick]', e); }
    }, 1000 / TICK_HZ);
  }

  onPlayerJoin(player) { this._callLua('onPlayerJoin', player); }
  onPlayerLeave(player) { this._callLua('onPlayerLeave', player); }
  onChat(player, text) { return this._callLua('onChat', player, text); }
  onTouch(player, objectId) { this._callLua('onTouch', player, objectId); }

  stop() {
    if (this._tickInterval) clearInterval(this._tickInterval);
  }

  // Sync new client with current animated state
  getObjectStates() { return this._objectStates; }
}

module.exports = { LuaWorldRunner };
