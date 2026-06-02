<template>
  <div class="learner-model-detail-page" v-loading="loading">
    <div class="admin-overview-bg">
      <div class="admin-overview-bg__orb admin-overview-bg__orb--1"></div>
      <div class="admin-overview-bg__orb admin-overview-bg__orb--2"></div>
    </div>

    <div class="page-hero">
      <div class="page-hero__row">
        <div>
          <span class="pill">学习诊断</span>
          <h2 class="page-hero__title admin-page-title">
            <el-icon class="admin-page-title__icon"><Reading /></el-icon>
            学习者模型详情
          </h2>
          <p class="page-hero__subtitle">查看学习者当前状态、知识记忆与教学建议的详细快照</p>
        </div>
        <div class="header-actions">
          <el-button class="detail-btn detail-btn--ghost" @click="goBack">返回列表</el-button>
          <el-button class="detail-btn detail-btn--primary" :loading="recomputing" @click="recompute">重算模型</el-button>
        </div>
      </div>
    </div>

    <div v-if="snapshot" class="summary-meta">
      <div class="summary-meta__item"><span>快照版本</span><strong>{{ snapshot.snapshotVersion || '--' }}</strong></div>
      <div class="summary-meta__item"><span>生成时间</span><strong>{{ formatTime(snapshot.freshness?.generatedAt) }}</strong></div>
      <div class="summary-meta__item"><span>置信度</span><strong>{{ confidenceText }}</strong></div>
      <div class="summary-meta__item"><span>模式</span><strong>{{ pathId ? '路径模型' : '全局模型' }}</strong></div>
    </div>

    <el-tabs v-if="snapshot" v-model="activeTab">
      <el-tab-pane label="总览" name="overview">
        <div class="grid overview-kpis">
          <el-card shadow="never" class="kpi-card">
            <span class="kpi-card__label">趋势</span>
            <strong class="kpi-card__value">{{ trendText }}</strong>
          </el-card>
          <el-card shadow="never" class="kpi-card">
            <span class="kpi-card__label">疲劳风险</span>
            <strong class="kpi-card__value">{{ riskText }}</strong>
          </el-card>
          <el-card shadow="never" class="kpi-card">
            <span class="kpi-card__label">当前阶段</span>
            <strong class="kpi-card__value">{{ pathOverview.currentMilestone }}</strong>
          </el-card>
          <el-card shadow="never" class="kpi-card">
            <span class="kpi-card__label">当前任务</span>
            <strong class="kpi-card__value">{{ pathOverview.currentTask }}</strong>
          </el-card>
        </div>

        <div class="grid two-col section-card-row">
          <el-card shadow="never" class="overview-card">
            <template #header>学习进度</template>
            <div class="kv-list">
              <div class="kv-item"><span>路径</span><strong>{{ pathOverview.pathTitle }}</strong></div>
              <div class="kv-item"><span>里程碑进度</span><strong>{{ milestoneProgressText }}</strong></div>
            </div>
            <el-progress :percentage="milestoneProgress" :stroke-width="10" :show-text="false" class="overview-progress" />
          </el-card>
          <el-card shadow="never" class="overview-card">
            <template #header>风险摘要</template>
            <div class="risk-summary">
              <el-tag size="small" type="danger">前置缺口 {{ prerequisiteGapCount }}</el-tag>
              <el-tag size="small" type="info">脆弱 {{ fragileCount }}</el-tag>
              <el-tag size="small" type="warning">挣扎 {{ strugglingCount }}</el-tag>
            </div>
            <div class="text-block">{{ riskQuickText }}</div>
          </el-card>
        </div>

        <el-card shadow="never" class="section-card">
          <template #header>教学动作建议</template>
          <div class="action-grid">
            <div class="action-item"><span>推荐节奏</span><strong>{{ snapshot.dynamicState?.recommendedPacing || '--' }}</strong></div>
            <div class="action-item"><span>提示时机</span><strong>{{ snapshot.dynamicState?.recommendedInteraction?.hintTiming || '--' }}</strong></div>
            <div class="action-item"><span>鼓励频率</span><strong>{{ snapshot.dynamicState?.recommendedInteraction?.encouragement || '--' }}</strong></div>
            <div class="action-item"><span>挑战频率</span><strong>{{ snapshot.dynamicState?.recommendedInteraction?.challenge || '--' }}</strong></div>
          </div>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="认知画像" name="profile">
        <div class="grid two-col">
          <el-card shadow="never">
            <template #header>认知画像</template>
            <div class="kv-list">
              <div class="kv-item"><span>思维风格</span><strong>{{ snapshot.profile.cognitive.thinkingStyle }}</strong></div>
              <div class="kv-item"><span>元认知</span><strong>{{ snapshot.profile.cognitive.metacognitionLevel }}</strong></div>
              <div class="kv-item"><span>困惑模式</span><strong>{{ snapshot.profile.cognitive.confusionPattern }}</strong></div>
              <div class="kv-item"><span>先验结构</span><strong>{{ snapshot.profile.cognitive.priorKnowledgeStructure }}</strong></div>
            </div>
          </el-card>
          <el-card shadow="never">
            <template #header>偏好与情绪</template>
            <div class="kv-list">
              <div class="kv-item"><span>偏好形式</span><strong>{{ snapshot.profile.preferences.preferredStyle }}</strong></div>
              <div class="kv-item"><span>理论/实践</span><strong>{{ snapshot.profile.preferences.theoryVsPractice }}</strong></div>
              <div class="kv-item"><span>时长偏好</span><strong>{{ snapshot.profile.preferences.sessionLength }}</strong></div>
              <div class="kv-item"><span>信心水平</span><strong>{{ snapshot.profile.emotional.confidenceLevel }}</strong></div>
            </div>
          </el-card>
        </div>

        <div class="grid two-col section-card-row">
          <el-card shadow="never">
            <template #header>叙述型画像</template>
            <div class="text-list">
              <div class="text-item"><strong>目标叙述</strong><p>{{ snapshot.profile.narrativeInsights?.goalNarrative || '暂无' }}</p></div>
              <div class="text-item"><strong>背景上下文</strong><p>{{ snapshot.profile.narrativeInsights?.backgroundContextNote || '暂无' }}</p></div>
              <div class="text-item"><strong>动机叙述</strong><p>{{ snapshot.profile.narrativeInsights?.motivationNarrative || '暂无' }}</p></div>
              <div class="text-item"><strong>时间约束</strong><p>{{ snapshot.profile.narrativeInsights?.timeConstraintNote || '暂无' }}</p></div>
              <div class="text-item"><strong>自我认知</strong><p>{{ snapshot.profile.narrativeInsights?.selfAssessmentNote || '暂无' }}</p></div>
            </div>
          </el-card>
          <el-card shadow="never">
            <template #header>学习模式叙述</template>
            <div class="text-list">
              <div class="text-item"><strong>内容接收方式</strong><p>{{ snapshot.profile.narrativeInsights?.contentReceptionPattern || '暂无' }}</p></div>
              <div class="text-item"><strong>练习偏好</strong><p>{{ snapshot.profile.narrativeInsights?.practicePreferenceNote || '暂无' }}</p></div>
              <div class="text-item"><strong>认知摩擦</strong><p>{{ snapshot.profile.narrativeInsights?.frictionPatternNote || '暂无' }}</p></div>
              <div class="text-item"><strong>有效教学模式</strong><p>{{ snapshot.profile.narrativeInsights?.effectiveTeachingPattern || '暂无' }}</p></div>
              <div class="text-item"><strong>支持风格</strong><p>{{ snapshot.profile.narrativeInsights?.supportStyleNote || '暂无' }}</p></div>
            </div>
          </el-card>
        </div>
      </el-tab-pane>
      <el-tab-pane label="动态状态" name="state">
        <div class="grid metric-grid">
          <el-card shadow="never" v-for="item in stateCards" :key="item.label">
            <div class="metric-card">
              <span class="metric-label">{{ item.label }}</span>
              <strong class="metric-value">{{ item.value }}</strong>
            </div>
          </el-card>
        </div>
        <el-card shadow="never" class="section-card">
          <template #header>推荐交互</template>
          <div class="kv-list">
            <div class="kv-item"><span>节奏</span><strong>{{ snapshot.dynamicState.recommendedPacing }}</strong></div>
            <div class="kv-item"><span>提示时机</span><strong>{{ snapshot.dynamicState.recommendedInteraction.hintTiming }}</strong></div>
            <div class="kv-item"><span>鼓励频率</span><strong>{{ snapshot.dynamicState.recommendedInteraction.encouragement }}</strong></div>
            <div class="kv-item"><span>挑战频率</span><strong>{{ snapshot.dynamicState.recommendedInteraction.challenge }}</strong></div>
          </div>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="知识记忆" name="memory">
        <div class="grid two-col" v-if="snapshot.knowledgeMemory.currentPath">
          <el-card shadow="never" class="path-card">
            <template #header>当前路径位置</template>
            <div class="kv-list">
              <div class="kv-item"><span>路径</span><strong>{{ snapshot.knowledgeMemory.currentPath.pathTitle }}</strong></div>
              <div class="kv-item"><span>当前阶段</span><strong>{{ snapshot.knowledgeMemory.currentPath.currentPosition.milestoneTitle }}</strong></div>
              <div class="kv-item"><span>当前任务</span><strong>{{ snapshot.knowledgeMemory.currentPath.currentPosition.taskTitle || '--' }}</strong></div>
              <div class="kv-item"><span>里程碑进度</span><strong>{{ snapshot.knowledgeMemory.currentPath.currentPosition.completedTasksInMilestone }}/{{ snapshot.knowledgeMemory.currentPath.currentPosition.totalTasksInMilestone }}</strong></div>
            </div>
            <el-progress :percentage="milestoneProgress" :stroke-width="10" :show-text="false" class="overview-progress" />
          </el-card>
          <el-card shadow="never">
            <template #header>风险与前置缺口</template>
            <div class="risk-summary risk-summary--memory">
              <el-tag size="small" type="danger">前置缺口 {{ prerequisiteGapCount }}</el-tag>
              <el-tag size="small" type="info">脆弱 {{ fragileCount }}</el-tag>
              <el-tag size="small" type="warning">挣扎 {{ strugglingCount }}</el-tag>
            </div>
            <div class="tag-list">
              <el-tag v-for="item in snapshot.knowledgeMemory.currentPath.prerequisiteGaps" :key="item.conceptKey" type="danger" effect="plain">
                {{ item.label }}
              </el-tag>
              <span v-if="snapshot.knowledgeMemory.currentPath.prerequisiteGaps.length === 0" class="empty-text">无明显前置缺口</span>
            </div>
            <div class="text-block risk-text">{{ riskQuickText }}</div>
          </el-card>
        </div>

        <el-card shadow="never" class="section-card">
          <template #header>知识点状态</template>
          <el-table :data="conceptRows" size="small" stripe>
            <el-table-column prop="label" label="知识点" min-width="160" />
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column prop="stability" label="稳定性" width="100" />
            <el-table-column label="掌握度" width="100">
              <template #default="{ row }">
                {{ Math.round((row.masteryScore || 0) * 100) }}%
              </template>
            </el-table-column>
            <el-table-column prop="lastSeenAt" label="最近证据" min-width="160">
              <template #default="{ row }">
                {{ formatTime(row.lastSeenAt) }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="教学建议" name="hints">
        <div class="grid two-col">
          <el-card shadow="never">
            <template #header>教学建议</template>
            <div class="text-block">{{ snapshot.teachingHints.recommendedApproach || '暂无' }}</div>
          </el-card>
          <el-card shadow="never">
            <template #header>Prompt Enhancement</template>
            <div class="text-block">{{ snapshot.teachingHints.promptEnhancement || '暂无' }}</div>
          </el-card>
        </div>
        <div class="grid two-col section-card-row">
          <el-card shadow="never">
            <template #header>强调内容</template>
            <div class="tag-list">
              <el-tag v-for="item in snapshot.teachingHints.emphasize" :key="item" effect="plain">{{ item }}</el-tag>
              <span v-if="snapshot.teachingHints.emphasize.length === 0" class="empty-text">暂无</span>
            </div>
          </el-card>
          <el-card shadow="never">
            <template #header>避免内容</template>
            <div class="tag-list">
              <el-tag v-for="item in snapshot.teachingHints.avoid" :key="item" type="warning" effect="plain">{{ item }}</el-tag>
              <span v-if="snapshot.teachingHints.avoid.length === 0" class="empty-text">暂无</span>
            </div>
          </el-card>
        </div>
        <el-card shadow="never" class="section-card">
          <template #header>课程调参建议</template>
          <div class="kv-list">
            <div class="kv-item"><span>任务粒度</span><strong>{{ snapshot.profile.curriculumControls?.taskGranularityLevel || '--' }}</strong></div>
            <div class="kv-item"><span>概念密度</span><strong>{{ snapshot.profile.curriculumControls?.conceptDensityLevel || '--' }}</strong></div>
            <div class="kv-item"><span>复习频率</span><strong>{{ snapshot.profile.curriculumControls?.reviewFrequencyLevel || '--' }}</strong></div>
          </div>
          <div class="text-block" style="margin-top: 12px;">{{ snapshot.profile.curriculumControls?.progressionStrategyNote || '暂无' }}</div>
          <div class="text-block" style="margin-top: 12px;">{{ snapshot.profile.narrativeInsights?.taskGranularityNote || '暂无任务粒度说明' }}</div>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="证据记录" name="evidence">
        <div class="grid evidence-kpis">
          <el-card shadow="never" class="kpi-card"><span class="kpi-card__label">证据总数</span><strong class="kpi-card__value">{{ evidence.length }}</strong></el-card>
          <el-card shadow="never" class="kpi-card"><span class="kpi-card__label">高风险证据</span><strong class="kpi-card__value">{{ highRiskEvidenceCount }}</strong></el-card>
          <el-card shadow="never" class="kpi-card"><span class="kpi-card__label">最近证据</span><strong class="kpi-card__value kpi-card__value--sm">{{ latestEvidenceAt }}</strong></el-card>
        </div>
        <el-timeline>
          <el-timeline-item v-for="(item, index) in evidence" :key="`${item.type}-${index}`" :timestamp="formatTime(item.happenedAt)">
            <div class="evidence-item">
              <strong>{{ item.type }}</strong>
              <div>信号：{{ item.signal }}</div>
              <div>知识点：{{ (item.conceptKeys || []).join('，') || '无' }}</div>
              <div v-if="item.score !== undefined">分值：{{ Math.round(Number(item.score) * 100) / 100 }}</div>
            </div>
          </el-timeline-item>
        </el-timeline>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Reading } from '@element-plus/icons-vue';
