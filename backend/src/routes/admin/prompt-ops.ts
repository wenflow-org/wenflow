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
import { ensureCoreAgentPrompts } from '../../scripts/seed-core-agent-prompts';
import {
  parsePromptSchema,
  suggestRulePrefix,
  type PromptSchema,
} from '../../services/prompt-schema';
import { compilePrompt } from '../../services/prompt-compiler';
import { promptCache } from '../../services/cache/prompt-cache.service';
import {
  listTopLevelAgents,
  listSkillsOfAgent,
} from '../../services/agent-manifest.service';
import {
  extractFieldsFromSource,
  updateFieldsInSource,
  type EditableField,
} from '../../services/prompt-source-fields';
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
const AGENT_STAGE_MAP: Record<string, 'goal' | 'path' | 'teaching'> = {
  'skill:goal-conversation': 'goal',
  // 以下虽未迁移但确定隶属的 stage
  'skill:path-planning': 'path',
  'skill:stage-designer': 'path',
  'skill:teaching-turn': 'teaching',
  'skill:session-wrapup': 'teaching',
  'skill:peer-reinforcement': 'teaching',
  'skill:adaptive-guidance-copy': 'teaching',
  'skill:lesson-knowledge-enricher': 'teaching',
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
// GET /api/admin/prompt-ops/agent-fields/:agentId
// 拉取该 agent 所属 stage 的字段路由（用于 AI 起草字段选择器）
// 返回扁平字段列表 + 所属 orchestrator 的路由（如果 agent 即编排器）
// ============================================================
router.get('/agent-fields/:agentId', async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId || '').trim();
  const stage = AGENT_STAGE_MAP[agentId] || null;

  if (!stage) {
    return res.json({
      success: true,
      data: {
        agentId,
        stage: null,
        fields: [],
        hint: '该 agent 还未迁移到字段路由表，AI 起草时请手动输入 fieldId',
      },
    });
  }

  try {
    const [contracts, fields, routings] = await Promise.all([
      systemPrisma.agent_contracts.findMany({ where: { stage } }),
      systemPrisma.field_definitions.findMany({ where: { stage } }),
      systemPrisma.agent_field_routings.findMany({
        where: {
          agentId: {
            in: (
              await systemPrisma.agent_contracts.findMany({
                where: { stage },
                select: { agentId: true },
              })
            ).map((c) => c.agentId),
          },
        },
      }),
    ]);

    // 把 routing 按 fieldId 聚合，列出该字段在哪些 agent 出现 + 主导 promptRole
    const routingByField = new Map<
      string,
      Array<{
        agentId: string;
        render: string;
        accumulate: boolean;
        internal: boolean;
      }>
    >();
    for (const r of routings) {
      if (!routingByField.has(r.fieldId)) routingByField.set(r.fieldId, []);
      routingByField.get(r.fieldId)!.push({
        agentId: r.agentId,
        render: r.render,
        accumulate: r.accumulate,
        internal: r.internalFlag,
      });
    }

    const fieldList = fields.map((f) => ({
      fieldId: f.fieldId,
      stage: f.stage,
      promptRole: f.promptRole,
      valueType: f.valueType,
      description: f.description,
      snakeName: f.snakeName,
      camelName: f.camelName,
      systemLocked: f.systemLocked,
      structureLocked: f.structureLocked,
      agentRoutings: routingByField.get(f.fieldId) || [],
      // 推荐选中：所有非 control-signal 且非 system-locked 的字段
      recommendedSelected:
        !f.systemLocked &&
        f.promptRole !== 'control-signal' &&
        f.promptRole !== 'derived-presentation',
    }));

    return res.json({
      success: true,
      data: {
        agentId,
        stage,
        fields: fieldList,
        contracts: contracts.map((c) => ({
          agentId: c.agentId,
          displayName: c.displayName,
        })),
      },
    });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] agent-fields failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '加载字段路由失败' },
    });
  }
});

