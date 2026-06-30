<template>
  <div class="compare-paths-page">
    <header class="compare-header">
      <div class="compare-header__inner">
        <button type="button" class="compare-brand" @click="router.push('/admin/test/dashboard')">
          <img src="/logo.png" alt="问流 WenFlow" class="compare-brand__logo" />
          <span>路径对比</span>
        </button>

        <nav class="compare-nav">
          <router-link to="/admin/test/dashboard">测试学习台</router-link>
          <router-link to="/admin/test/goal-full">测试目标规划</router-link>
          <router-link to="/admin/test/learning-paths">测试学习路径</router-link>
        </nav>

        <div class="compare-header__actions">
          <button class="compare-btn compare-btn--ghost" @click="router.push('/admin/test/learning-paths')">返回路径列表</button>
        </div>
      </div>
    </header>

    <main class="compare-shell">
      <div v-if="loading" class="compare-empty">
        <p>正在加载对比数据...</p>
      </div>

      <div v-else-if="!pathA || !pathB" class="compare-empty">
        <p>无法加载路径数据</p>
        <button class="compare-btn compare-btn--ghost" @click="router.push('/admin/test/learning-paths')">返回路径列表</button>
      </div>

      <template v-else>
        <section class="compare-diff-summary">
          <h2>差异概览</h2>
          <div class="compare-diff-chips">
            <span class="compare-diff-chip" :class="diffClass('totalMilestones')">
              阶段数: {{ pathA.totalMilestones }} → {{ pathB.totalMilestones }}
            </span>
            <span class="compare-diff-chip" :class="diffClass('estimatedHours')">
              预计时间: {{ fmtHours(pathA.estimatedHours) }} → {{ fmtHours(pathB.estimatedHours) }}
            </span>
            <span class="compare-diff-chip" :class="diffClass('milestoneCount')">
              里程碑: {{ milestoneCountA }} → {{ milestoneCountB }}
            </span>
            <span class="compare-diff-chip" :class="diffClass('subtaskCount')">
              任务数: {{ subtaskCountA }} → {{ subtaskCountB }}
            </span>
            <span class="compare-diff-chip" :class="diffClass('difficulty')" v-if="pathA.difficulty || pathB.difficulty">
              难度: {{ pathA.difficulty || '--' }} → {{ pathB.difficulty || '--' }}
            </span>
          </div>
        </section>

        <section class="compare-grid">
          <div class="compare-column">
            <div class="compare-column__header compare-column__header--a">
              <span class="compare-column__label">路径 A</span>
              <h3>{{ pathA.name || pathA.title || '未命名路径' }}</h3>
              <p class="compare-column__meta">
                {{ pathA.status }} · {{ milestoneCountA }} 阶段 · {{ subtaskCountA }} 任务 · {{ fmtHours(pathA.estimatedHours) }}
              </p>
            </div>

            <div class="compare-column__body">
              <div class="compare-stage-list">
                <article
                  v-for="(stage, idx) in milestonesA"
                  :key="stage.id"
                  class="compare-stage"
                  :class="{ 'compare-stage--diff': !isStageMatching(stage, idx) }"
                >
                  <div class="compare-stage__head">
                    <span class="compare-stage__index">阶段 {{ stage.stageNumber || idx + 1 }}</span>
                    <strong>{{ stage.title }}</strong>
                    <p>{{ stage.goal || stage.description }}</p>
                    <div class="compare-stage__concept" v-if="stage.coreConceptName">
                      <span class="compare-tag">概念: {{ stage.coreConceptName }}</span>
                    </div>
                  </div>

                  <div class="compare-task-list">
                    <div
                      v-for="task in (stage.subtasks || [])"
                      :key="task.id"
                      class="compare-task"
                      :class="{ 'compare-task--diff': !isTaskMatching(task, stage.stageNumber, 'A') }"
                    >
                      <strong>{{ task.title }}</strong>
                      <div class="compare-task__chips">
                        <span class="compare-chip">{{ task.taskType || 'task' }}</span>
                        <span class="compare-chip" v-if="task.knowledgeType">{{ task.knowledgeType }}</span>
                        <span class="compare-chip" v-if="task.cognitiveLevel">{{ task.cognitiveLevel }}</span>
                      </div>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </div>

          <div class="compare-column">
            <div class="compare-column__header compare-column__header--b">
              <span class="compare-column__label">路径 B</span>
              <h3>{{ pathB.name || pathB.title || '未命名路径' }}</h3>
              <p class="compare-column__meta">
                {{ pathB.status }} · {{ milestoneCountB }} 阶段 · {{ subtaskCountB }} 任务 · {{ fmtHours(pathB.estimatedHours) }}
              </p>
            </div>

            <div class="compare-column__body">
              <div class="compare-stage-list">
                <article
                  v-for="(stage, idx) in milestonesB"
                  :key="stage.id"
                  class="compare-stage"
                  :class="{ 'compare-stage--diff': !isStageMatching(stage, idx) }"
                >
                  <div class="compare-stage__head">
                    <span class="compare-stage__index">阶段 {{ stage.stageNumber || idx + 1 }}</span>
                    <strong>{{ stage.title }}</strong>
                    <p>{{ stage.goal || stage.description }}</p>
                    <div class="compare-stage__concept" v-if="stage.coreConceptName">
                      <span class="compare-tag">概念: {{ stage.coreConceptName }}</span>
                    </div>
                  </div>

                  <div class="compare-task-list">
                    <div
                      v-for="task in (stage.subtasks || [])"
                      :key="task.id"
                      class="compare-task"
                      :class="{ 'compare-task--diff': !isTaskMatching(task, stage.stageNumber, 'B') }"
                    >
                      <strong>{{ task.title }}</strong>
                      <div class="compare-task__chips">
                        <span class="compare-chip">{{ task.taskType || 'task' }}</span>
                        <span class="compare-chip" v-if="task.knowledgeType">{{ task.knowledgeType }}</span>
                        <span class="compare-chip" v-if="task.cognitiveLevel">{{ task.cognitiveLevel }}</span>
                      </div>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toast } from '@/utils/toast';
