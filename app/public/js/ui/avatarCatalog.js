import { data } from '../data.js';
import { AVATAR_NAMES } from './avatarNames.js';

let skinChoices = [];
let catalogPromise = null;

export function avatarUrl(id) {
  if (typeof id !== 'string' || !id) return '';
  if (id.startsWith('skin:')) return skinChoices.find((choice) => choice.id === id)?.url || '';
  const chars = data.get('assets')?.chars || {};
  if (id.startsWith('e2:')) return chars[id.slice(3)]?.avatarE2 || '';
  return chars[id]?.avatar || '';
}

export async function loadAvatarCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all([
      data.load('assets'),
      data.load('chess'),
      fetch('/avatar-skins.json').then((response) => response.ok ? response.json() : { skins: [] }).catch(() => ({ skins: [] })),
    ]).then(([, , catalog]) => {
      skinChoices = Array.isArray(catalog.skins) ? catalog.skins : [];
      return avatarChoices();
    });
  }
  return catalogPromise;
}

export function avatarChoices() {
  const chars = data.get('assets')?.chars || {};
  const chess = data.get('chess') || {};
  const names = new Map();
  for (const record of Object.values(chess)) {
    const charId = record?.backup?.charId;
    if (charId && !names.has(charId)) names.set(charId, record.name || '');
  }
  for (const [charId, name] of Object.entries(AVATAR_NAMES)) if (!names.has(charId)) names.set(charId, name);
  const choices = [];
  for (const [charId, entry] of Object.entries(chars)) {
    if (!entry?.avatar) continue;
    const name = names.get(charId) || charId;
    choices.push({ id: charId, name, variant: '默认', url: entry.avatar, search: `${name} ${charId} 默认` });
    if (entry.avatarE2) choices.push({ id: `e2:${charId}`, name, variant: '精英2', url: entry.avatarE2, search: `${name} ${charId} 精二 精英2` });
  }
  for (const skin of skinChoices) {
    const charId = skin.id?.split(':')[1];
    if (!chars[charId]?.avatar || !skin.url) continue;
    const name = names.get(charId) || charId;
    choices.push({ ...skin, name, variant: skin.name, search: `${name} ${charId} ${skin.name} ${skin.group || ''} ${skin.id} 皮肤` });
  }
  return choices.sort((left, right) => left.name.localeCompare(right.name, 'zh') || left.id.localeCompare(right.id));
}
