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

    <Shell :current="scene" :crumb="crumbLabel" release @navigate="navigate" @palette="paletteOpen = true">
      <div v-if="booting" class="ac-boot">
        <span class="ac-boot__spinner"></span>
        加载中…
      </div>
      <component v-else :is="detailComponent || currentComponent" />
    </Shell>

    <CommandPalette
      :open="paletteOpen"
      @close="paletteOpen = false"
      @navigate="navigate"
    />
    <SkillDrawer />
  </section>
</template>

<script setup lang="ts">
/**
 * WenFlow Admin 控制台（新版，已上线）
 * 原实验稿 /admin-redesign-lab 已废除，本组件为唯一管理后台入口。
 * 特点：
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Shell from './Shell.vue';
import Overview from './Overview.vue';
import Users from './Users.vue';
import LearnerCenter from './LearnerCenter.vue';
import VirtualLearners from './VirtualLearners.vue';
import Skills from './Skills.vue';
import Topology from './Topology.vue';
import Orchestrator from './Orchestrator.vue';
import ExecLogs from './ExecLogs.vue';
import TraceWaterfall from './TraceWaterfall.vue';
import AuditLogs from './AuditLogs.vue';
import ApiConfig from './ApiConfig.vue';
import Addons from './Addons.vue';
import Announcements from './Announcements.vue';
import SessionSecurity from './SessionSecurity.vue';
import PromptWorkbench from './PromptWorkbench.vue';
import SkillDrawer from './SkillDrawer.vue';
import LearnerDetail from './LearnerDetail.vue';
import TeachingSessions from './TeachingSessions.vue';
import GoalConversations from './GoalConversations.vue';
import Feedback from './Feedback.vue';
import SessionCockpit from './SessionCockpit.vue';
import CommandPalette from './CommandPalette.vue';
import VirtualProfile from './VirtualProfile.vue';
import UserDetail from './UserDetail.vue';
import { intent, subPage, closeSkillDrawer } from './store';
import { loadLiveData } from './live';
import './shared.css';

const components: Record<string, unknown> = {
  'overview': Overview,
  'users': Users,
  'learner-center': LearnerCenter,
  'teaching-sessions': TeachingSessions,
  'goal-conversations': GoalConversations,
  feedback: Feedback,
  'virtual-learners': VirtualLearners,
  'skills': Skills,
  'topology': Topology,
  'orchestrator': Orchestrator,
  'execution-logs': ExecLogs,
  'trace-waterfall': TraceWaterfall,
  'audit-logs': AuditLogs,
  'api-config': ApiConfig,
  'addons': Addons,
  'announcements': Announcements,
  'session-security': SessionSecurity,
  'prompt-workbench': PromptWorkbench
};

const detailComponents: Record<string, unknown> = {
  learner: LearnerDetail,
  virtual: VirtualProfile,
  user: UserDetail,
  session: SessionCockpit
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

/* —— 真路由化：scene ↔ URL /admin/console/:page 双向同步 —— */
const route = useRoute()
const router = useRouter()

// URL → scene（浏览器前进/后退、深链直达）；非法 page 回退 overview 并修正 URL
// immediate：整页直达 /admin/console/:page 时初始值也需校验（否则 URL 与 scene 脱节）
watch(
  () => route.params.page,
  (p) => {
    const id = typeof p === 'string' ? p : ''
    if (id && components[id]) {
      if (id !== scene.value) scene.value = id
    } else if (id) {
      void router.replace('/admin/console')
    }
  },
  { immediate: true }
)
// scene → URL（侧栏/命令面板/意图跳转）；push 保留历史，浏览器后退可回到上一页面
watch(scene, (s) => {
  const cur = typeof route.params.page === 'string' ? route.params.page : ''
  if (cur !== s) void router.push(`/admin/${s}`)
  subPage.value = null;
  // 切换页面时自动关闭 Skill 抽屉，避免遮挡侧栏导航
  closeSkillDrawer();
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
  // 相同 scene 再点击：scene watch 不会触发，这里显式清空 subPage 返回列表
  if (id === scene.value) {
    subPage.value = null;
    return;
  }
  scene.value = id;
}

async function boot() {
  booting.value = true;
  bootError.value = '';
  await loadLiveData();
  booting.value = false;
  // loadLiveData 内部已做局部容错；仅核心域（日志）失败才提示整页错误
  const { liveFailures } = await import('./live');
  if (liveFailures.value.spans) {
    bootError.value = liveFailures.value.spans;
  }
}

onMounted(() => {
  // 初始场景优先级：URL :page（深链/刷新恢复）> intent（跨路由入口）> overview 兜底
  const fromRoute = typeof route.params.page === 'string' ? route.params.page : ''
  if (fromRoute && components[fromRoute]) {
    scene.value = fromRoute
  } else if (components[intent.scene]) {
    scene.value = intent.scene
  }
  void boot();
  window.addEventListener('keydown', onGlobalKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));

function onGlobalKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (isTyping) return
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  } else if (e.key === 'Escape' && paletteOpen.value) {
    paletteOpen.value = false
  }
}
</script>

<style scoped>
.ac {
  --ink: var(--mk-ink);
  min-height: 100vh;
  background: #f6f8fc;
  font-family: var(--mk-sans);
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
  box-shadow: var(--mk-shadow-modal);
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
