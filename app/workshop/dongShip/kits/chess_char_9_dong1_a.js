// chess_char_9_dong1_a.js —— 遥（普通版；精锐版 baseId 指向它，共用同一实现）
// 内联官方 op-haruka.js + detmath —— 工坊白名单没有 @kit/ops/op-*.js，也没有 detmath。
// 为什么全塞进一个文件：包内 helper（./lib/x.js）**不能**用 @kit/ @sim/ 别名 ——
//   服务端只改写顶层 kit 文件的 specifier，helper 按真实 URL 加载、Node 没有 import map。
import { num, up, traitBb, talentBb, skillRec, batMod, giveSp, protectMods } from '@kit/tier1.js';
import { absoluteRangeKeys } from '@sim/targeting.js';
import { COLS } from '@sim/constants.js';

// ---- 内联：官方 server/sim/detmath.js（零 import 的纯函数；sin/cos/atan2 是 fdlibm 移植，自己重写会有浮点漂移）----
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


// ---- 内联：官方 op-haruka.js ----
const __haruka = (() => {
// server/sim/content/kits/ops/op-haruka.js — 遥 (char_4202_haruka) 自选 operator kit: 6★ 护佑者 (辅助), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and her module (BLS-Y 迟来的纪念) at every form. Kit
// contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4202_haruka): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7, the
// picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), PRTS 遥 (浮光泡影 备注
// "进行普通攻击判定时，若范围内存在有效目标，则在本次攻击/治疗后同时触发一次赋予浮泡行为；若无有效目标，且范围内存在可赋予
// 浮泡的单位，则本次普通攻击改为赋予浮泡…赋予浮泡时，仅选择不具有浮泡的我方单位，优先选择其中生命比例最低者…触发浮泡破碎的
// 行动节点为“成功受到伤害后”；仅来源于敌方，且造成了生命值真实降低的伤害可触发浮泡破碎；触发后，浮泡将在0.5秒延迟后破碎";
// 扶摇花火 备注 "治疗量的计算使用遥赋予浮泡时的缓存攻击力"; 夜啼彩羽 备注 "浮泡破碎后优先给予生命比例最低的单位浮泡"; 幽隙栖萤
// 备注 "伤害溅射半径1.7，可对空…治疗量为0时将不会造成法术伤害…每次部署时，重新计算该技能的使用次数"; 夏末游鳞 备注 "触发浮空
// 效果与触发浮泡破碎的判定采用相同逻辑；即将破碎的浮泡仍能对伤害来源制造浮空效果…无法对持有无敌/不可选中/浮空免疫的来源生效
// （伤害绑定于该浮空效果上）"), and the client's battle data read from the local install — charpack char_4202_haruka (every
// mode's attack = AttackAndShield when it has a target, else ShieldOnly; the shield selector: allies, no haruka_t_1 holder,
// lowest HP share first, max_target_shield; S2 adds attack@max_target_heal_add / max_target_shield_add to the trait's and the
// talent's counts) and buff_template_data haruka_t_1 / haruka_t_1_delay / haruka_s_2 / haruka_s_2[damage] / haruka_s_3_scale
// / haruka_s_3_debuff_delay / haruka_s_3_debuff.
// - Trait (护佑者) "攻击造成法术伤害，技能开启后改为治疗友方单位（治疗量相当于75%攻击力）": ranged arts bolts (y-6, hits air
//   units), blocks 1, ground enemies target her; while any skill runs every attack heals the most injured allies of her
//   range (attack@max_target_heal of them, heal_scale × ATK). BLS-Y “迟来的纪念” "攻击对2个目标…改为治疗2个友方单位"
//   (attack@max_target / attack@max_target_heal 2). Every skill keeps the data trigger: a 辅助's basic strategy casts on
//   an enemy she is about to attack (S1 / S2 DEFAULT), S3 ACTIVE_RANGE on its y-8 (the owner's rule of 2026-10-05).
// - T1 浮光泡影 "每过一个攻击间隔，使范围内一名友方单位获得30%庇护的浮泡，浮泡在受到敌方伤害的短暂延迟后破碎": with each
//   attack or heal she gives a bubble to max_target_shield allies of her current range that hold none (operators and summons,
//   禁疗 ones too — ignoreHealFree; never a 孤立 one; herself included), the lowest HP share first; with no target to attack
//   or heal but such an ally, the attack itself becomes the bubble (it takes the attack interval); with neither she waits.
//   A bubble (no time limit, it outlasts her [ASSUMED: the ability's buff, not removed on her leaving]) gives 庇护
//   damage_resistance (phys / arts taken ×(1 − v); the client's override key damage_resistance[bonus] — not the common 庇护
//   damage_resistance[inf] of other operators, so it multiplies with those) — while her S3 runs ×damage_resistance_scale
//   (haruka_s_3_scale re-reads every bubble of hers at its start and end). Damage from an enemy (a `source` on the enemy side)
//   that lowered its holder's HP sets it off: 0.5 s (bb interval) later it breaks — once, later hits change nothing.
// - T2 扶摇花火 "浮泡破碎时，为所在的单位治疗相当于遥攻击力25%的生命值" (full potential: 28%): the break heals the holder
//   heal_scale × her ATK as it was when she gave the bubble (a 治疗 — her heal, also after she left). BLS-Y stage 2+
//   "并有20%的概率回复1点技力": then prob to give sp SP to the holder (the client's ModifySp on the BUFF_OWNER).
// - S1 夜啼彩羽 (MANUAL, DEFAULT, 19 / 20 s): ASPD +attack_speed; heals; while it runs a breaking bubble at once gives a new one
//   to the ally of the 8 tiles around its holder that holds none, the lowest HP share first (haruka_t_1_delay → shield_s1).
// - S2 幽隙栖萤 (MANUAL, DEFAULT, 22 / 23 s): heals (attack@max_target_heal_add more targets), max_target_shield_add more
//   bubbles per attack (rank 7: +1 / +1); every heal of hers meanwhile (the trait's and T2's — ON_AFTER_OUTPUT_HEAL, the heal's
//   value after the healing multipliers; none under 禁疗) deals that value × atk_scale_extra as arts damage to
//   max_target_extra enemies within ability_range_radius (1.7) of the healed unit, air units too — the nearest first
//   [ASSUMED: the ExtraSelect order]. "第二次及以后使用时攻击力+25%，且持续时间无限": the uses of the deployment are counted
//   (PRTS); from the second on ATK +atk and it never ends (haruka_s_2[first].atk = 0 for the first).
// - S3 夏末游鳞 (MANUAL, ACTIVE_RANGE, 40 s): ATK +atk, range y-8, attack interval +base_attack_time s (−0.4 / −0.6 on 1.6),
//   heals, her bubbles ×damage_resistance_scale; an enemy whose damage sets one of her bubbles off (the same test; also a
//   bubble already breaking) is 浮空 levitate_duration s (the catalogue status: immunity, 抵抗, half on 重量 > 3; not an
//   invulnerable / untargetable one) and while it stays levitated takes atk_scale × her ATK arts damage per second (the
//   first after 0.5 s, then every `interval` s; 持续伤害, not dodgeable; 无来源 at her last ATK once she left).





const S1 = 'skchr_haruka_1';
const S2 = 'skchr_haruka_2';
const S3 = 'skchr_haruka_3';
/** A bubble (haruka_t_1): one per unit, whoever gave it — the selector skips holders. */
const BUBBLE = 'haruka:bubble';
/** The S3 levitation damage (haruka_s_3_debuff). */
const FLOAT_DOT = 'haruka:float';
/** 浮光泡影: the break delay when the talent carries no `interval`. */
const BREAK_DELAY = 0.5;
/** S3's levitation damage: the first tick (haruka_s_3_debuff firstTriggerInterval). */
const FLOAT_FIRST = 0.5;
/** 幽隙栖萤: the splash radius when the blackboard carries none (PRTS 备注 1.7). */
const S2_RADIUS = 1.7;
/** The 8 tiles around a unit and its own (夜啼彩羽's shield_s1 area; the holder itself is left out). */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tileKey = (r, c) => r * COLS + c;
// 队友是否在遥的攻击范围内：优先用引擎给单位的 rangeKeySet（no new import），拿不到就退路为全场地。
// 每次队友受伤充多少 SP：从她当前装备技能的 bb 读 ally_damaged_sp（默认 3，数值在数据里可调）
const allyHurtSpOf = (u) => {
  const b = (u && u.skill && u.skill.bb) || {};
  return typeof b.ally_damaged_sp === 'number' ? b.ally_damaged_sp : 3;
};
const allyHurtInRange = (u, a) => {
  const set = u && u.rangeKeySet;
  if (!set || !a) return true;
  const keys = a.rangeKeys || a.keys || (Number.isInteger(a.tileR) && Number.isInteger(a.tileC) ? [a.tileR * COLS + a.tileC] : null);
  if (!keys || !keys.length) return true;
  for (const kk of keys) if (set.has(kk)) return true;
  return false;
};
const skillOn = (u, id) => !!(u && u.skill && u.skill.id === id && u.skill.active);

/** Allies that may get a bubble from `by` on tile keys `keys`: no bubble yet, not 孤立; the lowest HP share first. */
function bubbleCands(battle, by, keys, except = null) {
  const out = battle.allyUnits.filter((a) => a.alive && a.deployed && !a.hidden && a.kind !== 'device' && a !== except
    && keys.has(tileKey(a.tileR, a.tileC)) && !a.findBuff(BUBBLE) && battle.allySelectable(a, by));
  out.sort((a, b) => a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq || a.id - b.id);
  return out;
}

const __default = {
  char_4202_haruka: (bb, chess) => {
    const tb = traitBb(chess);
    const t1 = talentBb(chess, 0), t2 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const atkTargets = Math.max(1, Math.floor(num(tb['attack@max_target'], 1)));
    const healTargets = Math.max(1, Math.floor(num(tb['attack@max_target_heal'], 1)));
    const healAttack = (n) => Object.freeze({
      dmgType: 'heal', heal: n > 1 ? { mode: 'multi', count: n } : { mode: 'single' }, healScale: num(tb.heal_scale, 0.75),
      maxTargets: n, projectile: 'none',
    });
    const shelter = num(t1.damage_resistance, 0.3), breakDelay = num(t1.interval, BREAK_DELAY);
    const bubbles = Math.max(1, Math.floor(num(t1.max_target_shield, 1)));
    const t2Heal = num(t2.heal_scale), t2Prob = num(t2.prob), t2Sp = num(t2.sp);
    const s3Scale = num(b3.damage_resistance_scale, 1);
    /** Bubbles per grant: the talent's, + S2's add while it runs. */
    const grantCount = (u) => bubbles + (skillOn(u, S2) ? Math.max(0, Math.floor(num(b2.max_target_shield_add))) : 0);
    /** A bubble's 庇护 now: ×damage_resistance_scale while her S3 runs. */
    const shelterNow = (u) => shelter * (skillOn(u, S3) ? s3Scale : 1);

    /** Give `a` a bubble from `u` (its 庇护, her ATK of now for the T2 heal). */
    function bubble(battle, u, a) {
      const v = shelterNow(u);
      battle.addBuff(a, {
        key: BUBBLE, source: u, visible: true, mods: protectMods(v), tags: ['talent'],
        data: { v, atk: u.s.atk, heal: t2Heal, prob: t2Prob, sp: t2Sp, boom: false },
      });
      battle.fx('shield', { x: a.x, y: a.y, id: a.id, kind: 'bubble' });
    }
    /** One bubble grant of `u` on her current range: up to grantCount allies. Returns how many got one. */
    function grant(battle, u) {
      const list = bubbleCands(battle, u, u.rangeKeySet || new Set(u.rangeKeys || []));
      const n = Math.min(grantCount(u), list.length);
      for (let i = 0; i < n; i++) bubble(battle, u, list[i]);
      return n;
    }
    /** Re-read the 庇护 of every bubble of `u` (S3's start / end). */
    function rescale(battle, u) {
      const v = shelterNow(u);
      for (const a of battle.allyUnits) {
        const b = a.findBuff(BUBBLE);
        if (!b || b.source !== u || !b.data || Math.abs(b.data.v - v) < 1e-12) continue;
        b.data = { ...b.data, v };
        b.mods = protectMods(v);
        a.markDirty();
      }
    }
    /** S3: levitate the enemy whose damage set a bubble of `u` off, and its per-second damage while it floats. */
    function levitate(battle, u, e) {
      if (!e || !e.alive || e.side !== 'enemy' || e.s.flags.invulnerable || e.s.flags.untargetable) return;
      const dur = num(b3.levitate_duration);
      if (!(dur > 0) || !battle.applyStatus(e, 'levitate', { duration: dur, source: u })) return;
      const iv = Math.max(0.1, num(b3.interval, 1)), scale = num(b3.atk_scale);
      let lastAtk = u.s.atk;
      battle.addBuff(e, {
        key: `${FLOAT_DOT}#${u.id}`, duration: dur + 0.05, source: u, tags: ['skill'],
        data: { next: battle.time + FLOAT_FIRST },
        onTick: ({ battle: b, unit: tgt, buff }) => {
          if (!tgt.s.flags.levitate) { b.removeBuff(tgt, buff); return; }
          if (b.time + 1e-9 < buff.data.next) return;
          buff.data = { next: buff.data.next + iv };
          const here = up(u);
          if (here) lastAtk = u.s.atk;
          b.dealDamage(u, tgt, { amount: lastAtk * scale, type: 'arts', canDodge: false, isSkill: true, sourceless: !here, tags: ['skill', 'dot', 'haruka:float'] });
        },
      });
      battle.fx('levitate', { x: e.x, y: e.y, id: e.id });
    }
    /** A bubble of `u` on `a` breaks (the delay is over): T2's heal and SP, S1's next bubble. */
    function burst(battle, u, a, buff) {
      battle.removeBuff(a, buff);
      const d = buff.data;
      if (d.heal > 0) {
        battle.heal(u, a, d.atk * d.heal);
        battle.fx('heal', { x: a.x, y: a.y, id: a.id });
        if (d.prob > 0 && d.sp > 0 && battle.rng.chance(d.prob)) giveSp(a, d.sp);
      }
      if (skillOn(u, S1) && up(u)) {
        const keys = new Set(absoluteRangeKeys(X4, a.tileR, a.tileC, a.dir || 'RIGHT', 0));
        const next = bubbleCands(battle, u, keys, a)[0];
        if (next) bubble(battle, u, next);
      }
    }

    return {
      trait: atkTargets > 1 ? { maxTargets: atkTargets } : null,
      skills: {
        // [ASSUMED] her skills' attacks heal: 白铁's 铁钳号 (禁疗, no patient) alone does not open them (skills.js allyTargetsOk)
        [S1]: { kind: 'duration', mods: { aspd: num(b1.attack_speed) }, attack: healAttack(healTargets), allyTargets: false },
        [S2]: {
          kind: 'duration', attack: healAttack(healTargets + Math.max(0, Math.floor(num(b2['attack@max_target_heal_add'])))), allyTargets: false,
          onStart({ battle, unit }) {
            unit.mem.harukaS2Uses = (unit.mem.harukaS2Uses ?? 0) + 1;
            unit.mem.harukaS2Endless = unit.mem.harukaS2Uses >= 2;
            const atk = unit.mem.harukaS2Endless ? num(b2.atk) : num(b2['haruka_s_2[first].atk']);
            if (atk) battle.addBuff(unit, { key: 'haruka:s2:atk', mods: { atkPct: atk }, tags: ['skill'] });
          },
          // 持续时间无限 (2nd use on): the bar stays full and the skill never ends
          onTick({ unit, skill }) { if (unit.mem.harukaS2Endless) skill.timeLeft = Math.max(skill.timeLeft, s2?.duration ?? skill.duration); },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'haruka:s2:atk'); unit.mem.harukaS2Endless = false; },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
          targeting: { rangeGrid: s3?.rangeGrid ?? null },
          allyTargets: false,
          attack: healAttack(healTargets),
          onStart({ battle, unit }) { rescale(battle, unit); },
          onEnd({ battle, unit }) { rescale(battle, unit); },   // (`active` is already false: ×1 again)
        },
      },
      talents: [
        { install(battle, unit) { // 浮光泡影: a bubble with each attack / heal, or instead of one; the break
          battle.on('attack', (c) => { if (c.attacker === unit && up(unit)) grant(battle, unit); }, { owner: unit });
          // no target to attack or heal but an ally to bubble: the attack becomes the bubble (ShieldOnly)
          battle.on('tick', () => {
            if (!up(unit) || !unit.canAct || unit.s.flags.disarm || unit.atkCd > 0 || unit.trait.hadTarget !== false) return;
            if (grant(battle, unit) > 0) unit.atkCd = Math.max(unit.atkCd, unit.s.interval);
          }, { owner: unit });
          battle.on('damaged', (c) => {
            const a = c.target, src = c.source;
            if (!a || a.side !== 'ally' || !src || src.side !== 'enemy' || !(c.amount > 0) || c.type === 'element') return;
            const b = a.findBuff(BUBBLE);
            if (!b || b.source !== unit) return;
            if (skillOn(unit, S3) && up(unit)) levitate(battle, unit, src);
            if (b.data.boom) return;
            b.data = { ...b.data, boom: true };
            battle.after(breakDelay, () => { if (a.alive && a.findBuff(BUBBLE) === b) burst(battle, unit, a, b); }, { owner: a });
          }, { owner: unit });
          // 作者要求：范围内队友受伤 ⇒ 立刻给她充能（不再依赖"敌人走进攻击范围"；配合 S3 的 DEFAULT 触发）
                            battle.on('damaged', (c) => {
                              const a = c.target;
                              if (!a || a === unit || a.side !== 'ally' || !(c.amount > 0)) return;
                              if (!allyHurtInRange(unit, a)) return;
                              if (!up(unit)) return;
                              const gain = Math.max(0, num(allyHurtSpOf(unit)));
                              if (gain > 0) giveSp(unit, gain, 'trait');
                            }, { owner: unit });
                            battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.harukaS2Uses = 0; unit.mem.harukaS2Endless = false; } }, { owner: unit });
        } },
        { install(battle, unit) { // 幽隙栖萤: each heal of hers while S2 runs ⇒ arts damage around the healed unit
          if (unit.skill?.id !== S2) return;
          const scale = num(b2.atk_scale_extra), n = Math.max(0, Math.floor(num(b2.max_target_extra)));
          const r = num(b2.ability_range_radius, S2_RADIUS);
          battle.on('heal', (c) => {
            if (c.source !== unit || c.opts?.regen || !skillOn(unit, S2) || !(c.amount > 0) || !(scale > 0) || !n) return;
            const t = c.target;
            const foes = battle.foesInRadius(t.x, t.y, r);
            foes.sort((x, y) => hypot(x.x - t.x, x.y - t.y) - hypot(y.x - t.x, y.y - t.y) || x.spawnSeq - y.spawnSeq);
            const amount = c.amount * scale;
            for (const e of foes.slice(0, n)) battle.dealDamage(unit, e, { amount, type: 'arts', isSkill: true, tags: ['skill', 'haruka:s2'] });
            if (foes.length) battle.fx('aoe', { x: t.x, y: t.y, radius: r, id: unit.id, skill: 'haruka:s2' });
          }, { owner: unit, priority: -1000 });
        } },
      ],
    };
  },
};

