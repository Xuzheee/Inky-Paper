import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Compare the selected concept's content crop at the real 400x210 CSS size.
// Original image files remain untouched; only the comparison page clips/scales.
const out = path.resolve('output/playwright/focus-strip');
await mkdir(out, { recursive: true });
const png = async file => `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
const reference = await png('docs/design/focus-options-20260915/01-horizontal.png');
const normal = await png(path.join(out, 'paper.png'));
const paused = await png(path.join(out, 'paused.png'));
const dark = await png(path.join(out, 'dark.png'));
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:28px;background:#eeeee8;color:#30332f;font:14px "Microsoft YaHei",sans-serif}
h1{font-size:20px;margin:0 0 24px}h2{font-size:14px;font-weight:400;margin:0 0 10px}
.row{display:flex;gap:28px;margin-bottom:28px}.crop{position:relative;width:400px;height:210px;overflow:hidden}
.crop img{position:absolute;width:1150.56px;max-width:none;left:-104.12px;top:-325.84px}
img.actual{display:block;width:400px;height:auto}p{max-width:828px;font-size:12px;line-height:1.7}
</style><h1>第 1 版 · 400×210 内容区域对照</h1>
<div class="row"><section><h2>选定原型（534×280 裁切区缩至 400×210）</h2><div class="crop"><img src="${reference}"></div></section>
<section><h2>真实 Tauri 运行态（600×315 截图缩至 CSS 尺寸）</h2><img class="actual" src="${normal}"></section></div>
<div class="row"><section><h2>真实透明态 · 深色测试背景</h2><img class="actual" src="${dark}"></section>
<section><h2>真实暂停态 · 展开的起点记录</h2><img class="actual" src="${paused}"></section></div>
<p>动态计时和铅笔位置来自测试会话。纸纹、鱼、字体使用现有打包素材。透明态计时固定在右侧原位，避免原型中静态示意的重排；背景仅用于对比可读性。</p>`;
await writeFile(path.join(out, 'comparison.html'), html);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  await page.screenshot({ path: path.join(out, 'comparison.png'), fullPage: true });
} finally { await browser.close(); }
