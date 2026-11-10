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
