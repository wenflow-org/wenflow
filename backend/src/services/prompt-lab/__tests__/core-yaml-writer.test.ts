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

  it('仓库内全部 40 个核心文件 round-trip 不丢信息', () => {
    const { files, diagnostics } = scanCoreFiles(CORE_FILES_DIR);
    expect(diagnostics).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(40);
    for (const core of files) {
      const parsed = parseCoreFile('virtual', serializeCoreFile(core));
      expect(parsed.diagnostics).toEqual([]);
      expect(stripLoaded(parsed.core!)).toEqual(stripLoaded(core));
    }
  });
});