// ============================================================
// GET /api/admin/prompt-ops/recent-call-samples?agentId=&limit=
// 拉 prompt_call_logs 最近 N 条作为评估集来源
// 返回:每条携带 userPayload(JSON)/normalizedOutput/success/createdAt/conversationId
// ============================================================
router.get('/recent-call-samples', async (req: Request, res: Response) => {
  const agentId = String(req.query.agentId || '').trim();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  if (!agentId) {
    return res
      .status(400)
      .json({ success: false, error: { message: 'agentId 必填' } });
  }

  try {
    const logs = await prisma.prompt_call_logs.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        agentId: true,
        success: true,
        durationMs: true,
        userPayload: true,
        normalizedOutput: true,
        rawModelOutput: true,
        conversationId: true,
        userId: true,
        createdAt: true,
        systemPromptVersion: true,
      },
    });

    const samples = logs.map((log) => {
      const userPayload = safeParse(log.userPayload, null);
      const normalizedOutput = safeParse(log.normalizedOutput, null);

      // 抽出 messages 序列（如果 userPayload 形似 conversation 结构）
      let messages: Array<{ role: string; content: string }> = [];
      let inputPreview = '';
      if (userPayload && typeof userPayload === 'object') {
        if (Array.isArray(userPayload.messages)) {
          messages = userPayload.messages
            .filter((m: any) => m && typeof m.content === 'string')
            .map((m: any) => ({
              role: m.role || 'user',
              content: String(m.content),
            }));
          inputPreview = messages[messages.length - 1]?.content || '';
        } else if (typeof userPayload.input === 'string') {
          messages = [{ role: 'user', content: userPayload.input }];
          inputPreview = userPayload.input;
          if (Array.isArray(userPayload.conversationHistory)) {
            messages = [
              ...userPayload.conversationHistory.map((m: any) => ({
                role: m.role || 'user',
                content: String(m.content || ''),
              })),
              ...messages,
            ];
          }
        }
      }

      return {
        id: log.id,
        success: log.success,
        durationMs: log.durationMs,
        promptVersion: log.systemPromptVersion,
        conversationId: log.conversationId,
        userId: log.userId,
        createdAt: log.createdAt,
        messages,
        inputPreview: inputPreview.length > 120 ? inputPreview.slice(0, 120) + '…' : inputPreview,
        outputStage:
          normalizedOutput?.internal?.core?.stage ||
          normalizedOutput?.stage ||
          null,
      };
    });

    return res.json({ success: true, data: samples });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] recent-call-samples failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '加载调用样本失败' },
    });
  }
});

// ============================================================
// 字段表 × field_definitions 打通（路线丙）
// prompt 的 JSON schema 是「字段结构」真相源；field_definitions 表是
// 「字段路由/治理元数据」（耦合度 / 锁）真相源。这里按 stage 查表，用
// 三级匹配（精确 fieldId → 别名 → 叶子路径后缀）把治理元数据 LEFT JOIN
// 到 outputFields/inputFields 上。表里没有的字段保持无注解（优雅降级）。
// ============================================================

/** promptRole → 耦合度 */
function roleToCoupling(role: string | null | undefined): 'contract' | 'flow' | 'prose' {
  switch (role) {
    case 'control-signal':
      return 'flow';
    case 'hard-required':
    case 'proposal-output':
    case 'public-reply':
      return 'contract';
    default:
      return 'prose'; // soft-info / hidden-inference / derived-presentation
  }
}

/**
 * prompt JSON 路径 → field_definitions fieldId 的已知别名。
 * 两套 envelope 形状不同（state.stage vs core.stage、reply vs userVisible），
 * 这里登记核心控制/回复字段的对应关系。
 */
const FIELD_PATH_ALIASES: Record<string, string> = {
  reply: 'userVisible',
  'state.stage': 'core.stage',
  'state.confidence': 'core.confidence',
  'state.done': 'core.isCompleted',
};

interface FieldGovernance {
  coupling: 'contract' | 'flow' | 'prose';
  promptRole: string | null;
  systemLocked: boolean;
  structureLocked: boolean;
  fieldId: string;
}

