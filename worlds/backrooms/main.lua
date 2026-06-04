-- The Backrooms
-- Infinite procedural generation. No exits. No escape.

local t = 0
local messages = {
  "You shouldn't be here.",
  "The hum of fluorescent lights never stops.",
  "You've been walking for hours.",
  "The walls look the same as the last room.",
  "Something moved at the edge of your vision.",
  "The carpet is damp.",
  "You can smell mold.",
  "There are no doors out.",
  "You find a sticky note. It reads: 'turn back'.",
  "The lights flicker.",
  "How long have you been here?",
}
local nextMsg = 45

function onTick(dt)
  t = t + dt
  nextMsg = nextMsg - dt
  if nextMsg <= 0 then
    local i = math.random(#messages)
    World.chat("[Backrooms] " .. messages[i])
    nextMsg = 30 + math.random() * 60
  end
end

function onPlayerJoin(player)
  World.chat("[Backrooms] You have no-clipped out of reality.")
  World.chat("[Backrooms] Walk. Don't stop.")
end
