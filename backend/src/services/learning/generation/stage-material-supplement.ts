/**
 * 零引用阶段补课（#119 优化项 1，P1）——有资料却一条引用都没写的阶段，定向补一次「带引用」的任务。
 *
 * 背景（2026-10-17 20 goal 实测，issue #119 正文）：阶段资料按位次开窗（后半引用 9%→25.2%）+
 * 逐阶段审计（`_generation.materialCoverage`）落地后，真缺口仍在——cpa-accounting / mbsr 的
 * 末阶段有资料却零引用（阶段 3 仅 1 条、阶段 4 零）。缺口看得见了，但没人补：
 * `stage-enrichment.ts` 的守卫当时只 warn（「不自动补引用」）。
 *
 * 修法（issue 原文口径）：对零引用阶段做**一次限定的** stage-designer supplement 调用
 * （带 `supplementRequest` + 本阶段窗口资料），只收「带引用」的新任务；
 * **每路径最多 1 次**——闸对象由调用方按 run 作用域持有并传给每个阶段，
 * 本模块在**发起调用前**同步取闸（阶段设计并发 2 路，先查后置必须是同步的）。
 *
 * 纪律（issue「不做」项的代码化）：
 * - 系统**绝不**自动补写/绑定 `materialRefs`——引用必须由模型给出，并经 skill 侧逐字核对
 *   （`withMaterialRefs` → `normalizeMaterialRefs`：quote 逐字在资料里、sectionId 真实存在）。
 *   本模块只加**更强的一道收口**：只收 sectionId 落在本阶段窗口内的引用；窗口外的引用、
 *   没给 sectionId 的引用一律拒收（不可核对的伪引用比缺引用更糟）。
 * - 补不齐不硬塞：闸内拿不到带引用任务就如实记账（`reason`），保留首轮产出。
 */
import { mergeSupplementTasks, type SupplementTask } from './stage-task-supplement';
import type { PromptMaterial } from '../../materials/material-prompt-projection';

/** 单次零引用补课最多请求几条任务（1 条带引用即闭合缺口，多要 1 条防单条被去重/拒收）。 */
export const ZERO_REF_SUPPLEMENT_MAX_TASKS = 2;

/** 补课只用到 planningHints 的这两项（避免把 any 传进纯逻辑）。 */
export interface ZeroRefSupplementHints {
  subtasksPerStageRange?: [number, number] | null;
  subtaskMinutesRange?: [number, number] | null;
}

/**
 * 路径级闸：每路径最多 1 次零引用补课调用。
 * 调用方在 run 作用域创建一次，传给该 run 的每个阶段（并发下由取闸的原子性保证只调用一次）。
 */
export interface ZeroRefSupplementGate {
  used: boolean;
}

export function createZeroRefSupplementGate(): ZeroRefSupplementGate {
  return { used: false };
}

/**
 * 同步取闸（check-and-set）：JS 单线程下先查后置不会被并发阶段交错打断。
 * 取闸发生在**发起模型调用前**——因「窗口无可用章节 / 阶段已满」提前跳过时不消耗闸。
 */
export function claimZeroRefSupplementGate(gate: ZeroRefSupplementGate): boolean {
  if (!gate || gate.used) return false;
  gate.used = true;
  return true;
}

/** 未补成的原因（写进 materialCoverage 审计，运维/复算可直接读）。 */
export type ZeroRefSupplementReason =
  /** 本阶段窗口内没有带 id 的可用章节：没有可核对的引用目标，不发起调用 */
  | 'no-window-sections'
  /** 阶段任务已达 subtasksPerStageRange 上界：没有并入空位，不发起调用 */
  | 'no-headroom'
  /** 路径级闸已耗尽（每路径最多 1 次） */
  | 'gate-exhausted'
  /** 补课调用抛错 */
  | 'call-failed'
  /** 调用有返回，但没有任何「带窗口内引用」的任务 */
  | 'no-ref-tasks'
  /** 带引用任务被标题去重/上界拦下，无一并入 */
  | 'no-added-tasks';

