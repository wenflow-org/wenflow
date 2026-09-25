/* eslint-disable no-console -- 一次性诊断 CLI */
/**
 * 前缀缓存语义受控实验（回答"为什么 teaching-turn 只有 ~1K token 命中"）：
 * 用真实体量的 system prompt + 真实 userPayload，按课堂真实形态发 5 枪：
 *   C1 [S,U1]                冷启动
 *   C2 [S,U1]                完全相同重发 → 验证"精确重复是否命中"
 *   C3 [S,A1,U2]             下一回合形态（system 相同，尾部变）→ 验证前缀延续
 *   C4 [S,A1,U2]             与 C3 完全相同重发
 *   C5 [S,A1,A2,U3]          再长一截 → 验证命中是否随前缀变长而增长
 * 每枪打印 usage 全字段（prompt_cache_hit_tokens / miss / prompt_tokens）。
 * 用法：npx ts-node --transpile-only src/scripts/probe-prefix-cache-semantics.ts
 */
import 'dotenv/config';
import axios from 'axios';
import { readFileSync } from 'fs';
import { join } from 'path';

interface Shot {
  tag: string;
  purpose: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
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

  // 真实 system prompt（编译产物，v48 同源； prompts/ 在仓库根）
  const system = readFileSync(join(process.cwd(), '..', 'prompts', 'skill.teaching-turn.md'), 'utf8');

  // 构造体量接近真实的载荷：~10K 字符 userPayload + 助手历史
  const scenario = JSON.stringify({
    scenario: {
      subject: '阳台园土翻盆养花苗到采收',
      topic: '辨认园土掺沙浇水后的真实表现：为什么它同时会积水又会干硬',
      taskTitle: '辨认园土掺沙浇水后的真实表现：为什么它同时会积水又会干硬',
      taskDescription: '围绕主茎与侧枝在叶腋分叉的空间识别'.repeat(20),
      taskProfile: { knowledgeType: 'conceptual', cognitiveLevel: 'understand' },
    },
  }, null, 1);
  const u1 = `${scenario}\n\n【本节知识点】辨认园土板结的浇水表现\n【学习者】上班族，阳台两盆小番茄一盆烂根一盆干枯。\n【学生本轮】我先上盆浇水试排水`;
  const u2 = `${scenario}\n\n【本节知识点】辨认园土板结的浇水表现\n【学习者】上班族。\n【学生本轮】盆底十几秒就出细线，托盘当天有水。`;
  const u3 = `${scenario}\n\n【本节知识点】区分进水难与排水难两种机制\n【学生本轮】我想是缝通不通的差别。`;
  const a1 = '对，这一根你判断得准。你能说出「从叶腋拐出去、和主茎分成两叉」——这就是侧枝的定义，不是靠位置猜的。'.repeat(3);
  const a2 = '你把依据落到「连续性」上了——叶子那片片绕着长、中间没有被分叉打断的那条，就是主茎。'.repeat(3);
  // C6/C7：同一段公共头 + 不同尾部（模拟 payload 里历史追加、当轮数据变化）
  const tailA = '\n\n【对话历史】\n学生：我先上盆浇水试排水\n教师：上盆浇水试排水，这个顺序对。';
  const tailB = '\n\n【对话历史】\n学生：我先上盆浇水试排水\n教师：上盆浇水试排水，这个顺序对。\n学生：盆底十几秒就出细线。';
  // D 组：历史外移为真 message，最终 message 只放逐回合状态（类比新 payload 形态）
  const p1 = '【学习者】上班族，阳台两盆小番茄一盆烂根一盆干枯。\n【学生本轮】我先上盆浇水试排水';
  const p2 = '【学习者】上班族。\n【学生本轮】盆底十几秒就出细线，托盘当天有水。';
  const p3 = '【学生本轮】我想是缝通不通的差别。';

  const shots: Shot[] = [
    { tag: 'C1 冷启动 [S,U1]', purpose: '基线：无缓存', messages: [{ role: 'system', content: system }, { role: 'user', content: u1 }] },
    { tag: 'C2 完全相同重发 [S,U1]', purpose: '精确重复是否命中', messages: [{ role: 'system', content: system }, { role: 'user', content: u1 }] },
    { tag: 'C3 下一回合 [S,A1,U2]', purpose: '前缀延续（尾部变）', messages: [{ role: 'system', content: system }, { role: 'assistant', content: a1 }, { role: 'user', content: u2 }] },
    { tag: 'C4 与C3相同重发', purpose: '精确重复（长前缀）', messages: [{ role: 'system', content: system }, { role: 'assistant', content: a1 }, { role: 'user', content: u2 }] },
    { tag: 'C5 再长一截 [S,A1,A2,U3]', purpose: '更长前缀的延续', messages: [{ role: 'system', content: system }, { role: 'assistant', content: a1 }, { role: 'assistant', content: a2 }, { role: 'user', content: u3 }] },
    { tag: 'C6 同前缀异尾 [S,U1+尾A]', purpose: '课堂形态：payload 头同尾异', messages: [{ role: 'system', content: system }, { role: 'user', content: u1 + tailA }] },
    { tag: 'C7 同前缀异尾 [S,U1+尾B]', purpose: '接 C6：只换尾', messages: [{ role: 'system', content: system }, { role: 'user', content: u1 + tailB }] },
    { tag: 'D1 历史外移 cold', purpose: '解法形态：[S,U] 小载荷', messages: [{ role: 'system', content: system }, { role: 'user', content: p1 }] },
    { tag: 'D2 历史外移 回合2', purpose: '解法形态：+A1,U2', messages: [{ role: 'system', content: system }, { role: 'user', content: p1 }, { role: 'assistant', content: a1 }, { role: 'user', content: p2 }] },
    { tag: 'D3 历史外移 回合3', purpose: '解法形态：+A2,U3', messages: [{ role: 'system', content: system }, { role: 'user', content: p1 }, { role: 'assistant', content: a1 }, { role: 'user', content: p2 }, { role: 'assistant', content: a2 }, { role: 'user', content: p3 }] },
  ];

  console.log(`endpoint=${endpoint} model=${model}`);
  console.log(`system chars=${system.length}`);
  for (const shot of shots) {
    const started = Date.now();
    try {
      const response = await axios.post(
        `${endpoint.replace(/\/$/, '')}/v1/chat/completions`,
        { model, messages: shot.messages, stream: false, temperature: 0.3, max_tokens: 256 },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 180_000 },
      );
      const usage = response.data?.usage || {};
      const hit = Number(usage.prompt_cache_hit_tokens ?? 0);
      const miss = Number(usage.prompt_cache_miss_tokens ?? 0);
      const prompt = Number(usage.prompt_tokens ?? 0);
      const total = hit + miss;
      console.log(
        `${shot.tag.padEnd(26)} ${shot.purpose.padEnd(22)} `
        + `prompt=${String(prompt).padEnd(7)} hit=${String(hit).padEnd(7)} miss=${String(miss).padEnd(7)} `
        + `hitRate=${total > 0 ? ((hit / total) * 100).toFixed(1) + '%' : '-'} `
        + `cost=${Date.now() - started}ms`,
      );
      if (Object.keys(usage).length) console.log('  usage fields:', JSON.stringify(usage));
    } catch (error: any) {
      console.log(`${shot.tag} FAILED: ${error?.response?.data ? JSON.stringify(error.response.data).slice(0, 200) : error.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
