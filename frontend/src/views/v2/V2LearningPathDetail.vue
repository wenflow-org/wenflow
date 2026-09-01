<template>
  <div class="detail v2-page">
    <V2Nav />

    <main class="detail__main">
      <!-- 面包屑 -->
      <div class="crumbs">
        <router-link to="/learning-paths" class="crumbs__back">‹ 路径列表</router-link>
        <span class="crumbs__sep">/</span>
        <span class="crumbs__current">{{ pathTitle || '路径详情' }}</span>
      </div>

      <!-- 加载 -->
      <div v-if="loading" class="detail__loading">
        <span class="spinner"></span>
        <p>正在加载路径详情…</p>
      </div>

      <!-- 失败 -->
      <div v-else-if="loadError" class="errorbar">
        路径详情加载失败。<button type="button" class="errorbar__retry" @click="load()">重试</button>
      </div>

      <template v-else-if="path">
        <!-- 生成中/失败横幅 -->
        <section v-if="lifecycle && lifecycle.phase !== 'ready'" class="genbar card" :class="`genbar--${lifecycleFailed ? 'failed' : 'working'}`">
          <template v-if="lifecycleFailed">
            <div class="genbar__text">
              <strong>{{ lifecycle.retryType === 'stage_design' ? '阶段任务准备失败' : '路径主结构生成失败' }}</strong>
              <p>{{ lifecycle.errorMessage || '目标和已确认信息已保留，重试一般能成功。' }}</p>
            </div>
            <button type="button" class="btn-primary" :class="{ 'btn-primary--off': retrying }" @click="doRetry">
              <span v-if="retrying" class="spinner spinner--sm"></span>
              {{ retrying ? '正在重新生成…' : (lifecycle.retryType === 'stage_design' ? '重新准备阶段任务' : '重新生成主结构') }}
            </button>
          </template>
          <template v-else>
            <span class="spinner"></span>
            <div class="genbar__text">
              <strong>{{ lifecycle.phase === 'core' ? '正在生成路径主结构…' : `正在准备阶段任务（${lifecycle.completedStages}/${lifecycle.totalStages}）…` }}</strong>
              <p>页面会自动刷新，你也可以先去别的页面看看。</p>
            </div>
          </template>
        </section>

        <!-- 头部 Hero -->
        <section class="hero card">
          <div class="hero__main">
            <div class="hero__tags">
              <span class="badge" :class="badgeCls">{{ badgeText }}</span>
            </div>
            <h1>{{ pathTitle }}</h1>
            <p>{{ path.description || path.summary }}</p>
            <AiContentNote class="hero__ai-note" />
            <div class="hero__metrics">
              <span class="metric"><b>{{ currentStageNo }} / {{ stages.length || '?' }}</b>当前阶段</span>
              <span class="metric"><b>{{ path.estimatedHours || '—' }} 小时</b>预计投入</span>
              <span class="metric"><b>{{ doneTasks }} / {{ totalTasks }}</b>任务进度</span>
              <span v-if="path.deadlineText" class="metric"><b>{{ path.deadlineText }}</b>目标周期</span>
            </div>
            <div class="hero__actions">
              <span
                v-if="currentTask && canLearn"
                class="btn-primary"
                @click="goLearn(currentTask.id)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                {{ currentTask.status === 'in_progress' ? '继续当前任务' : '开始学习' }}
              </span>
              <span
                v-if="canLearn"
                class="btn-ghost"
                title="觉得路径不合适？补充说明后重新生成"
                @click="openAdjustDialog"
              >
                补充说明调整
              </span>
              <span v-else-if="allDone" class="btn-ghost">全部任务已完成</span>
            </div>
          </div>
          <div class="hero__ring">
            <svg viewBox="0 0 120 120" width="120" height="120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#edf1f8" stroke-width="10" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke="url(#v2ringGrad)" stroke-width="10" stroke-linecap="round"
                :stroke-dasharray="326.7" :stroke-dashoffset="326.7 * (1 - percent / 100)"
                transform="rotate(-90 60 60)"
              />
              <defs>
                <linearGradient id="v2ringGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#3478f6" />
                  <stop offset="100%" stop-color="#43b0d8" />
                </linearGradient>
              </defs>
            </svg>
            <div class="hero__ring-text"><b>{{ percent }}%</b><small>整体进度</small></div>
          </div>
        </section>

        <!-- 视图切换 -->
        <div class="view-toggle">
          <button
            type="button"
            class="view-toggle__btn"
            :class="{ 'view-toggle__btn--active': viewMode === 'list' }"
            @click="setView('list')"
          ><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v3h14V5H5zm0 5v9h6v-9H5zm8 0v9h6v-9h-6z" opacity=".9"/></svg> 列表视图</button>
          <button
            type="button"
            class="view-toggle__btn"
            :class="{ 'view-toggle__btn--active': viewMode === 'timeline' }"
            @click="setView('timeline')"
          ><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6 2a1 1 0 0 0-1 1v1H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1V3a1 1 0 1 0-2 0v1H9V3a1 1 0 0 0-2 0v1H7V3a1 1 0 0 0-1-1zM4 8h16v11H4V8zm2 3v2h5v-2H6zm7 0v2h5v-2h-5z" opacity=".9"/></svg> 时间线视图</button>
        </div>

        <div class="detail__grid">
          <!-- ===== 列表视图 ===== -->
          <div v-if="viewMode === 'list'" class="stages">
            <section v-if="!stages.length" class="stages__empty card">
              <span class="kicker">路径准备中</span>
              <strong>还没有阶段与任务</strong>
              <p>阶段与任务生成后，会在这里展示学习计划。请稍后刷新页面查看。</p>
            </section>
            <section v-for="(stage, si) in stages" :key="stage.id || si" class="stage card" :class="`stage--${stageStatus(stage, si)}`">
              <button type="button" class="stage__head" @click="toggleStage(si)">
                <span class="stage__no" :class="`stage__no--${stageStatus(stage, si)}`">
                  <svg v-if="stageStatus(stage, si) === 'done'" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                  <template v-else>{{ stageNo(stage, si) }}</template>
                </span>
                <span class="stage__title">
                  <strong>阶段 {{ stageNo(stage, si) }} · {{ stage.title }}</strong>
                  <small>{{ stage.goal || stage.description }}</small>
                </span>
                <span class="stage__prog">{{ stageDoneCount(stage) }} / {{ stageTasks(stage).length }}</span>
                <span class="stage__chev" :class="{ 'stage__chev--open': openStages.includes(si) }">⌄</span>
              </button>

              <div class="stage__body" :class="{ 'stage__body--open': openStages.includes(si) }">
                <div class="stage__body-inner">
                  <ul v-if="objectivesOf(stage).length" class="objectives">
                    <li v-for="(o, oi) in objectivesOf(stage)" :key="oi">{{ o }}</li>
                  </ul>
                  <div
                    v-for="task in stageTasks(stage)"
                    :key="task.id"
                    class="task"
                    :class="`task--${taskCls(task)}`"
                  >
                  <span class="task__icon">
                    <svg v-if="task.status === 'completed'" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                    <svg v-else-if="taskCls(task) === 'locked'" viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6-6h-1V9a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM9 9a3 3 0 0 1 6 0v2H9V9z"/></svg>
                    <i v-else></i>
                  </span>
                  <div class="task__body">
                    <strong>{{ task.title || task.displayLabel }}</strong>
                    <small>{{ taskKindText(task) }} · 约 {{ task.estimatedMinutes || '—' }} 分钟</small>
                  </div>
                  <button type="button" v-if="task.id === currentTask?.id && canLearn" class="task__cta" @click="goLearn(task.id)">
                    {{ task.status === 'in_progress' ? '继续学习' : '开始学习' }}
                  </button>
                  <button type="button" v-else-if="task.status === 'completed'" class="task__done-label" @click="viewFeedback(task)">查看反馈</button>
                  <span v-else-if="taskCls(task) === 'locked'" class="task__lock-label">待解锁</span>
                  <button type="button" v-else-if="task.status === 'in_progress'" class="task__cta" @click="goLearn(task.id)">继续学习</button>
                  <span v-else class="task__todo-label">待开始</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- ===== 时间线视图 ===== -->
          <div v-else-if="viewMode === 'timeline'" class="stages tl">
            <section v-if="!stages.length" class="stages__empty card">
              <span class="kicker">路径准备中</span>
              <strong>还没有阶段与任务</strong>
              <p>阶段与任务生成后，会在这里展示学习计划。请稍后刷新页面查看。</p>
            </section>

            <!-- 开始节点 -->
            <div v-if="stages.length" class="tl__start">
              <span class="tl__node tl__node--start">○</span>
              <span class="tl__label">开始</span>
            </div>

            <!-- 阶段节点 -->
            <div
              v-for="(stage, si) in stages"
              :key="stage.id || si"
              class="tl__stage"
              :class="`tl__stage--${stageStatus(stage, si)}`"
            >
              <!-- 阶段头部 -->
              <div class="tl__row" @click="toggleTimelineStage(si)">
                <span class="tl__node tl__node--stage" :class="`tl__node--${stageStatus(stage, si)}`">
                  <svg v-if="stageStatus(stage, si) === 'done'" viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                </span>
                <div class="tl__info">
                  <div class="tl__head">
                    <strong class="tl__title">阶段{{ stageNo(stage, si) }}: {{ stage.title }}</strong>
                    <span v-if="stageStatus(stage, si) === 'done'" class="tl__badge tl__badge--done">
                      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>已完成
                    </span>
                    <span v-else-if="stageStatus(stage, si) === 'current'" class="tl__badge tl__badge--current">
                      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".9"/><path fill="currentColor" d="M10 16.5l6-4.5-6-4.5z"/></svg>进行中
                    </span>
                    <span v-else class="tl__badge tl__badge--locked">
                      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 0 1 6 0v3H9z"/></svg>待解锁
                    </span>
                  </div>
                  <small class="tl__desc">{{ stage.goal || stage.description }}</small>
                  <div class="tl__prog-bar">
                    <div class="tl__prog-fill" :style="{ width: stagePercent(stage) + '%' }"></div>
                  </div>
                  <small class="tl__prog-text">{{ stageDoneCount(stage) }} / {{ stageTasks(stage).length }} 完成</small>
                </div>
                <span class="tl__chev" :class="{ 'tl__chev--open': timelineOpenStages.includes(si) }">⌄</span>
              </div>

              <!-- 任务列表 -->
              <div class="tl__tasks" :class="{ 'tl__tasks--open': timelineOpenStages.includes(si) }">
                <div class="tl__tasks-inner">
                  <div
                    v-for="task in stageTasks(stage)"
                    :key="task.id"
                    class="tl__task"
                    :class="`tl__task--${taskCls(task)}`"
                    @click="onTaskClick(task)"
                  >
                    <span class="tl__task-connector"></span>
                    <span class="tl__task-dot" :class="`tl__task-dot--${taskCls(task)}`">
                      <svg v-if="task.status === 'completed'" viewBox="0 0 24 24" width="8" height="8"><path fill="#fff" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                      <span v-else-if="taskCls(task) === 'current'" class="tl__task-spinner"></span>
                    </span>
                    <div class="tl__task-body">
                      <strong>{{ task.title || task.displayLabel }}</strong>
                      <small>{{ taskKindText(task) }} · {{ task.estimatedMinutes || '—' }}分钟</small>
                    </div>
                    <span class="tl__task-status">
                      <template v-if="task.status === 'completed'">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg> 已完成
                      </template>
                      <template v-else-if="taskCls(task) === 'current'">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".9"/><path fill="currentColor" d="M10 16.5l6-4.5-6-4.5z"/></svg> 当前
                      </template>
                      <template v-else-if="taskCls(task) === 'locked'">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 0 1 6 0v3H9z"/></svg>
                      </template>
                      <template v-else>○ 待开始</template>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 完成节点 -->
            <div v-if="stages.length" class="tl__end" :class="{ 'tl__end--done': allDone }">
              <span class="tl__node tl__node--end" :class="{ 'tl__node--end-done': allDone }">{{ allDone ? '✓' : '○' }}</span>
              <span class="tl__label" :class="{ 'tl__label--done': allDone }">完成</span>
            </div>
          </div>

          <!-- 侧栏 -->
          <aside class="side">
            <section v-if="!stages.length" class="card sidecard">
              <span class="kicker">路径状态</span>
              <p class="chart__empty">暂无任务安排</p>
            </section>

            <section v-if="currentTask" class="card sidecard sidecard--current">
              <span class="kicker">当前任务</span>
              <strong>{{ currentTask.title || currentTask.displayLabel }}</strong>
              <p>完成后还剩 {{ remainingAfterCurrent }} 个任务。</p>
              <div class="sidecard__meta">
                <span class="tag tag--blue">约 {{ currentTask.estimatedMinutes || '—' }} 分钟</span>
                <span class="tag">{{ taskKindText(currentTask) }}</span>
              </div>
              <button type="button" v-if="canLearn" class="btn-primary btn-primary--block" @click="goLearn(currentTask.id)">开始学习</button>
            </section>

            <section v-if="nextTasks.length" class="card sidecard">
              <span class="kicker">接下来的任务</span>
              <ol class="next-list">
                <li v-for="t in nextTasks" :key="t.id">
                  <strong>{{ t.title || t.displayLabel }}</strong>
                  <small>{{ t.estimatedMinutes || '—' }} 分钟</small>
                </li>
              </ol>
            </section>

            <section v-if="sceneSummary" class="card sidecard">
              <span class="kicker">设计意图</span>
              <strong v-if="sceneSummaryTitle" class="sidecard__intent-title">{{ sceneSummaryTitle }}</strong>
              <dl v-if="sceneRows.length" class="sidecard__rows">
                <div v-for="row in sceneRows" :key="row.label" class="sidecard__row">
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </template>
    </main>

    <!-- 补充说明调整弹窗 -->
    <div v-if="adjustDialogOpen" class="adjust-dialog-mask" @click.self="adjustDialogOpen = false">
      <div class="adjust-dialog card">
        <h3 class="adjust-dialog__title">补充说明调整路径</h3>
        <p class="adjust-dialog__desc">
          觉得路径不合适？说说哪里需要调整（节奏、难度、阶段顺序、范围等）。已完成的内容会保留，未开始的部分会按你的说明重新规划。
        </p>
        <textarea
          v-model="adjustText"
          class="adjust-dialog__textarea"
          rows="4"
          maxlength="500"
          placeholder="例如：第二阶段太难了，先补一下基础再进入；整体节奏想放慢一些……"
        ></textarea>
        <div class="adjust-dialog__actions">
          <button type="button" class="btn-ghost" :disabled="adjusting" @click="adjustDialogOpen = false">取消</button>
          <button
            type="button"
            class="btn-primary"
            :class="{ 'btn-primary--off': adjusting }"
            :disabled="adjusting || !adjustText.trim()"
            @click="submitAdjust"
          >
            <span v-if="adjusting" class="spinner spinner--sm"></span>
            {{ adjusting ? '正在调整…' : '确认调整' }}
          </button>
        </div>
      </div>
    </div>

    <!-- AI 生成提示 + 页脚：一起沉底 -->
    <div class="detail__foot">
      <div class="detail__ai-note">
        <AiContentNote />
      </div>
      <V2Footer />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { learningAPI } from '@/api/learning';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { toast } from '@/utils/toast';
