// 用产品渲染器重放「库里真实存下来的那张图」——不是新编的 spec，是课堂里发出去的那份
// 用法：node node_modules/vite-node/vite-node.mjs scripts/figure-replay.ts <spec.json> <out.html>
import fs from 'node:fs';
import path from 'node:path';
import { renderSpecFigure } from '@/components/teaching-figure/render';

const [, , specPath, outArg] = process.argv;
const payload = JSON.parse(fs.readFileSync(path.resolve(specPath), 'utf8')) as {
  kind: string;
  palette?: string;
  spec?: Record<string, unknown>;
  caption?: string | null;
  at?: string;
};

const r = renderSpecFigure(payload.kind, payload.spec, { palette: (payload.palette || 'indigo') as never });
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>figure replay</title>
<style>
  body{margin:0;padding:20px;background:#f6f7f9;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .meta{font:12px/1.7 ui-monospace,Consolas,monospace;color:#7b8494;margin-bottom:10px}
  .card{background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:14px;display:inline-block}
  svg{display:block}
</style></head><body>
<div class="meta">${payload.kind} / ${payload.palette || 'indigo'} · ${payload.at || ''} · 这是课堂里实际下发的那份 spec，用同一渲染器重画</div>
<div class="card">${r ? r.svg : '渲染失败'}</div>
</body></html>`;

const out = path.resolve(outArg || '../outputs/learn-visual-aids-20261017/replay.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('written', out, r ? `${r.width}x${r.height}` : 'failed');
