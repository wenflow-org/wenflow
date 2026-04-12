// A/B 测试路由
import { Router } from 'express';
import { abTestService } from '../services/ab-testing/ab-test.service';
import { authMiddleware } from '../middleware/auth.middleware';
import prisma from '../config/database';
import { logger } from '../utils/logger';

const router = Router();

// 所有 A/B 测试路由都需要认证
router.use(authMiddleware);

/**
 * 创建测试（管理员）
 * POST /api/ab-testing/create
 */
router.post('/create', async (req, res, next) => {
  try {
    // 检查管理员权限
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: '需要管理员权限'
      });
    }

    const { name, description, testType, variants, trafficSplit, startDate, endDate } = req.body;
    
    const test = await abTestService.createABTest({
      name,
      description,
      testType,
      variants,
      trafficSplit,
      startDate,
      endDate
    });
    
    res.json({ success: true, data: test });
  } catch (error: any) {
    logger.error('[ABTest API] 创建测试失败', error);
    next(error);
  }
});

/**
 * 启动测试（管理员）
 * POST /api/ab-testing/:testId/start
 */
router.post('/:testId/start', async (req, res, next) => {
  try {
    // 检查管理员权限
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: '需要管理员权限'
      });
    }

    const { testId } = req.params;
    
    await abTestService.startTest(testId);
    
    res.json({ success: true, message: '测试已启动' });
  } catch (error: any) {
    logger.error('[ABTest API] 启动测试失败', error);
    next(error);
  }
});

/**
 * 暂停测试（管理员）
 * POST /api/ab-testing/:testId/pause
 */
router.post('/:testId/pause', async (req, res, next) => {
  try {
    // 检查管理员权限
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: '需要管理员权限'
      });
    }

    const { testId } = req.params;
    
    await abTestService.pauseTest(testId);
    
    res.json({ success: true, message: '测试已暂停' });
  } catch (error: any) {
    logger.error('[ABTest API] 暂停测试失败', error);
    next(error);
  }
});

/**
 * 完成测试（管理员）
 * POST /api/ab-testing/:testId/complete
 */
router.post('/:testId/complete', async (req, res, next) => {
  try {
    // 检查管理员权限
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: '需要管理员权限'
      });
    }

    const { testId } = req.params;
    
    await abTestService.completeTest(testId);
    
    res.json({ success: true, message: '测试已完成' });
  } catch (error: any) {
    logger.error('[ABTest API] 完成测试失败', error);
    next(error);
  }
});

/**
 * 分配变体
 * POST /api/ab-testing/:testId/assign
 */
router.post('/:testId/assign', async (req, res, next) => {
  try {
    const { testId } = req.params;
    const userId = req.user.userId;
    
    const variantId = await abTestService.assignVariant(userId, testId);
    
    res.json({ success: true, data: { variantId } });
  } catch (error: any) {
    logger.error('[ABTest API] 分配变体失败', error);
    next(error);
  }
});

/**
 * 记录结果
 * POST /api/ab-testing/:testId/result
 */
router.post('/:testId/result', async (req, res, next) => {
  try {
    const { testId } = req.params;
    const { sessionId, taskId, variantId, metrics } = req.body;
    
    await abTestService.recordResult({
      testId,
      userId: req.user.userId,
      sessionId,
      taskId,
      variantId,
      metrics
    });
    
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[ABTest API] 记录结果失败', error);
    next(error);
  }
});

/**
 * 获取测试结果（管理员）
 * GET /api/ab-testing/:testId/results
 */
router.get('/:testId/results', async (req, res, next) => {
  try {
    // 检查管理员权限
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: '需要管理员权限'
      });
    }

    const { testId } = req.params;
    
    const results = await abTestService.getTestResults(testId);
    
    res.json({ success: true, data: results });
  } catch (error: any) {
    logger.error('[ABTest API] 获取测试结果失败', error);
    next(error);
  }
});

/**
 * 获取测试分析（管理员）
 * GET /api/ab-testing/:testId/analyze
 */
router.get('/:testId/analyze', async (req, res, next) => {
  try {
    // 检查管理员权限
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: '需要管理员权限'
      });
    }

    const { testId } = req.params;
    
    const analysis = await abTestService.analyzeTestResults(testId);
    
    res.json({ success: true, data: analysis });
  } catch (error: any) {
    logger.error('[ABTest API] 分析测试结果失败', error);
    next(error);
  }
});

/**
 * 获取所有测试（管理员）
 * GET /api/ab-testing/tests/list
 */
router.get('/tests/list', async (req, res, next) => {
  try {
    // 检查管理员权限
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: '需要管理员权限'
      });
    }

    const tests = await abTestService.getAllTests();
    
    res.json({ success: true, data: tests });
  } catch (error: any) {
    logger.error('[ABTest API] 获取测试列表失败', error);
    next(error);
  }
});

/**
 * 获取单个测试详情（管理员）
 * GET /api/ab-testing/:testId/detail
 */
router.get('/:testId/detail', async (req, res, next) => {
  try {
    // 检查管理员权限
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: '需要管理员权限'
      });
    }

    const { testId } = req.params;
    
    const test = await abTestService.getTestById(testId);
    
    res.json({ success: true, data: test });
  } catch (error: any) {
    logger.error('[ABTest API] 获取测试详情失败', error);
    next(error);
  }
});

export default router;
