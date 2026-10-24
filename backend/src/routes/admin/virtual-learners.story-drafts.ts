/**
 * 人设与故事草稿：候选池常量 / 故事提示 helper + 人设生成、故事草稿、故事池增删改
 *
 * 由 routes/admin/virtual-learners.ts 于 2026-10-19（issue #76）按声明簇纯搬移拆出（L188–L251、L768–L824、L1055–L1390）。
 * 契约不变：路由路径、注册顺序、中间件与处理器代码逐字未改；本文件只导出注册函数，
 * 由 virtual-learners.ts 在**同一个** router 实例上按原顺序调用（Express 顺序匹配语义与拆分前一致）。
 * 为保持逐行可 diff，搬移文本未重新缩进：register 函数体内的路由仍沿用原文件缩进（column 0）。
 */

import { type Router, type Request } from 'express';
import { findRecentProfilesForHints, findProfileById, updateProfileJsonField } from '../../services/virtual-lab/virtual-learner-profile.repo';
import { findSessionsForStoryUsage } from '../../services/virtual-lab/virtual-session.repo';
import { logger } from '../../utils/logger';
import { virtualLearnerPersonaDesignerDefinition } from '../../skills/virtual-learner-persona-designer';
import { virtualLearnerScenarioDesignerDefinition } from '../../skills/virtual-learner-scenario-designer';
import { executeSkill } from '../../skills';
import { buildLearnerStoryHints, buildStoryDirectionHints } from '../../services/virtual-lab/story-chapter.service';
import { attachMaterialsToLearner } from '../../services/virtual-lab/card-import.service';
import { parseJson, normalizeStoryPoolData, ensureProfileStoryPool, isSameStory } from '../../virtual-lab/session-factory';
import type { VirtualSessionRow } from '../../virtual-lab/vlab-types';
import { parseStoryContext } from './virtual-learners.projections';

// ===== 原 virtual-learners.ts L188–L251 =====
/**
 * 可选候选池（显式请求时使用；默认不注入 → 自由生成）。
 * 保留导出以便前端/批量实验显式指定池时引用。
 */
export const DEFAULT_SCENARIO_CANDIDATE_DOMAINS = [
  '番茄工作法与时间管理',
  '课堂复盘与总结',
  '需求拆解',
  '向上汇报表达',
  'SQL 基础查询',
  'Python 基础',
  'Excel 数据处理',
  '英语口语表达',
  '备考规划',
  '个人记账与财务整理',
  '亲子沟通',
  '演讲与公开表达',
  '阅读方法',
  '健身习惯建立',
  '写作与结构表达',
  '短视频脚本表达',
  '面试回答组织',
  '家庭信息整理',
  '情绪记录与自我觉察',
  '基础营养与饮食规划',
];

export const DEFAULT_SCENARIO_CANDIDATE_PERSONAS = [
  '销售主管，常被临时消息打断',
  '运营专员，最近要独立做复盘',
  '产品经理，方案总是越写越散',
  '教培老师，课后复盘全凭感觉',
  '求职转行者，自学总在开头放弃',
  '大三学生，备考节奏很乱',
  '二胎妈妈，想重新建立学习时间',
  '门店店长，排班和复盘都很碎片化',
  '客服组长，沟通记录难以整理',
  '自由职业设计师，项目切换频繁',
  '财务助理，月末报表压力大',
  '社区工作者，信息整理任务很多',
  '短视频创作者，选题和复盘混乱',
  '大学辅导员，事务多且优先级难排',
  '高中英语老师，想提升讲后总结质量',
  '全职妈妈，想恢复规律学习或锻炼',
  '兼职插画师，在家接稿兼顾家庭事务',
  '大学生，想提升公开表达或面试能力',
  '自由职业写作者，长期拖延交稿',
  '行政助理，日常任务碎片化严重',
];

function pickTopLabels(values: string[], limit = 3) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

