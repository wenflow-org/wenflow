/**
 * Profile Golden Timelines（LLM 契约层，2026-11-21）：
 * 用与确定性层**同一批** JSON 夹具，喂**真模型**跑画像 skill，断言提示词契约的服从性
 * （确定性层钉接线，本层钉「模型行为」——改任何一行画像 Prompt 后可立即看到边界场景回归）。
 *
 * 门控：默认跳过（不进常规 CI）。运行方式：
 *   PROFILE_GOLDEN_LLM=1 npx jest profile-golden-timelines.llm.test.ts
 * 可用 PROFILE_GOLDEN_SCENARIO=<id> 只跑单个场景（如 false-mastery-enrich）。
 *
 * 依赖：真实 dev DB（ACTIVE prompt 行）与 .env 的模型配置；SQLite 与运行中的 dev 后端共享文件，
 * 单场景串行执行以降低写锁冲突。
 *
 * 契约断言（对齐 prompts/core 各 yaml 的 rules，宽松到容忍 LLM 方差）：
 *   false-mastery-enrich   lessonReport.met=false → 缺口进 blockedFoundations、不得进 reusableFoundations，
 *                          summary 必须点明「契约未达成」
 *   false-mastery-predict  带契约缺口硬证据 → rationale 必须点名缺口（不按冷启动 0.45-0.55 躲）
 *   cold-start-predict     纯冷启动 → 允许保守基线且 rationale 明写冷启动
 *   sustained-overload-copy paceMode=recover → paceHint/warningCopy 转向减负恢复，不指责不复述读数
 *   misconception-reversal state-review：失效误解不得被再次断言；输出不伪造台账
 */
import fs from 'node:fs';
import path from 'node:path';

const ENABLED = process.env.PROFILE_GOLDEN_LLM === '1';
const ONLY = process.env.PROFILE_GOLDEN_SCENARIO || '';
const describeLLM = ENABLED ? describe : describe.skip;
const fixture = (id: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'golden-timelines', `${id}.json`), 'utf8'));

// 真实栈：不 mock prisma / callPrompt（走 dev DB 的 ACTIVE prompt 与 .env 模型配置）。
// 注意 definition 来源要与生产一致：lesson-enrich / adaptive-copy 是独立 skill（不在
// v4-aux-skills 的 META 表里），state-review 才在 aux 表。
import { executeSkill } from '../../../skills';
import { auxSkillDefinitionMap } from '../../../skills/v4-aux-skills';
import { adaptiveGuidanceCopyDefinition } from '../../../skills/profile-adaptive-copy';
import { learningPredictor } from '../../../skills/profile-learning-predict/index';
import { lessonKnowledgeEnricherDefinition } from '../../../skills/profile-lesson-enrich/index';

const scenario = (id: string, fn: () => void | Promise<void>) => {
  // id 形如 'false-mastery-enrich：中文描述…'；PROFILE_GOLDEN_SCENARIO 用英文前缀匹配
  const run = !ONLY || id.startsWith(ONLY) || id.split('：')[0] === ONLY;
  (run ? it : it.skip)(id, fn);
};

