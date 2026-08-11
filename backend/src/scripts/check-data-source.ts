/**
 * prompts:data-source:check —— dataSource 声明校验（P4 缩小版，W5 warn 级三通道）
 *
 * 语义（doc/DATASOURCE_P4_SURVEY.md §3.1）：dataSource 声明的是"编排层为该 skill
 * 组装 LLM 输入时读取的数据源"（输入血缘），不是 handler 代码直读（handler 层零直读，
 * 仅 learner-model/mcp-tool 两特例，见例外账）。校验对象 = skills.yaml 26 条 dataSource。
 *
 * 三通道：
 *   ① db 通道（W5a 未声明 / W5b 过期）：
 *      静态扫描以 executeSkill 调用点为锚（CALL_SITE_MANIFEST，可靠性 ~100%，见调查 §4.1①），
 *      用花括号匹配提取调用点所在函数体，抓 `prisma.<table>.<read>` / `systemPrisma.*` /
 *      `tx.*` 读操作 + 服务封装读（SERVICE_READ_MAP，小且经调查核对）；跨函数/跨文件组装
 *      读经 CROSS_FILE_EVIDENCE 登记（每条带 file:line 证据，人工复核兜底，调查 §4.1③）。
 *      降级说明：静态数据流分析非完备（服务封装内部、动态键、条件分支），故：
 *        - 声明表 ∈ prisma schema 模型名集合 = ERROR 级（fail-fast，可证明）
 *        - W5a/W5b = WARN 级（warn 不阻断，白名单 = EXEMPT_UNDECLARED + CROSS_FILE_EVIDENCE）
 *   ② sandbox 通道：dataSource.sandbox 声明的 agent 前缀 vs 该 skill core.yaml inputs 中
 *      `ref: sandbox:<prefix>.*` 实际引用前缀集合，双向 diff，WARN 级。
 *   ③ 例外账（WARN 级）：mcp-tool（db 必须为空 + mcpTools 非空）、learner-model（handler
 *      直读反例，db 必须非空）、僵尸 3 条（course-design/basic-evaluator/goal-alignment-checker
 *      与 semantic-freeze-judge 平台直调，db/sandbox 必须为空）。
 *
 * 退出码：error 级发现 >0 → 1；W5 warn 级仅输出，不阻断（调查 §4.1⑤ warn 级决策）。
 *
 * readiness W5 占位对接：skills-readiness.service.ts 的 W5 项由并行路（readiness 服务改造）
 * 实现；本脚本独立可跑，与 readiness 服务文件零冲突，本路不碰 readiness 相关文件。
 */
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { SkillsBook, SkillEntry } from '../services/skill-registry/skills-file';
import { loadSkillsFile, REPO_ROOT } from '../services/skill-registry/skills-file';

// ---------------------------------------------------------------------------
// ① 常量：prisma schema 模型名（主库 + 系统库）
// ---------------------------------------------------------------------------

