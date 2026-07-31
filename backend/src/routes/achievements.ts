// 成就路由
import express from 'express';
import achievementService from '../services/achievements/achievement.service';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

// 所有成就路由都需要认证
router.use(authMiddleware);

// 获取所有成就及其解锁状态
router.get('/all', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const achievements = await achievementService.getAllAchievementsWithStatus(userId);

    res.json({
      success: true,
      data: achievements
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
