/**
 * Admin · Prompt 运营开发与评估中心
 * ============================================================
 * 服务于 /admin/agent-registry（V3.6 重构后的 Prompt 运营中心）
 *
 * 提供能力：
 *   1. agent 概览（File / DB / .ts 兜底 三源徽章）
 *   2. Prompt 评估集 CRUD（prompt_eval_cases）
 *   3. Prompt 评估运行 + 历史（prompt_eval_runs，对接现有 prompt-stability）
 *   4. 协议视图（Goal→Path / Path→Learn 只读上下文）
 *
 * 不在此文件内做的：
 *   - 不重写 prompt-stability（仅在内部转发它处理 skill:goal-conversation）
 *   - 不动 callPrompt / defaultSystemPrompt
 */

import { Router, Request, Response } from 'express';
import { rejectPromptOpsRuntimeMutation } from '../../middleware/prompt-file-truth.middleware';
import { randomUUID } from 'crypto';
import systemPrisma from '../../config/system-database';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { loadAllPromptFiles } from '../../composers/prompt-files/loader';
import {
  getCanonicalAgentId,
  getAgentManifest,
} from '../../services/agent-manifest.service';
import { goalConversationAgentDefinition } from '../../skills/goal-conversation';
import { executeSkill } from '../../skills';
import {
  parsePromptSchema,
} from '../../services/prompt-schema';
import { compilePrompt } from '../../services/prompt-compiler';
import {
  listTopLevelAgents,
  listSkillsOfAgent,
} from '../../services/agent-manifest.service';
import { resolveRuntimeContractsForAgents } from '../../services/prompt-lab/resolve-runtime-contract';

const router = Router();
router.use(rejectPromptOpsRuntimeMutation);

// ============================================================
// ============================================================
// 已知 .ts 文件中仍保留 defaultSystemPrompt 兜底常量的 agent（已废弃）
// 所有 prompt 已迁移至 prompts/*.md → DB agent_prompts ACTIVE，
// 硬编码 DEFAULT_PROMPT 常量已在 2026-06 架构清理中移除。
// ============================================================

// ============================================================
// Skill 中文显示名（admin 运营视角友好）
// 主流程：manifest → 这个表 → file/db name → agentId
// ============================================================
const SKILL_DISPLAY_NAMES: Record<string, string> = {
  'skill:adaptive-guidance-copy': '自适应引导文案',
  'skill:lesson-knowledge-enricher': '课后知识增强',
  'skill:learning-predictor': '学习表现预测',
  'skill:peer-reinforcement': '同伴强化对话',
  'skill:session-knowledge-distiller': '会话知识沉淀',
  'skill:stage-designer': '阶段设计师',
  'skill:virtual-learner-goal-dialogue-simulator': '虚拟学员·目标对话模拟',
  'skill:virtual-learner-learn-turn-simulator': '虚拟学员·教学回合模拟',
  'skill:virtual-learner-path-evaluator': '虚拟学员·路径评估',
  'skill:virtual-learner-persona-designer': '虚拟学员·人设设计',
  'skill:virtual-learner-scenario-designer': '虚拟学员·场景设计',
};

// ============================================================
// agentId → stage 映射（运营在 AI 起草时挑该 stage 的字段）
// stage 与 OrchestratorDefinitions 页一致：澄清(goal) / 规划(path) / 学习(learning)
// 暂未迁移到字段路由的 agent 留空，前端会回退到「手填字段 ID」
// ============================================================
const AGENT_STAGE_MAP: Record<string, 'goal' | 'path' | 'teaching' | 'profile'> = {
  'skill:goal-conversation': 'goal',
  // 以下虽未迁移但确定隶属的 stage
  'skill:path-planning': 'path',
  'skill:stage-designer': 'path',
  'skill:teaching-turn': 'teaching',
  'skill:session-wrapup': 'teaching',
  'skill:peer-reinforcement': 'teaching',
  'skill:adaptive-guidance-copy': 'teaching',
  'skill:lesson-knowledge-enricher': 'profile',
};

