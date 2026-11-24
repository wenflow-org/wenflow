/* eslint-disable @typescript-eslint/no-explicit-any -- 一次性诊断脚本：需穿透动态 JSON */
/**
 * 契约会话 tool_operation 任务形态回测（2026-11-22 组3#2 修复验证，只读不落库）。
 *
 * 背景：Phase 4 曾把 skill_nature 在契约下置空，path-task-design 按「字段缺失 →
 * cognitive_internalized」兜底，工具操作型目标（Excel/SQL 批量处理）的「AI 代跑三段式」
 * 对所有新会话静默失效。修复后 skillNature 恢复透传——本脚本构造一个契约会话的
 * Excel 周报合并 milestone，直接调 path-task-design，验证：
 *  ① 出现「AI 代跑 / 工具全量 / 现成公式 / 步骤卡」类三段式第②段（修复前不会出现）；
 *  ② icapLevel 全部落在 active|constructive 两档（收档口径，interactive/passive 不再出现）；
 *  ③ 首任务仍是 acquire/deconstruct 或微样本破冰（概念门槛 gate 不受透传影响）。
 *
 * 用法：npx ts-node --transpile-only src/scripts/eval-task-design-contract.ts
 */
import 'dotenv/config';
import { executeSkill } from '../skills';
import { stageDesignerDefinition } from '../skills/path-task-design';

const milestone = {
  stageNumber: 1,
  title: '定位门店周报表头并读成列名正确的干净表',
  coreConcept: 'concept-1',
  description: '十几份门店周报的表头上方压着一行大标题和空行，直接读会把大标题当列名；先建立「表头行位置 ↔ read_excel 参数」的对应判断',
  goal: '能对任意一份带大标题行的周报表，判断 header/skiprows 该指向哪一行，并读出列名正确的干净表',
  estimatedHours: 1.6,
};

const cognitiveCore = {
  cognitiveDomain: '在多表结构噪声约束下，识别表头与数据行的边界并建立可复用的读表参数判断',
  coreConcepts: [
    { id: 'concept-1', name: '表头行位置与 read_excel 解析参数的对应判断', role: 'hub', description: '大标题行/空行/列名行的结构决定 header 与 skiprows 取值' },
    { id: 'concept-2', name: '列名一致化与合并键的识别', role: 'supporting', description: '十几份表的列名差异决定合并前的对齐动作' },
  ],
  domainAnchors: {
    canonicalModels: ['Split-Apply-Combine 范式'],
    canonicalArtifacts: ['字段映射表', '去重前后行数核对表'],
    commonMisconceptions: ['以为大标题行必须先手工删掉才能读'],
  },
  loadProfile: { stageLoadDistribution: [{ stageNumber: 1, loadTarget: 'low', zpdDistance: 'close' }] },
};

const clarification = {
  core: { question: '合并链路怎么搭才能每周一键出月报', evidence: ['每周要从各门店收十几份周报', '手工合并到半夜'] },
  baseline: {
    known: ['会用 Excel 基础函数（SUM/VLOOKUP）', '知道每份周报表头大概在第二行'],
    unknown: [],
    misconceptions: ['以为大标题行必须先手工删掉才能读'],
    evidence: ['每周手工合并十几份 Excel', '用 VLOOKUP 拼过月报'],
  },
  stopping: { kind: 'do', scope: 'instance', evidence: 'platform', statement: '把本周十几份周报一键合并成列名干净、可直接透视的月报表' },
  constraints: { timePerSessionMin: 25, totalBudgetHours: 6, deadline: null, environment: ['Windows + Excel + Python 环境已装'] },
  assumptions: ['门店周报格式基本一致，仅表头行位置有差异'],
  blockingNeed: 'none',
  unknowns: [],
};

