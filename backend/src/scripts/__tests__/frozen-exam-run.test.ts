import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * 冻结考卷脚本（#85）的包装测试：把 backend/scripts/measurement-verify/frozen-exam-run.mjs
 * 挂进 backend jest 门禁（CI：npm run check:test → npm --prefix backend run test:coverage）。
 *
 * 本测试只 spawn 脚本自身。2026-10-19（#85 收口）起冻结语料已入库
 * doc/measurement/frozen-exam-2026-10-18/（仓内受跟踪），故补一条「默认路径 --verify」用例
 * 直接验仓内冻结集 sha256/基线；篡改用例仍用现造合成夹具，不写真实冻结集。
 * 纯函数口径由脚本 --selftest 自身覆盖（协议§二.1/§二.3/§二.4）。
 * 参考：doc/local/ISSUE-RECON-20261019.md「### #85」（脚本化常设化，零模型额度）。
 */
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(BACKEND_ROOT, 'scripts', 'measurement-verify', 'frozen-exam-run.mjs');

interface ScriptRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface VerifyProblem {
  code: string;
  scope: string;
  detail: string;
}

interface VerifyJson {
  ok: boolean;
  checked: number;
  frozenDir?: string;
  problems: VerifyProblem[];
  baseline?: { judged: number; wrong: number; rate: number };
}

