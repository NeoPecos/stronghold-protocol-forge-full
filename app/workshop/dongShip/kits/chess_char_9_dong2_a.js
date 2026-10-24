// chess_char_9_dong2_a.js —— 嵯峨（普通版；精锐版共用同一实现，特质数值由 garrison_saga_dong_a/_b 区分）
// 内联官方 op-saga.js；破隐是本包外挂的（官方没有这个机制）
import { num, talentBb, moduleBb, traitBb, skillRec, toggleBuff, batMod, giveSp, up } from '@kit/tier1.js';
import { absoluteRangeKeys, canTargetEnemy, sortEnemyTargets } from '@sim/targeting.js';
import { AURA, whileDeployed, reveal, enemiesOnRange } from '@kit/tier4.js';

// ---- 内联：官方 op-saga.js ----
const __saga = (() => {
// server/sim/content/kits/ops/op-saga.js — 嵯峨 (char_362_saga) 自选 operator kit: 6★ 尖兵 (先锋), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_362_saga, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); gamedata_const ba.dying
// "重伤: 移速下降且无法被阻挡，10秒后自然死亡，被击杀后使击杀者回复数点技力"; PRTS 嵯峨 (劝善 备注 "本天赋第一部分实际效果为：
// 自身造成的伤害不会致命（至多使目标生命值降至1点），成功造成伤害后若目标生命值小于等于1则为目标附加重伤"; 清明 备注 "嵯峨每次
// 部署都可以触发一次本天赋"; S2 备注 "可选择重伤单位", "攻击附加延迟检测Buff：0.7s后进行检测，强制击杀持有重伤的目标（击杀来源为
// 嵯峨自身），随后解除目标的重伤"; S3 备注 "造成伤害前判断目标生命值"); PRTS 术语释义 重伤 ("重伤Buff包含：移动速度-80%，禁疗、
// 禁用近战，阻挡数、生命回复速度、生命回复速度（百分比）归零，从消失状态变为出现的瞬间立刻死亡（消失状态期间不会因重伤自然死亡）",
// "重伤造成的自然死亡为强制死亡（也即可以杀死持有不死的单位），视为无来源击杀", "重伤期间的单位无法再被施加重伤"); PRTS 异常效果
// 禁用近战 "敌人类单位无法进行阻挡攻击，无法被阻挡".
// - Trait (尖兵) "能够阻挡两个敌人": the profession default (block 2). SOL-X 何处寻驮？ "阻挡敌人时攻击力和防御力各+8％"
//   (trait bb atk / def): +atk / +def while she blocks an enemy. SOL-Y 身向云泥 "首次部署时部署费用-4" (hidden
//   runtime_cost −4): the first deployment of a battle costs nothing in this mode ⇒ no effect (as 推进之王's SOL-Y).
// - T1 劝善: her damage is never lethal to an enemy (a `fatal` hook keeps it at 1 HP — every damage of hers: attacks, 除恶;
//   not a 无来源 one, which has no source); after a damage of hers an enemy at ≤ 1 HP becomes 重伤 (the DYING buff, once:
//   none while it holds one): move speed ×(1 + move_speed) (−80 %), unblockable (禁用近战: released by its blocker, no
//   block attack), 禁疗 (healFree / noHeal), its HP regeneration zeroed; it dies `interval` s later (10) — a forced, 无来源
//   death (battle.kill with no killer: no SP, 不死 does not hold it) — not while it is 消失 (hidden), and at once when it
//   comes back from 消失. Whoever kills a 重伤 enemy gets `sp` SP (2; "击杀者技力+2", giveSp: not during a timed skill).
//   "嵯峨不攻击重伤单位": the kit trait `skipEnemy` (targeting.js canTargetEnemy) — no normal attack, block target or
//   trigger target of hers is a 重伤 enemy. SOL-X stage 2+ "对生命值低于一半的单位造成的伤害提升15%" (hidden hp_ratio /
//   damage_scale): ×damage_scale on every damage of hers whose target is below hp_ratio before it.
//   A shared-pool leader (boss rounds: its HP is the pool's, damage.js runs no `fatal` step for it) is outside 劝善
//   [ASSUMED: her damage there is ordinary].
// - T2 清明 "生命值低于40%时，仅一次获得70%物理闪避和每秒回复5%的最大生命，持续15秒" (full potential: 6 %, 17 s): once per deployment (PRTS 备注), the first
//   time a damage leaves her below hp_ratio of her max HP: dodgePhys prob and hpRegenRatio for `duration` s — the
//   blackboard key hp_recovery_per_sec_by_max_hp_ratio is the 生命回复速度（百分比） attribute (PRTS 异常效果 禁疗 / 术语释义
//   重伤 name it), as 宴 S1 / 山 / 幽灵鲨 / 蜜蜡 / 烛煌 apply it [ASSUMED: no 备注 of 清明 says so; 余's 闲云隐市 with the same
//   key is still open, DESIGN 0.2.0.l3]. SOL-Y stage 2+: the talent change's numbers — at stage 3, full potential: 7 % per second for 20 s (text and
//   blackboard 0.07 agree; at potential 0 the text read 6 % while the blackboard was 0.065: the game applies the blackboard).
// - S1 冲锋号令·γ型 (AUTO, no target): +cost DP at once; an AUTO skill acting on nobody fires as soon as its SP is full
//   (`trigger: 'SP_FULL'`, as 推进之王's / 德克萨斯's kits cast the same skill — the owner's AUTO rule).
// - S2 除恶 (MANUAL, 2 charges, data SKILL_RANGE on its x-6 cross: any enemy there, 无视其不可选中): +cost DP; the up to
//   S2_MAX (6, the text's — no blackboard key) selectable ground enemies of the cross ("地面敌人"; a 重伤 one included:
//   "可选择重伤单位"), best targets first (her priority) [ASSUMED order], take atk_scale × ATK physical (a skill damage;
//   劝善 applies); S2_CHECK s later each of them still 重伤 is killed (killer 嵯峨: she gets its SP, stats and bounty; a
//   forced kill — battle.kill, no `fatal` step), then its 重伤 is lifted (should a kill handler have revived it).
// - S3 怒目 (MANUAL, 20 s, data ACTIVE_RANGE on her 1-1 + 1): +cost DP every interval s while it runs (value in all; the
//   rest of value at its natural end), attack interval +base_attack_time s (+0.5 on her 1.05), 攻击距离 +1
//   (targeting.rangeExtend), ATK +atk, every enemy she blocks at once (hitAllBlocked; one target in range while she
//   blocks none), and one more attack on each target that was below attack@hp_ratio before the hit (PRTS 备注: an HP
//   snapshot at beforeAttack; the extra attack is a forced one a tick later, no 重伤 target).
// Melee physical, ground-only (canHitFly false), ground enemies target her normally (no 起飞 / 迷彩 / 隐匿).



const S1 = 'skcom_charge_cost[3]';
const S2 = 'skchr_saga_2';
const S3 = 'skchr_saga_3';
/** The 重伤 buff (gamedata_const ba.dying): one per enemy — "重伤期间的单位无法再被施加重伤". */
const DYING = 'saga:dying';
/** S2 除恶 备注 "攻击附加延迟检测Buff：0.7s后进行检测" (no blackboard key). */
const S2_CHECK = 0.7;
/** S2 除恶 "对十字范围内最多6名地面敌人" — the text's number when it cannot be read (no blackboard key). */
const S2_MAX = 6;
/** The x-6 cross (skill range) when the data carries no grid. */
const X6 = Object.freeze([[2, 0], [1, 0], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]]);
/** 除恶's selection: ground enemies only ("地面敌人"), 重伤 ones included (no skipEnemy). */
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });

