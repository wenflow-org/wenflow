/**
 * 管理端 Skills API
 * 
 * 提供 Skill 管理、监控、测试等功能
 */

import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import { getGateway } from '../../gateway';
import { AgentConfigService } from '../../services/agentConfig.service';
import { isExtraCapabilitySkill } from '../../services/skill-component-catalog';
import { PATH_SCENE_FRAMING_PROMPT } from '../../skills/path-scene-framing';
import { SESSION_KNOWLEDGE_DISTILLER_PROMPT } from '../../skills/session-knowledge-distiller';
import { LABEL_GENERATOR_PROMPT } from '../../skills/label-generator';
import { VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT } from '../../skills/virtual-learner-persona-designer';
import { VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT } from '../../skills/virtual-learner-scenario-designer';

const router = Router();

const SKILL_FALLBACK_PROMPTS: Record<string, string> = {
  'label-generator': LABEL_GENERATOR_PROMPT,
  'path-scene-framing': PATH_SCENE_FRAMING_PROMPT,
  'session-knowledge-distiller': SESSION_KNOWLEDGE_DISTILLER_PROMPT,
  'virtual-learner-persona-designer': VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT,
  'virtual-learner-scenario-designer': VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT,
};

type SkillRuntimeStats = {
  callCount: number;
  successRate: number;
  avgLatency: number;
  lastCalledAt: Date | null;
};

function emptyRuntimeStats(): SkillRuntimeStats {
  return {
    callCount: 0,
    successRate: 1,
    avgLatency: 0,
    lastCalledAt: null,
  };
}

function buildStats(total: number, successCount: number, avgLatency: number | null | undefined, lastCalledAt: Date | null | undefined): SkillRuntimeStats {
  return {
    callCount: total,
    successRate: total > 0 ? successCount / total : 1,
    avgLatency: Math.round(avgLatency || 0),
    lastCalledAt: lastCalledAt || null,
  };
}

async function getSkillRuntimeStats(skillNames: string[]): Promise<Map<string, SkillRuntimeStats>> {
  const result = new Map<string, SkillRuntimeStats>();
  if (!skillNames.length) return result;

  const promptAgentIds = skillNames.map((name) => `skill:${name}`);
  const [registrations, promptGroups, promptSuccessGroups, agentLogs] = await Promise.all([
    prisma.skill_registrations.findMany({
      where: { name: { in: skillNames } },
      select: { name: true, callCount: true, successRate: true, updatedAt: true },
    }),
    prisma.prompt_call_logs.groupBy({
      by: ['agentId'],
      where: { agentId: { in: promptAgentIds } },
      _count: { _all: true },
      _avg: { durationMs: true },
      _max: { createdAt: true },
    }),
    prisma.prompt_call_logs.groupBy({
      by: ['agentId', 'success'],
      where: { agentId: { in: promptAgentIds } },
      _count: { _all: true },
    }),
    prisma.agent_call_logs.findMany({
      where: {
        OR: skillNames.flatMap((name) => [
          { metadata: { contains: `"skillId":"${name}"` } },
          { metadata: { contains: `"skillId":"skill:${name}"` } },
        ]),
      },
      select: { metadata: true, success: true, durationMs: true, calledAt: true },
    }),
  ]);

  for (const registration of registrations) {
    result.set(registration.name, {
      callCount: registration.callCount,
      successRate: registration.callCount > 0 ? registration.successRate : 1,
      avgLatency: 0,
      lastCalledAt: registration.callCount > 0 ? registration.updatedAt : null,
    });
  }

  const promptSuccessMap = new Map<string, number>();
  const promptBackedSkills = new Set<string>();
  for (const group of promptSuccessGroups) {
    if (group.success) {
      promptSuccessMap.set(group.agentId, group._count._all);
    }
  }

  for (const group of promptGroups) {
    const skillName = group.agentId.replace(/^skill:/, '');
    promptBackedSkills.add(skillName);
    result.set(skillName, buildStats(
      group._count._all,
      promptSuccessMap.get(group.agentId) || 0,
      group._avg.durationMs,
      group._max.createdAt,
    ));
  }

  const agentLogMap = new Map<string, { total: number; success: number; durationTotal: number; lastCalledAt: Date | null }>();
  for (const log of agentLogs) {
    let metadata: any = null;
    try {
      metadata = log.metadata ? JSON.parse(log.metadata) : null;
    } catch {
      metadata = null;
    }

    const rawSkillId = typeof metadata?.skillId === 'string' ? metadata.skillId : '';
    const skillName = rawSkillId.replace(/^skill:/, '');
    if (!skillNames.includes(skillName)) continue;

    const current = agentLogMap.get(skillName) || { total: 0, success: 0, durationTotal: 0, lastCalledAt: null };
    current.total += 1;
    current.success += log.success ? 1 : 0;
    current.durationTotal += log.durationMs || 0;
    if (!current.lastCalledAt || log.calledAt > current.lastCalledAt) {
      current.lastCalledAt = log.calledAt;
    }
    agentLogMap.set(skillName, current);
  }

  for (const [skillName, stats] of agentLogMap.entries()) {
    if (promptBackedSkills.has(skillName)) continue;
    result.set(skillName, buildStats(
      stats.total,
      stats.success,
      stats.total > 0 ? stats.durationTotal / stats.total : 0,
      stats.lastCalledAt,
    ));
  }

  return result;
}

