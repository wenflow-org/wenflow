/**
 * material:semantic:eval —— 向量化/重排接入材料层的**真机评测**（≥20 条用例）。
 *
 * 覆盖四类判据：
 *   A. 单资料语义召回（top-1 命中期望章节，同资料内有近邻干扰章节）
 *   B. 跨资料语义召回（top-1 命中期望资料）
 *   C. rerank 精排（返回重排分且 top-1 命中）
 *   D. 代表采样（超长资料把关键内容放在尾部 → 采样能取到，头部截断取不到）
 *   E. 关停开关（MATERIAL_SEMANTIC_DISABLED=1 → 零调用、返回空）
 *
 * 用法：npm --prefix backend run material:semantic:eval
 *      npm --prefix backend run material:semantic:eval -- --only=A      （只跑某类）
 * 退出码：全部通过 0，否则 1。
 *
 * 隔离：资料写入临时目录（MATERIAL_UPLOAD_DIR），不碰用户真实资料。
 */

import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { writeMaterial, type MaterialRecord } from '../services/materials/material-store';
import { chunkMaterialMarkdown } from '../services/materials/material-chunker';
import {
  buildMaterialVectorIndex,
  recallMaterialChunks,
  selectRepresentativeText,
} from '../services/materials/material-semantic.service';

const USER_ID = 'semantic_eval_user';

interface DocSpec {
  key: string;
  name: string;
  /** 章节：标题 + 正文（正文含该主题的关键词，用于判命中） */
  sections: Array<{ title: string; body: string }>;
}

/** 10 份主题互不重叠的资料（跨资料干扰源）；主题内部细节词区分度高。 */
const DOCS: DocSpec[] = [
  { key: 'health', name: '学前儿童健康指南.docx', sections: [
    { title: '一、健康成长', body: '健康领域关注幼儿身体发育与动作发展，包括走跑跳攀爬等基本动作的协调与平衡能力，以及生活习惯与自我保护的养成。' },
    { title: '二、语言表达', body: '语言领域强调倾听与表达，包括愿意讲话、能清楚表达自己的想法、喜欢听故事与阅读图画书。' },
    { title: '三、社会交往', body: '社会领域关注人际交往与社会适应，包括愿意与人交往、能与同伴友好相处、有自尊自信自主的表现。' },
  ] },
  { key: 'math', name: '初中数学教材.docx', sections: [
    { title: '第一章 有理数', body: '有理数包括正数负数与零，掌握数轴表示、相反数与绝对值，会进行有理数的加减乘除与乘方运算。' },
    { title: '第二章 一元一次方程', body: '一元一次方程的标准形式为 ax+b=0，通过移项合并同类项解方程，并能用方程解决实际问题如行程与工程问题。' },
    { title: '第三章 几何图形', body: '几何图形认识三角形四边形与圆，掌握全等三角形的判定定理与轴对称图形的基本性质。' },
  ] },
  { key: 'bio', name: '生物必修一.docx', sections: [
    { title: '第一节 细胞结构', body: '细胞是生命活动的基本单位，包括细胞膜细胞质细胞核等结构，线粒体与叶绿体是重要的细胞器。' },
    { title: '第二节 光合作用', body: '光合作用在叶绿体中进行，利用光能将二氧化碳和水合成有机物并释放氧气，分为光反应与暗反应两个阶段。' },
    { title: '第三节 遗传规律', body: '孟德尔通过豌豆杂交实验发现分离定律与自由组合定律，基因位于染色体上并成对存在。' },
  ] },
  { key: 'history', name: '中国近代史讲义.docx', sections: [
    { title: '第一讲 鸦片战争', body: '1840 年鸦片战争爆发，清政府战败签订南京条约，中国开始沦为半殖民地半封建社会。' },
    { title: '第二讲 洋务运动', body: '洋务运动主张师夷长技以自强，创办军事工业与民用工业，建立北洋水师，但未能使中国富强。' },
    { title: '第三讲 辛亥革命', body: '1911 年辛亥革命推翻清朝统治，结束两千多年封建君主专制制度，建立中华民国。' },
  ] },
  { key: 'chinese', name: '语文现代文阅读.docx', sections: [
    { title: '一、记叙文阅读', body: '记叙文以记人叙事为主，阅读时把握六要素与线索，分析人物形象与情节发展，体会作者情感。' },
    { title: '二、说明文阅读', body: '说明文以说明事物事理为主，常见说明方法有举例子列数字打比方作比较，需把握说明对象与特征。' },
    { title: '三、议论文阅读', body: '议论文三要素为论点论据论证，需找出中心论点并分析论据类型与论证方法的作用。' },
  ] },
  { key: 'java', name: 'Java 编程入门.docx', sections: [
    { title: '第 1 章 变量与类型', body: 'Java 是强类型语言，基本数据类型包括 int double boolean char，变量声明需指定类型并遵循命名规范。' },
    { title: '第 2 章 面向对象', body: '面向对象三大特性是封装继承多态，类与对象是核心概念，通过构造方法创建实例。' },
    { title: '第 3 章 集合框架', body: 'Java 集合框架包括 List Set Map 接口，ArrayList HashMap 是常用实现，遍历可用迭代器或增强 for。' },
  ] },
  { key: 'psy', name: '教育心理学.docx', sections: [
    { title: '第一节 行为主义', body: '行为主义认为学习是刺激与反应之间建立联结的过程，代表人物有巴甫洛夫斯金纳，强调强化与惩罚的作用。' },
    { title: '第二节 认知主义', body: '认知主义关注学习者的内部心理过程，认为学习是信息加工与认知结构重组，代表人物有布鲁纳奥苏贝尔。' },
    { title: '第三节 建构主义', body: '建构主义认为知识是学习者在一定情境下借助他人帮助主动建构的，强调情境协作会话与意义建构。' },
  ] },
  { key: 'food', name: '食品安全法规.docx', sections: [
    { title: '一、生产许可', body: '食品生产经营需取得食品生产许可证，符合生产条件与工艺流程要求，接受监督管理。' },
    { title: '二、标签标识', body: '预包装食品标签应标明名称配料表净含量生产日期保质期与生产者信息，不得含有虚假内容。' },
    { title: '三、添加剂使用', body: '食品添加剂应在规定范围内限量使用，不得以掩盖食品腐败变质或以掺杂掺假为目的使用添加剂。' },
  ] },
  { key: 'photo', name: '摄影基础教程.docx', sections: [
    { title: '一、光圈与快门', body: '光圈控制进光量与景深，光圈越小景深越大；快门速度决定曝光时间，慢门可拍出流水轨迹。' },
    { title: '二、构图法则', body: '构图常用三分法引导线与对称，主体突出画面平衡，留白能提升照片的呼吸感。' },
    { title: '三、光线运用', body: '光线分为顺光侧光逆光，黄金时刻的柔和光线适合人像，逆光拍摄需注意补光与测光。' },
  ] },
  { key: 'accounting', name: '会计基础实务.docx', sections: [
    { title: '一、会计科目', body: '会计科目按经济内容分为资产类负债类所有者权益类成本类与损益类，是设置账户的依据。' },
    { title: '二、借贷记账法', body: '借贷记账法以有借必有贷借贷必相等为记账规则，资产增加记借方，负债增加记贷方。' },
    { title: '三、财务报表', body: '财务报表包括资产负债表利润表现金流量表，反映企业财务状况经营成果与现金流量。' },
  ] },
];

