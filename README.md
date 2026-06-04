# LuaGen

3d Web. You! Yeah, you. Know how ya can paste a few commands into the black box of terminal and ya get an HTML Web server? What if I told you with LuaGen you can make 3D websites? Just as easy as getting this package and running `luagen start` in that ol' terminal.

**WebWorlds** are to 3D what websites are to 2D. Host your own. Visit any URL. Walk around. No accounts. No platform. No age verification. Just a URL.

```
npm install && npm start
# Your world is live at http://localhost:3000?world=demo
```

---

## What it is

- **3D multiplayer worlds** in the browser — Three.js rendering, no install required to visit
- **Lua scripting** — every world has a `main.lua` that runs server-side
- **Portals** — walk through a glowing arch to travel to another world, same server or a completely different one across the internet
- **Infinite procedural backrooms** — four aesthetic levels, generates forever as you walk
- **Touch controls** — virtual joystick + drag-look, works on phones and tablets
- **Self-hosted** — it's your server, your world, your rules

---

## Quick start

```bash
git clone https://codeberg.org/GoodThemeCodeBurg/LuaGen.git
cd LuaGen
npm install
npm start
```

Open `http://localhost:3000?world=demo` in your browser. Click to capture the mouse, WASD to move, Space to jump, T to chat, Q to pause.

### With the CLI

```bash
sudo npm link       # makes luagen available globally

luagen start        # start server
luagen all          # status + worlds + players in one shot
luagen new "My World"
luagen stop
```

---

## Making a world

A world is just a folder in `worlds/` with two files:

**`worlds/myworld/world.json`** — defines the scene:
```json
{
  "name": "My World",
  "skyColor": "#1a1a2e",
  "gravity": -20,
  "spawnPoint": { "x": 0, "y": 1, "z": 0 },
  "objects": [
    { "type": "ground", "size": [200, 200], "color": "#222" },
    { "id": "platform", "type": "box", "pos": [0, 0, 0], "size": [10, 0.5, 10], "color": "#0f3460", "collidable": true }
  ],
  "lights": [
    { "type": "ambient", "color": "#ffffff", "intensity": 0.4 },
    { "type": "directional", "color": "#ffffff", "intensity": 0.8, "pos": [50, 100, 50] }
  ]
}
```

**`worlds/myworld/main.lua`** — scripting:
```lua
function onPlayerJoin(player)
  World.chat("Welcome, " .. player.name .. "!")
end

function onTick(dt)
  -- runs 10x per second
end
```

Then visit `http://localhost:3000?world=myworld`. Or scaffold one instantly:

```bash
luagen new "My World"
```

---

## Portals

Add a portal object to link worlds together:

```json
{
  "id": "portal_to_hub",
  "type": "portal",
  "pos": [0, 0, 10],
  "size": [4, 5],
  "targetWorld": "hub",
  "color": "#00ffcc",
  "label": "→ The Hub"
}
```

Set `"target"` to a full URL to link to a world on a completely different server. That's the whole point — WebWorlds are hyperlinked, just like web pages.

---

## Convert a 3D model

```bash
node tools/convert/gltf-to-world.js mymodel.glb myworld
```

Drops a ready-to-use world folder from any GLTF/GLB file.

---

## Worlds included

| World | Description |
|---|---|
| `demo` | Starting world. Pillars, an animated orb, steps, a portal |
| `hub` | Crossroads. Three portals leading to other worlds |
| `backrooms` | Infinite procedural maze. Four aesthetic levels. No exit |

---

## Lua API

```lua
World.chat(text)               -- broadcast to all players
World.setPos(id, x, y, z)     -- move an object
World.setRotation(id, x, y, z)
World.setColor(id, "#hex")

Player.impulse(playerId, x, y, z)
Player.teleport(playerId, x, y, z)

-- Hooks
function onTick(dt) end
function onPlayerJoin(player) end
function onPlayerLeave(player) end
function onChat(player, text) end   -- return true to suppress
function onTouch(player, objectId) end
```

Full reference in [`sdk/api.md`](sdk/api.md).

---

## CLI reference

```
luagen start              Start server (foreground)
luagen start --daemon     Start in background
luagen stop               Stop background server
luagen all                Status + worlds + players
luagen status             Server info
luagen players            Who's connected
luagen worlds             Available worlds
luagen new <name>         Scaffold a new world
luagen convert <file>     GLTF → WebWorld
luagen version
luagen help
```

---

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Space | Jump |
| Shift | Sprint |
| Mouse | Look |
| T | Chat |
| Q | Pause / settings |

On touch: left half = joystick, right half = look, buttons for jump/sprint/chat.

---

## License

MIT — Copyright (c) 2026 TCF and LuaGen Contributors