// ===== 原 virtual-learners.ts L768–L824 =====
async function buildRecentScenarioHints() {
  const recentProfiles = await findRecentProfilesForHints();

  const occupations = recentProfiles
    .map((item) => parseJson<{ occupation?: unknown }>(item.profile, {}).occupation)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  const domains = recentProfiles
    .map((item) => {
      const notes = item.notes || '';
      const matched = notes.match(/(?:^|\n)domain:\s*(.+)$/m);
      return matched?.[1]?.trim() || '';
    })
    .filter(Boolean);

  const goals = recentProfiles
    .map((item) => item.learningGoal || '')
    .filter(Boolean);

  const topOccupations = pickTopLabels(occupations, 4);
  const topDomains = pickTopLabels(domains, 4);
  const topGoals = pickTopLabels(goals, 3);

  const hints: string[] = [
    '请优先避免与最近样本重复的职业、问题来源和主题组合。',
    '如果最近样本里教师或时间管理类已经偏多，请主动切换到其他角色背景与问题来源。',
  ];

  for (const item of topOccupations) {
    hints.push(`最近高频职业：${item.label}（${item.count} 次），这次尽量换职业背景。`);
  }

  for (const item of topDomains) {
    hints.push(`最近高频主题：${item.label}（${item.count} 次），这次尽量换主题。`);
  }

  for (const item of topGoals) {
    hints.push(`最近高频目标表达：${item.label}（${item.count} 次），避免复述相似表述。`);
  }

  return hints;
}

/**
 * 跨故事记忆提示：把该虚拟学习者最近完成的事项（成果物）注入故事生成，
 * 让新故事可以延续"他之前做过什么"（如"上个月做过一支探店视频"），
 * 而不是每次都是全新的人。best-effort：读取失败返回空数组。
 */
async function buildLearnerMemoryStoryHints(profile: {
  userId: string;
  profile: string;
}): Promise<string[]> {
  // 单一来源：与「完课自动续章」共用同一份学习史→故事 hints（services/virtual-lab/story-chapter.service.ts），
  // 消除手动补生成 / 自动续章两处各写一份的漂移风险。
  return buildLearnerStoryHints(profile.userId);
}

export function registerStoryDraftRoutes(router: Router): void {
// ===== 原 virtual-learners.ts L1055–L1390 =====
/**
 * AI生成虚拟学习者身份
 * POST /api/admin/virtual-learners/generate-persona
 */
router.post('/generate-persona', async (req: Request, res) => {
  try {
    const { preferredLevels, candidatePersonas, existingPersonaSeed, sampleType } = req.body || {};
    const recentScenarioHints = await buildRecentScenarioHints();
    // 显式样本类型：'student' 时注入传统学生生成指令（课纲/考试节点/学期节奏/家长同伴环境）
    const personaHints = sampleType === 'student'
      ? [...recentScenarioHints, '本次明确生成传统学生样本：学段与年级、目标考试或升学节点、学期节奏（课表/晚自习/假期）、成绩自评、家长与老师的外部期望必须全部具体；emotionalTriggers/failurePatterns 写学生真实模式（家长问成绩、排名下滑、考前突击遗忘等）。']
      : recentScenarioHints;

    const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
      preferredLevels,
      // 未显式传候选池 → 不注入，走自由生成（消除固定职业天花板）
      candidatePersonas: Array.isArray(candidatePersonas) && candidatePersonas.length ? candidatePersonas : undefined,
      recentPersonaHints: personaHints,
      existingPersonaSeed,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('AI生成虚拟学习者身份失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'AI生成虚拟学习者身份失败',
    });
  }
});

/**
 * 给已有虚拟学习者挂资料（2026-10-02「筛一批配上资料」）。
 * POST /api/admin/virtual-learners/:id/materials
 * body: { materials: [{ kind?, title, sourceRef?, content? | outline? }] }
 * 资料写进该 VL 的用户资料库（origin='upload'，路径生成「附件主线」自动消费），
 * 并锚定 scenarioCard/goalSeed（外科手术式，不覆盖 enriched 人设）。幂等：同名覆盖。
 * 必须定义在 `/:id/draft-profile` 等 `/:id/*` 之前与否不影响（段更具体），但放在卡库路由旁好找。
 */
router.post('/:id/materials', async (req: Request, res) => {
  try {
    const { id } = req.params;
    const materials = Array.isArray(req.body?.materials) ? req.body.materials : [];
    if (!materials.length) {
      return res.status(400).json({ success: false, error: 'materials 不能为空' });
    }
    const written = await attachMaterialsToLearner(id, materials);
    res.json({ success: true, data: { profileId: id, written, titles: materials.map((m: { title?: string }) => String(m?.title || '').trim()).filter(Boolean) } });
  } catch (error) {
    logger.error('虚拟学习者挂资料失败:', error);
    res.status(400).json({ success: false, error: (error as Error).message || '挂资料失败' });
  }
});