// ============================================================
// 简化的 hash（用于文件 vs DB 漂移可视化）
// ============================================================
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function trimForPreview(text: string, max = 240): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ============================================================
// GET /api/admin/prompt-ops/agent-overview
// 返回每个 agent 的 prompt 来源情况（File / DB / .ts 兜底）
// ============================================================
router.get('/agent-overview', async (_req: Request, res: Response) => {
  try {
    const files = loadAllPromptFiles();
    const dbActives = await systemPrisma.agent_prompts.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        agentId: true,
        version: true,
        name: true,
        systemPrompt: true,
        temperature: true,
        maxTokens: true,
        model: true,
        publishedAt: true,
        useCount: true,
      },
      orderBy: { agentId: 'asc' },
    });
    const dbDraftCounts = await systemPrisma.agent_prompts.groupBy({
      by: ['agentId'],
      where: { status: 'DRAFT' },
      _count: { _all: true },
    });

    const fileByAgent = new Map<string, ReturnType<typeof loadAllPromptFiles>[number]>();
    for (const f of files) {
      fileByAgent.set(f.agentId, f);
      if (Array.isArray(f.acceptableAgentIds)) {
        for (const alias of f.acceptableAgentIds) {
          fileByAgent.set(alias, f);
        }
      }
    }
    const dbByAgent = new Map<string, (typeof dbActives)[number]>();
    for (const r of dbActives) dbByAgent.set(r.agentId, r);
    const draftCountByAgent = new Map<string, number>();
    for (const r of dbDraftCounts) draftCountByAgent.set(r.agentId, r._count._all);

    const allAgentIds = new Set<string>([
      ...files.map((f) => f.agentId),
      ...dbActives.map((r) => r.agentId),
    ]);

    const agentIdList = Array.from(allAgentIds);
    const archetypeByAgent = new Map<string, string>();
    for (const agentId of agentIdList) {
      const file = fileByAgent.get(agentId);
      const archetype = (file as any)?.archetype;
      if (typeof archetype === 'string' && archetype.trim()) {
        archetypeByAgent.set(agentId, archetype.trim());
      }
    }
    const runtimeContracts = await resolveRuntimeContractsForAgents(agentIdList, archetypeByAgent);

    const items = agentIdList
      .map((agentId) => {
        const file = fileByAgent.get(agentId);
        const db = dbByAgent.get(agentId);
        const manifest = getAgentManifest(agentId);
        const runtimeResolved = runtimeContracts.get(agentId);

        const fileHash = file ? simpleHash(file.systemPrompt) : null;
        const dbHash = db ? simpleHash(db.systemPrompt) : null;
        const drift =
          file && db ? (fileHash !== dbHash ? 'file-vs-db-mismatch' : 'in-sync') : null;

        const sources = {
          file: !!file,
          db: !!db,
          tsFallback: false,
        };

        // 健康度评级
        let health: 'good' | 'warn' | 'risk' = 'good';
        if (!file && !db) health = 'risk';
        else if (!file || !db) health = 'warn';
        else if (drift === 'file-vs-db-mismatch') health = 'warn';

        // displayName 优先级：manifest 中文名 > skill 静态映射 > file.name 非默认 > db.name 非默认 > agentId
        const fileName = file?.name && !/^default-/.test(file.name) ? file.name : null;
        const dbName = db?.name && !/^default-/.test(db.name) ? db.name : null;
        const displayName =
          manifest?.name ||
          SKILL_DISPLAY_NAMES[agentId] ||
          fileName ||
          dbName ||
          agentId;

        return {
          agentId,
          kind: 'skill' as const,
          displayName,
          description: manifest?.description || file?.description || null,
          archetype: (file as any)?.archetype || null,
          promptContract: (file as any)?.promptContract || null,
          stage: AGENT_STAGE_MAP[agentId] || null,
          sources,
          health,
          runtimeContract: runtimeResolved?.contract || null,
          runtimeContractSource: runtimeResolved?.source || null,
          file: file
            ? {
                path: `prompts/${agentId.replace(/:/g, '.')}.md`,
                hash: fileHash,
                preview: trimForPreview(file.systemPrompt),
                charCount: file.systemPrompt.length,
                temperature: file.temperature ?? null,
                maxTokens: file.maxTokens ?? null,
              }
            : null,
          db: db
            ? {
                id: db.id,
                version: db.version,
                name: db.name,
                hash: dbHash,
                preview: trimForPreview(db.systemPrompt),
                charCount: db.systemPrompt.length,
                temperature: db.temperature,
                maxTokens: db.maxTokens,
                model: db.model,
                publishedAt: db.publishedAt,
                useCount: db.useCount,
                draftCount: draftCountByAgent.get(agentId) || 0,
              }
            : { draftCount: draftCountByAgent.get(agentId) || 0 },
          drift,
          schemaLint: (() => {
            // 基于 ACTIVE 的 prompt 文本（优先 file，否则 db）做 schema lint
            const sourceText =
              file?.systemPrompt || db?.systemPrompt || null;
            if (!sourceText) {
              return {
                conformant: false,
                ruleCount: 0,
                warningCount: 0,
                topWarning: null as string | null,
                rulePrefix: null as string | null,
              };
            }
            const schema = parsePromptSchema(sourceText);
            return {
              conformant: schema.conformant,
              ruleCount: schema.rules.length,
              warningCount: schema.warnings.length,
              topWarning: schema.warnings[0] || null,
              rulePrefix: schema.rules[0]?.prefix || null,
            };
          })(),
        };
      })
      .sort((a, b) => a.agentId.localeCompare(b.agentId));

    const summary = {
      totalAgents: items.length,
      filePresent: items.filter((i) => i.sources.file).length,
      dbPresent: items.filter((i) => i.sources.db).length,
      healthGood: items.filter((i) => i.health === 'good').length,
      healthWarn: items.filter((i) => i.health === 'warn').length,
      healthRisk: items.filter((i) => i.health === 'risk').length,
      driftCount: items.filter((i) => i.drift === 'file-vs-db-mismatch').length,
      schemaConformant: items.filter((i) => i.schemaLint?.conformant).length,
      schemaWithWarnings: items.filter(
        (i) => i.schemaLint && i.schemaLint.warningCount > 0
      ).length,
    };

    return res.json({ success: true, data: { summary, items } });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] agent-overview failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || 'agent-overview 加载失败' },
    });
  }
});

