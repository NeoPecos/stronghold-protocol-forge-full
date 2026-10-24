// ui/contracts.js — 危机合约 (Crisis Contract) screen.
//
// 明日方舟的危机合约 UI 是:全屏暗底、左侧一列可勾选的合约条目、右下角一个醒目的「危机点数」总计、选中项高亮成
// 橙/红(危险)。这里照那个骨架做,配色沿用本项目的暗底 + 薄荷/琥珀/红三色。
//
// 规则全部来自 shared/contracts.js —— 界面不自己记分数,`contractPoints` 是唯一算法,服务端用同一张表校验。
// 所以「合约分数」在结算画面和这里必然一致。

import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, Modal, Fragment, useTicker } from './components.js';
import { CONTRACTS, contractPoints, contractBasePoints, contractAvailable, contractBlockers, resolvePicked, contractName, contractsAllowedAt, crisisActive } from '../../../shared/contracts.js';
import { contractSets, setProgress, contractTree, contractLinkPaths, CELL_W, LINK_GEO } from '../../../shared/contractSets.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';

/** 拼 class 名(filter(Boolean) 收掉 false/''/null)。 */
const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 点数显示：风险词条带 +，补偿协议保留负号。 */
const signedPoints = (n) => (n > 0 ? `+${n}` : String(n));

/** 总分档位只表达强度预期，帮助房主循序加码。 */
const riskBand = (points) => {
  if (points <= 3) return { key: 'adapt', name: '适应', hint: '适合初次尝试' };
  if (points <= 7) return { key: 'advance', name: '进阶', hint: '需要有成型阵容' };
  if (points <= 12) return { key: 'danger', name: '高危', hint: '需要围绕词条构筑' };
  if (points <= 18) return { key: 'extreme', name: '极限', hint: '建议熟练队伍挑战' };
  return { key: 'catastrophe', name: '灾变', hint: '仅适合追分挑战' };
};

/** 难度键 → 中文名(「绝境模拟」)。 */
const diffName = (d) => t(DIFFICULTY_NAMES[d] || d);

// Some source terms list a prerequisite in `excludes` as a tier replacement.
// The resolver deliberately keeps that prerequisite, so show only the contracts
// that an actual selection would remove.
const cancelledByAdding = (id, picked, players, difficulty) => {
  if (picked.includes(id)) return [];
  const next = resolvePicked([...picked, id], players, difficulty, { add: id });
  return picked.filter((other) => !next.includes(other));
};

/**
 * 危机点数从 0 滚到 `value`(owner:「界面改的再炫酷点」)。
 *
 * 用现成的 `useTicker`(components.js)按帧推进,而不是 CSS 动画 —— 数值要跟着**真的变化**,
 * 而 CSS 只能动外观。全程 520 ms,选了合约时那个数字滚上去,一眼看出"这局更难了"。
 *
 * ⚠ 起点存在 ref 里、不放进依赖:放进依赖会让 effect 每帧自我触发(每帧 setShown → 重跑 → 再 setShown)。
 * ⚠ `value` 变小时**直接跳**:取消勾选不该看着分数慢慢掉,那会让人以为还在扣分。
 *
 * @param {number} value 目标值 @param {number} [ms] 时长
 */
