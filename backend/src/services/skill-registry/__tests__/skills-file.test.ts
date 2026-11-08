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
import { listAgentManifest } from '../../agent-manifest.service';

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
    // #235：noPromptFile 是「有没有提示词文件」的字面语义，不再恒等于 handler-only。
    // 声明了独立提示词产物（promptArtifact）的 handler-only 必须为 false，其余默认 true。
    expect(handlerOnly.every((entry) => (
      entry.promptArtifact ? entry.noPromptFile === false : entry.noPromptFile === true
    ))).toBe(true);
    // 与文件头"计数不硬编码"一致：只断言已知成员存在，新增 handler-only 不再需要改本测试
    expect(handlerOnly.map((entry) => entry.skillId)).toEqual(
      expect.arrayContaining(['learner-model', 'mcp-tool', 'web-search'])
    );

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
    ]);
    // 2026-10-14 用户拍板：adaptive-guidance-copy 归画像阶段（它产出的是给学习者看的页面文案，
    // 消费的是画像阶段的 learnerSnapshot/learningState，授课链 routings 里没有它的 handoff）
    // → 从 teaching-agent 移到 profile-agent（按登记顺序排在首位）
    expect(members.get('profile-agent')).toEqual([
      'skill:adaptive-guidance-copy',
      'skill:learner-model',
      'skill:lesson-knowledge-enricher',
      'skill:learning-predictor',
    ]);
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

  // #235：noPromptFile 现在只表示「没有提示词文件」。handler-only 若真有独立提示词产物，
  // 必须同时声明 promptArtifact 并把 noPromptFile 置 false；两个字段不许互相打脸。
  it('#235 promptArtifact 与 noPromptFile 的一致性 fail-fast', () => {
    // handler-only 声称有提示词却不指出文件 → 无法证明，拒绝
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: handler-only
    handlerRef: backend/src/skills/x-test/index.ts
    noPromptFile: false
`)).toThrow(/promptArtifact/);
    // 声明了提示词产物又说自己没有提示词文件 → 自相矛盾（board-designer 修复前的形态）
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: handler-only
    handlerRef: backend/src/skills/x-test/index.ts
    noPromptFile: true
    promptArtifact: prompts/skill.x-test.md
`)).toThrow(/promptArtifact 冲突/);
    // 产物路径必须是该 skill 自己的规范路径
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: handler-only
    handlerRef: backend/src/skills/x-test/index.ts
    promptArtifact: prompts/skill.other.md
`)).toThrow(/promptArtifact 必须为/);
    // mainline 的提示词走 coreFile，不许另挂产物
    expect(() => validateSkillsContent(`
version: 1
skills:
  - skillId: x-test
    kind: mainline
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/skills/x-test/index.ts
    coreFile: prompts/core/x-test.yaml
    promptArtifact: prompts/skill.x-test.md
`)).toThrow(/promptArtifact 只用于 kind=handler-only/);
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

/**
 * #235：声明与文件系统必须一致。
 *
 * `noPromptFile: true` 的字面含义是「没有提示词文件」。board-designer 修复前
 * 一边写 true、一边让运行期 `loadPromptFile('skill:board-designer')` 读
 * prompts/skill.board-designer.md（130 行板面 spec 契约）——这是同一件事的两份
 * 互相否定的声明。判据按「提示词产物是否唯一载体」：
 *   - 有 prompts/skill.<id>.md 且**无** prompts/core/<id>.yaml → 这份 .md 就是提示词本身，
 *     不许声明 noPromptFile: true；
 *   - 有 core yaml 的 handler-only（material-collector / material-brief）其提示词由 core 承载，
 *     产物是编译结果，可以继续以 noPromptFile 表示「户口簿没有 coreFile」。
 */
describe('#235 noPromptFile 与文件系统一致', () => {
  const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const PROMPTS_DIR = path.join(REPO_ROOT, 'prompts');
  const book = parseSkillsFile(SKILLS_FILE_PATH);

  const artifactSkillIds = new Set(
    fs.readdirSync(PROMPTS_DIR)
      .filter((file) => /^skill\..+\.md$/.test(file))
      .map((file) => file.replace(/^skill\./, '').replace(/\.md$/, ''))
  );
  const coreSkillIds = new Set(
    fs.readdirSync(path.join(PROMPTS_DIR, 'core'))
      .filter((file) => /\.ya?ml$/.test(file))
      .map((file) => file.replace(/\.ya?ml$/, ''))
  );

  it('提示词产物是唯一载体时，不得声明 noPromptFile: true', () => {
    const contradictory = book.skills
      .filter((entry) => entry.noPromptFile === true
        && artifactSkillIds.has(entry.skillId)
        && !coreSkillIds.has(entry.skillId))
      .map((entry) => entry.skillId);
    expect(contradictory).toEqual([]);
  });

  it('声明 promptArtifact 的条目：文件存在、noPromptFile=false', () => {
    const declared = book.skills.filter((entry) => entry.promptArtifact);
    expect(declared.length).toBeGreaterThan(0);
    for (const entry of declared) {
      expect({
        skillId: entry.skillId,
        exists: fs.existsSync(path.join(REPO_ROOT, entry.promptArtifact!)),
        noPromptFile: entry.noPromptFile,
      }).toEqual({ skillId: entry.skillId, exists: true, noPromptFile: false });
    }
  });

  it('board-designer：有提示词产物、无 core 源（#235 的具体形态）', () => {
    const entry = book.skills.find((item) => item.skillId === 'board-designer')!;
    expect(entry.noPromptFile).toBe(false);
    expect(entry.promptArtifact).toBe('prompts/skill.board-designer.md');
    expect(fs.existsSync(path.join(PROMPTS_DIR, 'skill.board-designer.md'))).toBe(true);
    expect(fs.existsSync(path.join(PROMPTS_DIR, 'core', 'board-designer.yaml'))).toBe(false);
  });

  it('运行时 manifest 的同一条声明也必须与文件系统一致（不止户口簿）', () => {
    const contradictions = listAgentManifest()
      .map((item) => ({ item, skillId: item.id.replace(/^skill:/, '') }))
      .filter(({ item, skillId }) => item.noPromptFile === true
        && artifactSkillIds.has(skillId)
        && !coreSkillIds.has(skillId))
      .map(({ item }) => item.id);
    expect(contradictions).toEqual([]);
  });
});
