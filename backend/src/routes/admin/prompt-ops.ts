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
import { listAllActiveAgentPrompts, listEvalCases, findEvalCaseByAgentAndCaseId, createEvalCase, updateEvalCase, deleteEvalCase, findEnabledEvalCasesByIds, listEnabledEvalCasesByAgent, createEvalRun, listEvalRuns, findEvalRunById } from '../../services/admin/prompt-ops.repo';
import { filterExistingProfileIds } from '../../services/virtual-lab/virtual-learner-profile.repo';
import { logger } from '../../utils/logger';
import { getCanonicalAgentId } from '../../services/agent-manifest.service';
// 试跑载荷要与真实链路同形：loadTarget 在真实链路里由 skill 的 withLoadTargetForMilestone 从
// cognitiveCore.loadProfile.stageLoadDistribution 注入——这里复用同一个函数，否则试跑永远
// 走不到规则 39（loadTarget 分支），也就验不出该规则是否被改坏（审计 P2「试跑载荷缺 materials/loadTarget」）
import { parsePromptSchema } from '../../services/prompt-schema';
import { listTopLevelAgents, listSkillsOfAgent } from '../../services/agent-manifest.service';

const router = Router();
router.use(rejectPromptOpsRuntimeMutation);

// 只读总览簇（agent-overview / skill-rules-overview / sandbox-view / protocol-view）：见 prompt-ops-overviews.ts
import { registerPromptOpsOverviewRoutes } from './prompt-ops-overviews';
registerPromptOpsOverviewRoutes(router);

// 模拟评测引擎（run-eval 背后的执行/检查/解析）：见 services/prompt-ops/simulated-eval-engine.ts
import { extractSimConfig, resolveSimulatedEvalInput, partitionSimulatedEvalCases, computeGoalChecks, runSimulatedGoalLoop, runSkillEvalCase, runSkillChecks, resolvePrompt, safeParse, pickGoalCoreFields, pickPersonaSummary } from '../../services/prompt-ops/simulated-eval-engine';

