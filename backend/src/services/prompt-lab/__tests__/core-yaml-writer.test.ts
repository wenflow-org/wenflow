import {
  CORE_FILES_DIR,
  parseCoreFile,
  scanCoreFiles,
  type CoreFile,
} from '../core-file-loader';
import { normalizeCoreFormInput, serializeCoreFile, extractHeaderComment } from '../core-yaml-writer';

/** 去掉装载期字段后做深比较 */
function stripLoaded(core: CoreFile): Omit<CoreFile, 'filePath'> {
  const { filePath: _filePath, ...rest } = core;
  void _filePath;
  return rest;
}

describe('core-yaml-writer', () => {
  it('serializeCoreFile 输出可被 parseCoreFile 解析且深相等（round-trip）', () => {
    const core: CoreFile = {
      skillId: 'demo-skill',
      baseVersion: 3,
      identity: '你是测试身份。\n第二行。',
      channels: ['dialogue', 'state'],
      stateAdvance: true,
      inputs: [
        { ref: 'skill:path-planning.milestones', kind: 'skill', skill: 'path-planning', fieldPath: 'milestones', sandboxPath: '', userPath: '', note: '主真相源' },
        { ref: 'skill:path-planning.milestones.stageNumber', kind: 'skill', skill: 'path-planning', fieldPath: 'milestones.stageNumber', sandboxPath: '', userPath: '' },
        { ref: 'sandbox:path.normalizedInput', kind: 'sandbox', skill: '', fieldPath: '', sandboxPath: 'path.normalizedInput', userPath: '', name: 'normalizedInput', type: 'object' },
        { ref: 'user:latestMessage', kind: 'user', skill: '', fieldPath: '', sandboxPath: '', userPath: 'latestMessage', name: 'userInput', type: 'string' },
      ],
      rules: ['规则一', '规则二：包含：冒号 与 "引号"'],
      fields: [
        { name: 'reply', type: 'string', optional: false, desc: '回复正文', turn: true },
        { name: 'payload', type: 'object?', optional: true, desc: '可选负载\n多行描述', turn: false },
      ],
      constraints: ['约束一'],
      examples: ['示例一'],
      params: { temperature: 0.7, maxTokens: 8000, failurePolicy: 'fallback' },
      deltaOutput: true,
      outputMedia: 'markdown',
      filePath: 'virtual',
    };

    const text = serializeCoreFile(core);
    expect(text.startsWith('# v4 核心文件：demo-skill')).toBe(true);
    const parsed = parseCoreFile('virtual', text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.core).not.toBeNull();
    expect(stripLoaded(parsed.core!)).toEqual(stripLoaded(core));
  });

  it('loader 解析 inputs 声明（三前缀）；非法 ref 报 schema-error', () => {
    const valid = parseCoreFile('virtual', [
      'skillId: demo',
      'baseVersion: 1',
      'identity: x',
      'channels: [dialogue]',
      'stateAdvance: false',
      'inputs:',
      '  - ref: skill:path-planning.milestones.stageNumber',
      '    note: 真实问题',
      '  - ref: sandbox:path.normalizedInput',
      '    name: normalizedInput',
      '    type: object',
      '  - ref: user:latestMessage',
      'rules: [r]',
      'fields: [{ name: f, type: string, desc: d }]',
      'constraints: []',
      'params: { temperature: 0.5, maxTokens: 100, failurePolicy: retry }',
    ].join('\n'));
    expect(valid.diagnostics).toEqual([]);
    expect(valid.core?.inputs).toEqual([
      {
        ref: 'skill:path-planning.milestones.stageNumber',
        kind: 'skill',
        skill: 'path-planning',
        fieldPath: 'milestones.stageNumber',
        sandboxPath: '',
        userPath: '',
        note: '真实问题',
      },
      {
        ref: 'sandbox:path.normalizedInput',
        kind: 'sandbox',
        skill: '',
        fieldPath: '',
        sandboxPath: 'path.normalizedInput',
        userPath: '',
        name: 'normalizedInput',
        type: 'object',
      },
      {
        ref: 'user:latestMessage',
        kind: 'user',
        skill: '',
        fieldPath: '',
        sandboxPath: '',
        userPath: 'latestMessage',
      },
    ]);

    const invalid = parseCoreFile('virtual', [
      'skillId: demo',
      'baseVersion: 1',
      'identity: x',
      'channels: [dialogue]',
      'stateAdvance: false',
      'inputs: [{ ref: "not-a-ref" }]',
      'rules: [r]',
      'fields: [{ name: f, type: string, desc: d }]',
      'constraints: []',
      'params: { temperature: 0.5, maxTokens: 100, failurePolicy: retry }',
    ].join('\n'));
    expect(invalid.core).toBeNull();
    expect(invalid.diagnostics[0]?.message).toContain('inputs[0].ref');
  });

  it('normalizeCoreFormInput 矫正松散表单输入', () => {
    const result = normalizeCoreFormInput(
      {
        identity: '  身份  ',
        channels: ['dialogue', 'bogus', 'state'],
        rules: ['  规则  ', '', 42],
        fields: [
          { name: ' a ', type: 'object?', desc: ' d ', turn: true },
          { name: 'b', type: 'string', desc: 'x' },
        ],
        params: { temperature: '0.9', maxTokens: '12000.5', failurePolicy: 'unknown' },
        outputMedia: 'text',
      },
      'form-skill'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.core.skillId).toBe('form-skill');
    expect(result.core.identity).toBe('身份');
    expect(result.core.channels).toEqual(['dialogue', 'state']);
    expect(result.core.rules).toEqual(['规则']);
    expect(result.core.fields).toEqual([
      { name: 'a', type: 'object?', optional: true, desc: 'd', turn: true },
      { name: 'b', type: 'string', optional: false, desc: 'x', turn: false },
    ]);
    expect(result.core.params).toEqual({ temperature: 0.9, maxTokens: 8000, failurePolicy: 'retry' });
    expect(result.core.outputMedia).toBe('text');

    // 矫正后再序列化，必须过 schema
    const parsed = parseCoreFile('virtual', serializeCoreFile(result.core));
    expect(parsed.core).not.toBeNull();
  });

  it('编译器把 inputs 渲染进「使用通道」块', async () => {
    const { compileCoreFile } = await import('../core-compiler');
    const core: CoreFile = {
      skillId: 'demo',
      baseVersion: 1,
      identity: 'x',
      channels: ['dialogue'],
      stateAdvance: false,
      inputs: [
        { ref: 'skill:path-planning.milestones', kind: 'skill', skill: 'path-planning', fieldPath: 'normalizedInput', sandboxPath: '', userPath: '', note: '主真相源' },
        { ref: 'sandbox:path.previousMilestone', kind: 'sandbox', skill: '', fieldPath: '', sandboxPath: 'path.previousMilestone', userPath: '', name: 'previousMilestone', type: 'object' },
      ],
      rules: ['r'],
      fields: [{ name: 'f', type: 'string', optional: false, desc: 'd', turn: false }],
      constraints: [],
      params: { temperature: 0.5, maxTokens: 100, failurePolicy: 'retry' },
      deltaOutput: false,
      outputMedia: 'json',
    };
    const { body } = compileCoreFile(core);
    expect(body).toContain('输入契约声明');
    expect(body).toContain('skill:path-planning.milestones');
    expect(body).toContain('（编排注入）');
    expect(body).toContain('previousMilestone（object）');
    // 无 inputs 时不渲染该小节
    const { body: bodyNoInputs } = compileCoreFile({ ...core, inputs: undefined });
    expect(bodyNoInputs).not.toContain('输入契约声明');
  });

  it('extractHeaderComment 提取头部注释块并在序列化时保留', () => {
    const raw = [
      '# v4 核心文件：demo（基准 v1 反向提取）',
      '# 第二行注释',
      '',
      'skillId: demo',
      'identity: x',
    ].join('\n');
    const header = extractHeaderComment(raw);
    expect(header).toBe('# v4 核心文件：demo（基准 v1 反向提取）\n# 第二行注释');

    const core: CoreFile = {
      skillId: 'demo',
      baseVersion: 1,
      identity: 'x',
      channels: ['dialogue'],
      stateAdvance: false,
      rules: ['r'],
      fields: [{ name: 'f', type: 'string', optional: false, desc: 'd', turn: false }],
      constraints: [],
      params: { temperature: 0.5, maxTokens: 100, failurePolicy: 'retry' },
      deltaOutput: false,
      outputMedia: 'json',
    };
    const out = serializeCoreFile(core, header);
    expect(out.startsWith('# v4 核心文件：demo（基准 v1 反向提取）\n# 第二行注释\n')).toBe(true);
    expect(extractHeaderComment('skillId: demo\nidentity: x')).toBeUndefined();
  });

  it('仓库内全部核心文件 round-trip 不丢信息', () => {
    const { files, diagnostics } = scanCoreFiles(CORE_FILES_DIR);
    expect(diagnostics).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
    for (const core of files) {
      const parsed = parseCoreFile('virtual', serializeCoreFile(core));
      expect(parsed.diagnostics).toEqual([]);
      expect(stripLoaded(parsed.core!)).toEqual(stripLoaded(core));
    }
  });
});

