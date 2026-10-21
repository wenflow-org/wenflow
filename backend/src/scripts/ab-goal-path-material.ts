/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性对照 CLI：输出面向人读，DB 行按 any 取字段 */
/**
 * goal → path 端到端 A/B（2026-10-17）。
 *
 * 目的：验证「资料包语义化 + 入库结构恢复」是否真的改变**路径产物**，而不只是资料包文本。
 *
 * 设计（同一 goal、两臂）：
 *   old = 历史资料形态（入库时的扁平正文、anchors 为空）+ 旧打包口径（头部 tldr + 锚点要点）
 *   new = 新链路（入库补 ATX 标题后重新解析出 anchors）+ 语义化打包（跨全文 tldr + 分层 48 点）
 *
 * 每臂用**独立用户**（路径生成会写用户画像/路径，共用用户会互相污染），资料内容两臂完全一致。
 * goal 输入固定为 rawGoal（goal 对话的最终交付物），只变资料包——因为被测对象是 path 侧。
 *
 * 指标：
 *   - 资料包：tldr/要点数、要点引文落在原文后半的比例（按块序号分位）
 *   - 路径：里程碑/任务数、总课时、materialRefs（阶段/任务）条数、
 *           引用落到原文后半的比例（quote/sectionTitle 反查块序号）
 *
 * 用法：
 *   npm --prefix backend run material:ab:goal-path -- --goals=1          # 先跑 1 个验通路
 *   npm --prefix backend run material:ab:goal-path -- --goals=20         # 全量
 *   npm --prefix backend run material:ab:goal-path -- --goals=20 --arms=new
 *   npm --prefix backend run material:ab:goal-path -- --goals=20 --arms=both \
 *     --fixtureManifest=../doc/measurement/119/manifest.json             # 按 sha256 定版夹具
 * 产物：doc/measurement/119/run-<ts>.json + run-<ts>.manifest.json（默认；--outDir 可改）
 *   run JSON 为行数组（既有分析脚本按行迭代）；commit/model/夹具 sha256 写在旁车 manifest。
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import prisma from '../config/database';
import pathCoordinator from '../coordinators/path.coordinator';
import { getLearningPath } from '../services/learning/queries/path-views.queries';
import { chunkMaterialMarkdown, type MaterialChunk } from '../services/materials/material-chunker';
import { parseDocument } from '../services/materials/document-parser';
import { resolveMaterialsRoot, writeMaterial, type MaterialRecord } from '../services/materials/material-store';
import { normalizeWebTextStructure } from '../services/materials/material-web-structure';

type Arm = 'old' | 'new';

/**
 * 路径侧开关的进程基线（模块加载时快照）。
 * old 臂会把它们置 0；new 臂必须回落到基线而不是「当前值」，否则连续跑 --arms=both
 * 时 old 的残留会让 new 臂也变成 old（#119 复核发现的 A/B 污染）。
 */
const BASELINE_STAGE_SWITCHES = {
  STAGE_MATERIAL_SEMANTIC_ORDER: process.env.STAGE_MATERIAL_SEMANTIC_ORDER ?? '1',
  STAGE_MATERIAL_QUOTA_RERANK: process.env.STAGE_MATERIAL_QUOTA_RERANK ?? '1',
  STAGE_MATERIAL_ZERO_REF_SUPPLEMENT: process.env.STAGE_MATERIAL_ZERO_REF_SUPPLEMENT ?? '1',
};

interface GoalSpec {
  id: string;
  rawGoal: string;
  /** 资料库里按标题子串挑同域长文（找不到时按序号轮换兜底）。 */
  materialHints: string[];
}

