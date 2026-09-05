/**
 * scaffold 端到端验收脚本（P5 一条龙，SCAFFOLD_P5_SURVEY §5 手工验收自动化）
 *
 * 挂真实 skills 路由（无鉴权 stub）+ 真实 scaffold 服务，对真实仓库执行：
 *   1. POST /scaffold 新建 mainline 测试 skill（test-scaffold-demo）
 *   2. 生成物逐一独立过校验器（parseCoreFile / validateSkillsContent / parseOrchestrationFile）
 *   3. 幂等重放 → 409；删除 core.yaml 后重放 → completed（补齐缺失生成物）
 *   4. 清理全部生成物并复验（skills.yaml 条目 / core.yaml / handler 目录 / 编排 contracts / 备份）
 *
 * 用法：ts-node src/scripts/verify-scaffold-e2e.ts
 * 注意：本脚本真实写盘 prompts/skills.yaml / prompts/core/ / prompts/orchestration/ /
 *       backend/src/skills/，结束后自动还原；中途失败时需手工清理 test-scaffold-demo 生成物。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Server } from 'http';

const TEST_SKILL = 'test-scaffold-demo';
const repoRoot = path.resolve(__dirname, '../../../');
const skillsPath = path.join(repoRoot, 'prompts', 'skills.yaml');
const corePath = path.join(repoRoot, 'prompts', 'core', `${TEST_SKILL}.yaml`);
const handlerDir = path.join(repoRoot, 'backend', 'src', 'skills', TEST_SKILL);
const goalOrchPath = path.join(repoRoot, 'prompts', 'orchestration', 'goal.yaml');
const scaffoldBackupsDir = path.join(repoRoot, 'prompts', 'backups', 'scaffold');

let failed = false;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) {
    failed = true;
    console.error(`\u2717 FAIL ${label}${detail ? `（${detail}）` : ''}`);
  } else {
    console.log(`\u2713 ${label}${detail ? `（${detail}）` : ''}`);
  }
}
async function json(res: Response) {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: null, raw: text.slice(0, 200) };
  }
}

/** 备份原文件内容（清理时按原样还原） */
const originalSkills = fs.readFileSync(skillsPath, 'utf-8');
const originalGoal = fs.readFileSync(goalOrchPath, 'utf-8');
let skillsRestored = false;
let goalRestored = false;

function cleanup() {
  // 1. skills.yaml：整文件还原为启动时快照（append 条目的最稳还原方式）
  if (!skillsRestored) {
    fs.writeFileSync(skillsPath, originalSkills, 'utf-8');
    skillsRestored = true;
  }
  // 2. 编排 contracts：整文件还原为启动时快照
  if (!goalRestored) {
    fs.writeFileSync(goalOrchPath, originalGoal, 'utf-8');
    goalRestored = true;
  }
  // 3. core.yaml / handler 目录
  if (fs.existsSync(corePath)) fs.rmSync(corePath, { force: true });
  if (fs.existsSync(handlerDir)) fs.rmSync(handlerDir, { recursive: true, force: true });
  // 4. 备份目录（本次 scaffold 产生的）
  if (fs.existsSync(scaffoldBackupsDir)) {
    for (const name of fs.readdirSync(scaffoldBackupsDir)) {
      fs.rmSync(path.join(scaffoldBackupsDir, name), { recursive: true, force: true });
    }
  }
}

