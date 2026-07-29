import { compileCoreFile } from '../core-compiler';
import { parseCoreFile } from '../core-file-loader';
import { normalizeDeveloperApproval, resolveCoreSnapshot } from '../core-version-snapshot';

const CORE_YAML = `
skillId: example-skill
baseVersion: 1
identity: 测试
channels: [task]
rules: [按输入生成结果]
fields:
  - { name: result, type: string, desc: 结果 }
constraints: []
params: { temperature: 0.1, maxTokens: 1000, failurePolicy: retry }
`;

describe('core-version-snapshot', () => {
  it('解析并验证历史 coreSnapshot', () => {
    const result = resolveCoreSnapshot(
      JSON.stringify({ promptLab: { coreSnapshot: CORE_YAML } }),
      'example-skill',
    );
    expect(result.error).toBeUndefined();
    expect(result.core?.skillId).toBe('example-skill');
  });

  it('拒绝缺失、非法或错 skillId 的历史快照', () => {
    expect(resolveCoreSnapshot('{}', 'example-skill').error).toContain('coreSnapshot');
    expect(resolveCoreSnapshot(JSON.stringify({ promptLab: { coreSnapshot: 'skillId: x' } }), 'example-skill').error).toContain('不合法');
    expect(resolveCoreSnapshot(JSON.stringify({ promptLab: { coreSnapshot: CORE_YAML } }), 'another-skill').error).toContain('不一致');
  });

  it('快照可以确定性重建历史 prompt', () => {
    const core = parseCoreFile('/tmp/example.yaml', CORE_YAML).core!;
    const compiled = compileCoreFile(core, { coreVersion: 3 });
    const restored = resolveCoreSnapshot(JSON.stringify({ promptLab: { coreSnapshot: CORE_YAML } }), 'example-skill');
    expect(compileCoreFile(restored.core!, { coreVersion: 3 }).body).toBe(compiled.body);
  });

  it('开发确认必须有非空引用', () => {
    expect(normalizeDeveloperApproval(null)).toBeNull();
    expect(normalizeDeveloperApproval({ reference: '  ' })).toBeNull();
    expect(normalizeDeveloperApproval({ reference: 'PR #42' })).toEqual({ reference: 'PR #42' });
  });
});