/** Is `e` 重伤 (whoever put it there)? */
const isDying = (e) => !!(e && typeof e.findBuff === 'function' && e.findBuff(DYING));

/**
 * 重伤 on enemy `e` from `saga` (PRTS 术语释义 重伤): move speed ×(1 + ms), unblockable (禁用近战), 禁疗, no HP regeneration;
 * a forced, 无来源 death `life` s later — never while 消失, at once when it comes back from 消失. The killer of a 重伤
 * enemy gets `sp` SP (the talent's kill hook reads `data.sp`). Nothing when it already holds one.
 */
function applyDying(battle, saga, e, { sp, life, ms }) {
  if (!e || !e.alive || isDying(e)) return;
  battle.addBuff(e, {
    key: DYING, source: saga, visible: true,
    mods: { moveMul: Math.max(0, 1 + ms), hpRegen: -1e9 },
    flags: { unblockable: true, healFree: true, noHeal: true },
    data: { sp, until: battle.time + life, hidden: !!e.hidden },
    onTick: ({ battle: b, unit: x, buff }) => {
      const d = buff.data;
      if ((d.hidden && !x.hidden) || (!x.hidden && b.time + 1e-9 >= d.until)) { b.kill(x, null); return; }
      d.hidden = !!x.hidden;
    },
  });
  battle.fx('dying', { x: e.x, y: e.y, id: e.id, from: saga.id });
}

