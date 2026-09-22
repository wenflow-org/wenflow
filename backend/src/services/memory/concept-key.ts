/**
 * 概念键机械归一化（纯函数，从 memory-trace.service 抽出以便共享）。
 *
 * 为什么单独成模块：`ConceptRegistryService` 需要与 `memory_traces` **完全同口径**的归一化，
 * 而 memory-trace.service 又要调用注册表解析 conceptId —— 留在原处会形成循环依赖。
 * 按本仓既定模式（纯函数迁移 + 原文件 re-export），抽出后由 `memory-trace.service` 继续导出，
 * 既有 import 路径零改动。
 *
 * 规则（幂等）：压缩空白 → 去引号 → 去冒号后的解释性从句 → 去尾部标点。
 * 边界：这是**文本清洗，不是身份解析**——语义近义（"回来后第一眼交给书" vs
 * "回来后第一眼第一手交给已翻开的书"）只有 LLM 能做，留给 ConceptConsolidatorService 的建议。
 */
export function normalizeConceptKey(raw: unknown): string {
  const original = String(raw ?? '').trim();
  if (!original) return '';
  let s = original.replace(/\s+/g, ' ');
  // 引号只是强调：去掉才能合并「靠「动作先发生」取胜」与「靠动作先发生取胜」
  s = s.replace(/[「」『』"'“”‘’]/g, '');
  // 冒号后多为模型的解释性从句（主体至少 4 字才截），只保留冒号前的主体
  const colon = s.search(/[：:]/);
  if (colon >= 4) s = s.slice(0, colon);
  // 去尾部标点/破折号
  s = s.replace(/[。．.，,、；;！!？?~～\-—…\s]+$/g, '');
  return s.trim() || original;
}
