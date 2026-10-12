#!/usr/bin/env node
/**
 * AB 对照盯课采样器（2026-10-13 用户令「今晚就盯着这个课程」）
 *
 * 每 --interval 分钟采一次两个虚拟学习者的上课进度（虚拟会话状态 + 当前课堂消息数 + 最近一句），
 * 追加到 doc/local/runs/20261013/ab-pair/monitor.log。只读，不改任何数据。
 *
 * 用法：node scripts/vlab-eval/ab-pair-monitor.mjs [--interval=5] [--hours=8]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? Number(hit.split('=')[1]) : d; };
const INTERVAL_MIN = arg('interval', 5);
const HOURS = arg('hours', 8);
const OUT = path.join(ROOT, 'doc/local/runs/20261013/ab-pair');
const LOG = path.join(OUT, 'monitor.log');
const MANIFEST = path.join(OUT, 'manifest.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toLocaleString('zh-CN');

function sample() {
  const db = new DatabaseSync(path.join(ROOT, 'backend/prisma/dev.db'), { readOnly: true });
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const lines = [`── ${ts()} ──`];
  for (const p of manifest.pair) {
    const s = db.prepare('SELECT status,currentStage,currentTaskId,completedTasks,totalTasks,updatedAt FROM virtual_sessions WHERE id=?').get(p.sessionId);
    const tasks = db.prepare('SELECT status, COUNT(*) c FROM subtasks WHERE milestoneId IN (SELECT id FROM milestones WHERE learningPathId=?) GROUP BY status').all(p.pathId);
    const done = db.prepare('SELECT COUNT(*) c FROM subtasks WHERE milestoneId IN (SELECT id FROM milestones WHERE learningPathId=?) AND status=\'completed\'').get(p.pathId).c;
    const classCount = db.prepare('SELECT COUNT(*) c FROM teaching_sessions WHERE learningPathId=?').get(p.pathId).c;
    const latest = db.prepare('SELECT id,status,updatedAt FROM teaching_sessions WHERE learningPathId=? ORDER BY updatedAt DESC LIMIT 1').get(p.pathId);
    let msgLine = '';
    if (latest) {
      // messages 大列已侧表化（teaching_sessions.messages 常为 NULL）——侧表为准，列兜底
      let msgs = [];
      try {
        const side = db.prepare('SELECT role, content, createdAt FROM teaching_session_messages WHERE sessionId=? ORDER BY createdAt').all(latest.id);
        if (side.length) msgs = side;
      } catch { /* 侧表不存在时走列 */ }
      if (!msgs.length) {
        const row = db.prepare('SELECT messages FROM teaching_sessions WHERE id=?').get(latest.id);
        try { msgs = JSON.parse(row?.messages || '[]'); } catch { /* ignore */ }
      }
      const last = msgs[msgs.length - 1];
      msgLine = `｜课堂 ${latest.status}｜消息 ${msgs.length} 条｜末句[${last?.role || '?'}] ${String(last?.content || '').replace(/\s+/g, ' ').slice(0, 70)}`;
    }
    lines.push(`  ${p.name}（${p.identity}）会话 ${s?.status}/${s?.currentStage}｜任务 ${done}/${s?.totalTasks || '?'} 完课｜课次 ${classCount}${msgLine}`);
  }
  db.close();
  const text = lines.join('\n') + '\n';
  fs.appendFileSync(LOG, text);
  process.stdout.write(text);
}

const deadline = Date.now() + HOURS * 3600 * 1000;
while (Date.now() < deadline) {
  try { sample(); } catch (error) { fs.appendFileSync(LOG, `采样失败：${error instanceof Error ? error.message : String(error)}\n`); }
  await sleep(INTERVAL_MIN * 60 * 1000);
}
