import { analyzeCoreHashParity, extractRowCoreHash } from '../check-core-hash-parity';
import { computeCoreHash, type CoreFile } from '../../services/prompt-lab/core-file-loader';

function makeCore(overrides: Partial<CoreFile> = {}): CoreFile {
  return {
    skillId: 'goal-conversation',
    baseVersion: 1,
    identity: '身份',
    channels: ['dialogue'],
    stateAdvance: false,
    rules: ['r1'],
    fields: [{ name: 'reply', type: 'string', optional: false, desc: 'd', turn: true }],
    constraints: [],
    params: { temperature: 0.7, maxTokens: 1000, failurePolicy: 'retry' },
    deltaOutput: false,
    outputMedia: 'json',
    ...overrides,
  };
}

function makeFile(coreHash?: string) {
  return {
    agentId: 'skill:goal-conversation',
    filePath: 'D:/prompts/skill.goal-conversation.md',
    ...(coreHash === undefined ? {} : { coreHash }),
  };
}

function analyzeWith(core: CoreFile | null, input: {
  files: ReturnType<typeof makeFile>[];
  activeRows?: Array<{ agentId: string; metadata?: string | null; coreHash?: string | null; coreVersion?: number | null }>;
}) {
  return analyzeCoreHashParity({
    files: input.files,
    activeRows: input.activeRows ?? [],
    loadCore: () => ({ core }),
  });
}

describe('check-core-hash-parity：analyzeCoreHashParity', () => {
  it('未声明 coreHash 的 v2 文件记 not-declared，不产生错误', () => {
    const report = analyzeWith(makeCore(), { files: [makeFile()] });
    expect(report.results[0].status).toBe('not-declared');
    expect(report.hasErrors).toBe(false);
    expect(report.summary.declaredFiles).toBe(0);
  });

  it('哈希与核心文件一致且 DB 同步 → in-sync', () => {
    const core = makeCore();
    const hash = computeCoreHash(core);
    const report = analyzeWith(core, {
      files: [makeFile(hash)],
      activeRows: [{ agentId: 'skill:goal-conversation', coreHash: hash }],
    });
    expect(report.results[0].status).toBe('in-sync');
    expect(report.hasErrors).toBe(false);
  });

  it('frontmatter 哈希 ≠ 核心文件实际哈希 → drift（手改绕过核心文件）', () => {
    const report = analyzeWith(makeCore(), {
      files: [makeFile('tampered-hash')],
      activeRows: [{ agentId: 'skill:goal-conversation', coreHash: 'tampered-hash' }],
    });
    expect(report.results[0].status).toBe('drift');
    expect(report.results[0].detail).toContain('回补核心文件');
    expect(report.hasErrors).toBe(true);
  });

  it('核心文件缺失 / 非法分别记 core-file-missing / invalid-core-file', () => {
    const missing = analyzeCoreHashParity({
      files: [makeFile('h')],
      activeRows: [],
      loadCore: () => null,
    });
    expect(missing.results[0].status).toBe('core-file-missing');

    const invalid = analyzeWith(null, { files: [makeFile('h')] });
    expect(invalid.results[0].status).toBe('invalid-core-file');
  });

  it('DB 无 ACTIVE 行记 missing-active；DB 锚点不一致记 db-mismatch', () => {
    const core = makeCore();
    const hash = computeCoreHash(core);

    const missingActive = analyzeWith(core, { files: [makeFile(hash)], activeRows: [] });
    expect(missingActive.results[0].status).toBe('missing-active');

    const mismatch = analyzeWith(core, {
      files: [makeFile(hash)],
      activeRows: [{ agentId: 'skill:goal-conversation', coreHash: 'old-hash' }],
    });
    expect(mismatch.results[0].status).toBe('db-mismatch');
    expect(mismatch.hasErrors).toBe(true);
  });

  it('extractRowCoreHash：列优先，metadata.promptLab 兜底', () => {
    const meta = JSON.stringify({ promptLab: { coreHash: 'from-meta' } });
    expect(extractRowCoreHash({ agentId: 'a', coreHash: 'from-column', metadata: meta })).toBe('from-column');
    expect(extractRowCoreHash({ agentId: 'a', metadata: meta })).toBe('from-meta');
    expect(extractRowCoreHash({ agentId: 'a', metadata: 'not-json' })).toBeUndefined();
    expect(extractRowCoreHash({ agentId: 'a' })).toBeUndefined();
  });
});
