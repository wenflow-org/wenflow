export interface AssessmentQuestion {
  question: string;
  type: 'single_choice' | 'multi_choice' | 'short_answer';
  options?: Array<{ id: string; text: string }>;
  correctOptionIds?: string[];
  expectedKeywords?: string[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Shared by generated and persisted exit tickets and retention probes. */
export function parseAssessmentQuestion(raw: unknown): AssessmentQuestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const question = text(item.question);
  const type = item.type;
  if (!question) return null;
  if (type === 'short_answer') {
    if ((Array.isArray(item.options) && item.options.length)
      || (Array.isArray(item.correctOptionIds) && item.correctOptionIds.length)) return null;
    const expectedKeywords = Array.isArray(item.expectedKeywords) ? item.expectedKeywords.map(text) : [];
    if (!expectedKeywords.length || expectedKeywords.length > 3
      || expectedKeywords.some((keyword) => !keyword.split(/[|｜]/).some((part) => /[\p{L}\p{N}]/u.test(part)))) return null;
    return { question, type, expectedKeywords };
  }
  if (type !== 'single_choice' && type !== 'multi_choice') return null;
  if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4) return null;
  const options = item.options.map((option) => ({ id: text(option?.id), text: text(option?.text) }));
  // 判分和作答解析都忽略选项 ID 的大小写。
  const normalizedIds = options.map((option) => option.id.toLowerCase());
  if (options.some((option) => !option.id || !option.text) || normalizedIds.includes('')
    || new Set(normalizedIds).size !== options.length) return null;
  const correctOptionIds = Array.isArray(item.correctOptionIds) ? item.correctOptionIds.map(text) : [];
  const ids = new Set(options.map((option) => option.id));
  if (!correctOptionIds.length || (type === 'single_choice' && correctOptionIds.length !== 1)
    || new Set(correctOptionIds).size !== correctOptionIds.length
    || correctOptionIds.some((id) => !ids.has(id))) return null;
  return { question, type, options, correctOptionIds };
}
