import { Router } from 'express';
import skillModelConfigService from '../../services/skillModelConfig.service';
import { preserveConfiguredSecret, toSecretSafeResponse } from '../../utils/secret-redaction';

const router = Router();

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
    requestTimeoutMs: body?.requestTimeoutMs,
    enabled: body?.enabled,
  };
}

router.get('/', async (req, res) => {
  try {
    const configs = await skillModelConfigService.getAll();
    res.json({ success: true, data: toSecretSafeResponse(configs) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:skillId', async (req, res) => {
  try {
    const config = await skillModelConfigService.get(req.params.skillId);
    if (!config) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }
    res.json({ success: true, data: toSecretSafeResponse(config) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:skillId', async (req, res) => {
  try {
    const existing = await skillModelConfigService.get(req.params.skillId);
    const input = preserveConfiguredSecret(pickEditableConfig(req.body), existing as any);
    const config = await skillModelConfigService.upsert(req.params.skillId, input);
    res.json({ success: true, data: toSecretSafeResponse(config), message: '配置已更新' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:skillId', async (req, res) => {
  try {
    await skillModelConfigService.delete(req.params.skillId);
    res.json({ success: true, message: '配置已删除' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
