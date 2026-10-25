// 开屏地图素材闸门：浏览器端先「下载地图素材后进入服务器」，下完才 import main.js。
//
// 2026-10-25 从主服（stronghold-030，a4 线）的 public/js/resources/entryAssets.js 移植（7,616B 版，
// sha256 01005c3b3b1d3a2ff5679f833efffeb7d2367e5d0f03b23a9bbf0a3da2daf53f）：
//   * 清单用 same-origin 的 /data/local-assets.json。a5 的服务器视图（server/http/assetViews.js）已把路径改写成
//     /assets/~<16hex>/…，实测 11 个非 tex 的 scene 组、map/mesh 组齐全 —— 与闸门的「scene 组 ≥ 11」判据兼容（2026-10-25 核对）；
//   * 与主服的差异二：a5 清单里 map/skymirror、map/suilingcave、mesh/skymirror_bkg、mesh/suilingcave_bkg 共 40 条是
//     `/assets/local/…` 直链（这些文件不在磁盘、索引里没有哈希，assetViews.js 按原注释「索引没有哈希的 URL 原样保留」），
//     实测全部 404。主服原版遇到非哈希路径会抛「素材清单尚未准备好」，在 a5 必然卡住；这里改成**跳过**直链，
//     只下 173 条里的 133 条哈希素材（实测合计 45.7 MB，全部 200）；
//   * 主服那版 sw.js 还带 R2 回源（download.bs.leio.fun/v0.3.0）：a5 素材全部在本机 public/assets/local 下，
//     这一支不移植，sw.js 只加「浏览器素材缓存命中即答」一段；
//   * 本地客户端（UA 含 SPClient/Windows、SPClient/Android、Android WebView `; wv)` 或 WebView2 的
//     chrome.webview）直接跳过：客户端自带本地素材，不该再下浏览器缓存；
//   * 与主服的唯一行为差异：下载失败时面板多一个「先进入（素材边玩边下）」兜底，只在当前标签页生效
//     （sessionStorage），不写完成标记，下次开屏仍会重试完整下载。
//
// 缓存名与主服一致（sp-browser-assets-v1）：已缓存的地图素材下次开屏只做命中检查，不再下载。
const CACHE_NAME = 'sp-browser-assets-v1';
const GATE_MARKER = 'sp.browserAssetsReady.v1';
const SKIP_KEY = 'sp.assetGateSkip';
const SCENE_GROUP = /^scene\//;
const BOARD_GROUP = /^(map|mesh)\//;

function nativeClient() {
  return /SPClient\/(?:Windows|Android)|; wv[);]/i.test(navigator.userAgent || '') || !!globalThis.chrome?.webview;
}

function legacySession() {
  try { return !!sessionStorage.getItem('sp.token') && !localStorage.getItem(GATE_MARKER); } catch { return false; }
}

function skippedSession() {
  try { return sessionStorage.getItem(SKIP_KEY) === '1'; } catch { return false; }
}