export interface ZeroRefSupplementAudit {
  /** 是否发起了模型调用（闸被消耗）。 */
  attempted: boolean;
  /** 是否补成（阶段任务应被替换为 `tasks`）。 */
  applied: boolean;
  /** 未补成的原因；补成时为 null。 */
  reason: ZeroRefSupplementReason | null;
  /** 请求补几条。 */
  needed: number;
  /** 模型返回的任务数。 */
  incoming: number;
  /** 实际并入的任务数。 */
  accepted: number;
  /** 因「无窗口内引用」被拒收的任务数。 */
  rejected: number;
}

export interface ZeroRefSupplementOutcome<T extends SupplementTask> extends ZeroRefSupplementAudit {
  /** 补成时为补后任务清单；否则原样返回首轮任务（调用方据此决定是否替换）。 */
  tasks: T[];
}

export interface ZeroRefSupplementParams<T extends SupplementTask> {
  stageNumber: number;
  /** 本阶段窗口投影后的资料（stageMaterials）：其章节 id 即「引用命中窗口」的判据。 */
  materials: PromptMaterial[] | null | undefined;
  /** 首轮任务（已归一化：title/type/estimatedMinutes/materialRefs…）。 */
  stageTasks: T[];
  /** 首轮 stage-designer 输入（含窗口资料）；补课调用在它之上追加 supplementRequest。 */
  designerInput: unknown;
  hints?: ZeroRefSupplementHints | null;
  gate: ZeroRefSupplementGate;
  /** stage-designer 调用（生产=`executeSkill(stageDesignerDefinition, input)`）；返回 { subtasks } 或 null。 */
  callDesigner: (input: unknown) => Promise<{ subtasks?: unknown } | null | undefined>;
}

/** 本阶段窗口内**可引用**的章节 id（顺序保留；空/非字符串 id 不计）。 */
export function collectWindowSectionIds(materials: PromptMaterial[] | null | undefined): string[] {
  const ids: string[] = [];
  for (const material of Array.isArray(materials) ? materials : []) {
    for (const section of material?.sections || []) {
      const id = typeof section?.id === 'string' ? section.id.trim() : '';
      if (id) ids.push(id);
    }
  }
  return ids;
}

/** 任务带来几条「sectionId 命中窗口」的引用（窗口外 / 无 sectionId 的引用不计）。 */
export function countWindowSectionRefs(task: unknown, windowSectionIds: ReadonlySet<string>): number {
  const refs = (task as { materialRefs?: unknown } | null | undefined)?.materialRefs;
  if (!Array.isArray(refs)) return 0;
  let count = 0;
  for (const ref of refs) {
    const sectionId = typeof (ref as { sectionId?: unknown } | null | undefined)?.sectionId === 'string'
      ? String((ref as { sectionId: string }).sectionId).trim()
      : '';
    if (sectionId && windowSectionIds.has(sectionId)) count += 1;
  }
  return count;
}

/** 只收带「窗口内引用」的任务；其余拒收（宁缺勿编）。 */
export function filterTasksByWindowRefs<T extends SupplementTask>(
  tasks: unknown[] | null | undefined,
  windowSectionIds: ReadonlySet<string>,
): { accepted: T[]; rejected: number } {
  const accepted: T[] = [];
  let rejected = 0;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (countWindowSectionRefs(task, windowSectionIds) > 0) accepted.push(task as T);
    else rejected += 1;
  }
  return { accepted, rejected };
}

function nonNegativeInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

/**
 * 零引用阶段的限定补课：闸内调一次 stage-designer，只并入「带窗口内引用」的新任务。
 *
 * 流程与闸语义（按序）：
 *   ① 窗口无可用章节 → 跳过（**不消耗闸**：没发起调用）；
 *   ② 阶段已无并入空位（任务数 ≥ subtasksPerStageRange[1]）→ 跳过（不消耗闸）；
 *   ③ 取闸失败（本路径已补过）→ 跳过；
 *   ④ 调用 stage-designer（payload = 首轮输入 + supplementRequest{needed, existing, minutesRange,
 *      stageNumber, reason:'zero-material-ref', materialRefsRequired:true}）；抛错 → `call-failed`；
 *   ⑤ 收任务：只留带窗口内引用的（其余拒收）；一条都没有 → `no-ref-tasks`；
 *   ⑥ 按空位数截断后并入（标题近重复/上界仍由 mergeSupplementTasks 兜底）；一条都没并入
 *      → `no-added-tasks`；否则 `applied`，返回补后清单。
 *
 * 任何一步失败都不抛出——补课是优化项，不得打断路径生成（fail-open）。
 */
