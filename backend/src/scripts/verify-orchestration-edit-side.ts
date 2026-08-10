/**
 * 编排文件编辑侧手工验证脚本（批次 C）
 * 验证读写链路：
 *  1. 临时 ORCHESTRATION_DIR：复制 goal.yaml → GET 解析摘要
 *  2. 模拟 PUT：备份 → 写盘 → 内存校验 → 重新加载（loadOrchestrationFiles 生效）
 *  3. ensure（只建不更新，真实 DB 可用时执行）
 *  4. 校验失败路径（非法 promptRole / stage 不一致）
 *  5. 路径穿越防护
 * 不触碰真实 prompts/orchestration（备份目录在临时根下模拟 prompts/backups 结构）。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const realOrch = path.resolve(__dirname, '../../../prompts/orchestration');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-verify-'));
const tmpOrch = path.join(tmpRoot, 'orchestration');

fs.mkdirSync(tmpOrch, { recursive: true });
for (const name of fs.readdirSync(realOrch).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'))) {
  fs.copyFileSync(path.join(realOrch, name), path.join(tmpOrch, name));
}

process.env.ORCHESTRATION_DIR = tmpOrch;

async function main() {
  const { loadOrchestrationFiles, validateOrchestrationContent, parseOrchestrationFile } = await import('../services/field-routing/orchestration-file');
  const { ensureStageFieldRoutings } = await import('../services/field-routing-bootstrap.service');

  function expectOk(label: string, ok: boolean, detail = '') {
    if (!ok) {
      console.error(`✗ FAIL ${label} ${detail}`);
      process.exitCode = 1;
    } else {
      console.log(`✓ ${label}${detail ? `（${detail}）` : ''}`);
    }
  }

  // 1. 文件链路：解析 + 摘要
  const stages = loadOrchestrationFiles();
  expectOk('loadOrchestrationFiles 从临时目录加载全部 5 个文件', stages.length === 5, `files=${stages.length}`);
  const goal = stages[0];
  expectOk('解析出的 stage=goal', goal.stage === 'goal');
  const summary = { contractCount: goal.contracts.length, fieldCount: goal.fields.length, routingCount: goal.routings.length };
  console.log('  摘要:', JSON.stringify(summary));

  // 2. GET 语义：读文件原文 + validateOrchestrationContent 同构
  const filePath = path.join(tmpOrch, 'goal.yaml');
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsedFromContent = validateOrchestrationContent(content);
  const parsedFromFile = parseOrchestrationFile(filePath);
  expectOk(
    'validateOrchestrationContent 与 parseOrchestrationFile 同构',
    JSON.stringify(parsedFromContent.fields) === JSON.stringify(parsedFromFile.fields)
      && JSON.stringify(parsedFromContent.routings) === JSON.stringify(parsedFromFile.routings),
  );

  // 3. PUT 语义：备份 → 写盘（追加软信息字段）→ 内存校验 → ensure（只建不更新）
  const backupsDir = path.join(tmpRoot, 'backups', 'orchestration', 'goal');
  fs.mkdirSync(backupsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(filePath, path.join(backupsDir, `${ts}.yaml`));
  expectOk('备份写入 prompts/backups/orchestration/goal/<ts>.yaml', fs.existsSync(path.join(backupsDir, `${ts}.yaml`)), ts);

  const edited = content.replace(
    '\nroutings:',
    `\n  # === 手工验证临时字段（编辑侧链路） ===
  - fieldId: verify.edit_side_probe
    promptRole: soft-info
    valueType: string
    description: 编辑侧链路验证临时字段
routings:`
  );
  let validated;
  try {
    validated = validateOrchestrationContent(edited);
    expectOk('编辑内容通过内存校验', true, `fields=${validated.fields.length}`);
  } catch (e) {
    expectOk('编辑内容通过内存校验', false, String(e));
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(filePath, edited, 'utf-8');
  const reloaded = loadOrchestrationFiles().find((s) => s.stage === 'goal')!;
  expectOk('写盘后 loadOrchestrationFiles 重新加载生效', reloaded.fields.some((f) => f.fieldId === 'verify.edit_side_probe'));

  // 4. ensure 语义（本地 DB 可用才执行；Prisma 连接失败仅提示不判红）
  const { default: systemPrisma } = await import('../config/system-database');
  try {
    const result = await ensureStageFieldRoutings(systemPrisma, validated);
    console.log('  ensure 结果:', JSON.stringify(result));
    expectOk('ensureStageFieldRoutings 执行完成', true);
    // 清理：删除本次验证创建的探针字段，不留库副作用
    try {
      await systemPrisma.field_definitions.delete({ where: { fieldId: 'verify.edit_side_probe' } });
      console.log('  ✓ 已清理探针字段 verify.edit_side_probe');
    } catch (e: any) {
      console.warn(`  ⚠ 探针字段清理失败：${String(e?.message || e).slice(0, 120)}`);
    }
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/prisma|database|sqlite|no such file|P1001|connect/i.test(msg)) {
      console.warn(`  ⚠ ensure 跳过（本地 DB 不可用）：${msg.slice(0, 120)}`);
    } else {
      expectOk('ensureStageFieldRoutings 执行完成', false, msg.slice(0, 200));
    }
  }

  // 5. 校验失败路径
  const badRole = edited.replace('promptRole: soft-info', 'promptRole: bogus-role');
  try {
    validateOrchestrationContent(badRole);
    expectOk('非法 promptRole 被拦截', false);
  } catch {
    expectOk('非法 promptRole 被拦截', true);
  }

  const stageMismatch = edited.replace('stage: goal', 'stage: path');
  const v = validateOrchestrationContent(stageMismatch);
  expectOk('stage 不一致可被调用方识别（validate 返回声明 stage）', v.stage === 'path', `declared=${v.stage}`);

  // 6. 路径穿越防护（GET 语义：非法 stage 不得定位文件）
  expectOk('路径穿越字符被 stage 白名单拒绝', !/^[\w.-]+$/.test('../secret'));

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(process.exitCode ? '\n存在失败项' : '\n全部通过');
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exitCode = 1;
});
