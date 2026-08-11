/**
 * check-yaml-vocabulary C2 语义（P0-1 参数四写收敛后）：
 * C2 由"temperature/maxTokens 双写比对"改为"core 单写检查"——
 *  manifest runtimeDefaults 已废弃，manifest 无该段即跳过；core params 必填自检。
 * 门禁语义锁定：manifest 目录零 runtimeDefaults 残留（出现即回归）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { runYamlVocabularyCheck } from '../check-yaml-vocabulary';

const MANIFESTS_DIR = path.resolve(__dirname, '../../../../prompt-lab/manifests');

describe('check-yaml-vocabulary C2（参数单写）', () => {
  it('C2 语义：core 单写自检通过，manifest 无 runtimeDefaults 残留（缺省即跳过）', () => {
    const report = runYamlVocabularyCheck();
    expect(report.ok).toBe(true);

    const c2Line = report.summaryLines.find((line) => line.includes('C2'));
    expect(c2Line).toBeTruthy();
    expect(c2Line).toContain('参数单写');
    expect(c2Line).toContain('0 个残留');
  });

  it('C2 门禁口径：manifests/*.yaml 不允许重新出现 runtimeDefaults 段', () => {
    const leftovers: string[] = [];
    for (const name of fs.readdirSync(MANIFESTS_DIR).filter((n) => n.endsWith('.yaml')).sort()) {
      const raw = fs.readFileSync(path.join(MANIFESTS_DIR, name), 'utf-8');
      if (/^runtimeDefaults:/m.test(raw)) leftovers.push(name);
    }
    expect(leftovers).toEqual([]);
  });
});
