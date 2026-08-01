import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeCoreHash,
  loadCoreFile,
  normalizeCoreFile,
  parseCoreFile,
  scanCoreFiles,
  validateCoreFileShape,
} from '../core-file-loader';

const VALID_CORE_YAML = `
skillId: goal-conversation
baseVersion: 1
identity: |
  学习目标澄清助手。通过对话澄清学习目标。
channels: [dialogue, state]
stateAdvance: true
rules:
  - 依据 state 找缺口，每轮只补最必要的一条信息
  - userInput 与 state 冲突时以 userInput 为准
fields:
  - { name: reply, type: string, desc: 本轮回复，一次只问一个问题, turn: true }
  - { name: surface_goal, type: string, desc: 用户声称的目标，保留原话 }
  - { name: confirmedProposal, type: object?, desc: 确认后的方向 }
constraints:
  - 无证据留空，不编造
params: { temperature: 0.7, maxTokens: 8000, failurePolicy: retry }
deltaOutput: true
`;

function loadValidCore() {
  const parsed = parseCoreFile('/tmp/core/goal-conversation.yaml', VALID_CORE_YAML);
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.core).not.toBeNull();
  return parsed.core!;
}

describe('core-file-loader：parseCoreFile / validateCoreFileShape', () => {
  it('合法核心文件解析为规整 CoreFile', () => {
    const core = loadValidCore();
    expect(core.skillId).toBe('goal-conversation');
    expect(core.baseVersion).toBe(1);
    expect(core.channels).toEqual(['dialogue', 'state']);
    expect(core.stateAdvance).toBe(true);
    expect(core.rules).toHaveLength(2);
    expect(core.fields).toHaveLength(3);
    expect(core.fields[0]).toMatchObject({ name: 'reply', type: 'string', optional: false, turn: true });
    expect(core.fields[2]).toMatchObject({ name: 'confirmedProposal', type: 'object?', optional: true, turn: false });
    expect(core.params).toEqual({ temperature: 0.7, maxTokens: 8000, failurePolicy: 'retry' });
    expect(core.deltaOutput).toBe(true);
  });

  it('缺省可选项使用默认值', () => {
    const raw = normalizeCoreFile({
      skillId: 'x',
      baseVersion: 1,
      identity: 'id',
      channels: ['dialogue'],
      rules: ['r'],
      fields: [{ name: 'f', type: 'string', desc: 'd' }],
      constraints: [],
      params: { temperature: 0.5, maxTokens: 100, failurePolicy: 'fallback' },
    } as never);
    expect(raw.stateAdvance).toBe(false);
    expect(raw.deltaOutput).toBe(false);
    expect(raw.examples).toBeUndefined();
  });

  it.each([
    ['缺 skillId', { skillId: '' }, 'skillId-required'],
    ['baseVersion 非整数', { baseVersion: 0 }, 'baseVersion-invalid'],
    ['缺 identity', { identity: ' ' }, 'identity-required'],
    ['channels 为空', { channels: [] }, 'channels-required'],
    ['未知材料池', { channels: ['memory'] }, 'channel-unknown'],
    ['rules 为空', { rules: [] }, 'rules-required'],
    ['fields 为空', { fields: [] }, 'fields-required'],
    ['字段重名', { fields: [{ name: 'a', type: 'string', desc: 'x' }, { name: 'a', type: 'string', desc: 'y' }] }, 'field-name-duplicate'],
    ['平台字段禁出', { fields: [{ name: 'stage', type: 'string', desc: 'x' }] }, 'field-name-platform'],
    ['字段名非法', { fields: [{ name: 'Reply', type: 'string', desc: 'x' }] }, 'field-name-invalid'],
    ['类型不在词表', { fields: [{ name: 'a', type: 'map', desc: 'x' }] }, 'field-type-unknown'],
    ['缺 desc', { fields: [{ name: 'a', type: 'string' }] }, 'field-desc-required'],
    ['缺 constraints', { constraints: undefined }, 'constraints-required'],
    ['failurePolicy 非法', { params: { temperature: 0.7, maxTokens: 100, failurePolicy: 'ignore' } }, 'params-failurePolicy-unknown'],
    ['未知顶层键', { unknownKey: 1 }, 'unknown-key'],
  ])('schema 校验拦截：%s', (_label, patch, expectedCode) => {
    const base = {
      skillId: 'x',
      baseVersion: 1,
      identity: 'id',
      channels: ['dialogue'],
      rules: ['r'],
      fields: [{ name: 'f', type: 'string', desc: 'd' }],
      constraints: [],
      params: { temperature: 0.5, maxTokens: 100, failurePolicy: 'retry' },
    };
    const raw = { ...base, ...(patch as Record<string, unknown>) };
    const issues = validateCoreFileShape(raw);
    expect(issues.some((issue) => issue.code === expectedCode)).toBe(true);
  });

  it('YAML 解析失败返回 yaml-parse-error 诊断', () => {
    const parsed = parseCoreFile('/tmp/bad.yaml', 'skillId: [unclosed');
    expect(parsed.core).toBeNull();
    expect(parsed.diagnostics[0].code).toBe('yaml-parse-error');
  });

  it('schema 错误返回 schema-error 诊断且不阻断', () => {
    const parsed = parseCoreFile('/tmp/bad.yaml', 'skillId: x');
    expect(parsed.core).toBeNull();
    expect(parsed.diagnostics[0].code).toBe('schema-error');
    expect(parsed.diagnostics[0].issues!.length).toBeGreaterThan(1);
  });
});

