import { Router } from 'express';
import apiConfigService from '../../services/apiConfig.service';
import { getAPIGateway } from '../../gateway/api-gateway';

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
        defaultTemperature: config.defaultTemperature ?? 0.7,
        defaultMaxTokens: config.defaultMaxTokens ?? 2048,
        reasoningEndpoint: config.reasoningEndpoint,
        lightEndpoint: config.lightEndpoint,
        chatModels: config.chatModels || [],
        reasoningModels: config.reasoningModels || [],
        lightModels: config.lightModels || [],
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
    const { 
      apiUrl, 
      apiKey, 
      availableModels, 
      defaultModel, 
      defaultReasoningModel, 
      defaultEvaluationModel,
      defaultTemperature,
      defaultMaxTokens,
      reasoningEndpoint,
      lightEndpoint,
      chatModels,
      reasoningModels,
      lightModels
    } = req.body;

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
      defaultEvaluationModel,
      defaultTemperature: defaultTemperature ?? currentConfig.defaultTemperature,
      defaultMaxTokens: defaultMaxTokens ?? currentConfig.defaultMaxTokens,
      reasoningEndpoint,
      lightEndpoint,
      chatModels: chatModels || currentConfig.chatModels,
      reasoningModels: reasoningModels || currentConfig.reasoningModels,
      lightModels: lightModels || currentConfig.lightModels
    });

    getAPIGateway().invalidateCache();

    res.json({
      success: true,
      data: {
        apiUrl: updatedConfig.apiUrl,
        apiKey: updatedConfig.apiKey ? '***已配置***' : '未配置',
        apiKeyConfigured: Boolean(updatedConfig.apiKey),
        availableModels: updatedConfig.availableModels,
        defaultModel: updatedConfig.defaultModel,
        defaultReasoningModel: updatedConfig.defaultReasoningModel,
        defaultEvaluationModel: updatedConfig.defaultEvaluationModel,
        defaultTemperature: updatedConfig.defaultTemperature,
        defaultMaxTokens: updatedConfig.defaultMaxTokens,
        reasoningEndpoint: updatedConfig.reasoningEndpoint,
        lightEndpoint: updatedConfig.lightEndpoint,
        chatModels: updatedConfig.chatModels,
        reasoningModels: updatedConfig.reasoningModels,
        lightModels: updatedConfig.lightModels
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
    getAPIGateway().invalidateCache();
    
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
