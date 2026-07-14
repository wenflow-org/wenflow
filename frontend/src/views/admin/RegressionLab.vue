<template>
  <div class="admin-page regression-lab-page">
    <AdminPageHeader
      title="回归测试实验台"
      :icon="DataAnalysis"
      :highlights="regressionHighlights"
    >
      <template #actions>
        <el-button :loading="loading" @click="loadProfiles">刷新</el-button>
      </template>
    </AdminPageHeader>

    <main class="regression-launchpad">
      <section class="regression-config admin-section-card admin-section-card--padded">
        <div class="regression-config__head">
          <div>
            <h2>回归发射配置</h2>
          </div>
        </div>

        <div class="regression-config__row">
          <div class="regression-config__col">
            <span class="regression-config__label">选择画像</span>
            <el-select
              v-model="selectedProfileId"
              placeholder="选择虚拟学习者..."
              clearable
              filterable
              @change="onProfileChange"
            >
              <el-option
                v-for="p in profiles"
                :key="p.id"
                :label="`${p.userName} (${p.profile?.occupation || '--'})`"
                :value="p.id"
              />
            </el-select>
          </div>

          <div class="regression-config__col">
            <span class="regression-config__label">测试 Story</span>
            <el-select
              v-model="selectedStoryKey"
              placeholder="选择故事..."
              :disabled="!selectedProfileId || stories.length === 0"
            >
              <el-option
                v-for="s in stories"
                :key="s.key"
                :label="s.storyTitle || s.title || `故事 ${s.index + 1}`"
                :value="s.key"
              />
            </el-select>
          </div>

          <div class="regression-config__col">
            <span class="regression-config__label">Goal Prompt 版本</span>
            <el-select
              v-model="goalVersion"
              placeholder="当前 ACTIVE"
              clearable
            >
              <el-option
                v-for="v in goalVersions"
                :key="v.id"
                :label="`v${v.version} ${v.status === 'ARCHIVED' ? '(归档)' : ''}`"
                :value="v.systemPrompt"
              />
            </el-select>
          </div>

          <div class="regression-config__col">
            <span class="regression-config__label">Path Prompt 版本</span>
            <el-select
              v-model="pathVersion"
              placeholder="当前 ACTIVE"
              clearable
            >
              <el-option
                v-for="v in pathVersions"
                :key="v.id"
                :label="`v${v.version} ${v.status === 'ARCHIVED' ? '(归档)' : ''}`"
                :value="v.systemPrompt"
              />
            </el-select>
          </div>
        </div>

        <div class="regression-config__actions">
          <el-button
            type="primary"
            :loading="running"
            :disabled="!selectedProfileId || !selectedStoryKey"
            @click="runTest"
          >
            {{ running ? '运行中...' : '发射回归运行' }}
          </el-button>
        </div>
      </section>

      <aside class="regression-side">
        <section class="regression-context admin-section-card admin-section-card--padded">
          <div class="regression-side__head">
            <div>
              <div class="regression-side__title">当前上下文</div>
              <div class="regression-side__meta">确认运行目标和版本覆盖。</div>
            </div>
          </div>

          <template v-if="selectedProfile">
            <div class="regression-context__hero">
              <strong>{{ selectedProfile.userName }}</strong>
              <span>{{ selectedProfile.profile?.occupation || '未填写职业' }}</span>
              <p>{{ selectedProfile.profile?.background || selectedProfile.learningGoal || '进入样本后补充背景或学习目标。' }}</p>
            </div>

            <div class="regression-context__grid">
              <article class="regression-context-card">
                <span>故事池</span>
                <strong>{{ stories.length }}</strong>
              </article>
              <article class="regression-context-card">
                <span>Goal 覆盖</span>
                <strong>{{ selectedGoalVersionLabel }}</strong>
              </article>
              <article class="regression-context-card">
                <span>Path 覆盖</span>
                <strong>{{ selectedPathVersionLabel }}</strong>
              </article>
            </div>

            <section class="regression-story-panel">
              <div class="regression-side__title">当前故事</div>
              <div v-if="selectedStory" class="regression-story-card">
                <strong>{{ selectedStory.storyTitle || selectedStory.title || '未命名故事' }}</strong>
                <p>{{ selectedStory.storyOutline || selectedStory.visibleOpening || '暂无故事摘要' }}</p>
              </div>
              <div v-else class="regression-side__empty">先为当前画像选择一个故事。</div>
            </section>
          </template>

          <div v-else class="regression-side__empty">先选择一个画像样本，再配置本次回归运行。</div>
        </section>

        <section class="regression-context admin-section-card admin-section-card--padded">
          <div class="regression-side__head">
            <div>
              <div class="regression-side__title">最近结果</div>
              <div class="regression-side__meta">最近一次运行完成后，这里会保留结果摘要和跳转入口。</div>
            </div>
          </div>

          <div v-if="result" class="regression-result">
            <div class="regression-result__summary">
              <el-tag :type="result.pathGenerated ? 'success' : 'warning'">
                Goal: {{ result.goalRounds }} 轮{{ result.pathGenerated ? ' ✓' : '' }}
              </el-tag>
              <el-tag :type="result.pathGenerated ? 'success' : 'danger'">
                Path: {{ result.pathGenerated ? '已生成' : '失败' }}
              </el-tag>
              <el-tag v-if="result.review" type="info">
                评估: {{ result.review.reaction || '--' }}
              </el-tag>
            </div>
            <div class="regression-result__meta">
              <span>{{ result.sessionId ? `Session ${result.sessionId}` : '未生成 Session' }}</span>
              <el-button
                v-if="result.sessionId"
                type="primary"
                link
                size="small"
                @click="openSession(result.sessionId)"
              >
                查看 Session →
              </el-button>
            </div>
          </div>
          <div v-else class="regression-side__empty">
            尚无结果，运行后将显示摘要。
          </div>
        </section>
      </aside>
    </main>

    <div v-if="!selectedProfileId && !loading" class="empty-state admin-section-card admin-section-card--padded">
      <p>选择画像和故事开始回归测试。也可以从 <router-link to="/admin/virtual-learners">虚拟学习者列表</router-link> 进入。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { DataAnalysis } from '@element-plus/icons-vue';
