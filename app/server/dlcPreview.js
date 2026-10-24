// Read-only operator comparison for the loadout screen. Each DLC is applied
// separately to the same common-pack baseline, so another DLC cannot be
// mistaken for this pack's change.
import { applyWorkshop } from '../shared/workshop.js';
import { DLC_PACKS, DLC_IDS } from '../shared/dlc.js';

const SKIP = new Set(['assets', 'descRaw', 'chessId', 'baseId', 'goldenId', 'identifier']);
const BOND_MEMBERSHIP = Object.freeze(['members', 'visibleMembers']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (value, key) => value && Object.hasOwn(value, key);
const withoutBondMembership = (bond) => Object.fromEntries(Object.entries(bond || {})
  .filter(([key]) => !BOND_MEMBERSHIP.includes(key)));

export function changedFields(before, after, prefix = '') {
  if (same(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object'
    && !Array.isArray(before) && !Array.isArray(after)) {
    const out = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (SKIP.has(key)) continue;
      out.push(...changedFields(own(before, key) ? before[key] : undefined,
        own(after, key) ? after[key] : undefined, prefix ? `${prefix}.${key}` : key));
    }
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after) && prefix !== 'bonds' && prefix !== 'garrisonIds') {
    const out = [];
    for (let index = 0; index < Math.max(before.length, after.length); index++)
      out.push(...changedFields(before[index], after[index], `${prefix}.${index + 1}`));
    return out;
  }
  return [{ path: prefix, before: before ?? null, after: after ?? null }];
}

export function buildDlcPreview(official, loadedPacks, kitOwners = new Map()) {
  const packs = Array.isArray(loadedPacks) ? loadedPacks : [];
  const basePacks = packs.filter((pack) => !DLC_IDS.has(pack.id));
  const base = applyWorkshop(official, basePacks).data;
  const byChess = {};
  const available = [];
  for (const definition of DLC_PACKS) {
    if (definition.id === 'side-story') continue;
    const selected = packs.find((pack) => pack.id === definition.id);
    const dependencies = (definition.requires || []).map((id) => packs.find((pack) => pack.id === id));
    if (!selected || dependencies.some((pack) => !pack)) continue;
    available.push(definition.id);
    const variant = applyWorkshop(official, [...basePacks, ...dependencies, selected]).data;
    for (const [id, rec] of Object.entries(variant.chess || {})) {
      const original = base.chess?.[id] || null;
      const fields = original ? changedFields(original, rec) : [];
      const kit = kitOwners.get(id) === definition.id || kitOwners.get(rec.charId) === definition.id;
      if (original && !fields.length && !kit) continue;
      (byChess[id] ||= []).push({ pack: definition.id, added: !original, kit, fields });
    }
    // A pack may change an existing bond without touching its members' chess records. Rule/effect changes belong beside
    // every member. A members-list-only override belongs beside the operators whose membership actually changed; adding
    // one new member must not badge every existing member as belonging to that DLC (for example ordinary Angelina remains
    // a Siracusa operator when Rim Billiton adds Angelina the Desireful to the same Siracusa bond).
    for (const [bondId, bond] of Object.entries(variant.bonds || {})) {
      const originalBond = base.bonds?.[bondId];
      if (!originalBond) continue;
      const ruleFields = changedFields(withoutBondMembership(originalBond), withoutBondMembership(bond)).map((field) => ({
        ...field, bondId, path: field.path,
      }));
      const affected = new Set([...BOND_MEMBERSHIP.flatMap((key) => [
        ...(Array.isArray(originalBond[key]) ? originalBond[key] : []),
        ...(Array.isArray(bond[key]) ? bond[key] : []),
      ])]);
      if (ruleFields.length) {
        for (const [id, rec] of Object.entries(variant.chess || {}))
          if (rec?.bonds?.includes(bondId) || base.chess?.[id]?.bonds?.includes(bondId)) affected.add(id);
      }
      for (const id of affected) {
        if (!variant.chess?.[id] && !base.chess?.[id]) continue;
        const fields = [...ruleFields];
        for (const key of BOND_MEMBERSHIP) {
          const before = Array.isArray(originalBond[key]) && originalBond[key].includes(id);
          const after = Array.isArray(bond[key]) && bond[key].includes(id);
          if (before !== after) fields.push({ bondId, path: key, before, after });
        }
        if (!fields.length) continue;
        const entries = (byChess[id] ||= []);
        const entry = entries.find((item) => item.pack === definition.id);
        if (entry) entry.fields.push(...fields);
        else entries.push({ pack: definition.id, added: false, kit: false, fields: [...fields] });
      }
    }
  }
  return { available, byChess };
}
