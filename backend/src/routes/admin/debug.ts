import { Router, Request, Response } from 'express';
import { getEventBus } from '../../gateway/event-bus';

const router = Router();

/**
 * GET /api/admin/debug/events
 * 查询事件总线历史（内存存储，重启丢失）
 */
router.get('/debug/events', async (req: Request, res: Response) => {
  try {
    const eventBus = getEventBus();
    if (!eventBus) {
      res.json({ success: true, data: { events: [], note: 'EventBus 尚未初始化' } });
      return;
    }

    const types = req.query.types
      ? (Array.isArray(req.query.types) ? req.query.types : [req.query.types]) as string[]
      : undefined;

    const events = await eventBus.getHistory({
      userId: req.query.userId as string | undefined,
      types: types as any,
      from: req.query.from ? new Date(req.query.from as string) : undefined,
      to: req.query.to ? new Date(req.query.to as string) : undefined,
      limit: req.query.limit ? Math.min(Number(req.query.limit), 200) : 50,
    });

    res.json({ success: true, data: { events, count: events.length } });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error?.message || '查询事件失败' },
    });
  }
});

export default router;
