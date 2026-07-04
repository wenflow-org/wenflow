/**
 * 管理端 Skills API
 * 
 * 提供 Skill 管理、监控、测试等功能
 */

import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';
import { getGateway } from '../../gateway';
import { getAPIGateway } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';
import { PATH_SCENE_FRAMING_PROMPT } from '../../skills/path-scene-framing';
import { STAGE_DESIGNER_PROMPT } from '../../skills/stage-designer';
import { SESSION_KNOWLEDGE_DISTILLER_PROMPT } from '../../skills/session-knowledge-distiller';
import { LABEL_GENERATOR_PROMPT } from '../../skills/label-generator';
import { ADAPTIVE_GUIDANCE_COPY_PROMPT } from '../../skills/adaptive-guidance-copy';
import { GOAL_PROFILE_INFERENCE_PROMPT } from '../../skills/goal-profile-inference';
import { LEARNING_PATTERN_DISTILLER_PROMPT } from '../../skills/learning-pattern-distiller';
import { DIALOGUE_CONCEPT_EXTRACTOR_PROMPT } from '../../skills/dialogue-concept-extractor';
import { VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT } from '../../skills/virtual-learner-persona-designer';
import { VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT } from '../../skills/virtual-learner-scenario-designer';
import { VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT } from '../../skills/virtual-learner-goal-dialogue-simulator';
import { VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT } from '../../skills/virtual-learner-path-evaluator';
import { VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT } from '../../skills/virtual-learner-learn-turn-simulator';
import { GOAL_UNDERSTANDING_COMPOSER_PROMPT } from '../../skills/goal-understanding-composer';
import { ACCEPTANCE_EVIDENCE_EVALUATOR_PROMPT } from '../../skills/acceptance-evidence-evaluator';
import { STRUCTURED_OUTPUT_PARSER_PROMPT } from '../../skills/structured-output-parser';

const router = Router();

