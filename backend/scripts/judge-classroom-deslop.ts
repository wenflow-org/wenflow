/**
 * judge-classroom-deslop.ts —— 课堂「死板」的**语义**判定器（真机模型，2026-11-07）。
 *
 * 为什么要有它：课堂里「这道题是在考刚讲过的原话（复述），还是让学生把刚学的口径用到新情形（迁移）」
 * 是**语义判断**。用词面重合度去猜会两头错（复述可能换个说法、迁移可能复用同一批名词）。
 * 按本仓已确立的原则（见 qa-reports/2026-11-07-teaching-strategy/判据设计原则.md）：
 * 语义判据交给模型，代码只负责把材料摊平、把结论结构化。
 *
 * 用法：
 *   npx ts-node --transpile-only scripts/judge-classroom-deslop.ts <outputs/e2e-longcourse-XXX/result.json>
 *
 * 输入：`scripts/test-live/teaching-longcourse-e2e.mjs` 落盘的 result.json。
 * 输出：同目录 `judge.json`（每个检查点的判定 + 定性结论），并回显到标准输出。
 *
 * 说明：本脚本放在 backend/scripts 下（不在 src 内），因此不在 `llm:calls:check` 的扫描范围里；
 * 调用形态照抄既有的真机探针 scripts/test-live/llm-contract-smoke.ts。
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { getAPIGateway } from '../src/gateway/api-gateway';

interface TurnRecord {
  body?: { message?: string };
  aiResponse?: string;
  checkpoint?: { question?: string; options?: Array<{ id?: string; text?: string }> } | null;
}

interface SessionRecord {
  sessionId?: string;
  turns?: TurnRecord[];
}

const JUDGE_SYSTEM_PROMPT = [
  '你是教学课堂的外部评审。你只依据给出的逐轮记录判断，不脑补记录里没有的内容。',
  '你要判的三件事：',
  '1) 每一个「卡片」（理解检查）是**复述题**还是**迁移题**：',
  '   - 复述 = 正确项所对应的那句材料/那个对象，老师在**同一轮或紧邻的上一轮**已经直接给出过结论（学生只需回忆刚听过的标签）；',
  '   - 迁移 = 学生需要用刚学到的判断口径，去判一个**还没被贴过标签的新情形**（换材料/换对象/换情境，或给反例）；',
  '   - 无关 = 卡片与当前教学点无关，或题干信息不足无法判断。',
  '   判定时必须引用「老师上一轮/本轮说了什么」作为依据。',
  '2) 同一节课里「同一个问法（同构动作）」连续重复的最长次数（例如连续几轮都是「这条属于哪一类？」）。',
  '3) 开场消息是否把任务里给定的清单/样本**摊开写出来**（记录里没给清单就写「不适用」）。',
  '严格只输出一个 JSON 对象，不要解释文字、不要代码围栏。字段：',
  '{"checkpoints":[{"turn":1,"kind":"复述|迁移|无关","why":"一句话依据"}],"sameMoldStreak":0,',
  ' "openingListedGivenMaterials":"是|否|不适用","verdict":"两三句话结论，指出最该改的一处"}',
].join('\n');

function buildTranscript(session: SessionRecord): string {
  const lines: string[] = [];
  const turns = Array.isArray(session.turns) ? session.turns : [];
  turns.forEach((turn, index) => {
    lines.push(`--- 回合 ${index + 1} ---`);
    lines.push(`学生：${String(turn.body?.message || '').slice(0, 500)}`);
    lines.push(`老师：${String(turn.aiResponse || '').slice(0, 2000)}`);
    const question = String(turn.checkpoint?.question || '');
    if (question) {
      lines.push(`【卡片】${question.slice(0, 500)}`);
      const options = Array.isArray(turn.checkpoint?.options) ? turn.checkpoint?.options : [];
      if (options.length) {
        lines.push(`【选项】${options.map((o) => `${o?.id}. ${String(o?.text || '').slice(0, 200)}`).join(' / ')}`);
      }
    }
  });
  return lines.join('\n');
}

function parseJudgeJson(raw: string): unknown {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('JUDGE_OUTPUT_NOT_JSON');
  return JSON.parse(body.slice(start, end + 1));
}

async function judgeSession(session: SessionRecord, order: number): Promise<unknown> {
  const transcript = buildTranscript(session);
  const response = await getAPIGateway().execute(
    {
      temperature: 0,
      max_tokens: 1600,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: `第 ${order} 节课的逐轮记录：\n\n${transcript}` },
      ],
    } as never,
    { skillId: 'qa-classroom-judge', action: 'judge' } as never,
    { requestPath: 'qa/classroom-deslop-judge' } as never,
  );
  const content = String(response?.choices?.[0]?.message?.content || '');
  return parseJudgeJson(content);
}

async function main() {
  const target = process.argv[2];
  if (!target || !fs.existsSync(target)) {
    console.error('用法: npx ts-node --transpile-only scripts/judge-classroom-deslop.ts <outputs/e2e-longcourse-XXX/result.json>');
    process.exitCode = 1;
    return;
  }
  const result = JSON.parse(fs.readFileSync(target, 'utf8')) as { sessions?: SessionRecord[] };
  const sessions = Array.isArray(result.sessions) ? result.sessions : [];
  const judged: Array<{ order: number; session: string | undefined; judge: unknown }> = [];
  for (let i = 0; i < sessions.length; i += 1) {
    const judge = await judgeSession(sessions[i], i + 1);
    judged.push({ order: i + 1, session: sessions[i].sessionId, judge });
    console.log(`\n=== 第 ${i + 1} 节课 ===`);
    console.log(JSON.stringify(judge, null, 1));
  }
  const outPath = path.join(path.dirname(target), 'judge.json');
  fs.writeFileSync(outPath, `${JSON.stringify({ source: target, sessions: judged }, null, 1)}\n`, 'utf8');
  console.log(`\n判定已写出：${outPath}`);
}

main().catch((error) => {
  console.error('JUDGE_ERROR', error?.message || error);
  process.exitCode = 1;
});