const __default = {
  char_362_saga: (bb, chess) => {
    const b1 = skillRec(chess, S1)?.bb ?? {}, b2 = skillRec(chess, S2)?.bb ?? {}, b3 = skillRec(chess, S3)?.bb ?? {};
    const s2 = skillRec(chess, S2);
    const t0 = talentBb(chess, 0);   // 劝善: move_speed, sp, interval
    const t1 = talentBb(chess, 1);   // 清明: hp_ratio, hp_recovery_per_sec_by_max_hp_ratio, prob, duration
    const hidden = moduleBb(chess);  // SOL-X stage 2+: hp_ratio, damage_scale; SOL-Y: runtime_cost (no effect)
    const tb = traitBb(chess);       // SOL-X: atk, def while blocking
    const picked = chess?.skill?.skillId ?? null;
    const maxHit = Math.max(1, Math.floor(num(/最多(\d+)名/.exec(String(s2?.desc ?? ''))?.[1], S2_MAX)));
    return {
      // 劝善 "嵯峨不攻击重伤单位"
      trait: { skipEnemy: isDying },
      skills: {
        [S1]: {
          kind: 'instant', trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            const n = num(b1.cost);
            battle.addDp(unit.ownerId, n);
            battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
          },
        },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          onStart({ battle, unit }) {
            const n = num(b2.cost);
            battle.addDp(unit.ownerId, n);
            battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
            const keys = absoluteRangeKeys(s2?.rangeGrid ?? X6, unit.tileR, unit.tileC, unit.dir, 0);
            const list = battle.enemiesInKeys(keys, unit, GROUND);
            sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
            const hit = list.slice(0, maxHit);
            battle.fx('aoe', { x: unit.x, y: unit.y, radius: 2, id: unit.id, skill: 'saga:cleanse', n: hit.length });
            for (const e of hit) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale, 1), type: 'phys', isSkill: true, tags: ['saga:s2'] });
              if (!e.alive) continue;
              battle.addBuff(e, {
                key: 'saga:s2check', refresh: 'independent', maxStacks: 99, duration: S2_CHECK, source: unit,
                onExpire: ({ battle: b, unit: x }) => {
                  if (!x.alive || !isDying(x)) return;
                  b.kill(x, unit);
                  if (x.alive) b.removeBuff(x, DYING);
                },
              });
            }
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
          targeting: { rangeExtend: num(b3.ability_range_forward_extend) },
          attack: { hitAllBlocked: true },
          onStart({ unit }) { unit.mem.sagaDp = { acc: 0, got: 0 }; },
          onTick({ battle, unit, dt }) {
            const st = unit.mem.sagaDp;
            const iv = num(b3.interval, 1), n = num(b3.cost), total = num(b3.value);
            if (!st || !(iv > 0) || !(n > 0)) return;
            st.acc += dt;
            while (st.acc + 1e-9 >= iv && st.got + n <= total + 1e-9) {
              st.acc -= iv;
              st.got += n;
              battle.addDp(unit.ownerId, n);
            }
          },
          onEnd({ battle, unit, reason }) {
            const st = unit.mem.sagaDp;
            unit.mem.sagaDp = null;
            // the last grant falls on the very end of its 20 s
            if (st && reason === 'duration' && num(b3.value) - st.got > 1e-9) battle.addDp(unit.ownerId, num(b3.value) - st.got);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 劝善
          const sp = num(t0.sp), life = num(t0.interval, 10), ms = num(t0.move_speed, -0.8);
          // "自身造成的伤害不会致命（至多使目标生命值降至1点）" — before any other saver: it never was lethal
          battle.on('fatal', (c) => {
            if (c.source === unit && c.unit && c.unit.side === 'enemy' && !c.prevented) c.prevented = true;
          }, { owner: unit, priority: 100 });
          // "成功造成伤害后若目标生命值小于等于1则为目标附加重伤"
          battle.on('damaged', (c) => {
            const e = c.target;
            if (c.source !== unit || !e || e.side !== 'enemy' || !e.alive || e.bossPool || c.type === 'element' || e.hp > 1) return;
            applyDying(battle, unit, e, { sp, life, ms });
          }, { owner: unit });
          // "被击杀后使击杀者回复数点技力" — the killer of a 重伤 enemy she marked (none for the 无来源 natural death)
          battle.on('kill', (c) => {
            const d = c.victim && typeof c.victim.findBuff === 'function' ? c.victim.findBuff(DYING) : null;
            if (!d || d.source !== unit || !c.killer || c.killer.side !== 'ally') return;
            giveSp(c.killer, num(d.data?.sp));
          }, { owner: unit });
          // SOL-X stage 2+: "对生命值低于一半的单位造成的伤害提升15%"
          const hr = num(hidden.hp_ratio), ds = num(hidden.damage_scale, 1);
          if (hr > 0 && ds !== 1) {
            battle.on('hit', (c) => {
              if (c.source === unit && c.target && c.target.side === 'enemy' && c.target.hpRatio < hr) c.dmg.mul *= ds;
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 清明: once per deployment below hp_ratio — dodgePhys prob, hpRegenRatio, `duration` s
          const hr = num(t1.hp_ratio), p = num(t1.prob), regen = num(t1.hp_recovery_per_sec_by_max_hp_ratio), dur = num(t1.duration);
          if (!(hr > 0) || !(dur > 0)) return;
          battle.on('damaged', (c) => {
            if (c.target !== unit || !up(unit) || unit.mem.qingmingAt === unit.deploySeq) return;
            if (!(unit.hp < unit.s.maxHp * hr)) return;
            unit.mem.qingmingAt = unit.deploySeq;
            battle.addBuff(unit, { key: 'talent:saga:qingming', duration: dur, mods: { dodgePhys: p, hpRegenRatio: regen }, visible: true, tags: ['talent'] });
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'saga:qingming' });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // SOL-X 何处寻驮？: 阻挡敌人时攻击力和防御力各+8％
        const ma = num(tb.atk), md = num(tb.def);
        if (ma || md) toggleBuff(battle, unit, 'trait:saga:block', () => unit.blocking.length > 0, { atkPct: ma, defPct: md });
        // 怒目: one more attack on each target below attack@hp_ratio (checked before the hit) — a forced attack a tick later
        if (picked !== S3) return;
        const hp3 = num(b3['attack@hp_ratio']);
        if (!(hp3 > 0)) return;
        let half = null;
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit || unit.mem.sagaExtra || !unit.skill?.active) return;
          half = (c.targets || []).filter((e) => e && e.side === 'enemy' && e.hpRatio < hp3);
        }, { owner: unit, priority: -100 });
        battle.on('attack', (c) => {
          if (c.attacker !== unit || unit.mem.sagaExtra) return;
          const list = half;
          half = null;
          if (!list || !list.length) return;
          const dep = unit.deploySeq;
          battle.after(0, () => {
            if (!up(unit) || unit.deploySeq !== dep || !unit.canAct || unit.s.flags.disarm) return;
            const t = list.filter((e) => e.alive && canTargetEnemy(unit, e, unit.profile));
            if (!t.length) return;
            unit.mem.sagaExtra = true;
            try { battle.forceAttack(unit, t, { noAmmo: true }); } finally { unit.mem.sagaExtra = false; }
          }, { owner: unit });
        }, { owner: unit });
      },
    };
  },
};

