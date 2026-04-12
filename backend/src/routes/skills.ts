/**
 * Skill API 路由
 */

import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { getGateway } from '../gateway';
import { skillHandlers, allSkillDefinitions } from '../skills';

const router = Router();

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
    
    console.log(`[Skill] Executing: ${skillName}`, JSON.stringify(input, null, 2));
    
    const gateway = getGateway();
    const result = await gateway.executeSkill(skillName, input);
    
    console.log(`[Skill] Result: ${result.success}`, result.output ? 'has output' : 'no output');
    
    res.json({
      success: result.success,
      data: result.output || result.error,
      metadata: {
        duration: result.duration,
        cached: result.cached
      }
    });
  } catch (error) {
    console.error(`[Skill] Error executing ${req.params.skillName}:`, error);
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
 * 注册 Skill（开发/管理接口）
 */
router.post('/register', async (req: Request, res: Response) => {
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
