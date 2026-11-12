/**
 * 阶段任务质量判据（确定性）：识别「伪课」——把一次坐下来能做完的收尾动作，拆成没有新知识点的独立课时。
 *
 * 背景（2026-11-02 真实路径实测，lp_1793609520322_a52ld7g 外部评审）：
 * 20 节课里有 5 整节（205 分钟）不是在学语法或做题，而是"整理卡片 / 合并清单 / 错题归因 / 写自检卡"：
 *   阶段1第2节 整理两列对照卡 · 阶段3第5节 错题归因并整理成判别卡 · 阶段4第2/3/5节 归因+合并+写卡。
 * 做 10 道选择题外加错题复盘，在真实学习里是 25 分钟一气呵成的单次动作，这里被拆成横跨 3.5 小时的 5 节独立课。
 * 更贵的是下游代价：每节点进去都会启动带 checkpoint 的课堂引擎，而这类课没有新知识点可讲——
 * 导师只能车轱辘话追问、反复弹小测卡。
 *
 * 与既有规则的关系：提示词里已有「禁止空壳准备课」「阶段尾部收口任务一个阶段最多 1 节」「targetSubtasksForStage
 * 是上限、可少给但要举证」。本模块把那两条做成**确定性判据**，接进 stage-designer 的软校验（命中带反馈重试一次）。
 *
 * 判据刻意保守（宁可漏判不误判）：只在标题里**同时**出现「收尾动作动词」与「卡片/清单/表格类制品名词」，
 * 且整条任务里没有任何练习或材料对象时才判违规；「用两步卡拆解现在完成时…」这类把卡当工具的课不受影响。
 *
 * 判定不锚定句首（2026-11-02 实测：真实标题多为「把两个阶段的错题合并成一张判别卡」这种把字句，
 * 句首动词锚会整条漏掉），改为双条件共现。
 */

import { titleSimilarity } from './stage-filler';
import { titlesTooClose } from './stage-task-supplement';

/** 收尾动作动词（整理/合并/归因/写/做/产出…） */
const META_VERB_RE = /(整理|合并|汇总|归类|归因|复盘|回顾|罗列|输出|产出|制作|打包|写|做|列)/;

/**
 * 产物是「卡片/清单/表格」类制品，而不是真实学习对象。
 * 单个「卡」也算（2026-11-02 实测漏网：M1「把两步判别整理成一张时态判别卡」「按错题归因修订
 * 判别卡并定稿」、M4「产出《下次做题自检卡》」都没被旧词表命中）——因为前提是 META_VERB 共现且
 * 全文无练习对象，「用两步卡做 10 道题」这类把卡当工具的任务有 PRACTICE_OBJECT 兜住。
 */
const META_ARTIFACT_RE = /(卡|清单|表格|表单|对照表|自检表|判别表|归因表|汇总表|检查表|看板|索引|台账)/;

/** 任务里有真实的练习/材料对象（有则不算伪课——元动作只是伴随环节） */
const PRACTICE_OBJECT_RE =
  /(限时|模拟|真题|练习题|刷题|\d+\s*(?:道|句|条|行|个|篇|组|套)[^，。；]{0,10}(?:题|句子|语句|数据|样本|案例|例子|对话|短文|文章|选择|填空|练习|模考)|逐题|逐句|手算|推导|计算|写代码|调试|朗读|开口说)/;

export interface SubtaskQualityInput {
  title?: string;
  description?: string;
  acceptanceHint?: string;
}

/** 跨阶段标题去重的阶段形状（只读 title，其余字段原样保留） */
export interface CrossStageDedupStage<T> {
  stageNumber: number;
  subtasks: T[];
}

export interface CrossStageDroppedTask {
  stageNumber: number;
  title: string;
  duplicateOfStage: number;
  duplicateOf: string;
  similarity: number;
}

export interface CrossStageDedupOptions {
  /** 相似度阈值（titlesTooClose：≥阈值或「≥6 字公共前缀/互为包含」即判重）。默认 0.72 */
  threshold?: number;
  /** 单阶段最多删除的比例，保底留 1 条（防误删导致整阶段清空）。默认 0.5 */
  maxDropRatio?: number;
}

/**
 * 跨阶段标题去重（确定性）：后一阶段若出现与前序阶段**近似同题**的任务，直接删除。
 *
 * 背景（2026-11-02 实测 lp_1793609520322_a52ld7g）：阶段 1 教非谓语动词，阶段 3 又重新排一遍
 * 「回放被岔开的对话」；detectCrossStageFiller 早就能算出这类 pair（相似度 0.74），但它按设计
 * **只观测不阻断**，缺的是主生成路径上的执行动作。新口径下 targetSubtasksForStage 是上限而非下限，
 * 删掉复读课天然收敛到「内容有多少上多少」，与本轮预算收紧同向。
 *
 * 边界（宁可漏删不误删）：① 只比**前序阶段**，同阶段交给 detectStageFiller；② 单阶段最多删一半且保底留 1 条；
 * ③ 空标题不参与判定。返回按 stageNumber 升序推进、但输出保持入参顺序（下游自带排序/按 id 取用）。
 */
