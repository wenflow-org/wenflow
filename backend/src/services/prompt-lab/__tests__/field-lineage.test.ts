import { classifyCoreEdit } from '../field-lineage';
import type { CoreFile } from '../core-file-loader';

function makeCore(fields: CoreFile['fields']): CoreFile {
  return {
    skillId: 'example', baseVersion: 1, identity: 'x', channels: ['task'], stateAdvance: false,
    rules: ['r'], fields, constraints: [],
    params: { temperature: 0.1, maxTokens: 1000, failurePolicy: 'retry' },
    deltaOutput: false, outputMedia: 'json',
  };
}

const result = { name: 'result', type: 'string', optional: false, desc: '结果', turn: false };

describe('classifyCoreEdit', () => {
  it('文案级变更安全；新增字段受限', () => {
    expect(classifyCoreEdit(makeCore([result]), makeCore([{ ...result, desc: '新结果' }])).level).toBe('safe');
    expect(classifyCoreEdit(makeCore([result]), makeCore([result, { ...result, name: 'extra' }])).level).toBe('restricted');
  });

  it('删除或改型字段为阻断级', () => {
    expect(classifyCoreEdit(makeCore([result]), makeCore([])).level).toBe('blocked');
    expect(classifyCoreEdit(makeCore([result]), makeCore([{ ...result, type: 'number' }])).level).toBe('blocked');
  });
});
