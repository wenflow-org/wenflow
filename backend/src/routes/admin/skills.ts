/**
 * 管理端 Skills API
 * 
 * 提供 Skill 管理、监控、测试等功能
 */

import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import { getGateway } from '../../gateway';

const router = Router();

/**
 * 获取所有 Skill 列表（含统计）
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const gateway = getGateway();
    const skills = gateway.matchSkills({});
    
    const skillList = skills.map(s => ({
      name: s.definition.name,
      version: s.definition.version,
      category: s.definition.category,
      description: s.definition.description,
      capabilities: s.definition.capabilities,
      dependencies: s.definition.dependencies,
      stats: s.definition.stats,
      lastCalledAt: s.lastCalledAt,
      registeredAt: s.registeredAt
    }));
    
    res.json({
      success: true,
      data: skillList
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * 按分类统计
 */
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const gateway = getGateway();
    const skills = gateway.matchSkills({});
    
    const categoryMap: Record<string, { count: number; totalCalls: number; avgSuccessRate: number }> = {};
    
    skills.forEach(s => {
      const cat = s.definition.category;
      if (!categoryMap[cat]) {
        categoryMap[cat] = { count: 0, totalCalls: 0, avgSuccessRate: 0 };
      }
      categoryMap[cat].count++;
      categoryMap[cat].totalCalls += s.definition.stats.callCount;
    });
    
    Object.keys(categoryMap).forEach(cat => {
      const catSkills = skills.filter(s => s.definition.category === cat);
      categoryMap[cat].avgSuccessRate = catSkills.length > 0
        ? catSkills.reduce((sum, s) => sum + s.definition.stats.successRate, 0) / catSkills.length
        : 0;
    });
    
    const categories = Object.entries(categoryMap).map(([name, data]) => ({
      name,
      label: getCategoryLabel(name),
      ...data
    }));
    
    res.json({
      success: true,
      data: categories
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
router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const gateway = getGateway();
    const skill = gateway.getSkill(name);
    
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
        dependencies: skill.definition.dependencies,
        stats: skill.definition.stats,
        lastCalledAt: skill.lastCalledAt,
        registeredAt: skill.registeredAt
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
 * 获取 Skill 数据库统计
 */
router.get('/:name/db-stats', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    
    const record = await prisma.skill_registrations.findUnique({
      where: { name }
    });
    
    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'Skill not found in database'
      });
    }
    
    res.json({
      success: true,
      data: {
        name: record.name,
        version: record.version,
        category: record.category,
        description: record.description,
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

/**
 * 测试执行 Skill
 */
router.post('/:name/test', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const input = req.body;
    
    const gateway = getGateway();
    const skill = gateway.getSkill(name);
    
    if (!skill) {
      return res.status(404).json({
        success: false,
        error: 'Skill not found'
      });
    }
    
    const startTime = Date.now();
    const result = await gateway.executeSkill(name, input);
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      data: {
        output: result.output,
        success: result.success,
        duration,
        cached: result.cached
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : undefined) : undefined
    });
  }
});

/**
 * 获取使用趋势（最近7天调用统计）
 */
router.get('/usage/trends', async (req: Request, res: Response) => {
  try {
    const skills = await prisma.skill_registrations.findMany({
      select: {
        name: true,
        callCount: true,
        successRate: true,
        updatedAt: true
      },
      orderBy: {
        callCount: 'desc'
      }
    });
    
    const totalCalls = skills.reduce((sum, s) => sum + s.callCount, 0);
    const avgSuccessRate = skills.length > 0
      ? skills.reduce((sum, s) => sum + s.successRate, 0) / skills.length
      : 0;
    
    res.json({
      success: true,
      data: {
        skills: skills.map(s => ({
          name: s.name,
          callCount: s.callCount,
          successRate: s.successRate,
          lastUpdated: s.updatedAt
        })),
        summary: {
          totalCalls,
          avgSuccessRate,
          totalSkills: skills.length
        }
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
 * 获取分类中文标签
 */
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    parsing: '解析类',
    generation: '生成类',
    analysis: '分析类',
    retrieval: '检索类',
    computation: '计算类'
  };
  return labels[category] || category;
}

export default router;