async function main() {
  const express = (await import('express')).default;
  const skillsRouter = (await import('../routes/admin/skills')).default;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'verify-admin', role: 'admin' };
    next();
  });
  app.use('/api/admin/skills', skillsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api/admin/skills`;

  try {
    // ---- 1. 新建 mainline ----
    const created = await json(
      await fetch(`${base}/scaffold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: TEST_SKILL,
          kind: 'mainline',
          stage: 'goal',
          parentAgent: 'goal-agent',
          displayName: '测试 Scaffold Skill',
          description: '端到端验收用测试 Skill',
        }),
      }),
    );
    check('POST /scaffold 新建 → 200 + status=created', created.status === 200 && created.body?.data?.status === 'created', `status=${created.status}`);
    const data = created.body?.data || {};
    check('completion 状态为 handler-ready（占位 handler 已落盘、注册未就绪）', data.completion?.status === 'handler-ready', `completion=${data.completion?.status}`);
    check(
      'generated 清单含 4 个生成物',
      ['prompts/core/test-scaffold-demo.yaml', 'backend/src/skills/test-scaffold-demo/index.ts', 'prompts/orchestration/goal.yaml', 'prompts/skills.yaml'].every((f) => data.generated?.includes(f)),
      (data.generated || []).join(', '),
    );
    check('note 提示 SC_NOT_IMPLEMENTED', String(data.note || '').includes('SC_NOT_IMPLEMENTED'));
    check('注册片段返回文本（skills/index.ts）', (data.snippets || []).some((s: any) => s.title.includes('skills/index.ts')));

    // ---- 2. 生成物独立过校验器 ----
    const { parseCoreFile } = await import('../services/prompt-lab/core-file-loader');
    const { validateSkillsContent } = await import('../services/skill-registry/skills-file');
    const { parseOrchestrationFile } = await import('../services/field-routing/orchestration-file');

    const coreChecked = parseCoreFile(corePath, fs.readFileSync(corePath, 'utf-8'));
    check('core.yaml 过 validateCoreFileShape', coreChecked.core !== null && coreChecked.diagnostics.length === 0, coreChecked.diagnostics.map((d) => d.message).join('；'));
    check('core.yaml 含 TODO 占位（完成度停在 core-ready 之前）', (coreChecked.core?.identity || '').includes('TODO'));

    const book = validateSkillsContent(fs.readFileSync(skillsPath, 'utf-8'));
    const entry = book.skills.find((e) => e.skillId === TEST_SKILL);
    check('skills.yaml 追加后过 validateSkillsContent（F1-F12 内存校验）', Boolean(entry), `count=${book.skills.length}`);
    check('条目字段齐备（kind/stage/parentAgent/handlerRef/coreFile）', entry?.kind === 'mainline' && entry?.stage === 'goal' && entry?.parentAgent === 'goal-agent' && entry?.handlerRef === `backend/src/skills/${TEST_SKILL}/index.ts` && entry?.coreFile === `prompts/core/${TEST_SKILL}.yaml`);

    const stage = parseOrchestrationFile(goalOrchPath);
    check('编排 goal.yaml contracts 追加后过 parseOrchestrationFile', stage.contracts.some((c) => c.agentId === `skill:${TEST_SKILL}`), `contracts=${stage.contracts.length}`);

    const handlerSource = fs.readFileSync(path.join(handlerDir, 'index.ts'), 'utf-8');
    check('handler 占位落盘且抛 SC_NOT_IMPLEMENTED', handlerSource.includes('SC_NOT_IMPLEMENTED: ' + TEST_SKILL));
    check('备份已写入 prompts/backups/scaffold/<ts>/', fs.readdirSync(scaffoldBackupsDir).some((n) => /^\d{4}-\d{2}-\d{2}T.*$/.test(n)));

    // ---- 3. 幂等 ----
    const replay = await json(
      await fetch(`${base}/scaffold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: TEST_SKILL, kind: 'mainline', stage: 'goal', parentAgent: 'goal-agent' }),
      }),
    );
    check('全量重放 → 409（条目与生成物齐备）', replay.status === 409, `status=${replay.status}`);
    check('409 响应带 completion', Boolean(replay.body?.data?.completion));

    fs.rmSync(corePath, { force: true });
    const completed = await json(
      await fetch(`${base}/scaffold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: TEST_SKILL, kind: 'mainline', stage: 'goal', parentAgent: 'goal-agent' }),
      }),
    );
    check('部分存在（缺 core）→ 200 + status=completed（补齐缺失生成物）', completed.status === 200 && completed.body?.data?.status === 'completed', `status=${completed.status}`);
    check('补齐后 core.yaml 重新落盘', fs.existsSync(corePath));
    const bookAfter = validateSkillsContent(fs.readFileSync(skillsPath, 'utf-8'));
    check('补齐不产生重复条目', bookAfter.skills.filter((e) => e.skillId === TEST_SKILL).length === 1);
    const stageAfter = parseOrchestrationFile(goalOrchPath);
    check('补齐不产生重复 contracts', stageAfter.contracts.filter((c) => c.agentId === `skill:${TEST_SKILL}`).length === 1);
  } finally {
    server.close();
  }

  // ---- 4. 清理并复验 ----
  cleanup();
  const { validateSkillsContent: reSkills } = await import('../services/skill-registry/skills-file');
  const { parseOrchestrationFile: reOrch } = await import('../services/field-routing/orchestration-file');
  check('清理后 skills.yaml 无 test-scaffold-demo 条目', !reSkills(fs.readFileSync(skillsPath, 'utf-8')).skills.some((e) => e.skillId === TEST_SKILL));
  check('清理后 core.yaml 已删除', !fs.existsSync(corePath));
  check('清理后 handler 目录已删除', !fs.existsSync(handlerDir));
  check('清理后 goal.yaml 无 test-scaffold-demo contract', !reOrch(goalOrchPath).contracts.some((c) => c.agentId === `skill:${TEST_SKILL}`));
  check('清理后 skills.yaml 与原件逐字节一致', fs.readFileSync(skillsPath, 'utf-8') === originalSkills);
  check('清理后 goal.yaml 与原件逐字节一致', fs.readFileSync(goalOrchPath, 'utf-8') === originalGoal);
  check('清理后备份目录已清空', !fs.existsSync(scaffoldBackupsDir) || fs.readdirSync(scaffoldBackupsDir).length === 0);
  // 冷启动校验链（parseSkillsFile 含 F5/F6/F3/F12 全量）：
  const { loadSkillsFile } = await import('../services/skill-registry/skills-file');
  let coldOk = true;
  try {
    loadSkillsFile();
  } catch (e) {
    coldOk = false;
    console.error('loadSkillsFile FAIL', e);
  }
  check('清理后 loadSkillsFile（F1~F10/F12 全量）通过', coldOk);

  console.log(failed ? '[verify-scaffold-e2e] FAIL' : '[verify-scaffold-e2e] OK：新建 → 校验 → 幂等 → 补齐 → 清理全链路通过');
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error('[verify-scaffold-e2e] 异常退出，尝试清理…', error);
  cleanup();
  process.exitCode = 1;
});
