/**
 * 离线评审 · 课堂质量（已完结 teaching_sessions）
 *
 * 评的是「这节课教得怎么样」，不是学习者学得好不好。七个维度 + 五个二元问题：
 * 维度给 0-1 连续分（0.5 = 证据不足/中性），flag 只记有逐字引文的问题。
 * 决策由 ds4.1 做（默认 deepseek-v4.1-flash），K 次独立判读取中位数/多数。
 */
import {
  clip, jparse, hasVerbatimQuote, validateIssues, weightedScore, majority,
} from './lib.mjs';

export const DIMENSIONS = [
  'goalAlignment', 'diagnosis', 'explanation', 'responsiveness', 'scaffolding', 'accuracy', 'closure',
];
export const DIMENSION_LABELS = {
  goalAlignment: '目标贴合',
  diagnosis: '诊断敏感度',
  explanation: '讲解质量',
  responsiveness: '回应性',
  scaffolding: '参与带动',
  accuracy: '事实准确性',
  closure: '收口与总结一致',
};
export const WEIGHTS = {
  goalAlignment: 0.15, diagnosis: 0.15, explanation: 0.15, responsiveness: 0.15,
  scaffolding: 0.15, accuracy: 0.15, closure: 0.10,
};
export const FLAG_KEYS = [
  'wrongAnswerPassed', 'summaryMismatch', 'unclosedComplete', 'loopStuck', 'fabricatedContent',
];
export const FLAG_LABELS = {
  wrongAnswerPassed: '错答被肯定/放行',
  summaryMismatch: '总结失真',
  unclosedComplete: '未答收口',
  loopStuck: '循环卡壳',
  fabricatedContent: '编造事实/内容',
};

export function selectClassroomCases(db, {
  limit = 20, days = 30, scope = 'all', emailLike = null, minMsgs = 6, ids = null,
} = {}) {
  const since = Date.now() - days * 86400000;
  const scopeSql = scope === 'virtual' ? ' AND u.isVirtualLearner = 1'
    : scope === 'real' ? ' AND u.isVirtualLearner = 0' : '';
  const emailSql = emailLike ? ' AND u.email LIKE ?' : '';
  const rows = db.prepare(`
    SELECT s.id AS sid, s.userId AS uid, u.email, u.isVirtualLearner AS virtual,
           s.subject, s.topic, s.mode, s.duration, s.messages, s.knowledgeState,
           s.wrapup, s.teachingState, s.taskId, s.learningPathId, s.createdAt
      FROM teaching_sessions s JOIN users u ON u.id = s.userId
     WHERE s.status = 'completed' AND s.wrapup IS NOT NULL AND s.wrapup NOT IN ('', 'null')
       AND s.createdAt >= ?${scopeSql}${emailSql}
     ORDER BY s.createdAt DESC`).all(...[since, ...(emailLike ? [emailLike] : [])]);
  const wanted = ids ? new Set(ids) : null;
  const cases = [];
  for (const row of rows) {
    if (wanted && !wanted.has(row.sid)) continue;
    const built = buildClassroomCase(db, row);
    if (!built || built.msgCount < minMsgs) continue;
    cases.push(built);
    if (cases.length >= limit) break;
  }
  return cases;
}

function messagesOf(db, sid, rawJson) {
  const col = jparse(rawJson, null);
  if (Array.isArray(col) && col.length) {
    return col.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  }
  const msgs = [];
  for (const r of db.prepare('SELECT payload FROM teaching_session_messages WHERE sessionId=? ORDER BY id').all(sid)) {
    const p = jparse(r.payload, null);
    if (p && (p.role === 'user' || p.role === 'assistant') && typeof p.content === 'string' && p.content.trim()) {
      msgs.push({ role: p.role, content: p.content });
    }
  }
  return msgs;
}

function sampleTranscript(msgs, maxChars = 12000) {
  const head = 4;
  const tail = 10;
  let idxs;
  if (msgs.length <= head + tail) idxs = msgs.map((_, i) => i);
  else {
    idxs = [];
    for (let i = 0; i < head; i++) idxs.push(i);
    const span = msgs.length - head - tail;
    const step = Math.max(1, Math.floor(span / 12));
    for (let i = head; i < head + span; i += step) idxs.push(i);
    for (let i = msgs.length - tail; i < msgs.length; i++) idxs.push(i);
  }
  const seen = new Set();
  const lines = idxs.filter((i) => !seen.has(i) && seen.add(i)).map((i) => {
    const m = msgs[i];
    return `${m.role === 'user' ? '学员' : '老师'}: ${clip(m.content, m.role === 'user' ? 500 : 400)}`;
  });
  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…（对话截断）';
  return text;
}

