/* eslint-disable no-console -- 一次性诊断 CLI */
/**
 * 「模型到底能不能输出 visual」——**隔离测试**（绕开我们的整条管线）。
 *
 * 做法：直接打上游 OpenAI 兼容端点，用**真实的** system prompt（DB ACTIVE 的 teaching-turn）
 * + **真实的** userPayload（`prompt_call_logs` 里最近一次 teaching-turn 的输入），
 * 看模型原始输出里有没有 `visual`。三个变体对照：
 *   ① 原样（复现线上）
 *   ② 末尾追加「本轮请配一张图」
 *   ③ 末尾追加「如果你本来会用字符/箭头画结构，请改成 visual」
 *
 * 用途：区分「模型不会输出该字段」 vs 「模型不主动」 vs 「我们的管线把它吃掉了」。
 */
import 'dotenv/config';
import axios from 'axios';
import sqlite3 from 'sqlite3';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function readDb<T>(dbPath: string, sql: string, params: unknown[] = []): Promise<T | null> {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    db.get(sql, params, (error: Error | null, row: T) => {
      db.close();
      resolve(error ? null : row || null);
    });
  });
}

async function ask(endpoint: string, apiKey: string, model: string, system: string, user: string): Promise<string> {
  const response = await axios.post(
    `${endpoint.replace(/\/$/, '')}/v1/chat/completions`,
    { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: false, temperature: 0.3 },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 120_000 },
  );
  return String(response.data?.choices?.[0]?.message?.content || '');
}

async function main(): Promise<void> {
  const endpoint = (process.env.AI_API_URL || '').trim();
  const apiKey = (process.env.AI_API_KEY || '').trim();
  const model = arg('model') || (process.env.AI_MODEL || '').trim();
  if (!endpoint || !apiKey) {
    console.error('缺 AI_API_URL / AI_API_KEY');
    process.exitCode = 1;
    return;
  }

  const systemRow = await readDb<{ systemPrompt: string }>(
    'prisma/system.db',
    "SELECT systemPrompt FROM agent_prompts WHERE agentId='skill:teaching-turn' AND status='ACTIVE' LIMIT 1",
  );
  const system = String(systemRow?.systemPrompt || '');
  if (!system) {
    console.error('拿不到 teaching-turn 的 ACTIVE system prompt');
    process.exitCode = 1;
    return;
  }

  const callRow = await readDb<{ userPayload: string; pathId: string | null }>(
    'prisma/dev.db',
    "SELECT userPayload, pathId FROM prompt_call_logs WHERE agentId='skill:teaching-turn' AND success=1 ORDER BY createdAt DESC LIMIT 1",
  );
  const baseUser = String(callRow?.userPayload || '');
  if (!baseUser) {
    console.error('拿不到 teaching-turn 的 userPayload');
    process.exitCode = 1;
    return;
  }
  console.log(`systemPrompt ${system.length} 字｜userPayload ${baseUser.length} 字｜model=${model}`);
  console.log(`system 含「配图」=${system.includes('配图')}｜含「fields.visual」=${system.includes('fields.visual')}｜含「字符画」=${system.includes('字符画')}`);

  const variants: Array<[string, string]> = [
    ['① 原样（复现线上）', baseUser],
    ['② 追加「本轮请配一张图」', `${baseUser}\n\n【本轮补充要求】这一轮请给出一张教学配图：在输出里加上顶层块 visual（含 prompt 与 caption）。`],
    ['③ 追加「别用字符画，改成 visual」', `${baseUser}\n\n【本轮补充要求】如果你本来准备用箭头/方框/字符在 reply 里画结构，请**不要**那样做，改成输出顶层块 visual。`],
  ];

  for (const [label, user] of variants) {
    try {
      const raw = await ask(endpoint, apiKey, model, system, user);
      const hasVisual = /"visual"\s*:/.test(raw);
      const topKeys = (raw.match(/"[a-zA-Z_]+"\s*:/g) || []).slice(0, 10).join(', ');
      console.log(`\n===== ${label} =====`);
      console.log(`  含 "visual" = ${hasVisual}｜输出长度 ${raw.length}`);
      console.log(`  顶层键（前 10）：${topKeys}`);
      if (hasVisual) {
        const idx = raw.indexOf('"visual"');
        console.log(`  visual 片段：${raw.slice(idx, idx + 320).replace(/\n/g, ' ')}`);
      }
    } catch (error) {
      console.log(`\n===== ${label} ===== 调用失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

void main().catch((error) => {
  console.error('失败', error);
  process.exitCode = 1;
});