/** 把一个 stage 的 field_definitions 行做成多键查找表（精确 + 叶子后缀） */
async function buildFieldDefLookup(
  stage: string
): Promise<{ exact: Map<string, FieldGovernance>; leaf: Map<string, FieldGovernance> }> {
  const rows = await systemPrisma.field_definitions.findMany({ where: { stage } });
  const exact = new Map<string, FieldGovernance>();
  const leaf = new Map<string, FieldGovernance>();
  for (const r of rows as any[]) {
    const gov: FieldGovernance = {
      coupling: roleToCoupling(r.promptRole),
      promptRole: r.promptRole ?? null,
      systemLocked: !!r.systemLocked,
      structureLocked: !!r.structureLocked,
      fieldId: r.fieldId,
    };
    exact.set(r.fieldId, gov);
    const leafKey = r.fieldId.split('.').slice(-2).join('.'); // 末两段
    if (!leaf.has(leafKey)) leaf.set(leafKey, gov);
    const last = r.fieldId.split('.').slice(-1)[0];
    if (!leaf.has(last)) leaf.set(last, gov);
  }
  return { exact, leaf };
}

/** 给一组字段注解治理元数据（三级匹配） */
function annotateFields(
  fields: any[],
  lookup: { exact: Map<string, FieldGovernance>; leaf: Map<string, FieldGovernance> }
): void {
  for (const f of fields) {
    const p: string = f.path;
    let gov = lookup.exact.get(p); // 1) 精确 fieldId
    if (!gov && FIELD_PATH_ALIASES[p]) gov = lookup.exact.get(FIELD_PATH_ALIASES[p]); // 2) 别名
    if (!gov) gov = lookup.leaf.get(p.split('.').slice(-2).join('.')); // 3a) 末两段
    if (!gov) gov = lookup.leaf.get(p.split('.').slice(-1)[0]); // 3b) 末一段
    if (gov) {
      f.coupling = gov.coupling;
      f.promptRole = gov.promptRole;
      f.systemLocked = gov.systemLocked;
      f.structureLocked = gov.structureLocked;
      f.governedFieldId = gov.fieldId;
      f.governed = true;
    } else {
      f.coupling = null;
      f.governed = false;
    }
  }
}

