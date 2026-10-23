/**
 * 离线评审 · 路径生成质量（learning_paths + milestones + subtasks）
 *
 * Rubric 以仓内 path-reviewer 的 CIDDP 五维为底（prompts/skill.path-reviewer.md），
 * 补上「可行性」与结构事实（预算比、验收标准覆盖、KC 覆盖），避免只靠模型印象打分。
 * 决策由 ds4.1 做（默认 deepseek-v4.1-flash），K 次取中位数/多数。
 */
import {
  clip, jparse, hasVerbatimQuote, validateIssues, weightedScore, majority,
} from './lib.mjs';

export const DIMENSIONS = [
  'goalAlignment', 'integrity', 'granularity', 'specificity', 'progression', 'feasibility',
];
export const DIMENSION_LABELS = {
  goalAlignment: '目标贴合',
  integrity: '结构完整性',
  granularity: '粒度与课时',
  specificity: '任务具体性',
  progression: '递进与复用',
  feasibility: '平台可行性',
};
export const WEIGHTS = {
  goalAlignment: 0.20, integrity: 0.20, granularity: 0.15,
  specificity: 0.15, progression: 0.15, feasibility: 0.15,
};
export const FLAG_KEYS = ['domainViolation', 'prerequisiteGap', 'budgetMismatch', 'placeholderTask', 'duplicateTask'];
export const FLAG_LABELS = {
  domainViolation: '越界承诺（平台做不到的实体操作）',
  prerequisiteGap: '前置缺失/顺序错误',
  budgetMismatch: '课时与预算明显不符',
  placeholderTask: '占位/空泛任务',
  duplicateTask: '任务重复',
};

export function selectPathCases(db, {
  limit = 20, days = 30, scope = 'all', emailLike = null, ids = null, minTasks = 3,
} = {}) {
  const since = Date.now() - days * 86400000;
  const scopeSql = scope === 'virtual' ? ' AND u.isVirtualLearner = 1'
    : scope === 'real' ? ' AND u.isVirtualLearner = 0' : '';
  const emailSql = emailLike ? ' AND u.email LIKE ?' : '';
  const rows = db.prepare(`
    SELECT p.id AS pid, p.userId AS uid, u.email, u.isVirtualLearner AS virtual,
           p.title, p.subject, p.status, p.estimatedHours, p.aiPromptTemplate, p.createdAt
      FROM learning_paths p JOIN users u ON u.id = p.userId
     WHERE p.status IN ('active', 'completed') AND p.aiPromptTemplate IS NOT NULL
       AND p.createdAt >= ?${scopeSql}${emailSql}
     ORDER BY p.createdAt DESC`).all(...[since, ...(emailLike ? [emailLike] : [])]);
  const wanted = ids ? new Set(ids) : null;
  const cases = [];
  for (const row of rows) {
    if (wanted && !wanted.has(row.pid)) continue;
    const built = buildPathCase(db, row);
    if (!built || built.taskCount < minTasks) continue;
    cases.push(built);
    if (cases.length >= limit) break;
  }
  return cases;
}

function loadMilestones(db, pathId) {
  return db.prepare(`
    SELECT id, stageNumber, title, description, goal, coreConceptName, estimatedHours, "order"
      FROM milestones WHERE learningPathId = ? ORDER BY "order", stageNumber`).all(pathId);
}

function loadTasks(db, pathId) {
  return db.prepare(`
    SELECT s.id, s.milestoneId, s.title, s.description, s.taskType, s.estimatedMinutes,
           s.acceptanceCriteria, s.coreConcept, s.linkedConceptId, s.linkedConceptName,
           s.cognitiveLevel, s.knowledgeType, s.status, s."order"
      FROM subtasks s JOIN milestones m ON m.id = s.milestoneId
     WHERE m.learningPathId = ? ORDER BY m."order", s."order"`).all(pathId);
}

const normTitle = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

function kcSummary(template) {
  const ann = template?.kcAnnotation;
  if (!ann || typeof ann !== 'object') return null;
  const groups = Array.isArray(ann.conceptKcs) ? ann.conceptKcs : [];
  const kcs = groups.flatMap((g) => Array.isArray(g?.kcs) ? g.kcs : []);
  const links = Array.isArray(ann.taskKcLinks) ? ann.taskKcLinks : [];
  const nodes = Array.isArray(ann.kcGraph?.nodes) ? ann.kcGraph.nodes : [];
  const edges = Array.isArray(ann.kcGraph?.edges) ? ann.kcGraph.edges : [];
  return { groups: groups.length, kcs: kcs.length, links: links.length, nodes: nodes.length, edges: edges.length, linksRaw: links, kcsRaw: kcs };
}

