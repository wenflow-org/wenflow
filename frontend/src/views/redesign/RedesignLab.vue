<template>
  <section class="rl" :class="{ 'rl--present': fullscreen }">
    <header v-if="!fullscreen" class="rl-bar">
      <div class="rl-bar__brand">
        <span class="rl-bar__pill">重设计稿 v3 · 全套</span>
        <strong>问流 App 整体重设计 — 高保真原型</strong>
      </div>
      <div class="rl-bar__actions">
        <div class="rl-seg" role="tablist" aria-label="页面">
          <button
            v-for="s in mainScenes"
            :key="s.id"
            type="button"
            class="rl-seg__item"
            :class="{ 'rl-seg__item--active': labStore.scene === s.id }"
            @click="labGo(s.id)"
          >
            {{ s.label }}
          </button>
        </div>
        <span v-if="subSceneLabel" class="rl-subscene">当前：{{ subSceneLabel }}</span>
        <div class="rl-seg rl-seg--ghost" role="tablist" aria-label="设备">
          <button
            type="button"
            class="rl-seg__item"
            :class="{ 'rl-seg__item--active': device === 'desktop' }"
            @click="device = 'desktop'"
          >桌面</button>
          <button
            type="button"
            class="rl-seg__item"
            :class="{ 'rl-seg__item--active': device === 'mobile' }"
            @click="device = 'mobile'"
          >移动</button>
        </div>
        <button
          type="button"
          class="rl-compare"
          :class="{ 'rl-compare--on': compare }"
          :aria-pressed="compare"
          @click="compare = !compare"
        >
          {{ compare ? '退出对比' : '对比现有页面' }}
        </button>
        <button type="button" class="rl-present" @click="enterPresent">
          <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          全屏预览
        </button>
        <router-link to="/dashboard" class="rl-back">返回正式版</router-link>
      </div>
    </header>

    <div v-if="!fullscreen" class="rl-states">
      <template v-if="labStore.scene === 'dashboard'">
        <button
          v-for="st in dashStates"
          :key="st.id"
          type="button"
          class="rl-chip"
          :class="{ 'rl-chip--active': dashState === st.id }"
          @click="dashState = st.id"
        >
          {{ st.label }}<small>{{ st.hint }}</small>
        </button>
      </template>
      <template v-else-if="labStore.scene === 'goal'">
        <span class="rl-chip rl-chip--live">
          真实 AI 会话<small>后端 skill 驱动 · 非演示数据</small>
        </span>
        <button v-if="goalLive.started" type="button" class="rl-chip" @click="goalLive.reset()">
          结束当前对话<small>回到初始态</small>
        </button>
        <span v-if="goalLive.started" class="rl-chip rl-chip--info">
          阶段：{{ goalStageLabel }}<small>信息 {{ goalLive.filledCount }}/{{ goalLive.totalFields }}</small>
        </span>
      </template>
      <template v-else>
        <span class="rl-chip rl-chip--info">
          {{ sceneHint }}<small>演示数据 · 页面内跳转不离开原型</small>
        </span>
      </template>
    </div>

    <main class="rl-stage" :class="{ 'rl-stage--compare': compare, 'rl-stage--present': fullscreen }">
      <!-- 对比模式：左侧现有页面 iframe -->
      <div v-if="compare" class="rl-pane">
        <div class="rl-pane__label">
          <span class="rl-pane__tag rl-pane__tag--old">现有</span>
          {{ realRoute }}
          <small>需已登录</small>
        </div>
        <iframe class="rl-iframe" :src="realRoute" title="现有页面"></iframe>
      </div>

      <!-- 重设计稿 -->
      <div class="rl-pane">
        <div v-if="compare" class="rl-pane__label">
          <span class="rl-pane__tag rl-pane__tag--new">重设计</span>
          {{ sceneTitle }}
        </div>
        <div
          class="rl-frame"
          :class="{
            'rl-frame--mobile': device === 'mobile' && !compare,
            'rl-frame--full': fullscreen && device === 'desktop',
            'rl-frame--full-mobile': fullscreen && device === 'mobile'
          }"
        >
          <MockDashboard v-if="labStore.scene === 'dashboard'" :state="dashState" />
          <MockGoalConversation v-else-if="labStore.scene === 'goal'" />
          <MockLearningPaths v-else-if="labStore.scene === 'paths'" />
          <MockLearningPathDetail v-else-if="labStore.scene === 'path-detail'" />
          <MockLearningPage v-else-if="labStore.scene === 'learning'" />
          <MockLearningState v-else-if="labStore.scene === 'state'" />
          <MockAchievements v-else />
        </div>
      </div>
    </main>

    <!-- 全屏演示坞 -->
    <transition name="dock">
      <div v-if="fullscreen" class="rl-dock">
        <button
          v-for="s in mainScenes"
          :key="s.id"
          type="button"
          class="rl-dock__item"
          :class="{ 'rl-dock__item--active': labStore.scene === s.id }"
          @click="labGo(s.id)"
        >{{ s.label }}</button>
        <template v-if="labStore.scene === 'dashboard'">
          <span class="rl-dock__sep"></span>
          <button
            v-for="st in dashStates"
            :key="st.id"
            type="button"
            class="rl-dock__mini"
            :class="{ 'rl-dock__mini--active': dashState === st.id }"
            @click="dashState = st.id"
          >{{ st.label }}</button>
        </template>
        <span class="rl-dock__sep"></span>
        <button
          type="button"
          class="rl-dock__mini"
          :class="{ 'rl-dock__mini--active': device === 'mobile' }"
          @click="device = device === 'mobile' ? 'desktop' : 'mobile'"
        >{{ device === 'mobile' ? '手机' : '桌面' }}</button>
        <button type="button" class="rl-dock__exit" @click="exitPresent" title="退出全屏（Esc）">×</button>
      </div>
    </transition>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import MockDashboard from './MockDashboard.vue';
