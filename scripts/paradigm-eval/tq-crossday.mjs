#!/usr/bin/env node
/**
 * tq- 案例跨日回写助手（测试专用，仅对探针账号数据生效）。
 *
 * 背景：教学质量的跨日效应（掌握衰减/疲劳回落）在真实账号链路上由「上次会话与本次的
 * 真实时间差」驱动；夜跑所有会话挤在同一个真实日凌晨，跨日永远不会发生。
 * 本脚本把指定探针账号最近一次完成会话的 endTime 与该用户 learning_metrics 的
 * calculatedAt 整体回拨 N 天，使下一次课堂的状态读取看到真实的时间鸿沟。
 * （等价于 vl-lab advance-day 的模拟时钟，但作用在真实账号链路上。）
 *
 * 用法：node scripts/paradigm-eval/tq-crossday.mjs --user=pe-tq-phys-newton --days=3
 */
// @prisma/client 装在 backend 下，本目录没有 node_modules——显式从 backend 解析
import { createRequire } from 'node:module';
import { dirname as _dirname, join as _join } from 'node:path';
import { fileURLToPath as _f2p } from 'node:url';
const backendRequire = createRequire(_join(_dirname(_f2p(import.meta.url)), '..', '..', 'backend', 'package.json'));
const { PrismaClient } = backendRequire('@prisma/client');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2]] : [a, true]; }));
const userName = String(args.user || '');
const days = Number(args.days || 3);
if (!userName || !Number.isFinite(days) || days < 1) {
  console.error('用法: node tq-crossday.mjs --user=<探针账号名> --days=<回拨天数>');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.users.findFirst({
    where: { name: userName },
    select: { id: true },
  });
  if (!user) throw new Error(`用户不存在: ${userName}`);
  const uid = user.id;

  const last = await prisma.teaching_sessions.findFirst({
    where: { userId: uid, status: 'completed' },
    orderBy: { endTime: 'desc' },
    select: { id: true, endTime: true },
  });
  if (!last) throw new Error('该账号没有已完成的教学会话，无需回拨');
  if (!last.endTime) throw new Error(`会话 ${last.id} 无 endTime`);

  const shiftMs = days * 24 * 60 * 60 * 1000;
  const newEnd = new Date(last.endTime.getTime() - shiftMs);

  const session = await prisma.teaching_sessions.update({
    where: { id: last.id },
    data: { endTime: newEnd },
    select: { id: true, endTime: true },
  });

  // 学习状态快照同口径回拨：下一次课堂的状态读取（衰减按 calculatedAt → asOf 差值）才会看到跨日
  const metrics = await prisma.learning_metrics.updateMany({
    where: { userId: uid },
    data: { calculatedAt: new Date(new Date().getTime() - shiftMs) },
  });

  console.log(JSON.stringify({
    user: userName,
    sessionId: session.id,
    endTimeShiftedTo: session.endTime.toISOString(),
    metricsRowsShifted: metrics.count,
    days,
  }, null, 1));
}

main()
  .catch((e) => { console.error('crossday 失败:', e?.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