// ============================================================
// GET /api/admin/prompt-ops/skill-rules-overview
// 全局 R-XX-NN 规则总览（用于「Skill 规则总览」抽屉）
// 返回每个 skill / agent 的规则项，并按 prefix 分组聚合
// ============================================================
router.get('/skill-rules-overview', async (_req: Request, res: Response) => {
  try {
    const allFiles = loadAllPromptFiles();
    const dbActives = await systemPrisma.agent_prompts.findMany({
      where: { status: 'ACTIVE' },
      select: { agentId: true, systemPrompt: true, version: true },
    });
    const dbByAgent = new Map<string, (typeof dbActives)[number]>();
    for (const r of dbActives) dbByAgent.set(r.agentId, r);

    interface RuleEntry {
      ruleId: string;
      prefix: string;
      index: number;
      text: string;
      agentId: string;
      agentDisplayName: string;
      source: 'db' | 'file';
    }

    const allRules: RuleEntry[] = [];

    for (const file of allFiles) {
      const dbRow = dbByAgent.get(file.agentId);
      const sourceText = dbRow?.systemPrompt || file.systemPrompt;
      const source: 'db' | 'file' = dbRow ? 'db' : 'file';
      const schema = parsePromptSchema(sourceText);
      const manifest = getAgentManifest(file.agentId);
      const displayName =
        manifest?.name ||
        SKILL_DISPLAY_NAMES[file.agentId] ||
        file.name ||
        file.agentId;
      for (const r of schema.rules) {
        allRules.push({
          ruleId: r.id,
          prefix: r.prefix,
          index: r.index,
          text: r.text,
          agentId: file.agentId,
          agentDisplayName: displayName,
          source,
        });
      }
    }

    // 按 prefix 分组
    const byPrefix: Record<
      string,
      Array<RuleEntry>
    > = {};
    for (const r of allRules) {
      if (!byPrefix[r.prefix]) byPrefix[r.prefix] = [];
      byPrefix[r.prefix].push(r);
    }
    // 每组内按 index 排序
    for (const prefix in byPrefix) {
      byPrefix[prefix].sort((a, b) => a.index - b.index);
    }

    // 检查 prefix → agent 映射唯一性
    const prefixOwners: Record<string, Set<string>> = {};
    for (const r of allRules) {
      if (!prefixOwners[r.prefix]) prefixOwners[r.prefix] = new Set();
      prefixOwners[r.prefix].add(r.agentId);
    }
    const conflictPrefixes: Array<{ prefix: string; agentIds: string[] }> = [];
    for (const prefix in prefixOwners) {
      if (prefixOwners[prefix].size > 1) {
        conflictPrefixes.push({
          prefix,
          agentIds: Array.from(prefixOwners[prefix]),
        });
      }
    }

    return res.json({
      success: true,
      data: {
        summary: {
          totalRules: allRules.length,
          totalPrefixes: Object.keys(byPrefix).length,
          totalAgentsWithRules: new Set(allRules.map((r) => r.agentId)).size,
          conflictPrefixCount: conflictPrefixes.length,
        },
        byPrefix,
        conflictPrefixes,
      },
    });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] skill-rules-overview failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '加载规则总览失败' },
    });
  }
});

// ============================================================
// GET /api/admin/prompt-ops/sandbox-view
// 沙盘契约视图（只读）：5 个顶层 agent 的输入通道/输出字段/合法沙盘键
// 数据源：routings 表 + core fields 声明（agent-contract-view 动态推导）
// ============================================================
router.get('/sandbox-view', async (_req: Request, res: Response) => {
  try {
    const { buildAllAgentSandboxViews, SANDBOX_AGENT_IDS, SANDBOX_EXTRA_KEYS } = await import('../../services/agent-contract-view');
    const views = await buildAllAgentSandboxViews();
    res.json({
      success: true,
      data: {
        agents: views,
        agentIds: [...SANDBOX_AGENT_IDS],
        extraKeys: SANDBOX_EXTRA_KEYS,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '加载沙盘视图失败' } });
  }
});