import { adminApi } from '@/api/adminApi';
import AdminPageHeader from './components/AdminPageHeader.vue';

const router = useRouter();

const loading = ref(false);
const profiles = ref<any[]>([]);
const selectedProfileId = ref('');
const stories = ref<any[]>([]);
const selectedStoryKey = ref('');

const goalVersions = ref<any[]>([]);
const pathVersions = ref<any[]>([]);
const goalVersion = ref('');
const pathVersion = ref('');

const running = ref(false);
const result = ref<any>(null);

const selectedProfile = computed(() => {
  return profiles.value.find((item: any) => item.id === selectedProfileId.value) || null;
});

const selectedStory = computed(() => {
  return stories.value.find((item: any) => item.key === selectedStoryKey.value) || null;
});

const selectedGoalVersionLabel = computed(() => {
  if (!goalVersion.value) return 'ACTIVE';
  const matched = goalVersions.value.find((item: any) => item.systemPrompt === goalVersion.value);
  return matched ? `v${matched.version}` : '自定义';
});

const selectedPathVersionLabel = computed(() => {
  if (!pathVersion.value) return 'ACTIVE';
  const matched = pathVersions.value.find((item: any) => item.systemPrompt === pathVersion.value);
  return matched ? `v${matched.version}` : '自定义';
});

const regressionHighlights = computed(() => [
  { label: `${profiles.value.length} 个画像样本`, tone: 'info' as const },
  { label: `Goal v ${goalVersions.value.length}`, tone: 'success' as const },
  { label: `Path v ${pathVersions.value.length}`, tone: 'warning' as const },
  { label: result.value ? '最近一次已完成' : '等待运行回归', tone: result.value ? 'success' as const : 'neutral' as const }
]);

