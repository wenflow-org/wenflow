import { Router } from 'express';
import {
  AVAILABLE_MODELS,
  MODELS_BY_TIER,
  getProviderCatalog,
  getModelDefaults,
  reloadLlmProvidersIfChanged
} from '../config/models.config';

const router = Router();

/**
 * GET /api/config/available-models
 * 获取所有可用的模型列表（含供应商维度）。
 *
 * 目录来自 File-as-Truth（config/llm-providers.json，经 models.config 加载，支持热重载）；
 * models 条目自带 providerId/providerName/providerEndpoint，前端选择器按供应商分组。
 * providers 仅返回 enabled 的条目（示例/停用条目走管理端 model-registry 总览）。
 */
router.get('/available-models', (req, res) => {
  // 读路径同样触发热重载检查：改完 llm-providers.json 刷新选择器即可见，无需等下一次 LLM 调用
  reloadLlmProvidersIfChanged();
  const providers = getProviderCatalog()
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      recommended: p.recommended,
      endpointSource: p.endpointSource,
      baseUrl: p.baseUrl ?? null,
      apiKeyEnv: p.apiKeyEnv ?? null,
      /** 继承通道无自有密钥（null）；自带端点的供应商返回 env 是否已配置 */
      keyConfigured: p.apiKeyEnv ? Boolean((process.env[p.apiKeyEnv] || '').trim()) : null,
      modelIds: p.models.map((m) => m.id)
    }));
  res.json({
    success: true,
    data: {
      models: AVAILABLE_MODELS,
      providers,
      defaults: getModelDefaults(),
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
    data: AVAILABLE_MODELS.map((m) => m.id)
  });
});

export default router;
