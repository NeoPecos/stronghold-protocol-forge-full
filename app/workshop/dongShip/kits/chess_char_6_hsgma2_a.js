// chess_char_6_hsgma2_a.js —— 斩业星熊（普通版；精锐版共用）
// 内联官方 op-hsgma2.js + detmath + body + damage.hasHp
import { num, talentBb, traitBb, skillRec, up, byEnemyAttack } from '@kit/tier1.js';
import { canTargetEnemy } from '@sim/targeting.js';
import { COLS } from '@sim/constants.js';

// ---- 内联：官方 detmath.js ----
// server/sim/detmath.js — engine-independent math for the sim. Every function here gives the same bits on every
// conforming JavaScript engine.
//
// ECMA-262 lets Math.hypot, sin, cos, atan2, pow (and **) return "implementation-approximated" values, and the engines
// differ in the last bits: V8's hypot is not the one of SpiderMonkey (fdlibm) or JavaScriptCore (sqrt(x*x + y*y));
// Chrome 154's sin / cos / atan2 are correctly rounded while Node 24–26's are fdlibm's; JavaScriptCore computes an
// integer power by repeated squaring. + − × ÷ and Math.sqrt are correctly rounded IEEE 754 operations, and the language
// fuses nothing (no FMA, no extended precision), so code built only from them is reproducible bit for bit. That is
// what these functions are. The sim must not call the approximated Math functions (eslint.config.js, and
// test/sim/detmath.test.js scans server/sim/).
//
//   hypot(x, y)         √(x² + y²) as Math.sqrt(x*x + y*y), rescaled by exact powers of two outside 2^±500
//   powi(x, n)          xⁿ for an integer n: square-and-multiply in double-double, one final rounding
//   sin(x), cos(x)      fdlibm 5.3 (__kernel_sin / __kernel_cos / __ieee754_rem_pio2)
//   atan2(y, x)         fdlibm (FreeBSD msun e_atan2.c / s_atan.c)
//
// sin / cos / atan2 are the algorithms V8 runs in Node, so they return what the server always computed (its golden
// digests stay); hypot and powi are at least as accurate as V8's. ±∞ / NaN arguments take the exactly specified
// results of the Math functions.

const F64 = new Float64Array(1);
const I32 = new Int32Array(F64.buffer);
const HW = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0; // index of the high word
const LW = 1 - HW;
/** @param {number} x */
const hi = (x) => { F64[0] = x; return I32[HW]; };
/** @param {number} x */
const lo = (x) => { F64[0] = x; return I32[LW] >>> 0; };
/** @param {number} h @param {number} l */
const fromWords = (h, l) => { I32[HW] = h; I32[LW] = l; return F64[0]; };
/** exact 2^e for a normal e @param {number} e */
const pow2 = (e) => fromWords((e + 1023) << 20, 0);
const P500 = pow2(500), PM500 = pow2(-500), P600 = pow2(600), PM600 = pow2(-600);

/**
 * √(x² + y²).
 * @param {number} x
 * @param {number} y
 */
function hypot(x, y) {
  // eslint-disable-next-line no-restricted-properties -- ±∞ / NaN only: those results are exact by the spec
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.hypot(x, y);
  const m = Math.max(Math.abs(x), Math.abs(y));
  if (m > P500) { const a = x * PM600, b = y * PM600; return Math.sqrt(a * a + b * b) * P600; }
  if (m < PM500 && m !== 0) { const a = x * P600, b = y * P600; return Math.sqrt(a * a + b * b) * PM600; }
  return Math.sqrt(x * x + y * y);
}

// ---- integer powers ----------------------------------------------------------------------------------------------

const SPLIT = 134217729; // 2^27 + 1 (Dekker)
const ACC = [0, 0];
const BASE = [0, 0];
/** (ah + al)·(bh + bl) in double-double, into out (TwoProduct by Dekker's split: no FMA) */
function mul2(ah, al, bh, bl, out) {
  const p = ah * bh;
  let t = SPLIT * ah;
  const ahh = t - (t - ah), ahl = ah - ahh;
  t = SPLIT * bh;
  const bhh = t - (t - bh), bhl = bh - bhh;
  const e = ((ahh * bhh - p) + ahh * bhl + ahl * bhh) + ahl * bhl + (ah * bl + al * bh);
  const s = p + e;
  out[0] = s;
  out[1] = e - (s - p);
}

/**
 * xⁿ for an integer n (the sim's powers are stack counts, chain bounces …). The square-and-multiply runs in
 * double-double and rounds once, so the result is correctly rounded in practice; a non-integer exponent or a huge
 * base falls back to Math.pow.
 * @param {number} x
 * @param {number} n
 */
function powi(x, n) {
  // eslint-disable-next-line no-restricted-properties -- outside the integer domain only (never in the sim)
  if (!Number.isInteger(n) || !Number.isFinite(x) || Math.abs(x) > P500) return Math.pow(x, n);
  if (n < 0) return 1 / powi(x, -n);
  ACC[0] = 1; ACC[1] = 0; BASE[0] = x; BASE[1] = 0;
  let k = n;
  while (k > 0) {
    if (k % 2 === 1) mul2(ACC[0], ACC[1], BASE[0], BASE[1], ACC);
    k = Math.floor(k / 2);
    if (k > 0) mul2(BASE[0], BASE[1], BASE[0], BASE[1], BASE);
  }
  return ACC[0] + ACC[1];
}

