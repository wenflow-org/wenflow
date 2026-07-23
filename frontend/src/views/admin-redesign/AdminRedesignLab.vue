<template>
  <section class="al">
    <header class="al-bar">
      <div class="al-bar__brand">
        <img src="/favicon.png" alt="问流" class="al-bar__logo" />
        <span class="al-bar__pill">Admin 实验稿 v2.0</span>
        <strong>整体重设计 · 一条事故线贯穿全站</strong>
      </div>
      <div class="al-bar__actions">
        <button
          type="button"
          class="al-compare"
          :class="{ 'al-compare--on': fullscreen }"
          :aria-pressed="fullscreen"
          @click="fullscreen = !fullscreen"
        >
          {{ fullscreen ? '退出全屏' : '全屏预览' }}
        </button>
        <button
          type="button"
          class="al-compare"
          :class="{ 'al-compare--on': compare }"
          :aria-pressed="compare"
          @click="compare = !compare"
        >
          {{ compare ? '退出对比' : '对比现有页面' }}
        </button>
        <router-link to="/admin/dashboard" class="al-back">返回后台</router-link>
      </div>
    </header>

    <div class="al-states">
      <button
        v-for="st in GLOBAL_STATES"
        :key="st.id"
        type="button"
        class="al-chip"
        :class="{ 'al-chip--active': labState === st.id && dataSource === 'demo' }"
        :disabled="dataSource === 'live'"
        @click="labState = st.id"
      >
        {{ st.label }}<small>{{ st.hint }}</small>
      </button>
      <span class="al-hint">全局状态：所有页面读同一份数据</span>
      <div class="al-source">
        <button
          type="button"
          class="al-chip"
          :class="{ 'al-chip--active': dataSource === 'demo' }"
          @click="backToDemo"
        >
          演示数据
        </button>
        <button
          type="button"
          class="al-chip al-chip--live"
          :class="{ 'al-chip--active': dataSource === 'live' }"
          :disabled="liveLoading"
          @click="loadLiveData"
        >
          <span v-if="liveLoading">拉取中…</span>
          <span v-else>真实数据<small>API</small></span>
        </button>
        <span v-if="liveError" class="al-source__error">{{ liveError }}</span>
        <span v-else-if="dataSource === 'live'" class="al-source__ok">已接真实 API</span>
      </div>
    </div>

    <!-- 会话/拉取异常横幅：真实数据不可用时不静默退回演示 -->
    <div v-if="needLogin" class="al-notice al-notice--warn">
      <strong>当前展示的是演示数据。</strong>
      <span>真实数据需要管理员会话，登录后回到本页会自动接入。</span>
      <router-link class="al-notice__link" to="/admin/login">去登录 →</router-link>
      <button type="button" class="al-notice__retry" @click="retryLive">已登录？点此重试</button>
    </div>
    <div v-else-if="liveError" class="al-notice" :class="dataSource === 'live' ? 'al-notice--warn' : 'al-notice--err'">
      <strong>{{ dataSource === 'live' ? '部分真实数据不可用。' : '真实数据接入失败，当前展示演示数据。' }}</strong>
      <span>{{ liveError }}</span>
      <button type="button" class="al-notice__retry" @click="retryLive">重试</button>
    </div>

    <main class="al-stage" :class="{ 'al-stage--compare': compare }">
      <!-- 对比模式：左侧现有页面 iframe -->
      <div v-if="compare" class="al-pane">
        <div class="al-pane__label">
          <span class="al-pane__tag al-pane__tag--old">现有</span>
          {{ currentScene.realRoute }}
          <small>需 admin 会话</small>
        </div>
        <iframe class="al-iframe" :src="currentScene.realRoute" title="现有页面"></iframe>
      </div>

      <!-- 重设计稿：完整迷你 admin -->
      <div class="al-pane">
        <div v-if="compare" class="al-pane__label">
          <span class="al-pane__tag al-pane__tag--new">重设计</span>
          运维简报式 Admin
        </div>
        <div class="al-frame">
          <MockShell :current="scene" :crumb="subPage?.id" @navigate="navigate" @palette="paletteOpen = true">
            <component :is="detailComponent || currentComponent" :state="mappedState" />
          </MockShell>
        </div>
      </div>
    </main>

    <!-- 全屏预览：mock admin 以 100% 比例占满视口 -->
    <div v-if="fullscreen" class="al-fs">
      <button type="button" class="al-fs__exit" @click="fullscreen = false">✕ 退出全屏</button>
      <MockShell :current="scene" :crumb="subPage?.id" @navigate="navigate" @palette="paletteOpen = true">
        <component :is="detailComponent || currentComponent" :state="mappedState" />
      </MockShell>
    </div>

    <!-- 命令面板（Ctrl/⌘K） -->
    <MockCommandPalette
      :open="paletteOpen"
      @close="paletteOpen = false"
      @navigate="navigate"
      @fullscreen="fullscreen = !fullscreen"
    />

    <!-- Skill 详情抽屉（全局） -->
    <MockSkillDrawer />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import MockShell from './MockShell.vue';
