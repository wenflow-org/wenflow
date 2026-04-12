// 学习报告路由
import express, { Request, Response, NextFunction } from 'express';
import reportService from '../services/learning/report.service';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

// 所有报告路由都需要认证
router.use(authMiddleware);

// 生成学习报告
router.get(
  '/generate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.userId;
      const type = (req.query.type as 'weekly' | 'monthly') || 'weekly';
      const date = req.query.date as string | undefined;

      const report = await reportService.generateReport(userId, type, date);

      res.json({
        success: true,
        data: report
      });
    } catch (error: any) {
      next(error);
    }
  }
);

// 获取报告历史
router.get(
  '/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.userId;

      const history = await reportService.getReportHistory(userId);

      res.json({
        success: true,
        data: history
      });
    } catch (error: any) {
      next(error);
    }
  }
);

export default router;