// ---- sin / cos (fdlibm 5.3) --------------------------------------------------------------------------------------

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
/** sin on [-π/4, π/4]; y is the tail of x, iy = 0 when y is 0 */
function kSin(x, y, iy) {
  if ((hi(x) & 0x7fffffff) < 0x3e400000 && Math.trunc(x) === 0) return x;
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
/** cos on [-π/4, π/4]; y is the tail of x */
function kCos(x, y) {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  return (1 - qx) - ((0.5 * z - qx) - (z * r - x * y));
}

const NPIO2_HW = [
  0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A,
  0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A,
  0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
  0x404858EB, 0x404921FB,
];
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const TWO_PI = 6.283185307179586;
const Y = [0, 0];

/** x − n·π/2 into Y (head, tail); returns n. |x| ≤ 2^19·π/2: fdlibm's medium path; beyond that (never in the sim)
 * x is first taken modulo the double nearest 2π (exact %), which stays deterministic though not accurate. */
function remPio2(x0) {
  let x = x0;
  if ((hi(x) & 0x7fffffff) > 0x413921fb) x = x % TWO_PI;
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) { Y[0] = x; Y[1] = 0; return 0; }
  if (ix < 0x4002d97c) { // |x| < 3π/4: n = ±1
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) { Y[0] = z - PIO2_1T; Y[1] = (z - Y[0]) - PIO2_1T; } else { z -= PIO2_2; Y[0] = z - PIO2_2T; Y[1] = (z - Y[0]) - PIO2_2T; }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) { Y[0] = z + PIO2_1T; Y[1] = (z - Y[0]) + PIO2_1T; } else { z += PIO2_2; Y[0] = z + PIO2_2T; Y[1] = (z - Y[0]) + PIO2_2T; }
    return -1;
  }
  let t = Math.abs(x);
  const n = Math.trunc(t * INV_PIO2 + 0.5);
  let r = t - n * PIO2_1, w = n * PIO2_1T;
  Y[0] = r - w;
  if (!(n < 32 && ix !== NPIO2_HW[n - 1])) {
    const j = ix >> 20;
    if (j - ((hi(Y[0]) >> 20) & 0x7ff) > 16) { // a 2nd step, good to 118 bits
      t = r; w = n * PIO2_2; r = t - w; w = n * PIO2_2T - ((t - r) - w); Y[0] = r - w;
      if (j - ((hi(Y[0]) >> 20) & 0x7ff) > 49) { // a 3rd, 151 bits
        t = r; w = n * PIO2_3; r = t - w; w = n * PIO2_3T - ((t - r) - w); Y[0] = r - w;
      }
    }
  }
  Y[1] = (r - Y[0]) - w;
  if (hx < 0) { Y[0] = -Y[0]; Y[1] = -Y[1]; return -n; }
  return n;
}

/** @param {number} x radians */
function sin(x) {
  if (!Number.isFinite(x)) return NaN;
  if ((hi(x) & 0x7fffffff) <= 0x3fe921fb) return kSin(x, 0, 0);
  switch (remPio2(x) & 3) {
    case 0: return kSin(Y[0], Y[1], 1);
    case 1: return kCos(Y[0], Y[1]);
    case 2: return -kSin(Y[0], Y[1], 1);
    default: return -kCos(Y[0], Y[1]);
  }
}

/** @param {number} x radians */
function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  if ((hi(x) & 0x7fffffff) <= 0x3fe921fb) return kCos(x, 0);
  switch (remPio2(x) & 3) {
    case 0: return kCos(Y[0], Y[1]);
    case 1: return -kSin(Y[0], Y[1], 1);
    case 2: return -kCos(Y[0], Y[1]);
    default: return kSin(Y[0], Y[1], 1);
  }
}

// ---- atan2 (fdlibm, FreeBSD msun) --------------------------------------------------------------------------------

const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];
/** @param {number} x0 */
function atan(x0) {
  let x = x0;
  const hx = hi(x), ix = hx & 0x7fffffff;
  let id;
  if (ix >= 0x44100000) { // |x| ≥ 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lo(x) !== 0)) return x + x;
    return hx > 0 ? ATAN_HI[3] + ATAN_LO[3] : -ATAN_HI[3] - ATAN_LO[3];
  }
  if (ix < 0x3fdc0000) { // |x| < 0.4375
    if (ix < 0x3e200000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); }
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATAN_HI[id] - ((x * (s1 + s2) - ATAN_LO[id]) - x);
  return hx < 0 ? -r : r;
}

const PI_O_4 = 7.8539816339744827900E-01, PI_O_2 = 1.5707963267948965580E+00, PI = 3.1415926535897931160E+00;
const PI_LO = 1.2246467991473532e-16;
/**
 * The angle of (x, y), in (−π, π].
 * @param {number} y
 * @param {number} x
 */