function checkpointBlock(db, sid, teachingState) {
  const st = jparse(teachingState, null);
  const history = Array.isArray(st?.checkpointHistory) ? st.checkpointHistory : [];
  const evRows = db.prepare(
    "SELECT payload FROM learner_evidence WHERE sessionId=? AND evidenceType='checkpoint:result' ORDER BY createdAt",
  ).all(sid).map((r) => jparse(r.payload, {}));
  const byId = new Map(evRows.map((e) => [e?.checkpointId, e]));
  if (!history.length) return '【检查点判分记录】本轮无检查点。';
  const lines = history.map((h, i) => {
    const e = byId.get(h?.checkpointId) || {};
    const selected = Array.isArray(e?.selectedOptionIds) && e.selectedOptionIds.length ? e.selectedOptionIds.join('/') : '?';
    return `cp${i + 1}｜${h?.type || e?.type || ''}｜问：${clip(h?.question || '', 180)}`
      + `｜判分来源 ${h?.judgedBy || e?.judgedBy || '?'}｜结果 ${h?.passed !== false ? 'passed' : 'failed'}`
      + `｜学员所选 ${selected}｜明细 ${clip(e?.detail || '', 100)}｜概念 ${h?.conceptName || ''}`;
  });
  return `【检查点判分记录（ground truth）】\n${lines.join('\n')}`;
}

function goalAndTaskBlock(db, row) {
  const parts = [];
  const task = row.taskId
    ? db.prepare('SELECT title, description, acceptanceCriteria, taskType, estimatedMinutes, coreConcept, linkedConceptName FROM subtasks WHERE id=?').get(row.taskId)
    : null;
  if (task) {
    parts.push(`【本课任务】${clip(task.title || '', 200)}｜类型 ${task.taskType || '?'}｜预计 ${task.estimatedMinutes ?? '?'} 分钟`
      + `\n目标概念：${clip(task.coreConcept || task.linkedConceptName || '', 120) || '（无）'}`
      + `\n任务说明：${clip(task.description || '', 500) || '（无）'}`
      + `\n验收标准：${clip(task.acceptanceCriteria || '', 500) || '（无）'}`);
  }
  if (row.learningPathId) {
    const p = db.prepare('SELECT title, subject, aiPromptTemplate FROM learning_paths WHERE id=?').get(row.learningPathId);
    if (p) {
      const t = jparse(p.aiPromptTemplate, {}) || {};
      const conf = t?.normalizedInput?.confirmedProposal || t?.goalFinalPayload?.visibleSummary || {};
      const goal = clip(conf.learningDirection || conf.surfaceGoal || t?.goalFinalPayload?.rawGoal || '', 700);
      if (goal) parts.push(`【路径目标】${p.title || ''}\n${goal}`);
    }
  }
  return parts.join('\n\n');
}

export function buildClassroomCase(db, row) {
  const msgs = messagesOf(db, row.sid, row.messages);
  if (!msgs.length) return null;
  const kp = jparse(row.knowledgeState, []) || [];
  const kpBlock = Array.isArray(kp) && kp.length
    ? kp.map((p) => `- ${p.name}｜${p.status}｜${p.progress}%`).join('\n')
    : '（无）';
  const wrapup = jparse(row.wrapup, null);
  const wrapupBlock = wrapup ? clip(JSON.stringify(wrapup), 2400) : '（无结课总结）';
  const block = [
    `课题：${row.topic || '(无)'}｜学科：${row.subject || '(无)'}｜模式：${row.mode || '?'}`,
    `课堂时长：${row.duration ?? '?'} 分钟｜消息 ${msgs.length} 条`,
    goalAndTaskBlock(db, row),
    `【知识点最终掌握状态】\n${kpBlock}`,
    checkpointBlock(db, row.sid, row.teachingState),
    `【结课总结（wrapup）】\n${wrapupBlock}`,
    `【课堂对话节选（首4+均匀中段+末10，逐条截断）】\n${sampleTranscript(msgs)}`,
  ].filter(Boolean).join('\n\n');
  return {
    kind: 'classroom',
    id: row.sid,
    uid: row.uid,
    email: row.email,
    virtual: Boolean(row.virtual),
    topic: row.topic,
    subject: row.subject,
    msgCount: msgs.length,
    createdAt: row.createdAt,
    block,
  };
}

