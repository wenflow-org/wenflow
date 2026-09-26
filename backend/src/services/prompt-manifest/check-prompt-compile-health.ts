/**
 * 编译层健康分析（健康中心检查项 prompt-compile 的分析层）
 *
 * 对每条 ACTIVE prompt 跑 prompt-compiler 的 compilePrompt（演练编译：不落库、不改状态），
 * 回答三个问题：
 * 1. 演练编译是否失败 —— 失败时运行时把未重写的源文本发给模型（getActivePrompt 的降级路径），
 *    这正是「编译失败永远不阻塞 LLM 调用」设计下的静默面；
 * 2. {{skill:…}} 字段引用是否有死引用 —— 解析失败的占位符原样保留进 prompt（只给 warning）；
 * 3. 已落库的编译产物是否过期 —— 源文本或路由表变化后，落库产物落后于演练结果。
 *
 * runCompile 参数注入默认 compilePrompt：测试可换桩，避免触碰真实路由表/系统库。
 * routingKey 约定与 /admin/prompt-ops/:agentId/compile-info 一致（去 skill: 前缀查路由表）。
 */

import type { CompileResult } from '../prompt-compiler';

export interface PromptCompileActiveRow {
  agentId: string;
  systemPrompt: string | null;
  compileStatus?: string | null;
  compiledSystemPrompt?: string | null;
  sourceHash?: string | null;
  compileContextHash?: string | null;
}

export interface PromptCompileFailure {
  agentId: string;
  error: string;
}

export interface PromptCompileUnresolved {
  agentId: string;
  count: number;
  /** 第一条解析告警原文，供定位死引用 */
  sample: string;
}

export interface PromptCompileStale {
  agentId: string;
}

export interface PromptCompileHealthReport {
  total: number;
  failures: PromptCompileFailure[];
  unresolved: PromptCompileUnresolved[];
  stale: PromptCompileStale[];
  /** 落库产物仍新鲜的行数；其余行（含从未落库的）运行时由源文本直出 */
  persistedFresh: number;
}

export type PromptCompileRunner = (source: string, agentId: string) => Promise<CompileResult>;

/** 路由表查询 key 约定：agent_prompts.agentId 可能带 skill: 前缀，路由表按无前缀 key 存 */
export function routingKeyFor(agentId: string): string {
  return agentId.startsWith('skill:') ? agentId.slice(6) : agentId;
}

export async function analyzePromptCompileHealth(
  rows: PromptCompileActiveRow[],
  runCompile: PromptCompileRunner,
): Promise<PromptCompileHealthReport> {
  const report: PromptCompileHealthReport = {
    total: rows.length,
    failures: [],
    unresolved: [],
    stale: [],
    persistedFresh: 0,
  };

  for (const row of rows) {
    const agentId = String(row.agentId || 'unknown');
    const source = row.systemPrompt || '';
    if (!source.trim()) {
      report.failures.push({ agentId, error: '生效提示词文本为空' });
      continue;
    }

    let result: CompileResult;
    try {
      result = await runCompile(source, routingKeyFor(agentId));
    } catch (error) {
      report.failures.push({ agentId, error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    if (result.status === 'failed') {
      report.failures.push({ agentId, error: result.error || '演练编译返回 failed' });
      continue;
    }

    const unresolvedCount = result.fieldRefs?.unresolved ?? 0;
    if (unresolvedCount > 0) {
      report.unresolved.push({ agentId, count: unresolvedCount, sample: result.warnings[0] || '' });
    }

    // 落库产物新鲜度：仅对「确实落过库」的行判过期；从未落库的行是当前阶段设计（演练不落库）
    if (
      row.compileStatus === 'fresh' &&
      typeof row.compiledSystemPrompt === 'string' &&
      row.compiledSystemPrompt.length > 0
    ) {
      const sourceChanged =
        !!row.sourceHash && !!result.sourceHash && row.sourceHash !== result.sourceHash;
      const contextChanged =
        !!row.compileContextHash &&
        !!result.compileContextHash &&
        row.compileContextHash !== result.compileContextHash;
      if (sourceChanged || contextChanged) {
        report.stale.push({ agentId });
      } else {
        report.persistedFresh += 1;
      }
    }
  }

  return report;
}