function useCountUp(value, ms = 520) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useTicker(shown !== value ? 16 : 0);
  useEffect(() => {
    const from = fromRef.current;
    if (value <= from) { fromRef.current = value; setShown(value); return undefined; }
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      // easeOutCubic:开头快、结尾稳,分数"落定"的感觉
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(from + (value - from) * e);
      fromRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/**
 * 一条合约的**瓦片** (owner:「合约形式改成图片 按照这样的来」).
 *
 * 参考图里每个合约是一块**方形图片**(红底 + 图形 + 左下角点数 + 左上角勾选)。这里照那个形状做:
 *   · 图标占满整块 —— `Icon` 名来自数据 `c.icon`(见 shared/contracts.js),没有就退到通用的 `warn`;
 *   · 左上角勾选方块,选中变白底打勾;
 *   · 左下角一个黑底三角 + 点数,和参考图一致(琥珀色,本项目的"加难度"色);
 *   · 名称放在瓦片**下面**一行 —— 官方那个图形玩家认得出,我们的自研图标不配名字没人看得懂。
 *
 * 不可用时整块压暗 + 一道斜纹 + 一个锁,原因逐条写在 `title` 上(瓦片没空间铺一行文字)。
 *
 * @param {{ c: any, on: boolean, usable: boolean, players: number, difficulty: string|null,
 *           picked: readonly string[],
 *           onDetail: Function, onToggle: Function, index?: number }} props
 */
function ContractTile({ c, on, usable, players, difficulty, picked, onDetail, onToggle, index = 0 }) {
  /** 不能选的原因,逐条(分开说人数与难度,房主才知道该改哪个)。 */
  const block = contractBlockers(c, players, difficulty, picked);
  const lack = block.map((b) => {
    if (b.kind === 'players') return t('需要 {n} 人及以上的房间', { n: b.need });
    if (b.kind === 'difficulty') return t('需要难度 {name} 或更高', { name: diffName(b.need) });
    return t('需要先选择：{list}', { list: b.need.map(contractName).join('、') });
  });
  /** 会挤掉谁(互斥是对称的,所以这里列的是"选它就会取消的")。 */
  const kicks = usable ? cancelledByAdding(c.id, picked, players, difficulty) : [];
  const why = [
    t(c.desc),
    ...lack,
    kicks.length ? t('选择后将取消：{list}', { list: kicks.map(contractName).join('、') }) : '',
  ].filter(Boolean).join('\n');
  /*
   * 点瓦片 = **只在中间栏打开它的说明**,不改变勾选 (owner:「点击合约不会直接启用 要在窗口启动」)。
   *
   * ⚠ 这里绝对不能顺手 `onToggle`。第一版就是两件事一起做,于是"点一下看看说明"就悄悄把合约启用了
   * —— owner 的原话:「点击下个就会切换」,他要的是浏览。
   *
   * 双击 = **启用 / 关闭这一条** (owner:「再加个双击启用关闭合约」)。
   * 单击仍然只看说明,所以"看"与"改"是分开的;双击是给熟练玩家的快捷键,
   * 中间栏那个「启用 / 取消」按钮照旧(它是看得见、能发现的那条路)。
   *
   * ⚠ **开不了的合约(`usable === false`)双击不生效** (owner:「无法开启的合约左键可以查看简介
   * 但是确定按钮改为禁用 无法双击启用」)。这类是人数 / 难度 / 前置不满足的(瓦片上有锁)——
   * 说明照样能看,但改不了。不给这道闸的话双击会走到 `toggleAccept` → `resolvePicked` 把
   * 开不了的那条筛掉 → 提交一个和原来一样的列表,**看起来像"点了没反应"**,比直接禁掉更差。
   */
  const clickFace = () => onDetail(c.id);
  const dblFace = () => { if (usable) onToggle(c.id); };
  return html`<div class=${`ctile${c.kind === 'boon' ? ' is-boon' : ''}${on ? ' is-on' : ''}${usable ? '' : ' is-locked'}`}
      data-contract=${c.id} style=${`--i:${index}`}>
    ${/*
       * ⚠ 锁住的瓦片**不加原生 `disabled`** —— 原生禁用的按钮**不派发 click**,
       * 于是"单击查看启用条件"就没了(owner 明确要:「单击可以查看启用条件 但是写的禁用」)。
       * 所以:视觉与语义上禁用(`aria-disabled` + `.is-locked` 的斜纹/锁图标/压暗),
       * 但**可以点** —— 点进去在中间栏看到它缺什么;真正改状态的那一步由 `dblFace` 的守卫拦掉。
       */ null}
    <button type="button" class="ctile__face" role="checkbox" aria-checked=${on ? 'true' : 'false'}
      aria-disabled=${usable ? 'false' : 'true'}
      title=${`${t(c.name)}${c.nameEn ? ' · ' + c.nameEn : ''}\n${why}\n${usable ? t('双击启用 / 关闭') : t('本条尚未解锁')}`}
      onClick=${clickFace} onDblClick=${dblFace}>
      <${Icon} name=${c.icon || 'warn'} class="ctile__glyph" />
      <span class="ctile__tick">${on ? html`<${Icon} name="check" />` : null}</span>
      ${usable ? null : html`<span class="ctile__lock"><${Icon} name="lock" /></span>`}
      ${/*
         * 瓦片上那枚「部分未生效」角标**已去掉** (owner:「取消这个部分未生效 我自己来就行了」)。
         *
         * 整套「未实现机制」标注随后也一并删了 (owner:「危机合约模式删除这个说明 不要了 不需要这个了」)——
         * 它唯一的条目 `bountyRounds` 已经不再是"未实现"的声明,留着就是一套永远为空的机制。
         * 见 shared/contractEffects.js 的说明。
         */ null}
      <span class="ctile__pts"><b class="num">${c.points}</b></span>
    </button>
    ${/*
       * ⚠ 这里原来有一段**内嵌的说明**(`ctile__detail` + `ctile__bad`),现在**删掉了**
       * (owner:「为啥每个合约底下有这个 都去掉」)。它把瓦片撑高、把连线树挤乱,
       * 而且同一段文字在中间栏已经完整显示一份,列表里那一小段又窄又难读。
       * 说明只有一个地方:中间栏。瓦片只留图标 / 点数 / 名字。
       */ null}
    <button type="button" class="ctile__name" title=${t('单击看说明 · 双击启用 / 关闭')}
      onClick=${() => onDetail(c.id)} onDblClick=${dblFace}>${t(c.name)}</button>
  </div>`;
}
/**
 * 危机合约界面。
 *
 * @param {{ open: boolean, room: any, isHost: boolean, busy?: string|null,
 *           onClose: Function, onApply: (ids: string[]) => void }} props
 */
export function ContractsPanel({ open, room, isHost, busy = null, onClose, onApply }) {
  const capacity = Number.isInteger(room?.seatCap) ? room.seatCap : (Number.isInteger(room?.maxSeats) ? room.maxSeats : 0);
  const difficulty = room?.difficulty ?? null;
  /**
   * 本局已经启用的合约 —— **直接来自房间,不是本地草稿**。
   *
   * 这里原来是一个 `useState` 草稿(勾选改它、「确定」才提交)。owner 把流程改成
   * "点瓦片只看说明、启用只在中间栏点「取消」"之后,勾选不再由这个面板发生:
   * 每次「启用」都直接发 `room.setContracts`,服务端广播回来改写 `room.contracts`,
   * 所以它天然就是响应式的,不需要(也不该有)一份本地副本 —— 有副本就会和房间不同步。
   */
  const picked = new Set(room?.contracts || []);
  const [detail, setDetail] = useState(null);
  /**
   * 指标集折叠 (owner:「指标集可以折叠」).
   *
   * 默认**全开**。记的是"被**收起**的集 id"而不是"展开的" —— 这样新增的集默认是展开的,不用维护初始化。
   */
  const [closed, setClosed] = useState(() => new Set());
  /**
   * ★ 打开界面就放危机合约的音乐 (owner:「进入危机合约界面播放 危机合约结算画面的背景音乐」)。
   *
   * ⚠ 依赖 `open`:这个组件在房间页是**常驻挂载**的(`<ContractsPanel open=${ctrOpen} …/>`),
   * 空依赖数组会让它一进房间就切曲(那时 `open` 还是 false)。清理函数负责关标志 —— `open` 变 false 时
   * effect 重跑,先执行上一次的清理。
   * 用 `useEffect` 而不是在渲染里直接调:它会去动音频图,放进渲染期会在 Preact 批处理下重复触发。
   */
  /**
   * Escape 关闭。
   *
   * 这个面板**不是** `Modal`(它是自己画的全屏遮罩),所以拿不到 `Modal` 内建的 Esc 处理。
   * 必须有:窄屏(≤1240px)下中间栏整条收掉,「返回」跟着没了 —— 没有 Esc 就**关不掉面板**,
   * 只能刷新页面。用捕获阶段,免得被别的 keydown 处理先吃掉。
   */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  /**
   * 每次**打开**都把中间栏的选中项清回空态。
   *
   * 组件在房间页是常驻挂载的(`open` 变来变去),不清的话:上次关界面时停在「重伤残」,
   * 这次打开中间栏还显示它 —— 但那时玩家根本没在看那一条。
   */
  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setJustToggled(null);
    setCascaded(null);
  }, [open]);

  /**
   * ★ 每次渲染都跑一遍解算 (`shared/contracts.js` resolvePicked)。
   *
   * 为什么放在渲染里而不是只在 toggle 时跑:房主可能随时改人数/难度(那是**服务端**广播回来的),
   * 那一刻已经有选择变得不合法了。把它做成"从当前状态推出合法状态"的纯函数,两种情况就同一套逻辑。
   *
   * ⚠ 它**不写回** state(那会在渲染期 setState)。真正落库的是 `ids`(房间当前生效的那些);
   *   界面显示的一律以解算结果为准。
   */
  const ids = resolvePicked([...picked], capacity, difficulty);
  /**
   * 这一条**现在能不能启用** —— 中间栏按钮禁用、双击守卫、瓦片锁都用它。
   *
   * 判据就是 `contractAvailable(c, …, ids)`,也就是**三道纯门槛**:
   *   1. 人数够(沿 `requires` 链取最严的那个);
   *   2. 难度够;
   *   3. **前置都已启用**(`requires` 里每一条都在当前选择集里)。
   *
   * ⚠ 前置是**硬门槛**,不是"自动拉链"。owner 的原话:
   * 「如果鳞片前置是披甲铁卫 且精锐之敌未启用 其他应该为灰色状态 只不过单击可以查看启用条件 但是写的禁用」。
   * 也就是「披甲铁卫」没启用时,「鳞片」「山」都该是**灰锁**的,点不开,但**能点进去看它要什么**。
   *
   * ⚠ 我中途改错过一次:把它写成"把整条前置链拉进来之后它还在不在"(`resolvePicked(...).includes(c.id)`),
   * 于是链上任何一条随时都能点、锁全没了 —— 那是错的。`resolvePicked` 的 `chainUp` 只在
   * **前置已经满足、允许你点**之后负责把链补齐,不该被拿来绕过这道门槛。
   */
  const canEnable = (c) => !!c && contractAvailable(c, capacity, difficulty, ids);
  /** 被解算剔掉的那些(挤掉 / 门槛不符),给一句说明。 */
  const dropped = [...picked].filter((id) => !ids.includes(id));
  /** 总分 = 合约点数 + 难度基础分(终极 +2)。算法只在 shared/contracts.js 里有一份。 */
  const points = contractPoints(ids, difficulty);
  /*
   * `base`(难度基础分)在 278 行的「难度基础分 +2」那一项里用到;
   * `maxPoints`(全部合约点数之和)在 owner 说「将这个 15 去掉」之后**没有任何用处**了 —— 已删。
   */
  const base = contractBasePoints(difficulty);
  /** 指标集分组 (shared/contractSets.js): 界面按集渲染,一行一集。 */
  const sets = contractSets(CONTRACTS);
  /**
   * 中间栏是**隐式**的:没点过任何合约就空着(保留那一条窄栏,左右两栏的宽度因此始终不变 —— owner 要的)。
   *
   * ⚠ 不要再给"默认选中"兜底(第一版给过 `ids[0] ?? 第一条`),那样打开面板中间栏就自己冒出内容,
   * 而 owner 要的是「默认该 ui 不打开除非点了协议」。现在 `detail === null` = 空栏。
   */
  const selected = detail ? CONTRACTS.find((c) => c.id === detail) || null : null;
  /**
   * 中间栏那一条**能不能开** —— 和瓦片的锁用同一个判据(`canEnable`),所以两处永远一致。
   *
   * ⚠ 用 `ids`(解算结果)而不是下面那个 `pickedSet`,两者是同一个集合 ——
   * `pickedSet` 在这一行**之后**才声明,`const` 的 TDZ 会让这里直接抛错。
   *
   * ⚠ 已经启用的那条**永远算能开**(哪怕此刻门槛不满足)——
   * 不然房主把人数从 20 降到 4 之后就再也点不到「取消」,那条合约卡在房间里出不来了。
   */
  const selectedUsable = !!selected && (ids.includes(selected.id) || canEnable(selected));
  /** 开不了的原因(按钮的 tooltip 用,与瓦片同一套文案)。 */
  const selectedBlockers = selected ? contractBlockers(selected, capacity, difficulty, ids) : [];
  /**
   * 刚做过的那一下开关动作,给中间栏那行红字用:`true` = 刚启用,`false` = 刚取消,`null` = 没有。
   *
   * ⚠ 只记**动作**,不记**是哪一条**。第一版记成 `{ id, on }`,于是取消掉「重伤残」之后
   * 再去看「训练不足」,红字还写着「已取消合约「重伤残」」—— 而面板里显示的是训练不足
   * (owner 就是照这张图来问的)。名字一律由 `selected` 推,红字永远说的是当前这一条。
   *
   * 它是**本地**状态:服务端接受之后由 `room.contracts` 广播回来,但那要等一个往返;
   * 确认字要立刻出现,所以在这里记一份。面板每次打开、以及**切换看哪一条**时都会清掉。
   */
  const [justToggled, setJustToggled] = useState(null);
  /**
   * 关掉一条前置时**被连带关掉的下游** (owner:「如果双击前置会关闭需要该前置的合约」)。
   *
   * 例:开着「精锐之敌 → 披甲铁卫 → 鳞片 → 山」,双击关掉「披甲铁卫」,
   * 那「鳞片」和「山」也都必须掉 —— 否则会留下"前置没了却还开着"的僵尸合约。
   *
   * 数值是那一刻被移除的 id 列表;`null` = 没有这回事。切一条或重开面板就清掉。
   */
  const [cascaded, setCascaded] = useState(null);
  /**
   * 中间栏那个按钮干的事:**开 / 关这一条合约**。
   *
   * ⚠ 它是个**开关**,不是固定的「启用」(owner:「启用了不会变为取消啊」)。
   * 这一条已经在 `ids` 里 → 按钮显示「取消」,点它把这一条从房间里去掉;
   * 否则显示「启用」,点它把这一条**加进**房间。
   *
   * ⚠ 必须是**累加 / 删除**,不能覆盖。
   * 第一版图省事写成 `onApply(isOn ? [] : [id])` —— 覆盖式提交,于是
   * 「启用合约之后启用另外个,上个合约会被关闭」(owner 原话)。
   * 房间本来就能同时跑多条合约(右侧「已开启」那一栏就是为了列它们),
   * 所以这里提交的永远是"现有的 ± 这一条"。
   *
   * ⚠ 删的时候**不能再写 `ids.filter(...)`** —— 那样只删掉这一条,依赖它的下游会留下。
   * 必须把新列表**再解算一次**:`resolvePicked` 里的 `propagate()` 专门干这件事
   * (「取消一个合约会连带取消依赖它的下游,否则会留下'前置没了却还选着'的僵尸状态」)。
   * 传 `{ add: null }`(也就是不传),走的是列表顺序那条路,正好用于"给定一个列表,解出自洽状态"。
   *
   * 互斥那一侧同样由 `resolvePicked` 保证,这里不手写。
   */
  const toggleAccept = async (id) => {
    const isOn = ids.includes(id);
    let next;
    let removed = [];
    if (isOn) {
      next = resolvePicked(ids.filter((x) => x !== id), capacity, difficulty);
      /* ⚠ 要排掉自己 —— 提示写的是"**连带**取消了谁",把自己列进去就重复了(自己那行红字已经说了) */
      removed = ids.filter((x) => x !== id && !next.includes(x));
    } else {
      next = resolvePicked([...picked, id], capacity, difficulty, { add: id });
    }
    const okDone = await onApply(next, isOn ? null : id);
    if (okDone !== false) {
      setJustToggled(!isOn);
      /* 只记**连带掉的那些**(不含自己);没有就连 `null`,免得渲染一句空话 */
      setCascaded(removed.length ? removed.map((x) => contractName(x)) : null);
    }
  };
  /**
   * 打开某一条的说明 —— **顺便清掉上一句确认红字**。
   *
   * 红字现在按 `selected` 取名,但如果不在这里清,切换之后它会"改口"成新那一条的名字
   * (刚取消完重伤残、点开训练不足,红字就变成「已取消合约「训练不足」」)——
   * 那是假的,训练不足根本没被取消过。所以切一条就清一次。
   */
  const showDetail = (id) => { setJustToggled(null); setCascaded(null); setDetail(id); };
  /** 已开启的合约,按集顺序排(右侧「已开启」栏)。 */
  const pickedSet = new Set(ids);
  const pickedList = sets.flatMap((s) => s.contracts.filter((c) => pickedSet.has(c.id)).map((c) => ({ c, set: s })));
  const shownPoints = useCountUp(points);
  /*
   * 这里原来有 `inert` / `inertKeys` —— 把"声明了未实现机制"的合约标出来。
   * **已删** (owner:「危机合约模式删除这个说明 不要了 不需要这个了」):
   * 它唯一的条目是「新战线」的 `bountyRounds`,而那条声明已经拿掉了,
   * 于是 `unimplemented` 永远是空数组、这个集合永远是空的 —— 一套不会再触发的机制。
   * 服务端那边的 `UNIMPLEMENTED` 表也一并删了(shared/contractEffects.js)。
   */

  /*
   * 这里原来有一个 `toggle(id)`(点瓦片勾选 / 取消勾选),**已删**。
   *
   * owner 的新流程是"浏览 → 在窗口里启用":点瓦片只打开说明,**不改变任何选择**
   * (「点击合约不会直接启用 要在窗口启动 点击下个就会切换」)。
   * 启用只有一条路 —— 中间栏的「取消」(`accept`)。取消已启用的合约则走「完成」后的重新选择。
   */

  if (!open) return null;
  return html`<div class="ctrscreen" role="dialog" aria-modal="true" aria-label=${t('危机合约')}>
    <div class="ctrscreen__bg" aria-hidden="true"></div>
    ${/* 红色轻雾 + 顶部呼吸红光(owner:「会带有红色轻雾特效 危机感」)。纯装饰,`pointer-events: none`。 */ null}
    <div class="ctrscreen__mist" aria-hidden="true"></div>
    <div class="ctrscreen__glow" aria-hidden="true"></div>
    ${/*
       * 进入动画的三条扫光 (owner:「增加进入危机合约界面的动画」).
       * 纯 CSS:入场时 `--i` 错开 0 / 1 / 2 各延迟 90 ms,一次性扫过就停在透明(animation-fill-mode: forwards),
       * 不占运行时、不重排。`prefers-reduced-motion` 下整块关掉(见 css)。
       */ null}
    <div class="ctrscreen__sweep" aria-hidden="true"><i style="--i:0"></i><i style="--i:1"></i><i style="--i:2"></i></div>
    <header class="ctrscreen__top">
      ${/*
        * ★ 恒在的关闭按钮(owner:「房间成员进入危机合约界面后 无法退出危机合约」)。
        *
        * 以前这个界面在窄屏(≤1240px)上可能一个能点的出口都没有:
        *   · ctrscreen__actions(右下角的「完成」)在窄屏被整行藏掉;
        *   · 唯一的「返回」在 ctrdetail__act 里,而那一栏的渲染条件是 isHost && selected
        *     —— 非房主永远看不到它;
        *   · 就算你是房主,selected 为 null(刚打开、什么都没点)时那一栏也是空的;
        *   · 没选合约时 ctrdetail:not(:has(ctrdetail__head)) 还会把整栏 display:none。
        * 于是只剩 Escape 一条路 —— 而界面上没有任何文字提示过这件事,玩家就卡在里面了。
        *
        * 这个按钮无条件渲染、放在顶栏右上角,不参与任何窄屏折叠规则:
        * 它是「我进错了 / 我看完了,出去」的保底出口,和「完成 / 返回」那些跟随状态的按钮不是一回事。
        *
        * ⚠ 这段注释里不能出现块注释的结束符(一个星号加一个斜杠)—— 它会把外面的 JS 块注释
        *   提前结束掉,然后报错位置指向**整个模板字符串的结尾**(下面几百行之后),
        *   完全看不出是这里的问题。我自己刚写完整条警告就在同一个注释里踩了一次。
        */ null}
      <${Button} variant="ghost" size="sm" icon="close" class="ctrscreen__close"
        onClick=${onClose} title=${t('关闭')} aria-label=${t('关闭')}><//>
      <${MicroLabel} tone="amber">CRISIS CONTRACT</${MicroLabel}>
      <h2 class="ctrscreen__title">${t('危机合约')}</h2>
      <p class="ctrscreen__sub">${t('选择本局生效的合约。勾选越多，难度越高，危机点数也越高。')}</p>
    </header>

    <div class="ctrscreen__body">
      <section class="ctrscreen__list" aria-label=${t('合约列表')}>
        ${sets.map((s, si) => {
    const prog = setProgress(s, picked);
    const openSet = !closed.has(s.id);
    /** 这一集的连线树 (shared/contractSets.js contractTree):档位组一列、共享孩子挂最深档。 */
    const tree = contractTree(s);
    /** 连线的 SVG 路径(单位坐标,1 格 = 一块瓦片)。 */
    const linkPaths = contractLinkPaths(tree);
    const flip = () => setClosed((cur) => {
      const next = new Set(cur);
      if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
      return next;
    });
    return html`<section key=${s.id} class=${cx('ctrset', !openSet && 'is-closed')} data-set=${s.id} style=${`--si:${si}`}>
            <header class="ctrset__head">
              ${/* 折叠按钮:整条标题栏都能点,箭头用 chevronRight 转 90°(ICONS 里没有 chevronDown) */ null}
              <button type="button" class="ctrset__fold" aria-expanded=${openSet ? 'true' : 'false'} onClick=${flip}>
                <${Icon} name="chevronRight" class=${cx('ctrset__caret', openSet && 'is-open')} />
                <span class="ctrset__idx num">${s.index}</span>
                <span class="ctrset__names">
                  <b class="ctrset__name">${t(s.name)}</b>
                  ${s.nameEn ? html`<${MicroLabel} tone="amber">${s.nameEn}<//>` : null}
                </span>
              </button>
              ${/* 集进度:选了几条 / 共几条,以及这一集贡献了多少分 —— 收起时也看得到 */ null}
              <span class="ctrset__prog num">${prog.count}<small>/${prog.total}</small></span>
              ${prog.points ? html`<span class=${cx('ctrset__pts', prog.points < 0 && 'is-boon')}>${signedPoints(prog.points)}</span>` : null}
            </header>
            ${openSet ? html`<div class="ctrset__body ctrset__body--tree"
              style=${`--cols:${tree.cols};--rows:${tree.rows}`}>
              ${/*
                 * 连线用**一层 SVG** 画,节点用绝对定位摆上去。
                 *
                 * 为什么不做成 CSS 网格 + 伪元素:绝对定位的网格子项,其包含块是"它被分配到的网格区域",
                 * 而连线是用 inline style 给 `grid-column` 定位的 —— 解析拿不到那个区域时 `left: 50%` 会按
                 * **整个容器**算(实测 818px 容器上算出 409px,线被甩到屏幕右侧)。加了负 margin 又会被
                 * 滚动容器的 `overflow` 裁掉。
                 * SVG 只需要一组明确的坐标,不受包含块与自动摆放的影响,而且能画参考图里那种圆角折线。
                 *
                 * `viewBox` 用"格"为单位(1 格 = 一块瓦片),所以缩放/换主题都不用重算路径。
                 */ null}
              <svg class="ctrtree" aria-hidden="true"
                viewBox=${`0 0 ${tree.cols * CELL_W} ${tree.rows * LINK_GEO.rowH}`}
                preserveAspectRatio="none">
                ${linkPaths.map((p) => html`<path key=${p.key} d=${p.d} />`)}
              </svg>
              ${tree.nodes.map((n, i) => html`<div key=${n.c.id} class="ctrnode"
                  style=${`left:calc(${n.x - tree.minX} * ${CELL_W}rem);top:calc(${n.y} * ${LINK_GEO.rowH}rem)`}>
                <${ContractTile} c=${n.c} on=${pickedSet.has(n.c.id)}
                  usable=${canEnable(n.c)}
                  players=${capacity} difficulty=${difficulty} index=${i}
                  picked=${ids}
                  onDetail=${showDetail} onToggle=${toggleAccept} />
              </div>`)}
            </div>` : null}
          </section>`;
  })}
        ${sets.length ? null : html`<p class="ctrscreen__empty">${t('暂无可用合约')}</p>`}
      </section>

      ${/*
         * 中间栏:竖排详情 + 「返回 / 启用」。
         *
         * owner 的流程:「默认该 ui 不打开除非点了协议 如果点击下个协议就是查看下个协议内容
         * 然后给他确定返回取消按钮 点击确定就接收该合约 然后中间浮出红字」。
         * 所以:没点过 = 这条窄栏空着(宽度仍占着,左右两栏不动);点一条显示一条;
         * 「取消」= 接收这一条(`accept`),接收后在说明上方浮出一行红字。
         *
         * ⚠ 窄屏(≤1240px)时整条中间栏连按钮一起收掉(见 contracts.css)。那是有意的:
         * 窄窗口下三栏都读不了,而且此时「返回」的唯一去处是关闭面板 —— 那会丢掉草稿,
         * 不如让玩家把窗口放大再做合约选择。
         */ null}
      <section class=${`ctrdetail${selected?.kind === 'boon' ? ' is-boon' : ''}${(justToggled != null && selected) ? ' is-just' : ''}`} aria-label=${t('合约详情')}>
        ${/*
           * 红字说的是**当前这一条**(`selected`),不是"上一个操作过的那一条" —— 见 `justToggled` 的说明。
           * 所以还要 `selected` 存在才算数:切换 / 收回详情之后不该留着上一句。
           */ null}
        ${(justToggled != null && selected) ? html`<p class="ctrdetail__accepted" role="status">
          ${justToggled
            ? t('已启用合约「{name}」', { name: contractName(selected.id) })
            : t('已取消合约「{name}」', { name: contractName(selected.id) })}
        </p>` : null}
        ${/*
           * 连带关掉下游时说一句 (owner:「如果双击前置会关闭需要该前置的合约」)。
           * 挂在红字下面 —— 不说的话玩家只会看到右侧「已开启」里少了几条,不知道是自己刚才那一下弄掉的。
           */ null}
        ${cascaded ? html`<p class="ctrdetail__cascade" role="status">
          ${t('前置关闭，连带取消了：{list}', { list: cascaded.join('、') })}
        </p>` : null}
        ${selected ? html`<header class="ctrdetail__head">
            <h3>${t(selected.name)}<${MicroLabel}>${selected.nameEn}</${MicroLabel}></h3>
            <span class="ctrdetail__pts num">${selected.points} ${t('点')}</span>
          </header>
          ${/*
             * 前置 / 互斥 / 未生效 —— 详情里也要说一遍。
             * 瓦片上只有 tooltip,而"这条要先选什么、会挤掉谁"是玩家做决定时最需要知道的事。
             */ null}
          ${selected.requires.length ? html`<p class="ctrdetail__req">${t('前置：需先选择 {list}', { list: selected.requires.map(contractName).join('、') })}</p>` : null}
          ${canEnable(selected) && cancelledByAdding(selected.id, ids, capacity, difficulty).length
            ? html`<p class="ctrdetail__req">${t('选择后将取消：{list}', { list: cancelledByAdding(selected.id, ids, capacity, difficulty).map(contractName).join('、') })}</p>`
            : null}
          <div class="ctrdetail__body">
            ${String(selected.detail || '').split('\n').map((line, i) => (line
              ? html`<p key=${i}>${line}</p>`
              : html`<p key=${i} class="ctrdetail__gap"></p>`))}
          </div>`
          : html`<div class="ctrdetail__hint">
            <${Icon} name="list" class="ctrdetail__hinticon" />
            <p>${t('点左侧的合约')}</p>
            <p>${t('这里显示它的说明')}</p>
          </div>`}
        ${/*
           * 只有那个**开关**按钮 —— 「返回」已去掉 (owner:「去掉返回按钮」)。
           * 这一条还没启用 → 「启用」;已经在房间里 → 「取消」(owner:「启用了不会变为取消啊」)。
           * 「取消」用 danger 红,和"启用"的琥珀区分开 —— 它是个会撤销现状的动作。
           *
           * 离开面板的两条路都还在:右下角的「完成」(有生效合约时)与 **Escape**。
           * 窄屏下说明栏整块收掉,那一条 `@media` 会把「返回」**单独加回来** ——
           * 否则窄窗口里只剩 Esc 一个出口,看不见任何能点的东西。
           *
           * ⚠ **开不了的合约(人数 / 难度门槛不满足)按钮置灰禁用**
           * (owner:「无法开启的合约左键可以查看简介 但是确定按钮改为禁用」)。
           * 已经启用的那条不算"开不了" —— 它要能点「取消」才出得去(`selectedUsable` 里判了)。
           */ null}
        ${isHost && selected ? html`<div class="ctrdetail__act">
          <${Button} variant="secondary" class="ctrdetail__back" onClick=${() => showDetail(null)}>${t('返回')}<//>
          ${pickedSet.has(selected.id)
            ? html`<${Button} variant="danger" icon="close" loading=${busy === 'contracts'}
                onClick=${() => toggleAccept(selected.id)}>${t('取消')}<//>`
            : (selectedUsable
              ? html`<${Button} variant="amber" icon="check" loading=${busy === 'contracts'}
                  onClick=${() => toggleAccept(selected.id)}>${t('启用')}<//>`
              : html`<${Button} variant="amber" icon="lock" disabled=${true}
                  title=${selectedBlockers.map((b) => {
                    if (b.kind === 'players') return t('需要 {n} 人及以上的房间', { n: b.need });
                    if (b.kind === 'difficulty') return t('需要难度 {name} 或更高', { name: diffName(b.need) });
                    return t('需要先选择：{list}', { list: b.need.map(contractName).join('、') });
                  }).join('；')}>${t('启用')}<//>`)}
        </div>` : null}
      </section>

      <aside class="ctrscreen__side">
        <div class=${`ctrscore${points > 0 ? ' is-lit' : ''}`}>
          <${MicroLabel} tone="amber">${t('危机点数')}</${MicroLabel}>
          <b class="ctrscore__num num">${shownPoints}</b>
          ${/* owner:「将这个 15 去掉」—— 分子旁边那个 `/ 上限` 不要了,只留当前点数。 */ null}
        </div>
        <div class=${`ctrrisk is-${riskBand(points).key}`} title=${t(riskBand(points).hint)}>
          <span>${t('强度档位')}</span><b>${t(riskBand(points).name)}</b><small>${t(riskBand(points).hint)}</small>
        </div>
        <dl class="ctrsummary">
          <div><dt>${t('房间人数')}</dt><dd class="num">${capacity}</dd></div>
          <div><dt>${t('已选合约')}</dt><dd class="num">${ids.length}</dd></div>
          ${base > 0 ? html`<div><dt>${t('难度基础分')}</dt><dd class="num">+${base}</dd></div>` : null}
        </dl>

        ${/*
           * 已开启的合约 (owner:「右边加个滚动条 显示已开启的合约」).
           *
           * 独立一栏 + 自己的滚动条:合约多了以后,左侧的分集列表要滚,右侧这一栏要**始终看得到自己选了什么** ——
           * 那正是房主反复要确认的东西。没选时不占地方(只留一行提示)。
           */ null}
        <div class="ctrchosen" data-testid="contracts-chosen">
          <div class="ctrchosen__head">
            <span>${t('已开启的合约')}</span>
            <${MicroLabel} tone="amber">ACTIVE<//>
            <b class="ctrchosen__n num">${pickedList.length}</b>
          </div>
          <div class="ctrchosen__scroll" role="list">
            ${pickedList.length ? pickedList.map(({ c, set }) => html`<div key=${c.id} class=${cx('ctrchosen__row', c.kind === 'boon' && 'is-boon')} role="listitem">
              <span class="ctrchosen__set num" title=${t(set.name)}>${set.index}</span>
              <span class="ctrchosen__name">${t(c.name)}</span>
              <b class="ctrchosen__pts num">${signedPoints(c.points)}</b>
            </div>`) : html`<p class="ctrchosen__none">${t('还没有开启任何合约')}</p>`}
          </div>
        </div>

        ${/* 「挤掉了谁」那句提示已删:新流程里没有任何路径会挤掉合约(启用只发生在「启用」那一下,
              而它是单条提交),它永远不会渲染。 */ null}
        ${dropped.length ? html`<p class="ctrscreen__dropped">${t('当前房间不满足条件，已自动取下 {n} 个合约', { n: dropped.length })}</p>` : null}
        ${/* owner:「把这个去掉」—— 侧栏那行「有 N 个合约…部分未生效」不再显示。
             信息没有丢:瓦片角标仍标「部分未生效」,tooltip 与详情页仍逐条说明是哪一项。 */ null}
        ${/*
           * 「结算画面会记录「危机合约 · 合约分数 N」。」那行**已删** (owner:「取消掉这行」)。
           * 分数本身没丢:顶上那个大号「危机点数」就是它,结算画面该记的照样记。
           * 这行只是把同一件事又说一遍,还占着右侧一栏的位置。
           */ null}
        ${isHost ? null : html`<p class="ctrscreen__ro">${t('只有创建者可以修改合约。')}</p>`}
      </aside>

      ${/*
         * 底部动作行 —— **只有「完成」**,而且**一直都在**。
         *
         * owner 的新流程:「取消现在的返回和确定」→ 那两个搬到中间栏去了(看详情顺手就能点),
         * 这条右下角只留「完成」用来返回主界面。位置是整面板的右下角。
         *
         * ⚠ 「完成」**不能跟状态走**(owner:「完成隐藏干啥 而且现在点了启用和取消ui又不一样了」)。
         * 走过两个错版本:
         *   1. 只在"刚启用过"时显示 → 面板一重开就没了;
         *   2. 改成"有生效合约时显示" → 于是启用 / 取消一切换,
         *      右下角就**多出来 / 少掉**一个按钮,整套 UI 跟着变样(实测 ② 有、①③ 没有)。
         * 它是"我看完了,回主界面",与选没选合约无关 —— 所以恒在。
         * 高度由 `.spacer` 恒定撑住,所以"有没有"从来不是高度问题,是**观感一致性**问题。
         */ null}
      <footer class="ctrscreen__actions">
        ${/* `.spacer` 把这一行永远撑到按钮高度 —— 见 css 里 `.ctrscreen__actions > .spacer` 的说明。 */ null}
        <span class="spacer" aria-hidden="true"></span>
        <${Button} variant="primary" icon="check" onClick=${onClose}>${t('完成')}<//>
      </footer>
    </div>
  </div>`;
}

