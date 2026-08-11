/**
 * 管理端 Skills API
 * 
 * 提供 Skill 管理、监控、测试等功能
 */

import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';
import { getGateway } from '../../gateway';
import { AgentConfigService } from '../../services/agentConfig.service';
import { getAgentManifest, getAgentOfSkill, getCanonicalAgentId } from '../../services/agent-manifest.service';
import {
  getUnifiedSkillStats,
  resolveEffectiveSkillRuntimeConfig,
  toLegacySkillRuntimeStats,
  type SkillStatsRange,
} from '../../services/skill-runtime-contract.service';
import { STAGE_DESIGNER_PROMPT } from '../../skills/stage-designer';
import { ADAPTIVE_GUIDANCE_COPY_PROMPT } from '../../skills/adaptive-guidance-copy';
import { VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT } from '../../skills/virtual-learner-persona-designer';
import { VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT } from '../../skills/virtual-learner-scenario-designer';
import { VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT } from '../../skills/virtual-learner-goal-dialogue-simulator';
import { VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT } from '../../skills/virtual-learner-path-evaluator';
import { VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT } from '../../skills/virtual-learner-learn-turn-simulator';
import { VIRTUAL_LEARNER_REFEREE_PROMPT } from '../../skills/virtual-learner-referee';
import { VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT } from '../../skills/virtual-learner-actor-auditor';
import { GOAL_UNDERSTANDING_COMPOSER_PROMPT } from '../../skills/goal-understanding-composer';
import { ACCEPTANCE_EVIDENCE_EVALUATOR_PROMPT } from '../../skills/acceptance-evidence-evaluator';
import { checkSkillsReadiness } from '../../services/skills-readiness.service';
import { analyzeW2 } from '../../services/skills-readiness.service';
import { loadSkillsBookRaw } from '../../services/skill-registry/skills-file';
import { getSkillCompletion } from '../../services/skill-registry/skill-completion.service';
import {
  scaffoldSkill,
  getScaffoldMeta,
  ScaffoldInputError,
  ScaffoldConflictError,
} from '../../services/skill-registry/skill-scaffold.service';
import { listRawManifestEntries } from '../../services/agent-manifest.service';
import { loadOrchestrationFiles } from '../../services/field-routing/orchestration-file';
import { writeNodeConfigChange } from '../../services/node-config-change-audit';

const router = Router();

