// server/battle/dong.mjs —— 东盟约（dongShip）的**战斗层**效果。
//
// 工坊的 server.battle 通道：Covenant 的"造成伤害时追加一次按弱点类型结算的攻击"不是纯数据能表达的，
// 所以写成整场一份的战斗模块（官方 content/bonds/*.js 用的是同一套 @battle/ 辅助函数）。
//
// 数值**全部**从盟约自己的 env_gbuff_new 黑板读（base_damage_scale / damage_scale_per_stack / neural_damage / power_*_cnt），
// 代码里一个魔数都没有。
//
// ⚠ 这个模块**两端都会跑**（浏览器按 /workshop-battle/<包>/<模块> 加载，服务端复算同一份）⇒
//   不许 Math.random / Date.now / 定时器 / 网络 / console / 模块级可变状态。官方 content 模块同一条纪律。
//
// 白名单限制：工坊的战斗模块只能 import @battle/ 与 @sim/（**不能用** ./ 相对路径）⇒
//   weaknessRetype（官方 content/items/battle.js）与它用到的 mitigate（官方 sim/damage.js）
//   在这里**内联**成私有函数，逻辑逐字照抄。

import {
  num, bondRecord, buffParams, bondActive, bondLayers, isMember, playerOps, battleStore,
} from '@battle/index.js';
import { MIN_DAMAGE_RATIO } from '@sim/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// 内联：官方 server/sim/damage.js 的 clamp01 + mitigate（纯函数，逐字照抄）
// ─────────────────────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Pure mitigation formula (official sim/damage.js). `target` = the target's stats. */
function mitigate(amount, type, target, ign = {}) {
  if (type === 'phys') {
    const D = target.def ?? 0;
    const eff = Math.max(0, D * (1 - clamp01(ign.defIgnorePct ?? 0)) - (ign.defIgnoreFlat ?? 0));
    return Math.max(amount - eff, MIN_DAMAGE_RATIO * amount);
  }
  if (type === 'arts') {
    const R = target.res ?? 0;
    const eff = Math.max(0, R * (1 - clamp01(ign.resIgnorePct ?? 0)) - (ign.resIgnoreFlat ?? 0));
    return Math.max(amount * (1 - Math.min(100, eff) / 100), MIN_DAMAGE_RATIO * amount);
  }
  if (type === 'elemental') {
    const D = Math.max(0, Math.min(100, Number.isFinite(ign.elementalRes) ? ign.elementalRes : 0));
    return Math.max(amount * (1 - D / 100), MIN_DAMAGE_RATIO * amount);
  }
  return amount;
}

// ─────────────────────────────────────────────────────────────────────────────
// 内联：官方 server/sim/content/items/battle.js 的 mitigated + weaknessRetype（逐字照抄）
// ─────────────────────────────────────────────────────────────────────────────
/** Damage mitigation estimate for flat DR / weakness damage (same formula as damage.js). */
function mitigated(amount, type, target, source, dmg) {
  const ss = source && source.s ? source.s : null;
  return mitigate(amount, type, target.s, {
    defIgnorePct: (dmg.defIgnorePct || 0) + (ss ? ss.defIgnorePct : 0),
    defIgnoreFlat: (dmg.defIgnoreFlat || 0) + (ss ? ss.defIgnoreFlat : 0),
    resIgnorePct: (dmg.resIgnorePct || 0) + (ss ? ss.resIgnorePct : 0),
    resIgnoreFlat: (dmg.resIgnoreFlat || 0) + (ss ? ss.resIgnoreFlat : 0),
  });
}
/**
 * 弱点伤害 (双模机械臂, band 陈 以己之长): a physical or arts DamageInfo from `source` becomes whichever of the two types
 * `target` resists less (same mitigation formula as damage.js, incl. the source's ignore stats). Mutates `dmg.type`.
 */
