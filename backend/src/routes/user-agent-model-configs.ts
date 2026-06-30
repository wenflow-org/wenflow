import { Router } from 'express';
import userAgentModelConfigService from '../services/userAgentModelConfig.service';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const configs = await userAgentModelConfigService.getAllByUser(userId);
    res.json({ success: true, data: configs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:agentId', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const config = await userAgentModelConfigService.get(userId, req.params.agentId);
    res.json({ success: true, data: config || { enabled: false } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:agentId', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const config = await userAgentModelConfigService.upsert(userId, req.params.agentId, req.body);
    res.json({ success: true, data: config, message: '配置已更新' });
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
