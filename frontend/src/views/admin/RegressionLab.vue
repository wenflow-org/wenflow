<template>
  <div class="regression-lab-page">
    <AdminPageHeader
      kicker="Admin"
      title="回归测试实验台"
      desc="跨画像 × 跨 Prompt 版本，一键运行 Goal → Path → Review。对比不同画像 / 故事 / Prompt 版本的表现。"
    >
      <template #actions>
        <el-button :loading="loading" @click="loadProfiles">刷新</el-button>
      </template>
    </AdminPageHeader>

    <div class="regression-config">
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
          {{ running ? '运行中...' : '运行回归测试' }}
        </el-button>
      </div>
    </div>

    <div v-if="result" class="regression-result">
      <div class="regression-result__summary">
        <el-tag :type="result.goalConverged ? 'success' : 'warning'">
          Goal: {{ result.goalRounds }} 轮{{ result.goalConverged ? ' ✓' : '' }}
        </el-tag>
        <el-tag :type="result.pathGenerated ? 'success' : 'danger'">
          Path: {{ result.pathGenerated ? '已生成' : '失败' }}
        </el-tag>
        <el-tag v-if="result.review" type="info">
          评估: {{ result.review.reaction || '--' }}
        </el-tag>
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

    <div v-if="!selectedProfileId && !loading" class="empty-state">
      <p>选择画像和故事开始回归测试。也可以从 <router-link to="/admin/virtual-learners">虚拟学习者列表</router-link> 进入。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
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

async function loadProfiles() {
  loading.value = true;
  try {
    const res = await adminApi.getVirtualLearners();
    profiles.value = res.data?.data || [];
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
    goalVersions.value = goalRes?.versions || [];
    pathVersions.value = pathRes?.versions || [];
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

    if (res?.data?.success || res?.data) {
      result.value = res.data;
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
  max-width: 960px;
  margin: 0 auto;
}

/* 页头由 AdminPageHeader 组件统一管理 */

.regression-config {
  padding: 20px;
  background: var(--admin-bg-surface);
  border-radius: 16px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  box-shadow: 0 8px 20px rgba(42, 72, 128, 0.06);
}

.regression-config__row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
  margin-top: 16px;
}

.regression-result {
  padding: 14px 18px;
  background: var(--admin-bg-surface);
  border-radius: 14px;
  border: 1px solid rgba(205, 216, 238, 0.9);
}

.regression-result__summary {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: #94a3b8;
  font-size: 14px;
}

.empty-state a {
  color: #2d6df2;
  text-decoration: none;
  font-weight: 600;
}
</style>