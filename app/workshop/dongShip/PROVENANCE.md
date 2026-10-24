# PROVENANCE —— 署名与来源

本文件按 Stronghold-Protocol-Forge-Mods 的 `SKILL.md` §10 写，六项俱全。

---

## 1. 原作者

**CLa**

> 本包**不是**对他人 mod 的兼容改写，而是作者本人把自己此前的作品
> 「东盟约 Mod」（面向 r25 / v0.2.1 的**安装器型** mod）重写成工坊包格式。
> 因此「原作者」与「兼容改写者」是同一人 —— 两栏照实分开列，不合并。

## 2. 许可

**照实抄 `pack.json` 的 `license` 原文**：

```
GPL-3.0-or-later（本包代码）；© Hypergryph / Yostar（随包素材，非商业同人使用）
```

- 本包**自己编写**的代码（`kits/**`、`server/battle/dong.mjs` 里属于本包的部分、`*.json` 里的原创数据）
  以 **GPL-3.0-or-later** 分发。
- 随包素材（见第 6 项）版权归**鹰角网络 / Yostar**，**不在 GPL 范围内**，
  仅供**非商业**的学习与个人娱乐使用。
- 内联的官方实现（见第 5 项）来自同为 GPL-3.0-or-later 的 Stronghold-Protocol-Forge。

## 3. 兼容改写者

**CLa** —— 2026-10-16 起，把安装器型 mod 改写为声明式工坊包。

## 4. 来源

| 内容 | 来源 | 可追溯信息 |
|---|---|---|
| 本包的前身 | 作者自制的「东盟约 Mod v1.0.0」（安装器型，`install.mjs` + overlay 分片） | `东盟约-Mod-v1.0.zip`，3.5 MB，89 个文件 |
| 干员数值（等级 1–7 / 专精 1–3） | **PRTS wiki** wikitext，2026-10 抓取 | 见 `kits/**` 顶部注释逐条的 PRTS 出处 |
| 干员面板 / 技能 / 天赋基础 | 游戏本体 `data/*.json`（官方数据表导出物） | Stronghold-Protocol v0.2.4 |
| 内联的官方实现 | Stronghold-Protocol-Forge | `server/sim/content/kits/ops/op-{saga,haruka,hsgma2}.js`、`server/sim/{detmath,body,damage}.js` |
| 随包素材 | 见第 6 项 | —— |

**发布件内容指纹**（引擎 `shared/modIdentity.js` 的 `modManifestDigest`：对每个发布文件的「相对路径 + sha256(字节)」成对后再取 sha256；
清单**不含本文件**（它记录这个值，含进去就自指）与 `.tune-backup/**`（编辑器调数值留下的本地备份，不进发布 zip）；228 个文件）：

```
82bbc6ae43fa47c5047203d14684ad965e38ec54dfde9e0846d694e85bf779b4
```

复算：`node F:\wsxy\22\hash-pack.mjs`（同时打印**引擎身份哈希** = `loadWorkshop().packs[0].hash` —— 那一份含本文件与
`.tune-backup/`，是房间摘要闸门用的；1.2.1 起的发布 zip 另外排除了 `README-部署说明.md`、`bond-specs/`、`item-specs/`（只给编辑器与人看、引擎装载器不读），所以 zip 的指纹与此值不同；此值按上面 228 个文件计算）。

## 5. 改了什么（原做法 → 本包做法 → 为什么）

本包与原「安装器型」版本**功能等价**，差别全在**交付方式**上。

| # | 原做法（安装器型） | 本包做法 | 为什么 |
|---|---|---|---|
| 1 | `install.mjs` **整份覆盖** `data/*.json` | `content: ["bonds","chess","garrisons"]` + 包内三个 `.json` | 工坊的纪律：`data/*.json` **一个字节都不改**，叠加发生在 `freeze` 之前 |
| 2 | 给 `server/sim/content/bonds.js` 的 `PARTS` **追加**一行 | `server.battle` 声明（`{ battle: { module } }`） | 包没有「改引擎文件」的通道；盟约效果由战斗模块表达 |
| 3 | 给 `server/sim/content/kits/index.js` **插入** 7 行 | `kits/<普通版棋子 id>.js`，加载器自动登记 | 文件名即注册键；`kitOf` 按 `baseId` 查，精锐版共用普通版那份 |
| 4 | 5 名官方干员的盟约 / 默认技能直接改 `data/chess.json` | `overrides: ["chess:<id>", …]`（**10 条，全部是 `chess:`**；1.1.0 起**不再覆盖任何官方特质**）显式声明 | 覆盖官方记录**必须**显式声明，否则整条被拒 |
| 5 | 把遥 / 嵯峨 / 斩业星熊移出 `diy.ownedPool` | **放弃**（引擎只记 `overlaps`、不摘除） | `SKILL.md` §1.2 明写「池子属于安装方」，`stripPackOperators` 是**按此条驳回**的行为 |
| 6 | kit 用 `export default { <baseId>: fn }`（引擎风格） | `export default fn`（工坊风格） | 工坊加载器读 `mod.default`，且必须是**函数** |
| 7 | kit 用相对路径 import 引擎模块 | 顶层只用白名单别名（`@kit/` `@sim/`） | 服务端按真实路径、浏览器按 URL 两次加载，相对路径无法同时对 |
| 8 | 遥 / 斩业星熊 / 嵯峨的 kit **包住**官方 `op-*.js` | **内联**官方实现进单文件（见下） | 白名单**没有** `@kit/ops/op-*.js` —— 包不能 import 官方干员实现 |
| 9 | 自选池清理、安装器、卸载器、审计工具 | 全部不进包 | 包是**声明式**的，没有安装器这一层 |

### 5.1 关于第 8 项：内联的范围

| 内联了什么 | 从哪来 | 为什么必须内联 |
|---|---|---|
| `op-saga.js`（15.6 KB） | Forge `server/sim/content/kits/ops/` | 白名单只开到 `@kit/tier1..6` / `@kit/summoner`，没有 `@kit/ops/op-*` |
| `op-haruka.js`（16.4 KB） | 同上 | 同上 |
| `op-hsgma2.js`（20.9 KB） | 同上 | 同上 |
| `detmath.js`（11.3 KB，**整份**） | Forge `server/sim/` | 白名单没有 `@sim/detmath.js`；且 `sin/cos/atan2` 是 **fdlibm 移植**，自己重写会引入浮点漂移 → 服务端复算不一致 → **玩家战果被拒** |
| `body.js`（5.7 KB，整份） | Forge `server/sim/` | 同上；它只依赖 `constants` + `detmath` |
| `damage.js` 的 **`hasHp` 一个函数** | Forge `server/sim/` | 618 行里只要这一个（零依赖），整份内联会拉进 `constants` / `targeting` 整条链 |
| `mitigate` + `clamp01`（`dong.mjs` 内） | Forge `server/sim/damage.js` | 战斗模块**不能**用相对路径，而 `weaknessRetype` 依赖它 |
| `weaknessRetype` + `mitigated`（`dong.mjs` 内） | Forge `server/sim/content/items/battle.js` | 白名单没有 `@battle/items/…` |

### 5.2 本轮（1.1.0，2026-10-13）：安洁莉娜的【东】特质 + 全部特质按 Forge 规则验一遍

