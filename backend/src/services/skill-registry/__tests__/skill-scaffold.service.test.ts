/**
 * skill scaffold 服务单测（SCAFFOLD_P5_SURVEY §5 / SKILL_READINESS_SPEC §5）
 *
 * 全部在临时目录中执行（deps 注入 temp 路径 + 内存 bookLoader + 假 completionLoader），
 * 零真实仓库写盘。覆盖：
 *   - mainline 全量创建：core 骨架过 parseCoreFile、skills.yaml 追加过 validateSkillsContent、
 *     编排 contracts 追加过 parseOrchestrationFile、handler 占位可编译语义
 *   - 幂等：全量重放 → already-exists；部分存在（缺 core）→ completed 补齐
 *   - aux / handler-only 差异（无编排契约、handler-only 无 core/noPromptFile=true）
 *   - 冲突与输入校验（manifest 占用 / alias 占用 / mainline 必填）
 *   - 备份（写盘前备份受影响文件到 prompts/backups/scaffold/<ts>/）
 *   - 骨架形状（channels [task] / TODO 占位 / params fallback）
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  scaffoldSkill,
  buildCoreSkeleton,
  buildPlaceholderHandlerSource,
  buildSkillEntryYaml,
  appendContractEntry,
  ScaffoldInputError,
  ScaffoldConflictError,
  type ScaffoldRequest,
  type ScaffoldResult,
} from '../skill-scaffold.service';
import { validateSkillsContent } from '../skills-file';
import { parseCoreFile } from '../../prompt-lab/core-file-loader';
import { parseOrchestrationFile } from '../../field-routing/orchestration-file';
import type { SkillCompletionReport } from '../skill-completion.service';

const completionFixture: SkillCompletionReport = {
  status: 'handler-ready',
  gates: {
    draft: { ok: true, detail: '户口簿有登记' },
    handlerReady: { ok: true, detail: 'handler 文件存在（F5）' },
    coreReady: { ok: false, detail: 'core.yaml 存在 scaffold TODO 占位' },
    fieldsSynced: { ok: true, detail: 'mainline contracts 已追加' },
    live: { ok: false, detail: '无 ACTIVE prompt' },
  },
  items: [
    { id: 'manifest', label: 'manifest 条目', ok: false },
    { id: 'handler', label: 'handler 存在', ok: true },
    { id: 'registered', label: '注册存在', ok: false },
    { id: 'core', label: 'core.yaml 合法', ok: false },
    { id: 'fieldsSynced', label: '字段路由回填', ok: true },
    { id: 'promptActive', label: 'ACTIVE prompt', ok: false },
    { id: 'checksGreen', label: 'skills:check 全绿', ok: null },
    { id: 'wired', label: '接线引用', ok: false },
    { id: 'recentCalls', label: '最近调用', ok: null },
  ],
  warnings: ['W3-wired 未接线（辅助展示，不进状态判定）'],
};

interface Harness {
  root: string;
  deps: Parameters<typeof scaffoldSkill>[1];
  skillsPath: string;
  coreDir: string;
  orchestrationDir: string;
  skillsDir: string;
  backupsRoot: string;
  completionMock: jest.Mock;
}

const INITIAL_SKILLS_YAML = `# test skills.yaml
version: 1
skills:
  - skillId: goal-conversation
    kind: mainline
    stage: goal
    parentAgent: goal-agent
    handlerRef: backend/src/skills/goal-conversation/index.ts
    coreFile: prompts/core/goal-conversation.yaml
    displayName: 目标对话 Skill
    description: 与学习者多轮对话
`;

const INITIAL_GOAL_YAML = `# Goal 阶段编排文件（test）
stage: goal
displayName: Goal 阶段
description: test

contracts:
  - agentId: skill:goal-conversation
  - agentId: goal-agent

fields: []
routings: []
`;

function makeHarness(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-scaffold-'));
  const skillsPath = path.join(root, 'prompts', 'skills.yaml');
  const coreDir = path.join(root, 'prompts', 'core');
  const orchestrationDir = path.join(root, 'prompts', 'orchestration');
  const skillsDir = path.join(root, 'backend', 'src', 'skills');
  const backupsRoot = path.join(root, 'prompts', 'backups', 'scaffold');
  fs.mkdirSync(coreDir, { recursive: true });
  fs.mkdirSync(orchestrationDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(skillsPath, INITIAL_SKILLS_YAML, 'utf-8');
  fs.writeFileSync(path.join(orchestrationDir, 'goal.yaml'), INITIAL_GOAL_YAML, 'utf-8');
  const completionMock = jest.fn(async () => completionFixture);
  const deps = {
    skillsFilePath: skillsPath,
    coreDir,
    orchestrationDir,
    skillsDir,
    backupsRoot,
    bookLoader: () => validateSkillsContent(fs.readFileSync(skillsPath, 'utf-8')),
    completionLoader: completionMock,
    now: () => new Date('2026-08-10T12:00:00.000Z'),
  };
  return { root, deps, skillsPath, coreDir, orchestrationDir, skillsDir, backupsRoot, completionMock };
}

function afterEachCleanup(h: Harness) {
  try {
    fs.rmSync(h.root, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

const mainlineReq: ScaffoldRequest = {
  skillId: 'test-scaffold-demo',
  kind: 'mainline',
  stage: 'goal',
  parentAgent: 'goal-agent',
  displayName: '测试 Scaffold Skill',
  description: '端到端验收用测试 Skill',
};

describe('skill-scaffold：mainline 全量创建', () => {
  it('四个生成物全部落盘且各自过校验器，响应 status=created', async () => {
    const h = makeHarness();
    try {
      const outcome = await scaffoldSkill(mainlineReq, h.deps);
      expect(outcome.status).toBe('created');
      const result = outcome as ScaffoldResult;
      expect(result.kind).toBe('mainline');
      expect(result.generated).toEqual([
        'prompts/core/test-scaffold-demo.yaml',
        'backend/src/skills/test-scaffold-demo/index.ts',
        'prompts/orchestration/goal.yaml',
        'prompts/skills.yaml',
      ]);
      expect(result.completion).toBe(completionFixture);
      expect(h.completionMock).toHaveBeenCalledWith('test-scaffold-demo');
      expect(result.note).toContain('SC_NOT_IMPLEMENTED');

      // a. core.yaml 过 validateCoreFileShape（parseCoreFile）
      const coreChecked = parseCoreFile(
        path.join(h.coreDir, 'test-scaffold-demo.yaml'),
        fs.readFileSync(path.join(h.coreDir, 'test-scaffold-demo.yaml'), 'utf-8'),
      );
      expect(coreChecked.core).not.toBeNull();
      expect(coreChecked.diagnostics).toEqual([]);

      // b. skills.yaml 追加后过 validateSkillsContent（F1-F12 内存校验）
      const book = validateSkillsContent(fs.readFileSync(h.skillsPath, 'utf-8'));
      const entry = book.skills.find((item) => item.skillId === 'test-scaffold-demo');
      expect(entry).toBeDefined();
      expect(entry!.kind).toBe('mainline');
      expect(entry!.stage).toBe('goal');
      expect(entry!.parentAgent).toBe('goal-agent');
      expect(entry!.handlerRef).toBe('backend/src/skills/test-scaffold-demo/index.ts');
      expect(entry!.coreFile).toBe('prompts/core/test-scaffold-demo.yaml');
      expect(entry!.noPromptFile).toBe(false);
      expect(entry!.aliases).toBeUndefined();

      // c. 编排文件 contracts 追加后过 parseOrchestrationFile（loader 校验）
      const stage = parseOrchestrationFile(path.join(h.orchestrationDir, 'goal.yaml'));
      expect(stage.contracts.some((contract) => contract.agentId === 'skill:test-scaffold-demo')).toBe(true);
      expect(stage.contracts.some((contract) => contract.agentId === 'skill:goal-conversation')).toBe(true);

      // d. handler 占位落盘 + SC_NOT_IMPLEMENTED 语义
      const handlerSource = fs.readFileSync(path.join(h.skillsDir, 'test-scaffold-demo', 'index.ts'), 'utf-8');
      expect(handlerSource).toContain('SC_NOT_IMPLEMENTED: test-scaffold-demo');
      expect(handlerSource).toContain('testScaffoldDemoHandler');

      // 注册片段返回文本（不落盘）
      expect(result.snippets.length).toBeGreaterThan(0);
      expect(result.snippets[0].title).toContain('skills/index.ts');

      // P2：manifest 条目模板片段（F12 必须登记，mainline/handler-only）
      const manifestSnippet = result.snippets.find((s) => s.title.includes('agent-manifest.service.ts'));
      expect(manifestSnippet).toBeDefined();
      expect(manifestSnippet!.content).toContain(`id: 'skill:test-scaffold-demo'`);
      expect(manifestSnippet!.content).toContain(`category: 'goal'`);
      expect(manifestSnippet!.content).toContain(`monitoringGroup: 'Goal'`);
      expect(manifestSnippet!.content).toContain(`defaultModelConfig: { temperature: 0.5, maxTokens: 4000 }`);
      expect(manifestSnippet!.content).toContain(`name: '${mainlineReq.displayName} Skill'`);
      expect(manifestSnippet!.content).toContain(`description: '${mainlineReq.description}'`);
      expect(result.note).toContain('F12');
    } finally {
      afterEachCleanup(h);
    }
  });

  it('core 骨架形状：channels [task] / TODO 占位 / params fallback，约束符合任务清单', async () => {
    const core = buildCoreSkeleton('test-scaffold-demo');
    expect(core.channels).toEqual(['task']);
    expect(core.baseVersion).toBe(1);
    expect(core.identity).toContain('TODO');
    expect(core.rules.length).toBeGreaterThanOrEqual(1);
    expect(core.rules[0]).toContain('TODO');
    expect(core.fields).toEqual([
      { name: 'reply', type: 'string', optional: false, desc: expect.stringContaining('TODO'), turn: false },
    ]);
    expect(core.constraints).toEqual([]);
    expect(core.params).toEqual({ temperature: 0.5, maxTokens: 4000, failurePolicy: 'fallback' });
  });

  it('备份：写盘前备份受影响文件到 prompts/backups/scaffold/<ts>/（新文件不备份）', async () => {
    const h = makeHarness();
    try {
      await scaffoldSkill(mainlineReq, h.deps);
      const backupDir = path.join(h.backupsRoot, '2026-08-10T12-00-00-000Z');
      expect(fs.existsSync(path.join(backupDir, 'skills.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(backupDir, 'orchestration-goal.yaml'))).toBe(true);
      // core.yaml 与 handler 为新建文件，无需备份
      expect(fs.existsSync(path.join(backupDir, 'core-test-scaffold-demo.yaml'))).toBe(false);
      expect(fs.existsSync(path.join(backupDir, 'handler-test-scaffold-demo.ts'))).toBe(false);
    } finally {
      afterEachCleanup(h);
    }
  });

  it('handler 占位源码为可编译最小 TS（导出函数 + 抛 SC_NOT_IMPLEMENTED，无外部依赖）', () => {
    const source = buildPlaceholderHandlerSource('my-new-skill');
    expect(source).toMatch(/export async function myNewSkillHandler/);
    expect(source).toContain("throw new Error('SC_NOT_IMPLEMENTED: my-new-skill");
    expect(source).not.toContain('import ');
  });

  it('appendContractEntry：块内追加 + 重复追加安全 + 缺 contracts 段返回 null', () => {
    const appended = appendContractEntry(INITIAL_GOAL_YAML, 'test-scaffold-demo');
    expect(appended).toContain('  - agentId: skill:test-scaffold-demo');
    expect(appendContractEntry(appended!, 'test-scaffold-demo')).toBe(appended);
    expect(appendContractEntry('# no contracts\nstage: goal\n', 'x')).toBeNull();
  });

  it('buildSkillEntryYaml：2 空格条目缩进 + handler-only 带 noPromptFile: true', () => {
    const entry = buildSkillEntryYaml(
      mainlineReq,
      'backend/src/skills/test-scaffold-demo/index.ts',
      'prompts/core/test-scaffold-demo.yaml',
    );
    expect(entry.startsWith('\n  - skillId: test-scaffold-demo')).toBe(true);
    const handlerOnly = buildSkillEntryYaml(
      { skillId: 'mcp-helper', kind: 'handler-only' },
      'backend/src/skills/mcp-helper/index.ts',
      undefined,
    );
    expect(handlerOnly).toContain('noPromptFile: true');
    expect(handlerOnly).not.toContain('coreFile:');
  });
});

describe('skill-scaffold：幂等（以 skills.yaml 为唯一状态事实）', () => {
  it('全量重放 → already-exists（零写入）', async () => {
    const h = makeHarness();
    try {
      await scaffoldSkill(mainlineReq, h.deps);
      h.completionMock.mockClear();
      const second = await scaffoldSkill(mainlineReq, h.deps);
      expect(second.status).toBe('already-exists');
      expect(h.completionMock).toHaveBeenCalledTimes(1);
      // 不产生重复条目
      const book = validateSkillsContent(fs.readFileSync(h.skillsPath, 'utf-8'));
      expect(book.skills.filter((item) => item.skillId === 'test-scaffold-demo').length).toBe(1);
      // 编排 contracts 不重复
      const stage = parseOrchestrationFile(path.join(h.orchestrationDir, 'goal.yaml'));
      expect(stage.contracts.filter((contract) => contract.agentId === 'skill:test-scaffold-demo').length).toBe(1);
    } finally {
      afterEachCleanup(h);
    }
  });

  it('部分存在（缺 core.yaml）→ completed 补齐缺失生成物', async () => {
    const h = makeHarness();
    try {
      await scaffoldSkill(mainlineReq, h.deps);
      fs.rmSync(path.join(h.coreDir, 'test-scaffold-demo.yaml'));
      const outcome = await scaffoldSkill(mainlineReq, h.deps);
      expect(outcome.status).toBe('completed');
      const result = outcome as ScaffoldResult;
      expect(result.generated).toEqual(['prompts/core/test-scaffold-demo.yaml']);
      expect(fs.existsSync(path.join(h.coreDir, 'test-scaffold-demo.yaml'))).toBe(true);
      // 其余生成物未被重写（幂等重放语义）
      const book = validateSkillsContent(fs.readFileSync(h.skillsPath, 'utf-8'));
      expect(book.skills.filter((item) => item.skillId === 'test-scaffold-demo').length).toBe(1);
    } finally {
      afterEachCleanup(h);
    }
  });
});

describe('skill-scaffold：kind 差异（aux / handler-only）', () => {
  it('aux：core.yaml + 条目 + handler 占位（F5），无编排契约，注册片段指向 v4-aux-skills', async () => {
    const h = makeHarness();
    try {
      const outcome = await scaffoldSkill(
        { skillId: 'test-aux-demo', kind: 'aux', displayName: '测试 Aux' },
        h.deps,
      );
      expect(outcome.status).toBe('created');
      const result = outcome as ScaffoldResult;
      expect(result.generated).toEqual([
        'prompts/core/test-aux-demo.yaml',
        'backend/src/skills/test-aux-demo/index.ts',
        'prompts/skills.yaml',
      ]);
      // handlerRef 指向预留占位路径（F5 满足；实际注册在 v4-aux-skills）
      const book = validateSkillsContent(fs.readFileSync(h.skillsPath, 'utf-8'));
      const entry = book.skills.find((item) => item.skillId === 'test-aux-demo')!;
      expect(entry.kind).toBe('aux');
      expect(entry.handlerRef).toBe('backend/src/skills/test-aux-demo/index.ts');
      expect(entry.noPromptFile).toBe(false);
      expect(fs.existsSync(path.join(h.skillsDir, 'test-aux-demo', 'index.ts'))).toBe(true);
      expect(result.snippets[0].title).toContain('v4-aux-skills');
      // aux 不要求 manifest 登记（F12 仅 mainline/handler-only）→ 无 manifest 片段
      expect(result.snippets.some((s) => s.title.includes('agent-manifest.service.ts'))).toBe(false);
      // 不触碰编排文件
      const stage = parseOrchestrationFile(path.join(h.orchestrationDir, 'goal.yaml'));
      expect(stage.contracts.some((contract) => contract.agentId === 'skill:test-aux-demo')).toBe(false);
    } finally {
      afterEachCleanup(h);
    }
  });

  it('handler-only：无 core.yaml，条目 noPromptFile=true，handler 占位落盘', async () => {
    const h = makeHarness();
    try {
      const outcome = await scaffoldSkill({ skillId: 'test-handler-only-demo', kind: 'handler-only' }, h.deps);
      expect(outcome.status).toBe('created');
      expect(fs.existsSync(path.join(h.coreDir, 'test-handler-only-demo.yaml'))).toBe(false);
      const book = validateSkillsContent(fs.readFileSync(h.skillsPath, 'utf-8'));
      const entry = book.skills.find((item) => item.skillId === 'test-handler-only-demo')!;
      expect(entry.kind).toBe('handler-only');
      expect(entry.noPromptFile).toBe(true);
      expect(entry.coreFile).toBeUndefined();
      expect(fs.existsSync(path.join(h.skillsDir, 'test-handler-only-demo', 'index.ts'))).toBe(true);
      const result = outcome as ScaffoldResult;
      expect(result.snippets[0].title).toContain('skills/index.ts');
      // handler-only 同样必须登记 manifest（F12）→ 有 manifest 模板片段（无 stage → 无 monitoringGroup 行）
      const manifestSnippet = result.snippets.find((s) => s.title.includes('agent-manifest.service.ts'));
      expect(manifestSnippet).toBeDefined();
      expect(manifestSnippet!.content).toContain(`id: 'skill:test-handler-only-demo'`);
      expect(manifestSnippet!.content).toContain(`category: 'skill'`);
      expect(manifestSnippet!.content).not.toContain('monitoringGroup:');
    } finally {
      afterEachCleanup(h);
    }
  });
});

describe('skill-scaffold：冲突与输入校验', () => {
  it('skillId 已被 manifest 占用（如存量 mainline）→ ScaffoldConflictError（409 语义）', async () => {
    const h = makeHarness();
    try {
      await expect(scaffoldSkill({ ...mainlineReq, skillId: 'teaching-turn' }, h.deps))
        .rejects.toThrow(ScaffoldConflictError);
      await expect(scaffoldSkill({ ...mainlineReq, skillId: 'teaching-turn' }, h.deps))
        .rejects.toThrow('已被 manifest 占用');
    } finally {
      afterEachCleanup(h);
    }
  });

  it('alias 已被 manifest alias 占用 → ScaffoldConflictError', async () => {
    const h = makeHarness();
    try {
      await expect(scaffoldSkill({ ...mainlineReq, aliases: ['teaching-turn-agent'] }, h.deps))
        .rejects.toThrow(ScaffoldConflictError);
    } finally {
      afterEachCleanup(h);
    }
  });

  it('mainline 缺 stage / parentAgent / 非法 kind / 非法 skillId → ScaffoldInputError（400 语义）', async () => {
    const h = makeHarness();
    try {
      await expect(scaffoldSkill({ skillId: 'x', kind: 'mainline', parentAgent: 'goal-agent' }, h.deps))
        .rejects.toThrow(ScaffoldInputError);
      await expect(scaffoldSkill({ skillId: 'x', kind: 'mainline', stage: 'goal' }, h.deps))
        .rejects.toThrow(ScaffoldInputError);
      await expect(scaffoldSkill({ skillId: 'X-Bad', kind: 'mainline', stage: 'goal', parentAgent: 'goal-agent' }, h.deps))
        .rejects.toThrow(ScaffoldInputError);
      await expect(scaffoldSkill({ skillId: 'x', kind: 'bogus' as never, stage: 'goal', parentAgent: 'goal-agent' }, h.deps))
        .rejects.toThrow(ScaffoldInputError);
      await expect(scaffoldSkill({ skillId: 'x', kind: 'mainline', stage: 'bogus-stage', parentAgent: 'goal-agent' }, h.deps))
        .rejects.toThrow(ScaffoldInputError);
      await expect(scaffoldSkill({ skillId: 'x', kind: 'mainline', stage: 'goal', parentAgent: 'ghost-agent' }, h.deps))
        .rejects.toThrow('不在 manifest kind=agent');
    } finally {
      afterEachCleanup(h);
    }
  });
});
