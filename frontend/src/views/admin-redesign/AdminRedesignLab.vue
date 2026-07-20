<template>
  <section class="al">
    <header class="al-bar">
      <div class="al-bar__brand">
        <span class="al-bar__pill">Admin 实验稿 v1.0</span>
        <strong>整体重设计 · 运维简报式 Admin</strong>
      </div>
      <div class="al-bar__actions">
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
        v-for="st in currentScene.states"
        :key="st.id"
        type="button"
        class="al-chip"
        :class="{ 'al-chip--active': currentState === st.id }"
        @click="setState(st.id)"
      >
        {{ st.label }}<small>{{ st.hint }}</small>
      </button>
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
          <MockShell :current="scene" @navigate="navigate">
            <component :is="currentComponent" :state="currentState" />
          </MockShell>
        </div>
      </div>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import MockShell from './MockShell.vue';
import MockOverview from './MockOverview.vue';
import MockUsers from './MockUsers.vue';
import MockLearnerCenter from './MockLearnerCenter.vue';
import MockVirtualLearners from './MockVirtualLearners.vue';
import MockSkills from './MockSkills.vue';
import MockTopology from './MockTopology.vue';
import MockOrchestrator from './MockOrchestrator.vue';
import MockExecLogs from './MockExecLogs.vue';
import MockEventCenter from './MockEventCenter.vue';
import MockApiConfig from './MockApiConfig.vue';
import MockAddons from './MockAddons.vue';
import MockPromptLab from './MockPromptLab.vue';
import { MOCK_SCENES } from './mockManifest';
import './mock-shared.css';

const components: Record<string, unknown> = {
  'overview': MockOverview,
  'users': MockUsers,
  'learner-center': MockLearnerCenter,
  'virtual-learners': MockVirtualLearners,
  'skills': MockSkills,
  'topology': MockTopology,
  'orchestrator': MockOrchestrator,
  'execution-logs': MockExecLogs,
  'event-center': MockEventCenter,
  'api-config': MockApiConfig,
  'addons': MockAddons,
  'prompt-lab': MockPromptLab
};

const scene = ref('overview');
// 每个场景记住自己的状态选择
const stateMap = reactive<Record<string, string>>(
  Object.fromEntries(MOCK_SCENES.map((s) => [s.id, s.states[0].id]))
);
const compare = ref(false);

const currentScene = computed(() => MOCK_SCENES.find((s) => s.id === scene.value) || MOCK_SCENES[0]);
const currentComponent = computed(() => components[scene.value]);
const currentState = computed(() => stateMap[scene.value]);

function setState(id: string) {
  stateMap[scene.value] = id;
}

function navigate(id: string) {
  scene.value = id;
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
  display: flex; gap: 10px;
  padding: 14px 20px 0;
  max-width: 1280px; margin: 0 auto;
  flex-wrap: wrap;
}
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

@media (max-width: 1100px) {
  .al-stage--compare { grid-template-columns: 1fr; }
  .al-iframe { height: 640px; }
}
@media (max-width: 720px) {
  .al-bar__brand strong { display: none; }
}
</style>
