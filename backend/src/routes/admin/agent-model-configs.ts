import { Router } from 'express';
import agentModelConfigService from '../../services/agentModelConfig.service';
import { getAPIGateway } from '../../gateway/api-gateway';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const configs = await agentModelConfigService.getAll();
    res.json({ success: true, data: configs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:agentId', async (req, res) => {
  try {
    const config = await agentModelConfigService.get(req.params.agentId);
    if (!config) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }
    res.json({ success: true, data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:agentId', async (req, res) => {
  try {
    const config = await agentModelConfigService.upsert(req.params.agentId, req.body);
    getAPIGateway().invalidateCache(undefined, req.params.agentId);
    res.json({ success: true, data: config, message: '配置已更新' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:agentId', async (req, res) => {
  try {
    await agentModelConfigService.delete(req.params.agentId);
    getAPIGateway().invalidateCache(undefined, req.params.agentId);
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