const normalizedInput = {
  version: '1.0',
  learnerProfile: {
    surfaceGoal: '把每周十几份门店周报批量合并成月报',
    skillNature: 'tool_operation',
    skillNatureEvidence: '价值在会用 pandas/Excel 做出合并结果，不是手工抄数据',
    platformJudgment: 'judgeable_output',
    currentBaseline: { level: 'unknown', evidence: '用 VLOOKUP 拼过月报' },
    backgroundExperience: '运营岗，每周手工合并周报，会基础函数',
  },
  clarification,
  confirmedProposal: {
    learningDirection: '搭建「读干净 → 对齐合并 → 汇总核对」的周报合并处理链',
    firstDeliverable: '一条可重复运行的合并脚本/流程，本周月报用它一次产出',
    keyStages: ['定位表头读成干净表', '对齐列名拼成大表', '界定重复并去重', '按门店和月份汇总核对'],
    outOfScope: ['图表美化'],
    scopeSize: '[技能模块] 四个独立环节各需一次以上坐学，合计 6h 量级',
    scopeSizeRaw: '[技能模块] 四个独立环节各需一次以上坐学，合计 6h 量级',
  },
  timeDimensions: { timeModelVersion: 2, sessionsLengthMin: 25, sessionsLengthSource: 'default', objectiveScopeHours: 6, deadlineDate: null, scopeAnchor: '按 4 个关键阶段估' },
  planningHints: { targetSubtasksForStage: 4, subtaskMinutesRange: [15, 25], stageMinutesBudget: 120 },
};

const AI_PROXY_MARKERS = ['AI 代跑', '贴进对话', '贴到对话', '代跑', '现成公式', '步骤卡', '把数据发给', '帮你跑', '由 AI', '交给 AI'];

async function main(): Promise<void> {
  const input = {
    milestone,
    cognitiveCore,
    normalizedInput,
    pathTopology: 'builder',
    pathStageMap: {
      stageCount: 4,
      currentStageNumber: 1,
      stages: [
        { stageNumber: 1, title: milestone.title, coreConceptName: cognitiveCore.coreConcepts[0].name },
        { stageNumber: 2, title: '对齐十几份门店周报列名并拼成一张大表', coreConceptName: cognitiveCore.coreConcepts[1].name },
        { stageNumber: 3, title: '界定门店周报重复记录并执行可解释的去重', coreConceptName: '重复记录边界与去重行数影响' },
        { stageNumber: 4, title: '按门店和月份汇总周报并核对出月报', coreConceptName: '分组聚合与合计勾稽核对' },
      ],
    },
  };

  console.log('[eval-task-design] 调用 path-task-design（契约会话 + skillNature=tool_operation + topology=builder）…');
  const output = await executeSkill(stageDesignerDefinition, input as any);
  const tasks = Array.isArray((output as any)?.subtasks) ? (output as any).subtasks : [];
  if (!tasks.length) {
    throw new Error(`TASK_DESIGN_EMPTY: ${JSON.stringify(output).slice(0, 300)}`);
  }
  console.log(`[eval-task-design] 产出 ${tasks.length} 个任务`);

  let proxyHits = 0;
  const icapValues = new Set<string>();
  tasks.forEach((t: any, i: number) => {
    const text = `${t.title || ''} ${t.description || ''} ${t.acceptanceHint || ''} ${t.materialPayload || ''}`;
    const hit = AI_PROXY_MARKERS.find((m) => text.includes(m));
    if (hit) proxyHits += 1;
    icapValues.add(String(t.icapLevel));
    console.log(`  ${i + 1}. [${t.type}/${t.icapLevel}/${t.estimatedMinutes}m] ${String(t.title).slice(0, 46)}${hit ? `  ← AI代跑标记「${hit}」` : ''}`);
  });

  const firstType = String(tasks[0]?.type);
  const checks = {
    aiProxySegment: proxyHits >= 1,
    icapTwoTiers: [...icapValues].every((v) => v === 'active' || v === 'constructive'),
    firstTaskGate: ['acquire', 'deconstruct', 'execute'].includes(firstType),
  };
  console.log(`[eval-task-design] AI代跑三段式第②段出现=${checks.aiProxySegment}（${proxyHits} 处）`);
  console.log(`[eval-task-design] icap 全落 2 档=${checks.icapTwoTiers}（实际值：${[...icapValues].join(',')}）`);
  console.log(`[eval-task-design] 首任务类型=${firstType}（gate 合法=${checks.firstTaskGate}）`);
  const allPass = Object.values(checks).every(Boolean);
  console.log(allPass ? '[eval-task-design] PASS' : '[eval-task-design] FAIL');
  process.exit(allPass ? 0 : 1);
}

main().catch((error: any) => {
  console.error('[eval-task-design] ERR', error?.message || error);
  process.exit(1);
});