import { askConfirm } from '@/views/admin-redesign/useConfirm';
import V2Nav from './V2Nav.vue';
import V2Footer from './V2Footer.vue';
import AiContentNote from '@/components/AiContentNote.vue';

const route = useRoute();
const router = useRouter();
const pathId = ref(String(route.params.id || ''));

const path = ref<Record<string, any> | null>(null);
const lifecycle = ref<Record<string, any> | null>(null);
const loading = ref(true);
const loadError = ref(false);
const retrying = ref(false);
const openStages = ref<number[]>([]);

/* ---------- 视图切换 ---------- */
const viewMode = ref<'list' | 'timeline'>((() => {
  try { return (localStorage.getItem('v2_path_view') || 'list') as 'list' | 'timeline'; } catch { return 'list'; }
})());
const timelineOpenStages = ref<number[]>([]);

function setView(mode: 'list' | 'timeline') {
  viewMode.value = mode;
  try { localStorage.setItem('v2_path_view', mode); } catch { /* ignore */ }
}

function toggleTimelineStage(si: number) {
  const i = timelineOpenStages.value.indexOf(si);
  if (i >= 0) timelineOpenStages.value.splice(i, 1);
  else timelineOpenStages.value.push(si);
}

function stagePercent(stage: Record<string, any>): number {
  const tasks = stageTasks(stage);
  if (!tasks.length) return 0;
  return Math.round((tasks.filter(t => t.status === 'completed').length / tasks.length) * 100);
}