const GOALS: GoalSpec[] = [
  { id: 'safety-engineer', rawGoal: '我要备考中级注册安全工程师，半年内系统学完《安全生产管理》，能对上考试大纲的重点章节。', materialHints: ['注册安全工程师'] },
  { id: 'cpa-accounting', rawGoal: '我想在一年内通过注册会计师的专业阶段考试，先从会计和审计两科开始，需要按大纲把重点章节排出来。', materialHints: ['注册会计师'] },
  { id: 'high-school-history', rawGoal: '我是高中历史老师，想利用暑假把中外历史纲要（上）通读一遍，梳理出可以上课的单元脉络和关键概念。', materialHints: ['历史 必修'] },
  { id: 'german-a2', rawGoal: '我计划四个月后考 Goethe-Zertifikat A2，需要按主题掌握词汇并用德语做简单日常交流。', materialHints: ['Goethe-Zertifikat'] },
  { id: 'feline-nursing', rawGoal: '我是宠物医院的新手护士，想系统学习猫科动物的生命周期照护要点，用于日常门诊护理。', materialHints: ['Feline Life Stage', '执业兽医'] },
  { id: 'agile-pm', rawGoal: '公司要推敏捷转型，我需要系统学习敏捷实践指南，能主持迭代计划会和回顾会。', materialHints: ['敏捷实践指南'] },
  { id: 'systematic-review', rawGoal: '我要写一篇系统综述，想学会 Cochrane 手册里的检索、偏倚评估和证据合成方法。', materialHints: ['Cochrane'] },
  { id: 'fire-code', rawGoal: '我在做建筑消防设计，需要把建筑设计防火规范 GB 50016 的条文体系学清楚，能按建筑类别查要求。', materialHints: ['建筑设计防火规范'] },
  { id: 'civil-code', rawGoal: '我想系统学习民法典合同编，能判断常见合同的成立、效力和违约责任。', materialHints: ['民法典'] },
  { id: 'child-development', rawGoal: '我是幼儿园老师，想弄懂《3-6岁儿童学习与发展指南》对五大领域的发展要求，用来观察和评价班里孩子。', materialHints: ['3-6岁儿童', '3～6岁儿童'] },
  { id: 'mbsr', rawGoal: '我压力很大，想跟着正念减压八周课程系统练习，能独立完成身体扫描和坐姿冥想。', materialHints: ['正念减压'] },
  { id: 'c-language', rawGoal: '我零基础想学 C 语言，目标是能独立写出结构体加文件读写的小程序。', materialHints: ['C语言程序设计'] },
  { id: 'veteran-training', rawGoal: '我在做退役军人适应性培训的项目设计，需要参考现成的培训实施方案排出课程模块。', materialHints: ['退役军人'] },
  { id: 'first-class-builder', rawGoal: '我要备考一级建造师，需要按考试大纲把四门课的重点和学时分配理清楚。', materialHints: ['一级建造师'] },
  { id: 'mandarin-test', rawGoal: '我准备参加普通话水平测试，想通过朗读作品练习纠正发音，目标是二级甲等。', materialHints: ['普通话水平测试'] },
  { id: 'gaokao-math', rawGoal: '我明年参加新高考，数学基础一般，想先用一套真题摸清题型分布再安排复习。', materialHints: ['新高考II卷', '新高考'] },
  { id: 'cet', rawGoal: '我大三，想在下一次四级考试前系统准备，按考试大纲把听力和阅读的重点练起来。', materialHints: ['四、六级考试大纲', '四六级'] },
  { id: 'diabetes-guide', rawGoal: '我是基层全科医生，想学习中国糖尿病防治指南，能按指南给患者做初诊评估和随访计划。', materialHints: ['糖尿病'] },
  { id: 'reading-method', rawGoal: '我想学会更高效的读书方法，能对一本专业书做检视阅读和分析阅读，并输出读书笔记。', materialHints: ['如何阅读一本书'] },
  { id: 'tax-agent', rawGoal: '我在备考税务师，想按考试大纲系统学习税法，能独立完成企业所得税汇算清缴的常见调整。', materialHints: ['税务师'] },
];

interface DocSource {
  name: string;
  markdown: string;
  record: MaterialRecord;
  chunks: MaterialChunk[];
  /** 夹具指纹（markdown 的 sha256）：run 记录里带上，复算时可按内容定版（#119）。 */
  sha256: string;
}

