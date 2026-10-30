/**
 * 位置线通道的重放：它不走 renderSpecFigure，而是在 TeachingFigure.vue 里用模板画。
 * 所以这里用同一个组件做一次 SSR，把课堂里真的下发的那份 spec 渲染出来——
 * 重放的必须是产品代码，不是另写一份近似实现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import TeachingFigure from '@/components/TeachingFigure.vue';

const [, , specPath, outArg] = process.argv;
const payload = JSON.parse(fs.readFileSync(path.resolve(specPath), 'utf8'));
const app = createSSRApp({ render: () => h(TeachingFigure, { figure: payload }) });
const body = await renderToString(app);
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>position-line replay</title>
<style>
  body{margin:0;padding:20px;background:#f6f7f9;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .card{background:#fff;border:1px solid #e3e7ef;border-radius:12px;padding:14px;display:inline-block}
  img,svg{display:block}
</style></head><body><div class="card">${body}</div></body></html>`;
const out = path.resolve(outArg);
fs.writeFileSync(out, html);
console.log('written', out, body.length);