import { adminLearnerModelsApi } from '@/api/adminApi';
import { toast } from '../../utils/toast';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const recomputing = ref(false);
const snapshot = ref<any>(null);
const evidence = ref<any[]>([]);
const activeTab = ref('profile');

const userId = route.params.userId as string;
const pathId = route.query.pathId as string | undefined;

const formatTime = (value: string) => value ? new Date(value).toLocaleString() : '--';

const stateCards = computed(() => {
  if (!snapshot.value) return [];
  return [
    { label: 'LSS', value: snapshot.value.dynamicState.metrics.lss?.toFixed?.(2) ?? snapshot.value.dynamicState.metrics.lss },
    { label: 'KTL', value: snapshot.value.dynamicState.metrics.ktl?.toFixed?.(2) ?? snapshot.value.dynamicState.metrics.ktl },
    { label: 'LF', value: snapshot.value.dynamicState.metrics.lf?.toFixed?.(2) ?? snapshot.value.dynamicState.metrics.lf },
    { label: 'LSB', value: snapshot.value.dynamicState.metrics.lsb?.toFixed?.(2) ?? snapshot.value.dynamicState.metrics.lsb },
    { label: '趋势', value: snapshot.value.dynamicState.recentTrend },
    { label: '疲劳风险', value: snapshot.value.dynamicState.fatigueRisk },
  ];
});