function onTaskClick(task: Record<string, any>) {
  const cls = taskCls(task);
  if (cls === 'locked') return;
  goLearn(task.id);
}

const pathTitle = computed(() => path.value?.title || path.value?.name || '');

async function load(silent = false) {
  if (!silent) loading.value = true;
  loadError.value = false;
  try {
    const p = await learningAPI.getPathDetail(pathId.value) as unknown as Record<string, any>;
    path.value = p;
    lifecycle.value = p.generationLifecycle ?? null;
    if (p.generationLifecycle && p.generationLifecycle.phase !== 'ready') {
      if (p.generationLifecycle.status === 'processing' || p.generationLifecycle.status === 'queued') {
        schedulePoll();
      }
    }
    // 默认展开：第一个未完成的阶段 + 当前阶段
    const idx = stages.value.findIndex((s) => stageStatusRaw(s) !== 'done');
    openStages.value = idx >= 0 ? [...new Set([Math.max(0, idx - 1), idx])] : stages.value.map((_, i) => i);
    // 时间线视图：展开已完成 + 当前阶段
    timelineOpenStages.value = stages.value
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => stageStatus(s, i) === 'done' || stageStatus(s, i) === 'current')
      .map(({ i }) => i);
  } catch {
    if (!silent) loadError.value = true;
  } finally {
    loading.value = false;
  }
}