import MockGoalConversation from './MockGoalConversation.vue';
import MockLearningPaths from './MockLearningPaths.vue';
import MockLearningPathDetail from './MockLearningPathDetail.vue';
import MockLearningPage from './MockLearningPage.vue';
import MockLearningState from './MockLearningState.vue';
import MockAchievements from './MockAchievements.vue';
import { useGoalLive } from './useGoalLive';
import { labStore, labGo, type LabScene } from './labStore';

type DashState = 'active' | 'attention' | 'empty';

const device = ref<'desktop' | 'mobile'>('desktop');
const dashState = ref<DashState>('active');
const compare = ref(false);
const fullscreen = ref(false);

/* ---------- 全屏演示模式 ---------- */
function enterPresent() {
  compare.value = false;
  fullscreen.value = true;
  document.documentElement.requestFullscreen?.().catch(() => {});
}

function exitPresent() {
  fullscreen.value = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && fullscreen.value) exitPresent();
}

function onNativeFullscreenChange() {
  // 用户在浏览器原生全屏里按 Esc：同步退出演示模式
  if (!document.fullscreenElement && fullscreen.value) fullscreen.value = false;
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('fullscreenchange', onNativeFullscreenChange);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('fullscreenchange', onNativeFullscreenChange);
});

const goalLive = useGoalLive();
const goalStageLabel = computed(() => {
  if (goalLive.stageIndex === 3) return '可生成路径';
  if (goalLive.stageIndex === 2) return '方案确认中';
  return '澄清问题中';
});

const mainScenes: Array<{ id: LabScene; label: string }> = [
  { id: 'dashboard', label: '学习台' },
  { id: 'goal', label: '目标规划' },
  { id: 'paths', label: '学习路径' },
  { id: 'state', label: '学习状态' },
  { id: 'achievements', label: '成就' }
];

const sceneMeta: Record<LabScene, { title: string; hint: string; real: string }> = {
  dashboard: { title: '学习台 · 今日驾驶舱', hint: '3 种状态可切换', real: '/dashboard' },
  goal: { title: '目标规划 · 共创工作台（真实 AI）', hint: '真实 AI 会话', real: '/goal-conversation' },
  paths: { title: '学习路径 · 列表', hint: '筛选 / 生成中自动翻转 / 失败重试', real: '/learning-paths' },
  'path-detail': { title: '路径详情 · 阶段与任务', hint: '阶段折叠 · 任务状态', real: '/learning-paths' },
  learning: { title: '授课页 · 导师对话', hint: '知识点推进 · 检查点', real: '/learning-paths' },
  state: { title: '学习状态 · 指标与建议', hint: '趋势切换 · 建议采纳', real: '/learning-state' },
  achievements: { title: '成就 · 里程碑', hint: '筛选 · 领取成就', real: '/achievements' }
};

