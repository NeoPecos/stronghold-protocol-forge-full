import { useState } from '../../vendor/hooks.module.js';
import { DLC_PACKS } from '../../../shared/dlc.js';
import { t } from '../../../shared/i18n.js';
import { html } from '../ui/components.js';
import { net } from '../net.js';
import { toastError } from '../ui/toasts.js';
import { savePref } from '../store.js';
import * as roomMods from '../roomMods.js';

/** 房主上一次启用的 DLC 组合（本地记忆，房间建立时 room.js 会自动套回，见 DLC_PREF_FOLLOW）。 */
const DLC_PREF = 'dlc.last';

/** A separate room page; the server decides the effective pack set. */
export function DlcPage({ room, myId, onClose }) {
  const [busy, setBusy] = useState(null);
  const [selected, setSelected] = useState(null);
  const available = new Set(room.dlc?.available || []);
  const enabled = new Set(room.dlc?.enabled || []);
  const packs = DLC_PACKS.filter((pack) => available.has(pack.id) && pack.id !== 'side-story');
  const standardPacks = packs.filter((pack) => pack.id !== 'dossoles');
  const storyPack = packs.find((pack) => pack.id === 'dossoles');
  const host = room.hostId === myId;
  const locked = !!room.inMatch || (room.seats || []).some((seat) => seat && !seat.isBot && seat.ready);
  const mine = (room.seats || []).find((seat) => seat?.playerId === myId);
  const needsConsent = enabled.size > 0 && mine && mine.dlcConsent === false;
  const change = async (id, on) => {
    if (busy || !host || locked) return;
    setBusy(id);
    try {
      await net.request('room.setDlc', { id, on });
      // 记下房主这次的选择：下一间新房默认套回同一组 DLC（用户要求：上一局开的，下一局不关就该还开着）。
      const next = new Set(enabled);
      if (on) next.add(id); else next.delete(id);
      savePref(DLC_PREF, { ids: [...next] });
    } catch (error) { toastError(error); }
    finally { setBusy(null); }
  };
  const consent = async () => {
    if (busy) return;
    setBusy('consent');
    try { await net.request('room.join', roomMods.buildJoinPayload(room.code, { consent: true })); }
    catch (error) { toastError(error); }
    finally { setBusy(null); }
  };
  const card = (pack) => html`<article key=${pack.id} class=${`dlc-card${enabled.has(pack.id) ? ' is-on' : ''}`}>
    <div class="dlc-card__copy"><small>${pack.id}</small><h2>${t(pack.name)}</h2><p>${t(pack.detail)}</p>
      <button type="button" class="dlc-card__details" onClick=${() => setSelected(pack.id)}>${t('查看详情')}</button></div>
    <button type="button" role="switch" aria-checked=${enabled.has(pack.id)} aria-label=${`${t(pack.name)} ${enabled.has(pack.id) ? t('已启用') : t('未启用')}`}
      disabled=${!host || locked || !!busy} onClick=${() => change(pack.id, !enabled.has(pack.id))}>
      <span>${enabled.has(pack.id) ? t('已启用') : t('未启用')}</span><i></i>
    </button>
  </article>`;
  return html`<div class="dlc-page" role="dialog" aria-modal="true" aria-label=${t('DLC 管理')}>
    <header class="dlc-page__head">
      <button type="button" class="dlc-page__back" onClick=${onClose}>← ${t('返回房间')}</button>
      <div><small>DOWNLOADABLE CONTENT</small><h1>${t('DLC 管理')}</h1></div>
      <span class="dlc-page__count">${t('已启用 {n} 项', { n: packs.filter((pack) => enabled.has(pack.id)).length })}</span>
    </header>
    <main class="dlc-page__body">
      <p class="dlc-page__intro">${t('每项 DLC 的盟约、角色数据和战斗内容独立开关。未启用的 DLC 不进入本房间对局。')}</p>
      <div class="dlc-page__grid">
        ${standardPacks.map(card)}
      </div>
      ${storyPack ? html`<section class="dlc-page__story" aria-label=${t('故事集')}>
        <h2>${t('故事集')}</h2>
        <p>${t('开启多索雷斯时会自动加载所需规则，无须单独开启故事集。')}</p>
        <div class="dlc-page__grid">${card(storyPack)}</div>
      </section>` : null}
      <p class="dlc-page__note">${locked ? t('已有玩家准备或对局已开始，DLC 设置已锁定。') : host
        ? t('更改 DLC 后，其他玩家需要重新确认并准备。') : t('只有房主能更改 DLC。')}</p>
      ${needsConsent ? html`<button type="button" class="dlc-page__consent" disabled=${!!busy} onClick=${consent}>${t('确认本房间 DLC')}</button>` : null}
    </main>
    ${selected ? (() => {
      const pack = DLC_PACKS.find((entry) => entry.id === selected);
      return pack ? html`<section class="dlc-detail" role="dialog" aria-modal="true" aria-label=${`${t(pack.name)}${t('详情')}`}>
        <header><button type="button" onClick=${() => setSelected(null)}>← ${t('返回 DLC 列表')}</button><small>${pack.id}</small></header>
        <div class="dlc-detail__body"><h2>${t(pack.name)}</h2><p>${t(pack.detail)}</p>
          <h3>${t('包含内容')}</h3><ul>${pack.contents.map((line) => html`<li>${t(line)}</li>`)}</ul>
          <p class="dlc-detail__status">${enabled.has(pack.id) ? t('此房间已启用') : t('此房间未启用')}</p>
        </div>
      </section>` : null;
    })() : null}
  </div>`;
}
