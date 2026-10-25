// Classic service worker for art a player imported on this origin.
// Keep these three lines in sync with public/js/assetCache.js (that module documents why this file is not a module).
const IMPORTED_ASSET_CACHE = 'sp-imported-assets-v1';
const IMPORTED_ASSET_CACHE_PREFIX = 'sp-imported-assets-';
const IMPORTED_ASSET_PATH = /^\/(?:assets|fonts|media)\/~[0-9a-f]{16}\//;

// 浏览器开屏下载的地图素材缓存（2026-10-25）：public/js/resources/entryAssets.js 在闸门里把
// scene/map/mesh 素材写进这个 Cache Storage。这里只做「命中即答」，绝不在 SW 里缓存网络响应
// （与导入素材那一支同一口径；浏览器自己的 HTTP 缓存仍然生效）。
const BROWSER_ASSET_CACHE = 'sp-browser-assets-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(IMPORTED_ASSET_CACHE_PREFIX) && name !== IMPORTED_ASSET_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (!IMPORTED_ASSET_PATH.test(url.pathname)) return;
  event.respondWith((async () => {
    // 1) 玩家导入的美术优先（导入缓存里同路径就是导入的那份）。
    const imported = await caches.open(IMPORTED_ASSET_CACHE);
    // The exact key: an import stores each URL without a query, so the path is the key. `ignoreSearch` would make
    // Chrome scan every entry — about 4 s per request once a whole pack (some 43,000 entries) is imported.
    const hit = await imported.match(url.origin + url.pathname);
    if (hit) return hit;
    // 2) 开屏闸门下载的地图素材：命中即答，不联网。
    const assets = await caches.open(BROWSER_ASSET_CACHE);
    const cached = await assets.match(url.origin + url.pathname);
    if (cached) return cached;
    // 3) 都没有才走网络；同样不缓存网络响应（HTTP 缓存仍适用）。
    return fetch(request);
  })());
});