// 同一路由组件在 /learning-path/a → /learning-path/b 间复用时重新加载
watch(
  () => route.params.id,
  (next) => {
    if (typeof next === 'string' && next !== pathId.value) {
      pathId.value = next;
      openStages.value = [];
      load();
    }
  }
);

const lifecycleFailed = computed(() => lifecycle.value && (lifecycle.value.status === 'failed' || lifecycle.value.status === 'stale'));
const canLearn = computed(() => !lifecycle.value || lifecycle.value.phase === 'ready');

/* ---------- 生成轮询 ---------- */
let pollTimer = 0;
function schedulePoll() {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(pollOnce, 5000);
}
async function pollOnce() {
  try {
    const lc = await learningAPI.getPathGenerationStatus(pathId.value) as unknown as Record<string, any>;
    if (lc.phase === 'ready' || lc.status === 'failed' || lc.status === 'stale') {
      // 生成完成/失败：静默刷新详情，避免整页 loading 闪烁
      await load(true);
      return;
    }
    lifecycle.value = lc;
  } catch { /* ignore */ }
  schedulePoll();
}

async function doRetry() {
  if (retrying.value || !lifecycle.value) return;
  retrying.value = true;
  try {
    if (lifecycle.value.retryType === 'stage_design') {
      await learningAPI.retryPathEnrichment(pathId.value);
    } else {
      await learningAPI.retryPathGeneration(pathId.value);
    }
    lifecycle.value = { ...lifecycle.value, status: 'processing' };
    schedulePoll();
  } catch {
    toast.error('重新生成失败，请稍后再试');
  } finally {
    retrying.value = false;
  }
}

/* ---------- 补充说明调整 ---------- */
const adjustDialogOpen = ref(false);
const adjustText = ref('');
const adjusting = ref(false);

function openAdjustDialog() {
  adjustText.value = '';
  adjustDialogOpen.value = true;
}

async function submitAdjust() {
  const t = adjustText.value.trim();
  if (!t || adjusting.value) return;
  adjusting.value = true;
  try {
    const res = await learningAPI.regeneratePath(pathId.value, t) as unknown as { message?: string; data?: any };
    adjustDialogOpen.value = false;
    const status = res?.data?.status;
    if (status === 'redesigned-stage') {
      toast.success(res?.message || '已按你的补充说明调整后续阶段');
      // 重设计是异步的，稍后刷新看到新任务
      setTimeout(() => { load(true); }, 1500);
    } else if (status === 'awaiting-confirmation') {
      toast.info('调整方案已生成，需在路径页确认后生效');
    } else {
      // regenerating：整路径重建，进入轮询
      toast.success(res?.message || '正在按你的补充说明重新生成');
      schedulePoll();
      setTimeout(() => { load(true); }, 1500);
    }
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || err?.message || '调整失败，请稍后再试';
    toast.error(msg);
  } finally {
    adjusting.value = false;
  }
}

/* ---------- 阶段/任务 ---------- */
const stages = computed<Array<Record<string, any>>>(() => {
  const list = path.value?.milestones || path.value?.weeks || [];
  return [...list].sort((a, b) => (a.stageNumber ?? a.weekNumber ?? 0) - (b.stageNumber ?? b.weekNumber ?? 0));
});

function stageTasks(stage: Record<string, any>) {
  return (stage.subtasks || stage.tasks || []) as Array<Record<string, any>>;
}

function stageNo(stage: Record<string, any>, si: number) {
  return stage.stageNumber ?? stage.weekNumber ?? si + 1;
}

function stageDoneCount(stage: Record<string, any>) {
  return stageTasks(stage).filter((t) => t.status === 'completed').length;
}

function stageStatusRaw(stage: Record<string, any>) {
  const tasks = stageTasks(stage);
  if (tasks.length && tasks.every((t) => t.status === 'completed')) return 'done';
  return 'open';
}

function stageStatus(stage: Record<string, any>, si: number) {
  if (stageStatusRaw(stage) === 'done') return 'done';
  const firstOpen = stages.value.findIndex((s) => stageStatusRaw(s) !== 'done');
  return si === firstOpen ? 'current' : 'todo';
}

function objectivesOf(stage: Record<string, any>): string[] {
  const raw = stage.learningObjectives;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string' && x.trim());
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x: unknown) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toggleStage(si: number) {
  const i = openStages.value.indexOf(si);
  if (i >= 0) openStages.value.splice(i, 1);
  else openStages.value.push(si);
}