// 兼容再导出：既有测试/脚本直接从本文件取引擎入口
export { partitionSimulatedEvalCases };

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
router.get('/eval-cases', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.query.agentId || '').trim();
    const where = agentId ? { agentId } : {};
    const cases = await listEvalCases(where);
    /* 模拟用例引用的虚拟学习者可能已被删除：列表就标出来，否则要等跑批时
       才从 partitionSimulatedEvalCases 的 skipped 里发现用例被跳过。 */
    const personaIds = Array.from(new Set(
      cases
        .map((c) => extractSimConfig(safeParse(c.expectationsJson, null))?.personaId)
        .filter((v): v is string => !!v),
    ));
    const existingPersonaIds = await filterExistingProfileIds(personaIds);
    return res.json({
      success: true,
      data: cases.map((c) => {
        const personaId = extractSimConfig(safeParse(c.expectationsJson, null))?.personaId;
        return {
          id: c.id,
          agentId: c.agentId,
          caseId: c.caseId,
          name: c.name,
          description: c.description,
          messages: safeParse(c.messagesJson, []),
          previousState: safeParse(c.previousStateJson, null),
          expectations: safeParse(c.expectationsJson, null),
          personaMissing: !!personaId && !existingPersonaIds.has(personaId),
          enabled: c.enabled,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        };
      }),
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
    // 虚拟学习者模拟输入（mode:simulated）的学生话由模拟器生成，messages 可为空
    const isSimulated = extractSimConfig(body.expectations) !== null;
    if (messages.length === 0 && !isSimulated) {
      return res
        .status(400)
        .json({ success: false, error: { message: '至少 1 条 message' } });
    }

    const caseId =
      String(body.caseId || '').trim() || `case-${Date.now().toString(36)}`;

    // 唯一性
    const dup = await findEvalCaseByAgentAndCaseId(agentId, caseId);
    if (dup) {
      return res.status(409).json({
        success: false,
        error: { message: `用例 caseId=${caseId} 已存在` },
      });
    }

    const created = await createEvalCase({
      data: {
        id: randomUUID(),
        agentId,
        caseId,
        name,
        description: body.description ? String(body.description) : null,
        messagesJson: JSON.stringify(messages),
        // 结构化输入（path/stage 的 goal/milestone/cognitiveCore 等）合并进 previousStateJson 承载
        previousStateJson: body.inputPayload || body.previousState
          ? JSON.stringify({ ...(body.previousState || {}), ...(body.inputPayload || {}) })
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
    if (body.previousState !== undefined || body.inputPayload !== undefined) {
      const merged = { ...(body.previousState || {}), ...(body.inputPayload || {}) };
      data.previousStateJson = Object.keys(merged).length
        ? JSON.stringify(merged)
        : null;
    }
    if (body.expectations !== undefined) {
      data.expectationsJson = body.expectations
        ? JSON.stringify(body.expectations)
        : null;
    }
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled;

    await updateEvalCase(id, data);
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
    await deleteEvalCase(req.params.id);
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

  const SUPPORTED_EVAL_SKILLS = new Set([
    'skill:goal-conversation',
    'skill:path-planning',
    'skill:stage-designer',
  ]);

  if (!SUPPORTED_EVAL_SKILLS.has(canonicalAgentId)) {
    return res.status(400).json({
      success: false,
      error: {
        message:
          `当前评测器支持：${[...SUPPORTED_EVAL_SKILLS].join(', ')}；` +
          '其他 agent 请使用单条试跑（runtime-definitions/test），或实现对应的 evalAdapter',
      },
    });
  }

  try {
    // 解析 prompt
    const promptConfig = await resolvePrompt(canonicalAgentId, body);

    // 解析用例
    // 语义：
    //  - 显式 caseIds        → 只跑指定 DB 用例
    //  - adhocCases 且无 caseIds → 只跑 adhoc（单条试跑）
    //  - 都没有             → 全部 enabled DB 用例（批量评估）
    const hasExplicitCaseFilter = Array.isArray(body.caseIds) && body.caseIds.length > 0;
    const hasAdhocOnly = !hasExplicitCaseFilter && Array.isArray(body.adhocCases) && body.adhocCases.length > 0;
    const dbCases = hasExplicitCaseFilter
      ? await findEnabledEvalCasesByIds(canonicalAgentId, body.caseIds.map((s: any) => String(s)))
      : hasAdhocOnly
        ? []
        : await listEnabledEvalCasesByAgent(canonicalAgentId);

    const adhocCases = Array.isArray(body.adhocCases) ? body.adhocCases : [];

    const evalCases = [
      ...dbCases.map((c) => ({
        id: c.caseId,
        name: c.name,
        messages: safeParse(c.messagesJson, []),
        previousState: safeParse(c.previousStateJson, null),
        expectations: safeParse(c.expectationsJson, null),
        // DB 用例的结构化输入复用 previousStateJson 承载（path/stage 的 goal/milestone/cognitiveCore/expectedMilestones 等）
        inputPayload: safeParse(c.previousStateJson, null),
      })),
      ...adhocCases.map((c: any, idx: number) => ({
        id: c.id || `adhoc-${idx + 1}`,
        name: c.name || `Ad-hoc ${idx + 1}`,
        messages: Array.isArray(c.messages) ? c.messages : [],
        previousState: c.previousState || null,
        expectations: c.expectations || null,
        inputPayload: c.inputPayload || c.previousState || null,
        input: c.input || null,
      })),
    // simulated 用例由虚拟学习者生成输入，messages 可为空；其余要求至少一条消息
    ].filter((c) => c.messages.length > 0 || extractSimConfig(c.expectations) !== null);

    if (!evalCases.length) {
      return res.status(400).json({
        success: false,
        error: { message: '没有可用的评估用例（DB 用例或 ad-hoc）' },
      });
    }

    // ---- 虚拟学习者模拟输入展开 ----
    // 单用例输入解析失败（如引用的模拟学习者已被删除）→ 跳过该用例并在
    // skipped 中报告，不让整批失败（2026-09-22 交互走查发现的功能故障）
    const { keptCases, keptSimConfigs: simConfigs, keptSimInputs: simInputs, skipped: skippedCases } =
      await partitionSimulatedEvalCases(evalCases, resolveSimulatedEvalInput);
    evalCases.length = 0;
    evalCases.push(...keptCases);
    const repeatCount = Math.max(1, Math.min(5, Number(body.repeatCount || 1)));
    const startedAt = Date.now();
    const results: any[] = [];
    const previousEnvModel = process.env.AI_MODEL;
    if (promptConfig.model) {
      process.env.AI_MODEL = promptConfig.model;
    }

    try {
      for (let ci = 0; ci < evalCases.length; ci += 1) {
        const item = evalCases[ci];
        const sim = simConfigs[ci];
        for (let runIdx = 0; runIdx < repeatCount; runIdx += 1) {
          const callStart = Date.now();

          // ---- 多轮 goal 模拟评估（mode:simulated + dialogueRounds>1）----
          if (sim && sim.dialogueRounds > 1 && canonicalAgentId === 'skill:goal-conversation') {
            const loop = await runSimulatedGoalLoop({
              systemPrompt: promptConfig.systemPrompt,
              caseItem: item,
              simConfig: sim,
              simInput: simInputs[ci] as { learner: any; story: any },
            });
            const lastAgentTurn = [...loop.transcript].reverse().find((t) => t.role === 'goal_agent');
            const simIn = simInputs[ci] as { learner: any; story: any } | null;
            results.push({
              caseId: item.id,
              caseName: item.name,
              runIndex: runIdx + 1,
              durationMs: Date.now() - callStart,
              input: {
                userInput: loop.transcript[0]?.content || '',
                conversationContextCount: 0,
                previousState: item.previousState || {},
              },
              output: {
                userVisible: '',
                stage: lastAgentTurn?.stage || 'simulated',
                confidence: 0,
                // 最终一轮的结构化字段明细（评估核心）
                fields: lastAgentTurn?.fields || null,
              },
              debug: {
                promptVersion: promptConfig.promptVersion,
                attemptCount: 0,
                parseMode: 'rounds',
                failureType: 'none',
                structuredOutputValid: true,
              },
              checks: loop.checks,
              passed: loop.passed,
              transcript: loop.transcript,
              studentTurns: loop.studentTurns,
              converged: loop.converged,
              // 输入侧信息：人设摘要 + 故事 + 当次诉求（结果区展示"输入/输出"）
              simMeta: {
                persona: pickPersonaSummary(simIn?.learner),
                story: simIn?.story
                  ? {
                      title: simIn.story.title || simIn.story.visibleOpening || null,
                      surfaceGoal: simIn.story.goalSeed?.surfaceGoal || null,
                      realProblem: simIn.story.goalSeed?.realProblem || null,
                    }
                  : null,
                demandText: loop.transcript[0]?.content || '',
                frictionBudget: sim.frictionBudget,
                dialogueRounds: sim.dialogueRounds,
              },
            });
            continue;
          }

          // 用 adapter 分发调用（goal 走 executeSkill；path/stage 走 callPrompt + validator）
          const adapterResult = await runSkillEvalCase({
            skillId: canonicalAgentId,
            systemPrompt: promptConfig.systemPrompt,
            caseItem: item,
          });
          const durationMs = Date.now() - callStart;
          const { parsed } = adapterResult;

          // 期望检查：goal 走结构化输出检查；path/stage 走 validator 契约检查
          const expectations = item.expectations || {};
          let checks: Record<string, boolean> = {};
          if (canonicalAgentId === 'skill:goal-conversation') {
            checks = computeGoalChecks(adapterResult.result, expectations);
          } else {
            const { checks: contractChecks } = await runSkillChecks({
              skillId: canonicalAgentId,
              parsed,
              expectations,
              caseItem: item,
            });
            checks = contractChecks;
          }

          const passed = Object.values(checks).every(Boolean);

          results.push({
            caseId: item.id,
            caseName: item.name,
            runIndex: runIdx + 1,
            durationMs,
            input: {
              userInput: String(
                [...item.messages].reverse().find((m: any) => m.role === 'user')?.content || ''
              ),
              conversationContextCount: item.messages.length - 1,
              previousState: item.previousState || {},
            },
            output: {
              userVisible: parsed ? JSON.stringify(parsed).slice(0, 300) : '',
              stage: parsed ? 'n/a' : adapterResult.result?.internal?.core?.stage || 'understanding',
              confidence: adapterResult.result?.internal?.core?.confidence || 0,
              // goal 的结构化字段明细（评估核心）；path/stage 的 parsed 已含字段
              fields: canonicalAgentId === 'skill:goal-conversation'
                ? pickGoalCoreFields(adapterResult.result?.internal?.core)
                : null,
            },
            debug: {
              promptVersion: promptConfig.promptVersion,
              attemptCount: 0,
              parseMode: 'none',
              failureType: parsed ? 'none' : 'raw-output',
              structuredOutputValid: parsed ? true : adapterResult.result?.debug?.structuredOutputValid === true,
            },
            checks,
            passed,
            // simulated 单轮：附输入侧信息（人设摘要 + 诉求 + 模拟配置）
            ...(sim && sim.dialogueRounds <= 1
              ? {
                  simMeta: {
                    persona: pickPersonaSummary(simInputs[ci]?.learner),
                    story: (simInputs[ci] as any)?.story
                      ? {
                          title: (simInputs[ci] as any).story.title || (simInputs[ci] as any).story.visibleOpening || null,
                          surfaceGoal: (simInputs[ci] as any).story.goalSeed?.surfaceGoal || null,
                          realProblem: (simInputs[ci] as any).story.goalSeed?.realProblem || null,
                        }
                      : null,
                    demandText: String([...item.messages].reverse().find((m: any) => m.role === 'user')?.content || ''),
                    frictionBudget: sim.frictionBudget,
                    dialogueRounds: sim.dialogueRounds,
                  },
                }
              : {}),
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
    const runRecord = await createEvalRun({
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
        skipped: skippedCases,
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
    /* 服务端排序（2026-10-17）：列表只回最近 N 条窗口，客户端排会「只排前 N 行」，
       所以排序下推到 SQL。键用列名白名单，未知键回落 createdAt。 */
    const RUN_SORT_FIELDS: Record<string, 'createdAt' | 'durationMs' | 'caseCount' | 'agentId'> = {
      createdAt: 'createdAt',
      durationMs: 'durationMs',
      caseCount: 'caseCount',
      agentId: 'agentId',
    };
    const sortField = RUN_SORT_FIELDS[String(req.query.sort || '')] || 'createdAt';
    const sortOrder = req.query.order === 'asc' ? 'asc' : 'desc';
    const runs = await listEvalRuns(where, limit, { [sortField]: sortOrder });
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
    const r = await findEvalRunById(req.params.id);
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

/**
 * 从模型输出提取 JSON（code-fence / raw / marker）
 */
router.get('/skill-catalog', async (_req: Request, res: Response) => {
  try {
    const topAgents = listTopLevelAgents();

    // 拉所有 ACTIVE prompts 一次性 (避免 N+1)
    const allActivePrompts = await listAllActiveAgentPrompts();
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

export default router;
