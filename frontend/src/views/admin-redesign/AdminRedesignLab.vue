<template>
  <section class="al">
    <header class="al-bar">
      <div class="al-bar__brand">
        <span class="al-bar__pill">Admin 实验稿 v0.1</span>
        <strong>执行日志 · 平台总览 — 风格探索 Mock</strong>
      </div>
      <div class="al-bar__actions">
        <div class="al-seg" role="tablist" aria-label="页面">
          <button
            v-for="s in scenes"
            :key="s.id"
            type="button"
            class="al-seg__item"
            :class="{ 'al-seg__item--active': scene === s.id }"
            @click="scene = s.id"
          >
            {{ s.label }}
          </button>
        </div>
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
        v-for="st in currentStates"
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
          {{ scene === 'logs' ? '/admin/execution-logs' : '/admin/dashboard' }}
          <small>需 admin 会话</small>
        </div>
        <iframe
          class="al-iframe"
          :src="scene === 'logs' ? '/admin/execution-logs' : '/admin/dashboard'"
          title="现有页面"
        ></iframe>
      </div>

      <!-- 实验稿 -->
      <div class="al-pane">
        <div v-if="compare" class="al-pane__label">
          <span class="al-pane__tag al-pane__tag--new">实验</span>
          {{ scene === 'logs' ? '执行日志 · 终端流' : '平台总览 · 运营简报' }}
        </div>
        <div class="al-frame">
          <MockExecLogs v-if="scene === 'logs'" :state="logState" />
          <MockOverview v-else :state="overviewState" />
        </div>
      </div>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import MockExecLogs from './MockExecLogs.vue';
import MockOverview from './MockOverview.vue';

type Scene = 'logs' | 'overview';
type LogState = 'normal' | 'incident' | 'empty';
type OverviewState = 'normal' | 'incident' | 'fresh';

const scene = ref<Scene>('logs');
const logState = ref<LogState>('normal');
const overviewState = ref<OverviewState>('normal');
const compare = ref(false);

const scenes = [
  { id: 'logs' as Scene, label: '执行日志 · 终端流' },
  { id: 'overview' as Scene, label: '平台总览 · 运营简报' }
];

const logStates: { id: LogState; label: string; hint: string }[] = [
  { id: 'normal', label: '正常流', hint: '稳定输出' },
  { id: 'incident', label: '异常爆发', hint: '连续失败超时' },
  { id: 'empty', label: '空数据', hint: '暂无日志' }
];

const overviewStates: { id: OverviewState; label: string; hint: string }[] = [
  { id: 'normal', label: '日常运行', hint: '有活跃有完成' },
  { id: 'incident', label: '需要关注', hint: '调用异常 + 活跃为 0' },
  { id: 'fresh', label: '全新部署', hint: '一切为 0' }
];

const currentStates = computed(() => (scene.value === 'logs' ? logStates : overviewStates));
const currentState = computed({
  get: () => (scene.value === 'logs' ? logState.value : overviewState.value),
  set: (v: string) => setState(v)
});

function setState(id: string) {
  if (scene.value === 'logs') logState.value = id as LogState;
  else overviewState.value = id as OverviewState;
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

.al-seg { display: inline-flex; padding: 3px; background: #eef2fa; border-radius: 12px; gap: 2px; }
.al-seg__item {
  border: 0; background: transparent; padding: 7px 14px; border-radius: 9px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; transition: 0.15s ease;
}
.al-seg__item--active { background: #fff; color: var(--ink); box-shadow: 0 1px 3px rgba(23, 32, 51, 0.12); }

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

.al-stage { padding: 16px 20px 0; display: grid; gap: 16px; max-width: 1320px; margin: 0 auto; }
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
  background: var(--canvas);
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