interface ArmResult {
  arm: Arm;
  userId: string;
  pathId: string | null;
  ms: number;
  milestones: number;
  tasks: number;
  estimatedHours: number;
  stageRefs: number;
  taskRefs: number;
  refsTotal: number;
  refsLate: number;
  pack: { files: number; tldrChars: number; points: number; pointsLate: number; packChars: number };
  /** 生成所用模型（AI_MODEL / AI_MODEL_REASONING），复算时据此判断读数对应哪版模型。 */
  model?: { ai: string; reasoning: string };
  /** 本臂实际使用的开关组合（old 臂全关），复算/复核时对照用。 */
  switches?: Record<string, string>;
  error: string | null;
}

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = hit ? Number(hit.split('=')[1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}
function argText(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function flat(text: string): string {
  return String(text || '').replace(/\s+/g, '');
}

function safePathWithin(root: string, ...parts: string[]): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (target === base) return null;
  return target.startsWith(base + path.sep) ? target : null;
}

/** 载入资料库里 >10k 的联网长文（只读）。 */
function loadLibraryDocs(): DocSource[] {
  const root = path.resolve(resolveMaterialsRoot());
  const out: DocSource[] = [];
  if (!fs.existsSync(root)) return out;
  for (const user of fs.readdirSync(root)) {
    const dir = safePathWithin(root, user);
    if (!dir || !fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json') || file.endsWith('.vectors.json')) continue;
      const jsonPath = safePathWithin(root, user, file);
      const mdPath = safePathWithin(root, user, file.replace(/\.json$/, '.md'));
      if (!jsonPath || !mdPath) continue;
      try {
        const record = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as MaterialRecord;
        if (record.origin !== 'web' || (Number(record.charCount) || 0) < 10_000) continue;
        const markdown = fs.readFileSync(mdPath, 'utf8');
        if (markdown.length < 10_000) continue;
        out.push({
          name: String(record.name || ''),
          markdown,
          record,
          chunks: chunkMaterialMarkdown(markdown),
          sha256: crypto.createHash('sha256').update(markdown, 'utf8').digest('hex'),
        });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/** 引用落在原文哪个分位：0..1；找不到返回 null。 */
function positionOfQuote(doc: DocSource, quote: string): number | null {
  const needle = flat(quote).slice(0, 24);
  if (needle.length < 8) return null;
  for (const chunk of doc.chunks) {
    if (flat(chunk.text).includes(needle)) {
      return doc.chunks.length > 1 ? chunk.index / (doc.chunks.length - 1) : 0;
    }
  }
  return null;
}

function positionOfTitle(doc: DocSource, title: string): number | null {
  const needle = flat(title).slice(0, 12);
  if (needle.length < 4) return null;
  for (const chunk of doc.chunks) {
    if (flat(chunk.title).includes(needle)) {
      return doc.chunks.length > 1 ? chunk.index / (doc.chunks.length - 1) : 0;
    }
  }
  return null;
}

async function createUser(label: string): Promise<string> {
  const id = `ab_${label}_${crypto.randomUUID().slice(0, 8)}`;
  await prisma.users.create({
    data: {
      id,
      email: `${id}@ab.local`,
      name: label,
      password: crypto.randomUUID(),
      updatedAt: new Date(),
      onboardingCompleted: true,
    },
  });
  return id;
}

/** 把资料以「上传附件」形态写进测试用户库；new 臂先补结构再解析（模拟新入库）。 */
async function attachMaterials(userId: string, docs: DocSource[], arm: Arm): Promise<void> {
  for (const doc of docs) {
    let markdown = doc.markdown;
    let anchors = doc.record.anchors || [];
    let structure = doc.record.structure;
    if (arm === 'new') {
      const normalized = normalizeWebTextStructure(markdown);
      const parsed = await parseDocument(Buffer.from(normalized.markdown, 'utf-8'), 'web-source.md');
      markdown = normalized.markdown;
      if (parsed.status === 'ok') {
        anchors = parsed.anchors;
        structure = parsed.structure;
      }
    }
    const record: MaterialRecord = {
      id: crypto.randomUUID(),
      userId,
      name: doc.name,
      ext: '.md',
      format: 'text',
      size: Buffer.byteLength(markdown, 'utf-8'),
      charCount: markdown.length,
      structure,
      anchors,
      warnings: [],
      createdAt: new Date().toISOString(),
    };
    writeMaterial(record, markdown);
  }
}

function collectRefs(detail: any): Array<{ quote: string; title: string }> {
  const refs: Array<{ quote: string; title: string }> = [];
  const milestones = Array.isArray(detail?.milestones) ? detail.milestones : [];
  for (const milestone of milestones) {
    for (const ref of Array.isArray(milestone.materialRefs) ? milestone.materialRefs : []) {
      refs.push({ quote: String(ref?.quote || ''), title: String(ref?.sectionTitle || '') });
    }
    for (const task of Array.isArray(milestone.subtasks) ? milestone.subtasks : []) {
      for (const ref of Array.isArray(task.materialRefs) ? task.materialRefs : []) {
        refs.push({ quote: String(ref?.quote || ''), title: String(ref?.sectionTitle || '') });
      }
    }
  }
  return refs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 路径生成是异步流水：`generateFromGoal` 返回时 stage-enrichment 可能还没落子任务，必须等终态。 */
async function waitPathSettled(pathId: string, timeoutMs = 300_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: { status: true },
    });
    if (row && row.status !== 'generating') {
      const tasks = await prisma.subtasks.count({
        where: { milestoneId: { in: (await prisma.milestones.findMany({ where: { learningPathId: pathId }, select: { id: true } })).map((m) => m.id) } },
      });
      if (tasks > 0 || row.status === 'failed') return;
    }
    await sleep(3000);
  }
}

async function newestPathId(userId: string): Promise<string | null> {
  const row = await prisma.learning_paths.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return row?.id || null;
}

async function generateWithRetry(goal: GoalSpec, userId: string, attempts = 2): Promise<any> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await pathCoordinator.generateFromGoal({ userId, rawGoal: goal.rawGoal, source: 'goal' });
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await sleep(5000 * (i + 1));
    }
  }
  throw lastError;
}