const SKILL_FALLBACK_PROMPTS: Record<string, string> = {
  'stage-designer': STAGE_DESIGNER_PROMPT,
  'adaptive-guidance-copy': ADAPTIVE_GUIDANCE_COPY_PROMPT,
  'virtual-learner-persona-designer': VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT,
  'virtual-learner-scenario-designer': VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT,
  'virtual-learner-goal-dialogue-simulator': VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT,
  'virtual-learner-path-evaluator': VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT,
  'virtual-learner-learn-turn-simulator': VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT,
  'virtual-learner-referee': VIRTUAL_LEARNER_REFEREE_PROMPT,
  'virtual-learner-actor-auditor': VIRTUAL_LEARNER_ACTOR_AUDITOR_PROMPT,
  'goal-understanding-composer': GOAL_UNDERSTANDING_COMPOSER_PROMPT,
  'acceptance-evidence-evaluator': ACCEPTANCE_EVIDENCE_EVALUATOR_PROMPT,
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

async function getSkillRuntimeStats(
  skillNames: string[],
  range: SkillStatsRange = 'all'
): Promise<Map<string, SkillRuntimeStats>> {
  const unified = await getUnifiedSkillStats(skillNames, range);
  const result = new Map<string, SkillRuntimeStats>();
  for (const name of skillNames) {
    const stats = unified.get(name);
    result.set(name, stats ? toLegacySkillRuntimeStats(stats) : emptyRuntimeStats());
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
    // 时间窗口：all/24h/7d/30d（默认 all 保持兼容；前端目录页默认传 7d）
    const statsRange = (String(req.query.range || 'all')) as SkillStatsRange;
    const runtimeStats = await getSkillRuntimeStats(skills.map(s => s.definition.name), statsRange);
    
    const skillList = skills.map(s => {
      const stats = runtimeStats.get(s.definition.name) || s.definition.stats;
      const agentOf = getAgentOfSkill(s.definition.name);
      return {
        name: s.definition.name,
        version: s.definition.version,
        category: s.definition.category,
        description: s.definition.description,
        capabilities: s.definition.capabilities,
        dependencies: s.definition.dependencies,
        stats,
        lastCalledAt: runtimeStats.get(s.definition.name)?.lastCalledAt || s.lastCalledAt,
        registeredAt: s.registeredAt,
        displayName: s.definition.displayName || s.definition.name,
        agentId: agentOf?.id ?? null,
        agentName: agentOf?.name ?? null
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
 * GET /api/admin/skills/scaffold/meta
 * scaffold 表单元数据：kind/stage 枚举 + manifest kind=agent 条目（parentAgent 下拉数据源）。
 */
router.get('/scaffold/meta', async (_req: Request, res: Response) => {
  try {
    const meta = getScaffoldMeta();
    res.json({ success: true, data: meta });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'scaffold meta 加载失败' },
    });
  }
});

/**
 * POST /api/admin/skills/scaffold
 * 新建 Skill 一条龙（SCAFFOLD_P5_SURVEY §5 / SKILL_READINESS_SPEC §5 步骤 1）：
 * 确定性生成 core.yaml 骨架 + skills.yaml 条目 + 编排 contracts 追加（mainline）+ handler 占位，
 * 每个生成物写盘前后过对应校验器；注册/接线片段仅返回文本不落盘。
 *
 * 幂等（以 skills.yaml 为唯一状态事实）：
 *   条目与生成物齐备 → 409 already-exists；条目在但缺生成物 → 200 completed（补齐缺失）。
 * 响应：{ success, data: { skillId, kind, status, generated, completion, snippets, note } }
 */
router.post('/scaffold', async (req: Request, res: Response) => {
  try {
    if (process.env.SKILLS_FILE_DISABLED === '1') {
      return res.status(503).json({
        success: false,
        error: { message: 'SKILLS_FILE_DISABLED=1 过渡开关打开，户口簿未加载，拒绝写盘（无人校验）' },
      });
    }
    const outcome = await scaffoldSkill(req.body || {});
    if (outcome.status === 'already-exists') {
      return res.status(409).json({
        success: false,
        error: { message: `skillId "${outcome.skillId}" 已存在（skills.yaml 有条目且生成物齐备）；如需补齐缺失生成物请直接重放本请求` },
        data: { skillId: outcome.skillId, completion: outcome.completion },
      });
    }
    // P2 审计补强：scaffold 写 node_config_changes（changeType='skill-scaffold'，targetId=skillId，
    // before=null，after=生成物清单摘要）——审计失败不阻断写盘结果
    try {
      const actorId = (req as Request & { user?: { userId?: string } }).user?.userId || 'admin';
      const body = (req.body || {}) as { stage?: string; parentAgent?: string };
      await writeNodeConfigChange(systemPrisma, {
        changeType: 'skill-scaffold',
        targetTable: 'skills',
        targetId: outcome.skillId,
        before: null,
        after: {
          status: outcome.status,
          kind: outcome.kind,
          stage: body.stage ?? null,
          parentAgent: body.parentAgent ?? null,
          generated: outcome.generated,
          snippetCount: outcome.snippets?.length ?? 0,
        },
        actorId,
        reason: `skill scaffold 生成（status=${outcome.status}）`,
      });
    } catch (auditError) {
      console.error(`[skills:scaffold] 审计写入失败（不阻断响应）:`, auditError);
    }
    res.json({ success: true, data: outcome });
  } catch (error) {
    if (error instanceof ScaffoldInputError) {
      return res.status(400).json({ success: false, error: { message: error.message } });
    }
    if (error instanceof ScaffoldConflictError) {
      return res.status(409).json({ success: false, error: { message: error.message } });
    }
    res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'scaffold 执行失败' },
    });
  }
});

/**
 * 按分类统计
 */


/**
 * 获取 Skill-Agent 关联关系
 * 
 * 扫描所有 agent 和 orchestrator 源文件，找出每个 skill 被哪些 agent/orchestrator 引用。
 * 使用静态分析：baseDir 下的 .ts 文件是否 import 或引用该 skill。
 * 
 * 注意：此函数路由必须在 /:name 通配路由之前注册，避免 Express 把 "agent-relations" 当作 skill name 匹配。
 */