import { adminApi } from '@/api/adminApi';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const pathA = ref<any>(null);
const pathB = ref<any>(null);

const milestoneCountA = computed(() => pathA.value?.milestones?.length || 0);
const milestoneCountB = computed(() => pathB.value?.milestones?.length || 0);

const subtaskCountA = computed(() =>
  (pathA.value?.milestones || []).reduce((sum: number, m: any) => sum + (m.subtasks?.length || 0), 0)
);

const subtaskCountB = computed(() =>
  (pathB.value?.milestones || []).reduce((sum: number, m: any) => sum + (m.subtasks?.length || 0), 0)
);

const milestonesA = computed(() => pathA.value?.milestones || []);
const milestonesB = computed(() => pathB.value?.milestones || []);

function fmtHours(h: any) {
  const n = typeof h === 'number' ? Math.round(h) : 0;
  return n ? `${n}h` : '--';
}

function diffClass(field: string) {
  const a = (pathA.value as any)?.[field];
  const b = (pathB.value as any)?.[field];
  if (a === b || a === undefined || b === undefined) return '';
  if ((field === 'totalMilestones' || field === 'milestoneCount' || field === 'subtaskCount') && b > a) return 'compare-diff-chip--increased';
  if (field === 'estimatedHours' && b > a) return 'compare-diff-chip--increased';
  return 'compare-diff-chip--changed';
}

function isStageMatching(stage: any, idx: number) {
  const other = idx < (milestonesA.value === stage ? milestoneCountB : milestoneCountA)
    ? (milestonesA.value === stage ? milestoneCountB : milestoneCountA)
    : null;
  if (!other) return true;
  const otherMilestones = pathA.value?.milestones === stage ? milestonesB.value : milestonesA.value;
  const otherStage = otherMilestones?.[idx];
  if (!otherStage) return false;
  return stage.coreConceptName === otherStage.coreConceptName ||
         stage.title === otherStage.title;
}

function isTaskMatching(_task: any, _stageNum: number, _side: 'A' | 'B') {
  return true;
}

onMounted(async () => {
  const pathAId = route.query.pathA as string;
  const pathBId = route.query.pathB as string;

  if (!pathAId || !pathBId) {
    toast.warning('缺少路径参数');
    loading.value = false;
    return;
  }

  try {
    const result = await adminApi.comparePaths(pathAId, pathBId);
    if (result?.success && result?.data) {
      pathA.value = result.data.pathA;
      pathB.value = result.data.pathB;
    } else {
      toast.error(result?.error?.message || '加载对比数据失败');
    }
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || '加载对比数据失败');
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.compare-paths-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3fb 100%);
  color: #172033;
}

.compare-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(205, 216, 238, 0.9);
}

.compare-header__inner,
.compare-shell {
  width: min(1440px, calc(100% - 48px));
  margin: 0 auto;
}

