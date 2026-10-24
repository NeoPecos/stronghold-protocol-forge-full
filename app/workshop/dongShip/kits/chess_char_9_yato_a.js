// server/sim/content/kits/ops/chess_char_9_yato-yato2.js — 麒麟R夜刀 (char_1029_yato2) kit, tier 6.
//
// 数据来源 PRTS（2026-10 抓取），见 tools/gen-yato.mjs 头部注释。
// 三个技能**全部是被动**（skillType: PASSIVE）：
//   S1 鬼人化        kind 'duration' + activateOnDeploy（部署即开启 20 s；先例 砾/宴/斯卡蒂）
//   S2 乱舞          kind 'instant'（部署即结算 16 次斩击）
//   S3 空中回旋乱舞   kind 'passive'（常驻）+ 自己调度"入场 → 隐身 → 弹道 → 现身"
//
// 天赋
//   双雷剑麒麟    每次攻击额外造成攻击力 N% 的法术伤害（独立实例，不触发敌人的受击回复）
//   鬼人强化状态   技能期间及技能结束后的 10 s 内攻击力 +N%
//
// 用户 2026-10 的三项决定：
//   · 弹道视觉用 orb 光球（'bolt'）
//   · 演出序列：先播入场动画 → 隐身 → 弹道飞完 → 现身（播 Skill_3_End）
//   · S1 六连击"近似实现"：直接把该次攻击补足成 6 次伤害，不改攻击节奏
import { num, talentBb, skillBbOf } from '@kit/tier1.js';

const S1 = 'skchr_yato2_1';
const S2 = 'skchr_yato2_2';
const S3 = 'skchr_yato2_3';

/** 该干员是否正在运行 `id` 技能（tier1.js 不导出这类判定，就地写一个） */
const skillOn = (u, id) => !!(u && u.skill && u.skill.active
  && (u.skill.id === id || u.skill.skillId === id));

/** S3 演出常量（PRTS 数值） */
const S3_SPEED = 8;              // 格/秒
const THRUST_PER_HIT = 0.3;      // 每造成一次技能伤害 +0.3 格
const THRUST_MAX = 5;            // 最大突进 5 格
const GHOST_LEAD = 1.0;          // 先播入场动画（Start_1 = 1.0 s）
const GHOST_FLIGHT = 1.4;        // 弹道飞行时间（安全值）

/** 天赋附加法伤的标签（递归防护） */
const TAG_ARTS = 'talent:yato2:arts';
const TAG_BOND = 'bond:dongShip';

const __MOD = {
  chess_char_9_yato_a: (bb, chess, def) => build(bb, chess, def),
  chess_char_9_yato_b: (bb, chess, def) => build(bb, chess, def),
};

