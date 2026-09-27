// learn 课堂驱动：在已有 path 上启动真实授课会话，按水平脚本答 5-8 轮，采集建议面与配图
// 用法：node scripts/paradigm-eval/learn-drive.mjs <personaId> [maxTurns=6]
// 采集面：每轮 aiResponse/analysis(认知水平/迷惑点/情绪)/knowledgePoints/checkpoint/images/state/revision；
//         完课卡与结算(wrapup)的 actionPlan/建议；配图时机=第几轮+prompt+kind。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:3001';
const PASSWORD = 'ParadigmEval2026';
const RESULTS = path.join(__dirname, 'results');

const personaId = process.argv[2] || '';
const maxTurns = Number(process.argv[3] || 6);
if (!personaId) { console.error('usage: learn-drive.mjs <personaId> [maxTurns]'); process.exit(1); }
// 产物文件名标签（A/B 会话分开落盘，避免夜跑时同案例互相覆盖）
const outName = (base) => `${base}${process.env.LEARN_TAG ? '-' + process.env.LEARN_TAG : ''}.json`;

let cookie = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);

async function api(method, urlPath, bodyObj, { timeout = 300000 } = {}) {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, { method, headers, body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  if (!res.ok || json?.success === false) throw new Error(method + ' ' + urlPath + ' -> ' + res.status + ' ' + (json?.error?.message || json?.error || '').slice(0, 160));
  return json;
}

async function login() {
  try {
    const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name: 'pe-' + personaId, password: PASSWORD, remember: true }) });
    cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    const j = await res.json();
    if (!j.success) throw new Error('login failed');
  } catch {
    await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name: 'pe-' + personaId, password: PASSWORD, remember: true }) });
    const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name: 'pe-' + personaId, password: PASSWORD, remember: true }) });
    cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  }
}

// 水平化答脚本：按人设意图挑一组学生回合（末尾可循环「继续」）
const TURN_PRESETS = {
  weak: [
    '老师我不太懂，你能先从最基础的说起吗？我可能连概念都没建立起来。',
    '我试着答一下……是不是就是那个，呃，我说不清楚，能再讲一遍吗？',
    '哦哦好像有点感觉了。那我这样做对吗：随便先套个公式试试？',
    '还是有点晕，这道题如果换个数我还不会。能不能出个更简单的例子？',
    '明白了大概。那我现在最该补的是哪一块？我自己学的话路线对吗？',
    '好的，那我先按你说的练。',
  ],
  mid: [
    '我之前学过一点，基础的大概念知道，你可以直接讲重点吗？',
    '我理解是 X 导致 Y，对吗？但具体为什么会有这一步不太清楚。',
    '让我试试：这里应该先看结构再动手……思路对吗？',
    '那如果是另一种情况呢？比如数据量很大的时候还适用吗？',
    '懂了。你能不能帮我判断一下，我现在的水平学这块是不是进度太快了？',
    '好，我先消化一下。',
  ],
  strong: [
    '这块我熟，你直接讲最核心的机制就行，细节我可以自己补。',
    '我有个疑问：这里的方案为什么不用更简单的做法？是不是有什么权衡？',
    '我试着推一下……按这个逻辑，边界条件应该是这种情况也成立，对吧？',
    '顺着往下问：如果极端场景下这个前提不成立，整个框架会怎么塌？',
    '我已经在别的地方用过类似思路了。你觉得这条路径后面还有必要从头练吗，还是可以直接跳到难的部分？',
    '行，那我直接往后走了。',
  ],
  // 错题本人设（高二薄弱+完形作文痛点）
  file: [
    '老师我错题本里时态题错得最多，就先讲时态吧。',
    '我想想……过去完成时是不是「过去的过去」？那 had done 到底什么时候用？',
    '那这道：By the time we arrived, the movie ___，是不是填 had started？',
    '完形填空里 alone 和 lonely 我老分不清，怎么办？',
    '作文里我总写 I very like，怎么改才地道？',
    '好，那我先把这些规则抄到错题本旁边。',
  ],
  // 结构图探针（LEARN_PRESET=diagram）：学生主动索要结构/流程展示，观察 diagram 通道是否真产出
  diagram: [
    '这块我熟，你直接用最清楚的方式，把「超时那一刻起每一步会发生什么」按顺序串给我看。',
    '对，就这个流程；如果画成图更清楚就直接画出来，我想按顺序对着看。',
    '那重试之后呢？把「成功路径」和「重试路径」两条并排摆出来对比着看。',
    '按你说的我复述一遍：请求发出→对端处理完→响应丢在回程→本地判超时。接下去我该盯哪一步？',
    '行，那下一层。',
    '好，我自己消化。',
  ],
  // 位置线探针（LEARN_PRESET=position）：学生在追及/相遇题里用文字描述位置关系并索要位置线
  position: [
    '这道追及题我先说说我的理解：甲在后面，乙在前面，两个人都在往右走，甲比乙快一些。',
    '我能感觉到甲在缩短距离，但具体怎么摆我说不清——你能把他们的位置摆出来给我看看吗？',
    '对，就摆成这样。那追上的那个点，在图上应该在哪个位置？',
    '我复述一遍：甲从后面出发、乙在前面、两人同向，甲快，所以距离一直在缩短，直到甲追上乙。对吗？',
    '行，那下一步我自己试着摆。',
  ],
};

