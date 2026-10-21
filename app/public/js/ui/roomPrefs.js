// 2026-10-20 a5：「记住本次选择」——建房时沿用上次在房间里选定的人数上限（浏览器本地偏好）。
// 单独成模块，lobby.js（建房）与 room.js（房间设置）共用同一组存储键。
import { loadPref, savePref } from '../store.js';
import { ROOM_CAPACITIES } from '../../../shared/constants.js';

const REMEMBER_KEY = 'room.capacityRemember';
const LAST_KEY = 'room.capacityLast';

/** 是否勾了「记住本次选择」。 */
export function remembersCapacity() {
  return loadPref(REMEMBER_KEY, false) === true;
}

/** 上次记住的人数上限；没勾选、或值已不是合法档位时返回 null。 */
export function rememberedCapacity() {
  if (!remembersCapacity()) return null;
  const n = Number(loadPref(LAST_KEY, 0));
  if (!Number.isInteger(n)) return null;
  if (!Array.isArray(ROOM_CAPACITIES)) return n >= 4 ? n : null;
  return ROOM_CAPACITIES.includes(n) ? n : null;
}

/** 勾选/取消「记住本次选择」；勾上时记下当前人数，取消时清除。 */
export function setCapacityRemember(on, n) {
  savePref(REMEMBER_KEY, on === true);
  savePref(LAST_KEY, on === true ? Number(n) || 0 : 0);
}