function loadPrismaModelNames(): Set<string> {
  const names = new Set<string>();
  for (const schemaPath of ['backend/prisma/schema.prisma', 'backend/prisma/system/schema.prisma']) {
    const text = fs.readFileSync(path.resolve(REPO_ROOT, schemaPath), 'utf-8');
    for (const match of text.matchAll(/^model\s+(\w+)/gm)) {
      names.add(match[1]);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// ② 常量：sandbox agent 前缀（SANDBOX_AGENT_ALIASES 简名，agent-contract-view.ts:42-48）
// ---------------------------------------------------------------------------

const SANDBOX_PREFIXES = ['goal', 'path', 'teaching', 'profile', 'simulation'] as const;
const SANDBOX_PREFIX_TO_AGENT: Record<string, string> = {
  goal: 'goal-agent',
  path: 'path-agent',
  teaching: 'teaching-agent',
  profile: 'profile-agent',
  simulation: 'simulation-agent',
};

// ---------------------------------------------------------------------------
// ③ executeSkill 生产调用点清单（调查 §附 证据索引，file:line 精确锚点）
//    路径相对仓库根（backend/ 前缀与 skills.yaml handlerRef 同风格）。
// ---------------------------------------------------------------------------

interface CallSite {
  file: string;
  line: number;
}

const CALL_SITE_MANIFEST: Record<string, CallSite[]> = {
  'goal-conversation': [
    { file: 'backend/src/services/learning/goal-conversation.service.ts', line: 636 },
  ],
  'path-planning': [
    { file: 'backend/src/services/learning/learning.service.ts', line: 2509 },
  ],
  'stage-designer': [
    { file: 'backend/src/services/learning/learning.service.ts', line: 2933 },
    { file: 'backend/src/services/learning/learning.service.ts', line: 4093 },
  ],
  'teaching-turn': [
    { file: 'backend/src/services/ai-teaching/AITeachingCoordinator.ts', line: 1399 },
  ],
  'peer-reinforcement': [
    { file: 'backend/src/services/ai-teaching/AITeachingCoordinator.ts', line: 1470 },
    { file: 'backend/src/services/ai-teaching/AITeachingCoordinator.ts', line: 2588 },
  ],
  'session-wrapup': [
    { file: 'backend/src/services/ai-teaching/AITeachingCoordinator.ts', line: 1842 },
  ],
  'adaptive-guidance-copy': [
    { file: 'backend/src/services/learner/DashboardGuidanceSnapshotService.ts', line: 149 },
    { file: 'backend/src/services/learner/LearningStateGuidanceService.ts', line: 89 },
  ],
  'lesson-knowledge-enricher': [
    { file: 'backend/src/services/learner/LessonKnowledgeEnrichmentConsumer.ts', line: 27 },
  ],
  'virtual-learner-persona-designer': [
    { file: 'backend/src/routes/admin/virtual-learners.ts', line: 927 },
    { file: 'backend/src/routes/admin/virtual-learners.ts', line: 1237 },
    { file: 'backend/src/routes/admin/virtual-learners.ts', line: 1268 },
  ],
  'virtual-learner-scenario-designer': [
    { file: 'backend/src/routes/admin/virtual-learners.ts', line: 1208 },
    { file: 'backend/src/routes/admin/virtual-learners.ts', line: 1315 },
  ],
  'virtual-learner-goal-dialogue-simulator': [
    { file: 'backend/src/coordinators/simulation.coordinator.ts', line: 811 },
  ],
  'virtual-learner-path-evaluator': [
    { file: 'backend/src/coordinators/simulation.coordinator.ts', line: 2126 },
  ],
  'virtual-learner-learn-turn-simulator': [
    { file: 'backend/src/coordinators/simulation.coordinator.ts', line: 2783 },
    { file: 'backend/src/virtual-lab/quick-learn/quick-learn.service.ts', line: 560 },
  ],
  'virtual-learner-referee': [
    { file: 'backend/src/virtual-lab/blackbox-runner.ts', line: 540 },
  ],
  'virtual-learner-actor-auditor': [
    { file: 'backend/src/virtual-lab/blackbox-runner.ts', line: 605 },
  ],
  'teaching-opening-generator': [
    { file: 'backend/src/services/ai-teaching/AITeachingCoordinator.ts', line: 1261 },
  ],
  'learner-progress-report': [
    { file: 'backend/src/services/learner/LearnerProgressService.ts', line: 251 },
  ],
  'generic-chat': [
    { file: 'backend/src/services/ai/ai.service.ts', line: 340 },
  ],
  'course-design': [
    { file: 'backend/src/services/ai/ai.service.ts', line: 812 },
  ],
  'skill-author': [
    { file: 'backend/src/services/skill-author/index.ts', line: 47 },
  ],
  'skill-compiler': [
    { file: 'backend/src/services/skill-author/index.ts', line: 145 },
  ],
  // 例外账：无 executeSkill 调用点（learner-model=handler 直读 / 僵尸 / 平台直调）
  'learner-model': [],
  'mcp-tool': [],
  'basic-evaluator': [],
  'goal-alignment-checker': [],
  'semantic-freeze-judge': [],
};

// ---------------------------------------------------------------------------
// ④ 服务封装读映射（调查 §4.1③：服务层粗粒度，source=服务名，不展开内部实现）
//    键为调用点函数体内出现的调用模式（文件名限定），值为该服务读的表集合。
// ---------------------------------------------------------------------------

const SERVICE_READ_MAP: Record<string, Record<string, string[]>> = {
  'backend/src/services/ai-teaching/AITeachingCoordinator.ts': {
    'teachingSessionRepository.': ['teaching_sessions'],
    'buildTeachingScenarioContext(': ['subtasks', 'milestones', 'learning_paths', 'teaching_sessions', 'learning_metrics', 'learner_evidence'],
    'buildTeachingTurnInput(': ['teaching_sessions', 'agent_field_routings'],
    'assembleTeachingTurnChannels(': ['agent_field_routings'],
    'learnerSnapshotService.getSnapshot(': ['learner_evidence', 'teaching_sessions', 'subtasks', 'learning_paths'],
  },
  'backend/src/services/learning/goal-conversation.service.ts': {
    'assembleGoalHandoff(': ['agent_field_routings'],
  },
  'backend/src/services/learning/learning.service.ts': {
    'assembleStageDesignerChannels(': ['agent_field_routings'],
    'learnerProgressService.evaluateTaskCompletion(': [],
  },
  'backend/src/services/learner/assemble-learning-state.ts': {
    'assembleLearningState(': ['users', 'learning_paths', 'subtasks', 'teaching_sessions', 'learner_evidence', 'learning_metrics'],
  },
  'backend/src/services/learner/DashboardGuidanceSnapshotService.ts': {
    'assembleLearningState(': ['users', 'learning_paths', 'subtasks', 'teaching_sessions', 'learner_evidence', 'learning_metrics'],
    'learnerStateSummaryService.': [],
  },
  'backend/src/services/learner/LearningStateGuidanceService.ts': {
    'assembleLearningState(': ['users', 'learning_paths', 'subtasks', 'teaching_sessions', 'learner_evidence', 'learning_metrics'],
    'learningDecisionFeedService.': [],
  },
  'backend/src/virtual-lab/blackbox-runner.ts': {
    'this.getSession(': ['virtual_sessions'],
    'this.buildRefereeInput(': ['virtual_learner_profiles', 'teaching_sessions', 'learning_metrics'],
    'this.buildActorAuditInput(': ['virtual_learner_profiles'],
    'this.getExperimentSnapshot(': ['virtual_learner_profiles'],
    'learningStateService.': ['learning_metrics', 'teaching_sessions'],
  },
  'backend/src/coordinators/simulation.coordinator.ts': {
    'this.getVirtualSession(': ['virtual_sessions', 'virtual_learner_profiles'],
    'this.getGoalConversation(': ['goal_conversations'],
  },
  'backend/src/routes/admin/virtual-learners.ts': {
    'buildRecentScenarioHints(': ['virtual_learner_profiles'],
    'ensureProfileStoryPool(': ['virtual_learner_profiles'],
  },
  'backend/src/services/learning/learning-state.service.ts': {
    'stateTrackingService.': ['learning_metrics', 'teaching_sessions'],
  },
};

// 跨文件/跨函数组装读证据（调用点函数体扫描覆盖不到，但声明有据；每条 = file:line 证据）
const CROSS_FILE_EVIDENCE: Record<string, Array<{ table: string; file: string; line: number }>> = {
  'path-planning': [
    // 上游 goal 链：buildGoalPathRequest 读 goal_conversations.collectedData（含 goalHandoffFields/structuredData/conversationHistory）
    { table: 'goal_conversations', file: 'backend/src/services/learning/goal-conversation.service.ts', line: 793 },
    { table: 'goal_conversations', file: 'backend/src/services/learning/goal-conversation.service.ts', line: 808 },
    // path 输入配置：path.coordinator 侧 getPathAgentInputConfig
    { table: 'agent_lab_configs', file: 'backend/src/coordinators/path.coordinator.ts', line: 371 },
    { table: 'agent_lab_configs', file: 'backend/src/services/agentConfig.service.ts', line: 101 },
  ],
  'stage-designer': [
    // learning_paths + 内嵌 milestones（+subtasks）读出 aiPromptTemplate/cognitiveDesign/sceneFraming
    { table: 'learning_paths', file: 'backend/src/services/learning/learning.service.ts', line: 2829 },
    { table: 'milestones', file: 'backend/src/services/learning/learning.service.ts', line: 2882 },
    { table: 'subtasks', file: 'backend/src/services/learning/learning.service.ts', line: 4062 },
    { table: 'milestones', file: 'backend/src/services/learning/learning.service.ts', line: 4090 },
  ],
  'virtual-learner-goal-dialogue-simulator': [
    { table: 'virtual_sessions', file: 'backend/src/coordinators/simulation.coordinator.ts', line: 587 },
    { table: 'virtual_learner_profiles', file: 'backend/src/coordinators/simulation.coordinator.ts', line: 590 },
    { table: 'goal_conversations', file: 'backend/src/coordinators/simulation.coordinator.ts', line: 602 },
    { table: 'goal_conversations', file: 'backend/src/coordinators/simulation.coordinator.ts', line: 1661 },
  ],
  'virtual-learner-learn-turn-simulator': [
    { table: 'milestones', file: 'backend/src/coordinators/simulation.coordinator.ts', line: 2555 },
    { table: 'subtasks', file: 'backend/src/coordinators/simulation.coordinator.ts', line: 2555 },
    { table: 'virtual_learner_profiles', file: 'backend/src/virtual-lab/quick-learn/quick-learn.service.ts', line: 99 },
    { table: 'subtasks', file: 'backend/src/virtual-lab/quick-learn/quick-learn.service.ts', line: 104 },
    { table: 'milestones', file: 'backend/src/virtual-lab/quick-learn/quick-learn.service.ts', line: 583 },
  ],
  'teaching-opening-generator': [
    // 输入 = buildTeachingScenarioContext 产物（startSession 组装，非 generateOpening 自身）
    { table: 'teaching_sessions', file: 'backend/src/services/ai-teaching/AITeachingCoordinator.ts', line: 1010 },
    { table: 'subtasks', file: 'backend/src/services/ai-teaching/TeachingContextBuilder.ts', line: 393 },
    { table: 'milestones', file: 'backend/src/services/ai-teaching/TeachingContextBuilder.ts', line: 397 },
    { table: 'learning_paths', file: 'backend/src/services/ai-teaching/TeachingContextBuilder.ts', line: 401 },
    { table: 'teaching_sessions', file: 'backend/src/services/ai-teaching/TeachingContextBuilder.ts', line: 316 },
    // learner_evidence/learning_metrics 经服务封装读（TeachingContextBuilder 内服务调用）
    { table: 'learner_evidence', file: 'backend/src/services/ai-teaching/TeachingContextBuilder.ts', line: 420 },
    { table: 'learning_metrics', file: 'backend/src/services/ai-teaching/TeachingContextBuilder.ts', line: 419 },
  ],
};

// 共享函数体误报豁免（同一函数内为另一 skill 组装而读的表，不属于本 skill 输入；人工核对）
const EXEMPT_UNDECLARED: Record<string, string[]> = {
  // processStudentMessage 函数体同时承载 teaching-turn（buildTeachingScenarioContext）
  // 与 peer-reinforcement（仅取 session + 回合内存输出），后者豁免前者读的表
  'peer-reinforcement': ['subtasks', 'milestones', 'learning_paths', 'learning_metrics', 'learner_evidence', 'agent_field_routings'],
};

// ---------------------------------------------------------------------------
// ⑤ 静态扫描器：调用点锚定 → 函数体提取 → prisma/服务读表
// ---------------------------------------------------------------------------

const FUNCTION_OPENER_RE =
  /^\s*(?:export\s+)?(?:private\s+|protected\s+|public\s+)?(?:static\s+)?(?:async\s+)?(?:function\s+)?[A-Za-z_$][\w$]*\s*\(/;
const ARROW_OPENER_RE =
  /^\s*(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(/;
const ROUTER_OPENER_RE =
  /^\s*(?:router|app)\.(?:get|post|put|delete|patch|use)\([^;]*?,\s*async\s*\([^)]*\)\s*=>/;
const READ_METHOD_RE =
  /\.(findFirst|findMany|findUnique|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy|queryRaw|aggregateRaw)\b/;

function maskCode(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '/* */')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '`x`')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/** 以函数起始行号为锚，用花括号配对找函数体结束行；模板串/字符串/注释已掩码，误配概率低（warn 级可容忍） */
function findFunctionBody(lines: string[], openerIdx: number): { start: number; end: number } | null {
  let depth = 0;
  let started = false;
  for (let i = openerIdx; i < lines.length; i += 1) {
    const masked = maskCode(lines[i]);
    for (const ch of masked) {
      if (ch === '{') {
        depth += 1;
        started = true;
      } else if (ch === '}') {
        depth -= 1;
      }
    }
    if (started && depth <= 0) {
      return { start: openerIdx, end: i };
    }
  }
  return null;
}

function extractEnclosingFunction(lines: string[], callLineIdx: number): { start: number; end: number } | null {
  for (let i = callLineIdx - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const isOpener = FUNCTION_OPENER_RE.test(line) || ARROW_OPENER_RE.test(line) || ROUTER_OPENER_RE.test(line);
    if (!isOpener) continue;
    const body = findFunctionBody(lines, i);
    if (body && callLineIdx >= body.start && callLineIdx <= body.end) {
      return body;
    }
    // 该候选函数体不包含调用点（如 router 回调误匹配），继续向前找更外层
  }
  return null;
}

function scanFunctionBody(filePath: string, body: { start: number; end: number }): Map<string, string> {
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const found = new Map<string, string>();
  const add = (table: string, evidenceLine: number) => {
    if (!found.has(table)) found.set(table, `${path.basename(filePath)}:${evidenceLine + 1}`);
  };

  const relative = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  const serviceMap = SERVICE_READ_MAP[relative] || {};

  for (let i = body.start; i <= body.end; i += 1) {
    const line = lines[i];
    // 直读（prisma / systemPrisma / tx）
    const prismaRe = /\b(?:prisma|systemPrisma|tx)\.(\w+)\.(findFirst|findMany|findUnique|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy|queryRaw|aggregateRaw)\b/g;
    let m: RegExpExecArray | null;
    while ((m = prismaRe.exec(line)) !== null) {
      add(m[1], i);
    }
    // 服务封装读
    for (const [pattern, tables] of Object.entries(serviceMap)) {
      if (line.includes(pattern)) {
        for (const table of tables) add(table, i);
      }
    }
  }
  return found;
}

function scanSkillTables(skillId: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const site of CALL_SITE_MANIFEST[skillId] || []) {
    const filePath = path.resolve(REPO_ROOT, site.file);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    const body = extractEnclosingFunction(lines, site.line - 1);
    if (!body) continue;
    for (const [table, evidence] of scanFunctionBody(filePath, body)) {
      if (!found.has(table)) found.set(table, evidence);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// ⑥ sandbox 通道：core.yaml inputs 实际 sandbox refs
// ---------------------------------------------------------------------------

function readCoreSandboxPrefixes(entry: SkillEntry): string[] {
  if (!entry.coreFile) return [];
  const filePath = path.resolve(REPO_ROOT, entry.coreFile);
  if (!fs.existsSync(filePath)) return [];
  let parsed: any;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
  const prefixes = new Set<string>();
  const collect = (value: any) => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
    } else if (value && typeof value === 'object') {
      if (typeof value.ref === 'string' && value.ref.startsWith('sandbox:')) {
        const prefix = value.ref.slice('sandbox:'.length).split('.')[0];
        if (prefix) prefixes.add(prefix);
      }
      for (const v of Object.values(value)) collect(v);
    }
  };
  collect(parsed);
  return [...prefixes].sort();
}

// ---------------------------------------------------------------------------
// ⑦ 主流程
// ---------------------------------------------------------------------------

interface Finding {
  level: 'error' | 'warn';
  channel: string;
  message: string;
}

function declaredDbTables(entry: SkillEntry): string[] {
  return (entry.dataSource?.db || []).map((item) => item.table);
}

function main() {
  const findings: Finding[] = [];
  const modelNames = loadPrismaModelNames();

  let book: SkillsBook;
  try {
    book = loadSkillsFile();
  } catch (error) {
    console.error(`[data-source:check] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  for (const entry of book.skills) {
    const declared = declaredDbTables(entry);
    const declaredSandbox = entry.dataSource?.sandbox || [];

    // --verbose：输出每个 skill 的扫描命中表（审计用）
    if (process.argv.includes('--verbose')) {
      const scanFound = scanSkillTables(entry.skillId);
      const scanLine = scanFound.size > 0
        ? [...scanFound.entries()].map(([table, ev]) => `${table}@${ev}`).join(' ')
        : '(空)';
      console.log(`  [scan] ${entry.skillId}: ${scanLine}`);
    }

    // ---- ERROR 级：声明表 ∈ prisma schema 模型名；sandbox 前缀 ∈ 5 agent 别名 ----
    for (const table of declared) {
      if (!modelNames.has(table)) {
        findings.push({
          level: 'error',
          channel: 'schema',
          message: `${entry.skillId}: dataSource.db 声明表 ${table} 不在 prisma schema 模型名集合中`,
        });
      }
    }
    for (const prefix of declaredSandbox) {
      if (!(SANDBOX_PREFIXES as readonly string[]).includes(prefix)) {
        findings.push({
          level: 'error',
          channel: 'schema',
          message: `${entry.skillId}: dataSource.sandbox 前缀 ${prefix} 非法（须在 ${SANDBOX_PREFIXES.join(',')} 中，对应 agent-contract-view.ts SANDBOX_AGENT_ALIASES）`,
        });
      }
    }

    // ---- W5a / W5b：db 通道 ----
    if ((CALL_SITE_MANIFEST[entry.skillId] || []).length > 0) {
      const scanFound = scanSkillTables(entry.skillId);
      const crossFile = new Set((CROSS_FILE_EVIDENCE[entry.skillId] || []).map((item) => item.table));
      const exempt = new Set(EXEMPT_UNDECLARED[entry.skillId] || []);
      const declaredSet = new Set(declared);
      const evidenceLine = (table: string): string => {
        const cf = (CROSS_FILE_EVIDENCE[entry.skillId] || []).find((item) => item.table === table);
        if (cf) return `（跨文件证据 ${cf.file}:${cf.line}）`;
        return scanFound.has(table) ? `（扫描命中 ${scanFound.get(table)}）` : '';
      };

      const undeclared = [...scanFound.keys()].filter((table) => !declaredSet.has(table) && !exempt.has(table)).sort();
      for (const table of undeclared) {
        findings.push({
          level: 'warn',
          channel: 'W5a-未声明',
          message: `${entry.skillId}: 组装路径读取 ${table}（扫描命中 ${scanFound.get(table)}）未在 dataSource.db 声明`,
        });
      }
      const expired = declared.filter((table) => !scanFound.has(table) && !crossFile.has(table)).sort();
      for (const table of expired) {
        findings.push({
          level: 'warn',
          channel: 'W5b-过期',
          message: `${entry.skillId}: 声明表 ${table} 未在组装路径扫描/证据命中，疑似已改数据源${evidenceLine(table)}`,
        });
      }
      for (const table of declared) {
        const covered = scanFound.has(table) || crossFile.has(table);
        if (covered) {
          findings.push({
            level: 'warn',
            channel: 'W5-对账',
            message: `${entry.skillId}: 声明表 ${table} 对账通过${evidenceLine(table)}`,
          });
        }
      }
    }

    // ---- W5-sandbox：core.yaml inputs sandbox refs ↔ 声明 ----
    const actualSandbox = readCoreSandboxPrefixes(entry);
    const declaredSandboxSet = new Set(declaredSandbox);
    for (const prefix of actualSandbox) {
      if (!declaredSandboxSet.has(prefix)) {
        findings.push({
          level: 'warn',
          channel: 'W5-sandbox',
          message: `${entry.skillId}: core.yaml inputs 实际引用 sandbox:${prefix}.* 但 dataSource.sandbox 未声明`,
        });
      }
    }
    for (const prefix of declaredSandbox) {
      if (!actualSandbox.includes(prefix)) {
        findings.push({
          level: 'warn',
          channel: 'W5-sandbox',
          message: `${entry.skillId}: dataSource.sandbox 声明 ${prefix} 但 core.yaml inputs 无 sandbox:${prefix}.* 引用（过期声明）`,
        });
      }
    }

    // ---- 例外账 ----
    if (entry.skillId === 'mcp-tool') {
      if (declared.length > 0) {
        findings.push({ level: 'warn', channel: 'W5-例外账', message: 'mcp-tool: dataSource.db 必须为空（api 类由 mcpTools 承担）' });
      }
      if (!entry.mcpTools || entry.mcpTools.length === 0) {
        findings.push({ level: 'warn', channel: 'W5-例外账', message: 'mcp-tool: 必须声明 mcpTools（handler 直读 user_mcp_configs + config/mcp.json 平台工具）' });
      }
    }
    if (entry.skillId === 'learner-model') {
      if (declared.length === 0) {
        findings.push({ level: 'warn', channel: 'W5-例外账', message: 'learner-model: handler 直读反例，dataSource.db 必须声明（learner_evidence/teaching_sessions/subtasks/learning_paths）' });
      }
    }
    if (['course-design', 'basic-evaluator', 'goal-alignment-checker', 'semantic-freeze-judge'].includes(entry.skillId)) {
      if (declared.length > 0 || declaredSandbox.length > 0) {
        findings.push({
          level: 'warn',
          channel: 'W5-例外账',
          message: `${entry.skillId}: 僵尸/平台直调项，dataSource 必须为空（db=[] sandbox=[]）`,
        });
      }
    }
  }

  // ---- 输出 ----
  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  const okCount = warns.filter((f) => f.channel === 'W5-对账').length;

  console.log(`[data-source:check] skills.yaml 加载 OK（version=${book.version}，${book.skills.length} 条）`);
  console.log(`[data-source:check] prisma schema 模型名：主库+系统库共 ${modelNames.size} 个（声明表存在性校验基准）`);
  console.log(`[data-source:check] db 声明表对账通过：${okCount} 条；W5 warn 级发现：${warns.length} 条；error 级：${errors.length} 条`);
  console.log('[data-source:check] 三通道：W5a 未声明表 / W5b 过期表 / W5-sandbox 声明一致性 / W5-例外账（mcp-tool·learner-model·僵尸·平台直调）');

  for (const f of [...errors, ...warns]) {
    const tag = f.level === 'error' ? 'ERROR' : 'warn';
    console.log(`  [${tag}][${f.channel}] ${f.message}`);
  }

  if (errors.length > 0) {
    console.error(`[data-source:check] FAIL：error 级 ${errors.length} 条（声明表不在 prisma schema / sandbox 前缀非法）`);
    process.exitCode = 1;
    return;
  }
  console.log('[data-source:check] OK：error 级 0 条；W5 warn 级仅审计提示，不阻断（warn 级决策，DATASOURCE_P4_SURVEY §4.1⑤）');
}

main();
