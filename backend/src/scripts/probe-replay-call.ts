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

  // 找到该课会话，截取到 latestLearnerMessage 为止的历史
  const sess = await readDb<{ messages: string; taskId: string }>(
    'prisma/dev.db',
    "SELECT messages, taskId FROM teaching_sessions WHERE userId = ? AND messages LIKE ? ORDER BY createdAt DESC LIMIT 1",
    [log.userId, `%${latest.slice(0, 20).replace(/[%_]/g, '')}%`],
  );
  const msgs = JSON.parse(sess?.messages || '[]') as Array<{ role: string; content: string }>;
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
