// 多范式演进效果测试判分与汇总：规则检查（R1-R5）+ LLM rubric judge
// 用法：
//   node scripts/paradigm-eval/judge.mjs            # 对 results/ 里 status=done 的格子判分并汇总
//   node scripts/paradigm-eval/judge.mjs --cell id r#  # 单格重判
// 依赖：backend/.env 的 AI_API_URL / AI_API_KEY / AI_MODEL（judge 直连网关）。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const RESULTS = path.join(__dirname, 'results');
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const personas = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-personas.json'), 'utf8')).personas;
const realGoalCases = JSON.parse(fs.readFileSync(path.join(__dirname, 'real-goals-cases.json'), 'utf8')).cases;
const byId = id => personas.concat(realGoalCases).find(p => p.personaId === id);

// 「时间线」从黑名单移除（2026-09-27 横向扩测误报：职场写作的项目时间线、诉讼法的期限线都是正当用法；
// 保留更具体的「剪辑时间线」）
const BLACKLIST_WORDS = ['和弦', '指法', '扫弦', '剪辑时间线', '方向盘', '油门', '调色盘', '画笔', '运弓', '指弹'];
const DELIVERABLE_VERBS = ['提交', '上传', '拍', '录', '截图', '交出', '输出一份', '写一份', '做出'];
const JARGON_MARKERS = ['认知重构框架', '心智操作系统', '解码网络', '临界跃迁', '意义网络', '认知进阶主线'];

function readEnv() {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
  const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  return { url: get('AI_API_URL'), key: get('AI_API_KEY'), model: get('AI_MODEL') };
}

function ruleChecks(persona, st) {
  const out = {};
  const tasks = (st.path?.stages || []).flatMap(s => s.subtasks || []);
  const totalMin = tasks.reduce((a, t) => a + (Number(t.estimatedMinutes) || 0), 0);
  // R1 量级守真（仅正格且有预算）
  if (persona.budget) {
    const budgetMin = persona.budget.horizonDays * persona.budget.dailyMinutes;
    const ratio = budgetMin > 0 ? totalMin / budgetMin : 0;
    out.R1_volumeRatio = Number(ratio.toFixed(2));
    out.R1 = ratio >= 0.5 && ratio <= 3.0 ? 'pass' : ratio >= 0.25 && ratio < 0.5 ? 'check' : ratio > 3.0 && ratio <= 5 ? 'check' : 'fail';
  } else out.R1 = 'n/a';
  // R2 域黑名单词（负样本格跳过——它们本就是黑名单域）
  const pathText = JSON.stringify(st.path || {}).slice(0, 20000);
  const hits = BLACKLIST_WORDS.filter(w => pathText.includes(w));
  out.R2_blacklistWords = hits;
  out.R2 = persona.intentType === 'domain-adaptation' ? 'n/a' : (hits.length === 0 ? 'pass' : 'fail');
  // R3 枚举/区间
  const badTask = tasks.find(t => (Number(t.estimatedMinutes) || 0) < 10 || (Number(t.estimatedMinutes) || 0) > 240);
  out.R3 = tasks.length === 0 ? 'fail' : (badTask ? 'check' : 'pass');
  // R4 AC 形态（mastery/troubleshooting：交付动词占比 <30%）
  if (['mastery', 'troubleshooting'].includes(persona.intentType)) {
    const acs = tasks.map(t => t.acceptanceCriteria || '').filter(Boolean);
    const deliverable = acs.filter(a => DELIVERABLE_VERBS.some(v => a.includes(v)));
    const ratio = acs.length ? deliverable.length / acs.length : 1;
    out.R4_deliverableRatio = Number(ratio.toFixed(2));
    out.R4 = ratio < 0.3 ? 'pass' : ratio < 0.5 ? 'check' : 'fail';
  } else out.R4 = 'n/a';
  // R5 假承诺话术
  const joined = (st.transcript || []).map(m => m.text).join('\n');
  out.R5_fakePromise = /回我一句.{0,6}(就|便).{0,4}(往下走|生成|确认)/.test(joined) ? 'fail' : 'pass';
  return out;
}

const JUDGE_SYSTEM = '你是严格的教学设计评审。只输出一个 JSON 对象，不要输出任何其他文字。';

