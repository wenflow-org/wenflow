/* eslint-disable @typescript-eslint/no-explicit-any -- 边界解析 LLM/JSON 动态载荷，形状由上游契约与运行时校验兜底 */
/**
 * export-classroom-md.ts —— 把 mini-batch 某批的真实课堂逐轮导出为人类可读 Markdown，
 * 供教育视角 / 学员体验视角的子代理评审（2026-11-14 交流体验专项取证）。
 *
 * 证据与 judge-minibatch-classrooms.ts 同源：teaching_session_messages（学习者真实可见载荷），
 * 板书取 teachingState.sessionArtifacts.boardHistory 的 revision 回放摘要，收束取 wrapup。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/export-classroom-md.ts --run-dir=.runtime/referee-minibatch/reeval10-2026-11-14
 * 输出：<run-dir>/review-md/<caseId>__<sessionId 前 8>.md
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function arg(name: string, fallback = ''): string {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function clip(value: unknown, n: number): string {
  const s = String(value ?? '').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

const backendRoot = path.resolve(__dirname, '../..');
const runRoot = path.resolve(backendRoot, arg('run-dir', '.runtime/referee-minibatch'));
const outDir = path.join(runRoot, 'review-md');
const CONTENT_CLIP = Math.max(400, Number(arg('content-clip', '1600')) || 1600);

/** 通用 spec 文本抽取（与 judge 脚本同思路，轻量版）：把图型 spec 里的可读文本收出来 */
function specTexts(spec: any, limit = 20): string[] {
  if (!spec || typeof spec !== 'object') return [];
  const out: string[] = [];
  const walk = (value: any, depth: number) => {
    if (depth > 5 || out.length >= limit) return;
    if (typeof value === 'string') {
      const t = value.trim();
      if (t && t.length <= 120 && !/^(#[0-9a-f]{3,8}|left|right|center|top|bottom)$/i.test(t)) out.push(t);
      return;
    }
    if (Array.isArray(value)) { value.forEach(v => walk(v, depth + 1)); return; }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (['palette', 'tone', 'engine', 'source', 'id', 'focusId'].includes(k)) continue;
        walk(v, depth + 1);
      }
    }
  };
  walk(spec, 0);
  return out;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const judgeFiles: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name.endsWith('.json') && !entry.name.startsWith('classrooms-summary')) judgeFiles.push(path.join(dir, entry.name));
    }
  };
  walk(path.join(runRoot, 'classrooms'));

  for (const file of judgeFiles.sort()) {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const tsId: string = record.teachingSessionId;
    if (!tsId) continue;
    const turnCount = Number(record.turnCount || 0);
    if (turnCount < 3) {
      console.log(`[skip] ${record.caseId} ${tsId} 仅 ${turnCount} 轮（残课）`);
      continue;
    }

    const ts = await prisma.teaching_sessions.findUnique({ where: { id: tsId } });
    if (!ts) { console.log(`[miss] session ${tsId}`); continue; }

    const messages = await prisma.teaching_session_messages.findMany({
      where: { sessionId: tsId },
      orderBy: { id: 'asc' },
    });

    // 板书 revision → 可见面文本（轻量摘要）
    let boardHistory: Array<{ revision: number; spec: any }> = [];
    try {
      const state = ts.teachingState ? JSON.parse(ts.teachingState) : null;
      const h = state?.sessionArtifacts?.boardHistory;
      if (Array.isArray(h)) boardHistory = h.map((e: any) => ({ revision: Number(e.revision), spec: e.spec }));
    } catch { /* ignore */ }
    const revText = (rev: number | undefined) => {
      if (!Number.isFinite(Number(rev))) return null;
      const hit = boardHistory.find(e => e.revision === Number(rev));
      if (!hit) return null;
      const texts = specTexts(hit.spec, 14);
      return texts.length ? texts.join('｜') : null;
    };

    const lines: string[] = [];
    lines.push(`# 课堂逐轮转录（子代理评审用）`);
    lines.push(`- case: ${record.caseId}｜task: ${record.taskTitle}`);
    lines.push(`- 轮数: ${turnCount}｜机器判官 verdict: ${record.report?.verdict ?? '?'}（overall ${record.report?.scores?.overall ?? '?'}）`);
    lines.push(`- 本文件只提供事实转录，评审结论由阅读它的代理自行给出。`);
    lines.push('');
    let seq = 0;
    for (const m of messages) {
      let payload: any = {};
      try { payload = JSON.parse(m.payload || '{}'); } catch { payload = {}; }
      const isLearner = payload.role === 'user';
      const content = clip(payload.content, CONTENT_CLIP);
      if (!content && !payload.figures?.length) continue;
      const who = isLearner ? '学习者' : '教师';
      lines.push(`## 轮 ${seq} · ${who}`);
      if (content) lines.push(content);
      if (!isLearner) {
        const rev = Number(payload.boardState?.revision);
        const boardText = revText(rev);
        if (boardText) lines.push(`\n**[板书 rev${rev}]** ${clip(boardText, 700)}`);
        if (Array.isArray(payload.figures) && payload.figures.length) {
          for (const fig of payload.figures.slice(0, 2)) {
            const texts = specTexts(fig?.spec ?? fig, 10);
            if (texts.length) lines.push(`\n**[图文 ${fig?.kind ?? '?'}]** ${clip(texts.join('｜'), 400)}`);
          }
        }
        const question = payload.question ?? payload.analysis?.question;
        if (question) lines.push(`\n**[提问]** ${clip(question, 300)}`);
      }
      lines.push('');
      seq++;
    }

    // wrapup
    try {
      const wrap = ts.wrapup ? JSON.parse(ts.wrapup as string) : null;
      if (wrap) {
        lines.push(`## 收束（wrapup 产物）`);
        lines.push('```json');
        lines.push(clip(JSON.stringify(wrap, null, 2), 3000));
        lines.push('```');
      }
    } catch { /* ignore */ }

    const shortId = tsId.slice(-8);
    const outFile = path.join(outDir, `${record.caseId}__${shortId}.md`);
    fs.writeFileSync(outFile, lines.join('\n'));
    console.log(`[ok] ${outFile}（${seq} 轮）`);
  }
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
