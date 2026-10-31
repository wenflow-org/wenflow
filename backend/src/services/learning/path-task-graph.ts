/**
 * 阶段任务图后处理：阶段分钟夹取、认知动作拓扑序、任务引用重映射、前向引用修复。
 *
 * 2026-10-28 从 path-planning-hints.ts 按簇拆出（分层棘轮：>1000 行只许缩短）。
 * 全部为纯函数，无 IO/DB 依赖；path-planning-hints 继续 re-export 保持调用方零改动。
 */

/**
 * 阶段任务分钟总量的确定性夹（2026-10-25 方向改造 / 承诺二次违约修复）。
 *
 * 实证（uqcit3l）：hints 完全正确（targetTotalHours=2、targetHoursPerMilestone=0.7、
 * targetMinutesPerTask=20、subtaskMinutesRange=[9,30]），但 stage-designer 仍排出
 * 80/60/113 分钟三阶段共 253 分钟 ≈ 承诺 120 分钟的 2.1 倍——模型无视锚，
 * 而既有 clampStageTasksToHints 只夹「单任务上界」与「任务数上界」，不夹阶段总量。
 *
 * 语义：阶段总量超过 `stageMinutesBudget` 时，按比例压每个任务的分钟（保持相对权重），
 * 但不低于 minMinutes（保底可执行），且不高于单任务上界；压不动（任务数太多导致
 * 每任务已到下界仍超）时截断尾部任务——宁可少给（可逆，用户能加），不撑破承诺。
 * 只治注水方向；未超预算时原样返回（零行为变化）。
 */