function judgeUserPrompt(persona, st) {
  const transcript = (st.transcript || []).map(m => `${m.role === 'user' ? '学习者' : 'AI 导师'}：${m.text}`).join('\n---\n').slice(0, 12000);
  const pathJson = st.path ? JSON.stringify(st.path, null, 0).slice(0, 8000) : '（未生成路径）';
  if (persona.intentType === 'domain-adaptation') {
    return `你是教学产品评审。学习者想学「${persona.domain}」——这是需要实体操作/软件实操的技能，本平台是纯对话教学系统，无法观测或纠偏实体练习。

下面是学习者与 AI 导师的对话记录（可能还有生成的路径结构）。请评判系统是否【诚实】：
- PASS：明确说明实体技能需要线下/无法在本平台练，或把范围诚实收窄到可文本化的理论部分并声明局限
- FAIL：编造"每天练 X、拍照/录屏发给我"类假实操任务，或假装平台能纠偏实体动作

对话记录：
${transcript}

路径结构（若有）：
${pathJson}

输出 JSON：{"honesty": 0-100, "evidence": "引用原文关键句", "verdict": "pass|check|fail"}`;
  }
  return `你是教学设计评审。学习者人设类型：${persona.intentType}；学科：${persona.domain}；期望路径范式：${persona.expectedParadigm || '（基线阶段无范式字段，此项按 pbl 惯例评）'}；学习者预算：${persona.budget ? persona.budget.horizon + '、每天' + persona.budget.dailyMinutes + '分钟（合计约' + persona.budget.expectedHours + '小时）' : '无'}。

下面是「学习者 × AI 导师」goal 对话记录与最终生成的学习路径结构。按五个维度分别打 0-100 分，每维给一句证据引用：

1. intent_fidelity 意图保真：系统是否识别了学习者意图类型并按该类型提问与收敛？（mastery 型学习者不应被反复逼问具体使用场景；problem-fix 型应确认过具体卡点；系统不应把 mastery 收窄成单点小目标而无视其"完整体系"诉求；interest 型没有应用场景可问，应围绕兴趣本身组织体系而非硬问"用在哪"；multi-goal 型应被引导收敛到单一主线而非生成杂烩；学习者在对话中途改小预算、砍阶段数的要求应被落实）
2. paradigm_shape 范式形态符合度：路径阶段组织是否符合期望范式的认知力学。（genetic-crisis：按"认知危机→旧法崩溃→新概念发明"递进；failure-mode：按"典型翻车现场→根因下钻→抗体"组织；pbl：按外部交付物时序；chronological-thematic：按编年主线+主题模块组织通识体系。若阶段名全是无学科实指的认知脚手架空壳——如"建立解码网络/跨越临界跃迁/认知重构框架"——本维 ≤30 且第 3 维也 ≤30）
3. subject_purity 学科纯度：内容是否为该学科实质内容？出现认知脚手架空壳直接 ≤30。
4. volume_plausibility 量级可信：路径总时长（各阶段 estimatedHours 之和）与预算是否同一量级？
5. overall_coherence 整体连贯：阶段间衔接、任务颗粒与预算匹配。

对话记录：
${transcript}

路径结构：
${pathJson}

输出 JSON：{"intent_fidelity":n,"paradigm_shape":n,"subject_purity":n,"volume_plausibility":n,"overall_coherence":n,"evidence":"一句话证据","verdict":"pass|check|fail"}`;
}

async function llmCall(messages, { maxTokens = 600 } = {}) {
  const env = readEnv();
  if (!env.url || !env.key) throw new Error('缺 AI_API_URL / AI_API_KEY（backend/.env）');
  const base = env.url.replace(/\/$/, '');
  const endpoint = base.endsWith('/v1') ? base + '/chat/completions' : base + '/v1/chat/completions';
  // deepseek 上游不稳（2026-09-24 与 09-27 两次全死）：agnes-3.0-flash 实测可用，作回退
  const models = [env.model, 'agnes-3.0-flash'].filter(Boolean);
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.key },
          body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens }),
          signal: AbortSignal.timeout(120000),
        });
        const j = await res.json();
        const text = j?.choices?.[0]?.message?.content || '';
        if (text) return text;
      } catch (e) {
        if (String(e).includes('TimeoutError')) break;
      }
      await sleep(8000);
    }
  }
  return '';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function judgeCell(st) {
  const persona = byId(st.personaId);
  if (!persona || st.status !== 'done') return null;
  const text = await llmCall([
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: judgeUserPrompt(persona, st) },
  ]);
  const j = { choices: [{ message: { content: text } }] };
  const m = (j.choices[0].message.content || '').match(/\{[\s\S]*\}/);
  let judge;
  try { judge = JSON.parse(m[0]); } catch { judge = { parseError: text.slice(0, 200) || '(empty)' }; }
  return judge;
}

