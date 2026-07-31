// 学习状态追踪路由
import express from 'express';
import stateTrackingService from '../services/learning/state-tracking.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const router = express.Router();

// 应用认证中间件
router.use(authMiddleware);

/**
 * 获取当前学习状态
 * GET /state/current
 */
router.get('/current', async (req: any, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '用户未认证'
      });
    }

    const currentState = await stateTrackingService.getCurrentState(userId);

    if (!currentState) {
      return res.status(200).json({
        success: true,
        data: null,
        message: '暂无学习数据'
      });
    }

    const suggestion = stateTrackingService.generateSuggestion(currentState);

    // currentState 已经是展示尺度 (0-100)
    res.json({
      success: true,
      data: {
        lss: currentState.lss,
        ktl: currentState.ktl,
        lf: currentState.lf,
        lsb: currentState.lsb,
        updatedAt: currentState.updatedAt,
        suggestion
      }
    });
  } catch (error: any) {
    logger.error('[state-tracking-route] 获取当前学习状态失败', { error });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取学习趋势数据
 * GET /state/trends?days=7
 * GET /state/trends?range=all
 */
router.get('/trends', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    const days = parseInt(req.query.days as string, 10) || 30;
    const rangeMode = req.query.range === 'all' ? 'all' : 'recent';

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '用户未认证'
      });
    }

    const trendWindow = await stateTrackingService.getStateTrendWindow(userId, {
      days,
      mode: rangeMode,
    });

    res.json({
      success: true,
      data: {
        trends: trendWindow.trends,
        range: trendWindow.range,
        days: trendWindow.range.requestedDays === 'all'
          ? trendWindow.range.actualDays
          : trendWindow.range.requestedDays
      }
    });
  } catch (error: any) {
    logger.error('[state-tracking-route] 获取学习趋势失败', { error });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取学习预警
 * GET /state/warnings
 */
router.get('/warnings', async (req: any, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '用户未认证'
      });
    }

    const warnings = await stateTrackingService.checkWarnings(userId);

    res.json({
      success: true,
      data: {
        warnings,
        hasWarnings: warnings.length > 0,
        criticalCount: warnings.filter(w => w.level === 'critical').length
      }
    });
  } catch (error: any) {
    logger.error('[state-tracking-route] 获取学习预警失败', { error });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
