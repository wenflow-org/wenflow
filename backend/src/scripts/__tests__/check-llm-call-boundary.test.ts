import fs from 'fs/promises';
import path from 'path';
import { findDirectGatewayCallViolations } from '../check-llm-call-boundary';

describe('LLM 调用边界', () => {
  it('生产业务代码不绕过 callPrompt 直接调用 APIGateway', async () => {
    await expect(findDirectGatewayCallViolations()).resolves.toEqual([]);
  });

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
