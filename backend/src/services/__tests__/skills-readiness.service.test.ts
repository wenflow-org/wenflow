import {
  analyzeW1,
  analyzeW2,
  analyzeW3,
  analyzeW4,
  W3_STEPS_EMPTY_EXEMPT,
  ZOMBIE_SKILL_IDS,
} from '../skills-readiness.service';
import type { SkillsBook } from '../skill-registry/skills-file';
import type { CoreHashParityReport } from '../../scripts/check-core-hash-parity';

function makeEntry(overrides: Partial<Record<string, unknown>>): SkillsBook['skills'][number] {
  return {
    skillId: 'x',
    kind: 'mainline',
    handlerRef: 'backend/src/skills/x/index.ts',
    coreFile: 'prompts/core/x.yaml',
    ...(overrides as any),
  };
}

function makeBook(entries: SkillsBook['skills']): SkillsBook {
  return { version: 1, skills: entries };
}

function makeParityReport(results: CoreHashParityReport['results']): CoreHashParityReport {
  return { results, summary: { scannedFiles: results.length, declaredFiles: 0, inSyncCount: 0, errorCount: 0, statuses: {} }, hasErrors: false };
}

describe('skills-readiness：W1 ACTIVE 覆盖', () => {
  it('正例：全量 ACTIVE 覆盖（handler-only noPromptFile 豁免）→ ok 零 warn', () => {
    const book = makeBook([
      makeEntry({ skillId: 'goal-conversation' }),
      makeEntry({ skillId: 'learner-model', kind: 'handler-only', noPromptFile: true }),
    ]);
    const check = analyzeW1(book, [{ agentId: 'skill:goal-conversation' }]);
    expect(check.ok).toBe(true);
    expect(check.missingActive).toEqual([]);
    expect(check.zombieActive).toEqual([]);
    expect(check.items).toEqual([]);
  });

  it('反例：缺 ACTIVE（missingActive）、不在户口簿的 ACTIVE（zombieActive）、僵尸技能 ACTIVE 不入告警（保留决策必需资产）', () => {
    const book = makeBook([
      makeEntry({ skillId: 'goal-conversation' }),
      makeEntry({ skillId: 'basic-evaluator', kind: 'aux' }),
    ]);
    const check = analyzeW1(book, [
      { agentId: 'skill:ghost-skill' },
      { agentId: 'skill:basic-evaluator' },
    ]);
    expect(check.ok).toBe(false);
    expect(check.missingActive).toEqual(['goal-conversation']);
    expect(check.zombieActive).toEqual(['ghost-skill']);
    expect(check.zombieSkillActive).toEqual(['basic-evaluator']); // 审计计数保留
    // 僵尸项 ACTIVE 为保留注册决策下的必需资产（handler requireActivePrompt: true），不计入告警 items
    expect(check.items.map((i) => i.code)).toEqual(['W1', 'W1']);
    expect(ZOMBIE_SKILL_IDS).toEqual(expect.arrayContaining(['basic-evaluator', 'goal-alignment-checker', 'course-design']));
  });
});

describe('skills-readiness：W2 注册对账', () => {
  it('正例：注册全覆盖（agents/platform-direct 豁免方向 A）→ ok', () => {
    const book = makeBook([
      makeEntry({ skillId: 'goal-conversation' }),
      makeEntry({ skillId: 'learner-model', kind: 'handler-only', registrationPoint: 'agents' }),
      makeEntry({ skillId: 'semantic-freeze-judge', kind: 'aux', registrationPoint: 'platform-direct' }),
    ]);
    const check = analyzeW2(book, [{ name: 'goal-conversation' }]);
    expect(check.ok).toBe(true);
    expect(check.missingRegistration).toEqual([]);
    expect(check.zombieRegistration).toEqual([]);
  });

  it('反例：缺注册（missingRegistration）+ 幽灵行（zombieRegistration）', () => {
    const book = makeBook([makeEntry({ skillId: 'goal-conversation' })]);
    const check = analyzeW2(book, [
      { name: 'ghost-registration' },
    ]);
    expect(check.ok).toBe(false);
    expect(check.missingRegistration).toEqual(['goal-conversation']);
    expect(check.zombieRegistration).toEqual(['ghost-registration']);
  });
});