router.post('/:id/draft-profile', async (req: Request, res) => {
  try {
    const { id } = req.params;

    const profile = await findProfileById(id);
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const existingProfile = parseJson<Record<string, unknown>>(profile.profile, {});
    const existingTraits = parseJson<Record<string, unknown>>(profile.personalityTraits, {});
    const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
      preferredLevels: profile.knowledgeLevel ? [profile.knowledgeLevel] : undefined,
      existingPersonaSeed: {
        ...existingProfile,
        personalityTraits: existingTraits,
        learningGoal: profile.learningGoal,
      }
    });

    const personaSeed = result?.personaSeed;
    if (!personaSeed) {
      return res.status(500).json({ success: false, error: '增强画像生成失败' });
    }

    res.json({
      success: true,
      data: {
        generatedProfile: personaSeed,
      }
    });
  } catch (error) {
    logger.error('增强画像生成失败:', error);
    res.status(500).json({ success: false, error: error.message || '增强画像生成失败' });
  }
});

router.post('/:id/draft-stories', async (req: Request, res) => {
  try {
    const { id } = req.params;

    const profile = await findProfileById(id);
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const { profileData } = await ensureProfileStoryPool(profile);
    const existingStoryPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
    const recentScenarioHints = await buildRecentScenarioHints();
    // 跨故事记忆：注入该虚拟学习者最近完成的事项（成果物），让新故事可以延续"他做过什么"
    const learnerMemoryHints = await buildLearnerMemoryStoryHints(profile);
    // 显式样本类型：'student' 时注入传统学生故事指令（考试节点/课纲压力/作业情境/家长同伴环境）
    const { sampleType, direction } = req.body || {};
    const studentHints = sampleType === 'student'
      ? ['本次明确生成传统学生样本的故事：sourceType 取 study 或 goalType 取 exam_prep，必须写清考试节点与时间压力（月考/期中/期末/模考/倒计时）、课纲既定的学习内容、老师布置的作业情境、家长与老师的期望、同学比较环境；pressurePoints/behaviorHooks 写学生真实卡点（如"很努力但方法不对""一到考试就发挥失常""假期计划崩塌"）。']
      : [];
    // 生成方向（可选，前端弹窗填写）：用户指定的学科/情境优先于自由发挥，但仍受画像约束
    const directionHints = buildStoryDirectionHints(direction);
    const storyHints = [...recentScenarioHints, ...learnerMemoryHints, ...studentHints, ...directionHints];

    logger.info('[admin-generate-stories] 开始生成故事', {
      virtualProfileId: id,
      profileUserId: profile.userId,
      existingStoryPoolCount: existingStoryPool.length,
      hasExistingPersonaSeed: !!profileData && Object.keys(profileData).length > 0,
      requestedStoryCount: 3,
    });

    // existingPersonaSeed 兜底补全：批量创建时身份可能尚未生成成功（profile 只有 background），
    // 但 scenario designer 校验缺 education/learningStyle/knownConcepts 等必填字段会直接失败。
    // 用合理默认值补全，保证故事生成不因身份不完整而失败（身份后续仍可补生成）。
    const personaSeedForStory: Record<string, unknown> = { ...(profileData || {}) };
    if (!String(personaSeedForStory.education || '').trim()) personaSeedForStory.education = profile.learningGoal ? '在职学习' : '自学';
    if (!['reading', 'watching', 'doing', 'listening'].includes(String(personaSeedForStory.learningStyle || ''))) personaSeedForStory.learningStyle = 'doing';
    if (!Number.isFinite(Number(personaSeedForStory.age))) personaSeedForStory.age = 28;
    if (!Array.isArray(personaSeedForStory.knownConcepts) || !personaSeedForStory.knownConcepts.length) personaSeedForStory.knownConcepts = ['基础概念'];
    if (!Array.isArray(personaSeedForStory.struggleConcepts) || !personaSeedForStory.struggleConcepts.length) personaSeedForStory.struggleConcepts = ['方法不清晰'];
    if (!Array.isArray(personaSeedForStory.emotionalTriggers) || !personaSeedForStory.emotionalTriggers.length) personaSeedForStory.emotionalTriggers = ['遇到挫折'];
    if (!Array.isArray(personaSeedForStory.failurePatterns) || !personaSeedForStory.failurePatterns.length) personaSeedForStory.failurePatterns = ['半途而废'];
    if (!['internal', 'external', 'both', 'none'].includes(String(personaSeedForStory.motivationType || ''))) personaSeedForStory.motivationType = 'internal';
    if (!['minimal', 'moderate', 'abundant'].includes(String(personaSeedForStory.availableTime || ''))) personaSeedForStory.availableTime = 'moderate';

    const result = await executeSkill(virtualLearnerScenarioDesignerDefinition, {
      preferredMotivations: profileData?.motivationType ? [profileData.motivationType] : undefined,
      // 不注入固定候选域/候选画像池 → 自由生成（消除职业与领域天花板）
      recentScenarioHints: storyHints,
      existingPersonaSeed: personaSeedForStory,
      existingStoryPool,
      targetStoryCount: 1,
    });

    logger.info('[admin-generate-stories] 故事生成完成', {
      virtualProfileId: id,
      generatedStoryTitle: result?.story?.title || null,
      systemPromptVersion: result?._debug?.systemPromptVersion || null,
    });

    const newStory = result?.story;
    if (newStory) {
      const storyWithStatus = {
        ...newStory,
        createdAt: new Date().toISOString(),
      };
      const normalizedUpdated = normalizeStoryPoolData({
        ...profileData,
        storyPool: [...existingStoryPool, storyWithStatus],
      });
      const updatedStoryPool = normalizedUpdated.storyPool;
      const updatedProfile = normalizedUpdated.profileData;

      await updateProfileJsonField(id, JSON.stringify(updatedProfile));

      logger.info('[admin-generate-stories] 故事已自动持久化', {
        virtualProfileId: id,
        storyPoolCount: updatedStoryPool.length,
      });

      return res.json({
        success: true,
        data: {
          ...result,
          persisted: true,
          storyPoolCount: updatedStoryPool.length,
        },
      });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('增强故事生成失败:', error);
    res.status(500).json({ success: false, error: error.message || '增强故事生成失败' });
  }
});

router.put('/:id/stories/:storyIndex', async (req: Request, res) => {
  try {
    const { id, storyIndex } = req.params;
    const { title, storyOutline, storyTriggerEvent, visibleOpening, pressurePoints, problemKnowledge, budget } = req.body || {};

    const profile = await findProfileById(id);
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const { profileData } = await ensureProfileStoryPool(profile);
    const storyPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
    const index = parseInt(storyIndex, 10);

    if (isNaN(index) || index < 0 || index >= storyPool.length) {
      return res.status(400).json({ success: false, error: '无效的故事索引' });
    }

    const updatedStoryPool = [...storyPool];
    const currentStory = updatedStoryPool[index] || {};
    const nextStory = { ...currentStory };

    if (typeof title === 'string') {
      nextStory.title = title.trim();
    }

    if (typeof storyOutline === 'string') {
      nextStory.storyOutline = storyOutline.trim();
    }

    if (typeof storyTriggerEvent === 'string') {
      nextStory.storyTriggerEvent = storyTriggerEvent.trim();
      nextStory.triggerEvent = storyTriggerEvent.trim();
    }

    if (typeof visibleOpening === 'string') {
      nextStory.visibleOpening = visibleOpening.trim();
    }

    if (Array.isArray(pressurePoints)) {
      nextStory.pressurePoints = pressurePoints
        .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item: string) => !!item);
    }

    if (problemKnowledge && typeof problemKnowledge === 'object') {
      nextStory.problemKnowledge = {
        domainFamiliarity: ['low', 'medium', 'high'].includes(String(problemKnowledge.domainFamiliarity)) ? String(problemKnowledge.domainFamiliarity) : 'low',
        knownConcepts: Array.isArray(problemKnowledge.knownConcepts)
          ? problemKnowledge.knownConcepts.map((item: unknown) => (typeof item === 'string' ? item.trim() : '')).filter((item: string) => !!item)
          : [],
        struggleConcepts: Array.isArray(problemKnowledge.struggleConcepts)
          ? problemKnowledge.struggleConcepts.map((item: unknown) => (typeof item === 'string' ? item.trim() : '')).filter((item: string) => !!item)
          : [],
        selfAssessment: typeof problemKnowledge.selfAssessment === 'string' ? problemKnowledge.selfAssessment.trim() : '',
        hiddenGaps: Array.isArray(problemKnowledge.hiddenGaps)
          ? problemKnowledge.hiddenGaps.map((item: unknown) => (typeof item === 'string' ? item.trim() : '')).filter((item: string) => !!item)
          : []
      }
    }

    // 故事级预算覆盖（可选）：单步重试 / 会话总 AI 调用上限；缺省继承角色级。
    // 口径与前端一致（VirtualProfile.vue saveStory）：显式传入越界值直接 400 报错中止，
    // 不再静默 clamp；读侧兜底 clamp 保留在 session-factory/session-budget（未传字段时的缺省口径）。
    if (budget && typeof budget === 'object') {
      const nextBudget: Record<string, unknown> = {};
      const rawStep = budget.maxRetriesPerStep;
      const rawTotal = budget.maxRetriesTotal;
      if (rawStep !== undefined && rawStep !== null && String(rawStep).trim() !== '') {
        const step = Math.round(Number(rawStep));
        if (!Number.isFinite(step) || step < 1 || step > 20) {
          return res.status(400).json({ success: false, error: '单步重试须为 1–20 的整数（或留空继承角色级）' });
        }
        nextBudget.maxRetriesPerStep = step;
      }
      if (rawTotal !== undefined && rawTotal !== null && String(rawTotal).trim() !== '') {
        const total = Math.round(Number(rawTotal));
        if (!Number.isFinite(total) || total < 1 || total > 1000) {
          return res.status(400).json({ success: false, error: '会话调用上限须为 1–1000 的整数（或留空继承角色级）' });
        }
        nextBudget.maxRetriesTotal = total;
      }
      if (Object.keys(nextBudget).length) nextStory.budget = nextBudget;
      else delete nextStory.budget;
    }

    updatedStoryPool[index] = nextStory;

    const normalizedUpdated = normalizeStoryPoolData({
      ...profileData,
      storyPool: updatedStoryPool,
    });
    const updatedProfile = normalizedUpdated.profileData;

    await updateProfileJsonField(id, JSON.stringify(updatedProfile));

    res.json({
      success: true,
      data: {
        storyPool: normalizedUpdated.storyPool,
      },
    });
  } catch (error) {
    logger.error('更新故事状态失败:', error);
    res.status(500).json({ success: false, error: error.message || '更新故事状态失败' });
  }
});