// ============================================================
// GET /api/admin/prompt-ops/protocol-view
// 只读协议视图：Goal→Path / Path→Learn 关键 schema
// 当前：硬编码（来源于代码静态导出，避免运行时反射）
// ============================================================
router.get('/protocol-view', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    data: {
      protocols: [
        {
          id: 'goal-to-path',
          title: 'Goal → Path 协议',
          status: 'direct-call',
          statusLabel: '直接方法调用 · 未事件总线化',
          summary:
            'PathOrchestrator.runGoalAsync(GoalPathRequest) 由 goal-conversation 服务在用户确认目标后直接同/异步调用。',
          callSites: [
            'services/learning/goal-conversation.service.ts:345',
            'services/learning/goal-conversation.service.ts:434',
            'routes/learning.ts:484',
            'routes/learning.ts:554',
          ],
          schema: {
            interface: 'GoalPathRequest',
            file: 'orchestrators/path.orchestrator.ts:76-89',
            fields: [
              { name: 'userId', type: 'string', required: true, description: '用户 ID' },
              {
                name: 'sourceConversationId',
                type: 'string?',
                required: false,
                description: '来源对话 ID',
              },
              {
                name: 'existingPathId',
                type: 'string?',
                required: false,
                description: '已存在的 path ID（重生成）',
              },
              { name: 'rawGoal', type: 'string', required: true, description: '用户原话目标' },
              {
                name: 'visibleSummary',
                type: 'GoalPathVisibleSummary',
                required: false,
                description:
                  '结构化「理解」(real_problem / surface_goal / motivation / urgency / time)',
              },
              {
                name: 'conversationHistory',
                type: 'Array<{role, content}>',
                required: false,
                description: '历史对话',
              },
              { name: 'finalUserVisible', type: 'string?', required: false, description: '最终回复' },
              {
                name: 'systemPromptOverrides.pathAgent',
                type: 'string?',
                required: false,
                description: 'PathAgent prompt 覆盖（仅 admin 调试）',
              },
            ],
          },
        },
        {
          id: 'path-to-learn',
          title: 'Path → Learn 协议',
          status: 'json-blob',
          statusLabel: 'JSON blob 列存储 · 弱类型',
          summary:
            'learning_paths.aiPromptTemplate 是 String 列，承载 goalFinal / pathSummary / cognitiveDesign / generationStatus / adjustmentPolicy 等多类负载。',
          callSites: [
            'services/learning/learning.service.ts:1565,2115,2144,2345,3081',
            'services/ai-teaching/TeachingContextBuilder.ts:122,434,448',
            'services/learner/LearnerSnapshotService.ts:396',
          ],
          schema: {
            interface: 'aiPromptTemplate (JSON String)',
            file: 'prisma/schema.prisma:511 · learning_paths.aiPromptTemplate',
            fields: [
              { name: 'goalFinal', type: 'object?', required: false, description: '目标确认时的 visibleSummary 快照' },
              {
                name: 'pathSummary',
                type: 'object?',
                required: false,
                description: '路径概览（教学用）',
              },
              {
                name: 'sceneSummary',
                type: 'object?',
                required: false,
                description: '场景情境包',
              },
              {
                name: 'cognitiveDesign',
                type: 'object?',
                required: false,
                description: '认知设计：目标层 / 阶段 / 概念绑定',
              },
              {
                name: 'generationStatus',
                type: 'object?',
                required: false,
                description: '生成状态机',
              },
              {
                name: 'adjustmentPolicy',
                type: 'object?',
                required: false,
                description: '动态调整策略',
              },
              {
                name: 'milestoneConceptBindings',
                type: 'array?',
                required: false,
                description: '里程碑概念绑定',
              },
            ],
          },
        },
      ],
      notes: [
        '本视图为静态摘要，反映当前代码 V3.6 时的协议形态。',
        '改造路线：详见 doc/AGENT_IO_DESIGN_V3.md（Phase 2 计划：Path 阶段字段路由化 → 替换 aiPromptTemplate JSON blob）。',
        '修改这两份协议涉及多 service 重构，不在 Prompt 运营中心范围内。',
      ],
    },
  });
});

// ============================================================
// GET /api/admin/prompt-ops/eval-cases?agentId=xxx
// 列出某 agent 的所有评估用例
// ============================================================
router.get('/eval-cases', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.query.agentId || '').trim();
    const where = agentId ? { agentId } : {};
    const cases = await systemPrisma.prompt_eval_cases.findMany({
      where,
      orderBy: [{ agentId: 'asc' }, { createdAt: 'asc' }],
    });
    return res.json({
      success: true,
      data: cases.map((c) => ({
        id: c.id,
        agentId: c.agentId,
        caseId: c.caseId,
        name: c.name,
        description: c.description,
        messages: safeParse(c.messagesJson, []),
        previousState: safeParse(c.previousStateJson, null),
        expectations: safeParse(c.expectationsJson, null),
        enabled: c.enabled,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] list eval-cases failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '加载评估用例失败' },
    });
  }
});

