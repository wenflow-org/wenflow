<template>
  <section class="rl">
    <header class="rl-bar">
      <div class="rl-bar__brand">
        <span class="rl-bar__pill">重设计稿 v2</span>
        <strong>学习台 · 目标规划 — 高保真 Mock</strong>
      </div>
      <div class="rl-bar__actions">
        <div class="rl-seg" role="tablist" aria-label="页面">
          <button
            v-for="s in scenes"
            :key="s.id"
            type="button"
            class="rl-seg__item"
            :class="{ 'rl-seg__item--active': scene === s.id }"
            @click="scene = s.id"
          >
            {{ s.label }}
          </button>
        </div>
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
        <router-link to="/dashboard" class="rl-back">返回学习台</router-link>
      </div>
    </header>

    <div class="rl-states">
      <template v-if="scene === 'dashboard'">
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
      <template v-else>
        <button
          v-for="st in goalStates"
          :key="st.id"
          type="button"
          class="rl-chip"
          :class="{ 'rl-chip--active': goalState === st.id }"
          @click="goalState = st.id"
        >
          {{ st.label }}<small>{{ st.hint }}</small>
        </button>
      </template>
    </div>

    <main class="rl-stage">
      <div class="rl-frame" :class="{ 'rl-frame--mobile': device === 'mobile' }">
        <MockDashboard v-if="scene === 'dashboard'" :state="dashState" />
        <MockGoalConversation v-else :state="goalState" />
      </div>
    </main>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MockDashboard from './MockDashboard.vue';
import MockGoalConversation from './MockGoalConversation.vue';

type Scene = 'dashboard' | 'goal';
type DashState = 'active' | 'attention' | 'empty';
type GoalState = 'entry' | 'chatting' | 'proposal';

const scene = ref<Scene>('dashboard');
const device = ref<'desktop' | 'mobile'>('desktop');
const dashState = ref<DashState>('active');
const goalState = ref<GoalState>('chatting');

const scenes = [
  { id: 'dashboard' as Scene, label: '学习台 · 今日驾驶舱' },
  { id: 'goal' as Scene, label: '目标规划 · 共创工作台' }
];

const dashStates: { id: DashState; label: string; hint: string }[] = [
  { id: 'active', label: '进行中', hint: '有路径有任务' },
  { id: 'attention', label: '需要处理', hint: '路径生成失败' },
  { id: 'empty', label: '新手态', hint: '还没有路径' }
];

const goalStates: { id: GoalState; label: string; hint: string }[] = [
  { id: 'entry', label: '初始态', hint: '还没开始聊' },
  { id: 'chatting', label: '澄清中', hint: '信息收集 6/8' },
  { id: 'proposal', label: '方案确认', hint: '路径预览卡' }
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

.rl-bar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}

.rl-bar__pill {
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--blue), var(--accent));
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.rl-bar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.rl-seg {
  display: inline-flex;
  padding: 3px;
  background: #eef2fa;
  border-radius: 12px;
  gap: 2px;
}

.rl-seg__item {
  border: 0;
  background: transparent;
  padding: 7px 14px;
  border-radius: 9px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  transition: 0.15s ease;
}

.rl-seg__item--active {
  background: #fff;
  color: var(--ink);
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.12);
}

.rl-back {
  font-size: 13px;
  font-weight: 600;
  color: var(--blue);
  text-decoration: none;
  padding: 7px 12px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: #fff;
}

.rl-states {
  display: flex;
  gap: 10px;
  padding: 14px 20px 0;
  max-width: 1280px;
  margin: 0 auto;
  flex-wrap: wrap;
}

.rl-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 999px;
  padding: 8px 16px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  cursor: pointer;
  transition: 0.15s ease;
}

.rl-chip small {
  font-size: 11px;
  font-weight: 500;
  color: var(--faint);
}

.rl-chip--active {
  border-color: rgba(52, 120, 246, 0.45);
  background: rgba(52, 120, 246, 0.07);
  color: var(--blue-deep);
}

.rl-chip--active small {
  color: var(--blue);
}

.rl-stage {
  padding: 16px 20px 0;
}

.rl-frame {
  max-width: 1240px;
  margin: 0 auto;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(23, 32, 51, 0.1);
  transition: max-width 0.25s ease;
}

.rl-frame--mobile {
  max-width: 400px;
}

@media (max-width: 720px) {
  .rl-bar__brand strong {
    display: none;
  }
}
</style>
