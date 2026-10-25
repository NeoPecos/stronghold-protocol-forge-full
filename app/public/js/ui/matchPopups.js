// In-match popups (2026-10-13, the owner's request: the event's in-match motion, video 7:57–8:00 and 8:32–8:52),
// original drawings only (ui/pixbots.js). One dark translucent plate in the middle of the field:
//   * RoundPopup — at each round start: [robot] · 回合 NN (the old number drops away, the new one falls in) · 获得 ⁂ (the
//     coins flash, +N slides in with sparks); a red strip 「剩余 N 回合」 on top while the final assault is three rounds or
//     fewer away. It folds away by itself (≈2.5 s).
//   * PhasePopup — a phase that starts with words: 联防阶段 (orange, two robots, big chevrons sweeping right), 机变阶段,
//     最终攻势 / 隐秘核心. Words from ui/gameLogic/phases.js phaseBanner.
// screens/game.js picks the moment; pointer-events none, so the field stays usable under them. Styles: css/screens/game.css
// 局内弹窗. With prefers-reduced-motion they still show (the information), without the motion.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { CoinGlyph } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** How long the round popup holds before it folds away (ms), and the fold. */
export const ROUND_POPUP_MS = 2300;
const LEAVE_MS = 280;

/** Two-digit round number as the plate shows it (00 before the first round). */
export const roundDigits = (n) => String(Math.max(0, Math.trunc(Number(n) || 0)) % 100).padStart(2, '0');

/**
 * Rounds left before the final assault, for the red strip: 1–3, else null (no strip). `pub.bossRound` is the final
 * assault's round; the hidden core and random mode's last round get no strip.
 * @param {any} pub m.public
 */
export function roundsToBoss(pub) {
  const r = Math.trunc(Number(pub?.round));
  const b = Math.trunc(Number(pub?.bossRound));
  if (!Number.isFinite(r) || !Number.isFinite(b) || r <= 0 || pub?.randomMode) return null;
  const left = b - r;
  return left >= 1 && left <= 3 ? left : null;
}

/** Auto-dismiss: `leaving` after `ms`, onDone after the fold. Re-key the popup to replay it. */
export function useTimedLeave(ms, onDone) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setLeaving(true), ms);
    const b = setTimeout(() => onDone?.(), ms + LEAVE_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  return leaving;
}

/** The plate's left block: corner crosses, side brackets, the drawing(s) and a line of fine type under them. */
function MainRoundFigure() {
  return html`<svg class="mpop__bot mpop__bot--0" viewBox="0 0 170 150" fill="none">
        <path d="M69 98h43v28H69zM70 121h16v22H70zM97 121h16v22H97z" fill="currentColor"/>
        <path d="M46 26h71l11 11v57l-11 11H46L35 94V37z" fill="currentColor"/>
        <path d="M66 61h12v12H66zM97 61h12v12H97z" fill="#0a302b"/>
        <path d="m16 84 41-8 10 58-42 9z" fill="currentColor" stroke="#0a302b" stroke-width="5" stroke-linejoin="bevel"/>
        <path d="m18 85 29-5 9 48" stroke="#0a302b" stroke-width="4"/>
        <path d="m126 98 30 9-5 17-27-9z" fill="currentColor"/>
        <path d="M19 39h7v7h-7zM31 18h8v8h-8zM140 25h8v8h-8zM153 49h7v7h-7z" fill="currentColor"/>
      </svg>`;
}

function PopArt({ kinds, tag }) {
  return html`<div class="mpop__art" aria-hidden="true">
    <i class="mpop__x mpop__x--tl"></i><i class="mpop__x mpop__x--tr"></i><i class="mpop__x mpop__x--bl"></i><i class="mpop__x mpop__x--br"></i>
    <i class="mpop__brk mpop__brk--l"></i><i class="mpop__brk mpop__brk--r"></i>
    <span class="mpop__bots"><${MainRoundFigure} /></span>
    <span class="mpop__tag">${tag}</span>
  </div>`;
}

/**
 * The round-start plate.
 * @param {{ round: number, gain?: number|null, left?: number|null, onDone?: Function }} props
 *   gain: the funds this round start paid (null = not known / not in the round: the coins without a number)
 *   left: rounds before the final assault (roundsToBoss) — the red strip on top
 */
