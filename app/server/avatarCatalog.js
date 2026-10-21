import { readFileSync } from 'node:fs';

let skinIds = null;

export function isAvailableAvatar(assets, id) {
  if (!id) return true;
  const chars = assets?.chars || {};
  if (id.startsWith('skin:')) {
    if (!skinIds) {
      try {
        const catalog = JSON.parse(readFileSync(new URL('../public/avatar-skins.json', import.meta.url), 'utf8'));
        skinIds = new Set((catalog.skins || []).map((entry) => entry.id));
      } catch { skinIds = new Set(); }
    }
    return skinIds.has(id);
  }
  if (id.startsWith('e2:')) return !!chars[id.slice(3)]?.avatarE2;
  return !!chars[id]?.avatar;
}