// ============================================================
// POST /api/admin/prompt-ops/eval-cases
// 创建评估用例
// ============================================================
router.post('/eval-cases', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const agentId = String(body.agentId || '').trim();
    const name = String(body.name || '').trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (!agentId || !name) {
      return res
        .status(400)
        .json({ success: false, error: { message: 'agentId / name 必填' } });
    }
    if (messages.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: { message: '至少 1 条 message' } });
    }

    const caseId =
      String(body.caseId || '').trim() || `case-${Date.now().toString(36)}`;

    // 唯一性
    const dup = await systemPrisma.prompt_eval_cases.findUnique({
      where: { agentId_caseId: { agentId, caseId } },
    });
    if (dup) {
      return res.status(409).json({
        success: false,
        error: { message: `用例 caseId=${caseId} 已存在` },
      });
    }

    const created = await systemPrisma.prompt_eval_cases.create({
      data: {
        id: randomUUID(),
        agentId,
        caseId,
        name,
        description: body.description ? String(body.description) : null,
        messagesJson: JSON.stringify(messages),
        previousStateJson: body.previousState
          ? JSON.stringify(body.previousState)
          : null,
        expectationsJson: body.expectations
          ? JSON.stringify(body.expectations)
          : null,
        enabled: body.enabled !== false,
        createdBy: (req as any).user?.userId || null,
      },
    });

    return res.status(201).json({ success: true, data: { id: created.id } });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] create eval-case failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '创建评估用例失败' },
    });
  }
});

// ============================================================
// PUT /api/admin/prompt-ops/eval-cases/:id
// ============================================================
router.put('/eval-cases/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const data: any = { updatedAt: new Date() };
    if (typeof body.name === 'string') data.name = body.name.trim();
    if (typeof body.description === 'string') data.description = body.description;
    if (Array.isArray(body.messages)) data.messagesJson = JSON.stringify(body.messages);
    if (body.previousState !== undefined) {
      data.previousStateJson = body.previousState
        ? JSON.stringify(body.previousState)
        : null;
    }
    if (body.expectations !== undefined) {
      data.expectationsJson = body.expectations
        ? JSON.stringify(body.expectations)
        : null;
    }
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled;

    await systemPrisma.prompt_eval_cases.update({ where: { id }, data });
    return res.json({ success: true });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] update eval-case failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '更新评估用例失败' },
    });
  }
});

// ============================================================
// DELETE /api/admin/prompt-ops/eval-cases/:id
// ============================================================
router.delete('/eval-cases/:id', async (req: Request, res: Response) => {
  try {
    await systemPrisma.prompt_eval_cases.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] delete eval-case failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '删除评估用例失败' },
    });
  }
});