return __default;
})();

// ---- 本包：破隐（层数共鸣是纯数据，见 garrison_saga_dong_a/_b）----
// server/sim/content/kits/ops/chess_char_9_dong2-saga.js —— 嵯峨 (char_362_saga) 的【常驻池棋子】委托 kit.
//
// 与 chess_char_9_dong1-haruka.js 同理：嵯峨原本是自选干员，kit 键是 charId。本文件把棋子 baseId
// (chess_char_9_dong2) 也注册到同一实现上，这样她作为常驻池棋子也能跑完整 kit（特质 / 三技能 / 天赋）。
//
// ── 【东】特质：层数 → 攻击力 / 生命值 / 攻击速度 ─────────────────────────────
//   **不用写一行代码**：garrison_saga_dong 的 effectKey = act1autochess_gar_eff_attrByBond
//   （照抄迷迭香的 garrison_09_a），引擎在 server/sim/content/garrisons/battle.js:417 处理：
//     stepsOf()  = floor(Σ 所列盟约层数 / divide_num)
//     attrMods() = directMods({atk,hp,def}) → atkPct / hpPct（**百分比**，加算）
//                  bb.attack_speed        → m.aspd（**平值**，加到基础 100 上）
//     layerGain 事件 → 层数一变立刻重算，实时生效
//   数值全在 bb 里（divide_num=3，atk/max_hp=0.015，attack_speed=1.5）。
//
// ═══════════════════════════════════════════════════════════════════════════════
// ── 技能破隐（2026-10-15 **对照 PRTS 百科重设计**）────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
//   百科（https://prts.wiki/w/嵯峨）关键事实：
//     · 天赋1 劝善: 造成致命伤害时使敌人保留1点生命并使其【重伤】（击杀者技力+1）；
//                   **嵯峨不攻击重伤单位**
//     · S2 除恶（范围 x-6）: 对**十字范围内最多6名地面敌人**造成伤害，之后**消灭其中重伤的敌方单位**；
//                   可充能 1~3 次。备注：0.7s 后检测，**强制击杀**持有重伤的目标
//     · S3 怒目（持续20）: 攻击距离+1、攻击力+40%~130%、同时攻击**阻挡的所有敌人**
//     ★ 百科里**没有**「破隐」这个机制 —— 破隐是外挂上去的。
//
//   ⇒ 但百科恰恰指出了破隐**该挂在哪**：
//       `canTargetEnemy`（targeting.js:85）会过滤隐匿敌人 ——
//         `if (f.stealth && enemyStealthed(e)) return false;`
//       所以她的**普攻、S2 选敌、劝善全都碰不到隐匿敌人**，整条「劝善（打成1血+重伤）
//       → 除恶（斩杀重伤）」链对隐匿单位是**断的**。
//       **破隐的意义 = 让隐匿敌人能进入她的斩杀链**，而不是"多一个光环"。
//
//   S2 除恶 —— 破隐**绑在技能自己的选敌上**（对话确认的方案）：
//     onStart: ① 先破隐 —— absoluteRangeKeys(自己的 rangeGrid = x-6 十字)
//                           → 十字内的**隐匿地面**敌人 → 挂 flags.reveal，时长 bb.reveal_duration
//              ② 再跑原 onStart（选敌 → 伤害 → 0.7s 后斩杀重伤）
//     为什么②在同一帧就能看到①的结果：units.js:112 `get s() { if (this._dirty) this._recalc(); }`
//       —— flags 是**惰性重算**的，addBuff 之后下一次读 e.s.flags 就已经生效（enemyStealthed 也读它）。
//     为什么时长要 1.2s：S2 的斩杀检测在 **0.7s** 后（op-saga.js S2_CHECK），
//       共享 reveal() 硬编码的 AURA_DUR=0.25s **撑不到**那一刻。所以这里用 bb.reveal_duration。
//     ⇒ 语义：**"这一刀本来就劈得到隐匿的东西"**，与百科「对十字范围内最多6名地面敌人」对齐。
//
//   S3 怒目 —— 破隐**保持原样**（对话确认"保持现状"）：
//     技能开启期间每 bb.reveal_interval(1.0s) 脉冲一次，用 tier4 的共享 `reveal()`
//     （= 每 0.25s 的 buff 时长，所以显形是**断续**的：1.0s 里显形 0.25s）。
//     范围 = unit.rangeKeys（技能的 targeting.rangeExtend=1 已把它刷成"本体+1"）。
//     想把 S3 也做成连续显形：把下面的 `revealFor(…)` 换成带 reveal_duration 的那版即可（一行）。
//
//   封锁：对话确认"**只要显形，不要 silence**" —— 两个技能都不再施加 silence。



