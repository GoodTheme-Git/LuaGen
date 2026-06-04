-- Demo World script (LuaGen Lua API)
-- Runs server-side. Use World.* to manipulate objects, Player.* for players.

local t = 0

-- Called every server tick (10Hz)
function onTick(dt)
  t = t + dt
  -- Animate the orb: bob up and down, cycle color hue
  local y = 3 + math.sin(t * 1.5) * 0.5
  World.setPos("orb", 0, y, 0)
  World.setRotation("orb", 0, t * 40, 0)
end

-- Called when a player enters the world
function onPlayerJoin(player)
  World.chat("[World] Welcome, " .. player.name .. "! You are player #" .. player.id)
  World.chat("[World] WASD to move, Space to jump, T to chat.")
end

-- Called when a player sends a chat message
function onChat(player, text)
  -- Simple command: /color <hex>
  if text:sub(1, 7) == "/color " then
    local hex = text:sub(8)
    World.setColor("orb", hex)
    World.chat("[World] Orb color changed to " .. hex)
    return true -- suppress normal broadcast
  end
  return false
end

-- Called when a player touches an object
function onTouch(player, objectId)
  if objectId == "orb" then
    World.chat("[World] " .. player.name .. " touched the orb!")
    -- Fling the player up a bit
    Player.impulse(player.id, 0, 15, 0)
  end
end
