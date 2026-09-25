/* eslint-disable no-console -- 一次性诊断 CLI */
/**
 * 「模型级重放」：两张真实配图当时的 teaching-turn userPayload + **新发布的 ACTIVE system prompt**
 * → 模型是否仍输出 visual。审计的两个问题各对一案：
 *   A. 面粉轮（原 payload 自带 visualOpportunity + 本轮布置了"你来排位置"练习）→ 期望：**不发** visual（防答案泄漏生效）
 *   B. 骨架抄写轮（原 payload 无信号，模型自发请求）→ 期望：**不发** visual（文字容器负例生效）
 * 用法：npx ts-node --transpile-only src/scripts/probe-teaching-visual-replay-calls.ts
 */
import 'dotenv/config';
import axios from 'axios';
import sqlite3 from 'sqlite3';

const CALLS = [
  { tag: 'A-面粉轮(带S1信号+布置练习)', logId: 'pcl_df5cc7fe-43df-4c', refreshNudge: true },
  { tag: 'B-骨架抄写轮(自发请求)', logId: 'pcl_a5bc350e-62a9-46', refreshNudge: false },
];

/** 旧版 S1 指令（历史 payload 里固化的文本）→ 现行代码会注入的新指令（防答案泄漏版） */
const OLD_NUDGE =
  '上一轮你用了箭头/方框/字符在 reply 里"画"结构——那说明这里本来就需要一张图。'
  + '本轮请改为输出顶层块 visual：在 prompt 里把这张图画清楚（主体与关系），caption 写一句给学生看的说明；'
  + 'reply 里不必再用字符画结构。';
const NEW_NUDGE =
  '上一轮你用了箭头/方框/字符在 reply 里"画"结构——那说明这里本来就需要一张图。'
  + '**先判断**：若本轮正要布置「由学习者自己排出/画出这个结构」的练习（答案泄漏，2026-09-24 实测），'
  + '则本轮**不要**输出 visual，直接布置练习，把图留到学生完成后的下一轮总结印证时再用；'
  + '否则本轮请改为输出顶层块 visual：在 prompt 里把这张图画清楚（主体与抽象关系，画面里不出现文字），'
  + 'caption 写一句给学生看的说明；reply 里不必再用字符画结构。';

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
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 180_000 },
  );
  return String(response.data?.choices?.[0]?.message?.content || '');
}

async function main(): Promise<void> {
  const endpoint = (process.env.AI_API_URL || '').trim();
  const apiKey = (process.env.AI_API_KEY || '').trim();
  const model = (process.env.AI_MODEL || '').trim();
  if (!endpoint || !apiKey || !model) {
    console.error('缺 AI_API_URL / AI_API_KEY / AI_MODEL');
    process.exitCode = 1;
    return;
  }

  const systemRow = await readDb<{ systemPrompt: string; coreVersion: number }>(
    'prisma/system.db',
    "SELECT systemPrompt, coreVersion FROM agent_prompts WHERE agentId='skill:teaching-turn' AND status='ACTIVE' LIMIT 1",
  );
  const system = String(systemRow?.systemPrompt || '');
  console.log(`ACTIVE coreVersion=${systemRow?.coreVersion}｜含「文字容器」=${system.includes('文字容器')}｜含「答案泄漏」=${system.includes('答案泄漏')}｜含「不要要求画面里出现文字标注」=${system.includes('不要要求画面里出现文字标注')}`);

  for (const c of CALLS) {
    const row = await readDb<{ userPayload: string }>(
      'prisma/dev.db',
      "SELECT userPayload FROM prompt_call_logs WHERE id LIKE ? || '%' AND agentId='skill:teaching-turn'",
      [c.logId],
    );
    const user0 = String(row?.userPayload || '');
    if (!user0) {
      console.log(`\n===== ${c.tag} ===== 找不到日志 ${c.logId}`);
      continue;
    }
    let user = user0;
    if (c.refreshNudge) {
      // payload 是二次序列化 JSON（内层引号形如 \"画\"），旧指令文本无法逐字匹配——按首尾锚点整段替换
      const nudgeRe = /上一轮你用了箭头[\s\S]*?reply 里不必再用字符画结构。/;
      if (nudgeRe.test(user0)) user = user0.replace(nudgeRe, NEW_NUDGE);
      else console.log('  （注意：payload 里未定位到旧版指令段，按原样重放）');
    }
    process.stdout.write(`\n===== ${c.tag} ===== payload ${user.length} 字，生成中…\n`);
    const raw = await ask(endpoint, apiKey, model, system, user);
    const hasVisual = /"visual"\s*:/.test(raw);
    console.log(`  含 "visual" = ${hasVisual}｜输出长度 ${raw.length}`);
    if (hasVisual) {
      const idx = raw.indexOf('"visual"');
      console.log(`  visual 片段：${raw.slice(idx, idx + 300).replace(/\s+/g, ' ')}`);
    } else {
      const replyIdx = raw.indexOf('"reply"');
      console.log(`  reply 片段：${raw.slice(replyIdx, replyIdx + 200).replace(/\s+/g, ' ')}`);
    }
  }
}

void main().catch((error) => {
  console.error('失败', error);
  process.exitCode = 1;
});