async function loadProfiles() {
  loading.value = true;
  try {
    const res = await adminApi.getVirtualLearners();
    profiles.value = res.data?.data?.profiles || [];
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
}

async function loadPromptVersions() {
  try {
    const [goalRes, pathRes] = await Promise.all([
      adminApi.getPromptVersions('skill:goal-conversation'),
      adminApi.getPromptVersions('skill:path-planning'),
    ]);
    goalVersions.value = goalRes?.data?.versions || [];
    pathVersions.value = pathRes?.data?.versions || [];
  } catch {
    // ignore
  }
}

async function onProfileChange() {
  selectedStoryKey.value = '';
  stories.value = [];
  if (!selectedProfileId.value) return;
  try {
    const res = await adminApi.getVirtualLearnerStories(selectedProfileId.value);
    const raw = res.data?.data || [];
    stories.value = raw.map((s: any, i: number) => ({
      ...s,
      key: s.storyId || String(i),
      index: i,
    }));
    if (stories.value.length > 0) {
      selectedStoryKey.value = stories.value[0].key;
    }
  } catch {
    // ignore
  }
}

async function runTest() {
  const storySummary = stories.value.find((s: any) => s.key === selectedStoryKey.value);
  if (!storySummary) {
    ElMessage.warning('请先选择一个测试 Story');
    return;
  }

  running.value = true;
  result.value = null;

  try {
    const overrides: any = {};
    if (goalVersion.value) overrides.goalAgent = goalVersion.value;
    if (pathVersion.value) overrides.pathAgent = pathVersion.value;

    const res = await adminApi.regressionRun(selectedProfileId.value, {
      storyId: storySummary.storyId,
      storyIndex: storySummary.index,
      systemPromptOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      maxGoalRounds: 20,
    });

    if (res?.data?.success) {
      result.value = res.data.data;
      ElMessage.success('回归测试完成');
    } else {
      ElMessage.error(res?.data?.error || '测试运行失败');
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || err?.message || '测试运行失败');
  } finally {
    running.value = false;
  }
}

function openSession(sessionId: string) {
  router.push(`/admin/virtual-session/${sessionId}`);
}

onMounted(() => {
  loadProfiles();
  loadPromptVersions();
});
</script>

<style scoped>
.regression-lab-page {
  display: grid;
  gap: 16px;
  padding: 0 4px;
   max-width: 1320px;
  margin: 0 auto;
}

.regression-summary-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.regression-launchpad {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.9fr);
  gap: 16px;
  align-items: start;
}

.regression-config {
  display: grid;
  gap: 18px;
}

.regression-config__head {
  display: grid;
  gap: 6px;
}

.regression-config__kicker {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--admin-text-brand);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.regression-config__head h2 {
  margin: 0;
  color: var(--admin-text-primary);
  font-size: 1.16rem;
}

.regression-config__head p {
  margin: 0;
  color: var(--admin-text-muted);
  line-height: 1.6;
}

.regression-config__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.regression-config__col {
  display: grid;
  gap: 6px;
}

.regression-config__label {
  font-size: 12px;
  font-weight: 700;
  color: #62758f;
}

.regression-config__actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.regression-side {
  display: grid;
  gap: 16px;
  position: sticky;
  top: 16px;
}

.regression-side__head {
  display: grid;
  gap: 4px;
  margin-bottom: 14px;
}

.regression-side__title {
  color: var(--admin-text-primary);
  font-size: 14px;
  font-weight: 700;
}

.regression-side__meta,
.regression-side__empty {
  color: var(--admin-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.regression-context {
  display: grid;
}

.regression-context__hero,
.regression-story-card,
.regression-context-card,
.regression-result {
  border: 1px solid rgba(223, 229, 241, 0.9);
  border-radius: 10px;
  background: #fbfcfe;
}

.regression-context__hero {
  padding: 14px;
  display: grid;
  gap: 6px;
}

.regression-context__hero strong {
  color: var(--admin-text-primary);
  font-size: 15px;
}

.regression-context__hero span {
  color: var(--admin-text-secondary);
  font-size: 12px;
}

.regression-context__hero p,
.regression-story-card p {
  margin: 0;
  color: var(--admin-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.regression-context__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.regression-context-card {
  padding: 12px;
  display: grid;
  gap: 4px;
}

.regression-context-card span {
  color: var(--admin-text-muted);
  font-size: 11px;
}

.regression-context-card strong,
.regression-story-card strong {
  color: var(--admin-text-primary);
  font-size: 13px;
}

.regression-story-panel {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.regression-story-card {
  padding: 12px 14px;
}

.regression-result {
  padding: 14px;
  margin-top: 0;
}

.regression-result__summary {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.regression-result__meta {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--admin-text-secondary);
  font-size: 12px;
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: #94a3b8;
  font-size: 14px;
}

.empty-state a {
  color: #2d6df2;
  text-decoration: none;
  font-weight: 600;
}

@media (max-width: 1100px) {
  .regression-launchpad {
    grid-template-columns: 1fr;
  }

  .regression-side {
    position: static;
  }
}

@media (max-width: 900px) {
  .regression-config__row,
  .regression-context__grid {
    grid-template-columns: 1fr;
  }
}
</style>
