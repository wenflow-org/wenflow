/**
 * 课堂 Skill 合集（单文件）：把课堂上真正调用到的提示词按调用顺序拼成一份。
 *
 * 为什么拼一份而不是各自散着：交接/评审时最常问的是「这一节课到底有哪些 skill、按什么顺序、
 * 各自输入输出是什么」。散在 30 个 md 里没人读得下去；拼成一份可以直接顺着读。
 *
 * 原则：
 *   - 正文**原样**拼接（不润色、不摘要），改提示词请改 prompts/ 下的源文件再重跑本脚本；
 *   - 每个 skill 前面加一张小卡（何时调用 / 输入 / 输出 / 源文件），卡片由本脚本维护；
 *   - 只在索引里列出的 skill 不展开全文（避免把 15 万字的虚拟学习者模拟也塞进来）。
 *
 * 用法：node outputs/e2e/skill-pack.mjs [out=doc/CLASSROOM_SKILLS.md]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outPath = path.resolve(ROOT, process.argv[2] || 'doc/CLASSROOM_SKILLS.md');
const P = (name) => path.join(ROOT, 'prompts', name);

const read = (name) => {
  const p = P(name);
  if (!fs.existsSync(p)) throw new Error(`缺少提示词：${p}`);
  return fs.readFileSync(p, 'utf8');
};

/** 拆 frontmatter，方便卡片里引用元信息 */
const split = (md) => {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return { meta, body: md.slice(m[0].length) };
};

/**
 * 正文里的标题降两级，避免把合集的目录结构冲散（`## 身份` 会出现十几次）。
 * 只动标题行，代码块里的 `# 注释` 原样保留——提示词必须逐字可对照。
 */
const demoteHeadings = (body) => {
  let inFence = false;
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence) return line;
      const m = line.match(/^(#{1,5})\s+/);
      return m ? `${'#'.repeat(m[1].length + 2)} ${line.slice(m[0].length)}` : line;
    })
    .join('\n');
};

const STAGES = [
  {
    title: '一、课前：这节课是怎么被造出来的',
    note:
      '学习路径不是运行时即兴生成的。这条链提前产出「上什么课、到什么程度算过、学生会卡在哪」，' +
      '课堂回合只消费它的产物（task / acceptanceCriteria / anticipatedMisconceptions / taskKcs / strategy）。',
    items: [
      {
        file: 'skill.path-planning.md',
        when: '生成学习路径时（每名学生每条目标一次）',
        input: '学习目标 + 学习者画像 + 约束（时间/学科/年级）',
        output: 'milestone → stage → task 三层结构；落 learning_paths / tasks',
        code: 'services/learning/generation/path-generation.core.ts:15',
      },
      {
        file: 'skill.stage-designer.md',
        when: '路径落库后，为每个 subtask 补教学细节',
        input: 'task + 学科/年级 + 知识点',
        output: 'acceptanceCriteria、anticipatedMisconceptions（任务级迷思预判）、材料引用',
        code: 'services/learning/generation/stage-enrichment.ts:15',
      },
      {
        file: 'skill.kc-mapper.md',
        when: '同上，紧跟 stage-designer',
        input: 'task 的学科内容',
        output: '知识点组件（kcId / name / taxonomy）→ 教学回合的 scenario.taskKcs',
        code: 'services/learning/generation/kc-annotation.ts:21',
      },
      {
        file: 'skill.path-reviewer.md',
        when: '路径生成后复核（可跳过）',
        input: '整条路径 + 目标',
        output: '复核意见与修订建议；不合格的 stage 回炉',
        code: 'skills/path-reviewer',
      },
    ],
  },
  {
    title: '二、课堂执行：学生每说一句话，走一遍',
    note:
      '这是「一节课里反复发生的」四个 skill。teaching-turn 是主体；board-designer 是 2026-10-27 的板书层，' +
      '在探针内与 teaching-turn 串行（先定板、再说话），保证老师说的每句话都对应板上真实存在的东西。' +
      '板书层尚未接进 teaching-turn-engine，线上课堂目前只跑 teaching-turn。',
    items: [
      {
        file: 'skill.teaching-opening-generator.md',
        when: '进入一个 task 的第一回合',
        input: 'task + 材料摘要 + 学生画像',
        output: '开场白（建立情境、给出第一个问题），不含图',
        code: 'services/ai-teaching/teaching-opening.service.ts',
      },
      {
        file: 'skill.teaching-turn.md',
        when: '每一轮学生发言',
        input: '对话历史 + scenario（taskType/认知帧/策略/材料/占位）+ 代码裁决的控制信号 + boardContext',
        output: 'reply / analysis / knowledge / pedagogy / control / figure',
        code: 'skills/teaching-turn（提示词 63KB，输出由 normalizeOutput 白名单收口）',
      },
      {
        file: 'skill.board-designer.md',
        when: '探针内每轮（或换例子时）先于 teaching-turn 调用；引擎尚未接线',
        input: 'task + 学生这句话 + 图型建议 + questionIntent + 上一块板（换板时）',
        output: 'figure JSON（完整板）；由代码派生提问态 / 剥注释 / 过图闸后才下发',
        code: 'backend/scripts/board-probe.ts（原型）；接线见 CLASSROOM_PIPELINE.md §1.6',
      },
      {
        file: 'skill.session-wrapup.md',
        when: '会话收尾 / 学生离开',
        input: '整段对话 + 学情痕迹',
        output: '本次课小结、掌握度、下次建议',
        code: 'services/ai-teaching/session-wrapup.ts',
      },
    ],
  },
];