function atan2(y, x) {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  const hx = hi(x), ix = hx & 0x7fffffff, lx = lo(x);
  const hy = hi(y), iy = hy & 0x7fffffff, ly = lo(y);
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y); // x = 1
  let m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2); // 2·sign(x) + sign(y)
  if ((iy | ly) === 0) return m === 2 ? PI : m === 3 ? -PI : y; // y = ±0
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 : PI_O_2; // x = ±0
  if (ix === 0x7ff00000) { // x = ±∞
    if (iy === 0x7ff00000) return [PI_O_4, -PI_O_4, 3 * PI_O_4, -3 * PI_O_4][m];
    return [0, -0, PI, -PI][m];
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2; // y = ±∞
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) { z = PI_O_2 + 0.5 * PI_LO; m &= 1; } // |y/x| > 2^60
  else if (hx < 0 && k < -60) z = 0; // |y|/x < −2^60
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}


// ---- 内联：官方 body.js ----
// server/sim/body.js — where a unit can be hit: the ONE helper behind every range test that targets enemies (user
// playtest #5 item 10: "大体型的关底boss实际受击判定范围很小…原版是很大的一片区域").
//
// Regular units are a point: in a grid range when the tile containing their position (round(y), round(x)) is a range
// tile, in a radius when their position is (DESIGN §3). Huge units (巨型单位 — enemy data `hitArea`, tools/build-data.mjs
// HIT_AREAS, from PRTS "巨型单位：受击判定区域为长4.95、宽2.95的长方形，向上偏移1.0") are hit anywhere on a rectangle
// `w` tiles along the columns × `h` along the rows, centred on their position moved `dx` columns right and `dy` rows
// up:
//   * grid ranges / tile rules: the unit occupies every tile its rectangle overlaps (PRTS 作战机制 "巨型BOSS单位的每一个
//     占据的格子都可以让其本身通过格子判定"; an operator's range — 1×1 tile squares — touches the rectangle exactly then):
//     a 4.95 × 2.95 area centred on a tile covers that 5 × 3 block;
//   * radius rules (auras, AoE around a point or a unit): the distance from the point to the rectangle (0 inside it)
//     [ASSUMED: PRTS 作战机制 calls collider tests "the most common"];
//   * splash around a struck / marked target is a 中点判定 (PRTS 作战机制: "中点判定…案例：阻挡，酒神1天赋的1.3溅射半径"):
//     every enemy, a huge one too, counts by its position (Battle.enemiesInRadius(x, y, r, true) — the engine's
//     profession splash and aftershocks, and the kits' splash centred on an enemy).
// The unit's own position stays its 判定中心: projectiles fly to it, its own attacks and radii measure from it, and it
// is the centre of splash on it (PRTS 分支特性信息: 投掷物会抵达目标的判定中心…巨型单位的模型中心具有一定偏移). Body size
// plays no part in blocking or movement — every huge unit here is 自缚 + 无法被阻挡 (PRTS 天赋; content/bosses.js
// SELF_BOUND: persistent noMove + unblockable from spawn). Also by position: movement, pathing and terrain on the
// enemy's tile, tile-entry tracking (雪境 tiles), placement heuristics and distance-scaled numbers, and the range keys
// taken from blocked enemies (a huge unit is never blocked).
// Pure functions of (x, y, hitArea); no battle state — also used for the client's picking (render/pick.js mirrors
// `hitRect`).



/**
 * Validated hit area of a data record (`{ w, h, dx, dy }`, tiles) or null for a regular (point) unit.
 * @param {any} a
 */
function normHitArea(a) {
  if (!a || typeof a !== 'object') return null;
  const w = Number(a.w), h = Number(a.h), dx = Number(a.dx ?? 0), dy = Number(a.dy ?? 0);
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return Object.freeze({ w, h, dx, dy });
}

/** The world rectangle `{ x0, x1, y0, y1 }` of a huge unit, or null for a point unit (no `hitArea`). */
function hitRect(u) {
  const a = u && u.hitArea;
  if (!a) return null;
  const cx = u.x + a.dx, cy = u.y + a.dy;
  return { x0: cx - a.w / 2, x1: cx + a.w / 2, y0: cy - a.h / 2, y1: cy + a.h / 2 };
}

/** Tile key of a unit's position (-1 off the grid). */
function posKey(u) {
  const r = Math.round(u.y), c = Math.round(u.x);
  return r < 0 || r >= ROWS || c < 0 || c >= COLS ? -1 : r * COLS + c;
}

/**
 * Tile keys (row × COLS + col) the unit occupies: a point unit the tile of its position ([] off the grid), a huge unit
 * every tile its rectangle overlaps (open intervals: a tile only touched along an edge is not overlapped).
 */
function bodyKeys(u) {
  const R = hitRect(u);
  if (!R) { const k = posKey(u); return k < 0 ? [] : [k]; }
  const out = [];
  const r0 = Math.max(0, Math.floor(R.y0 + 0.5 + 1e-9)), r1 = Math.min(ROWS - 1, Math.ceil(R.y1 - 0.5 - 1e-9));
  const c0 = Math.max(0, Math.floor(R.x0 + 0.5 + 1e-9)), c1 = Math.min(COLS - 1, Math.ceil(R.x1 - 0.5 - 1e-9));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * COLS + c);
  return out;
}

