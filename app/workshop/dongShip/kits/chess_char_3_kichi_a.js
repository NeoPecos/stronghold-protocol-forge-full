// server/sim/content/kits/ops/chess_char_3_kichi-kichi.js — 吉星 (char_4203_kichi) kit, tier 3.
//
// 数据来源 PRTS，见 tools/gen-kichi.mjs 头部注释。
// 5★ 狙击/散射手（reaperrange）· 阵营 东
//
// 特性「攻击范围内所有敌人，对自身前方一横排的敌人攻击力提升至 150%（RPR-X 模组 160%）」
//   → **引擎自带**（professions.js:495 `reaperrange` 的 dmgMul + onFrontLine）；
//     trait.bb.atk_scale 由 TUNE 读入 profile.frontScale。本 kit 不重复实现。
//
// 天赋 好运连击！  上场后每击倒过一种敌人，自身造成的伤害 +6%，最多 3 层（按敌人的内部 id 去重）
// S1 欢迎您来！    攻击间隔 +0.5，每次攻击后攻击力 +20%，最多 4 层（持续 36 s）
// S2 吉星高照！    攻击间隔 +0.7，攻击力 +60%；攻击时依次循环施加 停顿 → 束缚 → 晕眩（各 1.3 s）
import { num, talentBb, skillBbOf, batMod } from '@kit/tier1.js';

const S1 = 'skchr_kichi_1';
const S2 = 'skchr_kichi_2';

// 停顿 / 束缚 / 晕眩 —— S2 的循环顺序（PRTS 备注：每次开启技能总是从停顿开始循环）
const CC_CYCLE = ['sluggish', 'bind', 'stun'];

const __MOD = {
  chess_char_3_kichi_a: (bb, chess, def) => build(bb, chess, def),
  chess_char_3_kichi_b: (bb, chess, def) => build(bb, chess, def),
};

function build(bb, chess, def) {
  const t0 = talentBb(chess, 0);          // 好运连击！
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);

  const perStack = num(t0.damage_scale, 0.06);
  const maxStack = Math.max(1, num(t0.max_stack, 3));
  const baseBat = num(chess?.stats?.bat, 2.3) || 2.3;

  return {
    // ------------------------------------------------------------------ 技能
    skills: {
      // S1：攻击间隔增大 + 攻击力逐次叠加（每次攻击 +N%，最多 4 层）
      [S1]: {
        kind: 'duration',
        duration: num(b1.duration, 36),
        mods: { batPct: batMod(num(b1.base_attack_time, 0.5), chess) },
        onStart({ unit }) { unit.mem.kichiS1Hits = 0; },
        onTick({ battle, unit }) {
          const n = unit.mem.kichiS1Hits | 0;
          const want = Math.min(maxStack, n) * num(b1.atk, 0.2);
          const have = unit.mem.kichiS1Atk || 0;
          if (Math.abs(want - have) < 1e-9) return;
          battle.removeBuff(unit, 'kichi:s1:atk');
          if (want > 0) battle.addBuff(unit, { key: 'kichi:s1:atk', mods: { atkPct: want }, tags: ['skill'], source: unit });
          unit.mem.kichiS1Atk = want;
        },
        onEnd({ battle, unit }) {
          battle.removeBuff(unit, 'kichi:s1:atk');
          unit.mem.kichiS1Atk = 0;
        },
      },
      // S2：攻击间隔增大 + 攻击力提升；每次攻击后按 停顿→束缚→晕眩 循环施加
      [S2]: {
        kind: 'duration',
        duration: num(b2.duration, 30),
        mods: { atkPct: num(b2.atk, 0.6), batPct: batMod(num(b2.base_attack_time, 0.7), chess) },
        onStart({ unit }) { unit.mem.kichiCc = 0; },
        install(battle, unit) {
          // 每次攻击命中敌人后施加一个状态（PRTS：每次攻击完成后更换效果）
          battle.on('hit', (c) => {
            const d = c.dmg, e = c.target;
            if (c.source !== unit || !e || e.side !== 'enemy' || !e.alive) return;
            if (!d || !(d.isAttack || d.isSkill)) return;
            if (!unit.skill?.active || unit.skill?.id !== S2) return;
            const kind = CC_CYCLE[unit.mem.kichiCc % CC_CYCLE.length];
            const dur = num(b2.cc_duration, 1.3);
            battle.applyStatus(e, kind, { duration: dur, source: unit });
            unit.mem.kichiCc = (unit.mem.kichiCc | 0) + 1;
          }, { owner: unit });
        },
      },
    },

    // ------------------------------------------------------------------ 天赋
    talents: [
      // 好运连击！：每击倒过一种敌人（按内部 id 去重），自身造成的伤害 +N%
      { install(battle, unit) {
        unit.mem.kichiKinds = new Set();
        battle.on('kill', (c) => {
          if (c.killer !== unit) return;
          const v = c.victim;
          if (!v || v.side !== 'enemy') return;
          // 敌人的"内部 id"：key / enemyId / id 里第一个可用的
          const key = v.def?.key ?? v.def?.enemyId ?? v.def?.id ?? v.kind ?? null;
          if (key == null) return;
          unit.mem.kichiKinds.add(key);
          const n = Math.min(maxStack, unit.mem.kichiKinds.size);
          battle.removeBuff(unit, 'kichi:talent');
          battle.addBuff(unit, { key: 'kichi:talent', mods: { dmgDealtMul: 1 + perStack * n }, tags: ['talent'], source: unit });
        }, { owner: unit });
        // 退场清空记录（PRTS：吉星退场后将清空自身记录的 id）
        battle.on('death', (c) => { if (c.unit === unit) { unit.mem.kichiKinds.clear(); battle.removeBuff(unit, 'kichi:talent'); } }, { owner: unit });
      } },
    ],

    // ------------------------------------------------------------------ install
    install(battle, unit) {
      // S1 的"每次攻击后 +1 层"计数
      battle.on('attack', (c) => {
        if (c.attacker !== unit) return;
        if (unit.skill?.id !== S1 || !unit.skill?.active) return;
        unit.mem.kichiS1Hits = (unit.mem.kichiS1Hits | 0) + 1;
      }, { owner: unit });
    },
  };
}
// 工坊行为层的契约：default export 必须是**函数**（引擎风格的 { id: fn } 在这里不认）
export default __MOD[Object.keys(__MOD)[0]];