function build(bb, chess, def) {
  const t0 = talentBb(chess, 0);                 // 双雷剑麒麟
  const t1 = talentBb(chess, 1);                 // 鬼人强化状态
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);
  const b3 = skillBbOf(chess, S3);

  const artsScale = num(t0.arts_scale, 0.20);
  const oniAtk = num(t1.atk, 0.13);
  const oniAfter = num(t1.after, 10);

  const aspd = num(b1.attack_speed, 70);
  const s1Hits = Math.max(1, num(b1.hits, 2));
  const s1Third = Math.max(1, num(b1.third_hits, 6));

  const s2Talent = num(b2.talent_scale, 2.1);
  const s2Scale = num(b2.atk_scale, 1.3);
  const s2Hits = Math.max(1, num(b2.hits, 16));
  const s2Taunt = num(b2.taunt, 1);

  const s3Scale = num(b3.atk_scale, 2.6);
  const s3Base = num(b3.thrust_base, 2);
  const s3Max = num(b3.thrust_max, THRUST_MAX);

  const tagged = (d, tag) => !!(d && Array.isArray(d.tags) && d.tags.includes(tag));

  /** 双雷剑麒麟：独立法术伤害实例（附带倍率，S2/S3 会乘） */
  const talentArts = (battle, unit, target, scaleMul = 1) => {
    const ratio = artsScale * scaleMul;
    if (!(ratio > 0) || !target || !target.alive) return;
    battle.dealDamage(unit, target, {
      amount: unit.s.atk * ratio,
      type: 'arts',
      canDodge: false,
      isSkill: !!unit.skill?.active,
      tags: [TAG_ARTS],
    });
  };

  return {
    // ------------------------------------------------------------------ 技能
    skills: {
      // S1 鬼人化：部署即开启 20 s；攻速 +N；攻击变二连击；对同一目标每第 3 次攻击补足六连击
      [S1]: {
        kind: 'duration',
        activateOnDeploy: true,
        duration: num(def?.skill?.duration, 20) || 20,
        spCost: 0, spType: 'none', trigger: 'NEVER',
        mods: { aspd },
        attack: { hits: s1Hits },
      },
      // S2 乱舞：瞬发，对前方一格所有敌人 16 次斩击；攻击倍率提升；期间更容易被攻击
      [S2]: {
        kind: 'instant',
        onStart({ battle, unit }) {
          battle.addBuff(unit, { key: 'yato2:s2:taunt', duration: 2.5, mods: { tauntLevel: s2Taunt }, tags: ['skill'], source: unit });
          const f = frontTile(unit);
          const foes = battle.foesInRadius(f.x, f.y, 0.6, true).filter((e) => e && e.alive && e.side === 'enemy');
          for (let i = 0; i < s2Hits; i++) {
            battle.after(i * 0.06, () => {
              if (!unit.alive) return;
              for (const e of foes) {
                if (!e.alive) continue;
                battle.dealDamage(unit, e, {
                  amount: unit.s.atk * s2Scale, type: 'phys', canDodge: false, isSkill: true,
                  tags: ['skill', 'yato2:s2'],
                });
                talentArts(battle, unit, e, s2Talent);
              }
            });
          }
        },
      },
      // S3 空中回旋乱舞：常驻被动；调度见 installS3
      [S3]: { kind: 'passive' },
    },

    // ------------------------------------------------------------------ 天赋
    talents: [
      // 双雷剑麒麟：每次攻击额外造成攻击力 N% 法术伤害
      { install(battle, unit) {
        battle.on('damaged', (c) => {
          const d = c.dmg, e = c.target;
          if (c.source !== unit || !d || !d.isAttack || !e || e.side !== 'enemy') return;
          if (tagged(d, TAG_ARTS)) return;      // 不对本天赋自己的伤害再触发
            if (tagged(d, TAG_BOND)) return;     // 盟约的追加攻击不吃夜刀天赋（否则伤害超模）
          talentArts(battle, unit, e, 1);
        }, { owner: unit });
      } },
      // 鬼人强化状态：技能期间及结束后 N 秒 攻击力 +X%
      { install(battle, unit) { installOni(battle, unit, oniAtk, oniAfter); } },
    ],

    // ------------------------------------------------------------------ install
    install(battle, unit) {
      installS1Combo(battle, unit, s1Third, { talentArts });
      installS3(battle, unit, { s3Scale, s3Base, s3Max, artsScale, lead: GHOST_LEAD, flight: GHOST_FLIGHT });
    },
  };
}

/** 干员正前方一格 */
function frontTile(u) {
  const f = u.fwd || [1, 0];
  return { x: u.x + f[1], y: u.y + f[0] };
}

// =====================================================================
// S1 六连击（近似实现）
//   对同一目标的每第 3 次主攻击，补足到 thirdHits 次伤害
// =====================================================================
function installS1Combo(battle, unit, thirdHits, opts = {}) {
  const count = new Map();
  battle.on('damaged', (c) => {
    const d = c.dmg, e = c.target;
    if (c.source !== unit || !d || !d.isAttack || d.isSplash) return;   // 只算主攻击
    if (!e || e.side !== 'enemy' || !e.alive) return;
    if (Array.isArray(d.tags) && d.tags.includes('yato2:combo')) return; // 自己的补充连击不计
    if (!skillOn(unit, S1)) return;
    const n = (count.get(e.id) || 0) + 1;
    count.set(e.id, n);
    if (n % 3 !== 0) return;
    for (let i = 1; i < thirdHits; i++) {
      battle.after(i * 0.05, () => {
        if (!unit.alive || !e.alive) return;
        battle.dealDamage(unit, e, {
          amount: unit.s.atk, type: 'phys', canDodge: false, isSkill: true,
          tags: ['skill', 'yato2:combo'],
        });
        // 用户 2026-10 决定：连击补刀也带天赋法伤（六连击 = 6 次攻击 + 6 次天赋）
        if (opts && opts.talentArts) opts.talentArts(battle, unit, e, 1);
      });
    }
  }, { owner: unit });
  battle.on('death', (c) => { if (c.unit === unit) count.clear(); }, { owner: unit });
}

