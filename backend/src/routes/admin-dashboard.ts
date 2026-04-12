import express, { Request, Response } from 'express';
import prisma from '../config/database';

const router = express.Router();

// 这个文件已不再使用，功能已迁移到 admin/platform.ts
// 保留此文件作为向后兼容的占位符

router.get('/ping', (req: Request, res: Response) => {
  res.json({ success: true, message: 'pong' });
});

export default router;