/**
 * 只读的「已生效合约」查看窗 —— 对局内(确认本局信息等)看本局在跑哪些合约。
 *
 * 和 `ContractsPanel` 的区别:这里**没有勾选**,也不该有 —— 对局已经开了,合约是既成事实。
 * 数据来自 `m.public.contracts` / `m.public.contractPoints`,而不是房间状态(房间可能已经散了)。
 *
 * @param {{ open: boolean, contracts: readonly string[]|null, points: number, difficulty?: string|null, onClose: Function }} props
 */
export function ContractsView({ open, contracts, points = 0, difficulty = null, onClose }) {
  if (!open) return null;
  const list = (Array.isArray(contracts) ? contracts : []).map((id) => CONTRACTS.find((c) => c.id === id)).filter(Boolean);
  /*
   * 分数里**含难度基础分**(终极 +2),所以只给总分而看不到构成时,玩家会以为算法多给了分。
   * `difficulty` 本来就是这个弹窗的入参,这里正好用掉它 —— 之前它被接了却没读过。
   */
  const base = contractBasePoints(difficulty);
  const sum = list.reduce((s, c) => s + (c.points || 0), 0);

  return html`<${Modal} open=${true} onClose=${onClose} tone="amber" title=${t('已生效合约')} micro="CRISIS CONTRACT" width="7rem"
    actions=${html`<${Button} variant="primary" icon="check" onClick=${onClose}>${t('关闭')}<//>`}>
    <div class="ctrview">
      <div class="ctrview__head">
        <span>${t('合约分数')}</span>
        <b class="num">${points}</b>
        ${base > 0 ? html`<small class="ctrview__calc num">${t('合约 {sum} + 难度 {base}', { sum, base })}</small>` : null}
      </div>
      ${/*
         * 逐条的「查看详情 / 收起详情」按钮**已删** (owner:「已生效合约栏里取消掉查看详情」)。
         *
         * 每一行都有自己的按钮、展开后又在列表**下面**插一块详情 —— 五条合约就是五个按钮，
         * 而且展开的那块离你点的那一行很远。这里本来就是"确认本局在跑什么"的只读清单，
         * 每行已经有名称 + 描述 + 点数，够读了。
         *
         * 连带删掉的:`detail` / `setDetail` 这两个 state(只有一个消费者)、
         * 以及列表下面那个 `selected` 详情块 —— 按钮没了，它永远打不开。
         */ null}
      ${list.length ? list.map((c) => html`<article class="ctrview__row" key=${c.id}>
        <span class="ctr__box is-on"><${Icon} name="check" /></span>
        <span class="ctr__body">
          <span class="ctr__name">${t(c.name)}<${MicroLabel}>${c.nameEn}</${MicroLabel}></span>
          <span class="ctr__desc">${t(c.desc)}</span>
        </span>
        <span class="ctr__pts"><b class="num">${c.points}</b><span>${t('点')}</span></span>
      </article>`) : html`<p class="ctrview__none">${t('本局没有生效的合约。')}</p>`}
    </div>
  <//>`;
}

