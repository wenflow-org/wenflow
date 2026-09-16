import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseSkillsFile,
  validateSkillsContent,
  SKILLS_FILE_PATH,
  loadSkillsBookRaw,
  getActiveSkillIds,
  getParentAgentMembers,
  resolveRegistrationPoint,
} from '../skills-file';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-file-test-'));

function writeTempYaml(content: string): string {
  const filePath = path.join(TMP_DIR, `skills-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('skills-file loader（P0 户口簿）', () => {
  it('加载真实 prompts/skills.yaml：活跃登记完整、kind/stage 分布符合规格', () => {
    const book = parseSkillsFile(SKILLS_FILE_PATH);
    expect(book.version).toBe(1);

    // 计数不硬编码（新增/退役 skill 不应触发测试改动）：只断言结构不变量——
    // 每条登记都落在合法 kind 中、三类之和 == 活跃集、skillId 全表唯一。
    const byKind = (kind: string) => book.skills.filter((entry) => entry.kind === kind);
    const KINDS = ['mainline', 'handler-only', 'aux'] as const;
    expect(book.skills.every((entry) => (KINDS as readonly string[]).includes(entry.kind))).toBe(true);
    expect(KINDS.reduce((sum, kind) => sum + byKind(kind).length, 0)).toBe(book.skills.length);
    expect(new Set(book.skills.map((entry) => entry.skillId)).size).toBe(book.skills.length);

    const mainlineStages = byKind('mainline').map((entry) => entry.stage);
    expect(mainlineStages.every((stage) => ['goal', 'path', 'teaching', 'profile', 'simulation'].includes(stage!))).toBe(true);
    // 规格：主链五个阶段各有 mainline 归属（按阶段集合对账，不数条数）
    expect([...new Set(mainlineStages)].sort()).toEqual(['goal', 'path', 'profile', 'simulation', 'teaching']);

    const handlerOnly = byKind('handler-only');
    expect(handlerOnly.every((entry) => entry.noPromptFile === true)).toBe(true);
    expect(handlerOnly.map((entry) => entry.skillId).sort()).toEqual(['learner-model', 'mcp-tool']);

    const learnerModel = byKind('handler-only').find((entry) => entry.skillId === 'learner-model')!;
    expect(resolveRegistrationPoint(learnerModel)).toBe('agents');
    const semanticFreezeJudge = byKind('aux').find((entry) => entry.skillId === 'semantic-freeze-judge')!;
    expect(resolveRegistrationPoint(semanticFreezeJudge)).toBe('platform-direct');
    expect(semanticFreezeJudge.platformGate).toBe(true);

    // 2026-09-15：course-design / basic-evaluator / goal-alignment-checker 已正式退役，
    // 不在户口簿活跃集内（并已进入 retired-skills.ts 名单）。
    for (const id of ['course-design', 'basic-evaluator', 'goal-alignment-checker']) {
      expect(book.skills.find((item) => item.skillId === id)).toBeUndefined();
    }
  });

  it('派生视图：活跃集与登记一致、parentAgent 归属映射（保序）', () => {
    const book = loadSkillsBookRaw();
    // 活跃集 == 登记条数（不硬编码数字）；成员映射按 parentAgent 派生、保序
    expect(getActiveSkillIds(book).size).toBe(book.skills.length);
    expect(getActiveSkillIds(book).size).toBe(new Set(book.skills.map((entry) => entry.skillId)).size);
    const members = getParentAgentMembers(book);
    expect(members.get('goal-agent')).toEqual(['skill:goal-conversation']);
    expect(members.get('path-agent')).toEqual(['skill:path-planning', 'skill:stage-designer', 'skill:path-reviewer', 'skill:kc-mapper']);
    expect(members.get('teaching-agent')).toEqual([
      'skill:teaching-turn',
      'skill:peer-reinforcement',
      'skill:session-wrapup',
      'skill:adaptive-guidance-copy',
    ]);
    expect(members.get('profile-agent')).toEqual(['skill:learner-model', 'skill:lesson-knowledge-enricher', 'skill:learning-predictor']);
    expect(members.get('simulation-agent')).toHaveLength(9);
    expect(members.has('mcp-tool')).toBe(false);
  });

  it('F1：非法 kind 值域 fail-fast', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: bogus
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/skills/x-test/index.ts
    coreFile: prompts/core/x-test.yaml
`)).toThrow(/kind=bogus 非法/);
  });

  it('F1/F3：mainline 缺 stage、stage 非法值域 fail-fast', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: mainline
    parentAgent: goal-agent
    handlerRef: backend/src/skills/x-test/index.ts
    coreFile: prompts/core/x-test.yaml
`)).toThrow(/stage 必填/);
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: mainline
    stage: bogus
    parentAgent: goal-agent
    handlerRef: backend/src/skills/x-test/index.ts
    coreFile: prompts/core/x-test.yaml
`)).toThrow(/stage=bogus 非法/);
  });

  it('F2：重复 skillId fail-fast', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: dup-test
    kind: aux
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    coreFile: prompts/core/dup-test.yaml
  - skillId: dup-test
    kind: aux
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    coreFile: prompts/core/dup-test.yaml
`)).toThrow(/重复/);
  });

  it('F4：parentAgent 不在 manifest 顶层 agent 中 fail-fast', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: mainline
    stage: goal
    parentAgent: bogus-agent
    handlerRef: backend/src/skills/x-test/index.ts
    coreFile: prompts/core/x-test.yaml
`)).toThrow(/parentAgent=bogus-agent 非法/);
  });

  it('F7：handler-only 禁填 coreFile、mainline/aux 禁 noPromptFile=true fail-fast', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: handler-only
    handlerRef: backend/src/skills/x-test/index.ts
    coreFile: prompts/core/x-test.yaml
`)).toThrow(/coreFile 禁填/);
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: mainline
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/skills/x-test/index.ts
    coreFile: prompts/core/x-test.yaml
    noPromptFile: true
`)).toThrow(/noPromptFile=true 与 kind=mainline 冲突/);
  });

  it('F8：活跃集与退役名单（retired-skills.ts）互斥 fail-fast', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: prompt-compiler
    kind: aux
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    coreFile: prompts/core/prompt-compiler.yaml
`)).toThrow(/退役名单冲突/);
  });

  it('F9：alias 与另一 skillId 冲突 fail-fast', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test-a
    kind: aux
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    coreFile: prompts/core/x-test-a.yaml
    aliases: [x-test-b]
  - skillId: x-test-b
    kind: aux
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    coreFile: prompts/core/x-test-b.yaml
`)).toThrow(/alias "x-test-b" 与另一 skillId 冲突/);
  });

  it('F9：alias 全表重复 fail-fast', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test-a
    kind: aux
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    coreFile: prompts/core/x-test-a.yaml
    aliases: [shared-alias]
  - skillId: x-test-b
    kind: aux
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    coreFile: prompts/core/x-test-b.yaml
    aliases: [shared-alias]
`)).toThrow(/重复/);
  });

  it('F10：coordinator agentId 非法 fail-fast', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: mainline
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/skills/x-test/index.ts
    coreFile: prompts/core/x-test.yaml
    coordinator:
      agentId: bogus-agent
      steps:
        - { step: 1, role: r }
`)).toThrow(/coordinator.agentId=bogus-agent 非法/);
  });

  it('F10：step 引用自身 skillId 合法、引用未知 id 非法', () => {
    const okContent = `
version: 1
skills:
  - skillId: x-test
    kind: mainline
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/skills/x-test/index.ts
    coreFile: prompts/core/x-test.yaml
    coordinator:
      agentId: goal-agent
      steps:
        - { step: 1, role: goal-clarification, agentId: skill:x-test }
`;
    expect(() => validateSkillsContent(okContent)).not.toThrow();
    expect(() => validateSkillsContent(okContent.replace('skill:x-test', 'skill:unknown-skill'))).toThrow(/steps\[0\].agentId=skill:unknown-skill 非法/);
  });

  it('F5：handlerRef 文件不存在 fail-fast', () => {
    const filePath = writeTempYaml(`
version: 1
skills:
  - skillId: temp-test-skill
    kind: mainline
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/does-not-exist-xyz/index.ts
    coreFile: prompts/core/goal-conversation.yaml
`);
    expect(() => parseSkillsFile(filePath)).toThrow(/handlerRef 文件不存在/);
  });

  it('F6：coreFile 文件不存在 fail-fast', () => {
    const filePath = writeTempYaml(`
version: 1
skills:
  - skillId: temp-test-skill
    kind: mainline
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/skills/goal-conversation/index.ts
    coreFile: prompts/core/does-not-exist.yaml
`);
    expect(() => parseSkillsFile(filePath)).toThrow(/coreFile 文件不存在/);
  });

  it('F1：未知字段拒绝（防户口簿字段漂移）', () => {
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: aux
    handlerRef: backend/src/skills/v4-aux-skills/index.ts
    coreFile: prompts/core/x-test.yaml
    bogusField: 1
`)).toThrow(/未知字段/);
  });
});