| # | 1.0.0 的做法 | 1.1.0 的做法 | 为什么 |
|---|---|---|---|
| 10 | 覆盖官方特质 `garrison_147_a/_b`，把 `bbStr.bond` 改成 `siracusaShip,dongShip` | **撤回覆盖**，官方记录一个字节不动；另**新增** `garrison_angelina_dong_a/_b`（只给【东】），由 `server/meta/dong.mjs` 的 `custom_dong_refresh_layers` 实现 | 覆盖官方特质等于把官方那条（阿罗玛等**别的干员**也用它）的行为一起改了；新增一条只动自己，且 `registers` 白名单保证不会悄悄顶掉官方 handler（DESIGN §29） |
| 11 | 火龙S黑角的 `custom_dong_prep_pool` 记录里 `effectType` 写的是官方族名 `SERVER_POOL_CHAR` | `effectType = effectKey = custom_dong_prep_pool` | DATA.md §4 / `tools/build-data.mjs` 的推导式是 `effectKey = bbStr.key \|\| effectType`：SERVER_* 特质没有 `bbStr.key`，所以两者必须相等（官方 249/249 成立） |
| 12 | 吉星 `garrison_kichi_a/_b` 缺 `eventTypeDesc` / `eventTypeIcon` / `effectType` / `battleRuneKey` / `charLevel`，`descRaw` 还停留在旧的「每花费3资金」 | 补齐 5 个字段、键序对齐官方、`descRaw` 与 `desc`+`bb` 对齐（2 / 1 资金） | 官方 249 条记录只有**一种**键序与字段集；显示层读 `descRaw`，与 `bb` 不一致就是玩家看到的数字和实际不符 |
| 13 | `bonds.json` 的 `members` / `visibleMembers` 只有 7 名（包里自己那 7 枚棋子） | 12 名（所有带 `dongShip` 的干员，普通版去重） | 客户端 `bondMembers()` 按这两个字段画盟约成员行与「在场」数；漏 5 名 = 界面上少 5 个成员 |
| 14 | 水月精锐与普通同值（都 +1%）；火龙S黑角精锐与普通同值（都「给 1 个」）；吉星每花费 2 资金 +2（精锐每 1 资金 +4） | 水月 `_b` +2%；火龙 `_b` 给 2 个；吉星**每花费 1 资金 +1 / +2 层**（精锐数值翻倍、条件不变） | 官方精锐惯例 = 条件不变、数值翻倍；三处数值由作者定稿 |
| 15 | 火龙S黑角**没有模组**（记录里 `status.equipLevel: 1` 却没有 `module` / `modules`） | 补上 X 模组「黑角的随身笔记」（`uniequip_002_noirc2` / SBL-X / **3 级**）：`module` + `modules[]`（attr / traitOverride / talentChanges）+ `statsBase` / `traitBase` / `talentsBase`；`kits/chess_char_2_noirc2_a.js` 里照**宴**的写法补上「生命值低于 50% 时 25% 庇护」 | 官方 266 条记录里 256 条都有 `module`、127 条精锐有 `modules`；属性/天赋由引擎的 `shared/loadoutRecord.js` 合成，玩家可「不装备」 |
| 16 | 白雪 `_b` 的模组新增天赋【风旭】文字只写在 `talents` 里，没写进 `modules[].talentChanges` | 补进 `talentChanges` | 引擎按 `composeTalents(talentsBase, talentChanges)` 合成 —— 两份不一致 = 界面上那条天赋没有名字（审计脚本第 5 节抓到的） |
| 17 | 斩业星熊普通版 `module` 是全 `null` 的空壳；包内 14 / 24 条棋子记录的键序与官方不同 | 空壳改成 `{ id, name, type, level: 0, active: false }`；全部记录按官方 `data/chess.json` 的键序重排（纯格式） | 官方 266 条只有一种键序；空壳形状官方一条都没有 |
| 18 | 遥 / 嵯峨的 4 条记录**没有模组**（`module: null`、没有 `modules`）—— 与火龙改前同一类缺口 | 补上（数据**直接取自官方** `data/backups.json` 的 `units.forms['2/60/7/3'].modules`，不是手抄 PRTS）：遥 = BLS-Y「迟来的纪念」；嵯峨 = SOL-Y「身向云泥」（默认）+ SOL-X「何处寻驮？」（两条都列进 `modules[]`，玩家可切换） | 官方 266 条里 256 条有 `module`、127 条精锐有 `modules`；而 `units.forms` 就是 `tools/build-data.mjs` 生成官方棋子记录所用的同一份数据 |
| 19 | （同上）两位干员的 kit 其实**早就实现了**模组效果（遥的 `attack@max_target` / `prob`+`sp`、嵯峨的 `runtime_cost` / `damage_scale` / 阻挡时 `atk`+`def`） | 只改数据，`kits/**` 一行没动 | 内联的官方 `op-haruka.js` / `op-saga.js` 本来就按「每个形态、每个模组」写好了 |
| 20 | 效果一的追加攻击是**二次式** `L²/48400`（100 层 20.7%、200 层 82.6%、220 层就满 100%），而界面按线性 `0 + 0.2066%×L` 显示（300 层：界面 62%、实际 186%）—— 中后期超模，且显示与实际不一致 | 改成**与【炎】同形的线性公式**：作者定稿 `攻击力 ×（3.3% + 0.4835% × 层数）` ⇒ `bb.base_damage_scale = 0.033`、`bb.damage_scale_per_stack = 0.004835`（斜率照"**200 层正好 100%**"反解：(1 − 0.033) / 200；base 保持 3.3%，与界面那条式子 `bb[base] + bb[perStack] × 层数` **逐字相同** ⇒ 显示值 == 实际值：0 层 3.3% / 50 层 27.5% / 100 层 51.65% / 150 层 75.83% / 200 层 100% / 250 层 124.2% / 300 层 148.4%；200 层以上继续线性，不封顶）；`effectDescParams` 直接指向真实的那对 bb 键；删掉 `damage_scale_divisor` 与两个 `*_show`；`bond-specs/dongShip.json`（编辑器的源）同步；**神经损伤 100 → 60 / 次** | 【炎】= 攻击力 ×(1 + 0.23 + 0.009×L)（`spec.formulas.atkMultiplier`），界面同样是 `bb[base] + bb[perStack] × 层数`（`public/js/ui/richText.js formatBondEffect`）；⚠ 卡片文本**没有 clamp 字段**（官方 `effectDescParams` 只有 index/format/base/perStack，唯一的封顶特例是键名含 `prob` 的迅捷/奇迹/不屈），所以这里**不封顶** —— 封顶会让 200 层以上"卡片显示 124%、实际 100%"，与"显示值 == 实际值"这条纪律冲突；验证脚本 `F:\wsxy\22\test-dong-damage-formula.mjs`（经引擎装载量真实金额，28 条，含 **200 层 = 1000 即 100%** 的断言） |
| 21 | （新内容）没有装备 | **新装备「艺人见面抽选券」**（名字与风味取自官方道具「艺人见面抽选券」，活动「墟」的 act44side 道具，PRTS: https://prts.wiki/w/艺人见面抽选券；机制完全是本包的）：4 阶 3 金（精锐同价，见下），`pack.json.content` 加 `items`；**源是 `item-specs/artist_ticket.json`**（编辑器可编辑），`items.json` 由它派生；**精锐与普通的差额写在 `bb.golden_layer_bonus` 里**（编辑器是"一个 spec → 普通+精锐两份**相同**数值"，差额只能让代码加：普通 `layer` 2 / 精锐 2+1=3）；行为在 `server/meta/dong.mjs` 的 `item:chess_item_ws_artist_ticket`（`onPrepEnd` → 逐条给携带者**已激活**的盟约加层，`requireActive`，照官方 `随身身份牌` 的语义）；`giveBondId: "dongShip"` ⇒ 与「变形同构体」同装时携带者视为【东】成员 | 装备的"每回合给层"是**准备阶段**行为，工坊改不了引擎的装备行为表（`items/battle.js` 的 `STAT_BUFFS` / `BY_BUFF`）—— 包能用的通道是 meta 注册表的 `item:<itemKey>`。① 2026-10-13 手写 `items.json` 的 `_b`（+3）被**一次编辑器保存**按 spec 重写成了 +2 ⇒ 改成 `golden_layer_bonus`，之后编辑器随便保存都不会再冲掉；② 精锐**买不到**：引擎 `simdata.isShopItem` 第一条就是 `!isGolden`，商店池只从 `gd.shopItemsByTier` 抽（实测抽 3000 次精锐 0 次） | 验证脚本 `F:\wsxy\22\test-dong-item.mjs`（39 条：形状 / 无战斗侧效果 / 变形配对 / 处理器行为 / **商店池与实抽** / spec 同步）+ `make-dong-items.mjs`（写 spec → 用引擎 `deriveItem` 重生成 items.json） |
| 22 | 火龙S黑角特质的门槛读的是 `ctx.bondCount`（引擎给"盟约**激活**"用的计数）—— 它还会 **+1 调和**（`maniShip` 激活时给每条 `isCore` 盟约 +1，东正是 `isCore: true`）以及将来可能出现的 `ps.bondCountBonus` ⇒ **棋盘上只有 4 名不同的【东】+ 调和** 就满足了"5 名"的门槛（实测：`computeBonds` 给 `count = 5, harmony = 1`） | 门槛改成处理器自己数：`distinctOnBoard(ctx, bond)` —— 遍历 `ctx.board()`，按 `rec.baseId` 去重（同一名干员的普通/精锐同场算 1 名）、只数棋子（token 不算、**备战席不算**）；成员资格仍用引擎那一份 `ctx.pieceBonds`（自己的 bonds ∪ 装备/特质/变形同构体授予） | 特质说明写的是"棋盘上有 5 名以上【东】干员"⇒ 就该严格数棋子；战斗侧那两条门槛（`power_char_cnt` / `power_bond_char_cnt`）本来就是按 `baseId` 去重的（`distinctMembers`），两处现在口径一致 | 验证脚本 `F:\wsxy\22\test-dong-noirc2-gate.mjs`（24 条：真 `GameData` + `computeBonds` + 真处理器；含"4 名+精锐同名""3 名在场+2 名备战席""4 名+调和"三个反例） |
| 23 | 本包**自增**的四名干员（白雪 `char_118_yuki` / 吉星 `char_4203_kichi` / 麒麟R夜刀 `char_1029_yato2` / 火龙S黑角 `char_1030_noirc2`）在本机**完全没有语音**——官方素材清单（`data/assets.json`）里连 `chars`/`audio.voice` 条目都没有，游戏里这四位是哑的（遥/嵯峨等 8 名官方覆盖到的则有 jp 12 槽位） | 从上游官方语音仓库取下**本模式会播的 12 个槽位 × 日/中两语种 = 112 个 mp3（2.27 MB）**，装进包自己的 `assets/voice/<charId>/<lang>/<slot>_<n>.mp3`；`pack.json` 的 `voices`（= 默认语种 jp）与 `voiceLangs.cn` 各声明 4 名 × 12 槽位 | URL 模板（脚本 `F:\\wsxy\\22\\fetch-dong-voices.mjs`，直连 raw.githubusercontent 在本机被墙，故走 `gh-proxy.com` 镜像）：`https://gh-proxy.com/https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/{voice_cn\|voice}/<charId>/cn_<NNN>.mp3`；槽位映射来自 gamedata 的 `excel/charword_table.json`（`placeType`：`BATTLE_START→start`、`BATTLE_FACE_ENEMY→faceEnemy`、`BATTLE_SELECT→select`(2 条)、`BATTLE_PLACE→place`(2 条)、`BATTLE_SKILL_1..4→skill1..4`、`FOUR_STAR→resultFour`、`THREE_STAR→resultThree`、`TWO_STAR→resultTwo`、`LOSE→resultLose`）—— 与引擎 `tools/assets/audio.mjs` 的 `VOICE_SLOTS` 同一份判据 | 验证脚本 `F:\\wsxy\\22\\test-dong-voices.mjs`（26 条：声明形状 / 112 个文件都在 / 合并后的清单 / **用客户端的 `voiceLinesFor` 实测中·日各取到哪一条** / 官方那批不受影响）；`audit-voice.mjs` 现在读合并后的清单并认 `/workshop-assets` 路径 ⇒ 12 名东成员全部 12/12 |
| 24 | `pack.json.overrides` 里那 10 条覆盖记录是**整条官方副本**：包里的副本丢了官方那份 `potDown`（潜能下调数据）与天赋的 `potMin`/`potBelow`（审计一直警告"缺 potDown"），而且**跟随不了服务器数据版本** —— 换到 0.2.4 的数据上，包里 0.2.2 时代的副本会把新版官方记录盖回去 | 用新工具 **`F:\wsxy\22\refresh-chess-overrides.mjs`**（`node refresh-chess-overrides.mjs --app <引擎目录> [--dry]`）从**这台服务器自己的** `data/chess.json` 重取那 10 条，只贴回本包的两处差值（`bonds += dongShip`；水月 / 安洁莉娜的 `garrisonIds +=` 本包特质），其余字段一字不动 ⇒ `potDown` 与 `potMin`/`potBelow` 都跟着官方回来了（审计的 potDown 警告 24 → 14，剩下 14 条是本包**新增**的那批干员，官方没有对应记录）；工具顺带做**兼容性体检**：本包新增的 id 若已被新版官方收录会点名（`OFFICIAL_ID_COLLISION`） | 审计 `audit-dong-traits.mjs` 同步升级：**覆盖记录豁免"包内合成不变式"**（官方数据本身不满足 `talents = composeTalents(talentsBase, talentChanges)`，精锐记录尤其如此），改为新增的 §3.5 逐字段体检——"覆盖记录 = 官方记录 + 只差 `bonds`/`garrisonIds`"。两个脚本 + 报告第十二/十三节 |
| 25 | 本包**新增**的干员在**官方盟约**界面里看不到：客户端 `ui/gameLogic/bonds.js bondMembers()` 的成员表读的是 `bonds.json` 里那张**静态**清单（`visibleMembers` 优先、否则 `members`），而官方那两张表**不可能**知道本包新加的棋子 —— 于是白雪不在【精准】【远见】、嵯峨不在【迅捷】、遥不在【助力】、夜刀不在【突袭】、火龙S黑角不在【坚守】、斩业星熊不在【炎】（服务端的计数是**动态**的，按棋子记录的 `bonds` 数，所以玩法上他们一直是成员：界面与计数对不上） | `pack.json.overrides` 补 7 条 `bonds:`（精准 / 远见 / 迅捷 / 助力 / 突袭 / 坚守 / 炎），`bonds.json` 里放官方记录的副本 + 把本包新增干员的 `_a` id 追加进 `members` 与 `visibleMembers`（两表都加 = 与官方成员同样可见；精英 `_b` 由客户端 `baseOf()` 映射到 `_a`，不需要单独列）；同步工具 `F:\wsxy\22\refresh-chess-overrides.mjs` 升级成**同时**处理 `chess:` 与 `bonds:` 两类覆盖（从本机 `data/*.json` 取官方记录、只贴回本包差值），并带"盟约显示体检"；新增专项审计 `F:\wsxy\22\audit-bond-display.mjs` | 24 条盟约全部查过：本包新增干员 × 所属盟约 14 处**全部在成员表里**、悬空 id 0、头像解析失败 0；`workshop-validate` 0 error / VALID。**注意**：只补 `members` 不补 `visibleMembers` 等于"隐藏成员"（官方 远见/迅捷 就有这种，如 `chess_char_1_11_a`），界面仍旧不画 |
| 26 | 作者要求给**遥**再加一条特质「每叠 3 层【东】，攻击力和生命值多 1%」，并**保留**她原来那条（`garrison_haruka_dong_a/_b`，整备区每有 1 名干员 →【东】层数 +1/+2）；同时复核**安洁莉娜**那条特质的文本 | 遥：新增 `garrison_haruka_attr_a/_b`（普通 +1% / 精锐 +2%），`effectKey = act1autochess_gar_eff_attrByBond`（官方那套「每叠加 N 层」读取器，`bb = {divide_num:3, atk, max_hp}`、`bbStr.bond_id = dongShip`、`eventType IN_BATTLE` / `GAIN_BUFF` / `battleRuneKey env_gbuff_new_with_verify`，与官方 `garrison_07_a` 样板同形），并**追加**进她两条记录的 `garrisonIds`（旧的那条一个字节没动）。步进 = `floor(【东】层数 / 3)`，即 3 层 +1%、6 层 +2%…精锐翻倍（30 层：普通 +10%、精锐 +20%）；官方读取器对**每条 garrison 各发一份 passiveBuff**（`gar::<gid>`）⇒ 与她原来的特质、与嵯峨/水月的同类特质都**互相叠加** | **安洁莉娜文本复核结论：没有问题** —— 她的 `desc`/`descRaw` 与官方原型 `garrison_147_a/_b`（她自己的官方【叙拉古】特质）**逐字同构**，只把【叙拉古】换成【东】；`descRaw` 用的 `<@ba.vup>` 是官方在用的高亮标签（官方 411 处 descRaw 里 251 处用它）；数字与代码路径逐条对得上（2 次刷新 +8、5 次封顶 12、精锐 4 次 +16、0 次不加）且 `test-dong-handlers.mjs` 已钉住。唯一"看起来像问题"的地方是：她面板上会**并存两条几乎一样的特质**（官方【叙拉古】+ 本包【东】）—— 那是【甲】方案的**定义**（官方那条不再被覆盖，本包只新增一条给【东】加层的），不是文本出错；effectKey 用自定义 `custom_dong_refresh_layers` 而非官方 `SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER` 也是刻意的（不借官方处理器跑包的效果，见 `server/meta/dong.mjs` 文件头） | 新测试 `F:\wsxy\22\test-haruka-trait.mjs`（36 条：两条特质并存、键序/形状、文本↔bb 一致、3 层一跳的曲线）；`workshop-validate` 0 error / VALID；`audit-dong-traits` 0 错 1 警（potDown 14/24，既有） |
| 27 | 作者问：**麒麟R夜刀**是不是"每次造成伤害"都会带出盟约的追加攻击 —— 按设计，她的天赋【双雷剑麒麟】（每次攻击附带一次独立法术伤害）应当算两次伤害、触发两次，S1 的六连击更应触发 12 次 | **查证结论：是的，逐"伤害实例"触发**，三条链路都对得上：① 引擎每次 `dealDamage` 发一次 `damaged`（`server/sim/damage.js:379` 普通 / `:462` 元素；多段攻击 `server/sim/ai.js:315-319` 每段各发一次）；② 本包的 `server/battle/dong.mjs` 注册在 `damaged` 上、**不要求 `isAttack`**（只看"来源是东成员 + 目标存活 + 不是本盟约自己打的"）；③ 她的 kit 每次斩击发两个实例（主伤害 + `talentArts`，`kits/chess_char_9_yato_a.js`）。因此：普通攻击 = **2 次**追加、S1 六连击（6 段 × 2）= **12 次**（正是作者说的 12）、S2 乱舞 16 次斩击 = **32 次**、S3 每命中 = **2 次**；6 名东时每条实例再多一次神经损伤。新增测试 `F:\wsxy\22\test-yato-dong-instances.mjs` **21/21**（源码级契约 + 用真战斗模块逐实例触发 + 递归防护） | ⚠ 顺带查出两处**与追加攻击无关**的不一致，未改（等作者定）：**① S1 六连击的计数按"命中次数"而不是"攻击次数"**（kit 的 `installS1Combo` 数 `damaged` 事件，而二连击一次攻击会发 2 条 ⇒ 计数器每 1.5 次攻击就满 3，六连击的触发率约为官方「第三次攻击」的 2 倍；官方 kit 处理同类计数一律用 `dmg.attackId` 去重，见 `op-haak.js:125` / `standin-acnipe.js:86`，而引擎在 `ai.js:316` 给同一次攻击的每一段都带同一个 `attackId`）；**② 天赋算 splash、六连击不算**（天赋只判 `d.isAttack`，splash 段也是 `isAttack: true`（`ai.js:334`）⇒ 溅射到的第二个敌人也会各吃一次天赋法伤；六连击那边显式排除了 `isSplash`）。修复都各是一两行 |
| 28 | 作者报：**有时候**买了缪尔赛思不发"变形同构体" | 已复现并定位到**共享道具池**，不是本包的逻辑：`ps.acquireItem()` 的第一道闸门是 `if (!this.m.itemPool.canGain(itemId)) { toast('装备库存不足，未获得该装备'); return null; }`（`server/match/player/acquire.js:296`），而池容量按**阶级**查表 `economy.itemPoolCopies[6] = 3`（`data/config.json`，`server/match/pool.js:235` 的 `SharedItemPool.cap`）⇒ **整局只有 3 份变形同构体**，且它本身是**6 阶商店道具**（`tier 6 / 价 3 / shopExcluded false`，谁都能买走）⇒ 一旦 3 份都被持有（买走或被别的特质发走），缪尔赛思的 `garrison_76_a/b`（`SERVER_GAIN_EQUIP` → `ctx.grantItem` → `acquireItem`）就静默失败，只剩一条警告 toast。复现见 `F:\wsxy\22\test-muirseas-pool.mjs`（真 Match，13/13）：正常发 1 个 → 池满（3/3）后再买（含精锐）**一个都不发** → 放回 1 份又恢复 | **本包改不了**：池容量在 `config.json`（工坊**故意不给包覆盖 config**），meta 通道也只暴露 `grantItem`（`effectsMeta.js` 里没有 `giveItem`/`addItem`/`itemPool`，无"不过池"的口子）。修法三选一（**等作者定，本轮未改**）：① **引擎一行**：给 `acquireItem` 加 `unpooled` 选项、让"特质发放"（`SERVER_GAIN_EQUIP` / `ctx.grantItem`）走它 —— 商店/补给继续受池限制，特质发放不再被买空（最干净）；② 包侧把 `items:chess_item_6_09_e_a` 覆盖成 `shopExcluded: true`（没人能买走，但上限仍是 3 份）；③ 维持官方池设计 | `test-muirseas-pool.mjs` 13/13；另一条已有的失败路径是"手牌 + 临时位都满 ⇒ 获得的装备已销毁"（`acquire.js:308`），这条有 toast、不是静默 |
| 29 | 作者报：**对局内**干员特质的文本描述不是改好的版本 | 定位在**客户端的对局内详情卡**：`public/js/ui/detailPanel.js:440` 只取 **`garrisonIds[0]`**（`const garrison = ... garrisonIds[0] ? data.lookup('garrisons', c.garrisonIds[0]) : null`），而**对局外**的调配页 `public/js/screens/loadout.js:238` 是 `(chess.garrisonIds || []).map(...)` **全画** ⇒ 第二位及以后的特质在局内根本不显示。中招的三名（第二位才是本包新增的那条）：**遥** `[garrison_haruka_dong_a, garrison_haruka_attr_a]`（局内只看得到旧那条"整备区每有 1 名干员"）、**水月** `[garrison_07_a, garrison_mizuki_dong_a]`、**安洁莉娜** `[garrison_147_a, garrison_angelina_dong_a]`；官方数据里也有 12 条记录带 2–4 条特质，同样只显示第一条 —— 是**引擎侧的显示限制**，不是数据错。**数据本身已核实无误**：本包 19 条特质的 `desc` 与 `descRaw` **逐字同源**（去掉 `<@ba.vup>` 标签后相同）、数字与 `bb` 一致 | 修法（**等作者定，本轮未改**）：引擎侧把那一行改成画全部特质（与 `loadout.js` 同口径，约 3 行）；包侧没有干净的绕法（把新特质挪到 `garrisonIds[0]` 只会把官方那条从局内藏起来） | 本轮新增的核查脚本：`F:\wsxy\22\audit-garrison-text.mjs`（desc↔descRaw 同源 + 数字↔bb） |
| 30 | 作者要求适配 **Forge 0.18.3 / 游戏 0.2.5** 并按 Stronghold-Protocol-Forge-Mods 的上传要求交付 | 用新版整合包自带的数据与工具重验：`shared/constants.js` 的 `MOD_API_VERSION` **仍是 1**（所以 `pack.json` 的 `api: ">=1 <2"` 不用改）；`data/*.json` 逐文件 sha256 与旧版（0.17.0 / 0.2.2）比对 —— **20 个文件里只有 `choices.json` 不同**，本包覆盖/引用的 10 条官方棋子、7 条官方盟约、参照的 7 条官方特质（`garrison_76/147/05/101/07/09`）与经济表（`itemPoolCopies`）**一条都没变** ⇒ **覆盖记录无需重新同步**；`pack.json` 版本 1.1.0 → **1.2.0**、广告（公告）加一条适配须知、描述里点明"会影响对局结果"（上传红线 3） | 新版引擎的校验器：`SP_WORKSHOP=<干净工坊根> node <新引擎>/tools/workshop-validate.mjs --workshop <根> --json` ⇒ **errors = 0**、`VALID`（warnings 60 与旧版逐条相同）；仓库闸门 `node tools/check-packs.mjs --engine <新引擎 app> --root packs` ⇒ `packs/dongShip ✓`、`failedGates: []`、退出码 0（原始输出留在交付包的 `verify/` 里） |
| 31 | 上游发布**Forge 0.18.4 / 游戏数据 0.2.6**，要求本包适配 | 用 0.18.4 自带的数据与工具重验：`chess` / `bonds` / `garrisons` / `items` / `config` 五张表在 0.2.4 → 0.2.6 之间**逐字节相同**（`server/match/gamedata.js` 与 `data/*.json` 实测），`refresh-chess-overrides.mjs --dry` 17 条覆盖记录全部「不变」、新增 id 与官方无冲突；工具面 `tools/workshop-validate.mjs` = 0 error / VALID、`tools/doctor.mjs` 正常、`tools/check-imports.mjs` 无错、`tools/sim-check.mjs` 267 场无头战斗跑通；15 个回归脚本 + 新增 `audit-kit-skill-sp.mjs` 全过。**包的数据一个字都没改** | 2026-10-14 |
| 32 | 玩家反馈「吉星战斗中不显示能量条」 | 定位为本包 `kits/chess_char_3_kichi_a.js` 与自带数据不一致：数据里 S1「欢迎您来！」`skillType: MANUAL` / `spCost: 50` / `initSp: 30`、S2「吉星高照！」`spCost: 44` / `initSp: 22`（`INCREASE_WITH_TIME`），而 kit 的 spec 把两个技能写成 `spCost: 0, spType: 'none', trigger: 'NEVER'`。引擎 `server/sim/skills.js:93` 取 `s.spCost ?? d.spCost` ⇒ spec 覆盖数据 ⇒ `server/sim/units.js:229` 的 `spMax` 变 0 ⇒ 客户端 `public/js/render/units.js:1546` 的 `showSp = (spMax > 0 || !!ammo)` 为假 ⇒ 不画能量条；同时 kit 的 hook 都判 `unit.skill.active`、`trigger NEVER` 又永不激活 ⇒ **S1/S2 的效果此前一次都没生效**。修复 = 删掉 kit 里这两行覆盖，让两个技能照数据充能（spMax 50 / 44），`MANUAL` 技能由引擎自动施放（S1 持续 36 s、S2 持续 30 s）。另修正 `pack.json` 描述里过期的公式（0.275% → 0.4835%）。验证：校验器 0 error / VALID、16/16 回归脚本通过、新增 `audit-kit-skill-sp.mjs` 全包 36 条技能 SP 一致、服务器重启后 `/workshop-kits/dongShip/chess_char_3_kichi_a.js` 已无 `spCost: 0` | 2026-10-14 |
| 33 | 玩家反馈「夜刀的入场动画是不是没绑」 | 是。包里 `art.chars[*].spine.*` 只声明了 `skel`/`atlas`，**没有声明 `anims` 动画角色**，而客户端 `public/js/render/spine.js:697` 的 `deploy()` 只认 `roles.deploy`（`die()` 有 `|| 'Die'` 兜底，deploy 没有）⇒ 4 名自带模型的新干员**全部没有入场动画**；顺带查了攻击/技能/死亡角色的可用性。修复：用引擎自带工具在同一份 .skel 上解析并解析角色（`tools/assets/skel.mjs` 的 parseSkel + `tools/assets/anim-roles.mjs` 的 resolveRoles，运行时 `@pixi-spine/runtime-3.8`），把 `anims` / `animations`(时长表) / `events` / `hits` / `bounds` / `pma` / `textures` 写进 `art.chars`，与官方 `data/assets.json` 条目同形；夜刀的模型没有 `Start`、只有 `Start_1/2/3`，入场显式绑 `Start_1`。同时发现 `char_118_yuki`(白雪) 的 **back 模型 .skel 已损坏**（3.8/4.0/4.1 三个解析器都在读中段时越界，29168 字节），已移除该侧的声明并删掉损坏文件（客户端 `assets.js:161` 在没有合法 `spine.back` 时回退到 front），待重新获取模型后再补。新增体检脚本 `F:\wsxy\22\audit-spine-anims.mjs`（逐模型断言 deploy/idle/attack 与贴图）| 2026-10-14 |
| 34 | 作者要求重定【东】效果一的斜率（口径不变：界面显示值与实际结算值逐字相同） | `server/battle/dong.mjs` 的 `base_damage_scale` 保持 3.3%，`damage_scale_per_stack` 由 0.004835 改为 **0.0032233** ⇒ 300 层正好 100%（50 层 19.4% / 100 层 35.5% / 150 层 51.6% / 200 层 67.8%）；`bonds.json`、`bond-specs/dongShip.json`、公告与 `pack.json` 描述的同一组数字同步 | 2026-10-14 |
| 35 | 作者要求的一轮强度与归属调整 | ① 麒麟R夜刀 4 本 → **5 本**（price 4 / sellPrice 1），并加入**不屈**盟约（`indomShip`，同时在 `overrides` 与 `bonds.json` 里补全该盟约的成员表，夜刀才会在界面里出现）；② 遥 5 本 → **4 本**（price 3）；③ 效果一斜率 0.0032233 → **0.0029754**（325 层正好 100%）；④ 神经损伤 60 → **30**/次；⑤ 嵯峨特质的攻击速度 1.5 → **1**（精锐 3 → **2**），攻击力/生命值不动；⑥ 白雪特性补一句「可攻击空中单位」（`canHitFly` 本就为 true，只是文本没写）| 2026-10-15 |
| 37 | 作者要求：白雪价格 1 金、去掉精准盟约 | `chess_char_1_21_a/b` 的 `price` 3 → 1；`bonds` 去掉 `preciShip`（保留 `visiShip` 与 `dongShip`）；`bonds:preciShip` 覆盖原本只多了白雪一条，连 `pack.json.overrides` 与 `bonds.json` 的那条覆盖一并删除 | 2026-10-15 |
| 38 | 玩家反馈：夜刀打铳骑时盟约追加伤害疑似真伤且溢出极高 | 检查：追加攻击 `type` 只在 phys/arts 之间按目标抗性切换（`weaknessRetype`），**不会变成真伤**；真伤来自敌方机制或元素损伤显示。真正的问题是 **继承了来源伤害的 `mul`**（`amount = atk × pct × dmg.mul`）—— 技能/暴击那一击的倍率会把追加攻击一起放大 ⇒ 溢出爆表；且 DamageInfo 未显式声明溅射/攻击行为、`isSkill` 跟着来源走。修复：`amount = atk × pct`、显式 `isSplash:false / isAttack:false / isSkill:false`，神经损伤那一份同样显式声明 ⇒ 追加攻击是**纯单目标的一次伤害** | 2026-10-15 |
| 39 | 作者要求加强【东】：改为 220 层达到 100% | 斜率 `damage_scale_per_stack` 0.0029754 -> **0.0043955**（`base_damage_scale` 仍 0.033）⇒ 0.033 + 0.0043955 × 220 = 100.0%；同步 `bonds.json`（顶层 bb 与 buffs[0].bb）、编辑器源 `bond-specs/dongShip.json`、`dong.mjs` 注释与 `pack.json` 描述（0.43955% / 220 层）；战斗模块本身从 bb 读数，无需改逻辑 | 2026-10-15 |
| 40 | 作者要求：叠层→伤害改为**简单平方函数**（不要复杂分段，前面平缓、400 层陡） | bb 新增 `curve_k = 0.00000625`，战斗模块 pct = **curve_k · 层数²**（有 curve_k 用平方，没有则退回线性 base+perStack，向后兼容）。锚点：100 层 6.25% / 200 层 25% / 300 层 56.3% / 400 层 **100%** / 450 层 126.6%。同步 bonds.json（顶层 bb 与 buffs[0].bb）、bond-specs、pack.json 描述与公告 | 2026-10-15 |
| 41 | 作者要求：平方曲线的 100% 锚点放到 **300 层**，且从 300 层起陡起来 | `curve_k` 0.00000625 -> **0.0000111111**（= 1/300²）⇒ 300 层 = 100.0%；曲线仍是单一平方 pct = curve_k·L²，增量随层数递增 ⇒ 300 层之后最陡（350 层 136.1%、400 层 177.8%、450 层 225.0%）。同步 bonds.json（2 处）、bond-specs、pack.json 描述与公告 | 2026-10-15 |
| 42 | 作者要求：夜刀默认技能改 S1、嵯峨默认技能改 S2 | 记录里 `skills[]` 本来就是完整技能对象，默认技能由**顶层 `skill`**（其 `index`）决定（客户端 `loadoutModel.skillRecord` 只认 `chess.skill.index === index` 的那份）。改法：`chess_char_9_yato_a/_b` 的顶层 skill 换成 index 0（鬼人化）、`chess_char_9_dong2_a/_b` 换成 index 1（除恶），并把各 skills[i].isDefault 同步。斩业星熊默认本来就是 index 1（无始无明 = S2），未改 | 2026-10-15 |
| 43 | 作者要求：遥改成"范围内队友受伤即触发技能"，不要再依赖"敌人走进攻击范围" | ① 数据：`chess_char_9_dong1_a/_b` 的 S3 夏末游鳞 `trigger.rule` **ACTIVE_RANGE → DEFAULT**（SP 满即放，不再需要敌人进范围）；② kit：`kits/chess_char_9_dong1_a.js` 在浮光泡影天赋里新增 `battle.on('damaged')` —— **队友在她攻击范围内受伤** ⇒ `giveSp(unit, ally_damaged_sp, 'trait')`（范围判定用引擎 support 的 `inRange`，新 import 自 `@battle/index.js`）；③ 数据：三个技能 bb 新增 `ally_damaged_sp = 3`（每次受伤充 3 SP，代码不写死、可调）。盟约/特性数值未动 | 2026-10-15 |
| 46 | 作者要求：把**赤冬**（`char_475_akafyu`）作为本包第 5 名自增干员加盟约 —— 记录 id `chess_char_9_akafuyu_a/_b`、4 阶 3 金、盟约【东】+【独行】、基础模板照宴（武者）、特质「每 3 层【东】：攻击力、生命 +1.5%」 | ① `chess.json` 新增两条记录（普通 `phase1 Lv70` / 精锐 `phase2 Lv60` + 模组 3 级），数值按 PRTS 缩放：E1max 2726/634/333、E2max 3635/798/378（`statsBase` 665/361 + 武将甲胄 attr 70/50）；两个技能（信影流·雷刀之势 = 二连击 + 阻挡数归零；信影流·十文字胜 = 流失 50% 当前生命 + 一层护盾 + 攻/防加成）都是 `INCREASE_WITH_TIME` + `MANUAL`，默认技能 **S1**；天赋1 信影流·羽飞（坚忍 +100 攻速、损失 70% 吃满）、天赋2 信影流·逆风（模组，阻挡时防御 +12%）；② `kits/chess_char_9_akafuyu_a.js`（唯一一条 kit 同时服务 `_a` / `_b`，引擎按 `baseId` 回退）；③ `garrisons.json` 新增 `garrison_akafuyu_dong_a/_b`（`act1autochess_gar_eff_attrByBond`，`divide_num: 3`、atk/max_hp 0.015，两条同值）；④ `bonds.json` 的【东】与【独行】`members`/`visibleMembers` 各补一条；⑤ `pack.json.art.chars` 登记头像 / 立绘 / 前后 Spine（动画角色按 `tools/assets/anim-roles.mjs` 的解析结果绑定：`deploy: Start`、`attack: Attack`、S2 = `Skill2_Begin` + `Skill2` + `Skill2_Idle`）、`art.skills` 登记两张技能图标、`voices` / `voiceLangs.cn` 各 12 槽位 | 2026-10-15 |
| 47 | 作者要求：**撤掉水月**（她的改动只有 `bonds`(+dongShip) 与 `garrisonIds`） | ① `pack.json.overrides` 删 `chess:chess_char_4_09_a` / `_b`（18 → 16 条）；② `chess.json` 删两条记录；③ `garrisons.json` 删两条孤儿特质 `garrison_mizuki_dong_a/_b`；④ `bonds.json`【东】成员表删她（【独行】是官方盟约、官方成员表本来就含她，只做追加，保留官方那条是正确行为） | 2026-10-15 |
| 44 | 作者要求：白雪加上【独行】盟约 | `chess_char_1_21_a/_b` 的 `bonds` 追加 `soloShip`；并新增 `bonds:soloShip` 覆盖（官方副本 + 把白雪写入 members/visibleMembers，界面才显示她），同时在 pack.json.overrides 显式声明 | 2026-10-15 |