const pathModel = computed(() => snapshot.value?.knowledgeMemory?.currentPath || null);

const pathOverview = computed(() => ({
  pathTitle: pathModel.value?.pathTitle || '--',
  currentMilestone: pathModel.value?.currentPosition?.milestoneTitle || '--',
  currentTask: pathModel.value?.currentPosition?.taskTitle || '--',
}));

const milestoneProgress = computed(() => {
  const done = Number(pathModel.value?.currentPosition?.completedTasksInMilestone || 0);
  const total = Number(pathModel.value?.currentPosition?.totalTasksInMilestone || 0);
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
});

const milestoneProgressText = computed(() => {
  const done = Number(pathModel.value?.currentPosition?.completedTasksInMilestone || 0);
  const total = Number(pathModel.value?.currentPosition?.totalTasksInMilestone || 0);
  if (!total) return '--';
  return `${done}/${total}`;
});

const prerequisiteGapCount = computed(() => (pathModel.value?.prerequisiteGaps || []).length);
const fragileCount = computed(() => (snapshot.value?.dynamicState?.fragileConcepts || []).length);
const strugglingCount = computed(() => (snapshot.value?.dynamicState?.strugglingConcepts || []).length);

const riskQuickText = computed(() => {
  const merged = [
    ...(snapshot.value?.dynamicState?.fragileConcepts || []),
    ...(snapshot.value?.dynamicState?.strugglingConcepts || []),
  ];
  if (merged.length === 0) return '暂无明显风险知识点。';
  if (merged.length <= 3) return `重点关注：${merged.join('，')}`;
  return `重点关注：${merged.slice(0, 3).join('，')} 等 ${merged.length} 个知识点`;
});