export function clampStageMinutesToBudget<T extends { estimatedMinutes?: number }>(
  tasks: T[],
  stageMinutesBudget: number | null | undefined,
  bounds?: { minMinutes?: number; maxMinutes?: number } | null,
): T[] {
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks;
  const budget = Number(stageMinutesBudget);
  if (!Number.isFinite(budget) || budget <= 0) return tasks;
  const minutesOf = (task: T): number => {
    const value = Number(task?.estimatedMinutes);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const total = tasks.reduce((sum, task) => sum + minutesOf(task), 0);
  if (total <= budget) return tasks;
  const minMinutes = Math.max(5, Number(bounds?.minMinutes) || 5);
  const maxMinutes = Number(bounds?.maxMinutes) > 0 ? Number(bounds.maxMinutes) : Number.POSITIVE_INFINITY;
  const scale = budget / total;
  const scaled = tasks.map((task) => {
    const raw = minutesOf(task);
    if (raw <= 0) return task;
    const next = Math.round(Math.min(maxMinutes, Math.max(minMinutes, raw * scale)));
    return { ...task, estimatedMinutes: next };
  });
  // 逐任务下界保底会让总量仍超预算 → 从尾部截断（保留前置任务与交付/判断任务，
  // 尾部通常是收束类，删掉损失最小；至少保留 1 个）。
  let kept = scaled;
  const sumOf = (list: T[]): number => list.reduce((sum, task) => sum + minutesOf(task), 0);
  while (kept.length > 1 && sumOf(kept) > budget) {
    kept = kept.slice(0, -1);
  }
  return kept;
}

/**
 * 阶段内认知动作拓扑序（确定性重排，2026-10-25 外部评审实证）。
 *
 * 问题：prompt 第 65 行已要求「先 acquire/diagnose/deconstruct，再 model/execute，
 * 最后 refine/consolidate」，但只是软约束，模型经常不遵守：
 *   - py-clean-07 S5（R1）：refine(复查固化脚本) → model(写出固化脚本) → execute(才学 groupby)
 *     —— 复查的对象由后一个任务才产出，先审后产。
 *   - eng-syntax-04 S4（R1）：deconstruct → consolidate → model → diagnose → execute
 *     —— consolidate 要求产出流程卡，而流程卡要练的嵌套句在 model 才第一次练。
 *   - power-train-10 S1（R1）：execute(逐档踩五档功率) 排在 diagnose(定恢复放行判据) 之前
 *     —— 用户刚测完 FTP 腿酸三天，对话明确约定先低强度。
 *
 * **只治一类倒挂**（2026-10-26 收紧）：收束档（refine/consolidate）跑到应用档
 * （model/execute）之前。这是唯一**结构上必然错**的倒挂——收束动作的宾语（要复查的脚本、
 * 要合龙的流程卡）由应用档产出，先审后产在物理上不可能。
 *
 * **不动**建立档与应用档的相对次序：diagnose 既可能「先摸清现状再动手」（该在前），
 * 也可能「做完再诊断」（该在后），语义上两可，代码无法判断。强行统一会把合法的
 * 「做完再诊断」也翻过来（2026-10-26 实测：sql-perf S1 的 execute→diagnose 被误翻，
 * 连带 5/10 条路径的引用编号失配）。这类次序留给 prompt 规则与评审。
 *
 * 稳定排序，同档内保持模型给的相对顺序；已是正序时恒等变换（零行为变化）。
 */
const TOPOLOGY_RANK: Record<string, number> = {
  // 建立档与应用档同权（保持模型原序），只有收束档被强制压后。
  acquire: 0,
  deconstruct: 0,
  diagnose: 0,
  model: 0,
  execute: 0,
  refine: 1,
  consolidate: 1,
};

export function orderStageTasksByTopology<T extends { type?: string }>(tasks: T[]): T[] {
  if (!Array.isArray(tasks) || tasks.length < 2) return tasks;
  const rankOf = (task: T): number => {
    const key = String(task?.type || '').trim();
    return key in TOPOLOGY_RANK ? TOPOLOGY_RANK[key] : 0;
  };
  // 稳定排序：同档保持原序（Array#sort 在 V8 已稳定，但显式带下标以防依赖实现细节）
  return tasks
    .map((task, index) => ({ task, index, rank: rankOf(task) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((entry) => entry.task);
}

/**
 * 重排后同步改写任务描述里的「任务 N」交叉引用（2026-10-26 拓扑重排的必要配套）。
 *
 * 为什么必须成对做：拓扑重排把 execute 提到 diagnose 之前后，原描述里的「沿用任务 1
 * 抄下的同一份 EXPLAIN」就变成了自指（本任务现在是任务 1）。实测 5/10 条路径因此
 * 被评审判 prerequisiteGap，但根因不是能力前置缺失，而是编号失配。
 *
 * 语义：只在**确定是引用本阶段其它任务**时改号。识别「任务 N」「第 N 步」「任务N」三类写法，
 * N 落在 [1, 阶段任务数] 内才替换；替换成该任务在新顺序里的位次。指向自身的引用
 * （重排前引用的任务恰好被换到本任务位置）改写为「本任务上一步的产出」这类不依赖编号的表述，
 * 避免产生新的自指。
 */
export function remapStageTaskReferences<
  T extends { title?: unknown; description?: unknown; acceptanceHint?: unknown; acceptanceCriteria?: unknown }
>(originalOrder: T[], ordered: T[]): T[] {
  if (!Array.isArray(ordered) || ordered.length < 2) return ordered;
  if (originalOrder.length !== ordered.length) return ordered;
  // 旧位次(1-based) → 新位次(1-based)
  const newIndexByTask = new Map<T, number>();
  ordered.forEach((task, index) => newIndexByTask.set(task, index + 1));
  const oldIndexByTask = new Map<T, number>();
  originalOrder.forEach((task, index) => oldIndexByTask.set(task, index + 1));

  const rewriteText = (text: string | undefined, selfOldIndex: number): string | undefined => {
    if (typeof text !== 'string' || !text) return text;
    return text.replace(/(任务\s*|第\s*)(\d+)(\s*步)?/g, (match, prefix: string, digits: string, suffix: string | undefined) => {
      const oldNumber = Number(digits);
      if (!Number.isFinite(oldNumber) || oldNumber < 1 || oldNumber > originalOrder.length) return match;
      const referenced = originalOrder[oldNumber - 1];
      if (!referenced) return match;
      const newNumber = newIndexByTask.get(referenced);
      if (!newNumber) return match;
      // 原本引用「另一个任务」，现在那个任务被换到本任务的位置 ⇒ 改写为非编号表述
      if (newNumber === selfOldIndex) return '上一步的';
      return `${prefix}${newNumber}${suffix ?? ''}`;
    });
  };

  // 相对指代重写（2026-10-26 外部评审悖论3）：模型极少写「见任务 1」，绝大多数写
  // 「沿用上一步的表格 / 把上一任务标出的卡壳句…」。收束任务被后移后，紧随其后的任务
  // 全体前移一位，「上一步」的指向就断了。对位置发生变化（含被牵连位移）的任务，
  // 把相对指代替换为**重排前**它紧邻前一个任务的标题——标题不随重排变化，指代永远成立。
  const RELATIVE_REF_RE = /上一?步|上一?(?:个)?任务/g;
  const rewriteRelativeRefs = (text: string | undefined, selfOldIndex: number): string | undefined => {
    if (typeof text !== 'string' || !text || selfOldIndex < 2) return text;
    const previousTask = originalOrder[selfOldIndex - 2];
    const previousTitle = typeof previousTask?.title === 'string' ? previousTask.title.trim() : '';
    if (!previousTitle) return text;
    return text.replace(RELATIVE_REF_RE, `「${previousTitle}」`);
  };

  return ordered.map((task, index) => {
    const selfNewIndex = index + 1;
    const selfOldIndex = oldIndexByTask.get(task) ?? selfNewIndex;
    const moved = selfNewIndex !== selfOldIndex;
    const next: T = { ...task };
    if (typeof task.description === 'string') {
      const rewritten = rewriteText(task.description, selfNewIndex);
      next.description = moved ? rewriteRelativeRefs(rewritten, selfOldIndex) : rewritten;
    }
    if (typeof task.acceptanceHint === 'string') {
      const rewritten = rewriteText(task.acceptanceHint, selfNewIndex);
      next.acceptanceHint = moved ? rewriteRelativeRefs(rewritten, selfOldIndex) : rewritten;
    }
    if (typeof task.acceptanceCriteria === 'string') {
      const rewritten = rewriteText(task.acceptanceCriteria, selfNewIndex);
      next.acceptanceCriteria = moved ? rewriteRelativeRefs(rewritten, selfOldIndex) : rewritten;
    }
    return next;
  });
}

/**
 * 前向引用修复（2026-10-28 R4 外部评审）：
 * 拓扑重排只改编号、不理解语义，实测留下「T3 说基于任务4」「T1 说用任务2的底稿」
 * 这类指向后面任务的引用。这里做两件保守的事：
 *   1) 若被引用任务在本阶段更靠后且类型是 acquire → 把它前移到引用方之前
 *      （建立档前置是安全方向，且能从根上修好 F68 的「先拆后采」）；
 *   2) 其余仍指向后方的「任务 N」改写为「被引用任务标题」——不再留一个会随
 *      后续重排再次失配的数字指针；跨档依赖（model 引用 refine / deconstruct
 *      引用 diagnose）不强行换序，避免把收束档顶到建立档前面。
 * 移动过任务后先重映射一次编号，再改写剩余前向引用。
 */
export function repairForwardReferences<
  T extends { title?: unknown; type?: unknown; description?: unknown; acceptanceHint?: unknown; acceptanceCriteria?: unknown }
>(tasks: T[]): { tasks: T[]; repaired: string[] } {
  if (!Array.isArray(tasks) || tasks.length < 2) return { tasks, repaired: [] };
  const original = [...tasks];
  let list = [...tasks];
  const repaired: string[] = [];

  // Pass 1：被引用的是更靠后的 acquire → 前移 acquire（安全方向）
  for (let guard = 0; guard < list.length; guard += 1) {
    let moved = false;
    for (let i = 0; i < list.length && !moved; i += 1) {
      const desc = String(list[i]?.description || '');
      const refs = [...desc.matchAll(/任务\s*(\d+)/g)];
      for (const ref of refs) {
        const j = Number(ref[1]) - 1;
        if (!Number.isFinite(j) || j <= i || j >= list.length) continue;
        if (String(list[j]?.type || '').trim() !== 'acquire') continue;
        const [item] = list.splice(j, 1);
        list.splice(i, 0, item);
        repaired.push(`move-acquire:${String(item?.title || '')}`);
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  if (repaired.length > 0) {
    list = remapStageTaskReferences(original, list);
  }

  // Pass 2：剩余前向「任务 N」改成标题引用（标题不随重排变化）
  const afterMove = list;
  list = afterMove.map((task, index) => {
    const desc = String(task?.description || '');
    if (!desc) return task;
    const next = desc.replace(/任务\s*(\d+)/g, (match, digits: string) => {
      const j = Number(digits) - 1;
      if (!Number.isFinite(j) || j <= index || j >= afterMove.length) return match;
      const title = String(afterMove[j]?.title || '').trim();
      if (!title) return match;
      repaired.push(`rewrite-forward:${String(task?.title || '')}->${title}`);
      return `「${title}」`;
    });
    return next === desc ? task : ({ ...task, description: next } as T);
  });
  return { tasks: list, repaired };
}