**验证**（都是可复跑的）：

```
node F:\wsxy\forge\app\tools\workshop-validate.mjs F:\wsxy\forge\app\workshop\dongShip   # 0 error(s) / VALID
node F:\wsxy\22\test-akafuyu.mjs          # 赤冬专项：89 条全过（记录/盟约/特质/数值/技能/模组合成/kit/外观/语音）
node F:\wsxy\22\audit-dong-traits.mjs      # 按 Forge 规则逐条审计 19 条特质：0 错 1 警（potDown 的既有差异）
node F:\wsxy\22\audit-bond-display.mjs     # 24 条盟约的成员可见性 + 头像链：0 错 0 警
node F:\wsxy\22\test-dong-handlers.mjs     # 两个处理器的行为断言：19 条全过
node F:\wsxy\22\test-noirc2-module.mjs     # 火龙模组（引擎 loadoutRecord 合成）：14 条全过
node F:\wsxy\22\test-haruka-saga-modules.mjs # 遥 / 嵯峨 模组（默认 / 换模组 / 不装备）：25 条全过
```
**改写原则：只动 import 的 specifier，逻辑一个字节没改。** 每个内联文件顶部都有出处注释。

> ⚠️ **维护提示**：上游更新 `op-*.js` / `detmath.js` / `body.js` 时，这些内联副本**需要手工同步**。
> 这是工坊白名单的直接代价，不是本包的选择。


