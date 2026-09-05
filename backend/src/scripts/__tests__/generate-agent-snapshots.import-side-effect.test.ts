/**
 * generate-agent-snapshots import 副作用（C6 修复：require.main 守卫）：
 * 该模块被 health-center 复检等只读消费方 import，此前顶层无条件执行 main() 会
 * 在 import 时静默重写 prompts/agent-snapshots.md（本地快照门禁被中和）。
 * 本测试锁定：import 后产物文件 mtime 不变（无写盘副作用）。
 */

import * as fs from 'fs';
import * as path from 'path';

const TARGET = path.resolve(__dirname, '../../../../prompts/agent-snapshots.md');

describe('generate-agent-snapshots import 副作用', () => {
  it('import 模块不写盘（require.main 守卫；文件 mtime 不变）', () => {
    const before = fs.statSync(TARGET).mtimeMs;
    jest.resetModules();
    require('../generate-agent-snapshots');
    const after = fs.statSync(TARGET).mtimeMs;
    expect(after).toBe(before);
  });
});