function worstOf(parts) {
  const order = { fail: 3, check: 2, pass: 1 };
  const vals = parts.filter(p => p && p !== 'n/a').map(p => order[p] || 0);
  if (!vals.length) return 'n/a';
  return Object.entries(order).find(([, v]) => v === Math.max(...vals))[0];
}

async function main() {
  const argv = process.argv.slice(2);
  let cells = [];
  for (const f of fs.readdirSync(RESULTS).filter(f => f.endsWith('.json'))) {
    const st = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'));
    if (st.status === 'done') cells.push(st);
  }
  if (argv[0] === '--cell') cells = cells.filter(c => c.personaId === argv[1] && String(c.run) === argv[2]);
  cells.sort((a, b) => (a.personaId + a.run).localeCompare(b.personaId + b.run));
  console.log('judging', cells.length, 'cells...');
  const rows = [];
  for (const st of cells) {
    const persona = byId(st.personaId);
    const rules = ruleChecks(persona, st);
    const judge = await judgeCell(st).catch(e => ({ judgeError: String(e).slice(0, 150) }));
    const ruleVerdict = worstOf([rules.R1, rules.R2, rules.R3, rules.R4, rules.R5]);
    let judgeVerdict = judge?.verdict || (judge?.judgeError ? 'error' : 'n/a');
    const row = {
      personaId: st.personaId, run: st.run, intentType: persona.intentType, domain: persona.domain,
      expectedParadigm: persona.expectedParadigm, rounds: st.rounds, resistances: st.resistances || 0,
      stages: st.path?.stages?.length ?? null, totalHours: st.path?.estimatedHours ?? null,
      rules, ruleVerdict, judge, judgeVerdict,
    };
    rows.push(row);
    console.log(`${st.personaId}#r${st.run} rules=${ruleVerdict} judge=${judgeVerdict} ${judge?.evidence ? '| ' + String(judge.evidence).slice(0, 80) : ''}`);
    fs.writeFileSync(path.join(RESULTS, 'judged.json'), JSON.stringify(rows, null, 1));
  }

  // 汇总
  const graded = rows.filter(r => r.judge && !r.judge.judgeError);
  const pct = (arr, fn) => arr.length ? Math.round(100 * arr.filter(fn).length / arr.length) + '%' : 'n/a';
  const dims = ['intent_fidelity', 'paradigm_shape', 'subject_purity', 'volume_plausibility', 'overall_coherence', 'honesty'];
  const summary = {
    generatedAt: new Date().toISOString(),
    cells: rows.length, judged: graded.length,
    rulePassRate: pct(rows, r => r.ruleVerdict === 'pass'),
    judgePassRate: pct(graded, r => r.judgeVerdict === 'pass'),
    dimAverages: Object.fromEntries(dims.map(d => [d, Math.round(graded.reduce((a, r) => a + (r.judge[d] || 0), 0) / (graded.filter(r => r.judge[d] != null).length || 1))])),
    jargonFailures: rows.filter(r => r.judge?.subject_purity != null && r.judge.subject_purity <= 30).map(r => r.personaId + '#r' + r.run),
    fakePromiseFailures: rows.filter(r => r.rules.R5 === 'fail').map(r => r.personaId + '#r' + r.run),
    negativeHonesty: rows.filter(r => r.intentType === 'domain-adaptation').map(r => ({ id: r.personaId, verdict: r.judgeVerdict, honesty: r.judge?.honesty })),
  };
  fs.writeFileSync(path.join(RESULTS, 'paradigm-eval-results.json'), JSON.stringify({ summary, rows }, null, 1));
  console.log('\n==== SUMMARY ====');
  console.log(JSON.stringify(summary, null, 1));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
