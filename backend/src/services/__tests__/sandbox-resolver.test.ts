import {
  resolveSandboxPath,
  checkSandboxRefs,
  checkAgentSandboxRefs,
  checkAgentSandboxRefsFromContext,
  extractSandboxRefsFromCore,
  buildGoalSandboxPool,
  buildTeachingSandboxPool,
  buildPathSandboxPool,
  registerSandboxPoolProvider,
  getSandboxPoolProvider,
} from '../sandbox-resolver.service';
import { logger } from '../../utils/logger';

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

  describe('pool builders', () => {
    it('goal 池：声明键全部可解析（state/history/understanding/confirmedProposal/latestMessage）', () => {
      const pools = buildGoalSandboxPool(
        { understanding: { surface_goal: 'x' }, confirmedProposal: { learning_direction: 'y' } },
        [{ role: 'user', content: '你好' }]
      );
      const result = checkSandboxRefs(
        'goal',
        ['collectedData.state', 'collectedData.history', 'collectedData.understanding', 'collectedData.confirmedProposal', 'collectedData.latestMessage'],
        pools
      );
      expect(result.missingCount).toBe(0);
    });

    it('teaching 池：teaching-turn.yaml 声明的 8 键全部可解析', () => {
      const pools = buildTeachingSandboxPool({
        sessionMessages: [{ role: 'user', content: 'q' }],
        sessionId: 's1',
        mode: 'active',
        topic: 't',
        learnerProjection: { id: 'u1' },
        knowledgeState: [{ name: 'k1' }],
        classroomContext: { stage: { current: 'teaching' } },
        teachingControlContext: { mode: 'normal' },
        scenario: { subject: 's' },
        interactionProfile: { engagement: 'high' },
      });
      const refs = [
        'session.messages',
        'learner.learnerProjection',
        'knowledge.state',
        'classroomContext',
        'visibleDialogueContext',
        'controls.teachingControlContext',
        'scenario',
        'scenario.interactionProfile',
      ];
      const result = checkSandboxRefs('teaching', refs, pools);
      expect(result.missingCount).toBe(0);
    });

    it('path 池：path-planning.yaml 声明的 path 键可解析', () => {
      const pools = buildPathSandboxPool({
        learnerProfile: { surfaceGoal: '目标' },
        confirmedProposal: { learningDirection: '方向' },
      });
      const result = checkSandboxRefs(
        'path',
        ['normalizedInput', 'normalizedInput.learnerProfile.surfaceGoal', 'normalizedInput.confirmedProposal', 'replan', 'previousMilestone'],
        pools
      );
      expect(result.missingCount).toBe(0);
    });
  });

  describe('checkAgentSandboxRefs（统一入口）', () => {
    it('声明缺失时打 warn 并返回明细', async () => {
      const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      // 无状态池 → 声明的 sandbox 键全部不可解析
      const result = await checkAgentSandboxRefs('goal-conversation', 'goal', {}, { warnContext: { conversationId: 'c1' } });
      expect(result).not.toBeNull();
      expect(result!.missingCount).toBeGreaterThan(0);
      expect(loggerSpy).toHaveBeenCalledWith(
        '[sandbox-resolver] goal-conversation 沙盘声明键运行时不可解析（声明与装配脱节）',
        expect.objectContaining({ conversationId: 'c1' })
      );
      loggerSpy.mockRestore();
    });

    it('全部可解析时不打 warn', async () => {
      const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const pools = buildGoalSandboxPool(
        { understanding: { surface_goal: 'x' }, confirmedProposal: null },
        [{ role: 'user', content: 'hi' }]
      );
      const result = await checkAgentSandboxRefs('goal-conversation', 'goal', pools);
      expect(result!.missingCount).toBe(0);
      expect(loggerSpy).not.toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });

  describe('provider 注册表（L2 第三阶段）', () => {
    it('内置 goal provider：声明键全部可解析', async () => {
      const result = await checkAgentSandboxRefsFromContext(
        'goal-conversation',
        'goal',
        {
          previousState: { understanding: { surface_goal: 'x' }, confirmedProposal: null },
          history: [{ role: 'user', content: 'hi' }],
        }
      );
      expect(result!.missingCount).toBe(0);
    });

    it('内置 teaching provider：8 键全部可解析', async () => {
      const result = await checkAgentSandboxRefsFromContext(
        'teaching-turn',
        'teaching',
        {
          sessionMessages: [{ role: 'user', content: 'q' }],
          sessionId: 's1',
          mode: 'active',
          topic: 't',
          learnerProjection: { id: 'u1' },
          knowledgeState: [{ name: 'k1' }],
          classroomContext: { stage: { current: 'teaching' } },
          teachingControlContext: { mode: 'normal' },
          scenario: { subject: 's' },
          interactionProfile: { engagement: 'high' },
        }
      );
      expect(result!.missingCount).toBe(0);
    });

    it('内置 path provider：normalizedInput 声明键可解析', async () => {
      const result = await checkAgentSandboxRefsFromContext(
        'path-planning',
        'path',
        {
          normalizedInputV1: {
            learnerProfile: { surfaceGoal: '目标' },
            confirmedProposal: { learningDirection: '方向' },
          },
        }
      );
      expect(result!.missingCount).toBe(0);
    });

    it('自定义 provider 可注册，构造的池可被 checkSandboxRefs 校验', async () => {
      registerSandboxPoolProvider('test-agent', (ctx) => ({ 'test-agent': { a: { b: ctx.value } } }));
      const provider = getSandboxPoolProvider('test-agent');
      expect(provider).toBeDefined();
      const pools = provider!({ value: 1 });
      const result = checkSandboxRefs('test-agent', ['a.b'], pools);
      expect(result.missingCount).toBe(0);
    });

    it('未注册 agent 返回 null（静默）', async () => {
      const result = await checkAgentSandboxRefsFromContext('goal-conversation', 'ghost-agent', {});
      expect(result).toBeNull();
    });
  });
});
