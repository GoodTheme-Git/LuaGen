#!/usr/bin/env node
/**
 * LuaGen GLTF → WebWorld converter
 * Usage: node gltf-to-world.js input.gltf [output-dir]
 *
 * Converts a GLTF/GLB file into a LuaGen WebWorld directory:
 *   output-dir/
 *     world.json   - world manifest with objects from the GLTF scene
 *     main.lua     - starter Lua script
 *     assets/      - copied textures/buffers
 */

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node gltf-to-world.js <input.gltf|input.glb> [output-dir]');
  process.exit(1);
}

const outputDir = process.argv[3] || path.basename(inputFile, path.extname(inputFile));

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

fs.mkdirSync(path.join(outputDir, 'assets'), { recursive: true });

let gltf;
const ext = path.extname(inputFile).toLowerCase();

if (ext === '.glb') {
  // Parse GLB binary container
  const buf = fs.readFileSync(inputFile);
  const jsonLen = buf.readUInt32LE(12);
  gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
} else {
  gltf = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  // Copy external buffers/images
  const dir = path.dirname(inputFile);
  for (const img of (gltf.images || [])) {
    if (img.uri && !img.uri.startsWith('data:')) {
      const src = path.join(dir, img.uri);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outputDir, 'assets', path.basename(img.uri)));
    }
  }
}

// Extract meshes from GLTF scene
const objects = [];
const scene = gltf.scenes?.[gltf.scene ?? 0];

function processMesh(nodeIdx, parentMatrix) {
  const node = gltf.nodes[nodeIdx];
  if (!node) return;

  // Build TRS
  const pos = node.translation || [0, 0, 0];
  const scale = node.scale || [1, 1, 1];

  if (node.mesh !== undefined) {
    const mesh = gltf.meshes[node.mesh];
    const mat = gltf.materials?.[mesh.primitives[0]?.material];
    const baseColor = mat?.pbrMetallicRoughness?.baseColorFactor || [0.5, 0.5, 0.5, 1];
    const hex = '#' + baseColor.slice(0, 3).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

    // Use AABB approximation from scale for size
    objects.push({
      id: (node.name || `node_${nodeIdx}`).replace(/\s+/g, '_'),
      type: 'box',
      pos: [Math.round(pos[0] * 100) / 100, Math.round(pos[1] * 100) / 100, Math.round(pos[2] * 100) / 100],
      size: [Math.round(scale[0] * 200) / 100, Math.round(scale[1] * 200) / 100, Math.round(scale[2] * 200) / 100],
      color: hex,
      collidable: true,
      _source: 'gltf',
      _mesh: mesh.name || undefined,
    });
  }

  for (const child of (node.children || [])) processMesh(child, null);
}

for (const nodeIdx of (scene?.nodes || [])) processMesh(nodeIdx, null);

const worldJson = {
  name: path.basename(outputDir),
  description: `Converted from ${path.basename(inputFile)} by LuaGen converter`,
  skyColor: '#1a1a2e',
  fogColor: '#1a1a2e',
  fogNear: 40,
  fogFar: 120,
  gravity: -20,
  spawnPoint: { x: 0, y: 2, z: 0 },
  objects: [
    { type: 'ground', size: [200, 200], color: '#222', gridColor: '#333' },
    { type: 'ambient', color: '#ffffff', intensity: 0.4 },
    { type: 'directional', color: '#ffffff', intensity: 0.8, pos: [50, 100, 50] },
    ...objects,
  ],
  lights: [
    { type: 'ambient', color: '#ffffff', intensity: 0.4 },
    { type: 'directional', color: '#ffffff', intensity: 0.8, pos: [50, 100, 50] },
  ],
};

fs.writeFileSync(path.join(outputDir, 'world.json'), JSON.stringify(worldJson, null, 2));

fs.writeFileSync(path.join(outputDir, 'main.lua'), `-- ${worldJson.name} - LuaGen World Script

function onPlayerJoin(player)
  World.chat("[World] Welcome, " .. player.name .. "!")
end

function onTick(dt)
  -- your world logic here
end
`);

console.log(`\n  World exported to: ${outputDir}/`);
console.log(`  Objects: ${objects.length}`);
console.log(`  Drop this folder into your LuaGen worlds/ directory and restart.\n`);