// ============================================================
// GET /api/admin/prompt-ops/prompt-schema/:agentId
// 返回该 agent 当前 ACTIVE prompt 的结构化拆解 + lint 结果 + 推荐 R prefix
// 来源优先级：DB ACTIVE > File，确保运营改的是运行时真正用的 prompt
// ============================================================
router.get('/prompt-schema/:agentId', async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId || '').trim();
  if (!agentId) {
    return res.status(400).json({
      success: false,
      error: { message: 'agentId 必填' },
    });
  }

  try {
    const dbActive = await systemPrisma.agent_prompts.findFirst({
      where: { agentId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });

    // archetype 真相源是 .md frontmatter（解析器不读 frontmatter），无论 db/file 都从文件取
    const allFiles = loadAllPromptFiles();
    const file = allFiles.find(
      (f) =>
        f.agentId === agentId ||
        (Array.isArray(f.acceptableAgentIds) &&
          f.acceptableAgentIds.includes(agentId))
    );

    let sourceText = '';
    let source: 'db' | 'file' | 'none' = 'none';
    if (dbActive?.systemPrompt) {
      sourceText = dbActive.systemPrompt;
      source = 'db';
    } else if (file?.systemPrompt) {
      sourceText = file.systemPrompt;
      source = 'file';
    }

    const schema = sourceText
      ? parsePromptSchema(sourceText)
      : ({
          title: null,
          identity: '',
          rulesRaw: '',
          rules: [],
          output: '',
          extras: [],
          conformant: false,
          warnings: ['没有找到 prompt 文本'],
        } as PromptSchema);

    // 把 frontmatter 的 archetype 注入 schema（前端 archetype 徽章 / code-only 空态依赖它）
    (schema as any).archetype = (file as any)?.archetype || null;

    // 字段表 × field_definitions 打通：按 stage LEFT JOIN 治理元数据（耦合度/锁）
    const stage = AGENT_STAGE_MAP[agentId] || null;
    if (stage) {
      try {
        const lookup = await buildFieldDefLookup(stage);
        if (Array.isArray((schema as any).outputFields)) annotateFields((schema as any).outputFields, lookup);
        if (Array.isArray((schema as any).inputFields)) annotateFields((schema as any).inputFields, lookup);
      } catch (e: any) {
        logger.warn(`[prompt-schema] field_definitions join 失败（不影响主流程）: ${e?.message || e}`);
      }
    }

    return res.json({
      success: true,
      data: {
        agentId,
        source,
        promptText: sourceText,
        schema,
        promptContract: (file as any)?.promptContract || null,
        fieldGovernanceStage: stage,
        suggestedRulePrefix: suggestRulePrefix(agentId),
        promptVersionId: dbActive?.id || null,
        promptVersion: dbActive?.version || null,
      },
    });
  } catch (error: any) {
    logger.error('[admin-prompt-ops] prompt-schema failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: error.message || '加载 prompt schema 失败' },
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
 * 触发 prompt 文件热同步
 * POST /api/admin/prompt-ops/sync
 * 运行 sync 模式，将 prompts/*.md 与 DB 比对，归档旧版本、创建新版本，立即生效
 */
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const result = await ensureCoreAgentPrompts(systemPrisma, 'sync');
    res.json({
      success: true,
      data: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        mode: 'sync',
      },
    });
  } catch (error: any) {
    logger.error('Prompt sync 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '同步失败',
    });
  }
});

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
 * 手动重编译 — P-PROMPT-COMPILE
 * POST /admin/prompt-ops/:agentId/recompile
 *
 * 行为:
 *   - 拉 DB ACTIVE 源 → 调 compilePrompt → 落库 compiledSystemPrompt 等字段
 *   - 同步失效 prompt cache (热更换关键: 下次 LLM 调用立即拿新产物)
 *   - 不重新版本号 (产物只是源的派生, 不算新版本)
 */
router.post('/:agentId/recompile', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.agentId;
    const ids = rawId.startsWith('skill:') ? [rawId, rawId.slice(6)] : [rawId, `skill:${rawId}`];

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
    const routingKey = rawId.startsWith('skill:') ? rawId.slice(6) : rawId;
    const compileResult = await compilePrompt(source, routingKey);

    await systemPrisma.agent_prompts.update({
      where: { id: activePrompt.id },
      data: {
        compiledSystemPrompt: compileResult.compiled,
        compiledAt: new Date(),
        sourceHash: compileResult.sourceHash,
        compileContextHash: compileResult.compileContextHash,
        compileStatus: compileResult.status,
        compileError: compileResult.error || null,
      },
    });

    // 热更换关键: 失效缓存, 下次 LLM 调用立即拿新产物
    try {
      promptCache.clearAgentCache(activePrompt.agentId);
      if (activePrompt.agentId !== rawId) promptCache.clearAgentCache(rawId);
    } catch (cacheErr: any) {
      logger.warn('清缓存失败 (非致命):', cacheErr?.message);
    }

    res.json({
      success: true,
      data: {
        agentId: rawId,
        status: compileResult.status,
        rewritten: compileResult.rewritten,
        fieldsApplied: compileResult.fieldsApplied,
        sourceHash: compileResult.sourceHash,
        compileContextHash: compileResult.compileContextHash,
        warnings: compileResult.warnings,
        error: compileResult.error || null,
      },
    });
  } catch (error: any) {
    logger.error('recompile 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '重编译失败',
    });
  }
});