/** Does the unit occupy tile (r, c)? */
function bodyOnTile(u, r, c) {
  const R = hitRect(u);
  if (!R) return Math.round(u.y) === r && Math.round(u.x) === c;
  return c + 0.5 > R.x0 + 1e-9 && c - 0.5 < R.x1 - 1e-9 && r + 0.5 > R.y0 + 1e-9 && r - 0.5 < R.y1 - 1e-9;
}

/** Does the unit occupy any tile of `keys` (tile keys: a Set / Map — anything with `has` — or an array)? */
function bodyInKeys(u, keys) {
  if (!u || !keys) return false;
  const has = typeof keys.has === 'function' ? (k) => keys.has(k) : (k) => keys.includes(k);
  if (!u.hitArea) { const k = posKey(u); return k >= 0 && has(k); }
  for (const k of bodyKeys(u)) if (has(k)) return true;
  return false;
}

/** Distance (tiles) from point (x, y) to the unit's body: its position, or its rectangle (0 inside). */
function bodyDist(u, x, y) {
  const R = hitRect(u);
  if (!R) return hypot(u.x - x, u.y - y);
  const dx = x < R.x0 ? R.x0 - x : x > R.x1 ? x - R.x1 : 0;
  const dy = y < R.y0 ? R.y0 - y : y > R.y1 ? y - R.y1 : 0;
  return hypot(dx, dy);
}

/** Is the unit's body within `r` tiles of point (x, y)? (the same ≤ r + 1e-9 test as Battle.enemiesInRadius) */
function bodyInRadius(u, x, y, r) {
  return bodyDist(u, x, y) <= r + 1e-9;
}

/**
 * Chebyshev reach in tiles from tile (r, c) to the unit's body (0 = it occupies that tile; 1 = one of the 8 tiles
 * around it; …): "周围八格"-style square areas centred on a tile.
 */
function bodyTileReach(u, r, c) {
  if (!u.hitArea) return Math.max(Math.abs(Math.round(u.y) - r), Math.abs(Math.round(u.x) - c));
  let best = Infinity;
  for (const k of bodyKeys(u)) {
    const kr = Math.floor(k / COLS), kc = k % COLS;
    const d = Math.max(Math.abs(kr - r), Math.abs(kc - c));
    if (d < best) best = d;
  }
  return best;
}


// ---- 内联：官方 damage.js 的 hasHp（618 行里只要这一个）----
function hasHp(u) {
  return !!u && u.alive && (u.bossPool ? u.bossPool.hp > 0 : u.hp > 0);
}