/** 只在索引里出现、不展开全文的 skill */
const INDEX_ONLY = [
  ['skill.goal-conversation.md', '目标对话：把「我想学 X」谈成可执行目标与约束', '课前'],
  ['skill.material-brief.md', '给材料收集员的任务书', '课前'],
  ['skill.material-collector.md', '材料收集与清洗', '课前'],
  ['skill.lesson-knowledge-enricher.md', '单课知识点增强', '课前'],
  ['skill.concept-load-estimator.md', '认知负荷估算（决定一屏放多少）', '课前/课中'],
  ['skill.concept-consolidator.md', '概念巩固（课末收束）', '课末'],
  ['skill.peer-reinforcement.md', '同伴强化话术', '课中'],
  ['skill.adaptive-guidance-copy.md', '自适应引导文案', '课中'],
  ['skill.learning-predictor.md', '学情预测', '课后'],
  ['skill.learner-state-review.md', '学习者状态复核', '课后'],
  ['skill.learner-progress-report.md', '进度报告', '课后'],
  ['skill.replan-attribution.md', '重规划归因', '课后'],
  ['skill.semantic-freeze-judge.md', '语义冻结判定（验收口径）', '课后'],
  ['skill.virtual-learner-*.md（12 个）', '虚拟学习者：人格/场景/模拟/评审/仲裁——用于造课与验收，不进真实课堂', '离线'],
  ['skill.skill-author.md / skill.skill-compiler.md', '写 skill 的 skill（开发用）', '离线'],
];

const out = [];
out.push('# 课堂 Skill 合集（单文件）');
out.push('');
out.push('> 由 `outputs/e2e/skill-pack.mjs` 从 `prompts/` 原样拼出，**不要手改这一份**——改源文件再重跑。');
try {
  const sha = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  const branch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8' }).trim();
  out.push(`> 基线：\`${branch}\` @ \`${sha}\`｜生成时间 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
} catch {
  out.push(`> 生成时间 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
}
out.push('');
out.push('## 怎么读');
out.push('');
out.push('- **§一**是课前的编排链：决定「上什么课」；**§二**是课堂执行链：决定「这一刻说什么、画什么」。');
out.push('- 每个 skill 前面那张小卡写清**何时调用 / 输入 / 输出 / 代码入口**；卡片下面就是提示词全文，原样。');
out.push('- 只列索引不展开的，见 §三——它们不是课堂主链路（虚拟学习者那一组是造课/验收用的）。');
out.push('- 管线怎么串起来、字段怎么流、闸门在哪几道，见同目录的 `CLASSROOM_PIPELINE.md`。');
out.push('');

let n = 0;
for (const stage of STAGES) {
  out.push('---');
  out.push('');
  out.push(`## ${stage.title}`);
  out.push('');
  out.push(stage.note);
  out.push('');
  for (const item of stage.items) {
    n += 1;
    const { meta, body } = split(read(item.file));
    out.push(`### ${n}. \`${meta.name || item.file.replace(/^skill\.|\.md$/g, '')}\`${meta.title ? `· ${meta.title}` : ''}`);
    out.push('');
    out.push('| 项 | 内容 |');
    out.push('|---|---|');
    out.push(`| 何时调用 | ${item.when} |`);
    out.push(`| 输入 | ${item.input} |`);
    out.push(`| 输出 | ${item.output} |`);
    out.push(`| 源文件 | \`prompts/${item.file}\` |`);
    out.push(`| 代码入口 | \`${item.code}\` |`);
    out.push('');
    out.push('<details><summary>提示词全文</summary>');
    out.push('');
    out.push(demoteHeadings(body).trim());
    out.push('');
    out.push('</details>');
    out.push('');
  }
}

out.push('---');
out.push('');
out.push('## 三、只列索引（不进课堂主链路或篇幅过大）');
out.push('');
out.push('| 文件 | 作用 | 环节 |');
out.push('|---|---|---|');
for (const [f, what, when] of INDEX_ONLY) out.push(`| \`prompts/${f}\` | ${what} | ${when} |`);
out.push('');
out.push('## 四、这份合集里没有的');
out.push('');
out.push('- `prompts/AGENTS_SELF_INTRO.md`、`prompts/core/`、`prompts/orchestration/`、`prompts/skills.yaml`：');
out.push('  是编排与元数据（谁能调谁、版本号），不是给模型看的提示词。');
out.push('- 图型指南 `FIGURE_KIND_GUIDE`：写在后端代码 `services/ai-teaching/teaching-visual.service.ts` 里，');
out.push('  由 board-designer 在运行时拼到提示词末尾（因为要与 15 种图型的渲染契约同步）。');
out.push('');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const text = out.join('\n');
fs.writeFileSync(outPath, text, 'utf8');
console.log(`→ ${outPath}`);
console.log(`${Math.round(Buffer.byteLength(text) / 1024)}KB｜${text.split('\n').length} 行｜展开 ${n} 个 skill 全文`);
