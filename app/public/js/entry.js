// 浏览器开屏闸门（2026-10-25 从主服 0.3.0 的 public/js/entry.js 移植）：
// 先过地图素材下载闸门，再加载 main.js。本地客户端与旧标签页在闸门里直接放行，行为与直接加载 main.js 相同。
import { enterWithAssets } from './resources/entryAssets.js';

enterWithAssets().then(() => import('./main.js')).catch((error) => {
  console.error('[entry] failed', error);
  window.__spBootFail?.('load');
});
