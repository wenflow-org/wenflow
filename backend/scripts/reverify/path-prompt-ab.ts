/**
 * 路径生成 prompt 规则 A/B（#62 考纲模板 / #63 域适配 / #66 去模板）
 *
 * 设计：同一 payload、同一模型，A 臂 = 当前编译产物，B 臂 = 当前产物 + 候选规则。
 * 判据全部确定性（不请 LLM 当裁判），跑完输出 summary + 明细。
 *
 * 用法（provider 可用时）：
 *   cd backend
 *   npx ts-node --transpile-only scripts/reverify/path-prompt-ab.ts --case=66 --n=4
 *   npx ts-node --transpile-only scripts/reverify/path-prompt-ab.ts --case=62 --n=4
 *   npx ts-node --transpile-only scripts/reverify/path-prompt-ab.ts --case=63 --n=4
 *
 * 注意：B 臂通过「追加规则文本」模拟 core.yaml 的规则新增；A/B 结论通过后才把规则写进
 * prompts/core/path-planning.yaml 并 compile（用户要求：prompt 修复必须做 A/B）。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name: string, fallback: string) =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').split('=')[1] || fallback;
const CASE = arg('case', '66') as '62' | '63' | '66';
const N = Number(arg('n', '4'));

const envText = fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
const envGet = (key: string) => (envText.match(new RegExp('^' + key + '=(.*)$', 'm')) || [])[1]?.trim() || '';
// --base/--key/--model 允许临时借用可用通道；两臂仍走同一通道同一模型，A/B 可比
const AI_URL = (arg('base', '') || envGet('AI_API_URL')).replace(/\/+$/, '');
const AI_KEY = arg('key', '') || envGet('AI_API_KEY');
const AI_MODEL = arg('model', '') || envGet('AI_MODEL') || 'deepseek-v4.1-flash';

const BASE_PROMPT = fs.readFileSync(path.resolve(__dirname, '../../../prompts/skill.path-planning.md'), 'utf8');

interface CaseSpec {
  label: string;
  /** 被测 prompt 编译产物；缺省为 path-planning */
  promptFile?: string;
  rules: string[];
  payload: string;
  /** 返回判据对象（数值越小越好或按 isBetter 判定） */
  score: (parsed: any) => Record<string, number>;
  isBetter: (arm: Record<string, number>, base: Record<string, number>) => boolean;
}

const DIAG_RE = /摸底|诊断|测评|盘点|自评定位/;