function runScript(args: string[]): ScriptRun {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8', timeout: 60_000 });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function expectExit(res: ScriptRun, expected: number | null, what: string): void {
  if (res.status !== expected) {
    throw new Error(`${what}：期望退出码 ${expected}，实际 ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  }
}

describe('冻结考卷脚本 frozen-exam-run.mjs（#85）', () => {
  it('--selftest 全绿：纯函数与完整性校验自测（合成夹具，零模型额度）', () => {
    const res = runScript(['--selftest']);
    expectExit(res, 0, '--selftest');
    expect(res.stdout).toContain('SELFTEST PASS');
  }, 60_000);

  it('默认冻结集（仓内 doc/measurement/frozen-exam-2026-10-18）：--verify 免参通过，109 条 sha256 全符', () => {
    const res = runScript(['--verify', '--json']);
    expectExit(res, 0, '--verify 默认冻结集');
    const json = JSON.parse(res.stdout) as VerifyJson;
    expect(json.ok).toBe(true);
    expect(json.frozenDir).toContain('frozen-exam-2026-10-18');
    expect(json.checked).toBeGreaterThanOrEqual(109);
    expect(json.baseline?.judged).toBe(109);
    expect(json.baseline?.wrong).toBe(35);
  }, 60_000);

  it('--verify：sha256/基线相符退 0；冻结集被改则非零退出（协议§二.1）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-exam-jest-'));
    try {
      const batchDir = path.join(dir, 'verdicts', 'b1');
      fs.mkdirSync(batchDir, { recursive: true });
      const content = '{"pid":"p1","arm":"baseline","verdict":{"patterns":{"wrongAnswerPassed":true}}}\n';
      const filePath = path.join(batchDir, 'a.json');
      fs.writeFileSync(filePath, content);
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({
          frozenAt: '2026-10-19T00:00:00.000Z',
          purpose: 'jest fixture（不进仓库）',
          batches: [
            {
              id: 'b1',
              source: 'jest',
              files: 1,
              judged: 1,
              wrongAnswerPassed: 1,
              rate: 1,
              entries: [
                {
                  file: 'a.json',
                  sha256: crypto.createHash('sha256').update(content).digest('hex'),
                  wrongAnswerPassed: true,
                },
              ],
            },
          ],
          totals: { judged: 1, wrong: 1, rate: 1 },
        }),
      );

      const ok = runScript(['--verify', '--frozen-dir', dir, '--json']);
      expectExit(ok, 0, '--verify 全符');
      const okJson = JSON.parse(ok.stdout) as VerifyJson;
      expect(okJson.ok).toBe(true);
      expect(okJson.checked).toBe(1);

      // 改一个字节 → 协议§二.1「有差异即作废本次对照」
      fs.writeFileSync(filePath, `${content} `);
      const bad = runScript(['--verify', '--frozen-dir', dir, '--json']);
      expectExit(bad, 2, '--verify 篡改');
      const badJson = JSON.parse(bad.stdout) as VerifyJson;
      expect(badJson.ok).toBe(false);
      expect(badJson.problems.map((p) => p.code)).toEqual(['HASH_MISMATCH']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('--compare 硬门禁：缺 --verify-frozen / 条件清单一律拒跑（协议§二.1/§二.2）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-exam-compare-'));
    try {
      const frozenDir = path.join(dir, 'frozen');
      const batchDir = path.join(frozenDir, 'verdicts', 'b1');
      fs.mkdirSync(batchDir, { recursive: true });
      const content = '{"pid":"p1","arm":"A","verdict":{"patterns":{"wrongAnswerPassed":true}}}\n';
      fs.writeFileSync(path.join(batchDir, 'a.json'), content);
      fs.writeFileSync(
        path.join(frozenDir, 'manifest.json'),
        JSON.stringify({
          frozenAt: '2026-10-19T00:00:00.000Z',
          purpose: 'jest fixture（不进仓库）',
          batches: [
            {
              id: 'b1',
              source: 'jest',
              files: 1,
              judged: 1,
              wrongAnswerPassed: 1,
              rate: 1,
              entries: [
                { file: 'a.json', sha256: crypto.createHash('sha256').update(content).digest('hex'), wrongAnswerPassed: true },
              ],
            },
          ],
          totals: { judged: 1, wrong: 1, rate: 1 },
        }),
      );

      const mkArm = (name: string) => {
        const armDir = path.join(dir, name);
        fs.mkdirSync(armDir, { recursive: true });
        fs.writeFileSync(
          path.join(armDir, 'r.json'),
          JSON.stringify({
            pid: 'p1',
            arm: 'A',
            verdict: { patterns: { progressInflation: false, loopStuck: false, summaryMismatch: false, wrongAnswerPassed: false, unclosedComplete: false } },
          }),
        );
        return armDir;
      };
      const armA = mkArm('arm-a');
      const armB = mkArm('arm-b');
      const conditions = (promptHash: string) => ({
        modelSnapshot: 'deepseek-v4.1-flash@2026-10-17',
        promptHash,
        temperature: 0.7,
        topP: null,
        maxTokens: 64000,
        seed: null,
        k: 1,
        coverage: 1,
        judgeVersion: 'judge-v3',
      });
      const condA = path.join(dir, 'cond-a.json');
      const condB = path.join(dir, 'cond-b.json');
      fs.writeFileSync(condA, JSON.stringify(conditions('sha256:aaa')));
      fs.writeFileSync(condB, JSON.stringify(conditions('sha256:bbb')));

      const noVerify = runScript(['--compare', '--arm-a', armA, '--arm-b', armB]);
      expectExit(noVerify, 1, '缺 --verify-frozen');
      expect(noVerify.stderr).toContain('--verify-frozen');

      const noConditions = runScript(['--compare', '--verify-frozen', '--frozen-dir', frozenDir, '--arm-a', armA, '--arm-b', armB]);
      expectExit(noConditions, 1, '缺条件清单');
      expect(noConditions.stderr).toContain('conditions');

      const full = runScript([
        '--compare', '--verify-frozen', '--frozen-dir', frozenDir,
        '--arm-a', armA, '--arm-b', armB,
        '--arm-a-conditions', condA, '--arm-b-conditions', condB,
        '--json',
      ]);
      // n=1 < 35/臂 → 协议§二.4 只登记不裁决（退出码 3），但条件与冻结校验必须已通过
      expectExit(full, 3, '合法对照（样本不足）');
      const json = JSON.parse(full.stdout) as {
        frozenVerified: boolean;
        judgeVersion: string;
        conditions: { differing: string[] };
        f1b: { decision: string };
      };
      expect(json.frozenVerified).toBe(true);
      expect(json.judgeVersion).toBe('judge-v3');
      expect(json.conditions.differing).toEqual(['promptHash']);
      expect(json.f1b.decision).toBe('undecided');

      // 两臂条件完全相同 → NO_TREATMENT，退出码 1
      const same = runScript([
        '--compare', '--verify-frozen', '--frozen-dir', frozenDir,
        '--arm-a', armA, '--arm-b', armB,
        '--arm-a-conditions', condA, '--arm-b-conditions', condA,
      ]);
      expectExit(same, 1, '无处理变量');
      expect(same.stdout).toContain('NO_TREATMENT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
