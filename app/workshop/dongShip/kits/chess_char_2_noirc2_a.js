// server/sim/content/kits/ops/chess_char_2_noirc2-noirc2.js —— 火龙S黑角 (char_1030_noirc2) kit, tier 2.
//
// 6★ 近卫/武者 · 盟约【东】【坚守】。PRTS: https://prts.wiki/w/火龙S黑角
//
//   ── 武者特性（不成为其他角色的治疗目标，每次攻击到敌人后回复自身70生命）──
//      **不用写代码**：走数据 trait.bb.value = 70（同宴的 trait.bb.value = 50）。
//
//   ── S2 气刃兜割（默认技能）──
//       "对前方范围内一名敌人造成7次相当于攻击力150%的物理伤害。技能结束后损失一层第二天赋加成，可充能2次"
//       实现照 **麒麟R夜刀 S2**（chess_char_9_yato-yato2.js）：kind 'instant' + 自己循环 hits 次 dealDamage。
//       充能走数据 maxChargeTime = 2（引擎的 charges 机制）。
//       技能期间的无敌/不可阻挡/晕眩免疫/冻结免疫/强制缴械 → flags（引擎自带 buff flags）。
//
//   ── S1 居合拔刀气刃斩 ──
//       "纳刀后停止攻击，直到下一次受到攻击时抵挡此次伤害并选择范围内一名敌人造成4次相当于攻击力120%的
//        物理伤害并立即触发一次第二天赋。技能期间击倒敌人时再次纳刀触发技能"
//       实现：
//         · duration 6 + attack.noAttack（"停止攻击"，照宴 S1 / 泡泡）
//         · 纳刀 = 挂一层护盾（shield），抵挡下一次伤害 —— 护盾是引擎自带机制
//           （照信仰搅拌机 chess_char_4_01-rmixer.js 的 rmixer:shield：battle.addBuff(u,{key,shield,visible})）
//         · battle.on('damaged')：护盾被消耗（或期间挨打）→ 对攻击者 4 连击 × atk_scale + 触发一次练气
//         · battle.on('kill')：技能期间击倒敌人 → 重新纳刀（重置护盾）
//
//   ── 天赋1 坚韧（在场时最高 +50 攻速 / +50% 防御，随已损失生命线性上升）──
//       照 **宴** 的 认真模式（chess_char_1_18-utage.js:36-46）：每 tick 按 hpRatio 算加成。
//       宴只有攻速；这里多一项 defPct（数据 bb.max_def）。
//
//   ── 天赋2 练气（非技能期间连续攻击5次后攻击力+7%，最多3层）──
//       数"非技能期间自身造成的伤害实例"，每 need_cnt 次 +1 层（最多 max_stack 层）。
//       受晕眩/冻结/缴械时、或释放技能时清空计数（PRTS 备注）。
//       S2 的技能结束后损失一层（kit 里 onEnd 处理）。
//
//   ── X模组「黑角的随身笔记」(uniequip_002_noirc2 / SBL-X / 3 级) ──
//       PRTS: https://prts.wiki/w/火龙S黑角（「模组」段）
//       · 生命 +500 / 攻击 +36、天赋【练气】+7% → +9%、特性追加"生命值低于50%时获得25%庇护"
//         —— **三项都走数据**（records 的 stats = statsBase + modules[].attr、talents = talentsBase +
//         modules[].talentChanges，引擎的 shared/loadoutRecord.js 自己合成；干员调配里可以「不装备」）。
//       · 但"庇护"得有人挂 buff：这里照**宴**（chess_char_1_18-utage.js 的 庇护 段）的写法，
//         读合并后的 t0.hp_ratio / t0.damage_resistance，低于阈值时 holdProtect(...)：每 tick 续一次，
//         每次挨打再续一次（PROTECT_TICK_HOLD 是 1.5 个 tick 的余量）。
//         ⇒ 没装备模组时这两个键根本不存在，整段自动不生效（不需要 moduleOn 判断）。
import { num, talentBb, skillBbOf, up, holdProtect, PROTECT_TICK_HOLD, onHitOn } from '@kit/tier1.js';

const S1 = 'skchr_noirc2_1';
const S2 = 'skchr_noirc2_2';
const TAL_KEY = 'noirc2:lianqi';        // 练气的 buff key
const RANGE_32 = [[0, 0], [0, 1], [0, 2], [0, 3]];

