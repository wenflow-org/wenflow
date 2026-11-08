/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性只读度量 */
/**
 * 路径「死板度」度量（只读）：给一个 learningPathId，输出体量与形态指标，并可选与 baseline 对比。
 *
 * 用法：npx ts-node --transpile-only src/scripts/measure-path-deslop.ts <pathId> [baselinePathId]
 *
 * 指标口径（刻意用确定性词表，便于 before/after 同尺度比较）：
 *  - stages / lessons / hours          体量
 *  - 黑话标题占比                     标题命中方法论骨架词（骨架/挂回/挂到/口径/边界/分类图/时间轴/复述/讲述稿/挂上/归位）的比例
 *  - 含具体标的的标题数               标题含英文专名、书名号、（数字+年/版）或已知产品词
 *  - 写稿/复述类收口数                阶段最后一节课命中（讲述稿/复述/不看资料/合上材料）
 *  - 首阶段首课是否落在近期案例       命中（近期/最新/今年/这两年/现在/案例/新闻/争议）
 *  - 阶段标题互相雷同度              相邻阶段标题的 bigram 相似度均值（跨阶段同模的代理指标）
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const JARGON = ['骨架', '挂回', '挂到', '挂上', '口径', '边界', '分类图', '时间轴', '复述', '讲述稿', '归位', '回挂'];
const CONCRETE = /[A-Za-z]{3,}|《[^》]+》|\d{4}\s*年|ChatGPT|Khanmigo|Duolingo|可汗/;
const RECENT = /近期|最新|今年|这两年|现在|当下|本周|案例|新闻|争议|翻车/;
const RECALL = /讲述稿|复述|不看资料|合上材料|背诵/;
const MOLD = /拆|划|挂|写|复述|口径|图/;

function bigrams(text: string): Set<string> {
  const s = String(text || '').replace(/[\s，。、：；（）()『』「」]/g, '');
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
  return set;
}

function similarity(a: string, b: string): number {
  const A = bigrams(a); const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

async function measure(pathId: string) {
  const path = await p.learning_paths.findUnique({ where: { id: pathId }, select: { id: true, title: true, estimatedHours: true } });
  if (!path) throw new Error(`path not found: ${pathId}`);
  const milestones = await p.milestones.findMany({ where: { learningPathId: pathId }, orderBy: { stageNumber: 'asc' }, select: { id: true, stageNumber: true, title: true, goal: true, estimatedHours: true } });
  const subtasks = await p.subtasks.findMany({ where: { milestoneId: { in: milestones.map((m) => m.id) } }, orderBy: [{ milestoneId: 'asc' }, { order: 'asc' }], select: { milestoneId: true, title: true, order: true, estimatedMinutes: true } });
  const byStage = new Map<string, typeof subtasks>();
  for (const s of subtasks) {
    const list = byStage.get(s.milestoneId) ?? [];
    list.push(s);
    byStage.set(s.milestoneId, list);
  }

  const mTitles = milestones.map((m) => m.title);
  const stTitles = subtasks.map((s) => s.title);
  const allTitles = [...mTitles, ...stTitles];
  const jargon = allTitles.filter((t) => JARGON.some((w) => t.includes(w)));
  const concrete = allTitles.filter((t) => CONCRETE.test(t));
  const mold = allTitles.filter((t) => MOLD.test(t));

  const closers: string[] = [];
  for (const m of milestones) {
    const list = byStage.get(m.id) ?? [];
    const last = list[list.length - 1];
    if (last) closers.push(last.title);
  }
  const recallClosers = closers.filter((t) => RECALL.test(t));

  const firstStageTasks = byStage.get(milestones[0]?.id ?? '') ?? [];
  const firstTask = firstStageTasks[0]?.title ?? '';

  const sims: number[] = [];
  for (let i = 1; i < mTitles.length; i += 1) sims.push(similarity(mTitles[i - 1], mTitles[i]));

  const totalMinutes = subtasks.reduce((sum, s) => sum + (s.estimatedMinutes ?? 0), 0);

  return {
    pathId: path.id,
    title: path.title,
    stages: milestones.length,
    lessons: subtasks.length,
    hours: path.estimatedHours,
    totalMinutes,
    minutesPerLesson: subtasks.length ? Math.round(totalMinutes / subtasks.length) : 0,
    jargonTitles: jargon.length,
    jargonRatio: allTitles.length ? +(jargon.length / allTitles.length).toFixed(3) : 0,
    concreteTitles: concrete.length,
    concreteRatio: allTitles.length ? +(concrete.length / allTitles.length).toFixed(3) : 0,
    moldTitles: mold.length,
    recallClosers: recallClosers.length,
    firstStageFirstTask: firstTask,
    firstTaskIsRecent: RECENT.test(firstTask),
    stageTitleSimilarity: sims.length ? +(sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(3) : 0,
    stageTitles: mTitles,
    stageTaskTitles: milestones.map((m) => ({ stage: m.stageNumber, title: m.title, tasks: (byStage.get(m.id) ?? []).map((t) => t.title) })),
  };
}

async function main() {
  const [target, baseline] = process.argv.slice(2);
  if (!target) {
    console.error('用法: npx ts-node --transpile-only src/scripts/measure-path-deslop.ts <pathId> [baselinePathId]');
    process.exitCode = 1;
    return;
  }
  const now = await measure(target);
  console.log('=== 目标路径 ===');
  console.log(JSON.stringify({ ...now, stageTaskTitles: undefined }, null, 1));
  for (const s of now.stageTaskTitles) {
    console.log(`\n[阶段 ${s.stage}] ${s.title}`);
    s.tasks.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  }
  if (baseline) {
    const base = await measure(baseline);
    console.log('\n=== before / after 对照 ===');
    const keys: Array<keyof typeof now> = ['stages', 'lessons', 'hours', 'minutesPerLesson', 'jargonRatio', 'concreteRatio', 'recallClosers', 'stageTitleSimilarity', 'firstTaskIsRecent'];
    for (const k of keys) console.log(`  ${String(k).padEnd(22)} before=${String(base[k])}  after=${String(now[k])}`);
  }
  await p.$disconnect();
}

main().catch(async (error) => { console.error('ERR', error.message); await p.$disconnect(); process.exitCode = 1; });
