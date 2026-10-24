// server/sim/content/kits/ops/chess_char_1_21-yuki.js — 白雪 (char_118_yuki) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, skillBbOf, moduleBb, moduleOn, statBuff, makeZone, isMainHit } from '@kit/tier1.js';

/** S1 敌飙 (the range lives in the record: skills[0].rangeGrid, 15 tiles). */
const S1 = 'skchr_yuki_1';
/** S2 凝武 (bb move_speed / dot). */
const S2 = 'skchr_yuki_2';
/** 飞镖在地面上的停留时间（用户指定 3 s；技能本身仍是 25 s 的 duration）。 */
const SHURIKEN_DUR = 3;
/** 减速的持续时间（PRTS 凝武「短时间内」；保留 25 s）。 */
const VEEP_SLOW_DUR = 25;
/** 凝武's shuriken zone radius (PRTS 备注 "开启后飞镖溅射范围缩小为半径0.75"). */
const S2_RADIUS = 0.75;

/** 模组 ART-Y 手里剑 (满级 3): 特性追加 "攻击时无视敌人100点防御力". */
const MOD_DEF_IGNORE = 100;
/** 模组新增天赋【风旭】: 击倒敌人后 10 秒内 技力回复速度 +0.3/s. */
const FENGXU_DUR = 10;

/** S2 on (the same test as ops/chess_char_1_07-prove.js:28). */
const s2On = (u) => !!(u && u.skill && u.skill.active && u.skill.id === S2);

/**
 * 凝武 (S2): "攻击变为投掷回旋的大飞镖" — each attack throws the shuriken at its target; the shuriken then
 * STAYS on the ground for the rest of the skill and keeps hitting whatever walks into it, slowing them and
 * burning them with arts damage per second (PRTS: 移动速度降低 N%，并每秒受到相当于攻击力 M% 的法术伤害).
 *
 * Modelled on 锡人 "大拉里" (ops/chess_char_1_16-tinman.js:33 `makeZone`): a zone at the impact point whose
 * onPulse runs every `interval` s for `duration/interval` pulses and deals `unit.s.atk × ratio` via
 * `battle.dealDamage`. 锡人's zone heals allies / withers enemies; this one slows + burns (the slow is
 * 白雪's own "短时间内使命中目标的移动速度降低 N%").
 */
function throwShuriken(battle, unit, e, ratio, ms) {
  const x = e ? e.x : unit.x + (unit.fwd ? unit.fwd[1] : 1);
  const y = e ? e.y : unit.y + (unit.fwd ? unit.fwd[0] : 0);
  const dmgType = 'arts';   // PRTS 凝武: 法术伤害
  makeZone(battle, unit, {
    x, y, radius: S2_RADIUS, duration: SHURIKEN_DUR, interval: 1, skill: 'yuki:veer',
    onPulse(b) {
      if (!unit.alive) return;
      for (const t of b.foesInRadius(x, y, S2_RADIUS)) {
        if (t.isFlying || (t.s && t.s.flags && t.s.flags.untargetable)) continue;
        // the slow: one buff per caster (an existing one is refreshed to the full S2 duration)
        if (ms > 0) {
          const key = `yuki:veer#${unit.id}`;
          const old = t.findBuff && t.findBuff(key);
          if (old) { old.timeLeft = VEEP_SLOW_DUR; old.duration = VEEP_SLOW_DUR; t.markDirty && t.markDirty(); }
          else b.addBuff(t, { key, duration: VEEP_SLOW_DUR, mods: { moveMul: Math.max(0, 1 - ms) }, source: unit, tags: ['skill', 'dot'] });
        }
        if (ratio > 0) b.dealDamage(unit, t, { amount: unit.s.atk * ratio, type: dmgType, isSkill: true, canDodge: false, tags: ['skill', 'dot', 'zone'] });
      }
    },
  });
}