const __MOD = {
  chess_char_2_noirc2_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);      // 坚韧: min_attack_speed / min_hp_ratio / max_def
    const t1 = talentBb(chess, 1);      // 练气: atk / max_stack / need_cnt
    const b1 = skillBbOf(chess, S1) ?? {};
    const b2 = skillBbOf(chess, S2) ?? {};

    const s1Scale = num(b1.atk_scale, 0.9);
    const s1Hits = Math.max(1, num(b1.times, 4));
    const s2Scale = num(b2.atk_scale, 0.9);
    const s2Hits = Math.max(1, num(b2.times, 7));
    const lqAtk = num(t1.atk, 0.07);
    const lqMax = Math.max(1, num(t1.max_stack, 3));
    const lqNeed = Math.max(1, num(t1.need_cnt, 5));

    /** 练气层数（buff 的 data.n） */
    const lqStacks = (unit) => Math.max(0, num(unit.findBuff(TAL_KEY)?.data?.n, 0));
    /** 加一层练气（上限 lqMax） */
    const lqAdd = (battle, unit) => {
      if (!up(unit)) return;
      const n = Math.min(lqMax, lqStacks(unit) + 1);
      battle.addBuff(unit, { key: TAL_KEY, mods: { atkPct: lqAtk * n }, data: { n }, refresh: 'replace', tags: ['talent'] });
    };
    /** 掉一层（S2 结束后） */
    const lqDrop = (battle, unit) => {
      const n = lqStacks(unit) - 1;
      if (n <= 0) { battle.removeBuff(unit, TAL_KEY); return; }
      battle.addBuff(unit, { key: TAL_KEY, mods: { atkPct: lqAtk * n }, data: { n }, refresh: 'replace', tags: ['talent'] });
    };
    const lqReset = (battle, unit) => { unit.mem.noirc2Hits = 0; };

    /** 前方射程（3-2）内的敌人，best 优先 */
    const frontFoes = (battle, unit, grid) => {
      const keys = battle.absoluteRangeKeys
        ? battle.absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0)
        : null;
      const list = keys ? battle.enemiesInKeys(keys, unit, { canHitFly: true })
                        : battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
      return list || [];
    };

    /** 一次"居合"：对范围内一名敌人 s1Hits 连击 */
    const iai = (battle, unit, prefer) => {
      const list = frontFoes(battle, unit, RANGE_32);
      const target = (prefer && list.includes(prefer) ? prefer : list[0]) || null;
      if (!target || !target.alive) return false;
      battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: s1Hits, skill: 'noirc2:iai' });
      for (let i = 0; i < s1Hits; i++) {
        if (!target.alive) break;
        battle.dealDamage(unit, target, {
          amount: unit.s.atk * s1Scale, type: 'phys', canDodge: false, isSkill: true,
          tags: ['skill', 'noirc2:s1'],
        });
      }
      lqAdd(battle, unit);                 // "立即触发一次第二天赋"
      return true;
    };

    return {
      skills: {
        // ── S1 居合拔刀气刃斩 ──────────────────────────────────────────────
        [S1]: {
          kind: 'duration',
          duration: num(b1.duration, 6),
          attack: { noAttack: true },                       // "纳刀后停止攻击"
          targeting: { rangeGrid: RANGE_32 },
          onStart({ battle, unit }) {
            unit.mem.noirc2Iai = true;
            // 纳刀：一层护盾吸收下一次伤害（引擎自带 shield）
            battle.addBuff(unit, { key: 'noirc2:s1:shield', shield: Math.max(1, unit.s.maxHp * 0.15), visible: true });
            battle.fx('sermon', { x: unit.x, y: unit.y, id: unit.id });
          },
          onEnd({ battle, unit }) {
            unit.mem.noirc2Iai = false;
            battle.removeBuff(unit, 'noirc2:s1:shield');
          },
        },
      },
      // ── S2 气刃兜割（**默认技能**）──────────────────────────────────────
      skill: {
        kind: 'instant',
        flags: { invulnerable: true, unblockable: true, stunImmune: true, frozenImmune: true, disarm: true },
        targeting: { rangeGrid: RANGE_32 },
        onStart({ battle, unit }) {
          const list = frontFoes(battle, unit, RANGE_32);
          const target = list[0] || null;
          battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: s2Hits, skill: 'noirc2:s2' });
          if (target && target.alive) {
            for (let i = 0; i < s2Hits; i++) {
              if (!target.alive) break;
              battle.dealDamage(unit, target, {
                amount: unit.s.atk * s2Scale, type: 'phys', canDodge: false, isSkill: true,
                tags: ['skill', 'noirc2:s2'],
              });
            }
          }
        },
        onEnd({ battle, unit }) { lqDrop(battle, unit); },   // "技能结束后损失一层第二天赋加成"
      },
      talents: [{
        install(battle, unit) {
          // ── 天赋1 坚韧：随已损失生命线性上升的 攻速 + 防御% ─────────────
          const maxAs = num(t0.min_attack_speed), minHpRatio = num(t0.min_hp_ratio), maxDef = num(t0.max_def);
          if (maxAs > 0 || maxDef > 0) {
            battle.on('tick', () => {
              if (!up(unit)) return;
              const span = Math.max(1e-6, 1 - minHpRatio);
              const k = Math.max(0, Math.min(1, (1 - unit.hpRatio) / span));
              const as = maxAs * k, dp = maxDef * k;
              const cur = unit.findBuff('noirc2:jianren');
              if (cur && Math.abs((cur.data?.as ?? 0) - as) < 0.5 && Math.abs((cur.data?.dp ?? 0) - dp) < 0.005) return;
              if (as < 0.5 && dp < 0.005) { if (cur) battle.removeBuff(unit, 'noirc2:jianren'); return; }
              battle.addBuff(unit, { key: 'noirc2:jianren', refresh: 'replace', mods: { aspd: as, defPct: dp }, data: { as, dp }, tags: ['talent'] });
            }, { owner: unit });
          }
          // ── 模组的特性追加（X模组）：生命值低于 hp_ratio 时获得 damage_resistance 的庇护 ──
          //    照宴 chess_char_1_18-utage.js：同名效果取最高（holdProtect），每 tick 续一次、每次挨打再续一次。
          if (t0.damage_resistance != null && t0.hp_ratio != null) {
            const dr = num(t0.damage_resistance), below = num(t0.hp_ratio);
            const keep = () => { if (up(unit) && unit.hpRatio < below) holdProtect(battle, unit, dr, PROTECT_TICK_HOLD, unit); };
            battle.on('tick', keep, { owner: unit });
            onHitOn(battle, unit, keep);
          }
          // ── 天赋2 练气：非技能期间每 need_cnt 次伤害 +1 层 ────────────────
          battle.on('damaged', (c) => {
            if (c.source !== unit || !c.dmg || !(c.amount > 0)) return;
            if (unit.skill?.active) return;                    // 非技能期间才计数
            if (!up(unit)) return;
            unit.mem.noirc2Hits = num(unit.mem.noirc2Hits, 0) + 1;
            if (unit.mem.noirc2Hits >= lqNeed) { unit.mem.noirc2Hits = 0; lqAdd(battle, unit); }
          }, { owner: unit });
          // 受晕眩/冻结/缴械 或 释放技能 → 清空计数（PRTS 备注）
          battle.on('statusApplied', (c) => {
            if (c.target !== unit || !c.entered) return;
            if (c.status === 'stun' || c.status === 'freeze' || c.status === 'disarm') lqReset(battle, unit);
          }, { owner: unit });
          battle.on('skillStart', (c) => { if (c.unit === unit) lqReset(battle, unit); }, { owner: unit });
          // ── S1 的居合：护盾被消耗 / 期间挨打 → 反击 ─────────────────────
          battle.on('damaged', (c) => {
            if (c.target !== unit || !unit.mem.noirc2Iai) return;
            if (!(unit.skill?.active && unit.skill.id === S1)) return;
            const src = c.source;
            if (!src || src.side !== 'enemy') return;
            const seq = unit.deploySeq;
            battle.after(0, () => {
              if (!up(unit) || unit.deploySeq !== seq || !unit.mem.noirc2Iai) return;
              if (iai(battle, unit, src)) {
                // 再次纳刀：重新挂护盾
                battle.addBuff(unit, { key: 'noirc2:s1:shield', shield: Math.max(1, unit.s.maxHp * 0.15), visible: true });
              }
            }, { owner: unit });
          }, { owner: unit });
          // 技能期间击倒敌人 → 再次纳刀
          battle.on('kill', (c) => {
            if (c.killer !== unit || !unit.mem.noirc2Iai || !unit.skill?.active) return;
            battle.addBuff(unit, { key: 'noirc2:s1:shield', shield: Math.max(1, unit.s.maxHp * 0.15), visible: true });
          }, { owner: unit });
        },
      }],
    };
  },
};
// 工坊行为层的契约：default export 必须是**函数**（引擎风格的 { id: fn } 在这里不认）
export default __MOD[Object.keys(__MOD)[0]];