async function runArm(goal: GoalSpec, docs: DocSource[], arm: Arm): Promise<ArmResult> {
  const startedAt = Date.now();
  const userId = await createUser(`${goal.id}-${arm}`);
  await attachMaterials(userId, docs, arm);
  process.env.MATERIAL_PACK_SEMANTIC_DISABLED = arm === 'old' ? '1' : '0';
  // 真 A/B 的 old 臂（#119）：历史形态 = 语义排序关、配额重排关、零引用补课关。
  // 2026-10-19 之前的 old 臂只关 MATERIAL_PACK_SEMANTIC_DISABLED，路径侧优化仍然生效，
  // 于是「old」其实是 10-17 的 new 臂改名（merged-1792388275960.json 的 arms.old.arm='new'）。
  const armSwitches: Record<string, string> = {
    MATERIAL_PACK_SEMANTIC_DISABLED: process.env.MATERIAL_PACK_SEMANTIC_DISABLED,
    STAGE_MATERIAL_SEMANTIC_ORDER: arm === 'old' ? '0' : BASELINE_STAGE_SWITCHES.STAGE_MATERIAL_SEMANTIC_ORDER,
    STAGE_MATERIAL_QUOTA_RERANK: arm === 'old' ? '0' : BASELINE_STAGE_SWITCHES.STAGE_MATERIAL_QUOTA_RERANK,
    STAGE_MATERIAL_ZERO_REF_SUPPLEMENT: arm === 'old' ? '0' : BASELINE_STAGE_SWITCHES.STAGE_MATERIAL_ZERO_REF_SUPPLEMENT,
  };
  process.env.STAGE_MATERIAL_SEMANTIC_ORDER = armSwitches.STAGE_MATERIAL_SEMANTIC_ORDER;
  process.env.STAGE_MATERIAL_QUOTA_RERANK = armSwitches.STAGE_MATERIAL_QUOTA_RERANK;
  process.env.STAGE_MATERIAL_ZERO_REF_SUPPLEMENT = armSwitches.STAGE_MATERIAL_ZERO_REF_SUPPLEMENT;

  const result: ArmResult = {
    arm,
    userId,
    pathId: null,
    ms: 0,
    milestones: 0,
    tasks: 0,
    estimatedHours: 0,
    stageRefs: 0,
    taskRefs: 0,
    refsTotal: 0,
    refsLate: 0,
    pack: { files: docs.length, tldrChars: 0, points: 0, pointsLate: 0, packChars: 0 },
    model: { ai: process.env.AI_MODEL || '', reasoning: process.env.AI_MODEL_REASONING || '' },
    switches: armSwitches,
    error: null,
  };

  try {
    // 先记资料包口径（确定性，不受路径模型波动影响）
    const { buildUploadedMaterialPacks, buildUploadedMaterialPacksAsync } = await import(
      '../services/materials/material-pack.builder'
    );
    const packs =
      arm === 'old' ? buildUploadedMaterialPacks(userId) : await buildUploadedMaterialPacksAsync(userId);
    let pointsLate = 0;
    let points = 0;
    let packChars = 0;
    for (const packResult of packs) {
      const pack = packResult.pack;
      if (!pack) continue;
      result.pack.tldrChars += pack.tldr.length;
      packChars += pack.tldr.length;
      for (const point of pack.keyPoints) {
        points += 1;
        packChars += point.text.length;
        const doc = docs.find((d) => flat(point.cite).length > 0 && positionOfQuote(d, point.cite) !== null);
        const pos = doc ? positionOfQuote(doc, point.cite) : null;
        if (pos !== null && pos >= 0.5) pointsLate += 1;
      }
    }
    result.pack.points = points;
    result.pack.pointsLate = pointsLate;
    result.pack.packChars = packChars;

    const generated: any = await generateWithRetry(goal, userId);
    const pathId = String((await newestPathId(userId)) || generated?.id || generated?.path?.id || '');
    result.pathId = pathId || null;
    if (pathId) await waitPathSettled(pathId);
    const detail = pathId ? await getLearningPath(pathId) : null;
    const milestones = Array.isArray((detail as any)?.milestones) ? (detail as any).milestones : [];
    result.milestones = milestones.length;
    result.tasks = milestones.reduce(
      (acc: number, m: any) => acc + (Array.isArray(m.subtasks) ? m.subtasks.length : 0),
      0
    );
    result.estimatedHours = Number((detail as any)?.estimatedHours || 0);
    const refs = collectRefs(detail);
    result.refsTotal = refs.length;
    result.stageRefs = milestones.filter((m: any) => Array.isArray(m.materialRefs) && m.materialRefs.length).length;
    result.taskRefs = milestones
      .flatMap((m: any) => (Array.isArray(m.subtasks) ? m.subtasks : []))
      .filter((t: any) => Array.isArray(t.materialRefs) && t.materialRefs.length).length;
    for (const ref of refs) {
      let pos: number | null = null;
      for (const doc of docs) {
        pos = positionOfQuote(doc, ref.quote);
        if (pos === null) pos = positionOfTitle(doc, ref.title);
        if (pos !== null) break;
      }
      if (pos !== null && pos >= 0.5) result.refsLate += 1;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    delete process.env.MATERIAL_PACK_SEMANTIC_DISABLED;
    process.env.STAGE_MATERIAL_SEMANTIC_ORDER = BASELINE_STAGE_SWITCHES.STAGE_MATERIAL_SEMANTIC_ORDER;
    process.env.STAGE_MATERIAL_QUOTA_RERANK = BASELINE_STAGE_SWITCHES.STAGE_MATERIAL_QUOTA_RERANK;
    process.env.STAGE_MATERIAL_ZERO_REF_SUPPLEMENT = BASELINE_STAGE_SWITCHES.STAGE_MATERIAL_ZERO_REF_SUPPLEMENT;
  }

  result.ms = Date.now() - startedAt;
  return result;
}

/**
 * 读夹具定版清单（#119）。支持本脚本产出的 `run-<ts>.manifest.json`
 * （`{ fixtures: [{ goal, name, sha256 }] }`）；返回 name → sha256。
 */
function loadFixtureManifest(file: string | null): Map<string, string> | null {
  if (!file) return null;
  const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const list = Array.isArray(json?.fixtures) ? json.fixtures : [];
  const map = new Map<string, string>();
  for (const entry of list) {
    const name = String(entry?.name || '');
    const sha256 = String(entry?.sha256 || '');
    if (name && /^[0-9a-f]{64}$/.test(sha256)) map.set(name, sha256);
  }
  if (map.size === 0) throw new Error(`夹具清单里没有可用的 fixtures[].sha256：${file}`);
  return map;
}

/** 当前提交（定版用）；不在 git 工作区时返回 null，不阻断跑批。 */
function readCommitSha(): string | null {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf-8',
  });
  return result.status === 0 ? String(result.stdout || '').trim() || null : null;
}