function pickPreset() {
  const override = process.env.LEARN_PRESET && TURN_PRESETS[process.env.LEARN_PRESET];
  if (override) return override;
  if (TURN_PRESETS[personaId]) return TURN_PRESETS[personaId];
  if (personaId.startsWith('mastery') || personaId.startsWith('paper-ml')) return TURN_PRESETS.strong;
  if (personaId.startsWith('file-')) return TURN_PRESETS.file;
  if (personaId.startsWith('fix-') || personaId.startsWith('exam-') || personaId.startsWith('cram') || personaId.startsWith('sprint')) return TURN_PRESETS.mid;
  return TURN_PRESETS.mid;
}

async function main() {
  fs.mkdirSync(RESULTS, { recursive: true });
  await login();

  // 找 path：优先 goal 阶段状态文件里的 pathId
  let pathId = null;
  const stateFile = path.join(RESULTS, personaId + '-r1.json');
  const stateFile2 = path.join(RESULTS, personaId + '-r2.json');
  for (const f of [stateFile, stateFile2]) {
    if (fs.existsSync(f)) {
      const st = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (st.pathId) { pathId = st.pathId; break; }
    }
  }
  if (process.env.LEARN_PATH_ID) pathId = process.env.LEARN_PATH_ID;
  if (!pathId) {
    const paths = await api('GET', '/api/learning/paths');
    pathId = (paths.data || []).find(p => p.status === 'active')?.id || (paths.data || [])[0]?.id;
  }
  if (!pathId) throw new Error('no path for ' + personaId);
  const detail = await api('GET', '/api/learning/paths/' + pathId);
  const pathData = detail.data || {};
  const allTasks = (pathData.stages || []).flatMap(s => (s.subtasks || []).map(t => ({ ...t, stageNumber: s.stageNumber })));
  const wantedTaskId = process.env.LEARN_TASK_ID || '';
  const taskIndex = Number(process.env.LEARN_TASK_INDEX || '0');
  const firstTask = (wantedTaskId && allTasks.find((t) => t.id === wantedTaskId))
    || allTasks[Number.isInteger(taskIndex) && taskIndex > 0 ? Math.min(taskIndex, allTasks.length - 1) : 0]
    || allTasks[0];
  if (!firstTask) throw new Error('no tasks');
  log(`path=${pathId} | ${pathData.name || pathData.title} | task=S${firstTask.stageNumber}T1 ${String(firstTask.title).slice(0, 30)} (${firstTask.id})`);

  // 开课
  const start = await api('POST', `/api/ai-teaching/tasks/${firstTask.id}/session`, {});
  const d = start.data || {};
  const sessionId = d.sessionId;
  let revision = d.revision;
  log(`session=${sessionId} mode=${d.mode} revision=${revision}`);
  const record = {
    personaId, pathId, taskId: firstTask.id, taskTitle: firstTask.title, sessionId,
    pathName: pathData.name || pathData.title, stageNumber: firstTask.stageNumber,
    welcome: String(d.welcomeMessage || '').slice(0, 500),
    turns: [], checkpoints: [], completion: null, endSummary: null, startedAt: Date.now(),
  };
  if (d.mode === 'completed') { record.note = 'task already completed'; fs.writeFileSync(path.join(RESULTS, outName(`learn-${personaId}`)), JSON.stringify(record, null, 1)); return; }

  let turns = pickPreset();
  // 教学质量评审：案例专属回合脚本（含误区 trap 措辞）可整体覆盖预设
  const turnsFile = process.env.LEARN_TURNS_FILE || '';
  if (turnsFile) {
    const custom = JSON.parse(fs.readFileSync(path.join(__dirname, turnsFile), 'utf8'));
    if (Array.isArray(custom) && custom.length) { turns = custom.map(String); log(`使用自定义回合脚本 ${turnsFile}（${turns.length} 轮）`); }
  }
  const seekCompletion = process.env.LEARN_COMPLETION === '1';
  const COMPLETION_TURNS = [
    '我觉得这个点我已经掌握了，我们可以收尾了，帮我结算这一节。',
    '对，我就是想完成这一节，直接进入下一阶段的内容。',
    '就按完成处理吧，剩下的我课后自己练。',
  ];
  const images = [];
  for (let i = 0; i < maxTurns; i++) {
    const message = seekCompletion && i >= 4 ? COMPLETION_TURNS[(i - 4) % COMPLETION_TURNS.length] : turns[i % turns.length];
    let r;
    try {
      r = await api('POST', `/api/ai-teaching/sessions/${sessionId}/messages`, { message, revision });
    } catch (e) {
      record.turns.push({ turn: i + 1, user: message, error: String(e).slice(0, 200) });
      break;
    }
    const d2 = r.data || {};
    revision = d2.revision ?? revision;
    const imgs = [];
    for (const im of d2.images || []) {
      const url = im.url || '';
      let file = null;
      if (url) {
        try {
          const imgRes = await fetch(url.startsWith('http') ? url : BASE + url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const ext = (url.match(/\.(png|jpe?g|webp)/i) || [])[1] || 'png';
            file = `learn-images/${personaId}-t${i + 1}.${ext}`;
            fs.mkdirSync(path.join(RESULTS, 'learn-images'), { recursive: true });
            fs.writeFileSync(path.join(RESULTS, file), buf);
          }
        } catch {}
      }
      imgs.push({ url: String(url).slice(0, 200), file, caption: im.caption, prompt: String(im.prompt || '').slice(0, 140), kind: im.kind });
    }
    if (imgs.length) images.push({ turn: i + 1, ...imgs[0] });
    const turn = {
      turn: i + 1,
      user: message,
      ai: String(d2.aiResponse || '').slice(0, 600),
      analysis: d2.analysis ? {
        cognitiveLevel: d2.analysis.cognitiveLevel, levelScore: d2.analysis.levelScore,
        confusionPoints: (d2.analysis.confusionPoints || []).slice(0, 3),
        engagement: d2.analysis.engagement, emotionalState: d2.analysis.emotionalState,
        loadIndex: d2.analysis.loadIndex,
      } : null,
      strategies: d2.strategies || [],
      knowledgePoints: (d2.knowledgePoints || []).map(k => ({ key: k.key || k.conceptKey, label: k.label, status: k.status || k.masteryLevel })).slice(0, 6),
      state: d2.state,
      checkpoint: d2.checkpoint ? { id: d2.checkpoint.id, question: String(d2.checkpoint.question || d2.checkpoint.title || '').slice(0, 200), options: (d2.checkpoint.options || []).map(o => o.content || o.text) } : null,
      isCompletion: !!d2.isCompletion,
      shouldConfirmEnd: !!d2.shouldConfirmEnd,
      endReason: d2.endReason || null,
      images: imgs,
      diagrams: (d2.diagrams || []).map((g) => ({ engine: g.engine, code: String(g.code || '').slice(0, 400), caption: g.caption })),
      figures: (d2.figures || []).map((f) => ({ engine: f.engine, kind: f.kind, marks: (f.marks || []).length, spans: (f.spans || []).length, guides: (f.guides || []).length, caption: f.caption })),
      quickReplies: (d2.quickReplies || d2.suggestedReplies || []).slice(0, 4),
      revision,
    };
    record.turns.push(turn);
    log(`turn${i + 1}: level=${turn.analysis?.cognitiveLevel}/${turn.analysis?.levelScore} kp=${turn.knowledgePoints.length} img=${imgs.length} diagram=${turn.diagrams.length} figure=${turn.figures.length} ckpt=${turn.checkpoint ? 'Y' : 'N'} complete=${turn.isCompletion}`);

    // 检查点：按水平作答（弱=第一个选项，中=第二个，强=第二个）
    if (turn.checkpoint) {
      const cp = d2.checkpoint;
      const opts = cp.options || [];
      const pickIdx = personaId.startsWith('mastery') || personaId.startsWith('paper-ml') ? (opts.length > 1 ? 1 : 0) : 0;
      const selectedOptionIds = opts[pickIdx]?.id ? [opts[pickIdx].id] : undefined;
      try {
        const cs = await api('POST', `/api/ai-teaching/sessions/${sessionId}/checkpoints/${cp.id}/submit`, selectedOptionIds ? { selectedOptionIds, revision } : { answerText: '我试试：' + message.slice(0, 40), revision });
        const cd = cs.data || {};
        revision = cd.revision ?? revision;
        record.checkpoints.push({
          id: cp.id, question: turn.checkpoint.question, picked: pickIdx,
          correct: cd.correct ?? cd.judgement?.correct ?? null,
          feedback: String(cd.feedback || cd.tutorReply || cd.aiResponse || '').slice(0, 300),
          images: (cd.images || []).length,
        });
        log(`  checkpoint submitted: correct=${record.checkpoints.at(-1).correct}`);
      } catch (e) { record.checkpoints.push({ id: cp.id, error: String(e).slice(0, 160) }); }
    }
    if (turn.isCompletion) {
      record.completion = { atTurn: i + 1, ai: String(d2.aiResponse || '').slice(0, 400), quickReplies: turn.quickReplies };
      // 完课调整卡：finalize 触发 wrapup（LLM 数十秒），拿 actionPlan/建议
      try {
        const fin = await api('POST', `/api/ai-teaching/sessions/${sessionId}/finalize`, {
          action: 'complete_task', revision, reason: 'task-completed', actualMinutes: 25, subjectiveDifficulty: 3,
        }, { timeout: 240000 });
        const fd = fin.data || {};
        record.completion.finalization = {
          taskCompletion: fd.finalization?.taskCompletion || fd.taskCompletion || null,
          topicSummary: String(fd.summary?.topicSummary || '').slice(0, 300),
          practiceAdvice: String(fd.summary?.practiceAdvice || '').slice(0, 300),
          actionPlan: (fd.actionPlan || []).slice(0, 6).map(a => (typeof a === 'string' ? a : a.title || a.action || JSON.stringify(a)).slice(0, 200)),
          nextStageHint: fd.nextStageHint || fd.nextStageSuggestion || null,
          keys: Object.keys(fd).join(','),
        };
        log(`  finalize: completion=${record.completion.finalization.taskCompletion} actionPlan=${record.completion.finalization.actionPlan.length}`);
      } catch (e) { record.completion.finalization = { error: String(e).slice(0, 200) }; }
      break;
    }
    await sleep(3000);
  }

  // 结课（若未完课）→ 拿结算建议
  if (!record.completion) {
    try {
      const end = await api('POST', `/api/ai-teaching/sessions/${sessionId}/end`, { revision });
      revision = end.data?.revision ?? revision;
      record.endSummary = { ended: true, revision };
    } catch (e) { record.endSummary = { endError: String(e).slice(0, 160) }; }
  }
  try {
    const fin = await api('GET', `/api/ai-teaching/sessions/${sessionId}/finalization`, undefined, { timeout: 120000 });
    const f = fin.data || {};
    record.endSummary = {
      ...record.endSummary,
      topicSummary: String(f.summary?.topicSummary || '').slice(0, 300),
      practiceAdvice: String(f.summary?.practiceAdvice || '').slice(0, 300),
      actionPlan: (f.actionPlan || []).slice(0, 5).map(a => (typeof a === 'string' ? a : a.title || a.action || JSON.stringify(a)).slice(0, 160)),
      evaluation: f.evaluation ? { ktl: f.evaluation.sessionKtl, lss: f.evaluation.sessionLss, lf: f.evaluation.sessionLf } : null,
      reviewHints: (f.reviewHints || []).slice(0, 3),
    };
  } catch (e) { record.endSummary = { ...record.endSummary, finError: String(e).slice(0, 160) }; }

  record.images = images;
  record.imageTiming = images.map(i => `turn${i.turn}`);
  fs.writeFileSync(path.join(RESULTS, outName(`learn-${personaId}`)), JSON.stringify(record, null, 1));
  log(`DONE learn-${personaId}.json | turns=${record.turns.length} images=${images.length} checkpoints=${record.checkpoints.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