/**
 * 「查看合约」按钮 + 弹窗(对局内,放在干员调配旁边)。
 *
 * 自己管开关状态,所以调用点只要丢一个组件进去。
 *
 * ⚠ 判据是 `crisisActive(contracts, difficulty)` —— **有合约 且 难度够**(绝境及以上)。
 * 这里踩过两个坑,都别再回去:
 *   ① 用 `contractPoints > 0`:含难度基础分(终极 +2),于是"终极难度、一条合约没选"的局
 *      也会冒出「查看合约」;
 *   ② 只用 `contracts.length > 0`:`difficulty` 这个 prop **一直传进来了却没人读**,
 *      于是房主把难度切到标准/险境后,对局内右上角**依然挂着「查看合约」**(owner 报的图)。
 * 现在与红雾、合约音乐、HUD 左上角、「危机合约」入口按钮共用同一个 `crisisActive`。
 *
 * @param {{ contracts: readonly string[]|null, points: number, difficulty?: string|null, class?: string, size?: string }} props
 */
export function ContractsViewButton({ contracts, points = 0, difficulty = null, class: cls, size = 'sm' }) {
  const [open, setOpen] = useState(false);
  if (!crisisActive(contracts, difficulty)) return null;
  return html`<${Fragment}>
    <${Button} variant="secondary" size=${size} class=${cls ? `ctrview-btn ${cls}` : 'ctrview-btn'} icon="warn"
      title=${t('查看本局生效的危机合约')} onClick=${() => setOpen(true)}>${t('查看合约')}<//>
    <${ContractsView} open=${open} contracts=${contracts} points=${points} difficulty=${difficulty}
      onClose=${() => setOpen(false)} />
  <//>`;
}
/**
 * 房间页上的入口按钮:显示已选合约数与危机点数,一眼看出本局有没有加难度。
 *
 * ⚠ **难度不够时整个不渲染**(绝境及以上才有危机合约,`CONTRACT_MIN_DIFFICULTY`)。
 * 和「一条没选时不显示」同一个写法:不可用就**不出现**,而不是摆一个点开才发现不能用的按钮。
 * 判据来自 `shared/contracts.js` 的 `contractsAllowedAt`,与服务端的校验是同一个函数。
 *
 * @param {{ room: any, onClick: Function, compact?: boolean }} props
 */
export function ContractsButton({ room, onClick, compact = false }) {
  const n = Array.isArray(room?.contracts) ? room.contracts.length : 0;
  // 分数含难度基础分,所以按钮上的数字也是难度相关的(终极 +2)
  const pts = contractPoints(room?.contracts, room?.difficulty ?? null);
  if (!contractsAllowedAt(room?.difficulty ?? null)) return null;
  return html`<button type="button" class=${`ctrbtn${n ? ' is-on' : ''}${compact ? ' ctrbtn--compact' : ''}`} onClick=${onClick}
    title=${n ? t('已选 {n} 个合约，危机点数 {p}', { n, p: pts }) : t('危机合约')}>
    <${Icon} name="warn" />
    <span class="ctrbtn__label">${t('危机合约')}</span>
    ${n ? html`<span class="ctrbtn__pts num">${pts}</span>` : null}
  </button>`;
}