/* ---------- 进度 ---------- */
const allTasks = computed(() => stages.value.flatMap((s) => stageTasks(s)));
const totalTasks = computed(() => allTasks.value.length);
const doneTasks = computed(() => allTasks.value.filter((t) => t.status === 'completed').length);
const percent = computed(() => (totalTasks.value ? Math.round((doneTasks.value / totalTasks.value) * 100) : 0));
const allDone = computed(() => totalTasks.value > 0 && doneTasks.value === totalTasks.value);

const currentTask = computed(() => {
  const inProgress = allTasks.value.find((t) => t.status === 'in_progress');
  if (inProgress) return inProgress;
  return allTasks.value.find((t) => t.status === 'todo' || !t.status) ?? null;
});

const currentStageNo = computed(() => {
  if (!currentTask.value) return stages.value.length;
  const idx = stages.value.findIndex((s) => stageTasks(s).some((t) => t.id === currentTask.value?.id));
  return idx >= 0 ? stageNo(stages.value[idx], idx) : 1;
});

const remainingAfterCurrent = computed(() => {
  if (!currentTask.value) return 0;
  const idx = allTasks.value.findIndex((t) => t.id === currentTask.value?.id);
  return Math.max(0, allTasks.value.length - idx - 1);
});

const nextTasks = computed(() => {
  if (!currentTask.value) return [];
  const idx = allTasks.value.findIndex((t) => t.id === currentTask.value?.id);
  return allTasks.value.slice(idx + 1, idx + 4);
});

const sceneSummary = computed(() => {
  const s = path.value?.sceneSummary;
  if (!s) return null;
  if (typeof s === 'string') return { title: s, rows: [] };
  if (typeof s !== 'object') return null;
  return s as Record<string, any>;
});

const sceneSummaryTitle = computed(() => {
  const s = sceneSummary.value;
  if (!s) return '';
  return typeof s === 'string' ? s : (s.title || s.summary || s.intent || '');
});

const sceneRows = computed(() => {
  const s = sceneSummary.value;
  if (!s || typeof s === 'string') return [];
  const rows: Array<{ label: string; value: string }> = [];
  if (s.firstDeliverable) rows.push({ label: '第一阶段产出', value: String(s.firstDeliverable) });
  if (s.targetState) rows.push({ label: '目标状态', value: String(s.targetState) });
  if (Array.isArray(s.planningFocus) && s.planningFocus.length) rows.push({ label: '规划焦点', value: s.planningFocus.join('、') });
  if (Array.isArray(s.excludedScope) && s.excludedScope.length) rows.push({ label: '先不学', value: s.excludedScope.join('、') });
  if (s.timeBudget) rows.push({ label: '时间预算', value: String(s.timeBudget) });
  if (s.timeHorizon) rows.push({ label: '时间跨度', value: String(s.timeHorizon) });
  return rows;
});

/* ---------- 展示辅助 ---------- */
const badgeText = computed(() => {
  if (lifecycle.value && lifecycle.value.phase !== 'ready') return lifecycleFailed.value ? '需要处理' : '生成中';
  if (allDone.value) return '已完成';
  return '进行中';
});
const badgeCls = computed(() => {
  if (lifecycle.value && lifecycle.value.phase !== 'ready') return lifecycleFailed.value ? 'badge--red' : 'badge--cyan';
  if (allDone.value) return 'badge--green';
  return 'badge--blue';
});

function taskCls(task: Record<string, any>) {
  if (task.status === 'completed') return 'completed';
  if (task.status === 'in_progress') return 'current';
  if (currentTask.value && task.id === currentTask.value.id) return 'current';
  if (!canLearn.value) return 'locked';
  const curIdx = allTasks.value.findIndex((t) => t.id === currentTask.value?.id);
  const myIdx = allTasks.value.findIndex((t) => t.id === task.id);
  return curIdx >= 0 && myIdx > curIdx ? 'locked' : 'todo';
}

function taskKindText(task: Record<string, any>) {
  return task.displayLabel || task.taskType || task.knowledgeType || '任务';
}

function goLearn(taskId: string) {
  router.push(`/learn/${taskId}`);
}

async function viewFeedback(task: Record<string, any>) {
  try {
    const detail = await aiTeachingAPI.getLatestTaskEvaluation(task.id);
    if (detail?.sessionId) {
      const pathQuery = pathId.value ? `?pathId=${encodeURIComponent(pathId.value)}` : '';
      router.push(`/learn/${task.id}/evaluation/${detail.sessionId}${pathQuery}`);
      return;
    }
  } catch {
    /* 无评估记录或加载失败：走降级引导 */
  }
  // 降级：无当堂评估记录时给出可操作的替代入口（回看历史；或用户自行重新进入任务学习）
  const go = await askConfirm({
    title: '暂无当堂评估记录',
    message: '这节课还没有生成学习反馈，可能是结算尚未完成。你可以回看学习历史；想继续学这个任务，也可以直接点任务卡片重新进入。',
    confirmText: '回看学习历史',
    danger: false,
  });
  if (go) router.push('/learning-history');
}

onMounted(load);
onBeforeUnmount(() => window.clearTimeout(pollTimer));
</script>

<style scoped>
/* wrapper 沉底：AI 提示与页脚一起贴近底部 */
.detail__foot { margin-top: auto; }
.detail__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.detail__ai-note :deep(.ai-note) { font-size: 11px; opacity: 0.75; }