function entryUrls(manifest) {
  const groups = manifest?.groups;
  if (!groups || typeof groups !== 'object') throw new Error('地图清单不可用');
  const scenes = Object.keys(groups).filter((group) => SCENE_GROUP.test(group) && group !== 'scene/tex');
  if (scenes.length < 11) throw new Error('地图清单不完整，请稍后重试');
  const urls = new Set();
  for (const [group, entries] of Object.entries(groups)) {
    if (!SCENE_GROUP.test(group) && !BOARD_GROUP.test(group)) continue;
    for (const entry of Object.values(entries || {})) {
      const path = entry?.path;
      // 直链（`/assets/local/…`）在 a5 没有对应文件（索引无哈希，assetViews 原样保留）——跳过，不下载。
      if (typeof path === 'string' && /^\/assets\/~[0-9a-f]{16}\//.test(path)) urls.add(path);
    }
  }
  if (!urls.size) throw new Error('素材清单尚未准备好，请稍后重试');
  return [...urls];
}

function renderGate() {
  const splash = document.getElementById('boot');
  if (!splash) throw new Error('启动页面不可用');
  splash.setAttribute('aria-hidden', 'false');
  const inner = splash.querySelector('.boot__inner') || splash;
  const panel = document.createElement('div');
  panel.className = 'sp-entry-assets';
  const title = document.createElement('div');
  title.className = 'sp-entry-assets__title';
  title.textContent = '下载地图素材后进入服务器';
  const status = document.createElement('div');
  status.className = 'sp-entry-assets__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = '已缓存的地图素材下次可复用；若浏览器清理缓存，需重新下载。';
  const progress = document.createElement('progress');
  progress.max = 1;
  progress.value = 0;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '下载并进入';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'sp-entry-assets__skip';
  skip.textContent = '先进入（素材边玩边下）';
  skip.hidden = true;
  const alternative = document.createElement('div');
  alternative.className = 'sp-entry-assets__alternative';
  alternative.textContent = '不想等待浏览器素材下载？加入 QQ 群 1124360673，在群文件安装 Windows／Android 客户端。客户端无需等待本服浏览器地图包，并可切换至其他兼容的 HTTPS 服务器。';
  panel.append(title, status, progress, button, skip, alternative);
  inner.append(panel);
  const style = document.createElement('style');
  style.textContent = '.sp-entry-assets{width:min(520px,88vw);margin:22px auto 0;color:#dcebe7;text-align:center;font:14px/1.6 sans-serif}.sp-entry-assets__title{font-size:20px;font-weight:700;color:#4ed8af}.sp-entry-assets__status{margin:10px 0}.sp-entry-assets progress{display:block;width:100%;height:12px;accent-color:#4ed8af}.sp-entry-assets button{margin:16px 0;padding:10px 24px;background:#4ed8af;border:0;color:#06251d;font-weight:700;cursor:pointer}.sp-entry-assets button:disabled{opacity:.55;cursor:default}.sp-entry-assets__skip{background:none!important;color:#a9b9b4!important;font-weight:400!important;text-decoration:underline;padding:0!important;margin:0 0 12px!important}.sp-entry-assets__alternative{font-size:12px;color:#a9b9b4}';
  document.head.append(style);
  return { status, progress, button, skip, dispose: () => { panel.remove(); style.remove(); } };
}

async function controlledWorker() {
  if (!('serviceWorker' in navigator) || !('caches' in globalThis)) throw new Error('当前浏览器不支持持久素材缓存，请使用最新版浏览器或安装客户端');
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  await navigator.serviceWorker.ready;
  const controlsAssets = () => {
    try { return new URL(navigator.serviceWorker.controller?.scriptURL).pathname === '/sw.js'; } catch { return false; }
  };
  if (!controlsAssets()) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
  if (controlsAssets()) {
    try { sessionStorage.removeItem('sp.assetSwReloaded'); } catch {}
    return;
  }
  try {
    if (sessionStorage.getItem('sp.assetSwReloaded')) throw new Error('素材缓存启动失败，请关闭页面后重试');
    sessionStorage.setItem('sp.assetSwReloaded', '1');
    sessionStorage.setItem('sp.assetGateStart', '1');
  } catch (error) {
    if (error?.message?.includes('素材缓存')) throw error;
  }
  location.reload();
  await new Promise(() => {});
}

async function preload(urls, onProgress) {
  const cache = await caches.open(CACHE_NAME);
  const progress = { done: 0, total: urls.length, bytes: 0 };
  let next = 0;
  let firstError = null;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const cached = await cache.match(url);
        if (cached?.ok) { progress.done++; onProgress({ ...progress }); continue; }
        const response = await fetch(url, { cache: 'default' });
        if (!response.ok || response.type === 'opaque') throw new Error('素材下载失败：' + url);
        const cacheWrite = cache.put(url, response.clone());
        const body = await response.arrayBuffer();
        if (!body.byteLength) throw new Error('素材为空：' + url);
        await cacheWrite;
        progress.bytes += body.byteLength;
        progress.done++;
        onProgress({ ...progress });
      } catch (error) {
        if (!firstError) firstError = error;
      }
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  if (firstError) throw firstError;
}

export async function enterWithAssets() {
  if (nativeClient() || legacySession() || skippedSession()) return;
  const ui = renderGate();
  const complete = async (askPersistence = false) => {
    ui.button.disabled = true;
    try {
      if (askPersistence) try { await navigator.storage?.persist?.(); } catch {}
      await controlledWorker();
      const response = await fetch('/data/local-assets.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('地图清单加载失败');
      const urls = entryUrls(await response.json());
      await preload(urls, ({ done, total, bytes }) => {
        ui.progress.max = total;
        ui.progress.value = done;
        ui.status.textContent = `地图素材 ${done}/${total}，本次下载 ${(bytes / 1048576).toFixed(1)} MiB`;
      });
      try { localStorage.setItem(GATE_MARKER, '1'); } catch {}
      ui.dispose();
      return true;
    } catch (error) {
      ui.status.textContent = error?.name === 'QuotaExceededError'
        ? '浏览器存储空间不足，请清理空间后重试，或安装群文件里的客户端'
        : error?.message || '下载失败，请重试';
      ui.button.textContent = '重试下载';
      ui.button.disabled = false;
      ui.skip.hidden = false;
      return false;
    }
  };
  const marker = (() => { try { return localStorage.getItem(GATE_MARKER); } catch { return null; } })();
  const resumed = (() => {
    try {
      const pending = sessionStorage.getItem('sp.assetGateStart');
      sessionStorage.removeItem('sp.assetGateStart');
      return pending === '1';
    } catch { return false; }
  })();
  if ((marker || resumed) && await complete()) return;
  await new Promise((resolve) => {
    ui.button.addEventListener('click', async () => { if (await complete(true)) resolve(); });
    ui.skip.addEventListener('click', () => {
      try { sessionStorage.setItem(SKIP_KEY, '1'); } catch {}
      ui.dispose();
      resolve();
    });
  });
}
