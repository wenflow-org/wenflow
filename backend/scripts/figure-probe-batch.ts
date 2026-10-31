/**
 * 广度探针：把「这一轮该不该出图、出哪种图」交给真实 teaching-turn 提示词，
 * 再用线上同一条归一化路径验收，输出可统计的 JSON。
 *
 * 用法：npx ts-node --transpile-only scripts/figure-probe-batch.ts <cases.json> <out.json> [attempts]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { callPrompt, type PromptCallSpec } from '../src/composers/prompt-composer';
import { buildVisualOpportunity } from '../src/services/ai-teaching/teaching-visual.service';
import { normalizeTeachingFigureForProbe } from '../src/skills/teaching-turn';

const [casesPath, outPath, attemptsRaw] = process.argv.slice(2);
if (!casesPath || !outPath) throw new Error('用法: figure-probe-batch <cases.json> <out.json> [attempts]');
const attempts = Math.max(1, Number(attemptsRaw) || 2);

const md = readFileSync(require('node:path').join(__dirname, '..', '..', 'prompts', 'skill.teaching-turn.md'), 'utf8');
const systemPrompt = md.replace(/^---[\s\S]*?---\s*/, '');
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));

const spec: PromptCallSpec<any, any> = {
  agentId: 'figure-probe-batch',
  defaultSystemPrompt: systemPrompt,
  requireActivePrompt: false,
  caller: { skillId: 'figure-probe-batch', action: 'probe' },
  buildUserPayload: (input: any) => input,
  parseRawOutput: (raw: string) => {
    const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    try {
      return { parsed: JSON.parse(json), extractedJson: json };
    } catch {
      return { parsed: null, extractedJson: null, failureReason: 'not json' };
    }
  },
  validateParsedOutput: (p: any) => ({ valid: !!p && typeof p === 'object' }),
  normalizeOutput: (p: any) => p,
};

async function askOnce(c: any) {
  const history = [{ role: 'assistant', content: c.assistant, timestamp: '2026-10-23T00:00:00.000Z' }];
  const opp = buildVisualOpportunity(history as any, c.taskTitle);
  const payload = {
    task: {
      title: c.taskTitle,
      description: c.taskDescription,
      taskType: 'explain',
      acceptanceCriteria: c.acceptance,
    },
    scenario: { subject: c.subject, topic: c.topic, learnerLevel: 'beginner' },
    knowledge: { currentPoint: c.topic },
    messages: [{ role: 'user', content: c.student }],
    visualOpportunity: opp,
    instruction: opp?.instruction,
  };
  const res: any = await callPrompt(spec, payload as any, {
    generationOverride: { model: 'deepseek-v4.1-flash', temperature: 0 },
  } as any);
  return (res?.output ?? res?.value?.output ?? {}) as any;
}

(async () => {
  const results: any[] = [];
  for (const c of cases) {
    let chosen: any = null;
    let rawFigure: any = null;
    let lastReply = '';
    for (let i = 0; i < attempts && !rawFigure; i += 1) {
      const out = await askOnce(c);
      lastReply = String(out?.reply || '');
      if (out?.figure) {
        chosen = out;
        rawFigure = out.figure;
      }
      console.log(`[${c.id}] 第 ${i + 1} 次 → ${rawFigure ? rawFigure.kind : '无图'}`);
    }
    const norm = rawFigure ? normalizeTeachingFigureForProbe(rawFigure) : { figure: null, reason: 'model-emitted-none' };
    results.push({
      id: c.id,
      subject: c.subject,
      topic: c.topic,
      taskTitle: c.taskTitle,
      student: c.student,
      expectKind: c.expectKind,
      emitted: !!rawFigure,
      rawKind: rawFigure?.kind ?? null,
      normalized: !!norm.figure,
      finalKind: norm.figure?.kind ?? null,
      reason: norm.reason,
      spec: (norm.figure as any)?.spec ?? rawFigure?.spec ?? null,
      reply: lastReply.slice(0, 800),
    });
  }
  writeFileSync(outPath, JSON.stringify(results, null, 1), 'utf8');
  const emitted = results.filter((r) => r.emitted).length;
  const usable = results.filter((r) => r.normalized).length;
  const right = results.filter((r) => {
    if (r.expectKind === 'none') return !r.normalized;
    return r.finalKind === r.expectKind;
  }).length;
  console.log(`\n合计 ${results.length} 例：出图 ${emitted}，通过归一化 ${usable}，图型符合预期 ${right}`);
  for (const r of results) {
    console.log(`  ${r.id.padEnd(24)} 期望 ${String(r.expectKind).padEnd(15)} 实际 ${String(r.finalKind ?? '—').padEnd(15)} ${r.reason}`);
  }
})();
