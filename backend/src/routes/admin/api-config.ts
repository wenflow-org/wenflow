import { Router } from 'express';
import apiConfigService from '../../services/apiConfig.service';

const router = Router();

router.get('/', (req, res) => {
  const config = apiConfigService.getConfig();
  res.json({
    success: true,
    data: {
      baseURL: config.baseURL,
      apiKey: config.apiKey ? '***已配置***' : '未配置',
      apiKeyConfigured: Boolean(config.apiKey),
      models: config.models,
      defaultModel: config.defaultModel,
      defaultReasoningModel: config.defaultReasoningModel,
      defaultJudgeModel: config.defaultJudgeModel
    }
  });
});

router.put('/', (req, res) => {
  const { baseURL, apiKey, models, defaultModel, defaultReasoningModel, defaultJudgeModel } = req.body;

  const currentConfig = apiConfigService.getConfig();
  const resolvedApiKey = typeof apiKey === 'string' && apiKey.trim().length > 0
    ? apiKey.trim()
    : currentConfig.apiKey;

  const updatedConfig = apiConfigService.updateConfig({
    baseURL,
    apiKey: resolvedApiKey,
    models: Array.isArray(models)
      ? models
      : typeof models === 'string'
        ? models.split(',').map((m: string) => m.trim()).filter(Boolean)
        : undefined,
    defaultModel,
    defaultReasoningModel,
    defaultJudgeModel
  });

  res.json({
    success: true,
    data: {
      baseURL: updatedConfig.baseURL,
      apiKey: updatedConfig.apiKey ? '***已配置***' : '未配置',
      apiKeyConfigured: Boolean(updatedConfig.apiKey),
      models: updatedConfig.models,
      defaultModel: updatedConfig.defaultModel,
      defaultReasoningModel: updatedConfig.defaultReasoningModel,
      defaultJudgeModel: updatedConfig.defaultJudgeModel
    }
  });
});

router.post('/test', async (req, res) => {
  const { baseURL, apiKey } = req.body;
  const currentConfig = apiConfigService.getConfig();
  const resolvedApiKey = typeof apiKey === 'string' && apiKey.trim().length > 0
    ? apiKey.trim()
    : currentConfig.apiKey;

  try {
    if (!resolvedApiKey) {
      return res.status(400).json({
        success: false,
        error: '未配置 API Key，请先保存配置'
      });
    }

    const response = await fetch(`${baseURL}/v1/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`
      }
    });

    if (!response.ok) {
      return res.status(400).json({
        success: false,
        error: `API 连接失败: ${response.status} ${response.statusText}`
      });
    }

    const data = await response.json() as { data?: Array<{ id: string }> };
    res.json({
      success: true,
      data: {
        connected: true,
        modelsCount: data.data?.length || 0,
        models: data.data?.map(model => model.id) || []
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || '测试 API 连接失败'
    });
  }
});

export default router;
