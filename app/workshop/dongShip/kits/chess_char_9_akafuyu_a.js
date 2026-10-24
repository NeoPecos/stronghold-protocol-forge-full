// workshop/dongShip/kits/chess_char_9_akafuyu_a.js — 赤冬 (char_475_akafyu) kit，tier 4（武者 / musha）。
//
// 数据来源：PRTS 赤冬页 + Kengxxiao/ArknightsGameData 的 character_table / skill_table / buff_template_data
// （2026-10-15 抓取），逐条对应见包内 PROVENANCE.md。
//
// 技能（两个都写在 skills 映射里，各自从自己的技能记录读 bb —— 普通 Lv4 / 精锐 Lv7）：
//   S1 信影流·雷刀之势   kind 'duration'：阻挡数变为 0（-99 ⇒ 现阻挡的敌人被放开，与宴 S1 同一写法）、攻击力 +N%、攻击变二连击；
//                       普攻仍是自动回复/手动触发（数据 trigger DEFAULT），12 秒
//   S2 信影流·十文字胜   kind 'duration'：开启瞬间流失 50% 当前生命（保底留 1 点，官方备注）、
//                       获得一层护盾（shieldHits 1：整次伤害实例被挡下 —— 官方 buff akafyu_s_2[dmg_bubble] 的 BlockDamage +
//                       FinishBuff，与夜莺/临光同一引擎机制）、攻击力 +N%、防御力 +N%，技能结束 ⇒ 护盾一起消失
//   默认技能 = S1（记录里 skills[0].isDefault = true）
//
// 天赋
//   信影流·羽飞（天赋 1）  坚忍：按已损失生命比例线性加攻速，最多 +min_attack_speed（精英2 = +100，损失 70% 时吃满）
//                          —— 与宴「认真模式」(ops/chess_char_1_18-utage.js) / 赫拉格 同一套实现
//   信影流·逆风（天赋 2）  阻挡敌人时防御力 +N%（X 模组 2 级 +8% / 3 级 +12%）
//
// 模组（SBL-X 武将甲胄）
//   隐藏天赋的 25% 庇护（生命值低于 50% 时）在数据里只是特性的 moduleDesc 显示文案 —— 官方 宴 的记录同样如此
//   （引擎没有任何一行读它），所以这里按同样的判据只做显示、不进战斗；真正生效的是上面那条 +12% 防御。
import { num, talentBb, skillBbOf, up } from '@kit/tier1.js';

const S1 = 'skchr_akafuyu_1';
const S2 = 'skchr_akafuyu_2';
const SHIELD = 'akafuyu:s2:shield';

export default function akafuyu(bb, chess, def) {
  const t0 = talentBb(chess, 0);                        // 信影流·羽飞（坚忍）
  const t1 = talentBb(chess, 1);                        // 信影流·逆风（阻挡时防御）
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);
  const s1 = b1 && Object.keys(b1).length ? b1 : bb;    // 选中 S1 时 bb 与它同一条记录
  // 同一份 kit 也要服务精锐记录（引擎按 baseId 回退），而 def.skill 只有**默认那条**（S1）⇒ 时长按技能自己的
  // 记录读，读不到才回落到 def.skill.duration。
  const dur = (rec, d) => {
    const v = rec && rec.duration;
    return Number.isFinite(v) && v > 0 ? v : (Number.isFinite(d) && d > 0 ? d : 0);
  };
  const durSk = (sid, fallback) => dur((chess?.skills ?? []).find((s) => s && s.skillId === sid) ?? (chess?.skill?.skillId === sid ? chess.skill : null), fallback);

  // 坚忍：损失生命越多，攻速越高（线性），最多 min_attack_speed，损失到 1 - min_hp_ratio 时吃满
  const berserk = { install(battle, unit) {
    const maxAs = num(t0.min_attack_speed), minHp = num(t0.min_hp_ratio, 1);
    if (!(maxAs > 0) || !(minHp < 1)) return;
    const key = 'talent:akafuyu:berserk';
    battle.on('tick', () => {
      if (!up(unit)) return;
      const v = maxAs * Math.max(0, Math.min(1, (1 - unit.hpRatio) / (1 - minHp)));
      const cur = unit.findBuff(key);
      if (cur && Math.abs((cur.data?.v ?? -1) - v) < 0.5) return;
      if (v < 0.5) { if (cur) battle.removeBuff(unit, key); return; }
      battle.addBuff(unit, { key, mods: { aspd: v }, data: { v }, tags: ['talent'] });
    }, { owner: unit });
  } };

  // 信影流·逆风：阻挡敌人时防御力 +
  const guard = { install(battle, unit) {
    const d = num(t1.def);
    if (!(d > 0)) return;
    const key = 'talent:akafuyu:guard';
    battle.on('tick', () => {
      const want = up(unit) && unit.blocking.length > 0;
      const has = unit.findBuff(key);
      if (want && !has) battle.addBuff(unit, { key, mods: { defPct: d }, tags: ['talent'] });
      else if (!want && has) battle.removeBuff(unit, key);
    }, { owner: unit });
  } };

  return {
    skills: {
      // S1 雷刀之势：12 秒，攻击力 +N%，二连击，阻挡数归零（放开已阻挡的敌人）
      [S1]: {
        kind: 'duration',
        duration: durSk(S1, num(def?.skill?.duration, 12)) || 12,
        mods: { atkPct: num(s1.atk, 0.5), blockCnt: -99 },
        attack: { hits: Math.max(1, num(s1.hits, 2)) },
        onStart({ battle, unit }) { battle.releaseBlocked(unit); },
      },
      // S2 十文字胜：开启瞬间流失 50% 当前生命（保底 1 点）+ 一层护盾 + 攻/防加成，技能结束护盾消失
      [S2]: {
        kind: 'duration',
        duration: durSk(S2, num(def?.skill?.duration, 20)) || 20,
        mods: { atkPct: num(b2.atk, 0.7), defPct: num(b2.def, 0.9) },
        onStart({ battle, unit }) {
          const loss = unit.hp * num(b2.hp_ratio, 0.5);
          if (loss > 0) battle.loseHp(unit, Math.min(loss, Math.max(0, unit.hp - 1)), { source: unit });
          battle.addBuff(unit, { key: SHIELD, shieldHits: 1, visible: true, tags: ['skill'], source: unit });
          battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
        },
        onEnd({ battle, unit }) {
          if (unit.findBuff(SHIELD)) {
            battle.removeBuff(unit, SHIELD);
            battle.fx('shieldBreak', { x: unit.x, y: unit.y, id: unit.id });
          }
        },
      },
    },
    talents: [berserk, guard],
  };
}