const sceneTitle = computed(() => sceneMeta[labStore.scene].title);
const sceneHint = computed(() => sceneMeta[labStore.scene].hint);
const realRoute = computed(() => sceneMeta[labStore.scene].real);
const subSceneLabel = computed(() => {
  if (labStore.scene === 'path-detail') return '路径详情（从路径列表进入）';
  if (labStore.scene === 'learning') return '授课页（从路径详情进入）';
  return '';
});

const dashStates: { id: DashState; label: string; hint: string }[] = [
  { id: 'active', label: '进行中', hint: '有路径有任务' },
  { id: 'attention', label: '需要处理', hint: '路径生成失败' },
  { id: 'empty', label: '新手态', hint: '还没有路径' }
];
</script>

<style scoped>
.rl {
  --ink: #172033;
  --muted: #5b6577;
  --faint: #8492ab;
  --line: #e3e9f4;
  --canvas: #f3f6fb;
  --surface: #ffffff;
  --blue: #3478f6;
  --blue-deep: #1f57cc;
  --accent: #8d6bff;
  --cyan: #43b0d8;
  --green: #31b16f;
  --amber: #f4aa46;
  --red: #ef7578;
  min-height: 100vh;
  background: var(--canvas);
  color: var(--ink);
  font-family: Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  padding-bottom: 64px;
}