.detail__main {
  max-width: 1080px; margin: 0 auto;
  padding: 20px 28px 48px;
  display: grid; gap: 16px;
}
.crumbs { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--faint); }
.crumbs__back { font-weight: 600; color: var(--muted); cursor: pointer; }
.crumbs__back:hover { color: var(--blue-deep); }
.crumbs__current { color: var(--ink); font-weight: 700; }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}
.kicker { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }
.badge { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; }
.badge--blue { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }

.hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; padding: 26px 28px; align-items: center; }
.hero__tags { display: flex; align-items: center; gap: 10px; }
.hero h1 { margin: 8px 0 6px; font-size: 28px; letter-spacing: -0.01em; }
.hero p { margin: 0; font-size: 14px; color: var(--muted); line-height: 1.7; max-width: 56ch; }
.hero__metrics { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.metric {
  display: grid; gap: 2px;
  padding: 9px 14px;
  background: var(--canvas, #f7faff); border: 1px solid var(--line, #e8eefb);
  border-radius: 12px;
  font-size: 11.5px; color: var(--faint);
}
.metric b { font-size: 14px; color: var(--ink); }
.hero__actions { display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 14px; font-weight: 700;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
  cursor: pointer; text-decoration: none;
}
.btn-primary--block { justify-content: center; width: 100%; }
.btn-ghost {
  padding: 10px 18px; border-radius: 12px;
  border: 1px solid var(--line); background: var(--surface, #fff);
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}
.hero__ring { position: relative; width: 120px; height: 120px; }
.hero__ring circle[stroke="url(#v2ringGrad)"] { transition: stroke-dashoffset .6s ease; }
.hero__ring-text {
  position: absolute; inset: 0;
  display: grid; place-content: center; text-align: center; gap: 2px;
}
.hero__ring-text b { font-size: 22px; }
.hero__ring-text small { font-size: 11px; color: var(--faint); }

.detail__grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.stages { display: grid; gap: 12px; }

.stages__empty {
  padding: 28px 24px;
  display: grid;
  gap: 6px;
  justify-items: start;
}

.stages__empty strong {
  font-size: 15px;
  color: var(--ink, #172033);
}

.stages__empty p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted, #5b6577);
}

.stage { overflow: hidden; }
.stage__head {
  display: grid; grid-template-columns: 34px 1fr auto 24px;
  align-items: center; gap: 12px;
  width: 100%;
  padding: 15px 18px;
  background: transparent; border: 0;
  font: inherit; text-align: left; cursor: pointer;
}
.stage__no {
  width: 30px; height: 30px; border-radius: 10px;
  background: #eef2f8; color: var(--faint);
  font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
}
.stage__no--done { background: var(--green); color: #fff; }
.stage__no--current { background: linear-gradient(135deg, var(--blue), var(--blue-deep)); color: #fff; box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.13); }
.stage__title strong { display: block; font-size: 14.5px; }
.stage__title small { display: block; margin-top: 2px; font-size: 12px; color: var(--faint); }
.stage__prog { font-size: 12px; font-weight: 800; color: var(--muted); }
.stage--current .stage__prog { color: var(--blue-deep); }
.stage__chev { color: var(--faint); font-size: 15px; transition: transform .18s ease; justify-self: end; }
.stage__chev--open { transform: rotate(180deg); }

.stage__body {
  display: grid; grid-template-rows: 0fr;
  border-top: 1px solid transparent;
  transition: grid-template-rows 0.32s cubic-bezier(0.32, 0.72, 0.24, 1), border-color 0.24s ease;
}
.stage__body--open { grid-template-rows: 1fr; border-top-color: var(--line); }
.stage__body-inner {
  overflow: hidden; min-height: 0;
  padding: 0 12px;
  display: grid; gap: 4px;
  opacity: 0;
  transition: opacity 0.22s ease, padding 0.32s cubic-bezier(0.32, 0.72, 0.24, 1);
}
.stage__body--open .stage__body-inner { padding: 8px 12px 12px; opacity: 1; }
.task {
  display: grid; grid-template-columns: 24px 1fr auto;
  align-items: center; gap: 11px;
  padding: 9px 10px;
  border-radius: 11px;
  border: 1px solid transparent;
}
.task--current { background: rgba(52, 120, 246, 0.06); border-color: rgba(52, 120, 246, 0.2); }
.task--locked { opacity: .62; }
.task__icon {
  width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center;
}
.task--completed .task__icon { background: var(--green); color: #fff; }
.task--current .task__icon { border: 2px solid var(--blue); box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.14); }
.task--todo .task__icon { border: 2px dashed #cfdaee; }
.task--locked .task__icon { color: var(--faint); background: #eef2f8; }
.task__body strong { display: block; font-size: 13.5px; }
.task__body small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--faint); }
.task__cta {
  font-size: 12px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  padding: 6px 13px; border-radius: 9px;
  cursor: pointer;
  box-shadow: 0 6px 14px rgba(52, 120, 246, 0.25);
}
.task__done-label { font-size: 12px; font-weight: 600; color: var(--green); cursor: pointer; }
.task__lock-label, .task__todo-label { font-size: 12px; color: var(--faint); }

.side { display: grid; gap: 12px; position: sticky; top: 16px; }
.sidecard { padding: 16px 18px; display: grid; gap: 10px; align-content: start; }
.sidecard strong { font-size: 14.5px; line-height: 1.5; }
.sidecard p { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.65; }
.sidecard__meta { display: flex; gap: 8px; flex-wrap: wrap; }
.sidecard--current { border-color: rgba(52, 120, 246, 0.3); }
.tag {
  padding: 4px 10px; border-radius: 999px;
  background: var(--line, #f1f5fb); border: 1px solid var(--line);
  font-size: 11.5px; font-weight: 600; color: var(--muted);
}
.tag--blue { background: rgba(52, 120, 246, 0.09); border-color: rgba(52, 120, 246, 0.3); color: var(--blue-deep); }
.next-list { margin: 0; padding: 0 0 0 18px; display: grid; gap: 9px; }
.next-list strong { display: block; font-size: 13px; line-height: 1.45; }
.next-list small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--faint); }
.sidecard__sum { font-size: 12px; font-weight: 700; color: var(--muted); border-top: 1px dashed var(--line); padding-top: 9px; }
.sidecard__text { font-size: 13px; }
.sidecard__intent-title { font-size: 14px; line-height: 1.5; }
.sidecard__rows { margin: 0; display: grid; gap: 8px; }
.sidecard__row { display: grid; gap: 2px; }
.sidecard__row dt { font-size: 11px; font-weight: 800; color: var(--faint); letter-spacing: 0.03em; }
.sidecard__row dd { margin: 0; font-size: 12.5px; line-height: 1.65; color: var(--muted); }

@media (max-width: 900px) {
  .detail__main { padding: 14px 14px 32px; }
  .hero { grid-template-columns: 1fr; }
  .hero__ring { justify-self: center; }
  .hero h1 { font-size: 22px; }
  .detail__grid { grid-template-columns: 1fr; }
  .side { position: static; }
}
</style>

<style scoped>
.detail__loading { display: grid; justify-items: center; gap: 12px; padding: 64px 0; color: var(--faint); font-size: 13px; }
.badge--green { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.badge--cyan { color: #2b7a99; background: rgba(67, 176, 216, 0.14); }
.badge--red { color: #c0454a; background: rgba(239, 117, 120, 0.12); }
.genbar {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 20px;
}
.genbar--failed { border-color: rgba(239, 117, 120, 0.35); }
.genbar__text { flex: 1; }
.genbar__text strong { font-size: 14px; }
.genbar__text p { margin: 4px 0 0; font-size: 12.5px; color: var(--muted); }
.objectives {
  margin: 0 0 8px; padding: 10px 12px 10px 28px;
  background: var(--canvas, #f7faff); border: 1px solid var(--line, #e8eefb); border-radius: 10px;
  display: grid; gap: 4px;
}
.objectives li { font-size: 12.5px; color: var(--muted); line-height: 1.55; }
.task--current .task__todo-label { color: var(--blue-deep); font-weight: 700; }
.detail__main { width: 100%; }
</style>

<style scoped>
/* 超长机器生成标题：两行截断 */
.pcard__title, .hero h1, .path__title strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>

<style scoped>
/* ===== 视图切换按钮 ===== */
.view-toggle {
  display: flex; gap: 4px;
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e4e9f2);
  border-radius: 12px;
  padding: 4px;
  width: fit-content;
}
.view-toggle__btn {
  padding: 8px 16px;
  border: none; border-radius: 9px;
  background: transparent;
  font-size: 13px; font-weight: 600;
  color: var(--muted, #5b6577);
  cursor: pointer;
  transition: background 0.2s, color 0.2s, box-shadow 0.2s;
}
.view-toggle__btn:hover { color: var(--ink, #172033); background: var(--line, #f1f5fb); }
.view-toggle__btn--active {
  background: linear-gradient(135deg, var(--blue, #3478f6), var(--blue-deep, #2563eb));
  color: #fff;
  box-shadow: 0 2px 8px rgba(52, 120, 246, 0.25);
}

/* ===== 时间线容器 ===== */
.tl {
  position: relative;
  display: flex; flex-direction: column;
  gap: 0;
  padding: 0 0 0 8px;
}

/* 垂直时间线连接线 */
.tl::before {
  content: '';
  position: absolute;
  left: 19px; top: 16px; bottom: 16px;
  width: 2px;
  background: var(--line, #e4e9f2);
  border-radius: 1px;
}

/* ===== 开始 / 完成端点 ===== */
.tl__start, .tl__end {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 0;
  position: relative; z-index: 1;
}
.tl__node {
  width: 12px; height: 12px; border-radius: 50%;
  display: grid; place-items: center;
  flex-shrink: 0;
  font-size: 10px; line-height: 1;
}
.tl__node--start {
  border: 2px solid var(--blue, #3478f6);
  background: var(--surface, #fff);
  color: var(--blue, #3478f6);
}
.tl__node--end {
  border: 2px solid var(--faint, #b0b8c8);
  background: var(--surface, #fff);
  color: var(--faint, #b0b8c8);
  font-size: 9px;
}
.tl__node--end-done {
  border-color: var(--green, #31b16f);
  background: var(--green, #31b16f);
  color: #fff;
}
.tl__label {
  font-size: 13px; font-weight: 700;
  color: var(--muted, #5b6577);
}
.tl__label--done { color: var(--green, #31b16f); }

/* ===== 阶段节点 ===== */
.tl__stage {
  position: relative; z-index: 1;
  padding: 4px 0;
}
.tl__row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 10px 14px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.tl__row:hover { background: rgba(52, 120, 246, 0.04); }

/* 阶段圆形节点 */
.tl__node--stage {
  width: 14px; height: 14px; border-radius: 50%;
  margin-top: 3px;
  flex-shrink: 0;
  transition: box-shadow 0.3s, border-color 0.3s, background 0.3s;
}
.tl__node--done {
  border: none;
  background: var(--blue, #3478f6);
  color: #fff;
}
.tl__node--current {
  border: 3px solid var(--blue, #3478f6);
  background: var(--surface, #fff);
  box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.18);
  animation: tl-pulse 2s ease-in-out infinite;
}
.tl__node--todo {
  border: 2px solid var(--faint, #b0b8c8);
  background: var(--surface, #fff);
  color: var(--faint, #b0b8c8);
}

@keyframes tl-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.18); }
  50%      { box-shadow: 0 0 0 8px rgba(52, 120, 246, 0.08); }
}

/* 阶段信息区 */
.tl__info { flex: 1; min-width: 0; }
.tl__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tl__title { font-size: 14.5px; color: var(--ink, #172033); }
.tl__desc { display: block; margin-top: 2px; font-size: 12.5px; color: var(--faint, #b0b8c8); line-height: 1.5; }

/* 状态徽章（图标 + 文字对齐） */
.tl__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px; font-weight: 700;
  white-space: nowrap;
}
.tl__badge--done { background: rgba(49, 177, 111, 0.1); color: #1d7a4c; }
.tl__badge--current { background: rgba(52, 120, 246, 0.1); color: var(--blue-deep, #2563eb); }
.tl__badge--locked { background: var(--line, #f1f5fb); color: var(--muted, #5b6577); }

/* 进度条 */
.tl__prog-bar {
  margin-top: 8px;
  height: 4px; border-radius: 2px;
  background: var(--line, #e4e9f2);
  overflow: hidden;
}
.tl__prog-fill {
  height: 100%; border-radius: 2px;
  background: linear-gradient(90deg, var(--blue, #3478f6), var(--blue-deep, #2563eb));
  transition: width 0.4s ease;
}
.tl__prog-text {
  display: block; margin-top: 4px;
  font-size: 11.5px; color: var(--faint, #b0b8c8);
}

/* 展开/折叠箭头 */
.tl__chev {
  margin-top: 4px;
  color: var(--faint, #b0b8c8);
  font-size: 14px;
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
.tl__chev--open { transform: rotate(180deg); }

/* 左边框：已完成/进行中蓝色，待解锁灰色 */
.tl__stage--done .tl__row,
.tl__stage--current .tl__row {
  border-left: 3px solid var(--blue, #3478f6);
  margin-left: 13px; padding-left: 11px;
}
.tl__stage--todo .tl__row {
  border-left: 3px solid var(--faint, #b0b8c8);
  margin-left: 13px; padding-left: 11px;
}

/* ===== 任务列表（可展开） ===== */
.tl__tasks {
  display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows 0.32s cubic-bezier(0.32, 0.72, 0.24, 1);
}
.tl__tasks--open { grid-template-rows: 1fr; }
.tl__tasks-inner {
  overflow: hidden; min-height: 0;
  padding-left: 32px;
  display: grid; gap: 2px;
}

/* 单个任务行 */
.tl__task {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}
.tl__task:hover { background: rgba(52, 120, 246, 0.04); }
.tl__task--locked { opacity: 0.55; cursor: not-allowed; }

/* 任务连接线 */
.tl__task-connector {
  position: absolute;
  left: -8px; top: 0; bottom: 0;
  width: 2px;
  background: var(--line, #e4e9f2);
}

/* 任务节点圆点 */
.tl__task-dot {
  width: 8px; height: 8px; border-radius: 50%;
  display: grid; place-items: center;
  flex-shrink: 0;
  position: relative; z-index: 1;
}
.tl__task-dot--completed {
  background: var(--green, #31b16f);
}
.tl__task-dot--current {
  background: var(--blue, #3478f6);
  box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.2);
  animation: tl-dot-pulse 1.5s ease-in-out infinite;
}
.tl__task-dot--todo {
  border: 2px dashed #cfdaee;
  background: var(--surface, #fff);
}
.tl__task-dot--locked {
  background: var(--faint, #b0b8c8);
  opacity: 0.4;
}

@keyframes tl-dot-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.2); }
  50%      { box-shadow: 0 0 0 6px rgba(52, 120, 246, 0.08); }
}

/* 任务文本 */
.tl__task-body { flex: 1; min-width: 0; }
.tl__task-body strong { display: block; font-size: 13px; color: var(--ink, #172033); }
.tl__task-body small { display: block; margin-top: 1px; font-size: 11.5px; color: var(--faint, #b0b8c8); }

/* 任务状态标签（图标 + 文字对齐） */
.tl__task-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px; font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 旋转指示器 */
.tl__task-spinner {
  display: block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--blue, #3478f6);
  animation: tl-spin 1s linear infinite;
}

@keyframes tl-spin {
  0%   { box-shadow: 0 0 0 0 var(--blue, #3478f6); }
  50%  { box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.3); }
  100% { box-shadow: 0 0 0 0 var(--blue, #3478f6); }
}

/* ===== 移动端适配 ===== */
@media (max-width: 900px) {
  .view-toggle { width: 100%; }
  .view-toggle__btn { flex: 1; text-align: center; font-size: 12.5px; }
  .tl__row { padding: 8px 10px; gap: 10px; }
  .tl__title { font-size: 13.5px; }
  .tl__badge { font-size: 10px; padding: 2px 6px; }
  .tl__tasks-inner { padding-left: 24px; }
  .tl__task-status { font-size: 10px; }
}

/* ===== 补充说明调整弹窗 ===== */
.adjust-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(10, 20, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.adjust-dialog {
  width: 100%;
  max-width: 480px;
  padding: 22px 24px;
}
.adjust-dialog__title {
  margin: 0 0 8px;
  font-size: 17px;
}
.adjust-dialog__desc {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
  color: #5a6b85;
}
.adjust-dialog__textarea {
  width: 100%;
  min-height: 96px;
  padding: 10px 12px;
  border: 1px solid #d9e1ee;
  border-radius: 8px;
  font-size: 13.5px;
  line-height: 1.6;
  resize: vertical;
  background: #fff;
  color: #1c2b45;
  box-sizing: border-box;
}
.adjust-dialog__textarea:focus {
  outline: none;
  border-color: #3478f6;
}
.adjust-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
</style>
