/**
 * Prompt 运营 · 只读总览子路由（2026-10-24 架构优化批 1 自 prompt-ops.ts 迁出，处理器逐字未改）。
 * agent-overview / skill-rules-overview / sandbox-view / protocol-view。
 * 由 prompt-ops 主路由在**同一个** router 实例上按原顺序调用注册。
 */
import { Request, Response } from 'express';
import { listActiveAgentPromptsFull, groupDraftCountsByAgent, listActiveAgentPromptsBrief } from '../../services/admin/prompt-ops.repo';
import { logger } from '../../utils/logger';
import { loadAllPromptFiles } from '../../composers/prompt-files/loader';
import { getAgentManifest } from '../../services/agent-manifest.service';
// 试跑载荷要与真实链路同形：loadTarget 在真实链路里由 skill 的 withLoadTargetForMilestone 从
// cognitiveCore.loadProfile.stageLoadDistribution 注入——这里复用同一个函数，否则试跑永远
// 走不到规则 39（loadTarget 分支），也就验不出该规则是否被改坏（审计 P2「试跑载荷缺 materials/loadTarget」）
import { parsePromptSchema } from '../../services/prompt-schema';
import { resolveRuntimeContractsForAgents } from '../../services/prompt-lab/resolve-runtime-contract';

export function registerPromptOpsOverviewRoutes(router: import('express').Router): void {
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
    const dbActives = await listActiveAgentPromptsFull();
    const dbDraftCounts = await groupDraftCountsByAgent();

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
    const dbActives = await listActiveAgentPromptsBrief();
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
}
