<template>
  <div class="learner-model-detail-page" v-loading="loading">
    <div class="admin-overview-bg">
      <div class="admin-overview-bg__orb admin-overview-bg__orb--1"></div>
      <div class="admin-overview-bg__orb admin-overview-bg__orb--2"></div>
    </div>

    <div class="page-hero">
      <div class="page-hero__row">
        <div>
          <span class="pill">Admin</span>
          <h2 class="page-hero__title">
            <el-icon class="page-title-icon"><Reading /></el-icon>
            学习者模型详情
          </h2>
          <p class="page-hero__subtitle">查看用户详细的学习模型数据</p>
        </div>
        <div class="header-actions">
          <el-button type="default" @click="goBack">返回</el-button>
          <el-button type="primary" :loading="recomputing" @click="recompute">重算</el-button>
        </div>
      </div>
    </div>

    <el-alert
      v-if="snapshot"
      type="info"
      show-icon
      :closable="false"
      :title="`快照版本：${snapshot.snapshotVersion}`"
      :description="`生成时间：${formatTime(snapshot.freshness.generatedAt)}；置信度：${(snapshot.freshness.confidence * 100).toFixed(0)}%`"
      class="summary-alert"
    />

    <el-tabs v-if="snapshot" v-model="activeTab">
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
          <el-card shadow="never">
            <template #header>当前路径位置</template>
            <div class="kv-list">
              <div class="kv-item"><span>路径</span><strong>{{ snapshot.knowledgeMemory.currentPath.pathTitle }}</strong></div>
              <div class="kv-item"><span>当前阶段</span><strong>{{ snapshot.knowledgeMemory.currentPath.currentPosition.milestoneTitle }}</strong></div>
              <div class="kv-item"><span>当前任务</span><strong>{{ snapshot.knowledgeMemory.currentPath.currentPosition.taskTitle || '--' }}</strong></div>
              <div class="kv-item"><span>里程碑进度</span><strong>{{ snapshot.knowledgeMemory.currentPath.currentPosition.completedTasksInMilestone }}/{{ snapshot.knowledgeMemory.currentPath.currentPosition.totalTasksInMilestone }}</strong></div>
            </div>
          </el-card>
          <el-card shadow="never">
            <template #header>风险与前置缺口</template>
            <div class="tag-list">
              <el-tag v-for="item in snapshot.knowledgeMemory.currentPath.prerequisiteGaps" :key="item.conceptKey" type="danger" effect="plain">
                {{ item.label }}
              </el-tag>
              <span v-if="snapshot.knowledgeMemory.currentPath.prerequisiteGaps.length === 0" class="empty-text">无明显前置缺口</span>
            </div>
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
      </el-tab-pane>
      <el-tab-pane label="证据记录" name="evidence">
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

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__row { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.header-actions { display: flex; gap: 12px; }
.summary-alert { position: relative; z-index: 1; margin-bottom: 16px; }
.grid { display: grid; gap: 16px; position: relative; z-index: 1; }
.two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 16px; }
.metric-card { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.metric-label { color: var(--text-secondary); font-size: 12px; }
.metric-value { font-size: 24px; }
.metric-grid .el-card { background: linear-gradient(135deg, rgba(52, 120, 246, 0.04), rgba(141, 107, 255, 0.03)); border-radius: 20px; }
.kv-list { display: grid; gap: 12px; }
.kv-item { display: flex; justify-content: space-between; gap: 16px; }
.section-card { margin-top: 16px; position: relative; z-index: 1; }
.section-card-row { margin-top: 16px; position: relative; z-index: 1; }
.tag-list { display: flex; gap: 8px; flex-wrap: wrap; }
.empty-text { color: var(--text-secondary); }
.text-block { white-space: pre-wrap; line-height: 1.7; }
.evidence-item { display: grid; gap: 4px; }

.section-card :deep(.el-table) { border-radius: 12px; overflow: hidden; }
.section-card :deep(.el-table th.el-table__cell) { background: rgba(52, 120, 246, 0.04); font-weight: 600; }

[data-theme="dark"] .learner-model-detail-page {
  --bg-elevated: var(--glass-bg-dark);
}

[data-theme="dark"] .summary-alert {
  background: var(--glass-bg-dark);
  border-color: var(--glass-border-dark);
}

[data-theme="dark"] .metric-grid .el-card {
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.08), rgba(141, 107, 255, 0.06));
}

@media (max-width: 960px) {
  .two-col, .metric-grid { grid-template-columns: 1fr; }
}
</style>