export function buildPathCase(db, row) {
  const template = jparse(row.aiPromptTemplate, {}) || {};
  const milestones = loadMilestones(db, row.pid);
  const tasks = loadTasks(db, row.pid);
  if (!milestones.length || tasks.length < 1) return null;

  const conf = template?.normalizedInput?.confirmedProposal || {};
  const ni = template?.normalizedInput || {};
  const goalLines = [
    conf.learningDirection ? `学习方向：${clip(conf.learningDirection, 700)}` : '',
    conf.firstDeliverable ? `首个交付物：${clip(conf.firstDeliverable, 400)}` : '',
    Array.isArray(conf.keyStages) && conf.keyStages.length ? `关键阶段：${conf.keyStages.map((s) => clip(s, 160)).join(' / ')}` : '',
    conf.successCriteria ? `成功标准：${clip(JSON.stringify(conf.successCriteria), 500)}` : '',
    conf.outOfScope || conf.out_of_scope ? `明确不做：${clip(JSON.stringify(conf.outOfScope || conf.out_of_scope), 400)}` : '',
  ].filter(Boolean);
  const learnerLines = [
    ni.skillLevel ? `水平：${ni.skillLevel}` : '',
    ni.timePerDay ? `可用时间：${clip(ni.timePerDay, 200)}` : '',
    ni.description ? `背景：${clip(ni.description, 500)}` : '',
  ].filter(Boolean);

  const totalMinutes = tasks.reduce((sum, t) => sum + (Number(t.estimatedMinutes) || 0), 0);
  const budget = template?.budgetConservation?.target ?? row.estimatedHours ?? null;
  const budgetMinutes = budget ? Number(budget) * 60 : null;
  const ratio = budgetMinutes && budgetMinutes > 0 ? totalMinutes / budgetMinutes : null;
  const acCovered = tasks.filter((t) => String(t.acceptanceCriteria || '').trim()).length;
  const titleCounts = new Map();
  for (const t of tasks) {
    const key = normTitle(t.title);
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  const duplicates = [...titleCounts.entries()].filter(([, n]) => n > 1);
  const kc = kcSummary(template);
  const linkedTitles = new Set((kc?.linksRaw || []).map((l) => normTitle(l?.taskTitle)));
  const kcCoveredTasks = tasks.filter((t) => linkedTitles.has(normTitle(t.title))).length;

  const metrics = [
    `里程碑 ${milestones.length}｜任务 ${tasks.length}｜总预计 ${totalMinutes} 分钟`,
    budgetMinutes ? `预算 ${Math.round(budgetMinutes)} 分钟（${budget} 小时）｜实际/预算比 ${ratio !== null ? ratio.toFixed(2) : '?'}` : '预算：未记录',
    `有验收标准的任务 ${acCovered}/${tasks.length}`,
    kc ? `KC 组 ${kc.groups}｜KC ${kc.kcs}｜任务-KC 链接 ${kc.links}（覆盖任务 ${kcCoveredTasks}/${tasks.length}）｜图节点 ${kc.nodes}｜前置边 ${kc.edges}` : 'KC 标注：缺失',
    duplicates.length ? `重复标题 ${duplicates.length} 组：${duplicates.map(([k, n]) => `${k}×${n}`).join('、')}` : '重复标题：无',
    row.status ? `路径状态：${row.status}` : '',
  ].filter(Boolean);

  const milestoneLines = milestones.map((m) => {
    const own = tasks.filter((t) => t.milestoneId === m.id);
    const taskLines = own.map((t, i) => {
      return `  ${i + 1}. ${clip(t.title, 160)}｜${t.taskType || '?'}｜${t.estimatedMinutes ?? '?'} 分钟`
        + `｜概念 ${clip(t.linkedConceptName || t.coreConcept || '', 100) || '（无）'}`
        + `\n     说明：${clip(t.description || '', 260) || '（无）'}`
        + `\n     验收：${clip(t.acceptanceCriteria || '', 260) || '（无）'}`;
    }).join('\n');
    return `阶段 ${m.stageNumber ?? '?'}：${clip(m.title || '', 200)}`
      + `\n  目标：${clip(m.goal || '', 400) || '（无）'}`
      + `\n  核心概念：${clip(m.coreConceptName || '', 160) || '（无）'}｜预计 ${m.estimatedHours ?? '?'} 小时`
      + (taskLines ? `\n${taskLines}` : '\n  （无任务）');
  }).join('\n');

  const kcLines = kc
    ? `KC 列表（前 40）：${(kc.kcsRaw || []).slice(0, 40).map((k) => clip(k?.name, 60)).filter(Boolean).join('；')}`
    : '（无 kcAnnotation）';

  const recordedReview = template?.pathReview
    ? `【生成时评审器输出（参考，不是真值）】${clip(JSON.stringify(template.pathReview), 800)}`
    : '';

  const block = [
    `路径：${row.title || '(无标题)'}｜学科：${row.subject || '(无)'}｜预计 ${row.estimatedHours ?? '?'} 小时`,
    goalLines.length ? `【目标与确认方案】\n${goalLines.join('\n')}` : '【目标与确认方案】（缺失）',
    learnerLines.length ? `【学习者背景】\n${learnerLines.join('\n')}` : '',
    `【结构事实（代码统计，可直接引用）】\n${metrics.join('\n')}`,
    `【里程碑与任务】\n${milestoneLines}`,
    `【KC 标注】\n${kcLines}`,
    recordedReview,
  ].filter(Boolean).join('\n\n');

  return {
    kind: 'path',
    id: row.pid,
    uid: row.uid,
    email: row.email,
    virtual: Boolean(row.virtual),
    title: row.title,
    subject: row.subject,
    taskCount: tasks.length,
    milestoneCount: milestones.length,
    createdAt: row.createdAt,
    metrics: { totalMinutes, budgetMinutes, ratio, acCovered, taskCount: tasks.length, duplicates: duplicates.length, kcCoveredTasks },
    block,
  };
}

const RUBRIC = `你是独立的学习路径质量评审员。评审对象是一条已经生成的学习路径（目标、里程碑、任务、课时与 KC 标注）。
只输出一个 JSON 对象。

六个维度，每项 0-1（0.5 = 证据不足/中性；不要因为单个小缺陷否定整条路径）：
- goalAlignment 目标贴合：路径是否服务确认过的学习方向与首个交付物；有没有夹带无关内容或偏离用户目标。
- integrity 结构完整性：前置知识是否被覆盖且顺序正确；KC 是否有对应任务；有没有「要学 B 但 A 从未出现」的断链。
- granularity 粒度与课时：里程碑/任务数量与单任务时长是否合理；总课时是否与用户可用时间/预算匹配。
- specificity 任务具体性：任务是否有可观察的产出或验收标准；有没有「了解/理解 X」这类无法验收的空泛任务。
- progression 递进与复用：难度是否逐阶段上升；核心概念是否在后继阶段被复用而不是一次性出现；有无重复任务。
- feasibility 平台可行性：是否只安排对话平台能教/能判的内容；实体操作是否诚实收窄到线下并说明限制；有没有假实操承诺。

五个二元问题（true = 存在该问题）：
- domainViolation：承诺平台无法观测/纠偏的实体操作（如要求拍照、录屏、现场演奏、驾驶），或假装能判实体动作质量。
- prerequisiteGap：后继任务依赖的前置概念从未被引入，或阶段顺序与 KC 前置边矛盾。
- budgetMismatch：总课时与用户预算/可用时间明显不符（结构事实里给了比值，可引用）。
- placeholderTask：任务只有空泛动词/标题，没有具体内容与验收标准。
- duplicateTask：两个任务实质重复（同一概念、同一产出）。

判定纪律：
1. 以「结构事实」为准，不要自行重算课时；但可以指出事实之间的不一致。
2. 只根据给定记录判断；不确定的维度给 0.5，不确定的 flag 给 false。
3. 每个判 true 的 flag 必须给至少 1 条逐字引文（从记录里原样复制 ≤120 字）；给不出引文的会被降级为 false。
4. 每个低分维度（<0.6）至少给 1 条 issue，引用具体阶段/任务编号或原话。
5. issues 最多 6 条，severity 与扣分幅度对应，suggestion 要具体到「第几个阶段/任务怎么改」。

输出严格 JSON（不要 markdown 代码块、不要表外字段）：
{
  "dimensions": {"goalAlignment":0.0,"integrity":0.0,"granularity":0.0,"specificity":0.0,"progression":0.0,"feasibility":0.0},
  "flags": {"domainViolation":false,"prerequisiteGap":false,"budgetMismatch":false,"placeholderTask":false,"duplicateTask":false},
  "evidence": {"<判 true 的 flag 名>": ["逐字引文"]},
  "issues": [{"dimension":"integrity","severity":"low|medium|high","quote":"原话/阶段编号","suggestion":"具体改法"}],
  "confidence": 0.0
}`;

export function buildPathPrompt(block) {
  return `${RUBRIC}\n\n=== 案例 ===\n${block}`;
}

export function validatePathVerdict(raw, block) {
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
  const hardFail = flags.domainViolation || flags.prerequisiteGap;
  result.verdict = hardFail || (result.overall !== null && result.overall < 0.70) ? 'fail' : 'pass';
  return result;
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

export function aggregatePathJudgments(judgments) {
  const valid = judgments.filter((j) => j && j.ok);
  if (!valid.length) return null;
  const dimensions = {};
  for (const key of DIMENSIONS) dimensions[key] = medianOf(valid.map((j) => j.dimensions[key]));
  const flags = {};
  for (const key of FLAG_KEYS) flags[key] = majority(valid.map((j) => j.flags[key]));
  const overall = weightedScore(dimensions, WEIGHTS);
  const hardFail = flags.domainViolation || flags.prerequisiteGap;
  return {
    dimensions,
    flags,
    overall,
    verdict: hardFail || (overall !== null && overall < 0.70) ? 'fail' : 'pass',
    issues: dedupeIssues(valid.flatMap((j) => j.issues)),
    invalidQuotes: [...new Set(valid.flatMap((j) => j.invalidQuotes || []))],
    samples: valid.length,
    confidence: medianOf(valid.map((j) => j.confidence ?? 0.5)),
  };
}

export const PATH_JUDGE_NAME = 'offline-path-v1';