/**
 * 批量获取 Skill Prompt 摘要
 *
 * 供 Skill 目录页使用：一次请求返回每个 Skill 的 Prompt 状态摘要，
 * 避免前端对每个 Skill 分别请求版本列表和 effective-prompt（N+1 请求风暴）。
 * 单点语义与 GET /api/admin/agent-prompts?agentId=skill:x + GET /:name/effective-prompt 对齐：
 * 有任意版本时取 ACTIVE（无 ACTIVE 取最新版本），否则依次判定 code-fallback / generated-default / missing。
 *
 * 注意：此路由必须在 /:name 通配路由之前注册，避免 Express 把 "prompt-summaries" 当作 skill name 匹配。
 */

/**
 * 获取 Skill 详情
 */

/**
 * 获取 Skill 数据库统计
 */

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
      // 404 降级（SKILL_READINESS_SPEC §1.2/§1.3）：不在 manifest 但户口簿有登记的 skill
      // （scaffold 后、manifest 代码未合并前）→ 200 + draft 态 completion，否则才 404。
      const shortSkillId = canonicalId.replace(/^skill:/, '');
      const bookEntry = loadSkillsBookRaw().skills.find((entry) => entry.skillId === shortSkillId);
      if (bookEntry) {
        const completion = await getSkillCompletion(bookEntry.skillId);
        return res.json({
          success: true,
          data: {
            draft: true,
            completion,
            displayName: bookEntry.displayName || shortSkillId,
            description: bookEntry.description || null,
          },
        });
      }
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
    const shortSkillId = canonicalId.replace(/^skill:/, '');
    const statsRange = String(req.query.range || 'all') as SkillStatsRange;
    const normalizedRange: SkillStatsRange =
      statsRange === '24h' || statsRange === '7d' || statsRange === '30d' || statsRange === 'all'
        ? statsRange
        : 'all';

    const [promptVersions, contract, effective, unifiedStats] = await Promise.all([
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
      resolveEffectiveSkillRuntimeConfig(shortSkillId),
      getUnifiedSkillStats([shortSkillId], normalizedRange),
    ]);

    const stats = unifiedStats.get(shortSkillId);
    const activePrompt = promptVersions.find(p => p.status === 'ACTIVE' || p.status === 'published') || null;

    // 完成度状态机（SKILL_READINESS_SPEC §1）：派生投影，复用本次查询的 promptVersions/stats
    const completion = await getSkillCompletion(shortSkillId, {
      activePromptIds: new Set(
        promptVersions.some((p) => p.status === 'ACTIVE') ? [canonicalId] : [],
      ),
      lastCalledAt: stats?.lastCalledAt ? new Date(stats.lastCalledAt).toISOString() : null,
    });

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
        completion,
        parentAgent: parentAgent ? {
          id: parentAgent.id,
          name: parentAgent.name,
          monitoringGroup: parentAgent.monitoringGroup
        } : null,
        modelConfig: {
          enabled: effective.route.hasSkillOverride,
          tier: effective.route.thinkingMode === 'enabled'
            || effective.route.reasoningEffort === 'high'
            || effective.route.reasoningEffort === 'max'
            ? 'reasoning'
            : 'chat',
          // 头部展示真实 LLM 生效模型（prompt 优先）
          model: effective.llmRequest.model,
          thinkingMode: effective.route.thinkingMode || 'default',
          reasoningEffort: effective.route.reasoningEffort || 'default',
          temperature: effective.llmRequest.temperature,
          maxTokens: effective.llmRequest.maxTokens,
          timeoutMs: effective.route.timeoutMs,
          source: effective.route.source,
          inheritedFromAgent: !!parentAgent && !effective.route.hasSkillOverride,
          hasSkillOverride: effective.route.hasSkillOverride,
          manifestDefault: manifest.defaultModelConfig || null,
          route: effective.route,
          llmRequest: effective.llmRequest,
          override: effective.override,
          reliability: {
            maxUpstreamAttempts: effective.reliability.maxUpstreamAttempts,
            maxTransportRetries: effective.reliability.maxTransportRetries,
            maxLogicalRetries: effective.reliability.maxLogicalRetries,
            logicalRetrySource: effective.reliability.logicalRetrySource,
            platformMaxLogicalRetries: effective.reliability.platformMaxLogicalRetries,
            businessFallback: 'code-defined'
          }
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
          totalCalls: stats?.callCount || 0,
          successCalls: stats?.successCount || 0,
          successRate: stats?.successRate ?? null,
          avgDuration: stats?.avgDurationMs || 0,
          lastCalledAt: stats?.lastCalledAt || null,
          source: stats?.source || 'none',
          range: normalizedRange,
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

/**
 * GET /api/admin/skills/reconciliation
 *
 * 技能四向对账（SKILL_READINESS_SPEC §4.2）：户口簿 / manifest / gateway 注册 / ACTIVE prompt
 * 全量逐 skill 状态 + 完成度状态机投影 + 差集标记（unregistered / active-missing），
 * 另附注册表幽灵残留（户口簿无登记）清单。前端 Skills.vue 对账面板唯一数据源。
 */
router.get('/reconciliation', async (req: Request, res: Response) => {
  try {
    const book = loadSkillsBookRaw();
    const manifestSkillIds = new Set(
      listRawManifestEntries()
        .filter((item) => item.kind === 'skill' && item.id.startsWith('skill:'))
        .map((item) => item.id.slice('skill:'.length)),
    );
    const [activeRows, registrations] = await Promise.all([
      systemPrisma.agent_prompts.findMany({
        where: { status: 'ACTIVE' },
        select: { agentId: true },
      }),
      systemPrisma.skill_registrations.findMany({
        select: { name: true },
      }),
    ]);
    const activeIds = new Set(activeRows.map((row) => row.agentId));
    const registeredNames = new Set(registrations.map((row) => row.name));

    // 注册豁免点（agents/platform-direct 不落 skill_registrations 是预期，W2 语义）
    const w2 = analyzeW2(book, registrations);
    const exemptRegistrationPoints = new Set(['agents', 'platform-direct']);
    const unregisteredSet = new Set(w2.missingRegistration);
    const orphanRegistrations = registrations
      .map((row) => row.name)
      .filter((name) => !book.skills.some((entry) => entry.skillId === name))
      .sort();

    const orchestrationStages = loadOrchestrationFiles();
    const items: Array<Record<string, unknown>> = [];
    const byStatus: Record<string, number> = {};
    let activeCount = 0;
    let registeredCount = 0;

    for (const entry of book.skills) {
      const completion = await getSkillCompletion(entry.skillId, {
        book,
        orchestrationStages,
        activePromptIds: activeIds,
      });
      const registered = registeredNames.has(entry.skillId);
      const registrationExempt = exemptRegistrationPoints.has(entry.registrationPoint || 'skillHandlers');
      const active = entry.noPromptFile === true ? true : activeIds.has(`skill:${entry.skillId}`);
      if (registered) registeredCount += 1;
      if (active) activeCount += 1;
      byStatus[completion.status] = (byStatus[completion.status] || 0) + 1;

      let diff: 'unregistered' | 'active-missing' | null = null;
      if (!registered && !registrationExempt) diff = 'unregistered';
      else if (!active && entry.noPromptFile !== true) diff = 'active-missing';

      items.push({
        skillId: entry.skillId,
        kind: entry.kind,
        displayName: entry.displayName || null,
        stage: entry.stage || null,
        parentAgent: entry.parentAgent || null,
        book: true,
        manifest: manifestSkillIds.has(entry.skillId),
        registered,
        active,
        noPromptFile: entry.noPromptFile === true,
        registrationExempt,
        diff,
        completion,
      });
    }

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        summary: {
          total: book.skills.length,
          registered: registeredCount,
          active: activeCount,
          byStatus,
          unregistered: unregisteredSet.size,
          activeMissing: items.filter((item) => item.diff === 'active-missing').length,
          orphanRegistrations: orphanRegistrations.length,
        },
        items,
        orphanRegistrations: orphanRegistrations.map((name) => ({ name })),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error?.message || 'skills reconciliation failed' },
    });
  }
});

/**
 * GET /api/admin/skills/readiness
 *
 * W1-W5 技能完成度诊断（SKILL_READINESS_SPEC §3，全 warn 不阻断 ready）：
 * 默认返回 60s 缓存；?refresh=1 时总是重算（按需正确性优先）。
 * 结构：{ checks: { W1..W5 }, generatedAt }，与 readiness.service 启动异步通道同一份报告。
 */
router.get('/readiness', async (req: Request, res: Response) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const report = await checkSkillsReadiness(systemPrisma as any, { skipCache: refresh });
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error?.message || 'skills readiness check failed' }
    });
  }
});

export default router;
