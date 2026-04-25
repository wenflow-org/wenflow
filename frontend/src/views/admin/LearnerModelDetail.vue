<template>
  <div class="learner-model-detail-page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 class="page-title">学习者模型详情</h2>
        <p class="page-subtitle">查看学习者画像、动态状态、知识记忆与教学提示</p>
      </div>
      <div class="header-actions">
        <el-button @click="goBack">返回</el-button>
        <el-button type="primary" @click="recompute">重算</el-button>
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
      <el-tab-pane label="Profile" name="profile">
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
      <el-tab-pane label="Dynamic State" name="state">
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
      <el-tab-pane label="Knowledge Memory" name="memory">
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
      <el-tab-pane label="Teaching Hints" name="hints">
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
      <el-tab-pane label="Evidence" name="evidence">
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
import { ElMessage } from 'element-plus';
import { adminLearnerModelsApi } from '@/api/adminApi';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const snapshot = ref<any>(null);
const evidence = ref<any[]>([]);
const activeTab = ref('profile');

const userId = route.params.userId as string;
const pathId = route.query.pathId as string | undefined;

const formatTime = (value: string) => value ? new Date(value).toLocaleString() : '--';
const formatJson = (value: any) => JSON.stringify(value || {}, null, 2);

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
    ElMessage.error('加载学习者模型详情失败');
  } finally {
    loading.value = false;
  }
};

const recompute = async () => {
  try {
    await adminLearnerModelsApi.recompute(userId, {
      pathId,
      scope: pathId ? 'path' : 'global',
    });
    ElMessage.success('学习者模型已重算');
    loadData();
  } catch (error) {
    console.error(error);
    ElMessage.error('重算失败');
  }
};

const goBack = () => router.push('/admin/learner-models');

onMounted(loadData);
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 16px; }
.page-title { margin: 0; font-size: 24px; font-weight: 700; }
.page-subtitle { margin: 8px 0 0; color: var(--text-secondary); }
.header-actions { display: flex; gap: 12px; }
.summary-alert { margin-bottom: 16px; }
.json-block { margin: 0; padding: 16px; border-radius: 12px; background: var(--bg-elevated); overflow: auto; white-space: pre-wrap; word-break: break-word; }
.grid { display: grid; gap: 16px; }
.two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 16px; }
.metric-card { display: flex; flex-direction: column; gap: 8px; }
.metric-label { color: var(--text-secondary); font-size: 12px; }
.metric-value { font-size: 24px; }
.kv-list { display: grid; gap: 12px; }
.kv-item { display: flex; justify-content: space-between; gap: 16px; }
.section-card { margin-top: 16px; }
.section-card-row { margin-top: 16px; }
.tag-list { display: flex; gap: 8px; flex-wrap: wrap; }
.empty-text { color: var(--text-secondary); }
.text-block { white-space: pre-wrap; line-height: 1.7; }
.evidence-item { display: grid; gap: 4px; }

@media (max-width: 960px) {
  .two-col, .metric-grid { grid-template-columns: 1fr; }
}
</style>
