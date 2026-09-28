import fs from 'fs/promises';
import path from 'path';
import { findDirectGatewayCallViolations } from '../check-llm-call-boundary';

describe('LLM 调用边界', () => {
  // 全源码树扫描是 I/O 重操作：全量并行跑时单次可达 11s+，超过 jest 默认 10s
  // （单跑 650ms）——显式给 60s，防满载抖动假红（2026-09-28 验收实测两次复现）
  it('生产业务代码不绕过 callPrompt 直接调用 APIGateway', async () => {
    await expect(findDirectGatewayCallViolations()).resolves.toEqual([]);
  }, 60_000);

  it('报告未授权的直接 Gateway 调用位置', async () => {
    const fixtureDir = path.join(process.cwd(), '.tmp-llm-call-boundary-test');
    await fs.mkdir(fixtureDir, { recursive: true });
    const fixturePath = path.join(fixtureDir, 'caller.ts');
    try {
      await fs.writeFile(fixturePath, 'const output = await gateway.execute({});\n', 'utf-8');
      await expect(findDirectGatewayCallViolations(fixtureDir)).resolves.toEqual([
        expect.objectContaining({ filePath: 'caller.ts', line: 1 }),
      ]);
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