const CASES: Record<'62' | '63' | '66', CaseSpec> = {
  66: {
    label: '诊断类阶段去重 + 兴趣档阶段数上限',
    rules: [
      '诊断类阶段去重：整条路径最多 1 个「摸底/诊断/测评/盘点/自评定位」阶段；后续阶段的评估必须嵌进该阶段的任务里，不得单列第二个诊断阶段。',
      '兴趣/探索型目标（没有外部截止、没有考试/交付期限、以了解或做出点什么为主）的阶段数上限：milestone 最多 5 个；需要更多内容时合并相邻阶段，不要拆细。',
    ],
    payload: `原始学习目标：想系统了解 AI 产品设计，纯兴趣，没有考试也没有交付期限
学习主题：AI 产品设计
目标水平：beginner
具体应用场景：日常和朋友讨论 AI 产品时能有自己的判断，也能试着写一份产品设想
学习重点：理解产品设计的基本判断，能提出自己的设想
可用时间：每周 8 小时
总学习周期（周）：12
用户确认的方案轮廓：{"learningDirection":"从产品判断到一份小设想","firstDeliverable":"一份 3 页的产品设想","keyStages":["理解用户与场景","形成产品判断","写出设想"]}
【强制要求】只输出 JSON，字段含 name、summary、milestones（每个含 title、description、goal、estimatedHours）。`,
    score: (parsed) => {
      const milestones = Array.isArray(parsed?.milestones) ? parsed.milestones : [];
      return {
        stageCount: milestones.length,
        diagnosticStages: milestones.filter((m: any) => DIAG_RE.test(`${m?.title || ''}${m?.goal || ''}`)).length,
        overCap: milestones.length > 5 ? 1 : 0,
      };
    },
    isBetter: (arm, base) =>
      arm.diagnosticStages <= 1 && arm.diagnosticStages < base.diagnosticStages
        ? true
        : arm.overCap < base.overCap && arm.stageCount >= 2,
  },
  62: {
    label: '应试阶段任务层：真题/题型任务 + 末阶段限时整卷模考',
    promptFile: 'prompts/skill.stage-designer.md',
    rules: [
      '应试类阶段（milestone/goal/normalizedInput 指向考试、考纲、真题）的任务必须包含应试形态：① 至少 1 个任务直接做**真题或按题型分类的练习**（写清题型与作答动作，不是只整理概念）；② 若 pathStageMap.currentStageNumber === pathStageMap.stageCount（末阶段），必须有 1 个**限时整卷/成套模考**任务，并在同阶段安排**错因回收**（按题型与知识点归类错题，写出下一次的修订动作）。纯框架整理/概念复述不算题型能力。',
    ],
    payload: `你是阶段任务设计师，只为当前 milestone 生成 subtasks。
milestone: {"title":"完成汇算清缴综合调整与申报表填报校验","description":"把收入端与扣除端的调整框架合到一张申报表上，能独立完成一套综合计算并自查勾稽。","goal":"拿到一套综合案例能在限时内完成调整、填表与勾稽校验","coreConcept":"收入端与扣除端调整在申报表行次上的合并与勾稽","estimatedHours":6}
cognitiveCore: {"coreConcepts":[{"id":"concept-1","name":"收入端与扣除端调整的合并顺序","role":"hub"},{"id":"concept-2","name":"申报表行次映射与勾稽关系","role":"supporting"},{"id":"concept-3","name":"调整方向反了与行次串了的区分","role":"supporting"}],"loadProfile":{"loadTarget":"medium"}}
normalizedInput: {"rawGoal":"4 个月后参加税务师税法考试，目标是过线","realProblem":"综合题一上强度就乱，收入和扣除分开会做，合起来就串行次","timeBudget":"每周 8 小时","learnerProfile":{"currentBaseline":"beginner"}}
previousMilestone: {"title":"建立扣除端纳税调整的判断框架","coreConcept":"据实扣除、限额扣除与不得扣除的边界"}
pathStageMap: {"stageCount":4,"currentStageNumber":4,"stages":[{"stageNumber":1,"title":"识别税法口径与会计口径的差异起点","estimatedHours":5},{"stageNumber":2,"title":"建立收入端纳税调整的判断框架","estimatedHours":6},{"stageNumber":3,"title":"建立扣除端纳税调整的判断框架","estimatedHours":6},{"stageNumber":4,"title":"完成汇算清缴综合调整与申报表填报校验","estimatedHours":6}]}
planningHints: {"targetSubtasksForStage":5,"subtasksPerStageRange":[3,5],"subtaskMinutesRange":[30,90]}
【强制要求】只输出 JSON：{"subtasks":[{"title":"","description":"","type":"acquire|deconstruct|model|execute|diagnose|refine|consolidate","estimatedMinutes":60,"acceptanceHint":"","icapLevel":"active|constructive|interactive"}]}`,
    score: (parsed) => {
      const subtasks = Array.isArray(parsed?.subtasks) ? parsed.subtasks : [];
      const text = subtasks.map((t: any) => `${t?.title || ''}${t?.description || ''}${t?.acceptanceHint || ''}`).join(' ');
      return {
        taskCount: subtasks.length,
        examTasks: (text.match(/真题|模考|整卷|套卷|题型|选择题|计算分析|综合题/g) || []).length,
        hasTimedMock: /限时[^。；]{0,24}(整卷|套卷|模考|真题|一套|综合案例|综合题)|(整卷|套卷|模考)[^。；]{0,24}限时/.test(text) ? 1 : 0,
        hasErrorReview: /错题|错因|错因回收|归类/.test(text) ? 1 : 0,
      };
    },
    isBetter: (arm, base) =>
      arm.examTasks > base.examTasks || (arm.examTasks === base.examTasks && arm.hasTimedMock > base.hasTimedMock),
  },
  63: {
    label: '媒体类任务文本收口：录音/录像必须转写成文字产出',
    promptFile: 'prompts/skill.stage-designer.md',
    rules: [
      '媒体类任务的文本收口（2026-10-17 实测：10-16/17 生成的弹唱与普通话路径仍有「录音自查」类任务，但平台收不到也听不了录音）：若任务涉及录音/录像/拍照，必须写成「做一次 → 自己回听/回看 → 用文字写出听到/看到的具体差异（哪一小节、哪一拍、哪个音）」，acceptanceHint 必须落在文字产出上；禁止把「录一段音/拍一段视频」本身或「上传给老师看」作为完成信号，也不得暗示平台能听/能看。不涉及媒体的阶段不要凭空加媒体任务。',
    ],
    payload: `你是阶段任务设计师，只为当前 milestone 生成 subtasks。
milestone: {"title":"让右手扫弦跟上拍子","description":"右手下拨上挑的落点稳定在拍子上，能在节拍器 60-80 BPM 下不断拍。","goal":"60-80 BPM 下连续扫弦两分钟不乱拍","coreConcept":"拨弦落点与节拍的对应","estimatedHours":5}
cognitiveCore: {"coreConcepts":[{"id":"concept-1","name":"拨弦落点与节拍的对应","role":"hub"},{"id":"concept-2","name":"上下拨的均匀度与力度控制","role":"supporting"},{"id":"concept-3","name":"换弦时右手预备动作的提前量","role":"supporting"}],"loadProfile":{"loadTarget":"medium"}}
normalizedInput: {"rawGoal":"想学会吉他弹唱《平凡之路》，明年 1 月婚礼上给对象伴奏","realProblem":"左手按弦和右手节奏完全不会，也没人教","timeBudget":"每周 5 小时","learnerProfile":{"currentBaseline":"beginner"}}
previousMilestone: {"title":"把 C、G、Am、F 的指型压成不用看的肌肉记忆","coreConcept":"指型锚点与换弦预备动作"}
pathStageMap: {"stageCount":5,"currentStageNumber":3,"stages":[{"stageNumber":1,"title":"辨清谱面标记与段落","estimatedHours":4},{"stageNumber":2,"title":"把 C、G、Am、F 的指型压成不用看的肌肉记忆","estimatedHours":5},{"stageNumber":3,"title":"让右手扫弦跟上拍子","estimatedHours":5},{"stageNumber":4,"title":"在段落变化处换和弦","estimatedHours":5},{"stageNumber":5,"title":"脱谱连贯弹唱一遍","estimatedHours":5}]}
planningHints: {"targetSubtasksForStage":4,"subtasksPerStageRange":[3,5],"subtaskMinutesRange":[30,90]}
【强制要求】只输出 JSON：{"subtasks":[{"title":"","description":"","type":"acquire|deconstruct|model|execute|diagnose|refine|consolidate","estimatedMinutes":60,"acceptanceHint":"","icapLevel":"active|constructive|interactive"}]}`,
    score: (parsed) => {
      const subtasks = Array.isArray(parsed?.subtasks) ? parsed.subtasks : [];
      const media = subtasks.filter((t: any) => /录音|录像|录屏|拍照|拍视频|视频/.test(`${t?.title || ''}${t?.description || ''}${t?.acceptanceHint || ''}`));
      const withTextCloseout = media.filter((t: any) => /写|记录|笔记|文字|对照表|标注|列出/.test(`${t?.description || ''}${t?.acceptanceHint || ''}`));
      const platformObserve = subtasks.filter((t: any) => /我来看|老师听|平台听|上传|发给我/.test(`${t?.title || ''}${t?.description || ''}${t?.acceptanceHint || ''}`));
      return {
        taskCount: subtasks.length,
        mediaTasks: media.length,
        mediaWithoutText: media.length - withTextCloseout.length,
        platformObserve: platformObserve.length,
      };
    },
    isBetter: (arm, base) =>
      arm.mediaWithoutText < base.mediaWithoutText
      || (arm.mediaWithoutText === base.mediaWithoutText && arm.platformObserve < base.platformObserve),
  },
};