return __default;
})();

// ---- 本包 ----
// server/sim/content/kits/ops/chess_char_9_dong1-haruka.js — 遥 (char_4202_haruka) 的【常驻池棋子】委托 kit.
//
// 为什么要这个文件（2026-10-12 报告的"二技能没有治疗"）：
//   遥本来是**自选(自选编队)干员**，她的 kit 是 ops/op-haruka.js，注册键是 **charId**（char_4202_haruka）。
//   引擎的 kitOf（sim/content/index.js:82）只在 `def.diyFor` 存在时（isDiyDef：一个被填过的自选槽位）
//   才用 charId 查 kit；否则按棋子 **baseId** 查，查不到就**回退 generic kit**。
//   generic kit 只读【技能自己的 bb】，而护佑者的 `heal_scale` / `attack@max_target_heal` 在
//   **trait 的 bb** 里 → 于是"技能开启后改为治疗"整个失效（遥的二技能因此没有治疗）。
//
//   本文件把棋子 baseId（chess_char_9_dong1）注册到同一个 kit 实现上，转发给 op-haruka.js，
//   与白雪（kits/ops/chess_char_1_21-yuki.js）完全同款的做法 —— **不改引擎逻辑**。


export default (bb, chess, def) => __haruka.char_4202_haruka(bb, chess, def);
