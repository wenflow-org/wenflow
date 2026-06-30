import { Router } from 'express';
import { AVAILABLE_MODELS, DEFAULT_MODELS, MODELS_BY_TIER } from '../config/models.config';

const router = Router();

/**
 * GET /api/config/available-models
 * 获取所有可用的模型列表
 */
router.get('/available-models', (req, res) => {
  res.json({
    success: true,
    data: {
      models: AVAILABLE_MODELS,
      defaults: DEFAULT_MODELS,
      byTier: {
        chat: MODELS_BY_TIER.chat,
        reasoning: MODELS_BY_TIER.reasoning
      }
    }
  });
});

/**
 * GET /api/config/model-ids
 * 获取所有模型 ID（用于验证）
 */
router.get('/model-ids', (req, res) => {
  res.json({
    success: true,
    data: AVAILABLE_MODELS.map(m => m.id)
  });
});

export default router;