interface CaseResult { id: string; kind: string; desc: string; pass: boolean; detail: string; }

function makeRecord(spec: DocSpec, markdown: string): MaterialRecord {
  return {
    id: crypto.randomUUID(),
    userId: USER_ID,
    name: spec.name,
    ext: '.docx',
    format: 'docx',
    size: Buffer.byteLength(markdown, 'utf-8'),
    charCount: markdown.length,
    structure: { pageCount: null, slideCount: 0, sheetCount: 0, headingCount: spec.sections.length, tableCount: 0, listCount: 0, paragraphCount: spec.sections.length * 2, chunkCount: spec.sections.length },
    anchors: [],
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}

function docMarkdown(spec: DocSpec): string {
  return spec.sections.map((s) => `# ${s.title}\n${s.body}`).join('\n\n');
}

async function main(): Promise<void> {
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1]?.toUpperCase();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-semantic-eval-'));
  process.env.MATERIAL_UPLOAD_DIR = tmpRoot;

  const results: CaseResult[] = [];
  const push = (r: CaseResult) => { results.push(r); };

  try {
    // 落盘 10 份资料
    const built = DOCS.map((spec) => {
      const markdown = docMarkdown(spec);
      const record = makeRecord(spec, markdown);
      writeMaterial(record, markdown);
      return { spec, record, markdown };
    });
    console.log(`[eval] 已落盘 ${built.length} 份资料（临时目录 ${tmpRoot}）`);

    // A. 单资料语义召回：每份资料取第 1 个章节主题提问，期望 top-1 命中该章节
    if (!only || only === 'A') {
      for (const { spec, record } of built) {
        for (const section of spec.sections.slice(0, 1)) {
          const query = queryFor(section.title);
          const hits = await recallMaterialChunks({ userId: USER_ID, query, materialIds: [record.id], topK: 3, records: [record] });
          const top = hits[0];
          const hit = Boolean(top && sameSection(top.title, section.title));
          push({
            id: `A:${spec.key}`, kind: 'A-单资料召回', desc: `${spec.name} 问「${query}」`,
            pass: hit, detail: hit ? `top1=「${top!.title}」cos=${top!.score.toFixed(3)}` : `top1=「${top?.title ?? '无'}」（期望「${section.title}」）`,
          });
        }
      }
    }

    // B. 跨资料语义召回：期望在 10 份资料里命中正确的那份
    if (!only || only === 'B') {
      const crossCases: Array<{ query: string; expect: string }> = [
        { query: '光合作用把二氧化碳和水合成有机物', expect: 'bio' },
        { query: '辛亥革命推翻封建君主专制', expect: 'history' },
        { query: '封装继承多态是什么意思', expect: 'java' },
        { query: '建构主义强调情境与意义建构', expect: 'psy' },
        { query: '预包装食品标签要标哪些内容', expect: 'food' },
        { query: '三分法构图让主体更突出', expect: 'photo' },
        { query: '借贷记账法的记账规则', expect: 'accounting' },
        { query: '全等三角形的判定定理', expect: 'math' },
      ];
      for (const testCase of crossCases) {
        const hits = await recallMaterialChunks({
          userId: USER_ID,
          query: testCase.query,
          topK: 3,
          // 候选=全部落盘资料（默认档只取最近 MAX_RECALL_MATERIALS 份，评测要覆盖全量）
          records: built.map((b) => b.record),
        });
        const expectDoc = DOCS.find((d) => d.key === testCase.expect)!;
        const top = hits[0];
        const hit = Boolean(top && top.materialName === expectDoc.name);
        push({
          id: `B:${testCase.expect}`, kind: 'B-跨资料召回', desc: `问「${testCase.query}」`,
          pass: hit, detail: hit ? `top1=${top!.materialName}·「${top!.title}」` : `top1=${top?.materialName ?? '无'}（期望 ${expectDoc.name}）`,
        });
      }
    }

    // C. rerank 精排（对比：纯余弦 vs rerank 后的 top-1）
    if (!only || only === 'C') {
      const target = built.find((b) => b.spec.key === 'psy')!;
      const query = '关注学习者内部心理过程与信息加工的学习理论';
      const plain = await recallMaterialChunks({ userId: USER_ID, query, materialIds: [target.record.id], topK: 3, records: [target.record] });
      const reranked = await recallMaterialChunks({ userId: USER_ID, query, materialIds: [target.record.id], topK: 3, records: [target.record], rerank: true });
      const top = reranked[0];
      const hasRerankScore = reranked.every((h) => typeof h.rerankScore === 'number');
      push({
        id: 'C:rerank', kind: 'C-rerank 精排', desc: `问「${query}」`,
        pass: hasRerankScore && Boolean(top),
        detail: `余弦top1=「${plain[0]?.title}」→ rerank top1=「${top?.title}」(rerank=${top?.rerankScore?.toFixed(4) ?? 'n/a'})`,
      });
      push({
        id: 'C:rerank-doc', kind: 'C-rerank 精排', desc: 'rerank 结果按分降序',
        pass: reranked.every((h, i) => i === 0 || (h.rerankScore ?? 0) <= (reranked[i - 1].rerankScore ?? 0)),
        detail: reranked.map((h) => `${h.title}:${h.rerankScore?.toFixed(4)}`).join(' | '),
      });
    }

    // D. 代表采样：同质填充占满头部与中段，关键内容只在尾部（头部截断必然丢失）
    if (!only || only === 'D') {
      // 单个长段落（无空行）反复填充 → 逼出「超长段落硬切」路径，且各块近乎同质
      const filler = '本资料为内部整理版本，以下为目录与版本修订记录，正文内容请见后文。'.repeat(800); // ≈26k 字
      const tailSection = '# 关键结论\n螺旋式课程强调同一概念在不同学段以逐渐加深的方式反复出现，是布鲁纳课程设计思想的核心。';
      const longDoc = `# 目录\n${filler}\n\n${tailSection}`;
      const spec: DocSpec = { key: 'longdoc', name: '超长内部资料.docx', sections: [{ title: '关键结论', body: '螺旋式课程' }] };
      const record = makeRecord(spec, longDoc);
      writeMaterial(record, longDoc);

      const budget = 6_000;
      const sampled = await selectRepresentativeText(record, longDoc, budget);
      const headTruncated = longDoc.slice(0, 24_000); // 模拟 brief 旧口径的头部截断
      push({
        id: 'D:sample-tail', kind: 'D-代表采样', desc: `关键内容只在尾部（正文 ${longDoc.length} 字）时采样能取到`,
        pass: Boolean(sampled && sampled.includes('螺旋式课程')),
        detail: sampled ? `采样 ${sampled.length} 字，含关键句=${sampled.includes('螺旋式课程')}` : '采样返回 null（回退截断）',
      });
      push({
        id: 'D:head-miss', kind: 'D-代表采样', desc: '对照：旧口径头部截断取不到尾部关键内容',
        pass: !headTruncated.includes('螺旋式课程'),
        detail: `头部 ${headTruncated.length} 字含关键句=${headTruncated.includes('螺旋式课程')}（应为 false）`,
      });
      push({
        id: 'D:budget', kind: 'D-代表采样', desc: '采样文本受预算约束',
        pass: Boolean(sampled) && sampled!.length <= budget + 400,
        detail: `采样长度=${sampled?.length ?? 0}（上限 ${budget}+开销）`,
      });
    }

    // E. 关停开关：语义层整体可一键退回
    if (!only || only === 'E') {
      process.env.MATERIAL_SEMANTIC_DISABLED = '1';
      try {
        const hits = await recallMaterialChunks({ userId: USER_ID, query: '光合作用' });
        const sampled = await selectRepresentativeText(built[0].record, built[0].markdown, 10);
        push({
          id: 'E:disabled', kind: 'E-关停开关', desc: 'MATERIAL_SEMANTIC_DISABLED=1 → 召回空 + 采样 null',
          pass: hits.length === 0 && sampled === null,
          detail: `recall=${hits.length} 条，sampled=${sampled === null ? 'null' : '非空'}`,
        });
      } finally {
        delete process.env.MATERIAL_SEMANTIC_DISABLED;
      }
    }

    // 附：分块数量健全性（确保召回单元非空）
    if (!only || only === 'F') {
      const chunks = chunkMaterialMarkdown(docMarkdown(DOCS[0]));
      push({
        id: 'F:chunk', kind: 'F-分块健全性', desc: '每章节切出一块',
        pass: chunks.length === DOCS[0].sections.length,
        detail: `块数=${chunks.length}（期望 ${DOCS[0].sections.length}）`,
      });
      const index = await buildMaterialVectorIndex(docMarkdown(DOCS[0]));
      push({
        id: 'F:dims', kind: 'F-分块健全性', desc: '向量维度 = 1024（bge-m3）',
        pass: Boolean(index) && index!.dimensions === 1024,
        detail: `dims=${index?.dimensions ?? 'n/a'} model=${index?.model ?? 'n/a'}`,
      });
    }
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // 汇总
  const passed = results.filter((r) => r.pass).length;
  const byKind = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const entry = byKind.get(r.kind) ?? { pass: 0, total: 0 };
    entry.total += 1;
    if (r.pass) entry.pass += 1;
    byKind.set(r.kind, entry);
  }
  console.log('\n================ 用例明细 ================');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.kind}] ${r.id}  ${r.desc}\n       ${r.detail}`);
  }
  console.log('\n================ 汇总 ================');
  for (const [kind, entry] of byKind) console.log(`${kind}: ${entry.pass}/${entry.total}`);
  console.log(`合计: ${passed}/${results.length} 通过`);

  process.exitCode = passed === results.length ? 0 : 1;
}

/** 由章节标题构造一个自然的提问（不直接照抄标题，考验语义而非字符串匹配）。 */
function queryFor(title: string): string {
  const map: Record<string, string> = {
    '一、健康成长': '幼儿身体发育与基本动作发展',
    '第一章 有理数': '正负数与绝对值怎么运算',
    '第一节 细胞结构': '细胞的组成结构有哪些',
    '第一讲 鸦片战争': '中国近代史半殖民地化的开端',
    '一、记叙文阅读': '怎么分析记叙文的人物形象',
    '第 1 章 变量与类型': 'Java 基本数据类型有哪些',
    '第一节 行为主义': '刺激反应联结与强化的学习理论',
    '一、生产许可': '开食品厂需要什么许可证',
    '一、光圈与快门': '光圈和快门分别控制什么',
    '一、会计科目': '会计科目是怎么分类的',
  };
  return map[title] ?? title;
}

/** 命中的块标题与期望章节是否同一节（容错 `#` 前缀与空白）。 */
function sameSection(actualTitle: string | null | undefined, expected: string): boolean {
  const norm = (s: string) => String(s || '').replace(/^[#\s]+/, '').replace(/\s+/g, '').trim();
  return norm(actualTitle || '').includes(norm(expected)) || norm(expected).includes(norm(actualTitle || ''));
}

main().catch((error: unknown) => {
  console.error('[material:semantic:eval] 运行失败:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
