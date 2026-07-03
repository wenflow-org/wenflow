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
        connectionStatus: platformDefault.connectionStatus,
        lastCheckedAt: platformDefault.lastCheckedAt
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

router.post('/test-model', async (req, res) => {
  try {
    const {
      apiUrl,
      apiKey,
      model,
      prompt,
      temperature,
      maxTokens
    } = req.body || {};

    const currentConfig = await apiConfigService.getConfig();
    const resolvedUrl = String(apiUrl || currentConfig.apiUrl || '').trim();
    const resolvedKey = String(apiKey || currentConfig.apiKey || '').trim();
    const resolvedModel = String(model || currentConfig.defaultModel || '').trim();
    const resolvedPrompt = String(prompt || '请用一句中文确认模型测试成功。').trim();

    if (!resolvedUrl || !resolvedKey || !resolvedModel) {
      return res.status(400).json({
        success: false,
        error: '服务地址、API Key 或测试模型未配置'
      });
    }

    const normalizedBase = resolvedUrl.replace(/\/$/, '');
    const endpoint = normalizedBase.endsWith('/v1')
      ? `${normalizedBase}/chat/completions`
      : `${normalizedBase}/v1/chat/completions`;

    const startedAt = Date.now();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resolvedKey}`,
      },
      body: JSON.stringify({
        model: resolvedModel,
        temperature: typeof temperature === 'number' ? temperature : currentConfig.defaultTemperature ?? 0.2,
        max_tokens: typeof maxTokens === 'number' ? maxTokens : currentConfig.defaultMaxTokens ?? 256,
        messages: [
          { role: 'system', content: '你是 API 模型连通性测试助手。请简洁返回。' },
          { role: 'user', content: resolvedPrompt }
        ]
      })
    });

    const durationMs = Date.now() - startedAt;
    const payload: any = await response.json().catch(() => null);

    if (!response.ok) {
      return res.status(400).json({
        success: false,
        error: payload?.error?.message || `HTTP ${response.status}: ${response.statusText}`,
        data: {
          model: resolvedModel,
          durationMs,
        }
      });
    }

    const content = payload?.choices?.[0]?.message?.content || '';
    return res.json({
      success: true,
      data: {
        model: payload?.model || resolvedModel,
        durationMs,
        content,
        usage: payload?.usage || null,
        raw: payload,
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || '模型测试失败'
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
