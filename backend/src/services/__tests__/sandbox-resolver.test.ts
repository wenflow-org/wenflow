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

    it('teaching 池：teaching-turn.yaml 声明的键全部可解析（对话单键 messages）', () => {
      const pools = buildTeachingSandboxPool({
        sessionMessages: [{ role: 'user', content: 'q' }],
        sessionId: 's1',
        mode: 'active',
        topic: 't',
        learnerProjection: { id: 'u1' },
        knowledgeState: [{ name: 'k1' }],
        classroomContext: { stage: { current: 'teaching' } },
        classroomEventContext: { recentEvents: [] },
        teachingControlContext: { mode: 'normal' },
        scenario: { subject: 's' },
        interactionProfile: { engagement: 'high' },
      });
      const refs = [
        'session.messages',
        'learner.learnerProjection',
        'knowledge.state',
        'classroomContext',
        'classroomEventContext',
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

    it('#192 path 池：stage-designer 声明的 path 通道全部可解析（含本次未注入的显式 null 通道）', () => {
      const pools = buildPathSandboxPool(
        { learnerProfile: { surfaceGoal: '目标' } },
        {
          previousMilestone: { stageNumber: 1, title: '上一阶段' },
          materials: [{ title: '资料', sections: [] }],
          pathStageMap: { stageCount: 2, currentStageNumber: 2, stages: [] },
          allPreviousStageTasks: [{ stageNumber: 1, tasks: ['a'] }],
          repairHints: { replanRatio: 0.7 },
        }
      );
      const result = checkSandboxRefs(
        'path',
        [
          'previousMilestone',
          'normalizedInput',
          'materials',
          'repairHints',
          'supplementRequest',
          'schoolAnchor',
          'pathStageMap',
          'allPreviousStageTasks',
          'previousStageOutcome',
        ],
        pools
      );
      expect(result.missingCount).toBe(0);
    });

    it('#192：kc-mapper 声明的 path.subtasks 对账——真实载荷进池可解析，旧池（仅 normalizedInput）判缺失', async () => {
      const withSubtasks = buildPathSandboxPool({}, { subtasks: [{ taskKey: 'task-1-0', title: '任务' }] });
      const ok = await checkAgentSandboxRefs('kc-mapper', 'path', withSubtasks);
      expect(ok).not.toBeNull();
      expect(ok!.missingCount).toBe(0);
      expect(ok!.resolvedCount).toBeGreaterThan(0);

      // 旧的 path 池形状（只有 normalizedInput/replan/previousMilestone/previousStageOutcome）
      // 就是 #192 的病灶：声明了 path.subtasks，池里没有 → 此前无人对账。
      const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const legacy = await checkAgentSandboxRefs('kc-mapper', 'path', {
        path: { normalizedInput: {}, replan: null, previousMilestone: null, previousStageOutcome: null },
      });
      expect(legacy!.missingCount).toBe(1);
      expect(legacy!.refs[0].missing).toContain('subtasks');
      expect(loggerSpy).toHaveBeenCalledWith(
        '[sandbox-resolver] kc-mapper 沙盘声明键运行时不可解析（声明与装配脱节）',
        expect.objectContaining({ agentAlias: 'path' })
      );
      loggerSpy.mockRestore();
    });

    it('#192：stage-designer 的可选 path 通道默认被跳过，includeOptional 后才纳入对账', async () => {
      const withoutOptional = await extractSandboxRefsFromCore('stage-designer');
      expect(withoutOptional.filter((r) => r.agentAlias === 'path')).toEqual([]);

      const withOptional = await extractSandboxRefsFromCore('stage-designer', { includeOptional: true });
      const paths = withOptional.filter((r) => r.agentAlias === 'path').map((r) => r.path);
      expect(paths).toContain('materials');
      expect(paths).toContain('repairHints');
      expect(paths).toContain('pathStageMap');
      expect(paths).toContain('allPreviousStageTasks');

      const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const ok = await checkAgentSandboxRefs(
        'stage-designer',
        'path',
        buildPathSandboxPool({}, { materials: [{ title: 'm' }] }),
        { includeOptional: true }
      );
      expect(ok!.missingCount).toBe(0);
      expect(loggerSpy).not.toHaveBeenCalled();
      loggerSpy.mockRestore();
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

    it('内置 teaching provider：9 键全部可解析', async () => {
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
          classroomEventContext: { recentEvents: [] },
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
            understanding: { adjustments: '补充说明' },
          },
        }
      );
      expect(result!.missingCount).toBe(0);
    });

    it('path-planning 的可选输入（type: string?）不参与必填对账，缺 adjustments 不再告警', async () => {
      const refs = await extractSandboxRefsFromCore('path-planning');
      expect(refs.some((r) => r.path.endsWith('understanding.adjustments'))).toBe(false);

      const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
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
      expect(loggerSpy).not.toHaveBeenCalled();
      loggerSpy.mockRestore();
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
