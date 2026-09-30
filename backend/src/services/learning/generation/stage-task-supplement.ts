/**
 * 阶段补课（2026-09-30 广度跑批实证驱动）：stage-designer 无视 targetSubtasksForStage
 * 下限的代码兜底。
 *
 * 实证（rw-exam5-01，法考 620h 自述）：每阶段锚 30 课（59.2h × 60 / 120min），8 个阶段里
 * 7 个只交付 5-10 课，实交付 129h = 学习者自述预算的 0.18×。链条上半全部健康
 * （预算锚 728h → 守恒夹到 462h → 每阶段锚 30 课），塌点在最后一公里：模型宁可用长课时
 * 顶，也不补课数。提示词规则 30 早写明「targetSubtasksForStage 是下限不是参考」，
 * 但软规则压不住模型惯性（实测 6/8 阶段不听）。
 *
 * 策略：**一次**补课调用（成本可控）+ 严格去重（同阶段换皮复读是评审实证过的副作用）
 * + 缺口留痕（诚实声明，不假装完整）。补不齐的部分不硬塞—— filler 比缺口更伤产品。
 */
import { titleSimilarity } from './stage-filler';

export interface SupplementTask {
  title?: string;
  estimatedMinutes?: number;
  [key: string]: unknown;
}

export interface MergeSupplementOptions {
  /** subtasksPerStageRange[1]：补课后总数不得超过结构上界 */
  upper: number | null;
  /**
   * 判定「重复课」的标题相似度阈值。默认 0.7——与 stage-filler 的同阶段判据同源
   * （「回补X→重推X」换皮对实测 0.7+），不另立标准；补课去重只是安全网，
   * 主防线仍是链路后段的 detectStageFiller。
   */
  dupThreshold?: number;
  /**
   * 只补首轮**缺失的动作族**（2026-09-30 评审实证）：实测补课新增课与首轮课字面相似度
   * 中位仅 0.10-0.38（去重闸门形同虚设），但任务类型分布显示新增课把首轮整个认知弧
   * （acquire→deconstruct→diagnose→model→execute→refine→consolidate）原样重跑一遍
   * ——学习者感知到的「同一件事换说法」。设该字段为任务类型键名（通常 'taskType'）时，
   * 只有首轮没有的动作族才被并入；这既是补质量闸，也是「宁少勿换皮」原则的代码化。
   */
  requireTypeNovelty?: string | null;
  /**
   * 开启 requireTypeNovelty 时：未标注类型的补课任务直接拒收（默认 true）。
   * 评审实证（rw-school5-41）：模型用「不带 type 的任务」穿透类型闸——闸门只查已声明
   * type，下游归一化再把默认类型写回库，等于闸门被静默绕过、19 个新增课仅 ~10% 填缺口。
   */
  rejectNoType?: boolean;
}

export interface MergeSupplementResult<T extends SupplementTask> {
  merged: T[];
  added: T[];
  dropped: T[];
  /** 丢弃原因计数：duplicate=标题近似 / typeRepeat=动作族首轮已有 / noType=未声明类型 / invalid=脏数据 */
  dropReasons: { duplicate: number; typeRepeat: number; noType: number; invalid: number };
}

/** 补课触发判据：有锚、已有产出、且不足锚的 70%（留 30% 容差，避免为 1-2 节课烧一次调用） */
export function needsLessonSupplement<T extends SupplementTask>(
  tasks: T[],
  targetSubtasksForStage: number | null | undefined,
): boolean {
  const wanted = Number(targetSubtasksForStage);
  if (!Number.isFinite(wanted) || wanted < 2) return false;
  if (!Array.isArray(tasks) || tasks.length === 0) return false;
  return tasks.length < Math.ceil(wanted * 0.7);
}

/**
 * 把补课调用返回的新任务并入既有清单。
 * 三道闸（按序）：① 动作族新颖（requireTypeNovelty 开启时，首轮已有的 taskType 不收）
 * ② 标题近似 ≥ 阈值判重丢弃；③ 无标题脏数据丢弃。新任务之间也互相去重。
 * 最终总数不超过 upper（结构上界）。
 */