const trendText = computed(() => {
  const map: Record<string, string> = { improving: '上升', declining: '下降', stable: '稳定' };
  return map[snapshot.value?.dynamicState?.recentTrend] || snapshot.value?.dynamicState?.recentTrend || '--';
});

const riskText = computed(() => {
  const map: Record<string, string> = { high: '高', medium: '中', low: '低' };
  return map[snapshot.value?.dynamicState?.fatigueRisk] || snapshot.value?.dynamicState?.fatigueRisk || '--';
});

const confidenceText = computed(() => {
  const confidence = snapshot.value?.freshness?.confidence;
  if (typeof confidence !== 'number') return '--';
  return `${(confidence * 100).toFixed(0)}%`;
});

const highRiskEvidenceCount = computed(() => evidence.value.filter((item) => Number(item.score) >= 0.8).length);
const latestEvidenceAt = computed(() => evidence.value[0]?.happenedAt ? formatTime(evidence.value[0].happenedAt) : '--');

const conceptRows = computed(() => snapshot.value?.knowledgeMemory?.currentPath?.conceptStates || []);

const loadData = async () => {
  loading.value = true;
  try {
    const [detailRes, evidenceRes]: any = await Promise.all([
      adminLearnerModelsApi.getDetail(userId, { pathId, mode: pathId ? 'path' : 'global' }),
      adminLearnerModelsApi.getEvidence(userId, { pathId, limit: 20 }),
    ]);

    snapshot.value = detailRes.data?.data || detailRes.data || null;
    evidence.value = evidenceRes.data?.data || evidenceRes.data || [];
  } catch (error) {
    console.error(error);
    toast.error('加载学习者模型详情失败');
  } finally {
    loading.value = false;
  }
};

