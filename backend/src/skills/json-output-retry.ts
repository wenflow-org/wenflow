/**
 * json 媒介 Skill 的统一重试策略。
 *
 * 现网实测（2026-10-22 跑批）：learner-state-review / lesson-knowledge-enricher /
 * adaptive-guidance-copy 等 skill 没有 retryStrategy，callPrompt 默认 maxAttempts=1，
 * 一次返回散文就整条失败（31 次非 JSON / 23 个 trace）。这里只做一次有界重试，
 * 并把失败原因回灌，避免“重发同样的 prompt 再赌一次”。
 */
export const JSON_OUTPUT_RETRY_STRATEGY = {
  maxAttempts: 2,
  onValidationFail: ({ failureReason }: { failureReason: string }) =>
    `上一次输出不是合法 JSON（${failureReason}）。`
    + '只输出一个 JSON 对象，第一个字符必须是 {，不要任何解释文字、不要 markdown 代码块围栏；'
    + '字段按 system prompt 的契约输出。',
};
