/* eslint-disable no-console -- 一次性验证 CLI：写入点双写 conceptId 是否真落库 */
/**
 * 写入路径端到端验证（不依赖 HTTP，免疫后端 respawn）：
 * 直接调用生产函数 `memoryTraceService.recordExtraction`（与课后评估完全同一条路径），
 * 核对 DB 内是否同时写入 canonical `conceptId`，再清理测试痕迹。
 *
 * 背景：跨日 e2e 需要长时 HTTP 会话，而本仓 `ts-node-dev --respawn` 会被并行编辑掐断在途请求；
 * 本脚本走进程内直调，确定性验证 P0 双写。
 *
 * 用法：npx ts-node --transpile-only src/scripts/verify-concept-dualwrite.ts
 */
import 'dotenv/config';
import prisma from '../config/database';
import { memoryTraceService } from '../services/memory/memory-trace.service';
import { conceptRegistryService } from '../services/learner/concept-registry.service';
import { normalizeConceptKey } from '../services/memory/concept-key';

const PROBE_USER = process.env.KC_PROBE_USER || null;

async function pickUser(): Promise<string> {
  if (PROBE_USER) return PROBE_USER;
  const u = await prisma.users.findFirst({ where: { isVirtualLearner: true }, select: { id: true } });
  if (!u) throw new Error('找不到虚拟学习者');
  return u.id;
}

async function main() {
  const userId = await pickUser();
  // 用带引号/尾部标点的变体，顺带验证归一化把变体收敛到同一身份
  const base = `[verify] 双写探针 ${Date.now()}`;
  const variant = `「${base}」。`;
  const norm = normalizeConceptKey(base);

  console.log(`[verify] user=${userId}`);
  console.log(`[verify] 归一化：${JSON.stringify(base)} → ${JSON.stringify(norm)}；变体 ${JSON.stringify(variant)} → ${JSON.stringify(normalizeConceptKey(variant))}`);
  if (normalizeConceptKey(variant) !== norm) throw new Error('变体未收敛到同一归一化键（归一化逻辑异常）');

  // 1) 走生产写入路径
  await memoryTraceService.recordExtraction({
    userId, conceptKey: base, label: base, masteryScore: 0.6, stability: 'developing', source: 'derived',
  });
  // 2) 再用变体写一次（应命中同一 conceptId）
  await memoryTraceService.recordExtraction({
    userId, conceptKey: variant, label: variant, masteryScore: 0.65, stability: 'developing', source: 'derived',
  });

  const rows = await prisma.memory_traces.findMany({
    where: { userId, conceptKey: { in: [norm, normalizeConceptKey(variant)] } },
    select: { conceptKey: true, conceptId: true },
  });
  console.log(`[verify] 落库痕迹：${JSON.stringify(rows)}`);
  const withId = rows.filter((r) => r.conceptId);
  if (withId.length === 0) throw new Error('双写失败：conceptId 仍为 null');
  const uniqueIds = new Set(withId.map((r) => r.conceptId));
  console.log(`[verify] conceptId 已落库 ${withId.length}/${rows.length}；不同身份数=${uniqueIds.size}（应为 1）`);

  const concept = await prisma.concepts.findUnique({
    where: { id: [...uniqueIds][0]! },
    include: { aliases: { select: { aliasNorm: true, source: true } } },
  });
  console.log(`[verify] canonical=${concept?.canonicalLabel} level=${concept?.level} 别名数=${concept?.aliases.length}`);

  // 清理探针数据（不污染画像）
  await prisma.memory_traces.deleteMany({ where: { userId, conceptKey: { in: [norm, normalizeConceptKey(variant)] } } });
  for (const id of uniqueIds) {
    await prisma.concept_aliases.deleteMany({ where: { conceptId: id } });
    await prisma.concepts.deleteMany({ where: { id } });
  }
  console.log('[verify] 探针数据已清理');
  const ok = withId.length === rows.length && uniqueIds.size === 1;
  console.log(ok ? '[verify] ✅ 双写 + 变体收敛 均通过' : '[verify] ❌ 断言未通过');
  if (!ok) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error('[verify] 失败:', e); process.exit(1); });