const recompute = async () => {
  recomputing.value = true;
  try {
    await adminLearnerModelsApi.recompute(userId, {
      pathId,
      scope: pathId ? 'path' : 'global',
    });
    toast.success('学习者模型已重算');
    loadData();
  } catch (error) {
    console.error(error);
    toast.error('重算失败');
  } finally {
    recomputing.value = false;
  }
};

const goBack = () => router.push('/admin/learner-models');

onMounted(loadData);
</script>

<style scoped>
.admin-overview-bg { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.admin-overview-bg__orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.15; }
.admin-overview-bg__orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%); animation: admin-orb 26s ease-in-out infinite; }
.admin-overview-bg__orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); animation: admin-orb 30s ease-in-out infinite reverse; }
@keyframes admin-orb { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -20px) scale(1.05); } 66% { transform: translate(-20px, 30px) scale(0.95); } }

.learner-model-detail-page {
  display: grid;
  gap: 16px;
}

.page-hero,
.summary-meta,
.section-card,
.kpi-card,
.overview-card,
.grid :deep(.el-card) {
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 255, 0.94));
  box-shadow: 0 16px 42px rgba(42, 72, 128, 0.08);
}

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 24px; background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 247, 252, 0.94)); margin-bottom: 0; }
.page-hero__row { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.page-hero__title { margin: 8px 0 0; font-size: 1.65rem; font-weight: 700; color: #22344d; letter-spacing: -0.03em; }
.page-hero__subtitle { margin: 6px 0 0; color: #62758f; font-size: 0.95rem; line-height: 1.65; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: rgba(52, 120, 246, 0.08); color: #2d6df2; font-size: 12px; font-weight: 700; }

.header-actions { display: flex; gap: 12px; }
.summary-meta {
  position: relative;
  z-index: 1;
  margin-bottom: 0;
  padding: 14px 16px;
  border-radius: 18px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.summary-meta__item {
  display: grid;
  gap: 4px;
}

.summary-meta__item span {
  color: #73839a;
  font-size: 12px;
}

.summary-meta__item strong {
  font-size: 14px;
  color: #22344d;
}

.grid { display: grid; gap: 16px; position: relative; z-index: 1; }
.two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 16px; }
.overview-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.evidence-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 16px; }
.metric-card { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.metric-label { color: var(--text-secondary); font-size: 12px; }
.metric-value { font-size: 24px; }
.metric-grid .el-card { background: linear-gradient(135deg, rgba(52, 120, 246, 0.04), rgba(141, 107, 255, 0.03)); border-radius: 20px; }
.kv-list { display: grid; gap: 12px; }
.kv-item { display: flex; justify-content: space-between; gap: 16px; }
.section-card { margin-top: 16px; position: relative; z-index: 1; border-radius: 20px; }
.section-card-row { margin-top: 16px; position: relative; z-index: 1; }
.tag-list { display: flex; gap: 8px; flex-wrap: wrap; }
.empty-text { color: var(--text-secondary); }
.text-block { white-space: pre-wrap; line-height: 1.7; }
.evidence-item { display: grid; gap: 4px; }

.text-list {
  display: grid;
  gap: 12px;
}

.text-item {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(243, 246, 251, 0.88);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.text-item strong {
  color: var(--text-primary);
  font-size: 13px;
}

.text-item p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
  font-size: 13px;
}

.kpi-card {
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.06), rgba(141, 107, 255, 0.05));
}

.kpi-card__label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.kpi-card__value {
  font-size: 20px;
  color: var(--text-primary);
  line-height: 1.25;
}

.kpi-card__value--sm {
  font-size: 15px;
}

.overview-card {
  border-radius: 18px;
}

.overview-progress {
  margin-top: 12px;
}

.risk-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.risk-summary--memory {
  margin-bottom: 14px;
}

.risk-text {
  margin-top: 12px;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.action-item {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(52, 120, 246, 0.1);
  background: rgba(255, 255, 255, 0.82);
}

.action-item span {
  font-size: 12px;
  color: var(--text-secondary);
}

.action-item strong {
  color: var(--text-primary);
}

.detail-btn {
  height: 38px;
  padding: 0 16px;
  border-radius: 14px;
  border: 1px solid transparent;
  font-weight: 700;
}

.detail-btn--ghost {
  color: #335aa4;
  border-color: rgba(52, 120, 246, 0.2);
  background: rgba(255, 255, 255, 0.92);
}

.detail-btn--ghost:hover {
  color: #22478f;
  border-color: rgba(52, 120, 246, 0.4);
  background: rgba(238, 245, 255, 0.92);
}

.detail-btn--primary {
  color: #ffffff;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
  box-shadow: 0 10px 20px rgba(52, 120, 246, 0.24);
}

.detail-btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 26px rgba(52, 120, 246, 0.3);
}

.section-card :deep(.el-table) { border-radius: 14px; overflow: hidden; }
.section-card :deep(.el-table th.el-table__cell) { background: rgba(52, 120, 246, 0.04); font-weight: 700; }

:deep(.el-tabs__item) {
  font-weight: 600;
}

:deep(.el-tabs__nav-wrap::after) {
  background-color: rgba(52, 120, 246, 0.08);
}

:deep(.el-card__header) {
  border-bottom-color: rgba(52, 120, 246, 0.08);
  font-weight: 700;
  color: #22344d;
}

:deep(.el-card__body) {
  color: var(--text-secondary);
}

@media (max-width: 960px) {
  .page-hero__row { flex-direction: column; align-items: stretch; }
  .header-actions { justify-content: flex-start; flex-wrap: wrap; }
  .summary-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .two-col, .metric-grid, .overview-kpis, .evidence-kpis, .action-grid { grid-template-columns: 1fr; }
}
</style>