function normalizePromptText(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').trim()
    : '';
}

/**
 * 获取所有 Skill 列表（含统计）
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const gateway = getGateway();
    const skills = gateway.matchSkills({});
    const runtimeStats = await getSkillRuntimeStats(skills.map(s => s.definition.name));
    
    const skillList = skills.map(s => {
      const stats = runtimeStats.get(s.definition.name) || s.definition.stats;
      return {
        name: s.definition.name,
        version: s.definition.version,
        category: s.definition.category,
        description: s.definition.description,
        capabilities: s.definition.capabilities,
        dependencies: s.definition.dependencies,
        stats,
        lastCalledAt: runtimeStats.get(s.definition.name)?.lastCalledAt || s.lastCalledAt,
        registeredAt: s.registeredAt
      };
    });
    
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
    const runtimeStats = await getSkillRuntimeStats([name]);
    
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
        stats: runtimeStats.get(name) || skill.definition.stats,
        lastCalledAt: runtimeStats.get(name)?.lastCalledAt || skill.lastCalledAt,
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
 * 获取 Skill 当前生效 Prompt
 */
router.get('/:name/effective-prompt', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const promptService = new AgentConfigService();
    const agentId = `skill:${name}`;
    const activePrompt = await promptService.getActivePrompt(agentId);
    const fallbackPrompt = SKILL_FALLBACK_PROMPTS[name] || null;
    const fallbackNormalized = normalizePromptText(fallbackPrompt);

    if (activePrompt) {
      const activeNormalized = normalizePromptText(activePrompt.systemPrompt);
      const promptDrift = !!fallbackPrompt && activeNormalized !== fallbackNormalized;

      return res.json({
        success: true,
        data: {
          source: 'db-active',
          agentId,
          prompt: activePrompt,
          fallbackPrompt,
          promptDrift,
          driftDetail: fallbackPrompt ? {
            activeVersion: activePrompt.version,
            fallbackAvailable: true,
            activeMatchesCode: !promptDrift,
          } : null,
        },
      });
    }

    if (fallbackPrompt) {
      return res.json({
        success: true,
        data: {
          source: 'code-fallback',
          promptMode: 'code-fallback',
          agentId,
          prompt: {
            id: null,
            agentId,
            version: null,
            name: `${name} fallback prompt`,
            description: '代码内置默认 Prompt',
            systemPrompt: fallbackPrompt,
            model: null,
            temperature: null,
            maxTokens: null,
            status: 'FALLBACK',
          },
          fallbackPrompt,
          promptDrift: false,
          driftDetail: {
            activeVersion: null,
            fallbackAvailable: true,
            activeMatchesCode: true,
          },
        },
      });
    }

    if (isExtraCapabilitySkill(name)) {
      return res.json({
        success: true,
        data: {
          source: 'no-prompt',
          promptMode: 'no-prompt',
          agentId,
          prompt: null,
          fallbackPrompt: null,
          promptDrift: false,
          driftDetail: {
            activeVersion: null,
            fallbackAvailable: false,
            activeMatchesCode: true,
          },
        },
      });
    }

    res.status(404).json({
      success: false,
      error: 'No effective prompt found',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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
