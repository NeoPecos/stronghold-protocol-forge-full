// server/modules/dong.mjs —— 东盟约的**对局级**装配（server.modules 的 matchClass 挂载点，DESIGN §28.14）
//
// 它做两件事，都只影响**这一局**：不改进程级数据、不改引擎文件、不需要 server.meta。
//
// ① 给【东】补一个 choices.json 池子（`pool_char_dongShip`），供引擎内置的 `SERVER_POOL_CHAR` 抽牌（黑角的特质）。
//    为什么必须在这一层：包的 `choices.json` 只能按 id 往 `data.choices` 顶层加记录，进不了 `choices.pools`
//    （`overrides` 只允许改已存在的字段 ⇒ 加新池子会被 UNKNOWN_OVERRIDE_FIELD 拒掉）。
//    做法：构造这一局时把 `data.choices.pools` 浅拷贝一份、补上池子再交给 Match。
//
// ② 给「艺人见面抽选券」装一个**每消耗 N 资金发一名干员**的处理器（`onSpend` 钩子）。
//    引擎的内置道具键里没有 onSpend 那种（20 个键全是 onEquip / onSold / onArt / onBattleResult / onBuy），
//    所以这里在这一局的**注册表副本**上注册一个 `item:chess_item_ws_artist_ticket`：
//      · 只在有抽选券记录时注册（没装本包的对局一行都不跑）；
//      · 用 `registry.fork()` 复制一份再改 —— 进程级那份（getDefaultRegistry）一个键都不动；
//      · 门槛与发放数量全部来自 items.json 的 `params`（普通 gold=15 / 精锐 gold=10）。
//
// 纪律：模块不 import 任何东西；不碰 process / Math.random / Date.now / 定时器 / 文件系统；随机一律走 ctx.rollChess。
const POOL_ID = 'pool_char_dongShip';
const POOL = Object.freeze({ kind: 'chess', bond: 'dongShip', maxTier: 'shopLevel', rule: 'shopEligible', assumed: true });
const ITEM_KEY = 'item:chess_item_ws_artist_ticket';
const TICKET_ID = 'chess_item_ws_artist_ticket_a';

/** 与携带者"有相同盟约"的随机干员（引擎 rollSameBond 的同一口径，只是不 import）。 */
function rollSameBond(ctx, bonds, maxTier) {
  const set = new Set(bonds || []);
  if (!set.size) return null;
  return ctx.rollChess({
    maxTier,
    filter: (cid) => {
      const c = ctx.gd.chess(cid);
      return !!(c && Array.isArray(c.bonds) && c.bonds.some((b) => set.has(b)));
    },
  });
}

const TICKET_HANDLER = {
  /** <消耗资金时>每累计 params.gold 资金 → 获得 1 名与携带者**已激活**盟约相同的干员（等级不高于当前商店等级）。 */
  onSpend(ctx, ev) {
    const src = ctx.source || {};
    const rec = ctx.source && ctx.source.item ? ctx.gd.item(ctx.source.item.id) : null;
    const need = rec && rec.params ? Number(rec.params.gold) : 0;
    const amount = ev && Number(ev.amount);
    if (!(need > 0) || !(amount > 0)) return;
    const uid = src.piece ? src.piece.uid : null;
    if (uid === null || uid === undefined) return;
    // 发放范围 = 携带者**已激活**的盟约（没有已激活的盟约就不累计、不发放）
    const holderUid = src.holder ? src.holder.uid : uid;
    const bonds = (ctx.pieceBonds(holderUid) || []).filter((b) => ctx.bondActive(b));
    if (!bonds.length) return;
    const maxTier = Math.max(1, Math.min(6, ctx.shopLevel()));
    const key = 'dong_ticket_gold:' + uid;
    const spent = ctx.incCounter(key, amount);
    const times = Math.floor(spent / need);
    if (times <= 0) return;
    ctx.setCounter(key, spent - times * need);
    for (let i = 0; i < Math.min(5, times); i++) {
      const id = rollSameBond(ctx, bonds, maxTier);
      if (!id) return;
      if (!ctx.grantChess(id)) return;
    }
  },
};

export function registerServer(host) {
  host.matchClass((Base) => class DongShipMatch extends Base {
    constructor(opts) {
      const data = opts && opts.data;
      const choices = data && data.choices;
      const pools = choices && typeof choices.pools === 'object' ? choices.pools : null;
      const ours = data && data.chess && data.chess['chess_char_2_noirc2_a'];
      // 没装本包的房间：原样交给 Base（与没有这个模块逐字节相同）
      if (!pools || !ours) return super(opts);
      const patched = Object.prototype.hasOwnProperty.call(pools, POOL_ID)
        ? data
        : { ...data, choices: { ...choices, pools: { ...pools, [POOL_ID]: POOL } } };
      super(patched === data ? opts : { ...opts, data: patched });

      // ② 抽选券的 onSpend 计数器：只在这一局的注册表副本上注册
      if (!this.gd || !this.gd.item || !this.gd.item(TICKET_ID)) return;
      const base = this.dispatcher && this.dispatcher.registry ? this.dispatcher.registry : this.registry;
      if (!base || typeof base.fork !== 'function') return;
      const fork = base.fork();
      fork.register(ITEM_KEY, TICKET_HANDLER);
      this.registry = fork;
      if (this.dispatcher) this.dispatcher.registry = fork;
    }
  });
}