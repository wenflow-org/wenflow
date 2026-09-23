/* eslint-disable no-console */
import 'dotenv/config';
import prisma from '../src/config/database';
(async () => {
  const p = prisma as any;
  const containing = await p.learning_paths.count({ where: { aiPromptTemplate: { contains: 'kcAnnotation' } } });
  const rows = await p.learning_paths.findMany({ where: { aiPromptTemplate: { contains: 'kcAnnotation' } }, select: { id: true, userId: true, aiPromptTemplate: true } });
  let parseable = 0, withKcs = 0;
  const ids: Array<{ id: string; userId: string }> = [];
  for (const r of rows) {
    let t: any = null; try { t = JSON.parse(r.aiPromptTemplate || '{}'); } catch { continue; }
    parseable += 1;
    if (t?.kcAnnotation?.conceptKcs?.length) { withKcs += 1; ids.push({ id: r.id, userId: r.userId }); }
  }
  let withTraces = 0, traces = 0;
  for (const i of ids) {
    const c = await p.memory_traces.count({ where: { userId: i.userId, pathId: i.id } });
    if (c > 0) { withTraces += 1; traces += c; }
  }
  console.log(`含字符串 kcAnnotation=${containing}  可 JSON 解析=${parseable}  真有 conceptKcs=${withKcs}`);
  console.log(`其中：有痕迹 ${withTraces} 条（共 ${traces} 条痕迹），无痕迹 ${withKcs - withTraces} 条`);
})().catch((e) => console.error('ERR', e.message)).finally(() => (prisma as any).$disconnect());