.compare-header__inner {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.compare-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  font: inherit;
  font-weight: 900;
  color: #172033;
  cursor: pointer;
}

.compare-brand__logo {
  height: 52px;
}

.compare-nav {
  display: flex;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid rgba(205, 216, 238, 0.9);
}

.compare-nav a {
  padding: 8px 12px;
  border-radius: 999px;
  color: #66758d;
  text-decoration: none;
  font-size: 13px;
  font-weight: 800;
}

.compare-nav a.router-link-active {
  background: rgba(52, 120, 246, 0.09);
  color: #1f57cc;
}

.compare-shell {
  padding: 24px 0 72px;
}

.compare-empty {
  min-height: 240px;
  display: grid;
  place-items: center;
  gap: 12px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 250, 255, 0.94));
  border: 1px solid rgba(205, 216, 238, 0.9);
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.06);
  border-radius: 22px;
  padding: 32px;
}

.compare-diff-summary {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 250, 255, 0.94));
  border: 1px solid rgba(205, 216, 238, 0.9);
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.06);
  border-radius: 22px;
  padding: 20px 24px;
  margin-bottom: 20px;
}

.compare-diff-summary h2 {
  margin: 0 0 14px;
  font-size: 20px;
  font-weight: 900;
}

.compare-diff-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.compare-diff-chip {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: #4d5b72;
  font-size: 13px;
  font-weight: 700;
}

.compare-diff-chip--increased {
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
}

.compare-diff-chip--changed {
  background: rgba(255, 170, 100, 0.16);
  color: #a35b06;
}

.compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}

.compare-column {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 250, 255, 0.94));
  border: 1px solid rgba(205, 216, 238, 0.9);
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.06);
  border-radius: 22px;
  overflow: hidden;
}

.compare-column__header {
  padding: 20px 24px;
  border-bottom: 1px solid rgba(205, 216, 238, 0.9);
}

.compare-column__header--a {
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.06), transparent);
}

.compare-column__header--b {
  background: linear-gradient(135deg, rgba(141, 107, 255, 0.06), transparent);
}

.compare-column__label {
  display: inline-flex;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
  margin-bottom: 8px;
}

.compare-column__header--a .compare-column__label {
  background: rgba(52, 120, 246, 0.1);
  color: #1f57cc;
}

.compare-column__header--b .compare-column__label {
  background: rgba(141, 107, 255, 0.12);
  color: #6c4dda;
}

.compare-column__header h3 {
  margin: 8px 0 6px;
  font-size: 18px;
  line-height: 1.3;
  word-break: break-word;
}

.compare-column__meta {
  margin: 0;
  color: #66758d;
  font-size: 13px;
}

.compare-column__body {
  padding: 16px 20px;
}

.compare-stage-list {
  display: grid;
  gap: 16px;
}

.compare-stage {
  padding: 14px;
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.7);
  border: 1px solid rgba(205, 216, 238, 0.5);
}

.compare-stage--diff {
  border-color: rgba(255, 170, 100, 0.3);
  background: rgba(255, 170, 100, 0.04);
}

.compare-stage__head {
  margin-bottom: 10px;
}

.compare-stage__index {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #1f57cc;
  font-size: 11px;
  font-weight: 800;
}

.compare-stage__head strong {
  display: block;
  margin-top: 6px;
  font-size: 15px;
  line-height: 1.4;
}

.compare-stage__head p {
  margin: 4px 0 0;
  color: #66758d;
  font-size: 12px;
  line-height: 1.5;
}

.compare-stage__concept {
  margin-top: 6px;
}

.compare-tag {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(141, 107, 255, 0.1);
  color: #6c4dda;
  font-size: 11px;
  font-weight: 700;
}

.compare-task-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.compare-task {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(205, 216, 238, 0.3);
}

.compare-task--diff {
  border-color: rgba(255, 170, 100, 0.3);
}

.compare-task strong {
  display: block;
  font-size: 13px;
  line-height: 1.4;
}

.compare-task__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.compare-chip {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.05);
  color: #66758d;
  font-size: 11px;
  font-weight: 700;
}

.compare-btn {
  padding: 10px 18px;
  border-radius: 999px;
  border: 0;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.compare-btn--ghost {
  background: rgba(15, 23, 42, 0.05);
  color: #4d5b72;
}

.compare-btn--ghost:hover {
  background: rgba(15, 23, 42, 0.08);
}

.compare-header__actions {
  display: flex;
  gap: 8px;
}
</style>
