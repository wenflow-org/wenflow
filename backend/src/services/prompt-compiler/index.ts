/**
 * Prompt Compiler — 主入口
 * ============================================================
 * 把 PromptSource (.md 系统提示词) 编译为 CompiledPrompt (实际喂给 LLM 的产物).
 *
 * 编译流程:
 *   1. parsePromptSchema(source) → PromptIR
 *   2. getAgentRoutings(agentId) → CompileContext (routing 表)
 *   3. rewriteInputSection / rewriteOutputSection (仅这两段)
 *   4. 其余 6 段 (identity/rules/state_machine/quality/constraints/examples) 不动
 *   5. composePromptSchema(rewrittenIR) → compiled 文本
 *   6. sha256 计算 sourceHash + compileContextHash
 *
 * 失败兜底:
 *   - 任何步骤抛错 → 返回 status='failed' + error, compiled=source (降级)
 *   - 调用方拿到 failed 应当: 落库 status='failed', 但 LLM 仍可拿 systemPrompt 跑
 *
 * 设计原则: 编译失败永远不阻塞 LLM 调用.
 */

import {
  parsePromptSchema,
  composePromptSchema,
  type PromptSchema,
  type PromptBlock,
} from '../prompt-schema';
import { getAgentRoutings, type FieldRoutingRow } from '../field-dispatcher';
import { sha256, stableStringify } from './hash';
import { rewriteInputSection } from './rewrite-input-section';
import { rewriteOutputSection } from './rewrite-output-section';
import { resolveFieldRefs, buildResolverFromSkills, extractFieldRefs } from './resolve-field-refs';
import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';

export type CompileStatus = 'fresh' | 'failed';

export interface CompileResult {
  /** 编译产物文本 (status='failed' 时等于 source) */
  compiled: string;
  /** 编译状态 */
  status: CompileStatus;
  /** 错误信息 (failed 时存在) */
  error?: string;
  /** 警告 (非致命) */
  warnings: string[];
  /** 源 hash (用于 stale 检测) */
  sourceHash: string;
  /** context hash (routing 表稳定 hash, 用于 stale 检测) */
  compileContextHash: string;
  /** 是否真的发生了重写 (no-op 也算 fresh) */
  rewritten: boolean;
  /** 重写应用的字段总数 (input + output) */
  fieldsApplied: number;
  /** 字段引用解析: 总引用数 / 成功 / 失败 */
  fieldRefs?: {
    total: number;
    resolved: number;
    unresolved: number;
  };
}

/**
 * 计算 compileContext hash — 取该 agent 的 routing 表稳定快照
 */
function computeContextHash(routings: FieldRoutingRow[]): string {
  // 只纳入影响编译结果的字段, 不含 timestamps/id
  const snapshot = [...routings]
    .map((r) => ({
      fieldId: r.fieldId,
      render: r.render,
      handoff: r.handoff || [],
      internal: r.internal,
      accumulate: r.accumulate,
      promptRole: r.promptRole || null,
      valueType: r.valueType || null,
      notes: r.notes || null,
    }))
    .sort((a, b) => a.fieldId.localeCompare(b.fieldId));
  return sha256(stableStringify(snapshot));
}

/**
 * 在 IR 中找到指定 section 的所有块 (顺序保留)
 */
function findBlocks(schema: PromptSchema, section: PromptBlock['section']): PromptBlock[] {
  return schema.blocks.filter((b) => b.section === section);
}

/**
 * compilePrompt 主入口
 *
 * @param source PromptSource 文本 (systemPrompt, 不含 frontmatter)
 * @param agentId routing 表查询 key (例: 'goal-conversation', 'skill:goal-conversation')
 *               注意: routing 表里可能存的是 'goal-conversation' 也可能是 'skill:goal-conversation',
 *               caller 应传入与 routing 表 seed 一致的 key.
 */