describeLLM('profile golden timelines（LLM 契约层，PROFILE_GOLDEN_LLM=1 才跑）', () => {
  jest.setTimeout(180_000);

  scenario('false-mastery-enrich：缺口进 blockedFoundations，不得进 reusableFoundations', async () => {
    const f = fixture('false-mastery');
    const gaps = (f.previousSession.teachingState.sessionArtifacts.lessonReport) as Record<string, unknown>;
    const result = await executeSkill(lessonKnowledgeEnricherDefinition, {
      knowledgeState: [
        { name: '数组的 map 与 for 循环的区别', status: 'learning', progress: 40 },
      ],
      knowledgeDelta: { newlyMastered: [], movedToReview: [], stillLearning: ['数组的 map 与 for 循环的区别'], unchangedMastered: [] },
      wrapup: { summary: '学习者能口述 map 的用途，并在提示下补全了一个回调示例。' },
      lessonReport: gaps,
      taskContext: { learningPathId: 'lp_golden_1', taskId: 'tk2' },
      sessionEvidence: { independentCount: 0 },
      visibleDialogueContext: ['学生：map 我懂了，就是把每个元素变一下。'],
      classroomEventHistory: [],
    });
    const output = (result as any).output ?? result;
    const blocked = (output.blockedFoundations ?? []).join(' ');
    const reusable = (output.reusableFoundations ?? []).join(' ');
    expect(output.conceptLedger.length).toBeGreaterThan(0);
    expect(blocked.length).toBeGreaterThan(0);
    // 缺口不得被洗成可复用基础（契约服从的核心断言）
    expect(reusable).not.toContain('独立');
    expect(typeof output.knowledgeStateSummary).toBe('string');
    expect(output.knowledgeStateSummary.length).toBeGreaterThan(0);
    expect(output.knowledgeStateSummary).toMatch(/未|没有|还没|不足|缺|未达成|没取得|没拿到/);
  });

  scenario('false-mastery-predict：带缺口硬证据 → rationale 点名缺口，不躲保守基线', async () => {
    const f = fixture('false-mastery');
    const contractGaps = {
      met: false,
      missingKcs: ['kc_map_callback_independent', 'kc_map_for_equivalence'],
      exitTicketPassed: false,
    };
    const result = await learningPredictor({
      ...f.predictionOpts,
      contractGaps,
    });
    const output = result.output!;
    expect(output.stallRisk).toBeGreaterThanOrEqual(0.4);
    // 宽松匹配：模型可能写「缺口/契约/缺失/未取得/无证据」等任一表述（实测会点名"两项缺失知识点"）
    expect(output.rationale).toMatch(/缺口|契约|missing|缺失|未|没有|无|上节|上次|退出票|终检|证据不足|检查/);
  });

  scenario('cold-start-predict：纯冷启动 → 保守基线且 rationale 明写冷启动', async () => {
    const f = fixture('cold-start');
    const result = await learningPredictor(f.predictionOpts);
    const output = result.output!;
    expect(output.stallRisk).toBeGreaterThanOrEqual(0.3);
    expect(output.stallRisk).toBeLessThanOrEqual(0.7);
    expect(output.rationale).toMatch(/冷启动|无历史|没有历史|首次|第一次/);
  });

  scenario('sustained-overload-copy：paceMode=recover → 文案转向减负恢复，不指责', async () => {
    const f = fixture('sustained-overload');
    const result = await executeSkill(adaptiveGuidanceCopyDefinition, {
      view: 'dashboard',
      // 键名与生产一致（AdaptiveGuidanceCopyInput.learnerSnapshot）：此前误传 learner，
      // 模型看不到 recover 信号，出的文案属正常表现而契约层误报
      learnerSnapshot: f.learnerSnapshot,
      learningState: { tasks: { completed: 2, total: 8, inProgress: 1, started: 3 } },
      path: { title: 'JS 执行模型进阶', totalMilestones: 3, completedMilestones: 1 },
      advisory: null,
    });
    const output = (result as any).output ?? result;
    const paceHint = String(output.paceHint ?? '');
    const warningCopy = String(output.warningCopy ?? '');
    const all = `${paceHint} ${warningCopy}`;
    // 恢复导向：提节奏放慢/恢复/减量之一
    expect(all).toMatch(/慢|恢复|减|缓|歇|松|状态|调整/);
    // 语气纪律：不指责、不制造愧疚
    expect(all).not.toMatch(/太懒|更努力|不该|落后|加油追赶|拖后腿/);
    // 不复述页面已有读数（分钟数/天数）
    expect(all).not.toMatch(/\d+\s*分钟|\d+\s*天/);
  });

  scenario('misconception-reversal：state-review 不再断言已反转的旧误解', async () => {
    const f = fixture('misconception-reversal');
    const result = await executeSkill(auxSkillDefinitionMap['profile-state-review'], {
      learnerDigest: {
        level: null,
        metrics: { lss: 4, ktl: 5, lf: 3, lsb: 0 },
        trend: 'improving', fatigue: 'low', pacing: 'steady', srlPhase: 'perform',
      },
      knowledgeDigest: {
        mastered: ['深拷贝与浅拷贝的边界'], fragile: [], struggling: [], prerequisiteGaps: [],
        currentPath: { learningPathId: 'lp_golden_3', pathTitle: 'JS 引用语义专题', progress: { totalTasks: 10, completedTasks: 7 }, currentPosition: { milestoneTitle: '阶段 3', taskTitle: '结构化拷贝的应用场景' } },
      },
      recentEvidence: [
        { id: 'tk6', signal: 'mastered', concepts: ['深拷贝与浅拷贝的边界'], at: '2026-11-21T08:00:00.000Z' },
      ],
      priorInsights: [
        { type: 'misconception', claim: '学习者仍把「改引用即改原对象」当成浅拷贝的预期行为', action: '换角度解释：先区分值与引用' },
      ],
    });
    const output = (result as any).output ?? result;
    const claims = JSON.stringify(output.falsifiableClaims ?? []);
    const insights = JSON.stringify(output.insights ?? []);
    const staleReasserted =
      (claims + insights).includes('仍把「改引用即改原对象」当成') ||
      (claims + insights).includes('仍把「改引用即改原对象」当作');
    expect(staleReasserted).toBe(false);
    // 不伪造台账：概念评估只允许引用输入里出现过的概念
    for (const assessment of output.conceptAssessments ?? []) {
      expect(assessment.conceptKey).toContain('拷贝');
    }
    // 正向断言堵死 vacuous pass（外部评审 P2.3）：recentEvidence 明确给了 tk6
    // （深拷贝与浅拷贝的边界，signal=mastered）→ 误解反转场景必须产出对该概念的
    // 有效重评估（observed=mastered 且引用 tk6），空数组/空洞察都算失败。
    const assessments = Array.isArray(output.conceptAssessments) ? output.conceptAssessments : [];
    expect(assessments.length).toBeGreaterThan(0);
    const reversal = assessments.find((item: any) => String(item?.conceptKey || '').includes('拷贝'));
    expect(reversal).toBeDefined();
    expect(reversal.observed).toBe('mastered');
    expect(Array.isArray(reversal.evidenceRefs) && reversal.evidenceRefs.includes('tk6')).toBe(true);
  });
});