export function mergeSupplementTasks<T extends SupplementTask>(
  existing: T[],
  incoming: T[],
  options: MergeSupplementOptions,
): MergeSupplementResult<T> {
  // 补课路径的去重阈值比全局同阶段判据（0.7）更严：评审实证「单调性证明的符号推理链骨架」
  // vs「完整推理链框架」只有 ~0.6，却在 0.7 闸门下存活——补课是"明知有复读风险仍要加课"的
  // 场景，宁可少补，不可放过学习者能感知到的同一件事。
  const dupThreshold = options.dupThreshold ?? 0.6;
  const typeField = options.requireTypeNovelty || null;
  const rejectNoType = options.rejectNoType ?? true;
  const existingTypes = new Set(
    existing.map((t) => String(t?.[typeField || 'taskType'] ?? '').trim()).filter(Boolean),
  );
  const kept: T[] = [];
  const dropped: T[] = [];
  const reasons = { duplicate: 0, typeRepeat: 0, noType: 0, invalid: 0 };
  const seen = [...existing];
  for (const task of incoming || []) {
    if (!task || typeof task.title !== 'string' || !task.title.trim()) {
      dropped.push(task); reasons.invalid += 1; continue;
    }
    let type = '';
    if (typeField) {
      type = String(task[typeField] ?? '').trim();
      if (!type) {
        // 未声明类型：无法验证它填补了哪个动作族缺口，拒收（下游归一化会把默认类型写回库，
        // 放行等于让类型闸静默失效——评审实证的穿透路径）
        if (rejectNoType) { dropped.push(task); reasons.noType += 1; continue; }
      } else if (existingTypes.has(type)) {
        dropped.push(task); reasons.typeRepeat += 1; continue;
      }
    }
    const duplicate = seen.some((t) => titlesTooClose(t?.title, task.title, dupThreshold));
    if (duplicate) { dropped.push(task); reasons.duplicate += 1; continue; }
    kept.push(task);
    seen.push(task);
    if (typeField && type) existingTypes.add(type);
  }
  let merged = [...existing, ...kept];
  const upper = Number(options.upper);
  if (Number.isFinite(upper) && upper >= 1 && merged.length > upper) {
    merged = merged.slice(0, Math.floor(upper));
  }
  const added = merged.slice(existing.length);
  return { merged, added, dropped, dropReasons: reasons };
}

function titlesTooClose(a: string | undefined, b: string, threshold: number): boolean {
  if (!a) return false;
  if (titleSimilarity(a, b) >= threshold) return true;
  // 公共前缀判据（2026-09-30 b2 评审实证）：「搭建单调性证明的符号推理链骨架」vs「完整推理链框架」
  // 相似度只有 0.47，却共用 8 字题干——这类「同一题干+换尾缀」是补课换皮的主要形态，
  // 纯相似度拦不住。≥6 字公共前缀或互为包含即判重复。
  const na = a.replace(/[\s，。、；：:；,.;/／·\-—－()（）[\]【】"'“”‘’]/g, '');
  const nb = b.replace(/[\s，。、；：:；,.;/／·\-—－()（）[\]【】"'“”‘’]/g, '');
  if (na.length < 6 || nb.length < 6) return false;
  let prefix = 0;
  while (prefix < Math.min(na.length, nb.length) && na[prefix] === nb[prefix]) prefix += 1;
  return prefix >= 6 || na.includes(nb) || nb.includes(na);
}

/** 补课调用的输入形状（提示词侧按 supplementRequest 规则消费） */
export interface SupplementRequest {
  /** 还差几节课（锚 - 既有，已按去重前的原始差计） */
  needed: number;
  /** 既有任务标题与类型：补的是「清单之外的新方向」，不是重写 */
  existing: Array<{ title: string; type?: string }>;
  /** 单课时长区间，补课任务同样受约束 */
  minutesRange: [number, number] | null;
  stageNumber: number;
}

export function buildSupplementRequest<T extends SupplementTask>(
  tasks: T[],
  targetSubtasksForStage: number,
  stageNumber: number,
  subtaskMinutesRange: [number, number] | null,
): SupplementRequest {
  return {
    needed: Math.max(1, targetSubtasksForStage - tasks.length),
    existing: tasks.map((t) => ({ title: String(t.title || ''), type: t.type as string | undefined })),
    minutesRange: subtaskMinutesRange,
    stageNumber,
  };
}