export function dropCrossStageDuplicates<T extends { title?: string }>(
  stages: Array<CrossStageDedupStage<T>>,
  options: CrossStageDedupOptions = {},
): { stages: Array<CrossStageDedupStage<T>>; dropped: CrossStageDroppedTask[] } {
  const threshold = options.threshold ?? 0.72;
  const maxDropRatio = options.maxDropRatio ?? 0.5;
  const result = stages.map((stage) => ({
    ...stage,
    subtasks: Array.isArray(stage.subtasks) ? [...stage.subtasks] : [],
  }));
  const byNumber = new Map(result.map((stage) => [stage.stageNumber, stage]));
  const priorTitles: Array<{ title: string; stageNumber: number }> = [];
  const dropped: CrossStageDroppedTask[] = [];

  for (const stage of [...result].sort((a, b) => a.stageNumber - b.stageNumber)) {
    const tasks = stage.subtasks;
    const maxDrop = Math.max(0, Math.floor(tasks.length * maxDropRatio));
    let dropCount = 0;
    const kept: T[] = [];
    for (const task of tasks) {
      const title = String(task?.title || '').trim();
      const duplicate = title && dropCount < maxDrop
        ? priorTitles.find((prior) => titlesTooClose(prior.title, title, threshold))
        : undefined;
      if (duplicate) {
        dropCount += 1;
        dropped.push({
          stageNumber: stage.stageNumber,
          title,
          duplicateOfStage: duplicate.stageNumber,
          duplicateOf: duplicate.title,
          similarity: +titleSimilarity(duplicate.title, title).toFixed(2),
        });
        continue;
      }
      kept.push(task);
    }
    const target = byNumber.get(stage.stageNumber);
    if (target) target.subtasks = kept;
    for (const task of kept) {
      const title = String(task?.title || '').trim();
      if (title) priorTitles.push({ title, stageNumber: stage.stageNumber });
    }
  }

  return { stages: result, dropped };
}

export interface StageMetaLessonResult {
  valid: boolean;
  failureReason?: string;
  violations?: string[];
}

/** 单个任务是否「只有收尾动作、没有新知识点/练习对象」 */
export function isMetaOnlySubtask(task: SubtaskQualityInput): boolean {
  const title = String(task?.title || '').trim();
  if (!title) return false;
  if (!META_VERB_RE.test(title) || !META_ARTIFACT_RE.test(title)) return false;
  const body = [task?.title, task?.description, task?.acceptanceHint].filter(Boolean).join(' ');
  return !PRACTICE_OBJECT_RE.test(body);
}

/**
 * 阶段级判定（stage-designer 软校验用）：伪课数 ≥2 才触发纠错重试。
 *
 * 为什么是 ≥2 而不是 ≥1：阶段尾部保留 1 节「收口」是既有规则允许的（收拢成果、错因回收），
 * 单节不判；真正的问题是**成片出现**（本次实测阶段 4 里 5 节中 3 节）。
 */
export function assessStageMetaLessons(subtasks: SubtaskQualityInput[]): StageMetaLessonResult {
  const hits = (Array.isArray(subtasks) ? subtasks : [])
    .map((task, index) => (isMetaOnlySubtask(task) ? `任务 ${index + 1}「${String(task?.title || '').trim()}」` : null))
    .filter((item): item is string => !!item);
  if (hits.length < 2) return { valid: true };
  return {
    valid: false,
    failureReason: `META_ONLY_LESSONS_STAGE: 本阶段有 ${hits.length} 个任务只有整理/合并/归因/写卡这类收尾动作，没有新知识点或练习对象`,
    violations: hits,
  };
}

/** 题面/答案/来源/定位模板的确定性拦截（2026-11-12，AI Agent 真机实证）。 */
export interface StageNarrationInput {
  title?: string;
  description?: string;
  acceptanceHint?: string;
  materialRefs?: unknown[];
}

export interface StageNarrationResult {
  valid: boolean;
  failureReason?: string;
  violations?: string[];
}

const ANSWER_HINT_RE = /(注意[^。；\n]{0,60}(轮|第)[^。；\n]{0,60}(却|但|而是|不是)|(来自|出自)\s*轮\s*\d|而不是\s*轮\s*\d)/;
const UNSOURCED_REAL_RE = /(真实对话|真实记录|真实形态|公开复盘|真实案例|真实问答)/;
const LOCATOR_INSTRUCTION_RE = /(先?找出[^。；\n]{0,40}(第几轮|哪一轮|哪一步)|最早[^。；\n]{0,20}(出现|消失)[^。；\n]{0,20}(第几轮|哪一轮)|埋在哪一轮)/;
/** 标题谜底（2026-11-12 外评）：标题写成本课结论的陈述句，学习者扫目录即看破机制——
 * 高精度结论词形，宁漏勿杀（标题规则的其余部分靠提示词）。 */
