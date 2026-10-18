/**
 * 路径级课时诚实声明与交付对账（#55 / P-30，2026-10-18）
 *
 * 实证（`scripts/audit-delivery-ratio.ts` 全库 223 条路径）：守恒层给出的计划 `bc.after`
 * 与阶段任务实际排出的课时是两回事——CPA 240h 锚：计划 127.5h、实际 62.1h。阶段级
 * `buildStageFillNote` 只覆盖「某阶段低于自身锚 70%」，且阈值以上（如 86%）的缩水不声明；
 * 路径级此前只有「超出容量」（`【时间预算提示】`）一个方向，**少交付这个方向完全静默**。
 *
 * 本模块补的正是这一跳：整条路径实际交付 < 计划 70% 时，向 `learning_paths.description`
 * 追加一句面向学习者的说明（幂等，不覆盖原有描述），并把实际交付落进
 * `aiPromptTemplate.budgetConservation.delivery` 供审计脚本区分「已声明缩水」与「静默缺陷」。
 */

/** 路径级欠交付阈值：实际/计划低于此比例即声明（与阶段级同阈值，便于口径对齐） */
export const PATH_FILL_DECLARE_RATIO = 0.7;

/** 路径级说明的幂等标记（与阶段级「时间说明/容量说明」区分，便于审计分别识别） */
export const PATH_FILL_NOTE_MARKER = '【课时说明】';

export interface PathFillNoteInput {
  /** 守恒层计划（`budgetConservation.after`，小时）；无锚时不声明 */
  plannedHours: number | null | undefined;
  /** 阶段任务分钟汇总换算的小时（回写后的路径学时） */
  deliveredHours: number | null | undefined;
  /** 既有路径描述：用于幂等判断，不参与文案计算 */
  existingDescription?: string | null;
}

/**
 * 学时展示：≥10 小时取整（128 不写成 127.5）；<10 小时保留一位小数。
 * 小数值路径（如计划 1.4h / 交付 0.9h）若取整会读成「约 1 小时…约 1 小时」，
 * 声明自身失去信息量。
 */
function formatHours(value: number): string {
  if (value >= 10) return String(Math.round(value));
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return '不足 0.1';
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * 生成路径级课时说明；无需声明时返回 `null`（调用方据此不写库）。
 * 返回的是**一段独立文案**，由调用方决定如何拼接进 description。
 */
export function buildPathFillNote(input: PathFillNoteInput): string | null {
  const planned = Number(input.plannedHours);
  const delivered = Number(input.deliveredHours);
  if (!Number.isFinite(planned) || planned <= 0) return null;
  if (!Number.isFinite(delivered) || delivered <= 0) return null;
  // 幂等：重生成/追加模式下路径描述可能已带路径级声明
  if (input.existingDescription && input.existingDescription.includes(PATH_FILL_NOTE_MARKER)) return null;
  if (delivered >= planned * PATH_FILL_DECLARE_RATIO) return null;
  const percent = Math.max(1, Math.round((delivered / planned) * 100));
  return `${PATH_FILL_NOTE_MARKER}按你的时间预算，这条路径计划安排约 ${formatHours(planned)} 小时的课程；`
    + `目前已拆出的学习任务合计约 ${formatHours(delivered)} 小时（约 ${percent}%）。`
    + `现有任务的安排不受影响；如果想让后面的阶段更充分，可以在学习过程中告诉我，我会再补充任务。`;
}

/** 把一段声明追加到既有描述后面；描述或声明为空时返回 `null`（调用方不写库） */
export function appendDescriptionNote(
  existingDescription: string | null | undefined,
  note: string | null | undefined,
): string | null {
  const text = typeof note === 'string' ? note.trim() : '';
  if (!text) return null;
  const existing = typeof existingDescription === 'string' ? existingDescription : '';
  return existing ? `${existing}\n\n${text}` : text;
}

export interface DeliveryReconciliationInput {
  /** `budgetConservation`（未知结构安全读取）；非对象时返回 null */
  conservation: unknown;
  deliveredHours: number;
  /**
   * 本次声明的层级：path=路径级课时说明、stage=仅阶段级时间/容量说明、none=静默。
   * 审计据 `delivery.declaration` 把真缺口分成已声明/静默，不能用一个布尔把两级压平。
   */
  declaration: DeliveryDeclaration;
  /** 供测试注入；默认取当前时间 */
  now?: Date;
}

export type DeliveryDeclaration = 'path' | 'stage' | 'none';

/**
 * 把实际交付追加进守恒层对象（保留 target/after/capacitySum 等原始字段）。
 * 返回可直接写回 `aiPromptTemplate.budgetConservation` 的对象；不可读时返回 `null`。
 */
export function reconcileDeliveryConservation(
  input: DeliveryReconciliationInput,
): Record<string, unknown> | null {
  const source = input.conservation;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const conservation = source as Record<string, unknown>;
  const delivered = Number(input.deliveredHours);
  if (!Number.isFinite(delivered) || delivered < 0) return null;
  const planned = Number(conservation.after);
  const round3 = (value: number): number => Number(value.toFixed(3));
  const declaration: DeliveryDeclaration = input.declaration === 'path' || input.declaration === 'stage'
    ? input.declaration
    : 'none';
  return {
    ...conservation,
    delivery: {
      hours: round3(delivered),
      vsPlanned: Number.isFinite(planned) && planned > 0 ? round3(delivered / planned) : null,
      declaration,
      declared: declaration !== 'none',
      recordedAt: (input.now ?? new Date()).toISOString(),
    },
  };
}