describe('core-file-loader：computeCoreHash', () => {
  it('键序无关：同一内容不同键序哈希相同', () => {
    const coreA = loadValidCore();
    const reordered = normalizeCoreFile({
      params: { failurePolicy: 'retry', maxTokens: 8000, temperature: 0.7 },
      constraints: ['无证据留空，不编造'],
      fields: [
        { name: 'reply', type: 'string', desc: '本轮回复，一次只问一个问题', turn: true },
        { name: 'surface_goal', type: 'string', desc: '用户声称的目标，保留原话' },
        { name: 'confirmedProposal', type: 'object?', desc: '确认后的方向' },
      ],
      rules: ['依据 state 找缺口，每轮只补最必要的一条信息', 'userInput 与 state 冲突时以 userInput 为准'],
      channels: ['dialogue', 'state'],
      stateAdvance: true,
      identity: '学习目标澄清助手。通过对话澄清学习目标。',
      baseVersion: 1,
      skillId: 'goal-conversation',
      deltaOutput: true,
    } as never);
    expect(computeCoreHash(coreA)).toBe(computeCoreHash(reordered));
  });

  it('内容变化哈希变化；filePath 不参与哈希', () => {
    const core = loadValidCore();
    const changed = { ...core, identity: '另一个身份' };
    expect(computeCoreHash(changed)).not.toBe(computeCoreHash(core));
    const otherPath = { ...core, filePath: '/elsewhere/other.yaml' };
    expect(computeCoreHash(otherPath)).toBe(computeCoreHash(core));
  });
});

describe('core-file-loader：scanCoreFiles / loadCoreFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-files-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('扫描目录：合法文件入库，非法文件进 diagnostics 且不阻断', () => {
    fs.writeFileSync(path.join(tmpDir, 'good.yaml'), VALID_CORE_YAML, 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'bad.yaml'), 'skillId: x', 'utf-8');
    const scan = scanCoreFiles(tmpDir);
    expect(scan.files.map((f) => f.skillId)).toEqual(['goal-conversation']);
    expect(scan.diagnostics).toHaveLength(1);
    expect(scan.diagnostics[0].code).toBe('schema-error');
  });

  it('loadCoreFile：文件不存在返回 null；存在但非法返回 core=null', () => {
    expect(loadCoreFile('missing', tmpDir)).toBeNull();
    fs.writeFileSync(path.join(tmpDir, 'bad.yaml'), 'skillId: x', 'utf-8');
    const loaded = loadCoreFile('bad', tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.core).toBeNull();
    expect(loaded!.diagnostics[0].code).toBe('schema-error');
  });

  it('目录不存在时返回空扫描结果', () => {
    const scan = scanCoreFiles(path.join(tmpDir, 'not-exist'));
    expect(scan.files).toEqual([]);
    expect(scan.diagnostics).toEqual([]);
  });
});
