// 用本机 Chrome headless 把每张图的独立 HTML 页面截成 PNG（不依赖 IAB，可批量）。
// 用法：node render-pngs.mjs <pagesDir> <outDir> [chromePath]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [pagesDir, outDir, chromeArg] = process.argv.slice(2);
const CHROME = chromeArg || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!pagesDir || !outDir) throw new Error('用法: render-pngs.mjs <pagesDir> <outDir>');
fs.mkdirSync(outDir, { recursive: true });

const toUrl = (p) => 'file:///' + path.resolve(p).split(path.sep).join('/');

const files = fs
  .readdirSync(pagesDir)
  .filter((f) => f.endsWith('.html'))
  .sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]));

let ok = 0;
for (const f of files) {
  const html = fs.readFileSync(path.join(pagesDir, f), 'utf8');
  const m = html.match(/<svg[^>]*width="(\d+(?:\.\d+)?)"[^>]*height="(\d+(?:\.\d+)?)"/);
  const w = Math.ceil(Number(m?.[1] || 840)) + 24;
  // 底部留 32px：note/基线在下沿时，16px 会被窗口高度切掉最后一行（2026-10-23 实拍）
  const h = Math.ceil(Number(m?.[2] || 400)) + 32;
  const out = path.resolve(outDir, f.replace(/\.html$/, '.png'));
  const r = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${w},${h}`,
      `--screenshot=${out.split(path.sep).join('/')}`,
      toUrl(path.join(pagesDir, f)),
    ],
    { encoding: 'utf8', timeout: 60000 },
  );
  if (fs.existsSync(out)) ok += 1;
  else console.error('fail', f, (r.stderr || '').slice(0, 200));
}
console.log(`rendered ${ok}/${files.length} → ${outDir}`);
