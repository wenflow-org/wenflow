// 学习状态追踪路由
import express from 'express';
import stateTrackingService from '../services/learning/state-tracking.service';
import { authMiddleware } from '../middleware/auth.middleware';

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

    res.json({
      success: true,
      data: {
        lss: currentState.lss,
        ktl: currentState.ktl,
        lf: currentState.lf,
        lsb: currentState.lsb,
        suggestion
      }
    });
  } catch (error: any) {
    console.error('获取当前学习状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取学习趋势数据
 * GET /state/trends?days=7
 */
router.get('/trends', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    const days = parseInt(req.query.days as string) || 7;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '用户未认证'
      });
    }

    const trends = await stateTrackingService.getStateTrends(userId, days);

    res.json({
      success: true,
      data: {
        trends,
        days
      }
    });
  } catch (error: any) {
    console.error('获取学习趋势失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 计算学习状态指标
 * POST /state/calculate
 * Body: { difficulty, cognitiveLoad, effectiveness }
 */
router.post('/calculate', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    const { difficulty, cognitiveLoad, effectiveness } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '用户未认证'
      });
    }

    // 验证输入
    if (typeof difficulty !== 'number' || typeof cognitiveLoad !== 'number' || typeof effectiveness !== 'number') {
      return res.status(400).json({
        success: false,
        error: '请提供有效的评分数据（difficulty, cognitiveLoad, effectiveness）'
      });
    }

    // 计算学习状态指标
    const metrics = await stateTrackingService.calculateSessionMetrics(userId, {
      difficulty,
      cognitiveLoad,
      effectiveness
    });

    // 生成学习建议
    const suggestion = stateTrackingService.generateSuggestion(metrics);

    res.json({
      success: true,
      data: {
        lss: metrics.lss,
        ktl: metrics.ktl,
        lf: metrics.lf,
        lsb: metrics.lsb,
        suggestion
      }
    });
  } catch (error: any) {
    console.error('计算学习状态指标失败:', error);
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
    console.error('获取学习预警失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