// ---- 内联：官方 op-hsgma2.js ----
const __hsgma2 = (() => {
// server/sim/content/kits/ops/op-hsgma2.js — 斩业星熊 (char_1044_hsgma2) 自选 operator kit: 6★ 驭法铁卫 (重装), an owned-6★
// pick of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and her module at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1044_hsgma2, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, AST-X at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), gamedata_const
// ba.berserk 坚忍 ("根据已损失的生命值获得相应比例的属性加成，损失一定比例时达最大加成") and ba.sluggish 停顿, PRTS 斩业星熊 (业火 备注:
// 负生命值 — "期间持有禁疗，一切生命值变动将先计入负生命值来抵消/增加负生命值…只有负生命值达到上限时才会被正常击倒…负生命值与真实生命值
// 无关", "生命恢复的提供方式为增加自身的“生命回复速度（百分比）”属性，不受治疗加成和禁疗影响", "需成功受到伤害，生命恢复效果才会失效并
// 重新计时"; S1 备注 "反伤效果会直接选中伤害来源，但仅对阵营为敌方的来源造成伤害"; S2 备注 "治疗效果无视自身的禁疗，计算治疗量时以目标
// 受伤前后的生命值差的绝对值为准", "投出的盾牌以自身前方1.2格为起点，逆时针旋转365°，角速度90°/s，碰撞半径1.0，碰撞范围内存在可选目标时
// 速度-80%", "技能持续至盾牌旋转365°并收回时结束"; S3 备注 "技能期间攻击可对空", 临死模式 — 阻回 / 沉默 / 不死, allies' 不死 and the
// lethal excess as her 流失, the forced exit, "若携带X模组，则X模组的“造成额外伤害”效果依然生效"; AST-X 备注 — the extra damage's
// conditions "①此为普通攻击或普通攻击附带的伤害；②伤害来源于斩业星熊自身；③不为本模组特性的伤害…伤害为法术附加伤害", "仅对敌方
// 单位反弹伤害，伤害为法术普通伤害"), PRTS 卫戍协议/帮助 技能策略 (her S3 row "于技能持续时间过半后…关闭技能（进入其技能效果的
// 临死模式）" added in 上半, REMOVED with 下半; "通常不会自动关闭技能").
// - Trait (驭法铁卫) "技能开启时普通攻击会造成法术伤害": physical attacks while no skill runs (the kit's trait dmgType — the
//   data's 'phys' too since 0.2.0 WE2 — build-data classifyAttack) and arts while one runs (every skill's attack override); block 3, ground-only
//   melee on her 1-1. Module AST-X 无迹 adds "且攻击和受到攻击时对目标额外造成10％攻击力的法术伤害" (trait bb atk_scale): every
//   damage instance of her normal attacks (skill attacks included; not the shield, a counter or the module's own damage)
//   is followed by atk_scale × ATK arts on that enemy (附加伤害: no dodge), and every enemy damage instance she takes
//   returns atk_scale × ATK arts (普通伤害) to its source (tier1 byEnemyAttack) — whether a skill runs or not [ASSUMED: PRTS's list of the checked
//   conditions names no skill period].
// - T1 业火 "生命降至0时进入“我执”…": a lethal damage instance leaves her on the field in 我执 instead (the damage past her
//   HP opens the negative pool — the engine keeps her at its 1-HP floor for the official 0); in 我执 every later damage
//   instance goes to the pool (no HP loss; it still counts as damage taken: 受击回复 SP, counters) until the pool would
//   reach max_minus_hp_ratio × max HP — that blow knocks her out as usual (unless a 不死 holds her); she holds 禁疗 (flags
//   noHeal + healFree, the status 'healFree'); after [heal].interval s without a damage instance landing she gets the
//   生命回复速度（百分比） attribute [heal].hp_recovery_per_sec_by_max_hp_ratio (an hpRegenRatio buff — not 治疗: 禁疗 does
//   not stop it, no 治疗加成 scales it); whatever raises her HP above the floor (that regeneration, S2's heal that ignores
//   禁疗) clears the pool first, and she leaves 我执 once it is empty. A 流失 that reaches 0 counts whole into the pool
//   [ASSUMED: the engine reports no HP before a loss].
// - T2 鬼之架势 "在场时，自身获得最高+50法术抗性和35%攻击力的坚忍（损失70%生命值时达到最大加成）": RES +min_magic_resistance and ATK
//   +min_atk scaled linearly by the HP lost from max_hp_ratio down to min_hp_ratio (坚忍), re-read every tick; in 我执 at
//   its maximum. AST-X stage 3: the maximum at 50 % lost (min_hp_ratio 0.5) and "达到最大加成时，攻击力额外+15％" (atk).
// - S1 恶业苦果 (AUTO, 受击回复 SP, 持续时间无限 — a toggle): ATK +atk, DEF +def, arts attacks; every enemy damage instance
//   she takes deals atk_scale × ATK arts to its source (a direct pick of the damage source, enemies only). A self buff: the owner's
//   AUTO rule fires it as soon as its SP is full (`trigger: 'SP_FULL'`, as 引星棘刺 S1 — kits/README.md checklist 5).
// - S2 无始无明 (AUTO, attack SP; data DEFAULT): the cast replaces the attack about to be made — the shield throw, three hits
//   of attack@atk_scale × ATK arts on every enemy she blocks (none blocked: her target [ASSUMED]); then the shield circles
//   her: from 1.2 tiles ahead, counter-clockwise 365° at 90°/s, ×0.2 while a targetable ground enemy [ASSUMED: no 对空
//   note, unlike S3] is within 1.0 of it; every `interval` s from the throw [ASSUMED] each such enemy takes 停顿 `sluggish`
//   s and shield_atk_scale × ATK arts, and she heals heal_ratio × the HP it lost (ignoring her 禁疗). The skill runs until
//   the turn is done (its return taken as instant [ASSUMED]): no SP meanwhile, and her normal attacks of the flight are arts.
// - S3 地狱变相 (MANUAL; data ACTIVE_RANGE on the running x-2 — the owner's rule over the 重装 exception, rawRule
//   TAKE_DAMAGE): `duration` s — range x-2, max HP +max_hp, ATK +atk, two hits on up to attack@max_target enemies, air units
//   too (PRTS 备注), arts. 主动关闭 (a close: `skill.end('manual')`) starts the 临死模式 for before_dead_duration s: the
//   skill's bonuses and range stay, four hits, 阻回 + 沉默, 不死 (her negative pool never knocks her out); every other allied
//   operator on her range holds 不死 and the part of a damage instance past its HP becomes her 流失 (a 流失 it takes is not
//   passed on); then she leaves the field (a retreat with the death animation, as 史尔特尔's 余烬; the official partial DP
//   refund of a withdrawal is not modelled — no retreat in the sim refunds DP). No strategy of this mode closes it: PRTS
//   帮助 lists the 上半 row that did as removed in 下半, so in a fight the skill simply runs its `duration`.







const S1 = 'skchr_hsgma2_1';
const S2 = 'skchr_hsgma2_2';
const S3 = 'skchr_hsgma2_3';
/** S2's shield (PRTS 备注): start 1.2 tiles ahead, 365° counter-clockwise at 90°/s, collision radius 1.0, −80 % near a target. */
const SHIELD_START = 1.2;
const SHIELD_TURN = 365;
const SHIELD_SPEED = 90;
const SHIELD_RADIUS = 1.0;
const SHIELD_SLOW = 0.8;
/** An engine cap on S2's run (the shield's turn ends it long before: 365° at 18°/s takes 20.3 s). */
const S2_CAP = 60;
/** S3's x-2 when the data carries no grid. */
const X2 = Object.freeze([[2, -1], [2, 0], [2, 1], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [0, -2], [0, -1], [0, 0], [0, 1],
  [0, 2], [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2], [-2, -1], [-2, 0], [-2, 1]]);
const GROUND = Object.freeze({ canHitFly: false });
const EGO = 'talent:hsgma2:ego';
const EGO_REGEN = 'talent:hsgma2:egoRegen';
const BERSERK = 'talent:hsgma2:berserk';
const DYING = 'skill:hsgma2:dying';
const ASTX = 'hsgma2:astx';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isFinite(v) && v !== 0));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const __default = {
  char_1044_hsgma2: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const throwParts = { hits: 3, atkScale: num(b2['attack@atk_scale'], 1), hitAllBlocked: true };
    // this unit's attack overrides (the kit is built per unit): S2's throw turns into plain arts attacks after it lands,
    // S3's two hits become four in the 临死模式
    const s2Attack = { dmgType: 'arts' };
    const s3Attack = { dmgType: 'arts', hits: 2 };
    const plainS2 = () => { delete s2Attack.hits; delete s2Attack.atkScale; delete s2Attack.hitAllBlocked; };

    /** S2: the shield's centre after `turned` degrees (row 0 is the bottom row: counter-clockwise = a growing angle). */
    const shieldAt = (unit, sh) => {
      const a = sh.a0 + (sh.turned * Math.PI) / 180;
      return { x: unit.x + SHIELD_START * cos(a), y: unit.y + SHIELD_START * sin(a) };
    };
    const touching = (battle, unit, p) => battle.enemies.filter((e) => canTargetEnemy(unit, e, GROUND) && bodyInRadius(e, p.x, p.y, SHIELD_RADIUS));
    /** S2: one shield pulse — 停顿, the arts hit, and her heal of heal_ratio × the HP it removed (ignoring her 禁疗). */
    const shieldPulse = (battle, unit, p) => {
      for (const e of touching(battle, unit, p)) {
        battle.applyStatus(e, 'sluggish', { duration: num(b2.sluggish, 1), source: unit });
        if (!e.alive) continue;
        const dealt = battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.shield_atk_scale), type: 'arts', isSkill: true, tags: ['skill', 'hsgma2:shield'] });
        if (dealt > 0 && unit.alive) battle.heal(unit, unit, dealt * num(b2.heal_ratio), { self: true, ignoreHealFree: true });
        battle.fx('strike', { x: p.x, y: p.y, id: unit.id, skill: 'hsgma2:shield' });
      }
    };

    return {
      trait: { dmgType: 'phys' },
      skills: {
        [S1]: {
          kind: 'toggle', trigger: { rule: 'SP_FULL' },
          mods: nz({ atkPct: num(b1.atk), defPct: num(b1.def) }),
          attack: { dmgType: 'arts' },
        },
        [S2]: {
          kind: 'duration', duration: S2_CAP,
          attack: s2Attack,
          onStart({ unit }) { Object.assign(s2Attack, throwParts); unit.mem.hsShield = null; },
          onAttack({ battle, unit }) {
            if (!('hits' in s2Attack)) return;
            plainS2(); // the throw was this attack: the shield flies from now on
            const [fr, fc] = unit.fwd;
            unit.mem.hsShield = { a0: atan2(fr, fc), turned: 0, acc: 0 };
            battle.fx('zone', { x: unit.x, y: unit.y, radius: SHIELD_START + SHIELD_RADIUS, dur: SHIELD_TURN / SHIELD_SPEED, id: unit.id, skill: 'hsgma2:shield' });
            shieldPulse(battle, unit, shieldAt(unit, unit.mem.hsShield));
          },
          onTick({ battle, unit, skill, dt }) {
            const sh = unit.mem.hsShield;
            if (!sh) return;
            const iv = Math.max(0.05, num(b2.interval, 0.5));
            sh.acc += dt;
            while (sh.acc + 1e-9 >= iv && unit.mem.hsShield === sh) { sh.acc -= iv; shieldPulse(battle, unit, shieldAt(unit, sh)); }
            if (unit.mem.hsShield !== sh) return;
            const slowed = touching(battle, unit, shieldAt(unit, sh)).length > 0;
            sh.turned += SHIELD_SPEED * (slowed ? 1 - SHIELD_SLOW : 1) * dt;
            if (sh.turned >= SHIELD_TURN - 1e-9) skill.end('shield');
          },
          onEnd({ unit }) { unit.mem.hsShield = null; plainS2(); },
        },
        [S3]: {
          kind: 'duration',
          mods: nz({ hpPct: num(b3.max_hp), atkPct: num(b3.atk) }),
          targeting: { rangeGrid: skillRec(chess, S3)?.rangeGrid ?? X2, maxTargets: Math.max(1, Math.floor(num(b3['attack@max_target'], 1))), canHitFly: true },
          attack: s3Attack,
          onStart({ unit }) { s3Attack.hits = 2; unit.mem.hsDying = null; },
          onEnd({ battle, unit, skill, reason }) {
            const dying = unit.mem.hsDying;
            if (!dying && reason === 'manual' && unit.alive && unit.deployed) {
              // 主动关闭 ⇒ 临死模式: the skill keeps running (its bonuses, range and override stay; no skillStart — it is
              // no new cast) for before_dead_duration s with four hits, 阻回 + 沉默, and 不死 (the fatal hooks below)
              const dur = num(b3.before_dead_duration, 11);
              unit.mem.hsDying = { seq: unit.deploySeq };
              s3Attack.hits = 4;
              skill.active = true;
              skill.timeLeft = dur;
              battle.addBuff(unit, { key: DYING, duration: dur, flags: { noSp: true, silence: true }, visible: true, tags: ['skill'] });
              battle.fx('undying', { x: unit.x, y: unit.y, id: unit.id });
              return;
            }
            if (!dying) return;
            unit.mem.hsDying = null;
            s3Attack.hits = 2;
            battle.removeBuff(unit, DYING);
            // "11秒后强制退出战场" (视为撤回干员)
            if (reason === 'duration' && unit.alive && unit.deployed) battle.retreat(unit, { reason: 'retreat', dying: true });
          },
        },
      },
      talents: [
        { install(battle, unit) { // 业火: 我执 — the negative pool, 禁疗, the quiet-time regeneration
          const capOf = () => num(t0.max_minus_hp_ratio, 2) * unit.s.maxHp;
          const quiet = num(t0['hsgma2_t_1[heal].interval'], 5);
          const regen = num(t0['hsgma2_t_1[heal].hp_recovery_per_sec_by_max_hp_ratio']);
          // the pool as a share of its cap, read when a snapshot is taken (b.snap `neg`, snapshot.js negView): the green HP bar
          // sits on the 1-HP floor in 我执, so the client draws the pool as the red bar — display only
          unit.negFill = () => (unit.mem.hsEgo && unit.mem.hsEgo.pool > 0 ? unit.mem.hsEgo.pool / Math.max(1e-9, capOf()) : 0);
          const enter = (pool) => {
            unit.mem.hsEgo = { pool: Math.max(0, pool), lastHurt: battle.time };
            battle.addBuff(unit, { key: EGO, status: 'healFree', flags: { noHeal: true, healFree: true }, tags: ['talent'] });
            battle.fx('undying', { x: unit.x, y: unit.y, id: unit.id, talent: 'hsgma2:ego' });
          };
          const leave = () => {
            unit.mem.hsEgo = null;
            battle.removeBuff(unit, EGO);
            battle.removeBuff(unit, EGO_REGEN);
          };
          battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.hsOverflow = false; leave(); } }, { owner: unit });
          // a damage instance (after the shields): into the pool while in 我执, or the lethal one opens it
          battle.on('hpDamage', (c) => {
            if (c.target !== unit || !unit.alive) return;
            const ego = unit.mem.hsEgo;
            if (ego) {
              ego.lastHurt = battle.time;
              if (ego.pool + c.amount < capOf()) { ego.pool += c.amount; c.amount = 0; } else unit.mem.hsOverflow = true;
              return;
            }
            if (c.amount < unit.hp) return;
            const over = c.amount - unit.hp;
            if (over < capOf()) { c.amount = Math.max(0, unit.hp - 1); enter(over); } else unit.mem.hsOverflow = true;
          }, { owner: unit, priority: -50 });
          // HP reaching 0 anyway: the 临死模式's 不死 holds her; a full pool knocks her out; a 流失 goes to the pool
          battle.on('fatal', (c) => {
            if (c.unit !== unit || c.prevented) return;
            const overflow = !!unit.mem.hsOverflow;
            unit.mem.hsOverflow = false;
            const ego = unit.mem.hsEgo;
            if (unit.mem.hsDying) {
              c.prevented = true;
              if (ego) ego.pool = Math.min(capOf(), ego.pool + c.amount); else enter(Math.min(capOf(), c.amount));
              return;
            }
            if (overflow) return;
            const pool = (ego ? ego.pool : 0) + c.amount;
            if (pool >= capOf()) return;
            c.prevented = true;
            if (ego) ego.pool = pool; else enter(pool);
          }, { owner: unit, priority: -40 });
          battle.on('tick', () => {
            unit.mem.hsOverflow = false;
            const ego = unit.mem.hsEgo;
            if (!ego) return;
            if (!up(unit)) { leave(); return; }
            // HP above the 1-HP floor (her regeneration, a heal that ignores 禁疗) clears the pool first
            const surplus = unit.hp - 1;
            if (surplus > 0 && ego.pool > 0) { const take = Math.min(surplus, ego.pool); ego.pool -= take; unit.hp -= take; }
            if (!(ego.pool > 1e-9)) { leave(); return; }
            const want = regen > 0 && battle.time - ego.lastHurt >= quiet - 1e-9;
            const has = !!unit.findBuff(EGO_REGEN);
            if (want && !has) battle.addBuff(unit, { key: EGO_REGEN, mods: { hpRegenRatio: regen }, tags: ['talent'] });
            else if (!want && has) battle.removeBuff(unit, EGO_REGEN);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 鬼之架势: 坚忍 RES / ATK by the HP lost; AST-X stage 3: ATK +atk more at the maximum
          const hi = num(t1.max_hp_ratio, 1), lo = num(t1.min_hp_ratio, 0.3);
          const res0 = num(t1.max_magic_resistance), res1 = num(t1.min_magic_resistance);
          const atk0 = num(t1.max_atk), atk1 = num(t1.min_atk), extra = num(t1.atk);
          if (!(hi > lo) || !(res0 || res1 || atk0 || atk1)) return;
          battle.on('tick', () => {
            const cur = unit.findBuff(BERSERK);
            if (!up(unit)) { if (cur) battle.removeBuff(unit, BERSERK); return; }
            const f = clamp01((hi - unit.hpRatio) / (hi - lo));
            if (cur && Math.abs((cur.data?.f ?? -1) - f) < 1e-4) return;
            const mods = nz({ resFlat: res0 + (res1 - res0) * f, atkPct: atk0 + (atk1 - atk0) * f + (f >= 1 - 1e-9 ? extra : 0) });
            if (!Object.keys(mods).length) { if (cur) battle.removeBuff(unit, BERSERK); return; }
            battle.addBuff(unit, { key: BERSERK, mods, data: { f }, tags: ['talent'] });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // S1 恶业苦果: every enemy damage instance she takes (the official hsgma2_s_1 on ON_TAKE_DAMAGE, not its attacks only:
        // tier1 byEnemyAttack) ⇒ atk_scale × ATK arts back to its source
        battle.on('damaged', (c) => {
          const s = c.source;
          if (c.target !== unit || !unit.alive || unit.skill?.id !== S1 || !unit.skill.active) return;
          if (!byEnemyAttack(c) || !s.alive) return;
          battle.dealDamage(unit, s, { amount: unit.s.atk * num(b1.atk_scale), type: 'arts', canDodge: false, isSkill: true, ignoreSelect: true, tags: ['skill', 'counter'] });
          battle.fx('counter', { x: s.x, y: s.y, id: unit.id });
        }, { owner: unit });
        // AST-X 无迹: her attack damage ⇒ +atk_scale × ATK arts (附加伤害); an enemy damage instance she takes (the official
        // hsgma2_e_003_tr_take: ON_TAKE_DAMAGE from the other side) ⇒ atk_scale × ATK arts back
        const astx = num(tb.atk_scale);
        if (astx > 0) {
          battle.on('damaged', (c) => {
            const t = c.target;
            if (c.source !== unit || !c.dmg?.isAttack || c.type === 'element' || !t || t.side !== 'enemy' || !hasHp(t)) return;
            battle.dealDamage(unit, t, { amount: unit.s.atk * astx, type: 'arts', canDodge: false, tags: ['module', ASTX] });
          }, { owner: unit, priority: -20 });
          battle.on('damaged', (c) => {
            const s = c.source;
            if (c.target !== unit || !unit.alive || !byEnemyAttack(c) || !s.alive) return;
            battle.dealDamage(unit, s, { amount: unit.s.atk * astx, type: 'arts', ignoreSelect: true, tags: ['module', ASTX, 'counter'] });
          }, { owner: unit });
        }
        // S3 临死模式: every other allied operator on her range holds 不死; the part of a damage instance past its HP is her 流失
        const shelters = (t) => !!unit.mem.hsDying && up(unit) && !!t && t !== unit && t.side === 'ally' && t.kind === 'op' && t.alive
          && !!unit.rangeKeySet && unit.rangeKeySet.has(t.tileR * COLS + t.tileC);
        battle.on('hpDamage', (c) => {
          const t = c.target;
          if (!shelters(t) || c.amount < t.hp) return;
          const over = c.amount - t.hp;
          c.amount = Math.max(0, t.hp - 1);
          if (over > 0) battle.loseHp(unit, over, { source: c.credit ?? null, tags: ['skill', 'hsgma2:shoulder'] });
        }, { owner: unit, priority: -60 });
        battle.on('fatal', (c) => { if (!c.prevented && shelters(c.unit)) c.prevented = true; }, { owner: unit, priority: -40 });
      },
    };
  },
};

return __default;
})();

// ---- 本包 ----
// server/sim/content/kits/ops/chess_char_6_hsgma2-hsgma2.js — 斩业星熊 (char_1044_hsgma2) 的【常驻池棋子】委托 kit.
//
// 为什么要这个文件（与 chess_char_9_dong1-haruka.js 同理）：
//   斩业星熊本来是**自选(自选编队)干员**，她的 kit 是 ops/op-hsgma2.js，注册键是 **charId**（char_1044_hsgma2）。
//   引擎的 kitOf（sim/content/index.js:82）只在 `def.diyFor` 存在时（isDiyDef：一个被填过的自选槽位）
//   才用 charId 查 kit；否则按棋子 **baseId** 查，查不到就**回退 generic kit**，
//   那样她的三技能 / 天赋 / 特性会全部失效（遥就踩过这个坑：二技能没有治疗）。
//
//   本文件把棋子 baseId（chess_char_6_hsgma2）注册到同一个 kit 实现上，转发给 op-hsgma2.js —— **不改引擎逻辑**。


export default (bb, chess, def) => __hsgma2.char_1044_hsgma2(bb, chess, def);