const TITLE_SPOILER_RE = /(只会|其实就?是|说白了|动手的是|靠的是|，[^：？?]{0,10}(才|就)看得到|不靠记忆|全靠.{2,8}喂)/;
/** 同例复读（2026-11-12 外评）：后面的课指名复用前面任务的主教材（「回到任务 1 那段记录」）——
 * stage-designer 规则明文「同一个例子只允许作为主教材出现一课，后续以新例子迁移」。 */
const SAME_CASE_REUSE_RE = /(回到任务\s*\d|回到第\s*\d+\s*课|上一?个?任务的那段|前一?课的那段|上一课那段)/;

/**
 * 只查“把答案写在题面里 / 把合成样本叫真实 / 同一阶段反复让学习者找轮次”三类，
 * 不评价内容质量本身（那归语义评审）。命中即带反馈重试一次，避免生成链把坏题落库。
 */
export function assessStageNarration(
  subtasks: StageNarrationInput[],
  options: { hasMaterials?: boolean } = {},
): StageNarrationResult {
  const list = Array.isArray(subtasks) ? subtasks : [];
  const violations: string[] = [];
  let locatorCount = 0;

  for (let i = 0; i < list.length; i += 1) {
    const task = list[i] || {};
    const title = String(task.title || '').trim();
    const description = String(task.description || '').trim();
    const acceptance = String(task.acceptanceHint || '').trim();
    const body = `${title} ${description}`;
    const label = `任务 ${i + 1}「${title || '无标题'}」`;

    if (ANSWER_HINT_RE.test(description) || ANSWER_HINT_RE.test(acceptance)) {
      violations.push(`${label} 把答案写进了题面/验收（提前揭示关键轮次或归属）`);
    }
    if (TITLE_SPOILER_RE.test(title)) {
      violations.push(`${label} 标题写成了结论陈述句（剧透谜底）——标题改为「动作+靶子/悬念」，结论留给课里得出`);
    }
    if (SAME_CASE_REUSE_RE.test(`${title} ${description}`)) {
      violations.push(`${label} 指名复用前面任务的主教材（同例复读）——同一个例子只允许当一课的主教材，后续课换新例子迁移`);
    }
    if (UNSOURCED_REAL_RE.test(body)
      && !options.hasMaterials
      && !(Array.isArray(task.materialRefs) && task.materialRefs.length > 0)) {
      violations.push(`${label} 没有资料引用却把样本称作“真实/公开复盘”，应改为示例/仿真记录`);
    }
    if (LOCATOR_INSTRUCTION_RE.test(`${title} ${description}`)) {
      locatorCount += 1;
    }
  }

  if (locatorCount >= 2) {
    violations.push(`本阶段有 ${locatorCount} 个“在记录里找第几轮”的定位任务；同一路径这类动作最多 1 次`);
  }

  if (violations.length === 0) return { valid: true };
  return {
    valid: false,
    failureReason: 'TASK_NARRATION_GUARD: 题面泄露答案/标题剧透/同例复读/无来源称真实/定位题重复',
    violations,
  };
}

/**
 * 规划层来源诚实（2026-11-12 实证：「不写代码看懂 AI Agent」路径）：goal 对话承诺
 * 「都是公开日志能查到的、不拿编的」但 needsMaterial 未登记 → 联网采集整链未触发 →
 * 规划器把口头承诺抄进 path summary 与 milestone goal 当既成事实，15 节课全靠即兴
 * 合成还标"真实"。无材料（未采集/未上传）时，summary 与阶段的 title/description/goal
 * 一律不得出现「真实记录/公开复盘/真实案例」类措辞——没有采集结果的承诺只能写成
 * 「示意记录/示例样本（形态参照公开事故类型）」。
 */
export interface PlanningSourceHonestyInput {
  summary?: string;
  milestones?: Array<{ title?: string; description?: string; goal?: string }>;
}

export function assessPlanningSourceHonesty(
  plan: PlanningSourceHonestyInput,
  options: { hasMaterials?: boolean } = {},
): StageNarrationResult {
  if (options.hasMaterials) return { valid: true };
  const violations: string[] = [];
  const summary = String(plan.summary || '').trim();
  if (UNSOURCED_REAL_RE.test(summary)) {
    violations.push('路径 summary 宣称「真实/公开记录」但本路径没有联网采集结果或上传资料——改为「示意记录/示例样本（形态参照公开事故类型）」');
  }
  (Array.isArray(plan.milestones) ? plan.milestones : []).forEach((milestone, index) => {
    const text = `${milestone?.title || ''} ${milestone?.description || ''} ${milestone?.goal || ''}`;
    if (UNSOURCED_REAL_RE.test(text)) {
      violations.push(`阶段 ${index + 1}「${String(milestone?.title || '').slice(0, 20)}」宣称「真实/公开记录」但无资料支撑——同样改为示例措辞`);
    }
  });
  if (violations.length === 0) return { valid: true };
  return {
    valid: false,
    failureReason: 'PLANNING_SOURCE_HONESTY: 无资料支撑却在 summary/阶段目标里承诺真实或公开记录',
    violations,
  };
}