// ============================================================
// POST /api/admin/prompt-ops/run-eval
// 跑评估并把结果写进 prompt_eval_runs
// 复用 prompt-stability 的逻辑（但仅当 agentId === skill:goal-conversation 时多轮）
// 其他 agent 仅做"单条试跑"占位（运营层面够用，重计算交给本地 LLM）
//
// Body:
//   {
//     agentId: string,
//     promptVersionId?: string | null,   // 选用 DB 版本
//     promptVersion?: number | null,     // 选用 DB 版本号
//     customPrompt?: string,             // 当前正在编辑的草稿内容
//     model?: string,
//     repeatCount?: number,              // 仅 goal-conversation 多轮
//     caseIds?: string[],                // DB 用例;省略=全部 enabled
//     adhocCases?: Array<{...}>          // 临时未保存的用例
//   }
// ============================================================
router.post('/run-eval', async (req: Request, res: Response) => {
  const body = req.body || {};
  const requestedAgentId = String(body.agentId || '').trim();
  const canonicalAgentId = getCanonicalAgentId(requestedAgentId);

  if (!canonicalAgentId) {
    return res
      .status(400)
      .json({ success: false, error: { message: 'agentId 必填' } });
  }

  if (canonicalAgentId !== 'skill:goal-conversation') {
    return res.status(400).json({
      success: false,
      error: {
        message:
          '当前评测器仅内置 skill:goal-conversation 的 handler 路由；' +
          '其他 agent 请使用单条试跑（runtime-definitions/test），或实现对应的 evalAdapter',
      },
    });
  }

  try {
    // 解析 prompt
    const promptConfig = await resolvePrompt(canonicalAgentId, body);

    // 解析用例
    const dbCases = Array.isArray(body.caseIds) && body.caseIds.length
      ? await systemPrisma.prompt_eval_cases.findMany({
          where: {
            agentId: canonicalAgentId,
            caseId: { in: body.caseIds.map((s: any) => String(s)) },
            enabled: true,
          },
        })
      : await systemPrisma.prompt_eval_cases.findMany({
          where: { agentId: canonicalAgentId, enabled: true },
        });

    const adhocCases = Array.isArray(body.adhocCases) ? body.adhocCases : [];

    const evalCases = [
      ...dbCases.map((c) => ({
        id: c.caseId,
        name: c.name,
        messages: safeParse(c.messagesJson, []),
        previousState: safeParse(c.previousStateJson, null),
        expectations: safeParse(c.expectationsJson, null),
      })),
      ...adhocCases.map((c: any, idx: number) => ({
        id: c.id || `adhoc-${idx + 1}`,
        name: c.name || `Ad-hoc ${idx + 1}`,
        messages: Array.isArray(c.messages) ? c.messages : [],
        previousState: c.previousState || null,
        expectations: c.expectations || null,
      })),
    ].filter((c) => c.messages.length > 0);

    if (!evalCases.length) {
      return res.status(400).json({
        success: false,
        error: { message: '没有可用的评估用例（DB 用例或 ad-hoc）' },
      });
    }

    const repeatCount = Math.max(1, Math.min(5, Number(body.repeatCount || 1)));
    const startedAt = Date.now();
    const results: any[] = [];
    const previousEnvModel = process.env.AI_MODEL;
    if (promptConfig.model) {
      process.env.AI_MODEL = promptConfig.model;
    }

    try {
      for (const item of evalCases) {
        for (let runIdx = 0; runIdx < repeatCount; runIdx += 1) {
          const lastUser = [...item.messages]
            .reverse()
            .find((m: any) => m.role === 'user');
          const userInput = String(lastUser?.content || '');
          const history = item.messages
            .slice(0, -1)
            .map((m: any) => ({ role: m.role, content: m.content }));
          const previousState = item.previousState || {};

          const callStart = Date.now();
          const result = await executeSkill(goalConversationAgentDefinition, {
            input: userInput,
            userId: 'admin-prompt-ops',
            conversationHistory: history,
            previousUnderstanding: previousState?.understanding || {},
            previousStage: previousState?.stage || 'understanding',
            previousState,
            maxFormatRetries: 2,
            systemPromptOverride: promptConfig.systemPrompt,
          });
          const durationMs = Date.now() - callStart;

          // 期望检查
          const expectations = item.expectations || {};
          const userVisible = String(result?.userVisible || '');
          const checks: Record<string, boolean> = {
            structuredOutputValid:
              result?.debug?.structuredOutputValid === true,
            stageValid: !!result?.internal?.core?.stage,
          };
          if (Array.isArray(expectations.mustIncludeFields)) {
            for (const field of expectations.mustIncludeFields) {
              checks[`mustInclude:${field}`] = JSON.stringify(result).includes(
                String(field)
              );
            }
          }
          if (Array.isArray(expectations.mustNotInclude)) {
            for (const phrase of expectations.mustNotInclude) {
              checks[`mustNotInclude:${phrase}`] = !userVisible.includes(
                String(phrase)
              );
            }
          }
          if (
            typeof expectations.expectedStage === 'string' &&
            expectations.expectedStage
          ) {
            checks.expectedStage =
              result?.internal?.core?.stage === expectations.expectedStage;
          }

          const passed = Object.values(checks).every(Boolean);

          results.push({
            caseId: item.id,
            caseName: item.name,
            runIndex: runIdx + 1,
            durationMs,
            input: { userInput, conversationContextCount: history.length, previousState },
            output: {
              userVisible,
              stage: result?.internal?.core?.stage || 'understanding',
              confidence: result?.internal?.core?.confidence || 0,
            },
            debug: {
              promptVersion: result?.debug?.promptVersion || promptConfig.promptVersion,
              attemptCount: result?.debug?.attemptCount || 0,
              parseMode: result?.debug?.parseMode || 'none',
              failureType: result?.debug?.failureType || 'none',
              structuredOutputValid:
                result?.debug?.structuredOutputValid === true,
            },
            checks,
            passed,
          });
        }
      }
    } finally {
      if (typeof previousEnvModel === 'string') {
        process.env.AI_MODEL = previousEnvModel;
      } else {
        delete process.env.AI_MODEL;
      }
    }

    const totalRuns = results.length;
    const passedCount = results.filter((r) => r.passed).length;
    const structuredCount = results.filter(
      (r) => r.debug.structuredOutputValid
    ).length;

    const summary = {
      totalRuns,
      caseCount: evalCases.length,
      repeatCount,
      passedCount,
      passRate: totalRuns
        ? Number(((passedCount / totalRuns) * 100).toFixed(1))
        : 0,
      structuredSuccessRate: totalRuns
        ? Number(((structuredCount / totalRuns) * 100).toFixed(1))
        : 0,
      avgDurationMs:
        totalRuns > 0
          ? Math.round(
              results.reduce((sum, r) => sum + Number(r.durationMs || 0), 0) /
                totalRuns
            )
          : 0,
      promptSource: promptConfig.source,
      promptVersion: promptConfig.promptVersion,
      model: promptConfig.model,
    };

    const totalDuration = Date.now() - startedAt;

    // 写历史
    const runRecord = await systemPrisma.prompt_eval_runs.create({
      data: {
        id: randomUUID(),
        agentId: canonicalAgentId,
        promptVersionId: body.promptVersionId || null,
        promptVersion: body.promptVersion || null,
        promptSource: promptConfig.source,
        mode: 'eval-set',
        caseCount: evalCases.length,
        totalRuns,
        summaryJson: JSON.stringify(summary),
        resultsJson: JSON.stringify(results.slice(0, 50)),
        durationMs: totalDuration,
        triggeredBy: (req as any).user?.userId || null,
      },
    });

    return res.json({
      success: true,
      data: {
        runId: runRecord.id,
        summary,
        results,
      },
    });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] run-eval failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '评估运行失败' },
    });
  }
});

