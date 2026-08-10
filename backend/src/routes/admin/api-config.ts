import { Router } from 'express';
import apiConfigService from '../../services/apiConfig.service';
import { getAPIGateway } from '../../gateway/api-gateway';
import { safeHttpRequest } from '../../utils/safe-http';
import { z } from 'zod';
import { isIP } from 'net';
import {
  AdminAccessMode,
  getRuntimeNetworkPolicy,
  updateRuntimeNetworkPolicy
} from '../../services/runtime-network-policy.service';
import { aiCapabilityHealthService } from '../../services/ai-capability-health.service';
import { endpointsMatch, resolveEndpointBoundSecret } from '../../utils/endpoint-identity';

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
        lastCheckedAt: platformDefault.lastCheckedAt,
        networkPolicy: getRuntimeNetworkPolicy()
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || '获取配置失败'
    });
  }
});

const networkPolicySchema = z.object({
  adminAccessMode: z.enum(['loopback', 'private', 'any']),
  adminAllowedIps: z.array(
    z.string().trim().refine(value => isIP(value.replace(/^::ffff:/i, '')) !== 0, '客户端 IP 格式无效')
  ).max(100),
  allowPrivateNetwork: z.boolean(),
  privateNetworkHosts: z.array(
    z.string().trim().min(1).max(255).refine(value => !value.includes('://') && !/[/?#]/.test(value), '请填写 Host 或 IP，不要填写 URL')
  ).max(100)
}).strict();

router.put('/network-policy', async (req, res) => {
  try {
    const parsed = networkPolicySchema.parse(req.body);
    const input: {
      adminAccessMode: AdminAccessMode;
      adminAllowedIps: string[];
      allowPrivateNetwork: boolean;
      privateNetworkHosts: string[];
    } = {
      adminAccessMode: parsed.adminAccessMode,
      adminAllowedIps: parsed.adminAllowedIps,
      allowPrivateNetwork: parsed.allowPrivateNetwork,
      privateNetworkHosts: parsed.privateNetworkHosts
    };
    const policy = await updateRuntimeNetworkPolicy(input);
    res.json({
      success: true,
      data: policy,
      message: '连接与安全策略已保存并热生效'
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: error.errors[0]?.message || '网络策略格式无效'
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message || '保存网络策略失败'
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
    const hasReasoningEndpoint = Object.prototype.hasOwnProperty.call(req.body || {}, 'reasoningEndpoint');
    const hasLightEndpoint = Object.prototype.hasOwnProperty.call(req.body || {}, 'lightEndpoint');
    const finalApiUrl = typeof apiUrl === 'string' ? apiUrl.trim() : currentConfig.apiUrl;
    const finalReasoningEndpoint = hasReasoningEndpoint
      ? (typeof reasoningEndpoint === 'string' ? reasoningEndpoint.trim() || undefined : undefined)
      : currentConfig.reasoningEndpoint;
    const finalLightEndpoint = hasLightEndpoint
      ? (typeof lightEndpoint === 'string' ? lightEndpoint.trim() || undefined : undefined)
      : currentConfig.lightEndpoint;
    const freshApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const mainEndpointChanged = !endpointsMatch(finalApiUrl, currentConfig.apiUrl);
    const endpointRebound = (mainEndpointChanged && Boolean(finalApiUrl))
      || (!endpointsMatch(finalReasoningEndpoint, currentConfig.reasoningEndpoint) && Boolean(finalReasoningEndpoint))
      || (!endpointsMatch(finalLightEndpoint, currentConfig.lightEndpoint) && Boolean(finalLightEndpoint));
    let resolvedApiKey = freshApiKey
      || (!endpointRebound ? currentConfig.apiKey : '');
    if (!finalApiUrl && !finalReasoningEndpoint && !finalLightEndpoint) {
      resolvedApiKey = '';
    }
    if (!finalApiUrl && (finalReasoningEndpoint || finalLightEndpoint)) {
      return res.status(400).json({
        success: false,
        error: '配置推理或轻量 Endpoint 前必须提供主服务地址'
      });
    }
    if (freshApiKey && !finalApiUrl) {
      return res.status(400).json({
        success: false,
        error: '配置 API Key 时必须提供主服务地址'
      });
    }
    if ((finalApiUrl || finalReasoningEndpoint || finalLightEndpoint) && !resolvedApiKey) {
      return res.status(400).json({
        success: false,
        error: !endpointRebound
          ? 'API Key 未配置'
          : '更换任一服务地址时必须提供新的 API Key'
      });
    }

    const parsedModelsArray = Array.isArray(availableModels)
      ? availableModels
      : typeof availableModels === 'string'
        ? availableModels.split(',').map((m: string) => m.trim()).filter(Boolean)
        : currentConfig.availableModels;
    const modelsArray = Array.isArray(parsedModelsArray) && parsedModelsArray.length > 0
      ? parsedModelsArray
      : currentConfig.availableModels;

    const updatedConfig = await apiConfigService.updateConfig({
      apiUrl: finalApiUrl,
      apiKey: resolvedApiKey,
      availableModels: modelsArray,
      defaultModel,
      defaultReasoningModel,
      defaultEvaluationModel,
      defaultTemperature: defaultTemperature ?? currentConfig.defaultTemperature,
      defaultMaxTokens: defaultMaxTokens ?? currentConfig.defaultMaxTokens,
      reasoningEndpoint: finalReasoningEndpoint,
      lightEndpoint: finalLightEndpoint,
      chatModels: chatModels || currentConfig.chatModels,
      reasoningModels: reasoningModels || currentConfig.reasoningModels,
      lightModels: lightModels || currentConfig.lightModels
    });

    getAPIGateway().invalidateCache();
    void aiCapabilityHealthService.refresh().catch(() => undefined);

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
    const resolvedKey = resolveEndpointBoundSecret(
      resolvedUrl,
      apiKey,
      currentConfig.apiUrl,
      currentConfig.apiKey
    );
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
    const response = await safeHttpRequest<any>(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resolvedKey}`,
      },
      body: {
        model: resolvedModel,
        temperature: typeof temperature === 'number' ? temperature : currentConfig.defaultTemperature ?? 0.2,
        max_tokens: typeof maxTokens === 'number' ? maxTokens : currentConfig.defaultMaxTokens ?? 256,
        messages: [
          { role: 'system', content: '你是 API 模型连通性测试助手。请简洁返回。' },
          { role: 'user', content: resolvedPrompt }
        ]
      },
      timeoutMs: 30_000
    });

    const durationMs = Date.now() - startedAt;
    const payload: any = response.data;

    if (response.status < 200 || response.status >= 300) {
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
    void aiCapabilityHealthService.refresh().catch(() => undefined);
    
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
