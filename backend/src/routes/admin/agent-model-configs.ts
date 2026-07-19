import { Router } from 'express';
import agentModelConfigService from '../../services/agentModelConfig.service';
import { getAgentRequestTimeoutInfo } from '../../services/agentRequestTimeout.service';
import { preserveConfiguredSecret, toSecretSafeResponse } from '../../utils/secret-redaction';
import { normalizeEndpointIdentity } from '../../utils/endpoint-identity';

const router = Router();

function toResponseShape(config: any) {
  return toSecretSafeResponse({
    ...config,
    ...getAgentRequestTimeoutInfo(config.agentId),
  });
}

function pickEditableConfig(body: any) {
  return {
    tier: body?.tier,
    model: body?.model,
    thinkingMode: body?.thinkingMode,
    reasoningEffort: body?.reasoningEffort,
    endpoint: body?.endpoint,
    apiKey: body?.apiKey,
    temperature: body?.temperature,
    maxTokens: body?.maxTokens,
    enabled: body?.enabled,
  };
}

router.get('/', async (req, res) => {
  try {
    const configs = await agentModelConfigService.getAll();
    res.json({ success: true, data: configs.map(toResponseShape) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:agentId', async (req, res) => {
  try {
    const config = await agentModelConfigService.get(req.params.agentId);
    if (!config) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: toResponseShape(config) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:agentId', async (req, res) => {
  try {
    const existing = await agentModelConfigService.get(req.params.agentId);
    const body = req.body || {};
    const endpointProvided = Object.prototype.hasOwnProperty.call(body, 'endpoint');
    if (endpointProvided && body.endpoint !== null && typeof body.endpoint !== 'string') {
      return res.status(400).json({ success: false, error: 'endpoint 必须是字符串或 null' });
    }
    const endpointChanged = endpointProvided
      && normalizeEndpointIdentity(body.endpoint) !== normalizeEndpointIdentity(existing?.endpoint);
    const finalEndpoint = endpointProvided
      ? normalizeEndpointIdentity(body.endpoint)
      : normalizeEndpointIdentity(existing?.endpoint);
    if (typeof body.apiKey === 'string' && body.apiKey.trim() && !finalEndpoint) {
      return res.status(400).json({ success: false, error: '配置独立 apiKey 时必须同时提供 endpoint' });
    }
    if (endpointChanged
      && normalizeEndpointIdentity(body.endpoint)
      && !(typeof body.apiKey === 'string' && body.apiKey.trim())) {
      return res.status(400).json({ success: false, error: '更换 endpoint 时必须提供新的 apiKey' });
    }
    const input = preserveConfiguredSecret(
      pickEditableConfig(body),
      endpointChanged ? { ...existing, apiKey: null } as any : existing as any
    );
    if (endpointChanged && !(typeof body.apiKey === 'string' && body.apiKey.trim())) {
      input.apiKey = null;
    }
    const config = await agentModelConfigService.upsert(req.params.agentId, input);
    res.json({ success: true, data: toResponseShape(config), message: '配置已更新' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:agentId', async (req, res) => {
  try {
    await agentModelConfigService.delete(req.params.agentId);
    res.json({ success: true, message: '配置已删除' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/initialize', async (req, res) => {
  try {
    await agentModelConfigService.initializeDefaults();
    res.json({ success: true, message: '默认配置已初始化' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
