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
 * 满员置换（2026-10-19 20 goal 跑批实证补修）：首版「阶段任务已达 subtasksPerStageRange 上界
 * → 不发调用」把补课变成了事实上的死代码——阶段任务数在真实跑批里被 clampStageTasksToHints
 * 顶到上界是常态（20 goal：51/73 阶段正好 = 上界；13 个零引用阶段里 12 个因此从未发起调用），
 * 唯一一次发起调用（child-development 阶段 2）返回的 5 条任务全部带窗口内引用、其中 3 条是
 * 「把既有任务改写成带引用版本」，却因与既有任务标题近重复被 merge 全部判重丢弃。修法：
 * 上界内无空位时改为**等量置换**——换下至多 2 条「不带窗口引用」的旧任务，换入同数量的带引用
 * 任务（上界是硬结构约束不能破，阶段任务数不变）；判重底座排除被换下的任务，否则模型对既有
 * 任务的带引用改写（补课的目标形态）永远过不了「与首轮近似 = 换皮」闸。同时删掉 add 模式的
 * 「按空位预截断」：预截断会让前几条被判重的候选白白吃掉空位（同实证：2 个空位被两条改写占满、
 * 判重丢弃后，后面两条真正带引用的全新任务也已被截断丢掉）。
 *
 * 纪律（issue「不做」项的代码化）：
 * - 系统**绝不**自动补写/绑定 `materialRefs`——引用必须由模型给出，并经 skill 侧逐字核对
 *   （`withMaterialRefs` → `normalizeMaterialRefs`：quote 逐字在资料里、sectionId 真实存在）。
 *   本模块只加**更强的一道收口**：只收 sectionId 落在本阶段窗口内的引用；窗口外的引用、
 *   没给 sectionId 的引用一律拒收（不可核对的伪引用比缺引用更糟）。
 * - 补不齐不硬塞：闸内拿不到带引用任务就如实记账（`reason`），保留首轮产出。
 */
import { mergeSupplementTasks, titlesTooClose, type SupplementTask } from './stage-task-supplement';
import type { PromptMaterial } from '../../materials/material-prompt-projection';

/** 单次零引用补课最多并入/置换几条任务（1 条带引用即闭合缺口，多要 1 条防单条被去重/拒收）。 */
export const ZERO_REF_SUPPLEMENT_MAX_TASKS = 2;

/** 置换模式判「改写对象」的标题相似度阈值：与 mergeSupplementTasks 的默认判重阈值同源。 */
const REPLACE_MATCH_DUP_THRESHOLD = 0.6;

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
  /** 上界内无并入空位、且没有可换下的「无窗口引用」旧任务：没有可动的位置，不发起调用 */
  | 'no-headroom'
  /** 路径级闸已耗尽（每路径最多 1 次） */
  | 'gate-exhausted'
  /** 补课调用抛错 */
  | 'call-failed'
  /** 调用有返回，但没有任何「带窗口内引用」的任务 */
  | 'no-ref-tasks'
  /** 带引用任务被标题去重/上界拦下，无一并入（add）或无一置换成立（replace） */
  | 'no-added-tasks';

/** 补课形态：add=上界内直接并入；replace=已达上界，等量置换无引用旧任务（阶段任务数不变）。 */
export type ZeroRefSupplementMode = 'add' | 'replace';