/**
 * 保存源 + 自动编译 + 失效缓存 (一键完成"编辑→编译") — P-PROMPT-COMPILE
 * PUT /admin/prompt-ops/:agentId/source
 *
 * body: { systemPrompt: string, autoCompile?: boolean (默认 true) }
 *
 * 行为:
 *   1. 把 systemPrompt 写入 ACTIVE 版本的 systemPrompt 字段 (原地更新, 不新建版本)
 *   2. autoCompile=true 时立即调 compilePrompt → 落库
 *   3. 失效 prompt cache → 下次 LLM 调用立即用新源/新产物
 *
 * 设计取舍:
 *   - 原地更新 systemPrompt 是热更换语义 — 用户改 prompt 立即生效, 不引入新版本号
 *   - 如需保留历史版本应该走 agent-prompts.ts 的 publish 流程 (创建新 DRAFT 版本)
 *   - 本端点是 "运营快速调整" 路径, 跟 sync(.md 文件) 不冲突
 */
router.put('/:agentId/source', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.agentId;
    const { systemPrompt, autoCompile = true } = req.body || {};

    if (typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'systemPrompt 不能为空' });
    }

    const ids = rawId.startsWith('skill:') ? [rawId, rawId.slice(6)] : [rawId, `skill:${rawId}`];

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

    // 1) 保存源
    await systemPrisma.agent_prompts.update({
      where: { id: activePrompt.id },
      data: {
        systemPrompt,
        updatedAt: new Date(),
        // 标记产物 stale (autoCompile=false 时让下次 LLM 调用前 lazy 重编译)
        compileStatus: autoCompile ? activePrompt.compileStatus : 'stale',
      },
    });

    let compileResult: any = null;

    // 2) 自动编译
    if (autoCompile) {
      const routingKey = rawId.startsWith('skill:') ? rawId.slice(6) : rawId;
      compileResult = await compilePrompt(systemPrompt, routingKey);

      await systemPrisma.agent_prompts.update({
        where: { id: activePrompt.id },
        data: {
          compiledSystemPrompt: compileResult.compiled,
          compiledAt: new Date(),
          sourceHash: compileResult.sourceHash,
          compileContextHash: compileResult.compileContextHash,
          compileStatus: compileResult.status,
          compileError: compileResult.error || null,
        },
      });
    }

    // 3) 失效缓存 (热更换关键)
    try {
      promptCache.clearAgentCache(activePrompt.agentId);
      if (activePrompt.agentId !== rawId) promptCache.clearAgentCache(rawId);
    } catch (cacheErr: any) {
      logger.warn('清缓存失败 (非致命):', cacheErr?.message);
    }

    res.json({
      success: true,
      data: {
        agentId: rawId,
        savedSource: true,
        compiled: autoCompile,
        compileStatus: compileResult?.status || (autoCompile ? null : 'stale'),
        rewritten: compileResult?.rewritten || false,
        fieldsApplied: compileResult?.fieldsApplied || 0,
        sourceHash: compileResult?.sourceHash || null,
        compileContextHash: compileResult?.compileContextHash || null,
        warnings: compileResult?.warnings || [],
        error: compileResult?.error || null,
      },
    });
  } catch (error: any) {
    logger.error('保存源失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '保存失败',
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
                valueType: f.valueType,
                enumValues: f.enumValues || null,
                note: f.note || '',
              }));
              outputFields = (schema.outputFields || []).map((f) => ({
                path: f.path,
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

/**
 * GET /admin/prompt-ops/:agentId/fields
 *
 * 从 prompt 源里抽出 input + output 可编辑字段表 (供 GUI 渲染).
 * source-of-truth 仍是 prompt source 里的 ```json``` 块, 这只是一个 GUI 友好视图.
 */
router.get('/:agentId/fields', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.agentId;
    const ids = rawId.startsWith('skill:') ? [rawId, rawId.slice(6)] : [rawId, `skill:${rawId}`];

    let activePrompt: any = null;
    for (const id of ids) {
      activePrompt = await systemPrisma.agent_prompts.findFirst({
        where: { agentId: id, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });
      if (activePrompt) break;
    }
    if (!activePrompt) {
      return res.status(404).json({ success: false, error: `未找到 agentId=${rawId} 的 ACTIVE prompt` });
    }

    const source: string = activePrompt.systemPrompt || '';
    const inputFields = extractFieldsFromSource(source, 'input');
    const outputFields = extractFieldsFromSource(source, 'output');

    res.json({
      success: true,
      data: {
        agentId: rawId,
        inputFields,
        outputFields,
        inputFieldCount: inputFields.length,
        outputFieldCount: outputFields.length,
      },
    });
  } catch (error: any) {
    logger.error('fields GET 失败:', error);
    res.status(500).json({ success: false, error: error.message || '加载字段失败' });
  }
});

/**
 * PUT /admin/prompt-ops/:agentId/fields
 * body: { inputFields?: EditableField[], outputFields?: EditableField[], autoCompile?: boolean }
 *
 * 把字段表序列化回 prompt 源里的 ```json``` 块, 等价于 GUI 字段编辑 → 改源 → 自动编译 → 热更换.
 * 仅替换 ```json``` 块, 段内 prose / OUT-XX / IN-XX 全部保留.
 */
router.put('/:agentId/fields', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.agentId;
    const { inputFields, outputFields, autoCompile = true } = req.body || {};

    if (!inputFields && !outputFields) {
      return res.status(400).json({ success: false, error: '至少提供 inputFields 或 outputFields' });
    }

    const ids = rawId.startsWith('skill:') ? [rawId, rawId.slice(6)] : [rawId, `skill:${rawId}`];

    let activePrompt: any = null;
    for (const id of ids) {
      activePrompt = await systemPrisma.agent_prompts.findFirst({
        where: { agentId: id, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });
      if (activePrompt) break;
    }
    if (!activePrompt) {
      return res.status(404).json({ success: false, error: `未找到 agentId=${rawId} 的 ACTIVE prompt` });
    }

    const currentSource: string = activePrompt.systemPrompt || '';
    const { source: newSource, warnings } = updateFieldsInSource(
      currentSource,
      inputFields as EditableField[] | undefined,
      outputFields as EditableField[] | undefined
    );

    if (newSource === currentSource) {
      return res.json({
        success: true,
        data: { changed: false, warnings, note: '字段表未变化, 源未更新' },
      });
    }

    // 写回源
    await systemPrisma.agent_prompts.update({
      where: { id: activePrompt.id },
      data: {
        systemPrompt: newSource,
        updatedAt: new Date(),
        compileStatus: autoCompile ? activePrompt.compileStatus : 'stale',
      },
    });

    let compileResult: any = null;
    if (autoCompile) {
      const routingKey = rawId.startsWith('skill:') ? rawId.slice(6) : rawId;
      compileResult = await compilePrompt(newSource, routingKey);
      await systemPrisma.agent_prompts.update({
        where: { id: activePrompt.id },
        data: {
          compiledSystemPrompt: compileResult.compiled,
          compiledAt: new Date(),
          sourceHash: compileResult.sourceHash,
          compileContextHash: compileResult.compileContextHash,
          compileStatus: compileResult.status,
          compileError: compileResult.error || null,
        },
      });
    }

    try {
      promptCache.clearAgentCache(activePrompt.agentId);
      if (activePrompt.agentId !== rawId) promptCache.clearAgentCache(rawId);
    } catch (cacheErr: any) {
      logger.warn('清缓存失败 (非致命):', cacheErr?.message);
    }

    res.json({
      success: true,
      data: {
        changed: true,
        autoCompile,
        compileStatus: compileResult?.status || (autoCompile ? null : 'stale'),
        fieldsApplied: compileResult?.fieldsApplied || 0,
        warnings: [...warnings, ...(compileResult?.warnings || [])],
        error: compileResult?.error || null,
      },
    });
  } catch (error: any) {
    logger.error('fields PUT 失败:', error);
    res.status(500).json({ success: false, error: error.message || '保存字段失败' });
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