// =====================================================================
// 天赋2 鬼人强化状态
// =====================================================================
function installOni(battle, unit, atk, after) {
  const KEY_ON = 'yato2:oni:skill';
  const KEY_AFTER = 'yato2:oni:after';
  const has = (k) => !!(unit.findBuff && unit.findBuff(k));
  const sync = () => {
    const on = !!unit.skill?.active;
    if (on) {
      battle.removeBuff(unit, KEY_AFTER);
      if (!has(KEY_ON)) battle.addBuff(unit, { key: KEY_ON, mods: { atkPct: atk }, tags: ['talent'], source: unit });
    } else {
      battle.removeBuff(unit, KEY_ON);
      if (!has(KEY_AFTER)) battle.addBuff(unit, { key: KEY_AFTER, duration: after, mods: { atkPct: atk }, tags: ['talent'], source: unit });
    }
  };
  battle.on('skillStart', sync, { owner: unit });
  battle.on('skillEnd', sync, { owner: unit });
  battle.every(0.25, sync, { owner: unit });
  sync();
}

// =====================================================================
// S3 空中回旋乱舞
//   ① 入场动画 GHOST_LEAD 秒（客户端播 Start_1）
//   ② 隐身：stealth + untargetable + invulnerable + unblockable
//   ③ 弹道：'bolt' 光球沿朝向飞；每个新敌人 → 伤害 + 天赋法伤 → 突进预算 +0.3
//   ④ 弹道结束 → 解除全部状态、现身（客户端播 Skill_3_End）
//
//   免疫：引擎的 `resist` 上限是 0.95（status.js resistOf），达不到 1/1000，
//         所以用 `beforeStatus` 取消（先例 op-ironmn.js:329 的 CRAB_IMMUNE）。
// =====================================================================
function installS3(battle, unit, opt) {
  const IMMUNE = ['stun', 'freeze', 'sleep'];
  const KEYS = { ghost: 'yato2:s3:ghost', invuln: 'yato2:s3:invuln' };

  // 免疫：只在 S3 隐身期间生效
  battle.on('beforeStatus', (c) => {
    if (c.target !== unit || !unit.mem.yato2S3Ghost) return;
    if (IMMUNE.includes(c.status)) c.cancel = true;
  }, { owner: unit });

  battle.on('skillStart', () => { if (skillOn(unit, S3)) run(battle, unit, opt, KEYS); }, { owner: unit });
  // S3 是常驻被动（部署即激活），skillStart 不一定再触发 —— 兜底在 install 后跑一次
  battle.after(0.1, () => { if (skillOn(unit, S3) || unit.skill?.id === S3 || unit.skill?.skillId === S3) run(battle, unit, opt, KEYS); });
}

function run(battle, unit, opt, KEYS) {
  if (unit.mem.yato2S3Ran) return;
  unit.mem.yato2S3Ran = true;

  battle.after(opt.lead, () => {
    if (!unit.alive || !unit.deployed) return;

    // ② 隐身 + 无敌 + 不可阻挡
    unit.mem.yato2S3Ghost = true;
    battle.addBuff(unit, { key: KEYS.ghost, flags: { stealth: true, untargetable: true }, tags: ['skill'], source: unit });
    battle.addBuff(unit, { key: KEYS.invuln, flags: { invulnerable: true, unblockable: true }, tags: ['skill'], source: unit });
    battle.fx('vanish', { x: unit.x, y: unit.y, id: unit.id });

    // ③ 弹道
    const f = unit.fwd || [1, 0];
    const dirR = f[0], dirC = f[1];
    const hitIds = new Set();
    let thrust = opt.s3Base;

    battle.addProjectile({
      from: unit,
      to: { x: unit.x + dirC * (opt.s3Base + 1), y: unit.y + dirR * (opt.s3Base + 1) },
      source: unit,
      visual: 'bolt',
      speed: S3_SPEED,
      maxAge: opt.flight,
      onHit({ target }) {
        if (!target || target.side !== 'enemy' || hitIds.has(target.id)) return;
        hitIds.add(target.id);
        battle.dealDamage(unit, target, {
          amount: unit.s.atk * opt.s3Scale, type: 'phys', canDodge: false, isSkill: true,
          tags: ['skill', 'yato2:s3'],
        });
        // "攻击倍率同时应用于第一天赋"
        battle.dealDamage(unit, target, {
          amount: unit.s.atk * opt.artsScale * opt.s3Scale, type: 'arts', canDodge: false, isSkill: true,
          tags: [TAG_ARTS, 'yato2:s3'],
        });
        thrust = Math.min(opt.s3Max, thrust + THRUST_PER_HIT);
      },
    });

    // ④ 弹道结束 → 现身
    battle.after(opt.flight, () => {
      if (!unit.alive) return;
      unit.mem.yato2S3Ghost = false;
      battle.removeBuff(unit, KEYS.ghost);
      battle.removeBuff(unit, KEYS.invuln);
      battle.fx('blink', { x: unit.x, y: unit.y, id: unit.id });
    });
  });
}

// 工坊行为层的契约：default export 必须是**函数**（引擎风格的 { id: fn } 在这里不认）
export default __MOD[Object.keys(__MOD)[0]];