describe('skills-readiness：W3 接线双向', () => {
  const mockDefinitions = [
    {
      id: 'goal-agent',
      steps: [{ agentId: 'skill:goal-conversation' }],
    },
    {
      id: 'teaching-agent',
      steps: [{ agentId: 'skill:teaching-opening-generator' }],
    },
    {
      id: 'simulation-agent',
      steps: [{ agentId: 'skill:virtual-learner-goal-dialogue-simulator' }],
    },
  ];

  it('正例：户口簿 coordinator 全部接线；steps:[] 三例与无 coordinator 条目豁免 → ok', () => {
    const book = makeBook([
      // steps 非空且已接线（mock definitions 引用的全部 skill 均登记）
      makeEntry({ skillId: 'goal-conversation', coordinator: { agentId: 'goal-agent', steps: [{ step: 1, role: 'goal-clarification' }] } }),
      makeEntry({ skillId: 'teaching-opening-generator', kind: 'aux', coordinator: { agentId: 'teaching-agent', steps: [{ step: 2, role: 'opening-generation' }] } }),
      makeEntry({ skillId: 'virtual-learner-goal-dialogue-simulator', coordinator: { agentId: 'simulation-agent', steps: [{ step: 1, role: 'goal-stage-learner-turn-simulation' }] } }),
      // steps:[] 豁免清单三例
      makeEntry({ skillId: 'adaptive-guidance-copy', coordinator: { agentId: 'teaching-agent', steps: [] } }),
      makeEntry({ skillId: 'virtual-learner-persona-designer', coordinator: { agentId: 'simulation-agent', steps: [] } }),
      makeEntry({ skillId: 'virtual-learner-scenario-designer', coordinator: { agentId: 'simulation-agent', steps: [] } }),
      // 无 coordinator 块的 aux（service 直调）与 platform-direct
      makeEntry({ skillId: 'learner-progress-report', kind: 'aux' }),
      makeEntry({ skillId: 'semantic-freeze-judge', kind: 'aux', registrationPoint: 'platform-direct' }),
    ]);
    const check = analyzeW3(book, mockDefinitions);
    expect(check.ok).toBe(true);
    expect(check.stepWithoutBook).toEqual([]);
    expect(check.bookWithoutStep).toEqual([]);
    expect(check.exempted).toEqual(expect.arrayContaining(Object.keys(W3_STEPS_EMPTY_EXEMPT)));
  });

  it('反例：definition steps 引用不在户口簿（stepWithoutBook）+ 户口簿登记未接线（bookWithoutStep）', () => {
    const book = makeBook([
      makeEntry({ skillId: 'orphan-skill', coordinator: { agentId: 'goal-agent', steps: [{ step: 9, role: 'never-wired' }] } }),
    ]);
    const check = analyzeW3(book, mockDefinitions);
    expect(check.ok).toBe(false);
    // mock definitions 引用的 skill 全不在活跃集 → 方向 A 逐条报
    expect(check.stepWithoutBook).toEqual([
      'goal-agent → goal-conversation',
      'simulation-agent → virtual-learner-goal-dialogue-simulator',
      'teaching-agent → teaching-opening-generator',
    ]);
    // orphan-skill 的 coordinator.steps 非空但 goal-agent definition 无该 skill → 方向 B
    expect(check.bookWithoutStep).toEqual(['orphan-skill']);
  });
});

describe('skills-readiness：W4 core 漂移（复用 check-core-hash-parity）', () => {
  it('正例：活跃集内 in-sync 与 not-declared/missing-active 过滤 → ok 零 warn', () => {
    const book = makeBook([makeEntry({ skillId: 'goal-conversation' }), makeEntry({ skillId: 'v2-skill' })]);
    const report = makeParityReport([
      { agentId: 'skill:goal-conversation', filePath: 'f', status: 'in-sync' },
      { agentId: 'skill:goal-conversation', filePath: 'f', status: 'missing-active' },
      { agentId: 'skill:v2-skill', filePath: 'f', status: 'not-declared' },
    ]);
    const check = analyzeW4(book, report);
    expect(check.ok).toBe(true);
    expect(check.drifted).toEqual([]);
    expect(check.items).toEqual([]);
  });

  it('反例：drift/db-mismatch/core-file-missing 报 warn；不在户口簿的缺 ACTIVE 归 W1 不重复报', () => {
    const book = makeBook([makeEntry({ skillId: 'goal-conversation' })]);
    const report = makeParityReport([
      { agentId: 'skill:goal-conversation', filePath: 'f', status: 'drift' },
      { agentId: 'skill:goal-conversation', filePath: 'f', status: 'db-mismatch' },
      { agentId: 'skill:not-in-book', filePath: 'f', status: 'missing-active' },
      { agentId: 'skill:not-in-book', filePath: 'f', status: 'drift' },
    ]);
    const check = analyzeW4(book, report);
    expect(check.ok).toBe(false);
    expect(check.drifted).toEqual(['skill:goal-conversation']);
    // 不在户口簿的条目（含 drift）不重复报（missing-active 归 W1）
    expect(check.drifted).not.toEqual(expect.arrayContaining(['skill:not-in-book']));
    expect(check.scanned).toBe(2);
  });
});
