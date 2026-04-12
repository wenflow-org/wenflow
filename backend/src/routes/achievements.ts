// 成就路由
import express from 'express';
import achievementService from '../services/achievements/achievement.service';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();

// 所有成就路由都需要认证
router.use(authMiddleware);

// 获取用户已解锁的成就
router.get('/my-achievements', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const achievements = await achievementService.getUserAchievements(userId);

    res.json({
      success: true,
      data: achievements
    });
  } catch (error: any) {
    next(error);
  }
});

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

// 手动触发成就检测（用于测试）
router.post('/check', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { eventType } = req.body;

    const newAchievements = await achievementService.triggerAchievementCheck(
      userId,
      eventType || 'task_completed'
    );

    res.json({
      success: true,
      data: {
        newAchievements,
        count: newAchievements.length
      }
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