export function RoundPopup({ round, gain = null, left = null, onDone }) {
  const leaving = useTimedLeave(ROUND_POPUP_MS, onDone);
  const n = Number.isFinite(gain) && gain > 0 ? Math.trunc(gain) : null;
  return html`<div class=${cx('mpop', 'mpop--round', leaving && 'is-leaving')} role="status" aria-live="polite"
      aria-label=${t('第 {r} 回合', { r: round })} data-testid="round-popup">
    <div class="mpop__panel">
      ${left ? html`<div class="mpop__head"><span class="mpop__warn" aria-hidden="true"></span>${t('剩余')} <b class="num">${left}</b> ${t('回合')}</div>` : null}
      <${PopArt} kinds=${['bot']} tag="ROUND // START" />
      <div class="mpop__cell mpop__cell--round">
        <span class="mpop__k">${t('回合')}</span>
        <span class="mpop__roll num"><b class="mpop__old">${roundDigits(round - 1)}</b><b class="mpop__new">${roundDigits(round)}</b></span>
      </div>
      <div class="mpop__cell mpop__cell--gold">
        <span class="mpop__k">${t('获得')}</span>
        <span class="mpop__gain"><i class="mpop__flare" aria-hidden="true"></i><${CoinGlyph} class="mpop__coin" />${n ? html`<b class="mpop__plus num">+${n}</b>` : null}</span>
        ${n ? [0, 1, 2, 3, 4, 5, 6].map((i) => html`<i key=${i} class="mpop__spark" style=${`--i:${i}`} aria-hidden="true"></i>`) : null}
      </div>
    </div>
  </div>`;
}

/**
 * A phase plate: drawings, title (+ optional line), chevrons sweeping through on the right (联防 / boss rounds).
 * @param {{ tone?: 'mint'|'orange'|'red'|'gold', kinds?: string[], title: any, sub?: any, micro?: string, chev?: boolean,
 *   duration?: number, onDone?: Function }} props
 */
export function PhasePopup({ title, sub, duration = 3400, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const hideTimer = setTimeout(() => setLeaving(true), duration);
    const doneTimer = setTimeout(() => { setGone(true); onDone?.(); }, duration + 360);
    return () => { clearTimeout(hideTimer); clearTimeout(doneTimer); };
  }, [duration]);
  if (gone) return null;
  const smile = '/assets/ui/hudPanel/trans_coop1.png';
  const frown = '/assets/ui/hudPanel/trans_coop3.png';
  return html`<div class=${cx('unite-intro', leaving && 'is-leaving')} style=${`--unite-intro-ms:${duration + 360}ms`}
    role="status" aria-live="polite" aria-label=${sub ? `${title}，${sub}` : title}>
    <div class="unite-intro__top" aria-hidden="true">
      <span class="unite-intro__top-icons"><img src=${smile} alt="" /><img src=${frown} alt="" /></span>
      <span class="unite-intro__top-label">${t('联防')} ${t('开始')}</span>
    </div>
    <div class="unite-intro__plate">
      <span class="unite-intro__faces" aria-hidden="true"><img src=${smile} alt="" /><img src=${frown} alt="" /></span>
      <strong class="unite-intro__title">${title}</strong>
      <span class="unite-intro__arrows" aria-hidden="true"><i></i><i></i></span>
    </div>
  </div>`;
}

/**
 * The popup a phase starts with (screens/game.js), from its phaseBanner words — or null: 回合开始 has RoundPopup,
 * 最终攻势 the merged-LP plate (ui/matchPlates.js FinalAssaultPlate), and 休整期 / 作战开始 have none (the top bar's
 * capsule says it, ui/hud.js CapsuleFx).
 * @param {string} phase @param {{ title: any, sub?: any, micro?: string, tone?: string } | null} banner
 */
export function phasePopupOf(phase, banner) {
  if (!banner || phase !== 'UNITE') return null;
  return { tone: 'orange', faces: true, chev: true, duration: 3400, ...pick(banner) };
}
const pick = (b) => ({ title: b.title, sub: b.sub || null, micro: b.micro || '' });

// compat shim for 0.3.1 shell (UI package bases on 0.2.x)
export function preloadPopupArt() {}