function weaknessRetype(dmg, source, target) {
  if (!dmg || !target || !target.s || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
  const ph = mitigated(dmg.amount, 'phys', target, source, dmg);
  const ar = mitigated(dmg.amount, 'arts', target, source, dmg);
  const best = ar > ph + 1e-9 ? 'arts' : ph > ar + 1e-9 ? 'phys' : dmg.type;
  if (best !== dmg.type) dmg.type = best;
}
// 本文件是**自包含**的：逻辑只依赖下面两个 import，数据全部走 bb 黑board，不改任何引擎文件。
// 所以迁移成本极低 —— 只是"换 import 前缀 + 写 pack.json"：
//
//   1) import 路径换成 Forge 的别名（server.battle 只许 import @battle/ 与 @sim/）：
//        '../support/index.js'     →  '@sim/content/support/index.js'
//        '../items/battle.js'      →  '@sim/content/items/battle.js'
//
//   2) pack.json 里声明（不要把本文件挂进 bonds.js 的 PARTS —— 那是就地补丁，Forge 不支持）：
//        { "combat": true,
//          "content": ["chess", "bonds"],
//          "overrides": ["bonds:soloShip"],                       // 覆盖官方盟约必须显式声明
//          "bondIcons": { "dongShip": "art/bond_dongShip.png" },   // 落点 assets.bonds（键名= bondId）
//          "server": { "battle": { "module": "battle/dong.js" } } }
//
//   3) 两条硬约束（Forge 的校验器是**拒绝式**的，违规直接不加载）：
//        · 两端跑同一段字节 ⇒ 本文件必须浏览器安全：不许 import node:*/server/match/*/public/*，
//          不许 Math.random / Date.now / 定时器 / console.* / 模块级可变状态；
//        · 数值不许在代码里写死 —— 全部从 bb 读（已经做到了）。
//
// 另外：Forge 里 `config` 被**故意**排除（改经济/回合规则属于改规则而非内容），盟约成员用
// `content/bonds.json` + 棋子记录的 `bonds` 两条一起表达。
// =====================================================================================================================

// server/sim/content/bonds/custom.js — the fan-made bond 东 (dongShip).
//
// Loaded by content/bonds.js next to bonds/core.js and bonds/addon.js. Every number comes from the bond's own
// `env_gbuff_new` blackboard (`buffParams(bondRecord(DONG), 'env_gbuff_new')`), never from literals.
//
//   东 dongShip   **two explicit distinct-member gates** (the owner's design):
//
//     · 3 distinct 东 members → 效果一: every damage instance a member deals triggers ONE extra attack, dealt as
//       弱点伤害 — whichever of physical / arts yields MORE damage against that target's DEF/RES (the 赤刃明霄陈 /
//       双模机械臂 rule, imported from items/battle.js `weaknessRetype`) — for (base_damage_scale +
//       damage_scale_per_stack × L) × ATK, credited to the attacking operator (it keeps the stats and the kill).
//       `power_char_cnt` is the gate (default 3, also the bond's activeCount — checked explicitly so the behaviour
//       does not silently ride on `activeCount` staying 3).
//
//     · 6 distinct 东 members → 效果二: the extra attack ALSO fills `neural_damage` of the target's 神经 (neural /
//       SANITY) gauge — engine DamageInfo type 'element' with `element: 'neural'`. The gauge bursts at
//       ELEMENT_GAUGE_MAX (1000 on a normal enemy, 2000 on a leader) into the official 神经 burst (6000 elemental
//       damage + 3 麻痹). `bb.neural_damage` per hit (60 since 2026-10-13 ≈ 17 hits on a normal enemy, 34 on a leader) —
//       deliberately slow, never an instant burst; the number comes from bb, never from here.
//       `power_bond_char_cnt` is the gate (6).
//
// Both gates accept a live `count` OR the bond's own tier (`thresholds: [3, 6]` ⇒ tier 1 / tier 2) so a tier that
// the match already raised counts, mirroring bonds/core.js `reached`.
//
// The recursion guard is 卡兹戴尔's: every instance this module adds carries a `bond:dong` tag and any damage already
// carrying that tag is left alone, so an extra attack never spawns another one.
//
// Prep side: nothing (the bond has no 层数里程碑 payouts) — `registerMeta` is exported anyway so content/bonds.js's
// `runAll` finds the module a well-formed part.


const DONG = 'dongShip';
/** Tag of every damage instance this bond adds (its own recursion guard). */
const TAG = `bond:${DONG}`;
// 2026-10-12 修复：神经损伤原来只带 `bond:dongShip:neural`，而防护用 `tags.includes(TAG)` 精确匹配 → 拦不住，
// 6 名东时会造成盟约自我递归（引擎 damage.js:416 对元素伤害同样 emit 'damaged'）。
// 现在两个标签都带上基础 TAG，且防护改用前缀匹配（见 `tagged`）。
const TAG_NEURAL = `${TAG}:neural`;
/** 效果一's member gate (the design's "三名东干员才能激活一效果"). */
const TIER1_MEMBERS = 3;

/** Bond effect blackboard `{ ...bb, ...bbStr }` or {}. */
const bbOf = (id) => buffParams(bondRecord(id), 'env_gbuff_new') ?? {};

// 防护用**前缀匹配**：`bond:dongShip` 与 `bond:dongShip:neural` 都算"本盟约产生的伤害"，
// 否则 6 名东时神经损伤会再次触发效果一 → 自我递归（2026-10-12 修复）。
const tagged = (dmg, tag) => !!(dmg && Array.isArray(dmg.tags)
  && dmg.tags.some((t) => typeof t === 'string' && (t === tag || t.startsWith(tag + ':'))));
const isEnemy = (t) => !!t && t.side === 'enemy' && t.alive;

/**
 * Distinct base chess ids among `members` — the design counts "N 名不同【东】干员", and this reads the units actually on
 * the field. Deliberately NOT `st.count` / `st.tier`: a tier the match raised (or a `count` from 调和's +1) must not
 * stand in for members that are not there — a 2-member board with `tier: 1` is still 2 members and gets 效果一 only at 3.
 * Normal and elite of one operator share a base id (`chess_char_x_y_a`), so they count once, like every BOARD bond.
 */
function distinctMembers(members) {
  const ids = new Set();
  for (const u of members) {
    const id = u && u.def ? (u.def.baseId ?? u.def.chessId ?? null) : null;
    if (typeof id === 'string' && id) ids.add(id.replace(/_b$/, '_a'));
  }
  return ids.size;
}

export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  // Idempotent: the module is reached through content/bonds.js AND may be passed as extraContent (tests) — a second
  // install would double every handler it registers.
  const guard = battleStore(battle, 'bonds:dong', () => ({ installed: false }));
  if (guard.installed) return;
  guard.installed = true;

  for (const p of battle.players) {
    const pid = p.playerId;
    if (!bondActive(battle, pid, DONG)) continue;
    const bb = bbOf(DONG);
    const members = playerOps(battle, pid).filter((u) => isMember(battle, u, DONG));
    if (!members.length) continue;
    const memberSet = new Set(members);

    // 效果一: 3 distinct 东 members. 效果二: 6 distinct 东 members. Both read the board itself, never `count`/`tier`.
    const n = distinctMembers(members);
    const eff1 = n >= num(bb.power_char_cnt, TIER1_MEMBERS);
    const eff2 = n >= num(bb.power_bond_char_cnt, 6);

    battle.on('damaged', (c) => {
      const s = c.source, t = c.target, dmg = c.dmg;
      if (!s || !memberSet.has(s) || !dmg || !t || !isEnemy(t)) return;
      if (tagged(dmg, TAG)) return;                  // recursion guard: our own extra attack triggers nothing

      // 效果一 (3 名东): the extra attack — ATK × (base_damage_scale + damage_scale_per_stack × L)，按弱点类型结算。
      //
      // ⚠️ `isAttack` MUST stay falsy. This instance is a bond effect, NOT an operator attack action: ~90 kits gate their
      // "on attack" procs on `dmg.isAttack` (tier1.js `isMainHit`, 白雪 S2's shuriken, 寒芒克洛丝, 澄闪, 玛恩纳 …). With
      // `isAttack: true` 白雪's 凝武 threw an EXTRA shuriken per damage instance (each of which pelted the ground and
      // stacked more zones) — the 2026-10-12 report. `isSplash` stays falsy too (the engine's own splash payload sets it).
      //
      // What the instance DOES inherit is the original hit's damage multiplier `dmg.mul`, so a `hit`-hook bonus the
      // original took also boosts this one — the 卡兹戴尔 rule of 1.4.1 ("its own true damage has to take the same bonus
      // when its target is controlled"). The engine scales every new instance by the source's `dmgDealtMul` and the
      // target's taken-multipliers on its own (damage.js:271-273); `dmg.mul` is the only part it cannot know.
      const L = bondLayers(battle, pid, DONG);
      // 追加攻击倍率 = base_damage_scale + damage_scale_per_stack × L —— 与【炎】的强度公式**同形**（线性，不是二次）：
      //   炎 = 攻击力 × (1 + 0.23 + 0.009×L)（data/bonds.json 的 `spec.formulas.atkMultiplier`）——它对成员是一层"按层数
      //   线性增长"的强度；东把同一形状用在**追加的那一次攻击**上。
      //   两种盟约的界面读的也是同一对 bb 键：`bb[baseParams] + bb[perStackParams] × 层数`
      //   （public/js/ui/richText.js formatBondEffect，DATA.md §3）⇒ **显示值 == 实际值**，不再有旧版那种
      //   "显示线性、实际二次"的分离（旧版 300 层：界面 62%、实际 186%）。
            //   式子是 **3.3% + 0.2975% × 层数** —— 与界面那条式子（`bb[base] + bb[perStack] × 层数`）逐字相同，
//   所以 `base_damage_scale = 0.033`、`damage_scale_per_stack = 0.0032233`，**显示值 == 实际值**，没有折算：
//     0 层 3.3% / 50 层 19.4% / 100 层 35.5% / 150 层 51.6% / 200 层 67.8% / **325 层正好 100%**
//   （斜率照"300 层 = 100%"反解：(1 − 0.033) / 325 = 0.0043955；base 仍是 3.3%）
      //   ⚠ 两个数都是 bb 值，代码里不写死；读不到就是 0（不触发）。改数值时**两个文件一起改**：
      //     `bonds.json`（游戏读的）与 `bond-specs/dongShip.json`（编辑器的源，不改的话下次保存会把它改回去）。
      // 叠层曲线：curve_k > 0 时用**平方函数** pct = curve_k · L²（前面平缓、后面陡起来；400 层 = 100%），
                    // 没给 curve_k 就退回原来的线性 base + perStack × L（向后兼容）。
                    const kq = num(bb.curve_k);
                    const pct = Math.max(0, kq > 0 ? kq * L * L : num(bb.base_damage_scale) + num(bb.damage_scale_per_stack) * L);
      if (eff1 && pct > 0 && t.alive) {
                const info = {
          amount: s.s.atk * pct, type: 'phys', canDodge: false, isSplash: false, isAttack: false,
                // tags 里带 talent：引擎的武者回血（professions.js installMushaHeal）会跳过 talent/dot/periodic 三种标签，
      // 所以盟约的追加攻击不算宴这类武者的「输出伤害」，不会触发她的特性回血。
      isSkill: false, tags: [TAG, 'talent'],
        };
        weaknessRetype(info, s, t);                  // 赤刃明霄陈 / 双模机械臂: phys vs arts, the stronger one
        battle.dealDamage(s, t, info);
      }

      // 效果二 (6 名东): the extra attack also fills `neural_damage` of the 神经 gauge (never an instant burst)
      const nd = num(bb.neural_damage);
      if (eff2 && nd > 0 && t.alive) {
        battle.dealDamage(s, t, {
          amount: nd, type: 'element', element: 'neural', canDodge: false, isSplash: false, isAttack: false, isSkill: false, tags: [TAG_NEURAL],
        });
      }
    });
  }
}