.rl-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 20px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.rl-bar__brand { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.rl-bar__pill {
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--blue), var(--accent));
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.rl-bar__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.rl-seg { display: inline-flex; padding: 3px; background: #eef2fa; border-radius: 12px; gap: 2px; }
.rl-seg__item {
  border: 0; background: transparent; padding: 7px 13px; border-radius: 9px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; transition: 0.15s ease;
}
.rl-seg__item--active { background: #fff; color: var(--ink); box-shadow: 0 1px 3px rgba(23, 32, 51, 0.12); }

.rl-subscene {
  font-size: 12px; font-weight: 700; color: var(--accent);
  background: rgba(141, 107, 255, 0.1);
  border: 1px solid rgba(141, 107, 255, 0.3);
  padding: 6px 11px; border-radius: 999px;
  white-space: nowrap;
}

.rl-compare {
  border: 1px solid var(--line);
  background: #fff;
  padding: 8px 14px;
  border-radius: 9px;
  font: inherit; font-size: 13px; font-weight: 700; color: var(--muted);
  cursor: pointer; transition: 0.15s ease;
}
.rl-compare--on {
  border-color: rgba(141, 107, 255, 0.5);
  background: rgba(141, 107, 255, 0.09);
  color: var(--accent);
}

.rl-back {
  font-size: 13px; font-weight: 600; color: var(--blue);
  text-decoration: none; padding: 7px 12px;
  border-radius: 9px; border: 1px solid var(--line); background: #fff;
}

.rl-states {
  display: flex; gap: 10px;
  padding: 14px 20px 0;
  max-width: 1280px; margin: 0 auto;
  flex-wrap: wrap;
}
.rl-chip {
  display: inline-flex; align-items: baseline; gap: 8px;
  border: 1px solid var(--line); background: #fff;
  border-radius: 999px; padding: 8px 16px;
  font: inherit; font-size: 13px; font-weight: 700; color: var(--muted);
  cursor: pointer; transition: 0.15s ease;
}
.rl-chip small { font-size: 11px; font-weight: 500; color: var(--faint); }
.rl-chip--active { border-color: rgba(52, 120, 246, 0.45); background: rgba(52, 120, 246, 0.07); color: var(--blue-deep); }
.rl-chip--active small { color: var(--blue); }
.rl-chip--live {
  border-color: rgba(49, 177, 111, 0.4);
  background: rgba(49, 177, 111, 0.07);
  color: #1d7a4c;
  cursor: default;
}
.rl-chip--live small { color: #3d9968; }
.rl-chip--info { cursor: default; }

.rl-stage { padding: 16px 20px 0; display: grid; gap: 16px; }
.rl-stage--compare { grid-template-columns: 1fr 1fr; align-items: start; }

.rl-pane { display: grid; gap: 8px; min-width: 0; }
.rl-pane__label {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 700; color: var(--muted);
  padding: 0 2px;
}
.rl-pane__label small { color: var(--faint); font-weight: 500; }
.rl-pane__tag { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; }
.rl-pane__tag--old { background: #eef1f7; color: var(--muted); }
.rl-pane__tag--new { background: rgba(52, 120, 246, 0.1); color: var(--blue-deep); }

.rl-iframe {
  width: 100%;
  height: 880px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 24px 60px rgba(23, 32, 51, 0.1);
}

.rl-frame {
  max-width: 1240px;
  margin: 0 auto;
  width: 100%;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(23, 32, 51, 0.1);
  transition: max-width 0.25s ease;
}
.rl-frame--mobile { max-width: 400px; }

@media (max-width: 1100px) {
  .rl-stage--compare { grid-template-columns: 1fr; }
  .rl-iframe { height: 640px; }
}
@media (max-width: 720px) {
  .rl-bar__brand strong { display: none; }
}
</style>

<style scoped>
/* ---------- 全屏演示模式 ---------- */
.rl--present { padding-bottom: 0; }
.rl-stage--present { padding: 0; }
.rl-frame--full {
  max-width: none;
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  min-height: 100vh;
}
.rl-frame--full-mobile {
  max-width: 400px;
  margin: 0 auto;
  min-height: 100vh;
  border-left: 1px solid var(--line);
  border-right: 1px solid var(--line);
  border-top: 0;
  border-bottom: 0;
  border-radius: 0;
  box-shadow: 0 0 80px rgba(23, 32, 51, 0.18);
}

.rl-present {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.07);
  color: var(--blue-deep);
  padding: 8px 14px;
  border-radius: 9px;
  font: inherit; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: 0.15s ease;
}
.rl-present:hover { background: rgba(52, 120, 246, 0.13); }

.rl-dock {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  display: flex; align-items: center; gap: 4px;
  padding: 6px;
  background: rgba(23, 32, 51, 0.85);
  backdrop-filter: blur(14px);
  border-radius: 999px;
  box-shadow: 0 18px 44px rgba(23, 32, 51, 0.35);
  max-width: calc(100vw - 24px);
  overflow-x: auto;
}
.rl-dock__item {
  border: 0; background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font: inherit; font-size: 12.5px; font-weight: 700;
  padding: 7px 13px; border-radius: 999px;
  cursor: pointer; white-space: nowrap;
  transition: 0.14s ease;
}
.rl-dock__item:hover { color: #fff; }
.rl-dock__item--active { background: #fff; color: var(--ink); }
.rl-dock__mini {
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  font: inherit; font-size: 11.5px; font-weight: 700;
  padding: 6px 11px; border-radius: 999px;
  cursor: pointer; white-space: nowrap;
  transition: 0.14s ease;
}
.rl-dock__mini--active { background: rgba(255, 255, 255, 0.16); color: #fff; border-color: transparent; }
.rl-dock__sep { width: 1px; height: 18px; background: rgba(255, 255, 255, 0.18); margin: 0 4px; flex: 0 0 auto; }
.rl-dock__exit {
  width: 30px; height: 30px; border-radius: 50%;
  border: 0;
  background: rgba(255, 255, 255, 0.12);
  color: #fff; font-size: 15px; line-height: 1;
  cursor: pointer;
  display: grid; place-items: center;
  flex: 0 0 auto;
  transition: 0.14s ease;
}
.rl-dock__exit:hover { background: var(--red); }

.dock-enter-active, .dock-leave-active { transition: 0.22s ease; }
.dock-enter-from, .dock-leave-to { opacity: 0; transform: translate(-50%, 12px); }
</style>
