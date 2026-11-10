/**
 * #192 复核残留回归：stage-designer / kc-mapper 的沙盘对账必须只有一个入口。
 *
 * 病灶：生成链与重排链各自调 checkAgentSandboxRefs，重排侧漏传 includeOptional ⇒
 * kc-mapper 的可选通道（prerequisiteTree）恒不参与对账，声明与载荷漂移永远不可见。
 * 现在两处都走 auditPathStageAgentsSandboxRefs，可选口径只在这里写一次。
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../../sandbox-resolver.service', () => {
  const actual = jest.requireActual('../../../sandbox-resolver.service');
  return { ...actual, checkAgentSandboxRefs: jest.fn(async () => null) };
});

import { auditPathStageAgentsSandboxRefs } from '../stage-sandbox-ref-audit';
import { checkAgentSandboxRefs } from '../../../sandbox-resolver.service';

const mockCheck = checkAgentSandboxRefs as jest.MockedFunction<typeof checkAgentSandboxRefs>;

describe('auditPathStageAgentsSandboxRefs', () => {
  beforeEach(() => mockCheck.mockClear());

  it('两次对账都带 includeOptional，且 kc-mapper 池里是真实的顶层 prerequisiteTree/subtasks', async () => {
    await auditPathStageAgentsSandboxRefs({
      pathId: 'p1',
      normalizedInput: { learnerProfile: { surfaceGoal: '目标' } },
      stageDesignerPayload: { materials: [] },
      kcMapperPayload: {
        subtasks: [{ taskKey: 'task-1-0' }],
        prerequisiteTree: { unknownConcepts: [{ concept: '问题结构' }] },
      },
      warnContext: { boundary: 'replan', stageNumber: 2 },
    });

    expect(mockCheck).toHaveBeenCalledTimes(2);
    const [stageDesignerCall, kcMapperCall] = mockCheck.mock.calls;

    expect(stageDesignerCall[0]).toBe('stage-designer');
    expect(stageDesignerCall[1]).toBe('path');
    expect(stageDesignerCall[3]).toMatchObject({ includeOptional: true });

    expect(kcMapperCall[0]).toBe('kc-mapper');
    expect(kcMapperCall[1]).toBe('path');
    expect(kcMapperCall[3]).toMatchObject({
      includeOptional: true,
      warnContext: { pathId: 'p1', boundary: 'replan', stageNumber: 2 },
    });

    const kcPool = kcMapperCall[2].path as Record<string, unknown>;
    expect(kcPool.prerequisiteTree).toEqual({ unknownConcepts: [{ concept: '问题结构' }] });
    expect(kcPool.subtasks).toHaveLength(1);
    // 通道登记：本次未注入的键也在池里（显式 null），声明不会因「没注入」误判缺失
    expect(kcPool).toHaveProperty('milestones');
  });

  it('对账异常被吞掉，不影响调用方', async () => {
    mockCheck.mockRejectedValueOnce(new Error('boom'));
    await expect(
      auditPathStageAgentsSandboxRefs({
        pathId: 'p2',
        normalizedInput: {},
        stageDesignerPayload: null,
        kcMapperPayload: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('生成链 / 重排链两个调用点都只走共享入口，不再各自调 checkAgentSandboxRefs（漏传 includeOptional 的复发面）', () => {
    const callSites = ['../stage-enrichment.ts', '../../replan/path-replan.kc-sync.ts'];
    for (const relativePath of callSites) {
      const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf-8');
      expect(source).toContain('auditPathStageAgentsSandboxRefs(');
      expect(source).not.toMatch(/checkAgentSandboxRefs\s*\(/);
    }
  });
});
