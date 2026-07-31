<template>
  <section class="ac">
    <!-- 启动失败（非 401；401 由路由守卫与拦截器导向登录页） -->
    <div v-if="bootError" class="ac-error">
      <div class="ac-error__card">
        <strong>控制台数据加载失败</strong>
        <span>{{ bootError }}</span>
        <button type="button" class="ac-error__retry" @click="boot">重试</button>
      </div>
    </div>

    <MockShell :current="scene" :crumb="crumbLabel" release @navigate="navigate" @palette="paletteOpen = true">
      <div v-if="booting" class="ac-boot">
        <span class="ac-boot__spinner"></span>
        加载中…
      </div>
      <component v-else :is="detailComponent || currentComponent" :state="'normal'" />
    </MockShell>

    <MockCommandPalette
      :open="paletteOpen"
      @close="paletteOpen = false"
      @navigate="navigate"
    />
    <MockSkillDrawer />
  </section>
</template>

<script setup lang="ts">
/**
 * WenFlow Admin 控制台（新版，已上线）
 * 原实验稿 /admin-redesign-lab 已废除，本组件为唯一管理后台入口。
 * 特点：
 */
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
import MockEventCenter from './MockEventCenter.vue';
import MockTraceWaterfall from './MockTraceWaterfall.vue';
import MockApiConfig from './MockApiConfig.vue';
import MockAddons from './MockAddons.vue';
import MockAnnouncements from './MockAnnouncements.vue';
import MockPromptWorkbench from './MockPromptWorkbench.vue';
import MockSkillDrawer from './MockSkillDrawer.vue';
import MockLearnerDetail from './MockLearnerDetail.vue';
import MockTeachingSessions from './MockTeachingSessions.vue';
import MockGoalConversations from './MockGoalConversations.vue';
import MockFeedback from './MockFeedback.vue';
import MockSessionCockpit from './MockSessionCockpit.vue';
import MockCommandPalette from './MockCommandPalette.vue';
import MockVirtualProfile from './MockVirtualProfile.vue';
import MockUserDetail from './MockUserDetail.vue';
import { intent, subPage } from './mockStore';
import { loadLiveData, liveLoading } from './mockLive';
import './mock-shared.css';

const components: Record<string, unknown> = {
  'overview': MockOverview,
  'users': MockUsers,
  'learner-center': MockLearnerCenter,
  'teaching-sessions': MockTeachingSessions,
  'goal-conversations': MockGoalConversations,
  feedback: MockFeedback,
  'virtual-learners': MockVirtualLearners,
  'skills': MockSkills,
  'topology': MockTopology,
  'orchestrator': MockOrchestrator,
  'execution-logs': MockExecLogs,
  'prompt-call-logs': MockPromptCallLogs,
  'event-center': MockEventCenter,
  'trace-waterfall': MockTraceWaterfall,
  'api-config': MockApiConfig,
  'addons': MockAddons,
  'announcements': MockAnnouncements,
  'prompt-workbench': MockPromptWorkbench
};

const detailComponents: Record<string, unknown> = {
  learner: MockLearnerDetail,
  virtual: MockVirtualProfile,
  user: MockUserDetail,
  session: MockSessionCockpit
};

const scene = ref('overview');
const paletteOpen = ref(false);
const booting = ref(true);
const bootError = ref('');

const currentComponent = computed(() => components[scene.value]);
const detailComponent = computed(() => (subPage.value ? detailComponents[subPage.value.view] : null));
const crumbLabel = computed(() => {
  const id = subPage.value?.id
  if (!id) return ''
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
})

watch(scene, () => {
  subPage.value = null;
});
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

async function boot() {
  booting.value = true;
  bootError.value = '';
  await loadLiveData();
  booting.value = false;
  // loadLiveData 内部已做局部容错；仅核心域（日志）失败才提示整页错误
  const { liveFailures } = await import('./mockLive');
  if (liveFailures.value.spans) {
    bootError.value = liveFailures.value.spans;
  }
}

onMounted(() => {
  // 跨路由入口可能在控制台挂载前已写入 intent，首次挂载时需主动消费。
  if (components[intent.scene]) scene.value = intent.scene;
  void boot();
  window.addEventListener('keydown', onGlobalKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));

function onGlobalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    paletteOpen.value = !paletteOpen.value;
  } else if (e.key === 'Escape' && paletteOpen.value) {
    paletteOpen.value = false;
  }
}

void liveLoading;
</script>

<style scoped>
.ac {
  --ink: #1a2a44;
  min-height: 100vh;
  background: #f6f8fc;
  font-family: Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
.ac :deep(.mshell) {
  min-height: 100vh;
}

.ac-boot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 50vh;
  color: #5b6577;
  font-size: 14px;
}
.ac-boot__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(52, 120, 246, 0.25);
  border-top-color: #3478f6;
  border-radius: 50%;
  animation: ac-spin 0.7s linear infinite;
}
@keyframes ac-spin { to { transform: rotate(360deg); } }

.ac-error {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: #f6f8fc;
  display: grid;
  place-content: center;
}
.ac-error__card {
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 32px 40px;
  border: 1px solid #e1e8f2;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 60px rgba(23, 32, 51, 0.1);
}
.ac-error__card strong { font-size: 16px; color: #1a2a44; }
.ac-error__card span { font-size: 13px; color: #8492ab; }
.ac-error__retry {
  margin-top: 6px;
  padding: 8px 20px;
  border: 0;
  border-radius: 9px;
  background: #3478f6;
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
</style>