const S2 = 'skchr_saga_2';   // 除恶（瞬发/充能）
const S3 = 'skchr_saga_3';   // 怒目（持续 20s）
const REVEAL_SKILLS = new Set([S2, S3]);

/** 数据里没有 rangeGrid 时的 x-6 十字（与 op-saga.js:62 的 X6 同一份）。 */
const X6 = Object.freeze([[2, 0], [1, 0], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]]);

/**
 * 只显形（不附带 silence）：给 `foes` 里**隐匿**的挂 `flags.reveal`。
 * 这就是 tier4.js:92 的共享 `reveal()`，只把硬编码的 AURA_DUR 换成调用方给的时长
 * —— S2 的显形必须撑过 0.7s 的斩杀检测窗口，0.25s 不够。
 * buff key 沿用引擎约定 `'aura:reveal'`。
 * @returns 被显形的数量
 */
function revealFor(battle, foes, dur) {
  let n = 0;
  for (const e of foes) {
    if (!e || !e.s || !e.s.flags || !e.s.flags.stealth) continue;
    battle.addBuff(e, { key: 'aura:reveal', mods: null, duration: dur, flags: { reveal: true } });
    n++;
  }
  return n;
}

/**
 * S2 除恶：把破隐接到技能**自己的选敌**上。
 * 破隐范围 = 技能自己的 rangeGrid（数据里是 x-6 十字），只算**地面**敌人
 * （百科写的是"对十字范围内最多 6 名**地面**敌人"）。先破隐、再跑原 onStart。
 */
