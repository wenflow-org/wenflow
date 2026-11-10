/**
 * 检查点共享常量与解析（AITeachingCoordinator/teaching-checkpoint 共用，避免循环依赖）
 */
import { createHash } from 'crypto';

export const CHECKPOINT_MIN_TURNS = 4;
/** 触发检查点所需"上一轮确有进展"的理解度门槛 */
export const CHECKPOINT_TRIGGER_MIN_UNDERSTANDING = 0.6;
/**
 * 低理解度出题节奏下限（拍板 #10，2026-10-08 出题时机与自评解耦）：理解度 <0.6 的课堂
 * 恰是此前 0.6 硬闸造成的测量盲区（候选率 0.71% vs 52.3%，幸存者偏差实锤）——
 * 低理解度时把最小间隔缩到 2 条消息（优先探测），理解度只调节奏、不再否决出题。
 */
export const CHECKPOINT_LOW_UNDERSTANDING_MIN_TURNS = 2;

/**
 * 「不可观测」与「低理解度」是两件事（2026-11-01 走查修复）。
 *
 * 背景（用户走查原话：「课堂当中，为什么一句话两句话就测试呢」）：模型在**没有可引用证据**时
 * 被旧规则要求「understanding 取低值」，于是「观测不到」被写成了一个低数字；下游确定性闸门
 * 只认数字——`checkpointRhythmMinTurns(0.2)` 把出题间隔压到 2 条消息，学生刚说一两句就被测。
 * **根因是把「没有读数」与「读数是低」混为一谈**。
 *
 * 本函数把理解度读数统一解析为 `number | null`：只有一个**真正有限**的数才算读数；
 * null / undefined / 空串 / 非数值一律解析为 `null`（无读数），由消费方按「不加速、不否决」处理。
 */