const RUBRIC = `你是独立的教学质量评审员，评的是「老师教得怎么样」，不是学习者学得好不好。
下面是一节已经完结的课堂记录（含任务、检查点真值、结课总结与对话节选）。只输出一个 JSON 对象。

七个维度，每项 0-1（0.5 = 证据不足/中性；不要因为一个缺点否定整节课）：
- goalAlignment 目标贴合：课堂是否围绕本课任务与路径目标推进，有没有跑题或提前跳课。
- diagnosis 诊断敏感度：学员暴露错误概念/错误答案时，老师是否识别并探询，而不是顺着讲或直接给答案。
- explanation 讲解质量：解释是否准确、结构清晰、例子贴合学习者水平；有没有术语堆砌或长段独白。
- responsiveness 回应性：是否直接回应用员这句话/这个问题；有没有答非所问、模板复读。
- scaffolding 参与带动：是否把学员拉进生成性参与（提问、复述、应用、反例），难度是否随表现调整。
- accuracy 事实准确性：知识性陈述是否正确；不确定时是否诚实收窄。
- closure 收口与总结一致：结课总结是否与对话事实一致；是否在证据不足时宣布完成。

五个二元问题（true = 存在该问题）：
- wrongAnswerPassed：学员答错/答非所问，却被肯定、判过或继续推进。
- summaryMismatch：结课总结把老师讲解记成学员产出，或与对话事实不符/遗漏未解决问题。
- unclosedComplete：老师抛出问题学员未答，课堂却宣布完成/任务达标。
- loopStuck：同一确认点/同一问题 3 轮以上未推进，老师重复同一套解释。
- fabricatedContent：老师编造事实、伪造成绩或能力，或承诺平台做不到的事。

判定纪律：
1. 证据优先：只根据给定记录判断；不确定的维度给 0.5，不确定的 flag 给 false。
2. 检查点真值优先：明细「选项集合不一致（正确 X，作答 Y）」而结果 passed → wrongAnswerPassed；
   明细「与答案键一致」的 passed 检查点，不得仅凭学员自由文本与任务口径的差异判错答放行。
3. 每个判 true 的 flag 必须给至少 1 条逐字引文（从记录里原样复制 ≤120 字，不要改写）；
   给不出引文的 flag 会被系统降级为 false。
4. issues 最多 5 条，必须引用具体原话或检查点行，并给出可执行改进建议；不要写空泛评语。

输出严格 JSON（不要 markdown 代码块、不要表外字段）：
{
  "dimensions": {"goalAlignment":0.0,"diagnosis":0.0,"explanation":0.0,"responsiveness":0.0,"scaffolding":0.0,"accuracy":0.0,"closure":0.0},
  "flags": {"wrongAnswerPassed":false,"summaryMismatch":false,"unclosedComplete":false,"loopStuck":false,"fabricatedContent":false},
  "evidence": {"<判 true 的 flag 名>": ["逐字引文"]},
  "issues": [{"dimension":"diagnosis","severity":"low|medium|high","quote":"原话","suggestion":"具体改法"}],
  "confidence": 0.0
}`;

export function buildClassroomPrompt(block) {
  return `${RUBRIC}\n\n=== 案例 ===\n${block}`;
}

export function validateClassroomVerdict(raw, block) {
  const errors = [];
  const dimensions = {};
  const dimsRaw = raw?.dimensions && typeof raw.dimensions === 'object' ? raw.dimensions : {};
  for (const key of DIMENSIONS) {
    const value = Number(dimsRaw[key]);
    if (!Number.isFinite(value)) errors.push(`dimension:${key}`);
    else dimensions[key] = Math.max(0, Math.min(1, value));
  }
  const flags = {};
  const invalidQuotes = [];
  const flagsRaw = raw?.flags && typeof raw.flags === 'object' ? raw.flags : {};
  for (const key of FLAG_KEYS) {
    if (flagsRaw[key] === true) {
      if (hasVerbatimQuote(block, raw?.evidence?.[key])) flags[key] = true;
      else { flags[key] = false; invalidQuotes.push(key); }
    } else flags[key] = false;
  }
  const confidence = Number(raw?.confidence);
  const result = {
    ok: errors.length === 0,
    errors,
    dimensions,
    dims: dimensions,
    flags,
    invalidQuotes,
    issues: validateIssues(raw?.issues, DIMENSIONS),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
  };
  result.overall = weightedScore(dimensions, WEIGHTS);
  const hardFail = flags.wrongAnswerPassed || flags.fabricatedContent
    || flags.unclosedComplete || flags.summaryMismatch;
  result.verdict = hardFail || (result.overall !== null && result.overall < 0.70) ? 'fail' : 'pass';
  return result;
}

/** K 次判读聚合：维度取中位数、flag 取多数；verdict 由聚合值重算（不信模型自报）。 */
export function aggregateClassroomJudgments(judgments) {
  const valid = judgments.filter((j) => j && j.ok);
  if (!valid.length) return null;
  const dimensions = {};
  for (const key of DIMENSIONS) dimensions[key] = medianOf(valid.map((j) => j.dimensions[key]));
  const flags = {};
  for (const key of FLAG_KEYS) flags[key] = majority(valid.map((j) => j.flags[key]));
  const overall = weightedScore(dimensions, WEIGHTS);
  const hardFail = flags.wrongAnswerPassed || flags.fabricatedContent
    || flags.unclosedComplete || flags.summaryMismatch;
  const issues = valid.flatMap((j) => j.issues);
  return {
    dimensions,
    flags,
    overall,
    verdict: hardFail || (overall !== null && overall < 0.70) ? 'fail' : 'pass',
    issues: dedupeIssues(issues),
    invalidQuotes: [...new Set(valid.flatMap((j) => j.invalidQuotes || []))],
    samples: valid.length,
    confidence: medianOf(valid.map((j) => j.confidence ?? 0.5)),
  };
}

function medianOf(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function dedupeIssues(issues) {
  const seen = new Set();
  const out = [];
  for (const item of issues) {
    const key = `${item.dimension}|${item.severity}|${item.quote}|${item.suggestion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 12);
}

export const CLASSROOM_JUDGE_NAME = 'offline-classroom-v1';
