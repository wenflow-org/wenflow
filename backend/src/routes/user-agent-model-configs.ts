import { Router } from 'express';
import userAgentModelConfigService from '../services/userAgentModelConfig.service';
import { preserveConfiguredSecret, toSecretSafeResponse } from '../utils/secret-redaction';
import { normalizeEndpointIdentity } from '../utils/endpoint-identity';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const configs = await userAgentModelConfigService.getAllByUser(userId);
    res.json({ success: true, data: toSecretSafeResponse(configs) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:agentId', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const config = await userAgentModelConfigService.get(userId, req.params.agentId);
    res.json({ success: true, data: toSecretSafeResponse(config || { enabled: false }) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:agentId', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const existing = await userAgentModelConfigService.get(userId, req.params.agentId);
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
    const input = preserveConfiguredSecret(body, endpointChanged ? { ...existing, apiKey: null } as any : existing as any);
    if (endpointChanged && !(typeof body.apiKey === 'string' && body.apiKey.trim())) {
      input.apiKey = null;
    }
    const config = await userAgentModelConfigService.upsert(userId, req.params.agentId, input);
    res.json({ success: true, data: toSecretSafeResponse(config), message: '配置已更新' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:agentId', async (req, res) => {
  try {
    const userId = req.user!.userId;
    await userAgentModelConfigService.delete(userId, req.params.agentId);
    res.json({ success: true, message: '已恢复使用系统默认配置' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
