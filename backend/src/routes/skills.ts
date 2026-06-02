/**
 * Skill API 路由
 */

import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { getGateway } from '../gateway';
import { skillHandlers, allSkillDefinitions } from '../skills';
import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { logger } from '../utils/logger';

const router = Router();

function summarizePayload(value: any, depth = 0): any {
  if (depth > 2) return '[max-depth]';
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return {
      count: value.length,
      sample: value.slice(0, 2).map((item) => summarizePayload(item, depth + 1)),
    };
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 10).map(([key, item]) => [key, summarizePayload(item, depth + 1)])
    );
  }
  return String(value);
}

/**
 * 获取所有 Skill 列表
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const gateway = getGateway();
    const skills = gateway.matchSkills({});
    
    res.json({
      success: true,
      data: skills.map(s => ({
        name: s.definition.name,
        version: s.definition.version,
        category: s.definition.category,
        description: s.definition.description,
        capabilities: s.definition.capabilities,
        stats: s.definition.stats
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 获取 Skill 详情
 */
router.get('/:skillName', async (req: Request, res: Response) => {
  try {
    const { skillName } = req.params;
    const gateway = getGateway();
    const skill = gateway.getSkill(skillName);
    
    if (!skill) {
      return res.status(404).json({
        success: false,
        error: 'Skill not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        name: skill.definition.name,
        version: skill.definition.version,
        category: skill.definition.category,
        description: skill.definition.description,
        inputSchema: skill.definition.inputSchema,
        outputSchema: skill.definition.outputSchema,
        capabilities: skill.definition.capabilities,
        stats: skill.definition.stats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 执行 Skill
 */
router.post('/execute/:skillName', async (req: Request, res: Response) => {
  try {
    const { skillName } = req.params;
    const input = req.body;
    
    logger.info('[skills-route] executing skill', {
      skillName,
      inputSummary: summarizePayload(input),
    });
    
    const gateway = getGateway();
    const result = await gateway.executeSkill(skillName, input);
    
    logger.info('[skills-route] skill execution completed', {
      skillName,
      success: result.success,
      hasOutput: !!result.output,
      duration: result.duration,
    });
    
    res.json({
      success: result.success,
      data: result.output || result.error,
      metadata: {
        duration: result.duration,
        cached: result.cached
      }
    });
  } catch (error) {
    logger.error('[skills-route] skill execution failed', {
      skillName: req.params.skillName,
      error,
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
});

/**
 * 匹配 Skill
 */
router.post('/match', async (req: Request, res: Response) => {
  try {
    const { categories, capabilities, names, minSuccessRate } = req.body;
    
    const gateway = getGateway();
    const skills = gateway.matchSkills({
      categories,
      capabilities,
      names,
      minSuccessRate
    });
    
    res.json({
      success: true,
      data: skills.map(s => ({
        name: s.definition.name,
        category: s.definition.category,
        capabilities: s.definition.capabilities,
        successRate: s.definition.stats.successRate
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 注册 Skill（仅管理员可调用）
 */
router.post('/register', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { definition, handler } = req.body;
    
    const gateway = getGateway();
    const skillName = await gateway.registerSkill(definition);
    
    res.json({
      success: true,
      data: { skillName }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 获取 Skill 统计
 */
router.get('/:skillName/stats', async (req: Request, res: Response) => {
  try {
    const { skillName } = req.params;
    
    const record = await prisma.skill_registrations.findUnique({
      where: { name: skillName }
    });
    
    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'Skill not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        name: record.name,
        callCount: record.callCount,
        successRate: record.successRate,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
