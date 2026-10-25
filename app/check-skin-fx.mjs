import fs from 'node:fs';
import path from 'node:path';

const root = '/opt/a4-migration-stage-20261019/forge031-candidate';
const fx = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/local/fx/index.json'), 'utf8'));
const pack = JSON.parse(fs.readFileSync(path.join(root, 'workshop/skin-supplement/pack.json'), 'utf8'));
const legacy = pack.skins.filter((s) => s.id.startsWith('legacy-'));
const skins = fx.skins || {};
const rows = legacy.map((s) => {
  const model = path.basename(s.art?.spine?.front?.skel || '', '.skel');
  const found = skins[model] || skins[model.toLowerCase()] || null;
  return { charId: s.charId, model, fx: !!found?.fx, mounts: !!found, fallback: !!fx.ops?.[s.charId] };
});
console.log(JSON.stringify({ fxSkins: Object.keys(skins).length, legacy: rows }));