function wrapS2Reveal(base, grid, dur) {
  if (!base || typeof base.onStart !== 'function') return base;
  return {
    ...base,
    onStart(ctx) {
      const { battle, unit } = ctx;
      const keys = new Set(absoluteRangeKeys(grid ?? X6, unit.tileR, unit.tileC, unit.dir, 0));
      const foes = enemiesOnRange(battle, unit, keys).filter((e) => !e.isFlying);
      if (revealFor(battle, foes, dur) > 0) {
        battle.fx('reveal', { x: unit.x, y: unit.y, id: unit.id, r: 2, skill: 'saga:reveal' });
      }
      return base.onStart(ctx);              // ← 原选敌/伤害/0.7s 斩杀，同一帧就能看见上面的 reveal
    },
  };
}

/** S3 怒目：保持原样 —— 技能开启期间每 reveal_interval 脉冲一次（共享 reveal()，0.25s）。 */
function installSkillReveal(battle, unit, bb) {
  const iv = num(bb.reveal_interval, 1);
  if (!(iv > 0)) return;
  battle.every(iv, () => {
    if (!unit.alive || !unit.deployed) return;
    const sk = unit.skill;
    if (!sk || !sk.active) return;
    if (!REVEAL_SKILLS.has(String(sk.id ?? ''))) return;
    const foes = enemiesOnRange(battle, unit);
    const stealthed = foes.filter((e) => e.s && e.s.flags && e.s.flags.stealth);
    if (!stealthed.length) return;
    reveal(battle, stealthed);               // 共享辅助：pulse 'aura:reveal' + flags.reveal
    battle.fx('reveal', { x: unit.x, y: unit.y, id: unit.id, r: 2, skill: 'saga:reveal' });
  }, { owner: unit, immediate: true });
}

const __WRAP = {
  chess_char_9_dong2: (bb, chess, def) => {
    const kit = __saga.char_362_saga(bb, chess, def);
    const skills = chess?.skills ?? [];
    const picked = chess?.skill?.skillId ?? skills.find((s) => s.isDefault)?.skillId ?? null;
    // 破隐只在选中除恶 / 怒目时挂（跟 op-saga.js 里 S3 的 hp_ratio 附加攻击同一个门控）
    if (!REVEAL_SKILLS.has(picked)) return kit;
    // 破隐参数：先看被选中技能自己的 bb，缺了就从另一个技能取（两个技能共享一套参数）
    const own = skills.find((s) => s.skillId === picked)?.bb ?? {};
    const alt = skills.find((s) => s.skillId === (picked === S2 ? S3 : S2))?.bb ?? {};
    const bbReveal = { ...alt, ...own };
    const revDur = num(bbReveal.reveal_duration, 1.2);

    return {
      ...kit,
      // S2：包一层它自己的 onStart（选敌之前先破隐）
      //   ⚠ 不用碰 `kit.skill` —— op-saga.js 的基础 kit **没有** skill 字段，
      //   它靠 `selectSkillSpec`（content/index.js:214）把 `skills[选中的那个]` 提升成 `skill`。
      //   所以只要包好 skills[S2]，选中 S2 时引擎拿到的 skill 就是包过的版本。
      skills: { ...kit.skills, [S2]: wrapS2Reveal(kit.skills?.[S2], skills.find((s) => s.skillId === S2)?.rangeGrid, revDur) },
      install(battle, unit) {
        if (typeof kit.install === 'function') kit.install(battle, unit);
        // S3：保持原样（每 reveal_interval 脉冲一次）
        if (picked === S3) installSkillReveal(battle, unit, bbReveal);
      },
    };
  },
};

export default __WRAP[Object.keys(__WRAP)[0]];
