/**
 * 拟真人设身份锚定（确定性护栏，2026-11-13 20 用户批量跑数实证）。
 *
 * 问题：`simulation-persona-designer` 在 temperature 0.8 + 「避免与最近样本重复职业」
 * 的牵引下，会无视 `existingPersonaSeed` 的身份，给「签劳动合同的产品经理」生成
 * 「社区网格员」、给「看财报的运营」生成「高中语文老师」。提示词里虽有
 * 「优先保留 existingPersonaSeed 的长期底色」，但 5/5 并发样本全部漂移——这类
 * 硬约束不能只靠提示词。
 *
 * 做法：**只锚身份字段**（nameHint / age / occupation / education / background），
 * 行为字段（emotionalTriggers / failurePatterns / availableTime / 认知负荷等）保持
 * 模型生成，因为摩擦与行为模式仍有价值。seed 没给的字段不动，避免把增量增强变成覆盖。
 */

export interface PersonaIdentityDrift {
  field: string;
  expected: string;
  actual: string;
}

export interface AnchorPersonaIdentityResult {
  personaSeed: Record<string, unknown>;
  drift: PersonaIdentityDrift[];
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * 用 seed 里的身份字段覆盖生成人设中的同名/同义字段。
 *
 * 兼容两类 seed：
 * - 跑数/管理端创建：「role + scenario + background」；
 * - 画像增强：完整 profile（可能已有 occupation/education/age）。
 * 生成 schema 用 `occupation`，seed 常用 `role`，两者都认。
 */
export function anchorPersonaIdentity(
  generated: unknown,
  existingSeed: unknown,
): AnchorPersonaIdentityResult {
  const persona = { ...(asRecord(generated) || {}) };
  const seed = asRecord(existingSeed);
  if (!seed) return { personaSeed: persona, drift: [] };

  const drift: PersonaIdentityDrift[] = [];
  const anchor = (generatedKey: string, value: string, label: string): void => {
    if (!value) return;
    const current = asText(persona[generatedKey]);
    if (current && current !== value) {
      drift.push({ field: label, expected: value, actual: current });
    }
    persona[generatedKey] = value;
  };

  anchor('nameHint', asText(seed.nameHint), 'nameHint');
  anchor('occupation', asText(seed.occupation) || asText(seed.role), 'occupation');
  anchor('education', asText(seed.education), 'education');

  // background 只锚「seed 明确给出长期背景」的情况；跑数 seed 的 background 常是触发事件，
  // 与 role 拼成一句仍然比无关生活史（烘焙/民宿）更可信。seed 没给则保留模型生成。
  const seedBackground = asText(seed.background);
  const seedRole = asText(seed.occupation) || asText(seed.role);
  if (seedBackground) {
    const anchoredBackground = seedRole && !seedBackground.includes(seedRole)
      ? `${seedRole}。${seedBackground}`
      : seedBackground;
    anchor('background', anchoredBackground, 'background');
  }

  // age 是数字，单独处理（不要被空串覆盖）
  if (typeof seed.age === 'number' && Number.isFinite(seed.age)) {
    const current = typeof persona.age === 'number' ? persona.age : null;
    if (current !== null && current !== seed.age) {
      drift.push({ field: 'age', expected: String(seed.age), actual: String(current) });
    }
    persona.age = seed.age;
  }

  return { personaSeed: persona, drift };
}
