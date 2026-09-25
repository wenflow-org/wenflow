/* eslint-disable no-console -- 一次性诊断 CLI */
/**
 * 复现「历史外移为 message 后首 attempt 抽取失败」：取真实 payload + 真实历史，
 * 按新形态 [S, ...history, U(payload)] 发一次，打印原始输出与解析结果。
 * 用法：npx ts-node --transpile-only src/scripts/probe-history-as-messages.ts
 */
import 'dotenv/config';
import axios from 'axios';
import sqlite3 from 'sqlite3';

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
  const endpoint = (process.env.AI_API_URL || '').trim();
  const apiKey = (process.env.AI_API_KEY || '').trim();
  const model = (process.env.AI_MODEL || '').trim();

  // 最近一次 teaching-turn 调用（新形态课的）
  const log = await readDb<{ id: string; userPayload: string; systemPromptHash: string }>(
    'prisma/dev.db',
    `SELECT id, userPayload FROM prompt_call_logs WHERE agentId='skill:teaching-turn' ORDER BY createdAt DESC LIMIT 1`,
  );
  if (!log) { console.error('no log'); process.exitCode = 1; return; }
  const payload = log.userPayload as string;

  // 该课的会话消息（真实历史）
  const sess = await readDb<{ messages: string }>(
    'prisma/dev.db',
    `SELECT messages FROM teaching_sessions WHERE json_extract(messages,'$') IS NOT NULL ORDER BY createdAt DESC LIMIT 1`,
  );
  const msgs = JSON.parse(sess?.messages || '[]') as Array<{ role: string; content: string }>;
  const history = msgs.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const system = await readSystemPrompt();

  console.log('history turns:', history.length, '| payload chars:', payload.length);
  const response = await axios.post(
    `${endpoint.replace(/\/$/, '')}/v1/chat/completions`,
    {
      model,
      messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: payload }],
      stream: false, temperature: 0.7, max_tokens: 12000,
    },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 180_000 },
  );
  const raw = String(response.data?.choices?.[0]?.message?.content || '');
  console.log('=== raw head ===');
  console.log(JSON.stringify(raw.slice(0, 400)));
  console.log('=== raw tail ===');
  console.log(JSON.stringify(raw.slice(-200)));
  const { extractJsonObject } = await import('../composers/json-extractor');
  const extracted = extractJsonObject(raw);
  console.log('parsed?', extracted.parsed != null, '| extractedJson head:', JSON.stringify((extracted.extractedJson || '').slice(0, 80)));
  const p = extracted.parsed;
  if (p) console.log('keys:', Object.keys(p).join(','));
}

async function readSystemPrompt(): Promise<string> {
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  return readFileSync(join(process.cwd(), '..', 'prompts', 'skill.teaching-turn.md'), 'utf8');
}

main().catch((e) => {
  console.error(e?.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e);
  process.exitCode = 1;
});