// ============================================================
// GET /api/admin/prompt-ops/eval-runs?agentId=xxx&limit=20
// ============================================================
router.get('/eval-runs', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.query.agentId || '').trim();
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const where = agentId ? { agentId } : {};
    const runs = await systemPrisma.prompt_eval_runs.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return res.json({
      success: true,
      data: runs.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        promptVersionId: r.promptVersionId,
        promptVersion: r.promptVersion,
        promptSource: r.promptSource,
        mode: r.mode,
        caseCount: r.caseCount,
        totalRuns: r.totalRuns,
        summary: safeParse(r.summaryJson, {}),
        durationMs: r.durationMs,
        triggeredBy: r.triggeredBy,
        createdAt: r.createdAt,
      })),
    });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] list eval-runs failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '加载评估历史失败' },
    });
  }
});

// ============================================================
// GET /api/admin/prompt-ops/eval-runs/:id
// 单次评估的完整结果（含 results）
// ============================================================
router.get('/eval-runs/:id', async (req: Request, res: Response) => {
  try {
    const r = await systemPrisma.prompt_eval_runs.findUnique({
      where: { id: req.params.id },
    });
    if (!r) {
      return res
        .status(404)
        .json({ success: false, error: { message: '运行记录不存在' } });
    }
    return res.json({
      success: true,
      data: {
        id: r.id,
        agentId: r.agentId,
        promptVersionId: r.promptVersionId,
        promptVersion: r.promptVersion,
        promptSource: r.promptSource,
        mode: r.mode,
        summary: safeParse(r.summaryJson, {}),
        results: safeParse(r.resultsJson, []),
        durationMs: r.durationMs,
        createdAt: r.createdAt,
      },
    });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] get eval-run failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '加载评估详情失败' },
    });
  }
});

// ============================================================
// 工具：解析 prompt 配置（来自 prompt-stability 的同名逻辑简化）
// ============================================================
async function resolvePrompt(
  canonicalAgentId: string,
  payload: any
): Promise<{
  systemPrompt: string;
  source: 'custom' | 'version' | 'active';
  promptVersion: number | null;
  model: string | null;
}> {
  if (typeof payload.customPrompt === 'string' && payload.customPrompt.trim()) {
    return {
      systemPrompt: payload.customPrompt,
      source: 'custom',
      promptVersion: null,
      model: payload.model || null,
    };
  }

  if (typeof payload.promptVersionId === 'string' && payload.promptVersionId) {
    const row = await systemPrisma.agent_prompts.findUnique({
      where: { id: payload.promptVersionId },
    });
    if (!row) throw new Error(`promptVersionId ${payload.promptVersionId} 不存在`);
    return {
      systemPrompt: row.systemPrompt,
      source: 'version',
      promptVersion: row.version,
      model: payload.model || row.model || null,
    };
  }

  if (typeof payload.promptVersion === 'number') {
    const row = await systemPrisma.agent_prompts.findFirst({
      where: { agentId: canonicalAgentId, version: payload.promptVersion },
    });
    if (!row) throw new Error(`promptVersion ${payload.promptVersion} 不存在`);
    return {
      systemPrompt: row.systemPrompt,
      source: 'version',
      promptVersion: row.version,
      model: payload.model || row.model || null,
    };
  }

  const active = await systemPrisma.agent_prompts.findFirst({
    where: { agentId: canonicalAgentId, status: 'ACTIVE' },
    orderBy: { version: 'desc' },
  });
  if (!active) throw new Error(`agent ${canonicalAgentId} 当前没有 ACTIVE prompt`);
  return {
    systemPrompt: active.systemPrompt,
    source: 'active',
    promptVersion: active.version,
    model: payload.model || active.model || null,
  };
}

/**
 * 编译预览 — P-PROMPT-COMPILE
 * GET /admin/prompt-ops/:agentId/compile-info
 *
 * 返回:
 *   - source: PromptSource 文本 (来自 DB ACTIVE 版本)
 *   - compiled: 实时编译产物 (调 compilePrompt)
 *   - sourceHash / contextHash
 *   - status: fresh | failed
 *   - rewritten / fieldsApplied
 *   - storedCompiledAt / storedSourceHash 等 (DB 存的产物元信息, 后续 C3 会用到)
 *
 * 注: 当前阶段 (C2) 是"实时 dry-run 编译", 不落库. C3 会改为优先用 DB 已存产物.
 */
