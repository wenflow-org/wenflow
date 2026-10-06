// 过程重建员：逐回合切片（只读）。输入 recon-<name>.json，输出逐回合摘要 recon-turns-<name>.json + stdout 摘要。
// 每回合：学生消息 → 该回合 prompt 段清单+关键值 → agent 跳（skill/model/成败） → 老师消息+analysis → 证据行。
const fs = require('node:fs');
const path = require('node:path');

const name = process.argv[2];
const src = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'out', `recon-${name}.json`), 'utf8')
);

const trunc = (s, n = 180) => (s == null ? null : String(s).replace(/\s+/g, ' ').slice(0, n));
const jparse = (s) => {
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

// ---- 消息解析 ----
const msgs = src.messages.map((m) => ({ createdAt: m.createdAt, ...jparse(m.payload) }));
// ---- prompt 调用 ----
const promptCalls = (src.promptCalls || []).map((p) => ({
  ...p,
  up: jparse(p.userPayload),
}));
// ---- agent 跳 ----
const agentCalls = src.agentCalls || [];
// ---- 证据 ----
const evidence = (src.evidence || []).map((e) => ({ ...e, pl: jparse(e.payload) }));

// 逐回合：以 user 消息为回合起点
const turns = [];
let cur = null;
for (const m of msgs) {
  if (m.role === 'user') {
    cur = { userAt: m.createdAt, userText: trunc(m.content, 400), userMeta: m.meta || null, hops: [], promptSegs: null, assistantAt: null, assistantText: null, analysis: null, extra: {} };
    turns.push(cur);
  } else if (m.role === 'assistant' && cur && !cur.assistantAt) {
    cur.assistantAt = m.createdAt;
    cur.assistantText = trunc(m.content, 500);
    cur.analysis = m.analysis || null;
    for (const k of ['strategies', 'knowledgePoint', 'knowledgePoints', 'diagrams', 'figures', 'peerTriggered', 'peerMessage', 'peerStrategy', 'peerFollowUpQuestions', 'supplement', 'quickReplies', 'isCompletion', 'wrapup', 'advisory']) {
      if (m[k] !== undefined && m[k] !== null) cur.extra[k] = m[k];
    }
  }
}
// 开场消息（assistant 且无前导 user）
const opening = msgs.find((m) => m.role === 'assistant');
const hasUserBeforeOpening = msgs.some((m) => m.role === 'user' && m.createdAt < (opening ? opening.createdAt : 0));
const openingInfo = !hasUserBeforeOpening && opening ? { createdAt: opening.createdAt, text: trunc(opening.content, 300), keys: Object.keys(opening) } : null;

// prompt 段对齐：teaching-turn 的 userPayload.latestLearnerMessage 与 user 消息匹配；失败时按时间兜底
const turnForPromptCall = (pc) => {
  for (const t of turns) {
    if (pc.up && pc.up.latestLearnerMessage && t.userText && pc.up.latestLearnerMessage.replace(/\s+/g, ' ').startsWith(t.userText.slice(0, 60))) return t;
  }
  // 时间兜底：prompt 行记录于调用结束时，回合 user 消息落库在其后 ~0-100ms
  let best = null;
  for (const t of turns) {
    if (t.userAt <= Number(pc.createdAt) + 250 && (!best || t.userAt > best.userAt)) best = t;
  }
  return best;
};
const segByPromptCallId = {};
for (const pc of promptCalls) {
  if (pc.agentId !== 'skill:teaching-turn') continue;
  const t = turnForPromptCall(pc);
  if (!t) continue;
  const u = pc.up;
  const seg = {
    promptCallId: pc.id,
    at: pc.createdAt,
    model: pc.model,
    ok: pc.success,
    durMs: pc.durationMs,
    segmentKeys: Object.keys(u),
    scenario: u.scenario
      ? (() => {
          const s = u.scenario;
          return {
            keys: Object.keys(s),
            subject: s.subject,
            topic: trunc(s.topic, 80),
            hasLearnerInsights: !!s.learnerInsights,
            learnerInsightsBrief: s.learnerInsights ? trunc(JSON.stringify(s.learnerInsights), 300) : null,
            hasWarmup: !!s.memoryWarmup || !!s.warmup,
            warmupBrief: s.memoryWarmup ? trunc(JSON.stringify(s.memoryWarmup), 400) : s.warmup ? trunc(JSON.stringify(s.warmup), 400) : null,
            hasSupplementaryMaterial: !!s.supplementaryMaterial,
            supplementaryBrief: s.supplementaryMaterial ? trunc(String(s.supplementaryMaterial.title || s.supplementaryMaterial), 120) : null,
            checkpointSummary: s.checkpointSummary ? trunc(JSON.stringify(s.checkpointSummary), 300) : null,
            lastLessonRecap: s.lastLessonRecap ? trunc(JSON.stringify(s.lastLessonRecap), 200) : null,
            visualOpportunity: s.visualOpportunity ? trunc(JSON.stringify(s.visualOpportunity), 200) : null,
          };
        })()
      : null,
    promptDirectives: u.promptDirectives ? trunc(JSON.stringify(u.promptDirectives), 500) : null,
    learner: u.learner
      ? (() => {
          const l = u.learner;
          return {
            keys: Object.keys(l),
            liveState: l.liveState ? trunc(JSON.stringify(l.liveState), 300) : null,
            ktEstimateBrief: l.ktEstimate ? trunc(JSON.stringify(l.ktEstimate).slice(0, 400)) : null,
          };
        })()
      : null,
    conditionalRules: trunc(u.conditionalRules, 400),
    taskDifficulty: u.taskDifficulty || null,
    controls: u.controls
      ? (() => {
          const c = u.controls;
          return {
            keys: Object.keys(c),
            mode: c.mode,
            emitCheckpoint: c.emitCheckpoint,
            anchorProbe: c.anchorProbe ? trunc(JSON.stringify(c.anchorProbe), 200) : null,
            checkpointVerdict: c.checkpointVerdict ? trunc(JSON.stringify(c.checkpointVerdict), 300) : null,
            teachingControlContext: c.teachingControlContext ? trunc(JSON.stringify(c.teachingControlContext), 300) : null,
            pendingWarmupForModel: c.pendingWarmupForModel ? trunc(JSON.stringify(c.pendingWarmupForModel), 300) : undefined,
          };
        })()
      : null,
    knowledge: u.knowledge
      ? {
          points: (u.knowledge.points || []).map((k) => ({ name: trunc(k.name, 50), status: k.status, progress: k.progress })),
          otherKeys: Object.keys(u.knowledge),
        }
      : null,
    classroomContext: u.classroomContext
      ? {
          stage: u.classroomContext.stage || null,
          focus: trunc(JSON.stringify(u.classroomContext.focusKnowledgePoint || u.classroomContext.focus), 150),
          keys: Object.keys(u.classroomContext),
          checkpointHistory: u.classroomContext.checkpointHistory ? trunc(JSON.stringify(u.classroomContext.checkpointHistory), 300) : undefined,
        }
      : null,
    classroomEventContext: u.classroomEventContext
      ? {
          recentEvents: (u.classroomEventContext.recentEvents || []).map((e) => ({ type: e.type, summary: trunc(e.summary, 120) })),
          keys: Object.keys(u.classroomEventContext),
        }
      : null,
    behavioralProfile: u.behavioralProfile ? trunc(JSON.stringify(u.behavioralProfile), 250) : null,
    priorMisconceptions: (u.priorMisconceptions || []).map((m) => ({ conceptKey: m.conceptKey, hypothesis: trunc(m.hypothesis, 120), label: m.canonicalLabel || m.label, status: m.status })),
    interactionProfile: u.interactionProfile ? trunc(JSON.stringify(u.interactionProfile), 250) : null,
  };
  seg.promptMatchedHow = 'content';
  t.promptSegs = seg;
  if (pc.id) segByPromptCallId[pc.id] = t;
}

// agent 跳归回合：优先 promptCallId 关联（agent_call_logs.promptCallId ↔ prompt_call_logs.id），
// 回退时间窗（calledAt 记录于调用结束时，回合 LLM 调用落点略早于 user 消息 createdAt）
for (const a of agentCalls) {
  const at = Number(a.calledAt);
  const rec = {
    at,
    agentId: a.agentId,
    callerAgent: a.callerAgent,
    providerId: a.providerId,
    routeSource: a.routeSource,
    model: a.model,
    ok: a.success,
    durMs: a.durationMs,
    tokens: a.tokensUsed,
    promptTokens: a.promptTokens,
    completionTokens: a.completionTokens,
    finishReason: a.finishReason,
    statusCode: a.statusCode,
    err: a.error ? trunc(a.error, 120) : null,
  };
  let owner = a.promptCallId ? segByPromptCallId[a.promptCallId] : null;
  if (!owner) {
    for (let i = 0; i < turns.length; i++) {
      const start = turns[i].userAt - 60000;
      const end = i + 1 < turns.length ? turns[i + 1].userAt - 60000 : Infinity;
      if (at >= start && at < end) {
        owner = turns[i];
        break;
      }
    }
  }
  if (owner) owner.hops.push(rec);
  else {
    turns.pre = turns.pre || [];
    turns.pre.push(rec);
  }
}

// 证据按时间归回合
for (const e of evidence) {
  const at = Number(e.occurredAt);
  const rec = { at, type: e.evidenceType, key: e.evidenceKey, confidence: e.confidence, payload: e.pl ? trunc(JSON.stringify(e.pl), 400) : null };
  let owner = null;
  for (let i = 0; i < turns.length; i++) {
    const start = turns[i].userAt;
    const end = i + 1 < turns.length ? turns[i + 1].userAt : Infinity;
    if (at >= start && at < end) {
      owner = turns[i];
      break;
    }
  }
  if (owner) (owner.evidenceRows = owner.evidenceRows || []).push(rec);
  else {
    turns.post = turns.post || [];
    turns.post.push(rec);
  }
}

// 非教学回合的 prompt 调用（predictor/opening/wrapup/replan）
const nonTurnPrompts = promptCalls
  .filter((p) => p.agentId !== 'skill:teaching-turn')
  .map((p) => ({
    agentId: p.agentId,
    at: p.createdAt,
    ok: p.success,
    durMs: p.durationMs,
    payloadLen: (p.userPayload || '').length,
    brief: (() => {
      const u = p.up;
      if (!u) return trunc(p.userPayload, 150);
      return trunc(JSON.stringify(u).slice(0, 400));
    })(),
  }));

const out = {
  name,
  sessionId: src.sessionId,
  session: src.session,
  openingInfo,
  turns,
  nonTurnPrompts,
  teachingStateDigest: src.teachingStateDigest,
  wrapupTopLevel: (() => {
    const w = jparse(src.session && src.session.wrapup);
    return w
      ? {
          status: w.status,
          sources: w.sources,
          summaryTopic: w.summary ? trunc(w.summary.topicSummary, 200) : null,
          duration: w.duration,
          keys: Object.keys(w),
          progress: w.progress ? trunc(JSON.stringify(w.progress), 400) : null,
          learningEvaluation: w.evaluation ? trunc(JSON.stringify(w.evaluation), 500) : null,
        }
      : null;
  })(),
  advisory: (() => {
    const a = jparse(src.session && src.session.advisory);
    return a ? trunc(JSON.stringify(a), 500) : null;
  })(),
  knowledgeState: (() => {
    const k = jparse(src.session && src.session.knowledgeState);
    if (!k) return null;
    return Array.isArray(k)
      ? k.map((x) => ({ name: trunc(x.name, 60), status: x.status, progress: x.progress }))
      : Object.keys(k);
  })(),
};

fs.writeFileSync(path.join(__dirname, 'out', `recon-turns-${name}.json`), JSON.stringify(out, null, 1), 'utf8');
console.log('wrote', `out/recon-turns-${name}.json`, '| turns=', turns.length, '| opening=', !!openingInfo);