function extractJson(text: string): any | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function callModel(system: string, user: string): Promise<string> {
  const endpoint = /\/v1$/.test(AI_URL) ? `${AI_URL}/chat/completions` : `${AI_URL}/v1/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.2,
      max_tokens: 16000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(420000),
  });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${String(json?.error?.message || '').slice(0, 120)}`);
  return String(json?.choices?.[0]?.message?.content || '');
}

async function main() {
  const spec = CASES[CASE];
  const basePrompt = spec.promptFile
    ? fs.readFileSync(path.resolve(__dirname, '../../..', spec.promptFile), 'utf8')
    : BASE_PROMPT;
  console.log(`[path-ab] case=${CASE} (${spec.label}) model=${AI_MODEL} n=${N}/arm prompt=${spec.promptFile || 'prompts/skill.path-planning.md'}`);
  const systems = {
    A: basePrompt,
    B: `${basePrompt}\n\n${spec.rules.join('\n')}`,
  };
  const jobs: Array<Promise<{ arm: 'A' | 'B'; ok: boolean; score: Record<string, number>; error?: string; text?: string }>> = [];
  for (const arm of ['A', 'B'] as const) {
    for (let i = 0; i < N; i += 1) {
      jobs.push((async () => {
        try {
          const raw = await callModel(systems[arm], spec.payload);
          const parsed = extractJson(raw);
          if (!parsed) return { arm, ok: false, score: {}, error: 'no-json', text: raw.slice(0, 4000) };
          return { arm, ok: true, score: spec.score(parsed), text: raw.slice(0, 4000) };
        } catch (error) {
          return { arm, ok: false, score: {}, error: error instanceof Error ? error.message : String(error) };
        }
      })());
    }
  }
  const rows: Array<{ arm: 'A' | 'B'; ok: boolean; score: Record<string, number>; error?: string; text?: string }> = [];
  for (let i = 0; i < jobs.length; i += 2) {
    rows.push(...await Promise.all(jobs.slice(i, i + 2)));
    console.log(`[path-ab] ${Math.min(i + 2, jobs.length)}/${jobs.length}`);
  }

  const meanOf = (arm: 'A' | 'B') => {
    const ok = rows.filter((row) => row.arm === arm && row.ok);
    if (ok.length === 0) return { n: 0 } as Record<string, number>;
    const keys = Object.keys(ok[0].score);
    const out: Record<string, number> = { n: ok.length };
    for (const key of keys) {
      out[key] = Math.round((ok.reduce((sum, row) => sum + (row.score[key] || 0), 0) / ok.length) * 100) / 100;
    }
    return out;
  };
  const base = meanOf('A');
  const arm = meanOf('B');
  const verdict = base.n && arm.n ? spec.isBetter(arm, base) : null;
  const result = { case: CASE, label: spec.label, model: AI_MODEL, n: N, base, arm, verdict, rows };
  const outFile = path.resolve(__dirname, `../../.tmp-path-ab-${CASE}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log('[path-ab] A(基线):', JSON.stringify(base));
  console.log('[path-ab] B(加规则):', JSON.stringify(arm));
  console.log(`[path-ab] verdict: ${verdict === null ? '样本不足（provider 失败）' : verdict ? 'B 更好，规则可进入 core.yaml' : 'B 无改善，规则不采纳'}`);
  console.log(`[path-ab] 明细：${outFile}`);
}

main().catch((error) => {
  console.error('[path-ab] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
