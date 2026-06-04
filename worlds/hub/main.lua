-- The Hub — crossroads between worlds

local t = 0

function onTick(dt)
  t = t + dt
  -- Slowly rotate the central sphere
  World.setRotation("center_pillar", 0, t * 15, t * 8)
end

function onPlayerJoin(player)
  World.chat("[Hub] " .. player.name .. " arrived through a portal.")
  World.chat("[Hub] Walk into any glowing archway to travel to another world.")
end

function onChat(player, text)
  if text == "/worlds" then
    World.chat("[Hub] Known worlds on this server: demo, hub")
    World.chat("[Hub] To link to an external world, set 'target' in world.json to a full URL.")
    return true
  end
  return false
end
