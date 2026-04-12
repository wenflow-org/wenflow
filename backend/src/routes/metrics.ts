/**
 * Learning Metrics API Routes
 *
 * 提供学习状态追踪相关接口
 */

import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  getLearningMetrics,
  getLearningHistory,
  generateLearningStateAdvice,
} from '../services/metrics/LearningMetricService';

const router = express.Router();

// 获取当前学习指标
router.get('/current', authMiddleware, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const metrics = await getLearningMetrics(userId);

    if (!metrics) {
      return res.json({
        success: true,
        data: null,
        message: '暂无学习数据',
      });
    }

    const advice = generateLearningStateAdvice(metrics);

    res.json({
      success: true,
      data: {
        ...metrics,
        advice,
      },
    });
  } catch (error) {
    console.error('Error getting current metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get learning metrics',
    });
  }
});

// 获取学习历史数据（用于图表）
router.get('/history', authMiddleware, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const history = await getLearningHistory(userId);

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error('Error getting learning history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get learning history',
    });
  }
});

// 获取学习状态建议
router.get('/advice', authMiddleware, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const metrics = await getLearningMetrics(userId);

    if (!metrics) {
      return res.json({
        success: true,
        data: [],
        message: '暂无学习数据，无法生成建议',
      });
    }

    const advice = generateLearningStateAdvice(metrics);

    res.json({
      success: true,
      data: advice,
    });
  } catch (error) {
    console.error('Error getting learning advice:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get learning advice',
    });
  }
});

export default router;
