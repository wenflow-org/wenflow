<template>
  <div class="ob v2-page">
    <div class="ob__bg" aria-hidden="true"></div>

    <main class="ob__main">
      <router-link to="/" class="ob__logo">
        <img src="/logo.png" alt="问流 WenFlow" />
      </router-link>

      <section class="ob__card">
        <!-- 第 1 步：欢迎 -->
        <template v-if="step === 1">
          <h1 class="ob__title">欢迎，{{ userName }}</h1>
          <p class="ob__sub">你的账号已就绪。<br />30 秒定个方向，问流会帮你把目标拆成可执行的学习路径。</p>
          <div class="ob__feat">
            <div class="ob__feat-item">
              <span class="ob__feat-icon">🎯</span>
              <div><strong>先聊清楚目标</strong><small>把模糊想法聊成清晰的学习方向</small></div>
            </div>
            <div class="ob__feat-item">
              <span class="ob__feat-icon">🧭</span>
              <div><strong>生成学习路径</strong><small>阶段化拆解，每一步都知道学什么</small></div>
            </div>
            <div class="ob__feat-item">
              <span class="ob__feat-icon">💬</span>
              <div><strong>对话式导师</strong><small>边学边问，AI 按你的节奏调整</small></div>
            </div>
          </div>
          <button type="button" class="ob__cta" @click="step = 2">开始
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
          </button>
        </template>

        <!-- 第 2 步：选目标方向 -->
        <template v-else-if="step === 2">
          <h1 class="ob__title">你想学点什么？</h1>
          <p class="ob__sub">选一个最接近的方向，之后可以在对话里随时调整。</p>
          <div class="ob__choices">
            <button
              v-for="c in goalChoices"
              :key="c.value"
              type="button"
              class="ob__choice"
              :class="{ 'ob__choice--on': goalChoice === c.value }"
              @click="goalChoice = c.value"
            >
              <span class="ob__choice-icon">{{ c.icon }}</span>
              <span class="ob__choice-body"><strong>{{ c.label }}</strong><small>{{ c.desc }}</small></span>
            </button>
          </div>
          <div class="ob__nav">
            <button type="button" class="ob__back" @click="step = 1">‹ 上一步</button>
            <button type="button" class="ob__cta" :disabled="!goalChoice" @click="step = 3">下一步
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
            </button>
          </div>
        </template>

        <!-- 第 3 步：选学习频率 -->
        <template v-else>
          <h1 class="ob__title">打算多久学一次？</h1>
          <p class="ob__sub">问流会据此安排学习节奏，避免一次学太多或三天打鱼。</p>
          <div class="ob__choices ob__choices--freq">
            <button
              v-for="f in freqChoices"
              :key="f.value"
              type="button"
              class="ob__choice"
              :class="{ 'ob__choice--on': freqChoice === f.value }"
              @click="freqChoice = f.value"
            >
              <span class="ob__choice-body ob__choice-body--center"><strong>{{ f.label }}</strong><small>{{ f.desc }}</small></span>
            </button>
          </div>
          <div class="ob__nav">
            <button type="button" class="ob__back" @click="step = 2">‹ 上一步</button>
            <button type="button" class="ob__cta" :disabled="!freqChoice" @click="finish">开始规划
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
            </button>
          </div>
        </template>

        <!-- 跳过（任意步骤可见） -->
        <button type="button" class="ob__later" @click="goDashboard">跳过引导</button>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import api from '@/utils/api'

const router = useRouter()
const userStore = useUserStore()

const userName = computed(() => userStore.user?.name || '同学')

const step = ref(1)

const goalChoices = [
  { value: 'work', icon: '💼', label: '职业技能', desc: '编程、数据分析、办公效率等' },
  { value: 'study', icon: '📚', label: '学业提升', desc: '考试、课业、升学准备等' },
  { value: 'hobby', icon: '🎨', label: '兴趣探索', desc: '语言、设计、音乐、写作等' },
  { value: 'life', icon: '🌱', label: '个人成长', desc: '沟通、理财、健康管理等' }
]

const freqChoices = [
  { value: 'daily', label: '每天 15-30 分钟', desc: '细水长流，习惯优先' },
  { value: 'weekday', label: '工作日每天，周末休息', desc: '适合工作/学习节奏固定' },
  { value: 'weekend', label: '周末集中 1-2 小时', desc: '适合平时很忙，周末充电' },
  { value: 'flexible', label: '看情况，灵活安排', desc: '问流会帮你提醒和找回节奏' }
]

const goalChoice = ref('')
const freqChoice = ref('')

/* 标记引导完成（最后一步或跳过时调用） */
async function markDone() {
  try { await api.post('/users/me/onboarding') } catch { /* 不阻塞 */ }
}

function finish() {
  markDone()
  // 把选择带给目标对话（通过 query 预填，对话可读取）
  router.replace({ path: '/goal-conversation', query: { goal: goalChoice.value, freq: freqChoice.value } })
}

