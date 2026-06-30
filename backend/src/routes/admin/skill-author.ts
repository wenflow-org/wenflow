/**
 * Admin · Skill Author 路由 (V3.5)
 * ============================================================
 * 提供 Prompt-AI 起草 + Skill Compiler 单轮编译验收两个能力。
 */

import { Router, Request, Response } from 'express';
import {
  draftSkillPrompt,
  compileSkill,
  __META_RULES_VERSION__,
} from '../../services/skill-author';

const router = Router();

// ============================================================
// GET /api/admin/skill-author/meta
// 元规则版本 + 平台限制信息（前端展示用）
// ============================================================
router.get('/meta', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      metaRulesVersion: __META_RULES_VERSION__,
      adminAllowedPromptRoles: ['soft-info', 'hidden-inference', 'derived-presentation'],
      defaultTestUserPrompt: '请按 system prompt 的要求输出 JSON。',
      hint: '元规则模板写死在 backend/src/services/skill-author/index.ts，admin 不可修改。',
    },
  });
});

// ============================================================
// POST /api/admin/skill-author/draft
// Body:
//   {
//     skillId, displayName, description,
//     requiredFields: [{ fieldId, valueType, description?, enumValues? }],
//     sampleInput?, authorNote?
//   }
// ============================================================
router.post('/draft', async (req: Request, res: Response) => {
  const body = req.body || {};
  const skillId = String(body.skillId || '').trim();
  const displayName = String(body.displayName || '').trim();
  const description = String(body.description || '').trim();
  const requiredFields = Array.isArray(body.requiredFields) ? body.requiredFields : [];

  if (!skillId || !displayName) {
    return res
      .status(400)
      .json({ success: false, error: { message: 'skillId / displayName 必填' } });
  }
  if (!requiredFields.length) {
    return res.status(400).json({
      success: false,
      error: { message: 'requiredFields 至少需要 1 个，否则 prompt-AI 无从起草' },
    });
  }

  // 校验字段格式
  for (const f of requiredFields) {
    if (!f || typeof f !== 'object' || !f.fieldId || !f.valueType) {
      return res.status(400).json({
        success: false,
        error: { message: 'requiredFields 每项需要 fieldId 与 valueType' },
      });
    }
  }

  try {
    const result = await draftSkillPrompt({
      skillId,
      displayName,
      description: description || displayName,
      requiredFields,
      sampleInput: body.sampleInput && typeof body.sampleInput === 'object' ? body.sampleInput : undefined,
      authorNote: typeof body.authorNote === 'string' ? body.authorNote : undefined,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: (err as Error).message || 'AI 起草失败' },
    });
  }
});

// ============================================================
// POST /api/admin/skill-author/compile
// Body:
//   {
//     systemPrompt, requiredFieldIds: string[], testUserPrompt,
//     modelOverride?, temperatureOverride?, maxTokensOverride?
//   }
// ============================================================
router.post('/compile', async (req: Request, res: Response) => {
  const body = req.body || {};
  const systemPrompt = String(body.systemPrompt || '');
  const requiredFieldIds = Array.isArray(body.requiredFieldIds)
    ? body.requiredFieldIds.map((s: any) => String(s)).filter(Boolean)
    : [];
  const testUserPrompt = typeof body.testUserPrompt === 'string'
    ? body.testUserPrompt
    : '请按 system prompt 的要求输出 JSON。';

  if (!systemPrompt.trim()) {
    return res
      .status(400)
      .json({ success: false, error: { message: 'systemPrompt 必填' } });
  }

  try {
    const result = await compileSkill({
      systemPrompt,
      requiredFieldIds,
      testUserPrompt,
      modelOverride: typeof body.modelOverride === 'string' ? body.modelOverride : undefined,
      temperatureOverride:
        typeof body.temperatureOverride === 'number' ? body.temperatureOverride : undefined,
      maxTokensOverride:
        typeof body.maxTokensOverride === 'number' ? body.maxTokensOverride : undefined,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { message: (err as Error).message || '编译失败' },
    });
  }
});

export default router;