import MockOverview from './MockOverview.vue';
import MockUsers from './MockUsers.vue';
import MockLearnerCenter from './MockLearnerCenter.vue';
import MockVirtualLearners from './MockVirtualLearners.vue';
import MockSkills from './MockSkills.vue';
import MockTopology from './MockTopology.vue';
import MockOrchestrator from './MockOrchestrator.vue';
import MockExecLogs from './MockExecLogs.vue';
import MockPromptCallLogs from './MockPromptCallLogs.vue';
import MockTraceWaterfall from './MockTraceWaterfall.vue';
import MockApiConfig from './MockApiConfig.vue';
import MockAddons from './MockAddons.vue';
import MockAnnouncements from './MockAnnouncements.vue';
import MockPromptLab from './MockPromptLab.vue';
import MockSkillDrawer from './MockSkillDrawer.vue';
import MockLearnerDetail from './MockLearnerDetail.vue';
import MockTeachingSessions from './MockTeachingSessions.vue';
import MockSessionCockpit from './MockSessionCockpit.vue';
import MockCommandPalette from './MockCommandPalette.vue';
import MockVirtualProfile from './MockVirtualProfile.vue';
import MockUserDetail from './MockUserDetail.vue';
import { MOCK_SCENES, GLOBAL_STATES } from './mockManifest';
import { labState, intent, subPage, dataSource } from './mockStore';
import { loadLiveData, backToDemo, liveLoading, liveError } from './mockLive';
import { hasAdminSession } from '@/api/adminApi';
import './mock-shared.css';

const components: Record<string, unknown> = {
  'overview': MockOverview,
  'users': MockUsers,
  'learner-center': MockLearnerCenter,
  'teaching-sessions': MockTeachingSessions,
  'virtual-learners': MockVirtualLearners,
  'skills': MockSkills,
  'topology': MockTopology,
  'orchestrator': MockOrchestrator,
  'execution-logs': MockExecLogs,
  'prompt-call-logs': MockPromptCallLogs,
  'event-center': MockTraceWaterfall,
  'api-config': MockApiConfig,
  'addons': MockAddons,
  'announcements': MockAnnouncements,
  'prompt-lab': MockPromptLab
};

// 二级页面（drill-in）
const detailComponents: Record<string, unknown> = {
  learner: MockLearnerDetail,
  virtual: MockVirtualProfile,
  user: MockUserDetail,
  session: MockSessionCockpit
};

// 各页面把全局状态映射为自身语境（读 store 的页面无需映射）
const STATE_MAP: Record<string, Record<string, string>> = {
  'users': { normal: 'normal', incident: 'normal', fresh: 'empty' },
  'learner-center': { normal: 'normal', incident: 'risk', fresh: 'empty' },
  'virtual-learners': { normal: 'normal', incident: 'normal', fresh: 'empty' },
  'api-config': { normal: 'ready', incident: 'ready', fresh: 'incomplete' },
  'addons': { normal: 'normal', incident: 'normal', fresh: 'empty' }
};

const scene = ref('overview');
const compare = ref(false);
const fullscreen = ref(false);
const paletteOpen = ref(false);

/* Ctrl/⌘K 打开命令面板 */
function onGlobalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    paletteOpen.value = !paletteOpen.value;
  } else if (e.key === 'Escape' && paletteOpen.value) {
    paletteOpen.value = false;
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));

const currentScene = computed(() => MOCK_SCENES.find((s) => s.id === scene.value) || MOCK_SCENES[0]);
const currentComponent = computed(() => components[scene.value]);
const detailComponent = computed(() => (subPage.value ? detailComponents[subPage.value.view] : null));
const mappedState = computed(() => STATE_MAP[scene.value]?.[labState.value] || labState.value);

// 切换场景时退出二级页
watch(scene, () => {
  subPage.value = null;
});

// 场景与排查意图双向同步（点导航改 intent；事故卡/Trace 跳转改场景）
watch(scene, (s) => {
  if (intent.scene !== s) intent.scene = s;
});
watch(
  () => intent.scene,
  (s) => {
    if (s && s !== scene.value) scene.value = s;
  }
);

function navigate(id: string) {
  scene.value = id;
}

/* 打开实验室即自动接真实数据；会话缺失或拉取失败时给显眼横幅，不静默退回演示 */
onMounted(() => {
  if (dataSource.value === 'demo' && !liveLoading.value) {
    void loadLiveData();
  }
});

const needLogin = computed(
  () => dataSource.value === 'demo' && (!hasAdminSession() || liveError.value.includes('登录'))
);

function retryLive() {
  void loadLiveData();
}
</script>

