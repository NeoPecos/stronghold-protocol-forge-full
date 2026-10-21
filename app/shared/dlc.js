// Gameplay additions offered as independent room DLCs. Utility, appearance and
// server UI packs remain part of every room's baseline set.
export const DLC_PACKS = Object.freeze([
  { id: 'ave-mujica', name: '颂乐人偶', detail: '5 名成员与 Fever 机制', contents: [
    '丰川祥子、三角初华、祐天寺若麦、八幡海铃、若叶睦五名成员干员。',
    '颂乐人偶核心盟约及五层人数效果：刷新奖励、资金、部署位与效果翻倍。',
    '成员特质、Fever 战斗机制、专属策略，以及战场 Fever 进度显示。',
    '调整三条既有盟约的成员或效果。',
  ] },
  { id: 'rimbilliton', name: '雷姆必拓', detail: '9 名干员与开拓玩法', contents: [
    '九名卡池干员及对应特质、技能和战斗表现。',
    '开拓心核心盟约、开拓大地策略与沙地兽召唤物。',
    '新增装备、战斗效果与驻防奖励，并调整部分既有干员数据。',
  ] },
  { id: 'dongShip', name: '东国', detail: '东盟约与角色调整', contents: [
    '东核心盟约：十三名成员、三人启动与六人强化效果。',
    '白雪、吉星、麒麟R夜刀、火龙S黑角、赤冬等新增干员及立绘、语音。',
    '十一组专属特质、追加攻击与神经损伤，以及艺人见面抽选券装备。',
    '补全七条既有盟约的成员，并上调赤冬的增益类数值。',
  ] },
  { id: 'columbia', name: '哥伦比亚', detail: '盟约、装备与策略', contents: [
    '哥伦比亚核心盟约：源石辅助仪、随机进阶装备与额外携带装备效果。',
    '混沌本质策略及哥伦比亚盟约干员。',
    '源石辅助仪、沙盘 α、沙盘 β、同行者四件装备，以及相关角色数据调整。',
  ] },
  { id: 'dossoles', name: '多索雷斯', detail: '假日盟约与水蚀机制', requires: ['side-story'], contents: [
    '多索雷斯假日故事集盟约及假日威龙陈、林、羽毛笔、龙舌兰四名干员。',
    '水蚀地形、侵蚀损伤、敌人减速与侵蚀爆发后的持续伤害。',
    '六件知名商品标志物装备，由龙舌兰的特质提供。',
    '需要故事集规则包；开启本 DLC 时会一并开启故事集。',
  ] },
  { id: 'side-story', name: '故事集', detail: '故事集盟约的公共规则', contents: [
    '故事集盟约类型与禁用抽签规则，并处理专属干员的本局禁用。',
    '局内盟约徽标、开局简报分区与结算报告分区。',
    '攻速、法抗、技力回复、再部署时间等可供故事集盟约使用的公共效果。',
    '本包自身不新增干员、盟约或策略；多索雷斯需要它作为规则前置。',
  ] },
]);

export const DLC_IDS = new Set(DLC_PACKS.map((pack) => pack.id));
export const enabledDlcIds = (ids) => DLC_PACKS.filter((pack) => ids?.includes(pack.id)).map((pack) => pack.id);
export const basePackIds = (catalogue) => (Array.isArray(catalogue) ? catalogue : [])
  .map((pack) => pack?.id).filter((id) => typeof id === 'string' && !DLC_IDS.has(id));
