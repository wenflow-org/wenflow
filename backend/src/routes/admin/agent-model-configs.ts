import { Router } from 'express';
import agentModelConfigService from '../../services/agentModelConfig.service';
import { getAgentRequestTimeoutInfo } from '../../services/agentRequestTimeout.service';
import { preserveConfiguredSecret, toSecretSafeResponse } from '../../utils/secret-redaction';

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
    const input = preserveConfiguredSecret(pickEditableConfig(req.body), existing as any);
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