<style scoped>
.al {
  --ink: #1a2a44;
  --muted: #5b6577;
  --faint: #8492ab;
  --line: #e1e8f2;
  --canvas: #f6f8fc;
  --blue: #3478f6;
  --blue-deep: #1f57cc;
  --accent: #8d6bff;
  min-height: 100vh;
  background: var(--canvas);
  color: var(--ink);
  font-family: Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  padding-bottom: 64px;
}

.al-bar {
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
.al-bar__brand { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.al-bar__logo { height: 26px; width: 26px; border-radius: 7px; }
.al-bar__pill {
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, #172033, #3b4a6b);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.al-bar__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.al-compare {
  border: 1px solid var(--line);
  background: #fff;
  padding: 8px 14px;
  border-radius: 9px;
  font: inherit; font-size: 13px; font-weight: 700; color: var(--muted);
  cursor: pointer; transition: 0.15s ease;
}
.al-compare--on {
  border-color: rgba(141, 107, 255, 0.5);
  background: rgba(141, 107, 255, 0.09);
  color: var(--accent);
}

.al-back {
  font-size: 13px; font-weight: 600; color: var(--blue);
  text-decoration: none; padding: 7px 12px;
  border-radius: 9px; border: 1px solid var(--line); background: #fff;
}

.al-states {
  display: flex; gap: 10px; align-items: center;
  padding: 14px 20px 0;
  max-width: 1280px; margin: 0 auto;
  flex-wrap: wrap;
}
.al-hint { font-size: 11.5px; color: var(--faint); }

.al-source {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.al-chip:disabled { opacity: 0.5; cursor: not-allowed; }
.al-chip--live.al-chip--active {
  border-color: rgba(21, 128, 61, 0.4);
  background: rgba(21, 128, 61, 0.08);
  color: #15803d;
}
.al-chip--live.al-chip--active small { color: #15803d; }
.al-source__error { font-size: 11.5px; color: #dc2626; font-weight: 600; }
.al-source__ok { font-size: 11.5px; color: #15803d; font-weight: 700; }
.al-chip {
  display: inline-flex; align-items: baseline; gap: 8px;
  border: 1px solid var(--line); background: #fff;
  border-radius: 999px; padding: 8px 16px;
  font: inherit; font-size: 13px; font-weight: 700; color: var(--muted);
  cursor: pointer; transition: 0.15s ease;
}
.al-chip small { font-size: 11px; font-weight: 500; color: var(--faint); }
.al-chip--active { border-color: rgba(52, 120, 246, 0.45); background: rgba(52, 120, 246, 0.07); color: var(--blue-deep); }
.al-chip--active small { color: var(--blue); }

.al-stage { padding: 16px 20px 0; display: grid; gap: 16px; max-width: 1360px; margin: 0 auto; }
.al-stage--compare { grid-template-columns: 1fr 1fr; align-items: start; max-width: none; }

/* 数据接入异常横幅 */
.al-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  max-width: 1332px;
  margin: 14px auto 0;
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 13px;
}
.al-notice--warn {
  border: 1px solid rgba(180, 83, 9, 0.35);
  background: linear-gradient(180deg, #fffdf5, #fff);
  color: #92610a;
}
.al-notice--err {
  border: 1px solid rgba(220, 38, 38, 0.3);
  background: #fef5f5;
  color: #b91c1c;
}
.al-notice strong { font-weight: 800; }
.al-notice__link { color: var(--blue); font-weight: 800; text-decoration: none; }
.al-notice__link:hover { text-decoration: underline; }
.al-notice__retry {
  margin-left: auto;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  padding: 5px 12px;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  opacity: 0.85;
}
.al-notice__retry:hover { opacity: 1; }

.al-pane { display: grid; gap: 8px; min-width: 0; }
.al-pane__label {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 700; color: var(--muted);
  padding: 0 2px;
}
.al-pane__label small { color: var(--faint); font-weight: 500; }
.al-pane__tag {
  padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800;
}
.al-pane__tag--old { background: #eef1f7; color: var(--muted); }
.al-pane__tag--new { background: rgba(52, 120, 246, 0.1); color: var(--blue-deep); }

.al-iframe {
  width: 100%;
  height: 880px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 24px 60px rgba(23, 32, 51, 0.1);
}

.al-frame {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(23, 32, 51, 0.1);
}

/* 全屏预览：脱离画框，100% 比例 */
.al-fs {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--canvas);
  overflow-y: auto;
}

.al-fs :deep(.mshell) {
  min-height: 100vh;
}
.al-fs__exit {
  position: fixed;
  top: 14px;
  right: 18px;
  z-index: 101;
  padding: 7px 13px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  color: var(--muted);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(23, 32, 51, 0.12);
}
.al-fs__exit:hover { color: var(--ink); }

@media (max-width: 1100px) {
  .al-stage--compare { grid-template-columns: 1fr; }
  .al-iframe { height: 640px; }
}
@media (max-width: 720px) {
  .al-bar__brand strong { display: none; }
}
</style>
