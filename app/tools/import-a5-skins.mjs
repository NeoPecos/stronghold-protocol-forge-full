// One-time migration of a5's skins-verify cosmetic assets into the existing
// skin-supplement workshop pack. Run against a copy of the production tree.
// Usage: node tools/import-a5-skins.mjs <old-app-root> <new-app-root>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [oldRoot, newRoot] = process.argv.slice(2);
if (!oldRoot || !newRoot) throw new Error('old and new app roots required');
const packRoot = path.join(newRoot, 'workshop', 'skin-supplement');
const packFile = path.join(packRoot, 'pack.json');
const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
const skinStem = (skin) => path.basename(skin?.art?.spine?.front?.skel || '').toLowerCase();
const existing = new Set();
for (const name of fs.readdirSync(path.join(newRoot, 'workshop'))) {
  const manifest = path.join(newRoot, 'workshop', name, 'pack.json');
  if (!fs.existsSync(manifest)) continue;
  const installed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const skin of installed.skins || []) {
    const stem = skinStem(skin);
    if (stem) existing.add(`${skin.charId}|${stem}`);
  }
}
const idSet = new Set(pack.skins.map((skin) => skin.id));
const inserted = [];
const copied = new Set();

for (const pluginName of ['skins-verify', 'skins-verify-2']) {
  const pluginRoot = path.join(oldRoot, 'plugins', pluginName);
  const plugin = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  const prefix = pluginName === 'skins-verify' ? 'legacy-a' : 'legacy-b';
  const importPath = (relative) => {
    if (typeof relative !== 'string' || !/^media\/[A-Za-z0-9_./-]+$/.test(relative) || relative.includes('..')) return null;
    const source = path.join(pluginRoot, relative);
    if (!fs.existsSync(source)) return null;
    const destRelative = `${prefix}/${relative}`;
    const dest = path.join(packRoot, 'assets', destRelative);
    if (!copied.has(destRelative)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
      copied.add(destRelative);
    }
    return destRelative;
  };
  for (const [charId, row] of Object.entries(plugin.assets?.chars || {})) {
    for (const [oldId, oldSkin] of Object.entries(row?.skins || {})) {
      const stem = path.basename(oldSkin?.spine?.front?.skel || '').toLowerCase();
      const key = `${charId}|${stem || oldId}`;
      if (existing.has(key)) continue;
      const art = {};
      const avatar = importPath(oldSkin.avatar);
      if (avatar) art.avatar = avatar;
      const portrait = importPath(oldSkin.portrait);
      if (portrait) art.portrait = portrait;
      const spine = {};
      for (const face of ['front', 'back']) {
        const oldFace = oldSkin.spine?.[face];
        if (!oldFace) continue;
        const skel = importPath(oldFace.skel);
        const atlas = importPath(oldFace.atlas);
        const textures = (oldFace.textures || []).map(importPath).filter(Boolean);
        if (skel && atlas && textures.length) spine[face] = { skel, atlas, textures };
      }
      if (Object.keys(spine).length) art.spine = spine;
      if (!Object.keys(art).length) continue;
      const id = `legacy-${createHash('sha256').update(oldId).digest('hex').slice(0, 16)}`;
      if (idSet.has(id)) throw new Error(`duplicate generated id: ${id}`);
      idSet.add(id);
      pack.skins.push({ id, charId, name: oldSkin.name || oldId, art });
      inserted.push({ charId, oldId, id, stem, model: !!spine.front });
      existing.add(key);
    }
  }
}

fs.writeFileSync(packFile, `${JSON.stringify(pack, null, 2)}\n`);
console.log(JSON.stringify({ skinsAdded: inserted.length, withModels: inserted.filter((s) => s.model).length,
  assetsCopied: copied.size, totalSkins: pack.skins.length, inserted }));
