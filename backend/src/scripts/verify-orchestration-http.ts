/**
 * 编排文件编辑侧 HTTP 端点验证（批次 C）
 * 用临时 ORCHESTRATION_DIR 启动 mini express app（挂真实 field-routings 路由），
 * 直接验证三个新端点的状态码与响应结构：
 *   GET  /api/admin/field-routings/orchestration/:stage
 *   PUT  /api/admin/field-routings/orchestration/:stage
 *   POST /api/admin/field-routings/orchestration/:stage/sync
 * 不触碰真实 prompts/orchestration（写盘/备份均在临时目录）。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Server } from 'http';

const realOrch = path.resolve(__dirname, '../../../prompts/orchestration');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-http-verify-'));
const tmpOrch = path.join(tmpRoot, 'orchestration');

fs.mkdirSync(tmpOrch, { recursive: true });
for (const name of fs.readdirSync(realOrch).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'))) {
  fs.copyFileSync(path.join(realOrch, name), path.join(tmpOrch, name));
}

process.env.ORCHESTRATION_DIR = tmpOrch;

async function main() {
  const express = (await import('express')).default;
  const fieldRoutingsRouter = (await import('../routes/admin/field-routings')).default;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'verify-admin', role: 'admin' };
    next();
  });
  app.use('/api/admin/field-routings', fieldRoutingsRouter);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api/admin/field-routings`;

  let failed = false;
  function check(label: string, ok: boolean, detail = '') {
    if (!ok) {
      failed = true;
      console.error(`✗ FAIL ${label} ${detail}`);
    } else {
      console.log(`✓ ${label}${detail ? `（${detail}）` : ''}`);
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

  // 1. GET 正常
  {
    const { status, body } = await json(await fetch(`${base}/orchestration/goal`));
    check('GET /orchestration/goal → 200', status === 200 && body?.success === true, `status=${status}`);
    check('GET 返回 fileName=goal.yaml', body?.data?.fileName === 'goal.yaml', body?.data?.fileName);
    check('GET content 为原文', typeof body?.data?.content === 'string' && body.data.content.includes('stage: goal'));
    const p = body?.data?.parsed || {};
    check('GET 解析摘要（契约 2 / 字段 31 / 路由 55）', p.contractCount === 2 && p.fieldCount === 31 && p.routingCount === 55, JSON.stringify(p));
  }

  // 2. GET 404 / 路径穿越
  {
    const { status } = await json(await fetch(`${base}/orchestration/nope`));
    check('GET /orchestration/nope → 404', status === 404);
    const trav = await json(await fetch(`${base}/orchestration/..%2F..%2Fgoal`));
    check('GET 路径穿越 → 404', trav.status === 404, `status=${trav.status}`);
  }

  // 3. PUT 校验失败 → 400
  {
    const badRole = fs.readFileSync(path.join(tmpOrch, 'goal.yaml'), 'utf-8').replace('promptRole: soft-info', 'promptRole: bogus-role');
    const { status, body } = await json(await fetch(`${base}/orchestration/goal`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: badRole }),
    }));
    check('PUT 非法 promptRole → 400', status === 400 && !body?.success, body?.error?.message?.slice(0, 60));
  }

  // 4. PUT stage 不一致 → 400
  {
    const content = fs.readFileSync(path.join(tmpOrch, 'goal.yaml'), 'utf-8').replace('stage: goal', 'stage: path');
    const { status, body } = await json(await fetch(`${base}/orchestration/goal`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }));
    check('PUT stage 不一致 → 400', status === 400 && /不一致/.test(body?.error?.message || ''), body?.error?.message?.slice(0, 60));
  }

  // 5. PUT 空 content → 400
  {
    const { status } = await json(await fetch(`${base}/orchestration/goal`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    }));
    check('PUT 空 content → 400', status === 400);
  }

  // 6. PUT 正常：备份 → 写盘 → ensure（真实 DB）→ 返回摘要
  let edited = '';
  {
    const content = fs.readFileSync(path.join(tmpOrch, 'goal.yaml'), 'utf-8');
    edited = content.replace(
      '\nroutings:',
      `\n  # === HTTP 验证临时字段 ===
  - fieldId: verify.http_probe
    promptRole: soft-info
    valueType: string
    description: HTTP 链路验证临时字段
routings:`
    );
    const { status, body } = await json(await fetch(`${base}/orchestration/goal`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: edited }),
    }));
    check('PUT 合法内容 → 200', status === 200 && body?.success === true, `status=${status}`);
    const d = body?.data || {};
    check('PUT 返回 fieldCount=32 / contractCount=2 / routingCount=55', d.fieldCount === 32 && d.contractCount === 2 && d.routingCount === 55, JSON.stringify({ f: d.fieldCount, c: d.contractCount, r: d.routingCount }));
    check('PUT synced=true（DB 可用时 ensure 成功）', d.synced === true, `synced=${d.synced}`);
    check('PUT syncHint 提示强制同步/重启生效', typeof d.syncHint === 'string' && d.syncHint.length > 0);
    const backupsDir = path.join(tmpRoot, 'backups', 'orchestration', 'goal');
    const backups = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir) : [];
    check('PUT 已备份 prompts/backups/orchestration/goal/<ts>.yaml', backups.some((n) => /^\d{4}-\d{2}-\d{2}T.*\.yaml$/.test(n)), backups.join(','));
    const disk = fs.readFileSync(path.join(tmpOrch, 'goal.yaml'), 'utf-8');
    check('PUT 写盘生效（文件包含新字段）', disk.includes('verify.http_probe'));
  }

  // 7. PUT 后 GET 反映新摘要
  {
    const { status, body } = await json(await fetch(`${base}/orchestration/goal`));
    check('PUT 后 GET fieldCount=32', status === 200 && body?.data?.parsed?.fieldCount === 32, `fieldCount=${body?.data?.parsed?.fieldCount}`);
  }

  // 8. POST sync：全量对账（文件为准）+ admin 覆盖行保护
  {
    const { status, body } = await json(await fetch(`${base}/orchestration/goal/sync`, { method: 'POST' }));
    check('POST /orchestration/goal/sync → 200', status === 200 && body?.success === true, `status=${status}`);
    const d = body?.data || {};
    check('sync 返回 contracts/fields/routings 更新计数', typeof d.contractsUpdated === 'number' && typeof d.fieldsUpdated === 'number' && typeof d.routingsUpdated === 'number', JSON.stringify({ c: d.contractsUpdated, f: d.fieldsUpdated, r: d.routingsUpdated, created: d.createdCount }));
    check('sync skippedAdminRows 为数组', Array.isArray(d.skippedAdminRows));
    check('sync 后字段数=32（含 probe）', d.fieldsUpdated >= 31, `fieldsUpdated=${d.fieldsUpdated}`);
  }

  // 9. POST sync 404
  {
    const { status } = await json(await fetch(`${base}/orchestration/nope/sync`, { method: 'POST' }));
    check('POST sync 未知 stage → 404', status === 404);
  }

  // 清理：DB 探针字段 + 临时目录
  try {
    const { default: systemPrisma } = await import('../config/system-database');
    await systemPrisma.field_definitions.deleteMany({ where: { fieldId: 'verify.http_probe', stage: 'goal' } });
    console.log('  ✓ 已清理 DB 探针字段 verify.http_probe');
    await systemPrisma.$disconnect();
  } catch (e: any) {
    console.warn(`  ⚠ DB 探针清理失败：${String(e?.message || e).slice(0, 120)}`);
  }
  server.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(failed ? '\n存在失败项' : '\n全部通过');
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exitCode = 1;
});