### 5.3 本轮（1.2.21，2026-10-18）：安洁莉娜改用引擎官方键；meta 依赖与上游 bug 写清楚

| # | 1.2.20 的做法 | 1.2.21 的做法 | 为什么 |
|---|---|---|---|
| 35 | 安洁莉娜新增的【东】特质 `garrison_angelina_dong_a/_b` 由本包 `server/meta/dong.mjs` 的 `custom_dong_refresh_layers` 实现（自定义 effectKey） | `effectKey` / `effectType` 都改成引擎自带的 **`SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER`**（官方 `garrison_147_a/_b` 用的就是它），`bb` / `bbStr` / `desc` 一个字没动；`pack.json.server.meta.registers` 去掉该键，模块里那段处理器删除 | ① 行为逐条相同（`refreshes × multiplier`，`max_layer` 封顶，`requireActiveOf(desc)` 读"已激活"）；② **纯数据 ⇒ 不依赖 `server.meta` 通道**，即使遇到下面那个上游 bug 也照常生效；③ 少一处自定义代码 = 少一处可能被上游改坏的地方 |
| 36 | 黑角发牌 `custom_dong_prep_pool`、艺人见面抽选券 `item:chess_item_ws_artist_ticket` 都走 `server.meta` | 保持 `server.meta`（引擎没有等价能力），但把依赖与规避写进文件头、公告与 README | 黑角要的条件是"全场 5 名【东】"：引擎的 `rowCondition` 只认 `character_same_row`（同行人数）/ `character_target_inboard`，其余无条件；`SERVER_POOL_CHAR` 还需要 `choices.json` 的池子，而包的 `choices.json` 是按 id 的记录表、**加不了 `pools`**（实测合并后仍是官方 16 个池）。抽选券要"每回合给层"，引擎的内置道具键里给层的只有 `use_equip_reward_char_chess_bond_layer`，钩子是 `onEquip`（一次性） |
| 37 | — | 记录**上游 bug**：`app/server/lobby.js` 在"房间声明了 mod 集合"时执行 `metaModules.filter((m) => roomIds.has(m.pack))`，而 `loadMetaModules()` 产出的对象字段是 `id`（无 `pack`）⇒ `roomIds` 非空时**所有包的 meta 模块被滤光**，`roomRegistry = null`，对局退回官方默认注册表，处理器不存在（表现为"特质不触发"、无任何报错） | 修法一行：`roomIds.has(m.pack)` → `roomIds.has(m.id)`（与同文件 `battleInstallers` 那处一致）。规避：建房时不声明 mod 集合；或用已修该行的 Forge。补丁与复现步骤见 `F:\wsxy\22\上游bug-lobby\` |

### 5.4 本轮（1.2.22–1.2.24，2026-10-18）：黑角门槛改为「本排 ≥4 枚」、白雪 2 金、夜刀调整

| # | 改前 | 改后 | 为什么 |
|---|---|---|---|
| 38 | 黑角：门槛 = 棋盘上 5 枚【东】棋子（数盟约成员），发 1 / 精锐 2 | 门槛 = **黑角所在那一排的棋子数 ≥ 4**（照引擎 `sameRowCount` 口径：只数棋盘 chess，token / 备战席 / 另一排不算）；发 `bb.count` 个（1 / 2），等级 ≤ 当前商店等级 | 作者定稿的新设计：门槛看"排"，【东】只决定**发给谁**。位置取 `ctx.piece(uid)`（在棋盘上才带 row/col），无位置即不触发 |
| 39 | 黑角 `bbStr = { bond: "dongShip" }` | `bbStr = { bond: "dongShip", conditionkey: "character_target_inboard" }` | 让派发器按官方语义**跳过备战席**（与官方 `character_target_inboard` 一致），避免"备战席里的黑角也在数排" |
| 40 | 白雪 `price: 1` | `price: 2`（`sellPrice` 保持 1） | 作者定稿；官方 `price=2` 的单位一律 `sellPrice=1` |
| 41 | 夜刀 `bonds = [dongShip, raidShip, indomShip]`；叠层上限 24 / 36 | 去掉 `indomShip`（连同 `bonds.json` 的 `indomShip.members/visibleMembers`）；上限 **12 / 24** | 作者定稿；文字同步"每场作战至多 12 / 24 层" |

另：本轮把 1.2.21 里误带的 7 个 `.tune-backup/` 调参备份从包里清掉（包内文件数 236 → 229）。

### 5.5 本轮（1.2.25，2026-10-20）：黑角改成歌蕾蒂娅同款内置键 + matchClass 注入池子

| # | 改前（1.2.24） | 改后 | 为什么 |
|---|---|---|---|
| 42 | 黑角用自己的 meta 处理器 `custom_dong_prep_pool`（自算"本排 ≥4 枚"） | `effectKey/effectType = SERVER_POOL_CHAR`（引擎内置，歌蕾蒂娅/焰尾同款）；`bb { count, check_count: 4 }`、`bbStr { pool: "pool_char_dongShip", conditionkey: "character_same_row" }` | 门槛/取牌都能用引擎现成的实现：`rowCondition` 的同行计数 + 池子的 `bond`/`maxTier: shopLevel`；`bb.count` 给 1 / 2 |
| 43 | 池子无从提供（包加不了 `choices.pools`） | 新增 `server.modules`（`server/modules/pool.mjs`，`uses: ["matchClass"]`）：在**这一局**的 `data.choices.pools` 浅拷贝注入 `pool_char_dongShip`；没装本包的房间原样 `return super(opts)` | 不改引擎、不动进程级数据；`matchClass` 是 DESIGN §28.14 给包的正式挂载点（要求 `combat: true`） |
| 44 | `server.meta.registers` = [黑角, 抽选券] | 只剩 [抽选券] | 黑角与安洁莉娜都走内置键；抽选券仍需要 meta（引擎没有"每回合给层"的内置道具键） |

### 5.6 本轮（1.2.26，2026-10-20）：抽选券改纯数据；整包不再有 server.meta

| # | 改前（1.2.25） | 改后 | 为什么 |
|---|---|---|---|
| 45 | 抽选券：meta 处理器 `item:chess_item_ws_artist_ticket`，每休整期结束 +2/3 层 | 纯数据：`buffs` = `use_equip_reward_special_goods_char_chess {refresh_cnt:3, choice_cnt:1}` + `equip_destory_gain_random_coin {min:1,max:2}`；`kind: consume_on_equip`、`category: RECRUIT` | 引擎没有"每回合给层"的内置道具键 ⇒ 那个效果必须 meta（于是必须打 lobby 补丁）；换成两个**都内置**的键之后不再依赖 meta。引擎的 `mergeHandlers` 会把同一条记录上的多个 buff 各跑一次，所以这是一件**组合效果**：没有官方装备同时给"三选一同盟约"和"返还资金" |
| 46 | 包里有 `server.meta`（黑角早期版本也用过） | `pack.json.server` 只剩 `battle` + `modules`；删除 `server/meta/` | 既然三件效果全部走引擎内置键，meta 通道就是纯负担（还会被上游 bug 打掉） |
| 47 | 抽选券 `giveBondId: "dongShip"`（常驻装备，配合变形同构体可授予【东】） | 改为 `consume_on_equip`、`giveBondId: null` | 装备即销毁，"常驻授予盟约"不再成立；描述与数据同步 |

### 5.7 本轮（1.2.27，2026-10-20）：抽选券恢复常驻；效果换成「出售计数抽人」

| # | 改前（1.2.26） | 改后 | 为什么 |
|---|---|---|---|
| 48 | 抽选券 `kind: consume_on_equip`（装备即销毁），`giveBondId: null`；效果=三选一 + 返钱 | `kind: passive_player`、`duration: -1`（**常驻不销毁**），`giveBondId: "dongShip"`（**保留与【变形同构体】配对授予【东】**）；效果=引擎内置键 `sell_char_count_gain_equip_owner_bond {count: 5}` | 业主：装备必须常驻，才能保留"与变形同构体同装 → 携带者视为【东】"这条。引擎里**常驻型**道具键只有两个（出售计数抽人 / 战斗后变形），后者是《突变细胞》的机制且会替换掉携带者、与变形同构体冲突 ⇒ 选前者 |
| 49 | — | 门槛 5 次出售（官方《商业包装方案》是 8 / 精锐 7） | 同一机制里给本件一个更低的门槛，靠"授予盟约那一半"与本包语境区分；数据里只有 `count` 一个数字可调 |

### 5.8 本轮（1.2.28，2026-10-20）：抽选券改成「每消耗资金」触发

| # | 改前（1.2.27） | 改后 | 为什么 |
|---|---|---|---|
| 50 | 抽选券：引擎内置键 `sell_char_count_gain_equip_owner_bond {count: 5}`（每出售 5 名干员抽 1 名） | 改成「每**消耗 15 资金**（精锐 10）抽 1 名」：数据侧 `buffs[].key = custom_dong_ticket_spend`、`params.gold = 15 / 10`；行为由 `server/modules/dong.mjs` 在这一局注册表副本上注册的 `item:chess_item_ws_artist_ticket.onSpend` 实现 | 引擎内置道具键里**没有 onSpend**（20 个键全是 onEquip/onSold/onArt/onBattleResult/onBuy），所以"按消耗资金"只能自己写；放进 `server.modules` 就不需要 `server.meta`，也就不受 lobby 那个 bug 影响 |
| 51 | — | 携带者算【东】时**只抽【东】**（否则退回引擎口径"与携带者任一盟约相同"） | 这是东盟约的券，用户期望发的是【东】；官方口径会把 deputShip/raidShip 的干员也抽进来。代码里 `preferDong = bonds.includes('dongShip')` |
| 52 | — | 计数器按**每件道具实例**（`dong_ticket_gold:<uid>`）累计，跨多次消费保留余数 | 消费是零散的（买 2/3/4 金），"每 15 金一张"必须累计；按实例计数避免两张券互相打乱节奏 |

### 5.9 本轮（1.2.29，2026-10-20）：抽选券发放范围改成「携带者已激活的盟约」

| # | 改前（1.2.28） | 改后 | 为什么 |
|---|---|---|---|
| 53 | 携带者算【东】时只抽【东】，否则抽"与携带者任一盟约相同"的干员 | 发放范围固定为 **携带者已激活的盟约**（`ctx.pieceBonds(holder).filter((b) => ctx.bondActive(b))`）；携带者没有任何已激活盟约时**不累计、不发放** | 业主定稿：抽选券应跟"当前真正生效的盟约"走，而不是绑死【东】；也让它在别的盟约阵容里有意义 |
| 54 | 计数器在"能发"之前就加 | 先判断有没有已激活盟约，再累加计数器 | 没激活时花掉的资金不该被吞掉，应在盟约激活后照常结算 |

## 6. 自带素材来源（逐条）

### 6.1 清点 —— ⚠️ **本包含《明日方舟》官方游戏素材**

按 `SKILL.md` §14 的口径：**含官方素材的包不因此被拒，但必须标注清楚**。以下为**实测清点**。

```
assets/  合计 208 个文件，16,884,033 B（16.10 MB）

