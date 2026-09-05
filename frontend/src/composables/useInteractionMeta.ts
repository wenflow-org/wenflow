/**
 * 交互特征采集（认知负荷量测 · 前端情报层）
 *
 * 采集用户在输入框内的打字节奏统计，随消息提交作为 interactionMeta，
 * 供教学/目标对话侧的 LLM 结合文本语义判断认知负荷（loadIndex）。
 *
 * 原则：
 * - 只算统计、不采集内容：不记录逐键事件与输入内容，全部本地聚合为数值特征
 * - 特征缺失可降级：无 meta 的请求（旧客户端/虚拟学习者）走 absent 路径
 * - 不做阈值判定、不做规则钳制：特征只是喂给 LLM 的"情报"
 */
export interface InteractionMeta {
  /** 从首次输入到发送的总输入时长（ms） */
  draftMs: number;
  /** 上一条 AI 回复落地 → 本轮首次输入的时间间隔（ms，近似思考停顿） */
  idleMsBefore: number;
  /** 输入过程中最大的一次停顿时长（ms，>800ms 的间隙取最大） */
  lastIdleMs: number;
  /** input 事件次数（近似编辑强度） */
  editingCount: number;
  /** 输入内容回退累计字符数（长度变短时累计差值） */
  deleteCount: number;
  /** 每句平均字符数（按 。？！.?! 切分，近似 WPS） */
  charsPerSentence: number;
}

const PAUSE_FLOOR_MS = 800;

export function useInteractionMeta() {
  let firstInputAt: number | null = null;
  let lastInputAt: number | null = null;
  let maxIdleMs = 0;
  let editingCount = 0;
  let prevLength = 0;
  let deleteCount = 0;
  let lastAssistantAt: number | null = null;
  let idleMsBefore = 0;

  /** AI 回复落地时调用，供下一轮 idleMsBefore 计算 */
  function markAssistantLanded(now: number = Date.now()): void {
    lastAssistantAt = now;
  }

  /** 输入事件时调用 */
  function onInput(currentLength: number): void {
    const now = Date.now();
    if (firstInputAt === null) {
      firstInputAt = now;
      idleMsBefore = lastAssistantAt !== null ? Math.max(0, now - lastAssistantAt) : 0;
    }
    if (lastInputAt !== null) {
      const pause = now - lastInputAt;
      if (pause >= PAUSE_FLOOR_MS) maxIdleMs = Math.max(maxIdleMs, pause);
    }
    editingCount += 1;
    if (currentLength < prevLength) deleteCount += prevLength - currentLength;
    prevLength = currentLength;
    lastInputAt = now;
  }

  /** 发送时调用：聚合当前 draft 的特征并重置，供下一轮使用 */
  function collect(text: string): InteractionMeta {
    const trimmed = text.trim();
    const chars = trimmed.length;
    const sentenceCount = Math.max(
      1,
      trimmed.split(/[。？！.!?]/).filter((part) => part.trim().length > 0).length,
    );
    const meta: InteractionMeta = {
      draftMs: lastInputAt !== null && firstInputAt !== null ? Math.max(0, lastInputAt - firstInputAt) : 0,
      idleMsBefore: firstInputAt !== null ? idleMsBefore : 0,
      lastIdleMs: maxIdleMs,
      editingCount,
      deleteCount,
      charsPerSentence: chars > 0 ? Math.round(chars / sentenceCount) : 0,
    };
    reset();
    return meta;
  }

  function reset(): void {
    firstInputAt = null;
    lastInputAt = null;
    maxIdleMs = 0;
    editingCount = 0;
    prevLength = 0;
    deleteCount = 0;
  }

  return { onInput, collect, reset, markAssistantLanded };
}
