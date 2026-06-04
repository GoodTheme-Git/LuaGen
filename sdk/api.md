# LuaGen Lua API Reference

LuaGen worlds are scripted in Lua 5.3. Scripts run server-side and communicate
with clients over WebSocket. The engine calls these functions automatically.

---

## Lifecycle Hooks

```lua
function onTick(dt)          -- Called ~10x/sec. dt = seconds since last tick.
function onPlayerJoin(player) -- player = { id, name, pos }
function onPlayerLeave(player)
function onChat(player, text) -- Return true to suppress broadcast.
function onTouch(player, objectId)
```

---

## World

```lua
World.chat(text)                    -- Broadcast message to all players
World.setPos(id, x, y, z)          -- Move an object
World.setRotation(id, x, y, z)     -- Rotate object (degrees)
World.setColor(id, hex)             -- Change object color: "#ff0000"
World.setVisible(id, bool)
World.spawn(object)                 -- Dynamically add an object (table matching world.json format)
World.despawn(id)
World.getPos(id)                    -- Returns x, y, z
```

---

## Player

```lua
Player.teleport(playerId, x, y, z)
Player.impulse(playerId, x, y, z)  -- Apply velocity impulse
Player.kick(playerId, reason)
Player.setName(playerId, name)
Player.getAll()                     -- Returns array of player tables
```

---

## Timer

```lua
Timer.after(seconds, fn)           -- Call fn once after delay
Timer.every(seconds, fn)           -- Repeating timer, returns id
Timer.cancel(id)
```

---

## Object Schema (world.json)

```json
{
  "id": "my_box",
  "type": "box",
  "pos": [0, 1, 0],
  "size": [2, 2, 2],
  "color": "#883344",
  "emissive": "#441122",
  "emissiveIntensity": 0.3,
  "collidable": true,
  "label": "optional hover text",
  "script": "optional_script_name"
}
```

Supported types: `box`, `sphere`, `ground`
GLTF model support: coming in LuaGen 0.2

---

## World Manifest (world.json top-level)

```json
{
  "name": "My World",
  "description": "...",
  "skyColor": "#1a1a2e",
  "fogColor": "#1a1a2e",
  "fogNear": 40,
  "fogFar": 120,
  "gravity": -20,
  "spawnPoint": { "x": 0, "y": 1, "z": 0 },
  "objects": [...],
  "lights": [...]
}
```

---

## Hosting a WebWorld

```bash
# Clone or download LuaGen
git clone https://github.com/your-org/luagen
cd luagen
npm install
npm start

# Your world is now live at:
#   http://localhost:3000?world=demo
```

To expose publicly: use Cloudflare Tunnel, ngrok, or any reverse proxy.
No accounts. No platform. Just a URL.

---


## License

[MIT](../LICENSE) — do whatever you want, just keep the copyright notice.