async function main(): Promise<void> {
  const start = Math.max(0, arg('start', 1) - 1);
  const goalCount = Math.max(1, Math.min(arg('count', arg('goals', 20)), GOALS.length - start));
  const armsArg = argText('arms') || 'both';
  const arms: Arm[] = armsArg === 'old' ? ['old'] : armsArg === 'new' ? ['new'] : ['old', 'new'];
  const library = loadLibraryDocs();
  // 夹具定版（#119）：--fixtureManifest=<run-XXXX.manifest.json> 时按 sha256 选材料，
  // 不按标题子串猜；缺失/指纹不符直接失败，避免「同一份资料今天一个版本、明天另一个版本」。
  const fixtureManifest = loadFixtureManifest(argText('fixtureManifest'));
  // --dryRun：只做夹具选择与指纹核对，不生成路径（不耗模型额度，用于复核夹具定版是否可用）
  const dryRun = process.argv.includes('--dryRun');
  console.log(
    `[ab-goal-path] 库内长文 ${library.length} 份｜goal ${goalCount} 个｜arms ${arms.join(',')}` +
      (fixtureManifest ? `｜夹具定版 ${fixtureManifest.size} 份` : '') +
      (dryRun ? '｜DRY RUN（不生成）' : '')
  );

  const output: any[] = [];
  for (let i = start; i < start + goalCount; i += 1) {
    const goal = GOALS[i];
    const picked: DocSource[] = [];
    for (const hint of goal.materialHints) {
      const candidates = library.filter((d) => d.name.includes(hint) && !picked.includes(d));
      // 有夹具清单时只在清单内选，并核对 sha256
      const doc = fixtureManifest
        ? candidates.find((d) => fixtureManifest.get(d.name) === d.sha256)
        : candidates[0];
      if (doc) picked.push(doc);
      else if (fixtureManifest && candidates.length > 0) {
        throw new Error(`夹具指纹不符：${goal.id} 的候选资料 ${candidates.map((d) => d.name).join(' / ')} 与 manifest sha256 不一致`);
      }
    }
    if (picked.length === 0) {
      // fail-fast（#119）：旧实现 library[i % length] 兜底会把无关资料塞进 goal，读数不可解释
      throw new Error(`没有匹配到资料：goal=${goal.id}｜hints=${goal.materialHints.join(',')}｜库内 ${library.length} 份`);
    }
    console.log(`\n[ab-goal-path] (${i + 1}/${goalCount}) ${goal.id}｜资料 ${picked.map((d) => d.name).join(' / ')}`);
    if (dryRun) {
      for (const doc of picked) console.log(`  fixture ${doc.sha256}  ${doc.name}`);
      continue;
    }
    const row: any = {
      goal: goal.id,
      rawGoal: goal.rawGoal,
      materials: picked.map((d) => d.name),
      fixtures: picked.map((d) => ({ name: d.name, sha256: d.sha256 })),
      arms: {},
    };
    for (const arm of arms) {
      const result = await runArm(goal, picked, arm);
      row.arms[arm] = result;
      console.log(
        `  ${arm.padEnd(3)} 路径 ${result.pathId || '-'}｜里程碑 ${result.milestones} 任务 ${result.tasks} ` +
          `课时 ${result.estimatedHours.toFixed(1)}h｜refs ${result.refsTotal}（后半 ${result.refsLate}）` +
          `｜包 要点 ${result.pack.points}（后半 ${result.pack.pointsLate}）｜${(result.ms / 1000).toFixed(0)}s` +
          (result.error ? `｜ERROR ${result.error}` : '')
      );
    }
    output.push(row);
  }

  if (dryRun) {
    console.log(`\n[ab-goal-path] DRY RUN 结束：${goalCount} 个 goal 的夹具全部命中且指纹一致，未生成路径、未写文件`);
    return;
  }

  const outDirArg = argText('outDir');
  const dir = outDirArg ? path.resolve(outDirArg) : path.resolve(__dirname, '../../../doc/measurement/119');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const file = path.join(dir, `run-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(output, null, 2), 'utf-8');
  // 旁车清单（#119）：run JSON 保持数组形态（既有分析脚本按行迭代），
  // 定版信息（commit/model/夹具 sha256/开关）写同名 .manifest.json。
  const manifestPath = path.join(dir, `run-${stamp}.manifest.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        runFile: path.basename(file),
        generatedAt: new Date(stamp).toISOString(),
        commitSha: readCommitSha(),
        model: { ai: process.env.AI_MODEL || '', reasoning: process.env.AI_MODEL_REASONING || '' },
        arms,
        goals: goalCount,
        fixtureManifest: argText('fixtureManifest'),
        fixtures: output.flatMap((row) =>
          (row.fixtures || []).map((fixture: { name: string; sha256: string }) => ({
            goal: row.goal,
            name: fixture.name,
            sha256: fixture.sha256,
          }))
        ),
      },
      null,
      2
    ),
    'utf-8'
  );
  console.log(`\n[ab-goal-path] 原始结果 → ${file}`);
  console.log(`[ab-goal-path] 定版清单 → ${manifestPath}`);

  // 汇总
  const rows = output.filter((r) => r.arms.old && r.arms.new);
  if (rows.length > 0) {
    const sum = (key: string, arm: Arm) => rows.reduce((acc, r) => acc + Number(r.arms[arm][key] || 0), 0);
    const refsTotal = sum('refsTotal', 'old') + sum('refsTotal', 'new');
    const refsLateOld = sum('refsLate', 'old');
    const refsLateNew = sum('refsLate', 'new');
    console.log('\n=== goal→path 对照汇总 ===');
    console.log(`路径生成成功 ${rows.length}/${output.length}`);
    console.log(`任务数 old ${sum('tasks', 'old')} / new ${sum('tasks', 'new')}`);
    console.log(`课时 old ${sum('estimatedHours', 'old').toFixed(1)}h / new ${sum('estimatedHours', 'new').toFixed(1)}h`);
    console.log(`materialRefs old ${sum('refsTotal', 'old')} / new ${sum('refsTotal', 'new')}`);
    console.log(
      `引用落在前半之外（后半）old ${refsLateOld}/${sum('refsTotal', 'old')} / new ${refsLateNew}/${sum('refsTotal', 'new')}`
    );
    const improved = rows.filter((r) => Number(r.arms.new.refsLate) > Number(r.arms.old.refsLate)).length;
    const worsened = rows.filter((r) => Number(r.arms.new.refsLate) < Number(r.arms.old.refsLate)).length;
    console.log(`后半引用：new 更多 ${improved} 个 goal｜更少 ${worsened} 个｜相同 ${rows.length - improved - worsened} 个`);
    void refsTotal;
  }
}

main()
  .catch((error) => {
    console.error('[ab-goal-path] 失败', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