const SKILL_FALLBACK_PROMPTS: Record<string, string> = {
  'label-generator': LABEL_GENERATOR_PROMPT,
  'path-scene-framing': PATH_SCENE_FRAMING_PROMPT,
  'stage-designer': STAGE_DESIGNER_PROMPT,
  'adaptive-guidance-copy': ADAPTIVE_GUIDANCE_COPY_PROMPT,
  'goal-profile-inference': GOAL_PROFILE_INFERENCE_PROMPT,
  'learning-pattern-distiller': LEARNING_PATTERN_DISTILLER_PROMPT,
  'session-knowledge-distiller': SESSION_KNOWLEDGE_DISTILLER_PROMPT,
  'dialogue-concept-extractor': DIALOGUE_CONCEPT_EXTRACTOR_PROMPT,
  'virtual-learner-persona-designer': VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT,
  'virtual-learner-scenario-designer': VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT,
  'virtual-learner-goal-dialogue-simulator': VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT,
  'virtual-learner-path-evaluator': VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT,
  'virtual-learner-learn-turn-simulator': VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT,
  'goal-understanding-composer': GOAL_UNDERSTANDING_COMPOSER_PROMPT,
  'acceptance-evidence-evaluator': ACCEPTANCE_EVIDENCE_EVALUATOR_PROMPT,
  'structured-output-parser': STRUCTURED_OUTPUT_PARSER_PROMPT,
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
    systemPrisma.skill_registrations.findMany({
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

function buildGeneratedSkillPrompt(skill: any, name: string): string {
  const definition = skill?.definition || {};
  const capabilities = Array.isArray(definition.capabilities) && definition.capabilities.length
    ? definition.capabilities.join('、')
    : '暂无能力声明';

  return [
    `你是 WenFlow 平台中的 Skill：${definition.displayName || definition.name || name}。`,
    '',
    '职责：',
    definition.description || '根据输入执行该 Skill 的平台能力。',
    '',
    '能力：',
    capabilities,
    '',
    '输入协议：',
    JSON.stringify(definition.inputSchema || {}, null, 2),
    '',
    '输出协议：',
    JSON.stringify(definition.outputSchema || {}, null, 2),
    '',
    '请严格根据输入执行职责，并返回符合输出协议的结果。不要输出与任务无关的解释。',
  ].join('\n');
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
 * 获取 Skill-Agent 关联关系
 * 
 * 扫描所有 agent 和 orchestrator 源文件，找出每个 skill 被哪些 agent/orchestrator 引用。
 * 使用静态分析：baseDir 下的 .ts 文件是否 import 或引用该 skill。
 * 
 * 注意：此函数路由必须在 /:name 通配路由之前注册，避免 Express 把 "agent-relations" 当作 skill name 匹配。
 */
router.get('/agent-relations', async (_req: Request, res: Response) => {
  try {
    const gateway = getGateway();
    const skills = gateway.matchSkills({});
    const allSkillNames = skills.map(s => s.definition.name);

    const relations: Record<string, { agents: string[]; orchestrators: string[]; totalReferences: number }> = {};
    for (const name of allSkillNames) {
      relations[name] = { agents: [], orchestrators: [], totalReferences: 0 };
    }

    const fs = await import('fs');
    const path = await import('path');

    const agentDir = path.resolve(__dirname, '../../agents');
    const orchDir = path.resolve(__dirname, '../../orchestrators');

    function scanDir(dir: string, kind: 'agents' | 'orchestrators') {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, kind);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const dirName = entry.name === 'index.ts'
              ? path.basename(path.dirname(fullPath))
              : entry.name.replace('.ts', '');
            for (const skillName of allSkillNames) {
              if (
                content.includes(`'${skillName}'`) ||
                content.includes(`"${skillName}"`) ||
                content.includes(`skill:${skillName}`) ||
                content.includes(`skills/${skillName}`)
              ) {
                if (kind === 'agents') {
                  relations[skillName].agents.push(dirName);
                } else {
                  relations[skillName].orchestrators.push(dirName);
                }
                relations[skillName].totalReferences++;
              }
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    }

    scanDir(agentDir, 'agents');
    scanDir(orchDir, 'orchestrators');

    for (const [skillName, rel] of Object.entries(relations)) {
      rel.agents = [...new Set(rel.agents)];
      rel.orchestrators = [...new Set(rel.orchestrators)];
    }

    res.json({ success: true, data: relations });
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
    
    const record = await systemPrisma.skill_registrations.findUnique({
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
    const gateway = getGateway();
    const skill = gateway.getSkill(name);

    if (!skill) {
      // 兜底：peer-reinforcement 等以 skill: 前缀注册到 agent 体系的节点
      // 不在 SkillRegistry 中，但仍然有 active prompt 可读
      const promptService = new AgentConfigService();
      const agentId = `skill:${name}`;
      const activePrompt = await promptService.getActivePrompt(agentId);
      const fallbackPrompt = SKILL_FALLBACK_PROMPTS[name] || null;

      if (activePrompt) {
        const fallbackNormalized = normalizePromptText(fallbackPrompt);
        const activeNormalized = normalizePromptText(activePrompt.systemPrompt);
        const promptDrift = !!fallbackPrompt && activeNormalized !== fallbackNormalized;
        return res.json({
          success: true,
          data: {
            source: 'db-active',
            editable: true,
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
            editable: true,
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

      return res.status(404).json({
        success: false,
        error: 'Skill not found',
      });
    }

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
          editable: true,
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
          editable: true,
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

    const generatedPrompt = buildGeneratedSkillPrompt(skill, name);
    return res.json({
      success: true,
      data: {
        source: 'generated-default',
        promptMode: 'generated-default',
        editable: true,
        agentId,
        prompt: {
          id: null,
          agentId,
          version: null,
          name: `${name} generated default prompt`,
          description: '根据 Skill 定义生成的默认 Prompt 草案',
          systemPrompt: generatedPrompt,
          model: null,
          temperature: null,
          maxTokens: null,
          status: 'GENERATED',
        },
        fallbackPrompt: generatedPrompt,
        promptDrift: false,
        driftDetail: {
          activeVersion: null,
          fallbackAvailable: true,
          activeMatchesCode: true,
        },
      },
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
    const skills = await systemPrisma.skill_registrations.findMany({
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

/**
 * Skill 工作台综合元数据 API
 * GET /api/admin/skills/:skillId/workbench-meta
 *
 * 一次性返回 Skill 工作台所需的全部信息：
 *   - manifest 信息（name / description / category / aliases）
 *   - 隶属 Agent（agentId / name）
 *   - 模型配置（temperature / maxTokens / model）
 *   - prompt 版本列表（agent_prompts 表）
 *   - 字段契约（agent_contracts 表，按 stage）
 *   - 调用统计（agent_call_logs 聚合）
 *
 * 同时接受老 id（如 'teaching-turn-agent'）通过 alias 解析。
 */
router.get('/:skillId/workbench-meta', async (req: Request, res: Response) => {
  try {
    const rawSkillId = req.params.skillId;
    const { getAgentManifest, getAgentOfSkill, getCanonicalAgentId } = await import('../../services/agent-manifest.service');

    const canonicalId = getCanonicalAgentId(rawSkillId);
    const manifest = getAgentManifest(canonicalId);

    if (!manifest) {
      return res.status(404).json({
        success: false,
        error: { message: `Skill "${rawSkillId}" 不在 manifest 中` }
      });
    }

    if (manifest.kind === 'agent') {
      return res.status(400).json({
        success: false,
        error: { message: `"${canonicalId}" 是 Agent（编排器），不应使用 Skill 工作台。请前往 Agent 拓扑视图。` }
      });
    }

    const parentAgent = getAgentOfSkill(canonicalId);

    // 并发拉取
    const [skillConfig, promptVersions, contract, callStats, resolvedRoute] = await Promise.all([
      systemPrisma.skill_model_configs.findFirst({ where: { skillId: canonicalId.replace(/^skill:/, '') } }),
      systemPrisma.agent_prompts.findMany({
        where: { agentId: canonicalId },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          name: true,
          description: true,
          status: true,
          temperature: true,
          maxTokens: true,
          model: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true
        }
      }),
      systemPrisma.agent_contracts.findUnique({ where: { agentId: canonicalId } }),
      prisma.agent_call_logs.groupBy({
        by: ['success'],
        where: { agentId: canonicalId },
        _count: { _all: true },
        _avg: { durationMs: true },
        _max: { calledAt: true }
      }),
      getAPIGateway().resolveRoute({ agentId: parentAgent?.id, skillId: canonicalId.replace(/^skill:/, '') }).catch(() => null)
    ]);

    const totalCalls = callStats.reduce((s, g) => s + g._count._all, 0);
    const successCalls = callStats.find(g => g.success)?._count._all || 0;
    const successRate = totalCalls > 0 ? Number(((successCalls / totalCalls) * 100).toFixed(1)) : null;
    const avgDuration = callStats.length > 0
      ? Math.round(callStats.reduce((s, g) => s + (g._avg.durationMs || 0) * g._count._all, 0) / totalCalls || 0)
      : 0;
    const lastCalledAt = callStats.reduce<Date | null>((latest, g) => {
      if (!g._max.calledAt) return latest;
      if (!latest) return g._max.calledAt;
      return g._max.calledAt > latest ? g._max.calledAt : latest;
    }, null);

    const activePrompt = promptVersions.find(p => p.status === 'ACTIVE' || p.status === 'published') || null;

    res.json({
      success: true,
      data: {
        skill: {
          id: canonicalId,
          name: manifest.name,
          description: manifest.description,
          category: manifest.category,
          aliases: manifest.aliases || [],
          ioContractVersion: manifest.ioContractVersion,
          noPromptFile: !!manifest.noPromptFile
        },
        parentAgent: parentAgent ? {
          id: parentAgent.id,
          name: parentAgent.name,
          monitoringGroup: parentAgent.monitoringGroup
        } : null,
        modelConfig: {
          enabled: !!skillConfig?.enabled,
          tier: skillConfig?.tier || (resolvedRoute?.thinkingMode === 'enabled' || resolvedRoute?.reasoningEffort === 'high' || resolvedRoute?.reasoningEffort === 'max' ? 'reasoning' : 'chat'),
          model: resolvedRoute?.model || skillConfig?.model || null,
          thinkingMode: resolvedRoute?.thinkingMode || skillConfig?.thinkingMode || 'default',
          reasoningEffort: resolvedRoute?.reasoningEffort || skillConfig?.reasoningEffort || 'default',
          temperature: resolvedRoute?.temperature ?? skillConfig?.temperature ?? manifest.defaultModelConfig?.temperature ?? null,
          maxTokens: resolvedRoute?.maxTokens ?? skillConfig?.maxTokens ?? manifest.defaultModelConfig?.maxTokens ?? null,
          timeoutMs: resolvedRoute?.timeoutMs ?? skillConfig?.requestTimeoutMs ?? null,
          source: skillConfig?.enabled ? 'skill-override' : parentAgent ? 'agent-or-platform' : 'platform-default',
          inheritedFromAgent: !!parentAgent && !skillConfig?.enabled,
          hasSkillOverride: !!skillConfig?.enabled,
          manifestDefault: manifest.defaultModelConfig || null,
        },
        contract: contract ? {
          stage: contract.stage,
          displayName: contract.displayName,
          description: contract.description,
          schemaVersion: contract.schemaVersion,
          source: contract.source,
          managedByCode: contract.managedByCode
        } : null,
        promptVersions: promptVersions.map(p => ({
          id: p.id,
          version: p.version,
          name: p.name,
          description: p.description,
          status: p.status,
          temperature: p.temperature,
          maxTokens: p.maxTokens,
          model: p.model,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          publishedAt: p.publishedAt,
          isActive: activePrompt?.id === p.id
        })),
        activePromptId: activePrompt?.id || null,
        stats: {
          totalCalls,
          successCalls,
          successRate,
          avgDuration,
          lastCalledAt
        }
      }
    });
  } catch (error: any) {
    console.error('[skill-workbench-meta] failed:', error);
    res.status(500).json({
      success: false,
      error: { message: error?.message || 'workbench meta load failed' }
    });
  }
});

export default router;