export function resolveUnderstandingReading(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * 按上一轮理解度读数给出出题节奏下限（提示词闸与 engine 事后门共用同一分档，
 * 防两处数值漂移）。
 *
 * - 有读数且 <0.6：缩到 2 条消息优先探测（拍板 #10，见 `CHECKPOINT_LOW_UNDERSTANDING_MIN_TURNS`）；
 * - 有读数且 ≥0.6：4 条消息常规节奏；
 * - **无读数（null）：回常规节奏**——「观测不到」不得被当成「理解度低」而加速出题
 *   （2026-11-01 修复点：旧实现 `Number(null)` 得 0 且有限，一个没读数的回合会把节奏压到 2，
 *   正是「一两句就测试」的确定性成因之一）。
 */
export function checkpointRhythmMinTurns(understanding: unknown): number {
  const value = resolveUnderstandingReading(understanding);
  if (value === null) return CHECKPOINT_MIN_TURNS;
  return value < CHECKPOINT_TRIGGER_MIN_UNDERSTANDING
    ? CHECKPOINT_LOW_UNDERSTANDING_MIN_TURNS
    : CHECKPOINT_MIN_TURNS;
}

/**
 * 「卡点」的硬口径：有原话证据支撑的困惑点数量（2026-11-01 走查修复）。
 *
 * 课堂里有两条困惑通道，硬度完全不同：
 * - `analysis.confusionPoints`：**软通道**——模型可自由给出、无证据要求（实测 51.9% 的回合都有），
 *   直接当「学生卡住了」用，会把每轮老师都说成在挖卡点，也把阶段机频繁推进到 intervention；
 * - `analysis.misconceptions`：**硬通道**——`evidence` 必须能在学生本轮原话里逐字定位
 *   （`skills/teaching-turn` 的 `normalizeMisconceptions` 逐条核对，定位不到整条丢弃，实测 19.6%）。
 *
 * 学生可见的「发现卡点」chip 与「干预」阶段判定都改用本口径；软通道仍保留在分析里供遥测/复盘，
 * 只是不再单独驱动学生可见结论。
 */
export function countEvidencedConfusions(analysis: unknown): number {
  const list = (analysis as { misconceptions?: unknown })?.misconceptions;
  if (!Array.isArray(list)) return 0;
  return list.reduce((count, item) => {
    const evidence = (item as { evidence?: unknown })?.evidence;
    return typeof evidence === 'string' && evidence.trim() ? count + 1 : count;
  }, 0);
}
/**
 * 同一检查点重答上限（2026-10-03 完结课堂裸审计 P1 实证）：同一道题被逐轮原样重发，最极端
 * 36 次/节、50/60 节课中招，学员每次照合同答同一选项——「答错保留 pendingCheckpoint」缺上限，
 * 课堂在同一个确认点上空转直到 LEARN_AUTO_TURN_CAP=40 才停。达到该次数仍未通过即强制消费
 * pendingCheckpoint（老师可换题/推进），不再原地循环。
 */
export const CHECKPOINT_MAX_ATTEMPTS = 2;

export function parseSessionArtifacts(teachingState: Record<string, any> | null | undefined) {
  return teachingState?.sessionArtifacts || {};
}

/* ────────────────────────── 概念归属（F1 修复轮 a，2026-10-06） ──────────────────────────
 * R1 finding A2 / R2 判定#8：checkpoint 的 learner_evidence payload 不带 conceptKey/conceptId
 * （R1 H2 全库 0/5955）——失败证据不知道自己是哪个概念的，掌握聚合与跨课归位全部失锚；
 * 失败还被路由到路径骨架的 concept-N 序列占位（R2 复现 3 行 + misconception_ledger 8 行证据）。
 * 本组纯函数是「当前教学点 → 概念归属」的唯一定义点：无模型键时按点名字派生确定性键
 * （同名跨课同键），标注 source='derived'；确实无点名 → null（宁缺勿挂占位键）。
 */

/** 路径生成骨架的 concept-N 序列占位形态（唯一定义点已迁到 memory/concept-key，registry 侧同用） */
export { isPlaceholderConceptKey } from '../memory/concept-key';

/** 概念名归一（键派生口径）：剔除全部空白 + 小写，同名异写派生同键 */
export function normalizeConceptName(name: unknown): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 简答要点包含判定的归一口径（**唯一来源**）：小写、去空白与常见标点。
 * 判分侧（teaching-checkpoint.ts#judgeCheckpointAnswer）与答案泄漏检测
 * （teaching-turn/index.ts#filterAnswerLeakingKeywords）必须共用本函数——
 * 两边口径一旦漂移，泄漏检测就会误杀合法要点或漏掉真泄漏。
 */
export function normalizeForKeywordMatch(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s，。、；：！？,.;:!?（）()【】[\]"'“”‘’—-]/g, '');
}

/**
 * 确定性概念键：`cpt_` + sha256(归一名) 前 16 位。无随机会话成分，纯函数可复算——
 * 同一概念名字跨课/跨会话得到同一键，失败证据因此跨课可归位（R2 判定#8 的另一半）。
 */
export function deriveConceptKeyFromName(name: unknown): string {
  return `cpt_${createHash('sha256').update(normalizeConceptName(name)).digest('hex').slice(0, 16)}`;
}

/** 检查点概念归属（pendingCheckpoint 与两类证据写入共用形状） */
export interface CheckpointConceptAttribution {
  /** 概念名 = 当前教学点名（看板/键表用名字对齐） */
  conceptName: string;
  /** 确定性派生键（模型输出无键时由代码派生） */
  conceptKey: string;
  /** 归属来源：derived = 由当前教学点名字确定性派生 */
  conceptSource: 'derived';
}

/** 当前教学点名 → 概念归属；无点名返回 null（无键场景不得落占位键） */
export function resolveCheckpointConceptAttribution(
  currentPointName: unknown,
): CheckpointConceptAttribution | null {
  const name = typeof currentPointName === 'string' ? currentPointName.trim() : '';
  if (!name) return null;
  return {
    conceptName: name,
    conceptKey: deriveConceptKeyFromName(name),
    conceptSource: 'derived',
  };
}
