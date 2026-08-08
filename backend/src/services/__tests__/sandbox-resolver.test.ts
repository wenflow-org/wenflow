import {
  resolveSandboxPath,
  checkSandboxRefs,
  extractSandboxRefsFromCore,
} from '../sandbox-resolver.service';

describe('sandbox-resolver', () => {
  describe('resolveSandboxPath', () => {
    it('按点路径解析嵌套值', () => {
      const pool = {
        collectedData: {
          state: { stage: 'proposing', confidence: 0.8 },
          history: [{ role: 'user', text: '你好' }],
        },
      };
      const state = resolveSandboxPath('collectedData.state', pool);
      expect(state.resolved).toBe(true);
      expect(state.value).toEqual({ stage: 'proposing', confidence: 0.8 });

      const history = resolveSandboxPath('collectedData.history', pool);
      expect(history.resolved).toBe(true);
      expect(history.value).toHaveLength(1);
    });

    it('缺路径返回 missing 描述', () => {
      const result = resolveSandboxPath('collectedData.ghost', { collectedData: {} });
      expect(result.resolved).toBe(false);
      expect(result.missing).toContain('ghost');
    });

    it('空池返回 missing', () => {
      const result = resolveSandboxPath('collectedData.state', {});
      expect(result.resolved).toBe(false);
      expect(result.missing).toContain('collectedData');
    });
  });

  describe('checkSandboxRefs', () => {
    const pools = {
      goal: {
        collectedData: {
          state: { stage: 'understanding' },
          history: [],
          understanding: { surface_goal: 'x' },
        },
      },
    };

    it('全部可解析时 missingCount=0', () => {
      const result = checkSandboxRefs('goal', ['collectedData.state', 'collectedData.history', 'collectedData.understanding'], pools);
      expect(result.missingCount).toBe(0);
      expect(result.resolvedCount).toBe(3);
    });

    it('部分缺失时返回明细', () => {
      const result = checkSandboxRefs('goal', ['collectedData.state', 'collectedData.confirmedProposal'], pools);
      expect(result.missingCount).toBe(1);
      expect(result.refs.find((r) => r.path === 'collectedData.confirmedProposal')?.missing).toContain('confirmedProposal');
    });

    it('无状态池时全部 missing', () => {
      const result = checkSandboxRefs('simulation', ['story'], pools);
      expect(result.missingCount).toBe(1);
      expect(result.refs[0].missing).toContain('无状态池');
    });
  });

  describe('extractSandboxRefsFromCore', () => {
    it('从 goal-conversation core 声明提取 sandbox ref（拆分 agent 别名与池内路径）', async () => {
      const refs = await extractSandboxRefsFromCore('goal-conversation');
      expect(refs.length).toBeGreaterThanOrEqual(2);
      expect(refs).toContainEqual({ agentAlias: 'goal', path: 'collectedData.state' });
      expect(refs).toContainEqual({ agentAlias: 'goal', path: 'collectedData.history' });
    });

    it('未知 skill 返回空数组', async () => {
      const refs = await extractSandboxRefsFromCore('not-a-real-skill');
      expect(refs).toEqual([]);
    });
  });
});
