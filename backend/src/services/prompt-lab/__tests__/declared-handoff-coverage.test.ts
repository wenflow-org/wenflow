/**
 * 声明边 ↔ 抽取器对账门禁测试（#189）：
 * 配置式跨阶段交接声明的 handoff 行，必须落在对应抽取器实际读取的 agentId 集合内。
 * 真实编排文件必须零告警；范围外声明必须被报出。
 */

import {
  checkConfigDrivenStageHandoffCoverage,
  type StageRoutingDecl,
} from '../input-handoff-check';
import { goalHandoffSourceAgentIds } from '../../field-dispatcher';
import { loadOrchestrationFiles } from '../../field-routing/orchestration-file';

describe('checkConfigDrivenStageHandoffCoverage（声明边↔抽取器对账）', () => {
  it('真实编排文件零告警，且该判据确有可检查对象（非空跑）', () => {
    const stages = loadOrchestrationFiles();
    expect(checkConfigDrivenStageHandoffCoverage(stages)).toEqual([]);

    // 非空跑守卫：goal 阶段确实存在 handoff→path 的声明行，且其中包含 skill 名下的行
    const goal = stages.find((s) => s.stage === 'goal')!;
    const declared = goal.routings.filter((r) => r.handoff.includes('path'));
    expect(declared.length).toBeGreaterThan(1);
    expect(declared.some((r) => r.agentId === 'skill:goal-conversation')).toBe(true);
    // 抽取器读取范围确实覆盖该 skill（#189 修复点）
    expect(goalHandoffSourceAgentIds()).toContain('skill:goal-conversation');
  });

  it('声明行落在抽取器读取范围外 → 报 declared-handoff-not-extractable', () => {
    const stages: StageRoutingDecl[] = [
      {
        stage: 'goal',
        routings: [
          { agentId: 'goal-agent', fieldId: 'understanding.surface_goal', handoff: ['path'] },
          // path-agent 不属于 goal 阶段抽取器的读取范围
          { agentId: 'path-agent', fieldId: 'understanding.skill_nature', handoff: ['path'] },
        ],
      },
    ];
    const issues = checkConfigDrivenStageHandoffCoverage(stages);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('declared-handoff-not-extractable');
    expect(issues[0].message).toContain('path-agent/understanding.skill_nature');
  });

  it('来源阶段缺失 → 报 handoff-extractor-source-stage-missing', () => {
    const issues = checkConfigDrivenStageHandoffCoverage([{ stage: 'teaching', routings: [] }]);
    expect(issues.map((i) => i.code)).toContain('handoff-extractor-source-stage-missing');
  });
});
