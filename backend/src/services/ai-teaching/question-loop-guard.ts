/**
 * 已答不推进守卫（修复批 19-①，F_LOOP u17 批 R critical 可复算杠杆）：
 * 病历单形态——学员已答对「失效策略是主因」后，教师对同一追问（「最先该动的是哪个机制？」）
 * 原样重复，学员开始自我怀疑（「是不是我没理解对」）。
 * 判定：上一条教师回复里存在问句 + 学员随后给出了实质性作答（归一 ≥6 字非问句）+
 * 本轮回复又包含**同一问句**（归一后整句包含）→ 判「已答不推进」。
 * 引擎据此带修复指令重调一次（先反馈作答再推进），复检仍犯→打遥测放行。
 */
const QUESTION_SENTENCE_SPLIT = /(?<=[。！？?!])\s*/;
const normAnswerText = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export interface RepeatedQuestionCheckInput {
  /** 上一条教师回复（紧邻学员作答之前的那轮） */
  priorTeacherReply: string | null | undefined;
  /** 学员对本问的作答（本轮用户消息） */
  learnerReply: string | null | undefined;
  /** 本轮教师新回复 */
  currentReply: string | null | undefined;
}

export function findRepeatedQuestionAfterAnswer(
  input: RepeatedQuestionCheckInput,
): { repeated: string } | null {
  const prior = String(input?.priorTeacherReply ?? '');
  const learnerNorm = normAnswerText(input?.learnerReply);
  const current = String(input?.currentReply ?? '');
  if (!prior || !current) return null;
  // 学员作答必须实质性（≥6 归一字、非反问）——短确认/追问不算「已答」
  if (learnerNorm.length < 6 || /[?？]/.test(String(input?.learnerReply ?? ''))) return null;

  const questions = prior
    .split(QUESTION_SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[?？]\s*$/.test(sentence) || (sentence.includes('？') && sentence.length <= 80));
  for (const question of questions) {
    const norm = normAnswerText(question);
    if (norm.length < 8) continue;
    if (!current.includes(question.trim())) continue;
    // 学员确实作了答 → 同一问句原样重复即「已答不推进」
    return { repeated: question.trim().slice(0, 120) };
  }
  return null;
}
