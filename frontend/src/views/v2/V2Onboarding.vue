<template>
  <div class="ob v2-page">
    <div class="ob__bg" aria-hidden="true"></div>

    <main class="ob__main">
      <router-link to="/" class="ob__logo">
        <img src="/logo.png" alt="问流 WenFlow" />
      </router-link>

      <section class="ob__card">
        <h1 class="ob__title">欢迎，{{ userName }}</h1>
        <p class="ob__sub">你的账号已就绪。<br />接下来聊聊你想学什么，问流会帮你制定学习计划。</p>

        <button type="button" class="ob__cta" @click="go">
          开始规划学习目标
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
        </button>

        <button type="button" class="ob__later" @click="goDashboard">稍后再说</button>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import api from '@/utils/api'

const router = useRouter()
const userStore = useUserStore()

const userName = computed(() => userStore.user?.name || '同学')

/* 标记引导完成 */
async function markDone() {
  try { await api.post('/users/me/onboarding') } catch { /* 不阻塞 */ }
}

function go() {
  markDone()
  router.replace('/goal-conversation')
}

function goDashboard() {
  markDone()
  router.replace('/dashboard')
}

onMounted(() => markDone())
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
  width: min(420px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 2px 4px rgba(23,32,51,0.04), 0 24px 60px rgba(23,32,51,0.08);
  padding: 40px 32px 36px;
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
  margin: 0 0 28px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--muted);
}

.ob__cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 12px 28px;
  font-size: 14.5px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  border: 0;
  border-radius: 12px;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(52,120,246,0.25);
  transition: transform 0.18s, box-shadow 0.18s;
}
.ob__cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(52,120,246,0.3);
}
.ob__cta:active {
  transform: translateY(0) scale(0.97);
}

.ob__later {
  display: block;
  margin: 14px auto 0;
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
  .ob__card { padding: 32px 20px 28px; border-radius: 16px; }
  .ob__title { font-size: 19px; }
}

[data-theme='dark'] .ob__card {
  box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 24px 60px rgba(0,0,0,0.3);
}
[data-theme='dark'] .ob__cta {
  box-shadow: 0 8px 20px rgba(77,139,248,0.2);
}
</style>