function goDashboard() {
  markDone()
  router.replace('/dashboard')
}
</script>

<style scoped>
.ob {
  min-height: 100vh;
  position: relative;
}

.ob__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(560px 300px at 12% -4%, rgba(52,120,246,0.07), transparent 60%),
    radial-gradient(480px 260px at 88% 104%, rgba(141,107,255,0.06), transparent 60%);
  overflow: hidden;
}
.ob__bg::before,
.ob__bg::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.22;
}
.ob__bg::before {
  width: 420px; height: 420px;
  top: -90px; right: -120px;
  background: radial-gradient(circle, rgba(52,120,246,0.32), transparent 70%);
}
.ob__bg::after {
  width: 340px; height: 340px;
  bottom: -70px; left: -110px;
  background: radial-gradient(circle, rgba(141,107,255,0.24), transparent 70%);
}
@media (prefers-reduced-motion: no-preference) {
  .ob__bg::before { animation: ob-orb-a 24s ease-in-out infinite; }
  .ob__bg::after  { animation: ob-orb-b 28s ease-in-out infinite; }
}
@keyframes ob-orb-a { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-30px,24px)} }
@keyframes ob-orb-b { 0%,100%{transform:translate(0,0)} 50%{transform:translate(26px,-20px)} }

.ob__main {
  position: relative;
  min-height: 100vh;
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 24px;
  padding: 48px 20px 40px;
}

.ob__logo { display: inline-flex; }
.ob__logo img { height: 48px; width: auto; display: block; }

.ob__card {
  width: min(440px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 2px 4px rgba(23,32,51,0.04), 0 24px 60px rgba(23,32,51,0.08);
  padding: 36px 30px 30px;
  text-align: center;
  animation: ob-card-in 0.65s cubic-bezier(0.16,1,0.3,1) both;
}
@keyframes ob-card-in {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

.ob__title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 800;
  color: var(--ink);
  line-height: 1.35;
}

.ob__sub {
  margin: 0 0 24px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--muted);
}

/* 第 1 步：产品亮点 */
.ob__feat { display: grid; gap: 10px; text-align: left; margin-bottom: 26px; }
.ob__feat-item {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 96%, var(--canvas));
}
.ob__feat-icon { font-size: 20px; line-height: 1; flex: none; }
.ob__feat-item strong { display: block; font-size: 13.5px; color: var(--ink); }
.ob__feat-item small { display: block; margin-top: 1px; font-size: 12px; color: var(--faint); }

/* 第 2/3 步：选项 */
.ob__choices { display: grid; gap: 10px; text-align: left; margin-bottom: 24px; }
.ob__choice {
  display: flex; align-items: center; gap: 12px;
  width: 100%;
  padding: 13px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  font: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.ob__choice:hover { border-color: rgba(52,120,246,0.4); }
.ob__choice--on {
  border-color: rgba(52,120,246,0.6);
  background: rgba(52,120,246,0.06);
  box-shadow: 0 0 0 3px rgba(52,120,246,0.1);
}
.ob__choice-icon { font-size: 20px; line-height: 1; flex: none; }
.ob__choice-body { display: grid; gap: 2px; }
.ob__choice-body strong { font-size: 14px; color: var(--ink); }
.ob__choice-body small { font-size: 12px; color: var(--faint); }
.ob__choices--freq .ob__choice-body { text-align: center; width: 100%; }

/* 底部导航 */
.ob__nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ob__back {
  font-size: 13px; font-weight: 600;
  color: var(--muted);
  background: none; border: 0;
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 8px;
}
.ob__back:hover { color: var(--blue-deep); background: rgba(52,120,246,0.06); }

.ob__cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 11px 26px;
  font-size: 14.5px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  border: 0;
  border-radius: 12px;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(52,120,246,0.25);
  transition: transform 0.18s, box-shadow 0.18s, opacity 0.18s;
}
.ob__cta:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(52,120,246,0.3);
}
.ob__cta:active:not(:disabled) {
  transform: translateY(0) scale(0.97);
}
.ob__cta:disabled { opacity: 0.45; cursor: default; box-shadow: none; }

.ob__later {
  display: block;
  margin: 16px auto 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--faint);
  background: none;
  border: 0;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 8px;
  transition: color 0.15s, background 0.15s;
}
.ob__later:hover {
  color: var(--blue-deep);
  background: rgba(52,120,246,0.06);
}

@media (max-width: 480px) {
  .ob__card { padding: 28px 18px 24px; border-radius: 16px; }
  .ob__title { font-size: 19px; }
}

[data-theme='dark'] .ob__card {
  box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 24px 60px rgba(0,0,0,0.3);
}
[data-theme='dark'] .ob__cta {
  box-shadow: 0 8px 20px rgba(77,139,248,0.2);
}
</style>
