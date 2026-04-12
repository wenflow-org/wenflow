import { Router } from 'express';
import apiConfigService from '../../services/apiConfig.service';
import { refreshOpenAIClient } from '../../gateway/openai-client';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const config = await apiConfigService.getConfig();
    const platformDefault = await apiConfigService.getPlatformDefault();
    
    res.json({
      success: true,
      data: {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey ? '***已配置***' : '未配置',
        apiKeyConfigured: Boolean(config.apiKey),
        availableModels: config.availableModels,
        defaultModel: config.defaultModel,
        defaultReasoningModel: config.defaultReasoningModel,
        defaultEvaluationModel: config.defaultEvaluationModel,
        connectionStatus: platformDefault.connectionStatus
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || '获取配置失败'
    });
  }
});

router.put('/', async (req, res) => {
  try {
    const { apiUrl, apiKey, availableModels, defaultModel, defaultReasoningModel, defaultEvaluationModel } = req.body;

    const currentConfig = await apiConfigService.getConfig();
    const resolvedApiKey = typeof apiKey === 'string' && apiKey.trim().length > 0
      ? apiKey.trim()
      : currentConfig.apiKey;

    const modelsArray = Array.isArray(availableModels)
      ? availableModels
      : typeof availableModels === 'string'
        ? availableModels.split(',').map((m: string) => m.trim()).filter(Boolean)
        : currentConfig.availableModels;

    const updatedConfig = await apiConfigService.updateConfig({
      apiUrl,
      apiKey: resolvedApiKey,
      availableModels: modelsArray,
      defaultModel,
      defaultReasoningModel,
      defaultEvaluationModel
    });

    // 刷新 OpenAI 客户端，使新配置立即生效
    await refreshOpenAIClient();

    res.json({
      success: true,
      data: {
        apiUrl: updatedConfig.apiUrl,
        apiKey: updatedConfig.apiKey ? '***已配置***' : '未配置',
        apiKeyConfigured: Boolean(updatedConfig.apiKey),
        availableModels: updatedConfig.availableModels,
        defaultModel: updatedConfig.defaultModel,
        defaultReasoningModel: updatedConfig.defaultReasoningModel,
        defaultEvaluationModel: updatedConfig.defaultEvaluationModel
      },
      message: '配置已保存并生效'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || '保存配置失败'
    });
  }
});

router.post('/test', async (req, res) => {
  try {
    const { apiUrl, apiKey } = req.body;
    
    const result = await apiConfigService.testConnection(apiUrl, apiKey);
    
    if (result.success) {
      res.json({
        success: true,
        data: {
          connected: true,
          modelsCount: result.modelsCount || 0,
          models: result.models || []
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || '连接失败'
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || '测试 API 连接失败'
    });
  }
});

router.post('/reset', async (req, res) => {
  try {
    await apiConfigService.resetConfig();
    await refreshOpenAIClient();
    
    res.json({
      success: true,
      message: '配置已重置为默认值'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || '重置配置失败'
    });
  }
});

export default router;