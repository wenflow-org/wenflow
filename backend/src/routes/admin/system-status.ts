import { Router } from 'express';
import { aiCapabilityHealthService } from '../../services/ai-capability-health.service';

const router = Router();

router.get('/capabilities', (_req, res) => {
  res.json({ success: true, data: aiCapabilityHealthService.getSnapshot() });
});

router.post('/capabilities/probe', async (_req, res) => {
  const snapshot = await aiCapabilityHealthService.refresh();
  res.json({ success: true, data: snapshot });
});

export default router;