export interface ZeroRefSupplementAudit {
  /** 是否发起了模型调用（闸被消耗）。 */
  attempted: boolean;
  /** 是否补成（阶段任务应被替换为 `tasks`）。 */
  applied: boolean;
  /** 未补成的原因；补成时为 null。 */
  reason: ZeroRefSupplementReason | null;
  /** 补课形态；未发起调用时为 null。 */
  mode: ZeroRefSupplementMode | null;
  /** 请求补几/换几条。 */
  needed: number;
  /** 模型返回的任务数。 */
  incoming: number;
  /** 实际并入（add）或置换入（replace）的任务数。 */
  accepted: number;
  /** replace 模式实际换下的无引用旧任务数（add 模式恒为 0）。 */
  replaced: number;
  /** 被拒收/未并入的任务数（无窗口内引用 + 越空位截断 + 判重丢弃）。 */
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
 * 置换模式的「换下对象」选择（与 `candidates` 同序一一对应）：
 * ① 优先挑与补课任务标题近重复的无引用旧任务——模型最常见的形态是把阶段里某条任务**改写**成
 *    带引用版本（2026-10-19 实证：child-development 阶段 2 补课返回 5 条中 3 条是既有任务的
 *    逐字/近似改写 + 引用），被改写的那条正是该换下的；
 * ② 没有近重复匹配的，退而换下**尾部**（收尾动作，通常锚定资料最弱）的无引用旧任务——
 *    确定性选择，便于复算；无论如何都不动已带窗口引用的任务。
 */
export function pickReplaceVictims<T extends SupplementTask>(
  replaceable: T[],
  candidates: T[],
  dupThreshold = REPLACE_MATCH_DUP_THRESHOLD,
): T[] {
  const used = new Set<T>();
  const victims: T[] = [];
  for (const candidate of candidates) {
    const title = String(candidate?.title || '');
    const matched = replaceable.find((task) => !used.has(task)
      && titlesTooClose(String(task?.title || ''), title, dupThreshold));
    const victim = matched
      || [...replaceable].reverse().find((task) => !used.has(task));
    if (!victim) break;
    used.add(victim);
    victims.push(victim);
  }
  return victims;
}

/**
 * 零引用阶段的限定补课：闸内调一次 stage-designer，只并入「带窗口内引用」的新任务。
 *
 * 流程与闸语义（按序）：
 *   ① 窗口无可用章节 → 跳过（**不消耗闸**：没发起调用）；
 *   ② 上界内无空位（任务数 ≥ subtasksPerStageRange[1]）→ 转**置换模式**：可换下的
 *      「无窗口引用」旧任务为 0 条时才跳过（不消耗闸）；否则照常发起调用，补成时等量置换；
 *   ③ 取闸失败（本路径已补过）→ 跳过；
 *   ④ 调用 stage-designer（payload = 首轮输入 + supplementRequest{needed, existing, minutesRange,
 *      stageNumber, reason:'zero-material-ref', materialRefsRequired:true}）；抛错 → `call-failed`；
 *   ⑤ 收任务：只留带窗口内引用的（其余拒收）；一条都没有 → `no-ref-tasks`；
 *   ⑥ add：整批候选交 mergeSupplementTasks 判重（**不按空位预截断**——预截断会让前几条被判重的
 *      候选白白吃掉空位），最终条数由 upper 兜底，一条都没并入 → `no-added-tasks`；
 *      replace：1 换 1 等量置换（判重底座排除被换下者），k 条全换入才成立，阶段任务数不变；
 *      换不成 → `no-added-tasks`。否则 `applied`，返回补后清单。
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
    mode: null,
    needed: 0,
    incoming: 0,
    accepted: 0,
    replaced: 0,
    rejected: 0,
  });

  const windowIds = new Set(collectWindowSectionIds(params?.materials));
  if (windowIds.size === 0) return skipped('no-window-sections');

  const hints = params?.hints || null;
  const upper = nonNegativeInt((hints?.subtasksPerStageRange as unknown[] | undefined)?.[1]);
  const headroom = upper === null
    ? ZERO_REF_SUPPLEMENT_MAX_TASKS
    : Math.max(0, upper - existing.length);
  // 满员置换（2026-10-19 跑批实证调整）：上界内无空位是真实跑批的常态（clampStageTasksToHints
  // 会把模型超产裁到上界），若直接跳过，补课在常规路径上永不触发（20 goal：13 个零引用阶段
  // 里 12 个这样被跳过，闸从未成为瓶颈）。上界是硬结构约束不能破 → 满员时改为等量置换。
  const replaceMode = headroom <= 0;
  // 可换下的旧任务：不带「窗口内引用」者——补课的目标就是让任务长在资料上，绝不换下已锚定资料的任务。
  const replaceable = replaceMode
    ? existing.filter((task) => countWindowSectionRefs(task, windowIds) === 0)
    : [];
  if (replaceMode && replaceable.length === 0) return skipped('no-headroom');
  const slots = replaceMode
    ? Math.min(ZERO_REF_SUPPLEMENT_MAX_TASKS, replaceable.length)
    : Math.min(ZERO_REF_SUPPLEMENT_MAX_TASKS, headroom);

  if (!claimZeroRefSupplementGate(params.gate)) return skipped('gate-exhausted');

  const mode: ZeroRefSupplementMode = replaceMode ? 'replace' : 'add';
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
    mode,
    needed: slots,
    incoming: 0,
    accepted: 0,
    replaced: 0,
    rejected: 0,
    ...fields,
  });

  const needed = slots;
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

  if (!replaceMode) {
    // 不按空位**预截断**：先让判重把整批候选过完，最终条数由 upper 在 merge 里兜底。
    // 预截断的实测副作用（2026-10-19 child-development 阶段 2）：2 个空位被前两条「既有任务改写」
    // 占满，判重把它们丢弃后，后面两条真正带窗口引用的全新任务已被截断丢掉 → 空位白费
    // （audit: needed=2, incoming=5, accepted=0, rejected=3）。
    const limitUpper = upper === null ? existing.length + ZERO_REF_SUPPLEMENT_MAX_TASKS : upper;
    const { merged, added } = mergeSupplementTasks<T>(existing, accepted, {
      upper: limitUpper,
      // 零引用补课不设动作族闸：这里要的是「长在资料上」的任务，允许与首轮同族的
      // acquire/execute（换材料做深）；换皮仍由标题近重复闸拦截。
      requireTypeNovelty: null,
    });
    const rejectedTotal = rejected + (accepted.length - added.length);
    if (added.length === 0) {
      return attempted('no-added-tasks', {
        incoming: incomingRaw.length,
        rejected: rejectedTotal,
      });
    }
    return attempted(null, {
      incoming: incomingRaw.length,
      accepted: added.length,
      rejected: rejectedTotal,
    }, merged);
  }

  // —— replace 模式：1 换 1 等量置换，阶段任务数不变（= 原条数 ≤ 上界） ——
  // 从大往小试置换条数 k：判重底座 = 原清单 − k 条被换下者，模型对既有任务的带引用改写
  // （与「被它换下的那条」标题近重复）才不会在判重里被自己人拦下；k 条全换入才成立，
  // 少一条就退到更小的 k 重试，宁少勿换皮。
  const pool = accepted.slice(0, slots);
  const truncated = rejected + (accepted.length - pool.length);
  for (let k = pool.length; k >= 1; k -= 1) {
    const candidates = pool.slice(0, k);
    const victims = pickReplaceVictims(replaceable, candidates);
    if (victims.length < k) continue;
    const basis = existing.filter((task) => !victims.includes(task));
    const { merged, added } = mergeSupplementTasks<T>(basis, candidates, {
      // 置换后总条数 = 原条数（上界内）；upper 兜底防任何越界
      upper: existing.length,
      requireTypeNovelty: null,
    });
    if (added.length === k) {
      return attempted(null, {
        incoming: incomingRaw.length,
        accepted: k,
        replaced: k,
        rejected: truncated,
      }, merged);
    }
  }
  return attempted('no-added-tasks', { incoming: incomingRaw.length, rejected: truncated });
}