export async function supplementZeroRefStage<T extends SupplementTask>(
  params: ZeroRefSupplementParams<T>,
): Promise<ZeroRefSupplementOutcome<T>> {
  const existing = Array.isArray(params?.stageTasks) ? params.stageTasks : [];
  const skipped = (reason: ZeroRefSupplementReason): ZeroRefSupplementOutcome<T> => ({
    tasks: existing,
    attempted: false,
    applied: false,
    reason,
    needed: 0,
    incoming: 0,
    accepted: 0,
    rejected: 0,
  });

  const windowIds = new Set(collectWindowSectionIds(params?.materials));
  if (windowIds.size === 0) return skipped('no-window-sections');

  const hints = params?.hints || null;
  const upper = nonNegativeInt((hints?.subtasksPerStageRange as unknown[] | undefined)?.[1]);
  const headroom = upper === null
    ? ZERO_REF_SUPPLEMENT_MAX_TASKS
    : Math.max(0, upper - existing.length);
  if (headroom <= 0) return skipped('no-headroom');

  if (!claimZeroRefSupplementGate(params.gate)) return skipped('gate-exhausted');

  // 闸已消耗：从这里起所有返回都带 attempted=true（调用了模型 / 至少发起了调用）。
  const attempted = (
    reason: ZeroRefSupplementReason | null,
    fields: Partial<ZeroRefSupplementAudit> = {},
    tasks: T[] = existing,
  ): ZeroRefSupplementOutcome<T> => ({
    tasks,
    attempted: true,
    applied: reason === null,
    reason,
    needed: Math.min(ZERO_REF_SUPPLEMENT_MAX_TASKS, headroom),
    incoming: 0,
    accepted: 0,
    rejected: 0,
    ...fields,
  });

  const needed = Math.min(ZERO_REF_SUPPLEMENT_MAX_TASKS, headroom);
  const supplementRequest = {
    needed,
    existing: existing.map((task) => ({ title: String(task?.title || ''), type: task?.type })),
    minutesRange: (hints?.subtaskMinutesRange as [number, number] | null | undefined) || null,
    stageNumber: params.stageNumber,
    // 零引用补课专用标记：本次只补「长在资料上、带可核对引用」的任务
    reason: 'zero-material-ref',
    materialRefsRequired: true,
  };

  const base = params.designerInput && typeof params.designerInput === 'object'
    ? (params.designerInput as Record<string, unknown>)
    : {};
  let incomingRaw: unknown[] = [];
  try {
    const result = await params.callDesigner({ ...base, supplementRequest });
    incomingRaw = Array.isArray(result?.subtasks) ? (result?.subtasks as unknown[]) : [];
  } catch {
    return attempted('call-failed');
  }
  if (incomingRaw.length === 0) return attempted('no-ref-tasks');

  const { accepted, rejected } = filterTasksByWindowRefs<T>(incomingRaw, windowIds);
  if (accepted.length === 0) {
    return attempted('no-ref-tasks', { incoming: incomingRaw.length, rejected });
  }
  // 空位先截断：不让上界在 merge 里静默丢掉带引用的任务（丢多少看得见）
  const limited = accepted.slice(0, headroom);
  const { merged, added } = mergeSupplementTasks(existing, limited, {
    upper,
    // 零引用补课不设动作族闸：这里要的是「长在资料上」的任务，允许与首轮同族的
    // acquire/execute（换材料做深）；换皮仍由标题近重复闸拦截。
    requireTypeNovelty: null,
  });
  if (added.length === 0) {
    return attempted('no-added-tasks', {
      incoming: incomingRaw.length,
      rejected: rejected + (accepted.length - limited.length),
    });
  }
  return attempted(null, {
    incoming: incomingRaw.length,
    accepted: added.length,
    rejected: rejected + (accepted.length - limited.length),
  }, merged);
}
