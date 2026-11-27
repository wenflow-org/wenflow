/**
 * 论证/分类课判定（2026-11-27 真课）：这类课的学生产出就是「句子归属」，
 * 板书一摆就是答案——整节课不建板，以纸面材料 + 对话进行。
 *
 * 独立成模块而不是挂在 teaching-visual.service：引擎侧的测试大量 mock 视觉服务，
 * 新导出会让这些 mock 在运行时变成 undefined；判定本身也不依赖视觉服务。
 */
export function isArgumentClassificationTask(input: {
  title?: string | null;
  description?: string | null;
  material?: string | null;
  acceptanceCriteria?: string | null;
}): boolean {
  const text = [input.title, input.description, input.material, input.acceptanceCriteria]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n');
  if (!text) return false;
  const hasArgumentVocab = /(前提|结论|论证|理由|支撑)/.test(text);
  const asksIdentify = /(哪一?句|指出|判断|分清|拆|辨认)/.test(text);
  return hasArgumentVocab && asksIdentify;
}
