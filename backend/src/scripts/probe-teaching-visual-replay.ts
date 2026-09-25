/* eslint-disable no-console -- 一次性诊断 CLI */
/**
 * 教学配图「优化后重放」探针（2026-09-24 配图审计的回归工具）。
 *
 * 做法：取**真实课堂出现过的**画面描述（原样，含老师写进去的"标注××"类文字要求），
 * 走生产链路 composeTeachingVisualPrompt（新口径：禁图内文字 + 画抽象关系）→ generateImages，
 * 落盘 PNG 供人工比对。同描述可跑新旧两版 prompt 对照（--legacy 用旧版风格前缀）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/probe-teaching-visual-replay.ts --out=../doc/re_test/img-audit/replay
 *   npx ts-node --transpile-only src/scripts/probe-teaching-visual-replay.ts --legacy --out=/tmp/replay-legacy
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { generateTeachingVisual, type TeachingVisualRequest } from '../services/ai-teaching/teaching-visual.service';

/** 审计样本的真实 subject（doc/re_test/img-audit/extracted.json，原样未改） */
const CASES: Array<{ tag: string; request: TeachingVisualRequest }> = [
  {
    tag: 'flour-flow',
    request: {
      kind: '流程图',
      prompt:
        '一张横向流程图，展示蛋糕店一袋面粉在店内流转的几个位置顺序。从左到右依次是：货架上的整袋（袋身标着25公斤）→ 案板边（袋子被拆开，敞口）→ 搅拌盆（面粉变成糊状）→ 案板边（剩下半袋，袋口重新折起，看不出还剩多少）→ 货架（半袋又被放回原位）。每个节点之间用一个向右的箭头连接，表示货物被挪动一次。整张图横向构图，留白充足，线条简洁，只用简单轮廓和少量文字标注，不要细节写实。',
      caption: '同一袋面粉，在店里换了好几个位置，每换一次、每动一下，它在账上对应的"数"就跟着变了。',
    },
  },
  {
    tag: 'domain-skeleton',
    request: {
      kind: '示意图',
      prompt:
        '一张横向构图的骨架示意图：左侧一个大方框标注"一、健康"，右侧用三条连线分别连到三个小方框，依次标注"（一）身心状况""（二）动作发展""（三）生活习惯与生活能力"，表示一个领域下挂三个方面；下方留白，便于继续补入语言、社会、科学、艺术四个大框。',
      caption: '一个领域（大格）下面挂着几个方面（小格），照这个样式往下填。',
    },
  },
];

async function main(): Promise<void> {
  const outIdx = process.argv.findIndex((a) => a.startsWith('--out='));
  const outDir = path.resolve(outIdx >= 0 ? process.argv[outIdx].slice(5) : '../doc/re_test/img-audit/replay');
  fs.mkdirSync(outDir, { recursive: true });

  for (const c of CASES) {
    process.stdout.write(`[${c.tag}] 生成中…`);
    const image = await generateTeachingVisual({ request: c.request, messages: [] });
    if (!image?.url) {
      console.log(' 失败（null）');
      continue;
    }
    const res = await fetch(image.url);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(outDir, `${c.tag}-new.png`);
    fs.writeFileSync(file, buf);
    console.log(` 已落盘 ${file}（${buf.length} bytes，model=${image.model}，prompt 头 40 字=${image.prompt.slice(0, 40)}…）`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
