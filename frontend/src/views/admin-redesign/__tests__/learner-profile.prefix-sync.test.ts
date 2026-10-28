/**
 * 测试账号前缀前后端同步守卫（2026-10-22 机械过滤审计 C 类）。
 *
 * 后端 utils/test-account.ts 的 TEST_ACCOUNT_PREFIXES 与前端 learner-profile.ts 的副本
 * 是**手工镜像**（注释自述「改一端必改另一端」）——口径漂移的表现是管理端「仅真实」
 * 过滤漏账号/错杀，静默无报错。本测试直接读后端源码提取数组逐项比对，漂移即红。
 * （不做成运行期单源是因为跨包取数需要新端点；源码级比对已能把「静默漂移」变「CI 红」。）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const backendSource = readFileSync(
  join(here, '../../../../../backend/src/utils/test-account.ts'),
  'utf8',
);

/** 从后端源码提取 TEST_ACCOUNT_PREFIXES 数组（容忍行内注释与换行）。 */
function extractBackendPrefixes(source: string): string[] {
  const match = source.match(/export const TEST_ACCOUNT_PREFIXES: string\[\] = \[([\s\S]*?)\];/);
  expect(match, '后端源码里应能找到 TEST_ACCOUNT_PREFIXES 数组').toBeTruthy();
  return [...(match![1].matchAll(/'([^']+)'/g))].map(m => m[1]);
}

import { TEST_ACCOUNT_PREFIXES } from '../learner-profile';

describe('测试账号前缀前后端镜像同步', () => {
  it('前端副本与后端 utils/test-account.ts 逐项一致（集合相等）', () => {
    const backend = extractBackendPrefixes(backendSource);
    const frontend: string[] = [...TEST_ACCOUNT_PREFIXES];
    const onlyBackend = backend.filter(p => !frontend.includes(p));
    const onlyFrontend = frontend.filter(p => !backend.includes(p));
    expect(onlyBackend, `后端新增的前缀未同步到前端 learner-profile.ts：${onlyBackend.join(', ')}`).toEqual([]);
    expect(onlyFrontend, `前端多出（后端已删/改名）的前缀：${onlyFrontend.join(', ')}`).toEqual([]);
  });
});
