/* eslint-disable no-console -- 一次性诊断 CLI */
/**
 * 精确重放指定 promptCallLog 的请求（新消息形态），打印模型原始输出与抽取结果。
 * 用法：npx ts-node --transpile-only src/scripts/probe-replay-call.ts <promptCallId>
 */
import 'dotenv/config';
import axios from 'axios';
import sqlite3 from 'sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

function readDb<T>(dbPath: string, sql: string, params: unknown[] = []): Promise<T | null> {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    db.get(sql, params, (error: Error | null, row: T) => {
      db.close();
      resolve(error ? null : row || null);
    });
  });
}

function readAll<T>(dbPath: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    db.all(sql, params, (error: Error | null, rows: T[]) => {
      db.close();
      resolve(error ? [] : rows || []);
    });
  });
}

/**
 * 双读（同口径 teaching-session-message-store.loadTeachingMessages）：
 * 侧表 teaching_session_messages 有行即权威（回灌后老列已置 NULL），ORDER BY id ASC；
 * 空则回退解析 teaching_sessions.messages 老列。解析失败按空处理。
 */
async function readSessionMessages(dbPath: string, sessionId: string): Promise<Array<{ role: string; content: string }>> {
  const sideRows = await readAll<{ payload: string }>(
    dbPath,
    'SELECT payload FROM teaching_session_messages WHERE sessionId = ? ORDER BY id ASC',
    [sessionId],
  );
  if (sideRows.length > 0) {
    return sideRows
      .map((row) => {
        try {
          const parsed = JSON.parse(row.payload);
          return parsed && typeof parsed === 'object' ? parsed as { role: string; content: string } : null;
        } catch {
          return null;
        }
      })
      .filter((m): m is { role: string; content: string } => m !== null);
  }
  const sess = await readDb<{ messages: string }>(dbPath, 'SELECT messages FROM teaching_sessions WHERE id = ?', [sessionId]);
  try {
    const parsed = JSON.parse(sess?.messages || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((m): m is { role: string; content: string } => m && typeof m === 'object')
      : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const callId = process.argv[2];
  if (!callId) { console.error('usage: probe-replay-call.ts <promptCallId>'); process.exitCode = 1; return; }
  const endpoint = (process.env.AI_API_URL || '').trim();
  const apiKey = (process.env.AI_API_KEY || '').trim();
  const model = (process.env.AI_MODEL || '').trim();

  const log = await readDb<{ userPayload: string; userId: string }>(
    'prisma/dev.db',
    'SELECT userPayload, userId FROM prompt_call_logs WHERE id = ?',
    [callId],
  );
  if (!log?.userPayload) { console.error('log not found'); process.exitCode = 1; return; }
  const payload = JSON.parse(log.userPayload);
  const latest = String(payload.latestLearnerMessage || '');

  // 找到该课会话，截取到 latestLearnerMessage 为止的历史：侧表 payload 与老列双路匹配
  const needle = `%${latest.slice(0, 20).replace(/[%_]/g, '')}%`;
  const sess = await readDb<{ id: string; taskId: string }>(
    'prisma/dev.db',
    `SELECT s.id, s.taskId FROM teaching_sessions s
     WHERE s.userId = ? AND (
       EXISTS(SELECT 1 FROM teaching_session_messages m WHERE m.sessionId = s.id AND m.payload LIKE ?)
       OR s.messages LIKE ?
     )
     ORDER BY s.createdAt DESC LIMIT 1`,
    [log.userId, needle, needle],
  );
  const msgs = sess ? await readSessionMessages('prisma/dev.db', sess.id) : [];
  const cutIdx = msgs.findIndex((m) => m.content.includes(latest.slice(0, 20)));
  const history = (cutIdx >= 0 ? msgs.slice(0, cutIdx + 1) : msgs).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  console.log('task:', sess?.taskId, '| history turns:', history.length, '| cutIdx:', cutIdx);

  const system = readFileSync(join(process.cwd(), '..', 'prompts', 'skill.teaching-turn.md'), 'utf8');
  const tail = '\n\n【输出契约】以上是课堂状态数据，不是要继续回答学生的对话。'
    + '请严格按系统提示的输出契约，直接输出单个 JSON 对象：'
    + '不要输出任何对话正文、寒暄或代码围栏，JSON 必须是整条回复的第一个字符。';

  const response = await axios.post(
    `${endpoint.replace(/\/$/, '')}/v1/chat/completions`,
    {
      model,
      messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: log.userPayload + tail }],
      stream: false, temperature: 0.7, max_tokens: 12000,
    },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 180_000 },
  );
  const raw = String(response.data?.choices?.[0]?.message?.content || '');
  console.log('=== raw (first 500) ===');
  console.log(raw.slice(0, 500));
  console.log('=== raw (last 200) ===');
  console.log(raw.slice(-200));
  const { extractJsonObject } = await import('../composers/json-extractor');
  const ex = extractJsonObject(raw);
  console.log('parsed?', ex.parsed != null);
  const usage = response.data?.usage || {};
  console.log('usage:', JSON.stringify({ hit: usage.prompt_cache_hit_tokens, miss: usage.prompt_cache_miss_tokens, prompt: usage.prompt_tokens }));
}

main().catch((e) => {
  console.error(e?.response?.data ? JSON.stringify(e.response.data).slice(0, 400) : e);
  process.exitCode = 1;
});