const __MOD = {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_21 白雪 (炮手 / aoesniper): 特性 "攻击造成群体物理伤害" is the branch default (professions.js aoesniper:
  //   splashRadius 1.1 + canHitFly true), so no trait override here.
  //
  // 天赋 重型手里剑 (PRTS 精英2): "攻击间隔略微增大(+0.2)，但攻击力+20%". Only the +20% ATK is applied — the
  //   +0.2 bat penalty is skipped on purpose (the record's `desc` is "攻击力+20%", the real text lives in
  //   `descRaw`). Net: ATK +20%, no attack-speed penalty.
  //
  // S1 敌飙: "攻击范围+2格" for 25 s — the range is data (skills[0].rangeGrid, 15 tiles); the runtime reads
  //   `def.skill.rangeGrid`, so the spec only declares the duration kind.
  // S2 凝武: see throwShuriken.
  //
  // 模组 ART-Y 手里剑 (满级 3, elite only — `chess.module.active`, the same test as the engine's `moduleOn`):
  //   · attr {maxHp:160, atk:30, aspd:5} is composed into the elite's stats by shared/loadoutRecord.js.
  //   · 特性追加 "攻击时无视敌人100点防御力" → an unconditional buff mods.defIgnoreFlat (damage.js
  //     `eff = max(0, D − defIgnoreFlat)`; the same shape as 锏 SWO-Y `def_penetrate_fixed`).
  //   · 新增天赋【风旭】 → moduleBb carries sp_recovery_per_sec (0.3 at level 3); a kill grants
  //     mods.spRecoveryFlat for 10 s (the "击倒敌人后 N 秒内" shape of ops/chess_char_3_10-pinecn.js:36).
  chess_char_1_21_a: (bb, chess, def) => {
    const t0 = talentBb(chess, 0);
    const s2 = skillBbOf(chess, S2);
    const ms = Math.abs(num(s2.move_speed));
    const ratio = num(s2.dot);
    const on = moduleOn(chess);
    const mods = moduleBb(chess);
    const defIgnore = on ? MOD_DEF_IGNORE : 0;
    const fengxu = num(mods.sp_recovery_per_sec);
    return {
      skill: { kind: 'duration' },
      skills: {
        [S1]: { kind: 'duration' },
        [S2]: { kind: 'duration', mods: {} },
      },
      talents: [{ install(battle, unit) {
        statBuff(battle, unit, 'talent:yuki', { atkPct: num(t0.atk, 0.2) });
      } }],
      install(battle, unit) {
        if (defIgnore > 0) statBuff(battle, unit, 'module:yuki:defIgnore', { defIgnoreFlat: defIgnore });
        if (fengxu > 0) {
          battle.on('kill', (ctx) => {
            if (ctx.killer !== unit || !unit.alive) return;
            const v = ctx.victim;
            if (!v || v.side !== 'enemy') return;
            battle.addBuff(unit, { key: 'module:yuki:fengxu', duration: FENGXU_DUR, mods: { spRecoveryFlat: fengxu }, source: unit, tags: ['module', 'talent'] });
          }, { owner: unit });
        }
        // 凝武: ONE shuriken per ATTACK, at the target the attack landed on.
        //
        // ⚠ Must be `isMainHit`, not `dmg.isAttack`. A 炮手 (aoesniper) attack emits the main hit and then a SEPARATE
        // splash `dealDamage` per surrounding enemy (ai.js:308 vs :326) — both carry `isAttack`, so the old
        // `dmg.isAttack` test threw one shuriken for the main target and another for every splash victim (and the zones
        // then pelted the ground / kept hitting whatever walked in) — the 2026-10-12 report. `isMainHit` is the official
        // helper for exactly this: `isAttack && !isSplash && !tags.includes('chain')` (../shared/tier1.js:69).
        battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || !isMainHit(ctx.dmg)) return;
          if (!s2On(unit)) return;
          const e = ctx.target;
          if (!e || e.side !== 'enemy') return;
          throwShuriken(battle, unit, e, ratio, ms);
        }, { owner: unit });
      },
    };
  },
};
// 工坊行为层的契约：default export 必须是**函数**（引擎风格的 { id: fn } 在这里不认）
export default __MOD[Object.keys(__MOD)[0]];