router.delete('/:id/stories/:storyIndex', async (req: Request, res) => {
  try {
    const { id, storyIndex } = req.params;

    const profile = await findProfileById(id);
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const { profileData } = await ensureProfileStoryPool(profile);
    const storyPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
    const index = parseInt(storyIndex, 10);

    if (isNaN(index) || index < 0 || index >= storyPool.length) {
      return res.status(400).json({ success: false, error: '无效的故事索引' });
    }

    /* 在用守卫（issue #90）：故事的「引用」不在任何表列上，而在会话 stageResults.story 快照里，
       读侧（GET /:id/stories）用 isSameStory 启发式把会话归到故事名下。裸删故事会让这些会话
       变成「找不到归属」的孤儿（故事视图里凭空消失、路径反查对不上）。
       选择「有引用则拒绝」而非「先解绑」，理由：
         ① 解绑（清会话 stageResults.story）会摧毁运行记录的审计快照，且运行中会话的扮演者
            依赖 storyContext 继续上课——数据破坏不可逆；
         ② 连带删会话则是另一种量级的破坏性操作，本入口没有租约/归属校验（对照会话重置链
            reset 的 assertLeaseOwned + 属主检查），不能顺手做；
         ③ 拒绝删除信息可行动（先删会话或保留故事），且无引用的故事（正常路径）行为不变。 */
    const targetStory = storyPool[index];
    const sessions = await findSessionsForStoryUsage(id);
    const inUse = sessions.filter((session) => isSameStory(targetStory, parseStoryContext(session as VirtualSessionRow)));
    if (inUse.length) {
      return res.status(409).json({
        success: false,
        code: 'STORY_IN_USE',
        error: `该故事已被 ${inUse.length} 个会话使用，删除会让这些会话失去故事归属；请先删除相关会话，或保留该故事`,
        data: { sessionCount: inUse.length },
      });
    }

    const updatedStoryPool = storyPool.filter((_, i: number) => i !== index);

    const normalizedUpdated = normalizeStoryPoolData({
      ...profileData,
      storyPool: updatedStoryPool,
    });
    const updatedProfile = normalizedUpdated.profileData;

    await updateProfileJsonField(id, JSON.stringify(updatedProfile));

    res.json({
      success: true,
      data: {
        storyPool: normalizedUpdated.storyPool,
      },
    });
  } catch (error) {
    logger.error('删除故事失败:', error);
    res.status(500).json({ success: false, error: error.message || '删除故事失败' });
  }
});
}
