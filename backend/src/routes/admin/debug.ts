import { Router } from 'express';

// 调试路由（事件总线查看器已随 gateway 内存 EventBus 退役移除；域事件请查 Durable Outbox 与 agent_call_logs）
const router = Router();

export default router;
