/**
 * 编译层健康分析（check-prompt-compile-health）单元测试
 *
 * runCompile 全程注入桩，不触碰真实路由表/系统库：
 * 1. 演练失败 / 源文本为空 → failures（error 面）；
 * 2. 死引用（fieldRefs.unresolved > 0）→ unresolved + 告警样本；
 * 3. 落库产物过期（sourceHash / compileContextHash 不一致）→ stale；
 *    从未落库（compileStatus 非 fresh）不算过期（当前阶段演练不落库）；
 * 4. routingKeyFor 去 skill: 前缀。
 */

import {
  analyzePromptCompileHealth,
  routingKeyFor,
  type PromptCompileActiveRow,
  type PromptCompileRunner,
} from '../prompt-manifest/check-prompt-compile-health';
import type { CompileResult } from '../prompt-compiler';

function row(overrides: Partial<PromptCompileActiveRow> = {}): PromptCompileActiveRow {
  return {
    agentId: 'skill:goal-conversation',
    systemPrompt: '## 身份\n测试提示词',
    ...overrides,
  };
}

function freshResult(overrides: Partial<CompileResult> = {}): CompileResult {
  return {
    compiled: 'compiled',
    status: 'fresh',
    warnings: [],
    sourceHash: 'hash-source-1',
    compileContextHash: 'hash-ctx-1',
    rewritten: false,
    fieldsApplied: 0,
    ...overrides,
  };
}

describe('routingKeyFor', () => {
  it('去 skill: 前缀；无前缀原样返回', () => {
    expect(routingKeyFor('skill:goal-conversation')).toBe('goal-conversation');
    expect(routingKeyFor('goal-conversation')).toBe('goal-conversation');
  });
});

describe('analyzePromptCompileHealth', () => {
  it('空行集 → 全空报告', async () => {
    const run = jest.fn();
    const report = await analyzePromptCompileHealth([], run);
    expect(report).toEqual({ total: 0, failures: [], unresolved: [], stale: [], persistedFresh: 0 });
    expect(run).not.toHaveBeenCalled();
  });

  it('演练失败 → failures（error 面）；后续行继续分析', async () => {
    const run: PromptCompileRunner = async (source, agentId) => {
      if (agentId === 'bad-skill') return freshResult({ status: 'failed', error: 'parse boom' });
      return freshResult();
    };
    const report = await analyzePromptCompileHealth(
      [row({ agentId: 'skill:bad-skill' }), row({ agentId: 'skill:good-skill' })],
      run,
    );
    expect(report.failures).toEqual([{ agentId: 'skill:bad-skill', error: 'parse boom' }]);
    expect(report.persistedFresh).toBe(0); // good 行从未落库，不计新鲜
  });

  it('runCompile 抛异常按失败收录，不中断整轮', async () => {
    const run: PromptCompileRunner = async () => {
      throw new Error('routing 表查询炸了');
    };
    const report = await analyzePromptCompileHealth([row()], run);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].error).toContain('routing 表查询炸了');
  });

  it('源文本为空 → 直接记失败，不调用编译', async () => {
    const run = jest.fn().mockResolvedValue(freshResult());
    const report = await analyzePromptCompileHealth([row({ systemPrompt: '   ' })], run);
    expect(report.failures).toEqual([{ agentId: 'skill:goal-conversation', error: '生效提示词文本为空' }]);
    expect(run).not.toHaveBeenCalled();
  });

  it('死引用 → unresolved + 第一条告警样本', async () => {
    const run: PromptCompileRunner = async () =>
      freshResult({
        fieldRefs: { total: 3, resolved: 2, unresolved: 1 },
        warnings: ['字段引用 skill:xxx.path 未解析'],
      });
    const report = await analyzePromptCompileHealth([row()], run);
    expect(report.unresolved).toEqual([
      { agentId: 'skill:goal-conversation', count: 1, sample: '字段引用 skill:xxx.path 未解析' },
    ]);
  });

  it('落库产物：哈希一致计新鲜；源或路由表变化判过期', async () => {
    const freshPersisted = row({
      compileStatus: 'fresh',
      compiledSystemPrompt: 'compiled',
      sourceHash: 'hash-source-1',
      compileContextHash: 'hash-ctx-1',
    });
    const staleBySource = row({
      agentId: 'skill:stale-source',
      compileStatus: 'fresh',
      compiledSystemPrompt: 'compiled',
      sourceHash: 'hash-source-OLD',
      compileContextHash: 'hash-ctx-1',
    });
    const staleByContext = row({
      agentId: 'skill:stale-ctx',
      compileStatus: 'fresh',
      compiledSystemPrompt: 'compiled',
      sourceHash: 'hash-source-1',
      compileContextHash: 'hash-ctx-OLD',
    });
    const neverPersisted = row({ agentId: 'skill:never-persisted', compileStatus: null, compiledSystemPrompt: null });

    const report = await analyzePromptCompileHealth(
      [freshPersisted, staleBySource, staleByContext, neverPersisted],
      async () => freshResult(),
    );
    expect(report.persistedFresh).toBe(1);
    expect(report.stale.map((s) => s.agentId).sort()).toEqual(['skill:stale-ctx', 'skill:stale-source']);
    expect(report.failures).toHaveLength(0);
  });
});