export async function compilePrompt(
  source: string,
  agentId: string
): Promise<CompileResult> {
  const sourceHash = sha256(source);
  const warnings: string[] = [];

  try {
    // 1) 拉 routing 数据
    const routings = await getAgentRoutings(agentId);
    const contextHash = computeContextHash(routings);

    if (routings.length === 0) {
      // 无 routing 数据 — no-op, 产物 = 源
      return {
        compiled: source,
        status: 'fresh',
        warnings: [`无 routing 数据 (agentId=${agentId}), 产物 = 源`],
        sourceHash,
        compileContextHash: contextHash,
        rewritten: false,
        fieldsApplied: 0,
      };
    }

    // 2) parse 源
    const schema = parsePromptSchema(source);
    if (!schema.blocks.length) {
      warnings.push('源解析后无 blocks (空 prompt?), 产物 = 源');
      return {
        compiled: source,
        status: 'fresh',
        warnings,
        sourceHash,
        compileContextHash: contextHash,
        rewritten: false,
        fieldsApplied: 0,
      };
    }

    // 2b) 字段引用解析 — 把 {{skill:xxx.field}} 渲染为内联注解
    let fieldRefStats: CompileResult['fieldRefs'] | undefined;
    const refsInSource = extractFieldRefs(source);
    if (refsInSource.length > 0) {
      try {
        const allActive = await systemPrisma.agent_prompts.findMany({
          where: { status: 'ACTIVE' },
          select: { agentId: true, systemPrompt: true },
        });
        const resolver = buildResolverFromSkills(
          allActive.map((p) => ({ skillId: p.agentId, source: p.systemPrompt }))
        );
        // 对每个 block.body 跑解析 (保持 IR 结构, 仅修改 body)
        let totalResolved = 0;
        let totalUnresolved = 0;
        for (const blk of schema.blocks) {
          const result = resolveFieldRefs(blk.body, resolver);
          if (result.refs.length > 0) {
            blk.body = result.text;
            totalResolved += result.resolved;
            totalUnresolved += result.unresolved;
            if (result.warnings.length > 0) {
              warnings.push(...result.warnings);
            }
          }
        }
        fieldRefStats = {
          total: refsInSource.length,
          resolved: totalResolved,
          unresolved: totalUnresolved,
        };
      } catch (err: any) {
        warnings.push(`字段引用解析失败: ${err?.message || err}`);
      }
    }

    // 3) 重写 input/output 段
    let totalFieldsApplied = 0;
    let anyRewritten = false;

    const inputBlocks = findBlocks(schema, 'input');
    for (const blk of inputBlocks) {
      const result = rewriteInputSection(blk, routings);
      if (result.rewritten) {
        blk.body = result.body;
        anyRewritten = true;
        totalFieldsApplied += result.fieldsApplied;
      }
    }

    const outputBlocks = findBlocks(schema, 'output');
    for (const blk of outputBlocks) {
      const result = rewriteOutputSection(blk, routings);
      if (result.rewritten) {
        blk.body = result.body;
        anyRewritten = true;
        totalFieldsApplied += result.fieldsApplied;
      }
    }

    // 4) 重新拼回
    const compiled = composePromptSchema(schema);

    return {
      compiled,
      status: 'fresh',
      warnings,
      sourceHash,
      compileContextHash: contextHash,
      rewritten: anyRewritten || (fieldRefStats?.resolved || 0) > 0,
      fieldsApplied: totalFieldsApplied,
      fieldRefs: fieldRefStats,
    };
  } catch (err: any) {
    logger.warn('[prompt-compiler] compile failed, fallback to source', {
      agentId,
      error: err?.message || String(err),
    });
    return {
      compiled: source,
      status: 'failed',
      error: err?.message || String(err),
      warnings,
      sourceHash,
      compileContextHash: '',
      rewritten: false,
      fieldsApplied: 0,
    };
  }
}

/**
 * 便利: 只检查 source/context 是否变了 (用于 stale 检测)
 */
export async function checkCompileFreshness(
  source: string,
  agentId: string,
  knownSourceHash: string | null | undefined,
  knownContextHash: string | null | undefined
): Promise<{ stale: boolean; sourceHash: string; contextHash: string }> {
  const sourceHash = sha256(source);
  const routings = await getAgentRoutings(agentId);
  const contextHash = computeContextHash(routings);
  const stale = sourceHash !== knownSourceHash || contextHash !== knownContextHash;
  return { stale, sourceHash, contextHash };
}

// 导出子模块
export { rewriteInputSection } from './rewrite-input-section';
export { rewriteOutputSection } from './rewrite-output-section';
export { sha256, sha256Short, stableStringify, sha256Object } from './hash';
export {
  resolveFieldRefs,
  buildResolverFromSkills,
  extractFieldRefs,
  type FieldRef,
  type FieldRefResolveResult,
} from './resolve-field-refs';