按目录                                按扩展名
  spine        39 个  11,461,809 B     .mp3   140 个   3,065,888 B
  voice       140 个   3,065,888 B     .skel   13 个   9,372,157 B
  char         15 个   2,091,769 B     .png    42 个   4,312,785 B
  skill        11 个     197,916 B     .atlas  13 个     133,203 B
  item          2 个      54,035 B
  bond          1 个      12,616 B

自制 / 官方：盟约图标 assets/bond/dongShip.png（1 个，12,616 B）为**自制**；
其余 207 个（spine 39 / char 15 / skill 11 / item 2 / voice 140）均为**官方素材**。
道具图标来自官方道具图（艺人见面抽选券），干员语音来自官方语音文件，两者都算官方素材。
```

**不含** `.spresources` 容器（本包没有用 `assets.container`）。

### 6.2 逐条来源

| 素材 | 数量 | 来源 | 说明 |
|---|---|---|---|
| **Spine 模型**（`.skel` `.atlas` `.png`） | 39 | 见下五行 | 5 名干员 × front/back × 3 文件（赤冬另有 1 套 +3） |
| └ 火龙S黑角 `char_1030_noirc2` | 6 | 作者提供 `D:\ccccc\SHJ\{FRONT,BACK}` | —— |
| └ 白雪 `char_118_yuki` | 6 | **PRTS**（正面 `F_` 骨骼、背面 `B_` 骨骼） | 见 `kits/chess_char_1_21_a.js` 顶部注释 |
| └ 吉星 `char_4203_kichi` | 6 | 作者提供 `D:\ccccc\kichi` | —— |
| └ 麒麟R夜刀 `char_1029_yato2` | 6 | 作者提供 `D:\ccccc\yato` | —— |
| └ 赤冬 `char_475_akafyu` | 9 | 作者提供 `D:\ccccc\aka`（正面 3 + 背面 3 + 立绘头像 3） | `D:\ccccc\aka\back\char_475_akafyu (1).png` 是背面那页 512×512 贴图，装进包时重命名为同名 `.png`（正/背各在自己的目录里，互不覆盖） |
| **半身像**（180×360） | 10 | 火龙 = **PRTS**；吉星 / 白雪 / 夜刀 = **作者提供**并裁切 | 格式对齐官方（原版对照：佩佩 `char_4058_pepe`） |
| **头像**（180×180） | 5 | 火龙 = **PRTS**；其余 = **作者提供** | 同上 |
| **技能图标**（128×128） | 11 | **PRTS** | 文件名是技能**名**（如 `技能_居合拔刀气刃斩.png`），已重命名为 `skchr_*.png`；赤冬两张取自 PRTS 静态资源 `torappu.prts.wiki/assets/skill_icon/skill_icon_skchr_akafyu_{1,2}.png`（她的 charId 是 `char_475_akafyu`，官方素材仓库里**没有**这个命名，Kengxxiao 镜像只有 `char_475_akafyu`） |
| **盟约图标** `bond/dongShip.png` | 1 | **自制** | 盟约【东】的图标 |
| **道具图标** `item/act44side_token_ticket.png`（128×128，银色双箭头 = 普通）/ `item/act44side_token_ticket_g.png`（128×128，金色双箭头 = 精锐） | 2 | **作者第二次提供的贴图**（`D:\ccccc\dong\dong.rar` 里的两张 128×128；原文件是 JPEG、后缀写成 .PNG，已转成真 PNG） | 装备「艺人见面抽选券」的图标；`pack.json` 的 `itemIcons` 把它挂到官方道具 id `act44side_token_ticket` 上，走 `/workshop-assets` 路由。无光晕那版留在工作区 `F:\wsxy\22\icon\act44side_token_ticket_noglow.png`（覆盖同名文件即可换） |
| **干员战斗语音** `voice/<charId>/{jp,cn}/<slot>_<n>.mp3`（12 槽位 × 2 语种，5 名干员 = 140 个 mp3, 2.92 MB） | 140 | **上游官方语音**（ArknightsAssets2 语音仓库，经 gh-proxy 镜像） | 白雪 / 吉星 / 麒麟R夜刀 / 火龙S黑角 / 赤冬是**本包自增**的干员，本机官方素材清单里没有它们 ⇒ 语音由包自带：`pack.json` 的 `voices` = 日文（默认语种）、`voiceLangs.cn` = 中文；槽位对齐引擎 `tools/assets/audio.mjs` 的 `VOICE_SLOTS`。下载/安装脚本 `F:\wsxy\22\fetch-dong-voices.mjs`（赤冬那一批用 `F:\wsxy\22\akafyu-fetch.mjs`，行号取自 gamedata `charword_table.json`：行动出发 CN_019 … 行动失败 CN_032） |

### 6.3 权利声明

- 上述素材（除自制盟约图标外）的版权归**上海鹰角网络科技有限公司 / Yostar 及其授权方**所有。
- 本包与发布者**不主张**这些素材的任何权利。
- **仅供非商业**的学习与个人娱乐使用，**请勿用于任何商业场景**（售卖、付费分发、收费开服、广告、打赏等一律禁止）。
- PRTS wiki 的文字与图片按其自身许可（维基文本 CC BY-NC-SA）；本包只取用其中的图片文件并以游戏内格式重新命名。
- 若权利人认为不妥，请联系作者删除。