router.get('/:agentId/compile-info', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.agentId;
    // 兼容 'goal-conversation' / 'skill:goal-conversation' 两种入参
    const ids = rawId.startsWith('skill:') ? [rawId, rawId.slice(6)] : [rawId, `skill:${rawId}`];

    // 找 DB ACTIVE prompt
    let activePrompt: any = null;
    for (const id of ids) {
      activePrompt = await systemPrisma.agent_prompts.findFirst({
        where: { agentId: id, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });
      if (activePrompt) break;
    }

    if (!activePrompt) {
      return res.status(404).json({
        success: false,
        error: `未找到 agentId=${rawId} 的 ACTIVE prompt`,
      });
    }

    const source: string = activePrompt.systemPrompt || '';

    // routing 表用的 key 是无 skill: 前缀的版本 (从 seed 脚本和 goal-conversation/index.ts 推断)
    const routingKey = rawId.startsWith('skill:') ? rawId.slice(6) : rawId;
    const compileResult = await compilePrompt(source, routingKey);

    res.json({
      success: true,
      data: {
        agentId: rawId,
        routingKey,
        promptVersion: activePrompt.version,
        promptName: activePrompt.name,
        source,
        compiled: compileResult.compiled,
        status: compileResult.status,
        error: compileResult.error || null,
        warnings: compileResult.warnings,
        rewritten: compileResult.rewritten,
        fieldsApplied: compileResult.fieldsApplied,
        sourceHash: compileResult.sourceHash,
        compileContextHash: compileResult.compileContextHash,
        // DB 落库的产物 (C3 后会非空)
        storedCompiledAt: activePrompt.compiledAt,
        storedSourceHash: activePrompt.sourceHash,
        storedContextHash: activePrompt.compileContextHash,
        storedStatus: activePrompt.compileStatus,
      },
    });
  } catch (error: any) {
    logger.error('compile-info 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '编译预览失败',
    });
  }
});

/**
 * skill-catalog — 用于前端可视化字段选择器 (SkillFieldPicker)
 * GET /admin/prompt-ops/skill-catalog
 *
 * 返回三级树:
 *   [
 *     {
 *       agentId: 'goal-agent',
 *       agentName: '目标 Agent',
 *       skills: [
 *         {
 *           skillId: 'skill:goal-conversation',
 *           skillName: 'goal-conversation',
 *           inputFields: [{ path, valueType, note }, ...],   // 从 ## 输入说明 json 抽
 *           outputFields: [{ path, valueType, note }, ...],  // 从 ## 输出规格 json 抽
 *         }
 *       ]
 *     }
 *   ]
 *
 * 数据源:
 *   - agent → skill 嵌套: agent-manifest.service
 *   - 字段表: 从每个 skill 的 DB ACTIVE prompt 调 parsePromptSchema 抽
 *
 * 注: 跨 stage 字段引用 (例如 path-agent 引用 goal-agent 的 surface_goal) 走 outputFields,
 * 当前 stage 内部引用 (例如 path-planning 引用上游 normalizedInput) 走 inputFields.
 */
router.get('/skill-catalog', async (_req: Request, res: Response) => {
  try {
    const topAgents = listTopLevelAgents();

    // 拉所有 ACTIVE prompts 一次性 (避免 N+1)
    const allActivePrompts = await systemPrisma.agent_prompts.findMany({
      where: { status: 'ACTIVE' },
      select: {
        agentId: true,
        systemPrompt: true,
        compiledSystemPrompt: true,
        compileStatus: true,
        name: true,
        version: true,
      },
    });
    const promptMap = new Map<string, typeof allActivePrompts[0]>();
    for (const p of allActivePrompts) {
      promptMap.set(p.agentId, p);
      // 也允许去掉/加上 skill: 前缀的查询
      if (p.agentId.startsWith('skill:')) {
        promptMap.set(p.agentId.slice(6), p);
      } else {
        promptMap.set(`skill:${p.agentId}`, p);
      }
    }

    const tree = topAgents.map((agent) => {
      const skills = listSkillsOfAgent(agent.id);
      return {
        agentId: agent.id,
        agentName: agent.name,
        description: agent.description,
        monitoringGroup: agent.monitoringGroup,
        skills: skills.map((skill) => {
          const prompt = promptMap.get(skill.id);
          let inputFields: any[] = [];
          let outputFields: any[] = [];
          let hasPrompt = false;
          let promptVersion: number | null = null;
          if (prompt && prompt.systemPrompt) {
            hasPrompt = true;
            promptVersion = prompt.version;
            try {
              const schema = parsePromptSchema(prompt.systemPrompt);
              inputFields = (schema.inputFields || []).map((f) => ({
                path: f.path,
                name: f.path,
                valueType: f.valueType,
                enumValues: f.enumValues || null,
                note: f.note || '',
              }));
              outputFields = (schema.outputFields || []).map((f) => ({
                path: f.path,
                name: f.path,
                valueType: f.valueType,
                enumValues: f.enumValues || null,
                note: f.note || '',
              }));
            } catch (err: any) {
              logger.warn(`parse prompt schema failed for ${skill.id}: ${err?.message}`);
            }
          }
          return {
            skillId: skill.id,
            skillName: skill.name,
            description: skill.description,
            hasPrompt,
            promptVersion,
            inputFields,
            outputFields,
            inputFieldCount: inputFields.length,
            outputFieldCount: outputFields.length,
          };
        }),
      };
    });

    res.json({
      success: true,
      data: {
        agents: tree,
        totalAgents: tree.length,
        totalSkills: tree.reduce((s, a) => s + a.skills.length, 0),
        totalFields: tree.reduce(
          (s, a) => s + a.skills.reduce((ss, k) => ss + k.inputFieldCount + k.outputFieldCount, 0),
          0
        ),
      },
    });
  } catch (error: any) {
    logger.error('skill-catalog 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '加载 skill 目录失败',
    });
  }
});

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export default router;
