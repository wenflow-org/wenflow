import { Router } from 'express';
import { aiCapabilityHealthService } from '../services/ai-capability-health.service';

const router = Router();

router.get('/capabilities', (_req, res) => {
  res.json({ success: true, data: aiCapabilityHealthService.getSnapshot() });
});

export default router;
