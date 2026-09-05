<template>
  <div class="ob v2-page">
    <div class="ob__bg" aria-hidden="true"></div>

    <main class="ob__main">
      <router-link to="/" class="ob__logo">
        <img src="/logo.png" alt="问流 WenFlow" />
      </router-link>

      <section class="ob__card">
        <!-- 步骤进度（4 段） -->
        <div class="ob__progress" aria-hidden="true">
          <span v-for="i in totalSteps" :key="i" :class="{ 'is-on': i <= step }"></span>
        </div>

        <Transition name="ob-swap" mode="out-in">
          <!-- ===== 第 1 步：认识问流（平台做什么） ===== -->
          <div v-if="step === 1" key="s1" class="ob__page">
            <h1 class="ob__title">欢迎，{{ userName }}</h1>
            <p class="ob__sub">问流把你的真实问题，变成一条能执行的学习路径。<br />不用先囤课，也不用写完美计划。</p>

            <div class="ob__flow" aria-hidden="true">
              <span class="ob__flow-item">
                <i>1</i>
                <strong>说出问题</strong>
                <small>一句话就行</small>
              </span>
              <span class="ob__flow-arrow">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
              </span>
              <span class="ob__flow-item">
                <i>2</i>
                <strong>生成路径</strong>
                <small>阶段 + 任务</small>
              </span>
              <span class="ob__flow-arrow">
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
              </span>
              <span class="ob__flow-item">
                <i>3</i>
                <strong>开始学习</strong>
                <small>每天一步</small>
              </span>
            </div>

            <div class="ob__nav">
              <span></span>
              <button type="button" class="ob__cta" @click="next">开始了解
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
              </button>
            </div>
          </div>

          <!-- ===== 第 2 步：输入（怎么开始） ===== -->
          <div v-else-if="step === 2" key="s2" class="ob__page">
            <span class="ob__kicker">第一步 · 输入</span>
            <h1 class="ob__title">说出你想解决的事</h1>
            <p class="ob__sub">从最近卡住的事开始，一句话也行。问流会追问边界、基础和时间，帮你说清问题，而不是让你先整理出完美目标。</p>

            <div class="ob__demo" aria-hidden="true">
              <div class="ob__demo-bar">
                <span>目标规划</span>
                <span class="ob__chip">澄清问题</span>
              </div>
              <div class="ob__bubble ob__bubble--user">每周 Excel 周报太花时间，想用 Python 自动化</div>
              <div class="ob__bubble ob__bubble--ai">
                <img src="/favicon.png" alt="" />
                <div class="ob__bubble-body">
                  <p>好，我们先把问题说小一点。你更想先节省哪一段时间？</p>
                  <div class="ob__demo-tags">
                    <span class="is-on">清洗与合并数据</span>
                    <span>出图与汇报</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="ob__notes">
              <span>不用先选一门课</span>
              <span>不用先写完整计划</span>
              <span>方向随时可以改</span>
            </div>

            <div class="ob__nav">
              <button type="button" class="ob__back" @click="prev">‹ 上一步</button>
              <button type="button" class="ob__cta" @click="next">下一步
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
              </button>
            </div>
          </div>

          <!-- ===== 第 3 步：生成路径 ===== -->
          <div v-else-if="step === 3" key="s3" class="ob__page">
            <span class="ob__kicker">第二步 · 生成路径</span>
            <h1 class="ob__title">聊几句，得到能执行的路径</h1>
            <p class="ob__sub">问流把目标拆成阶段和任务——每一步都知道学什么，今天就能动手；学到一半想改，也可以随时调整。</p>

            <div class="ob__demo" aria-hidden="true">
              <div class="ob__demo-bar">
                <span>学习路径</span>
                <span class="ob__chip">Excel 周报自动化</span>
              </div>
              <div class="ob__demo-stages">
                <div class="ob__stage is-done"><i>✓</i><b>打基础</b><small>已完成</small></div>
                <div class="ob__stage is-on"><i>2</i><b>数据读取</b><small>当前阶段</small></div>
                <div class="ob__stage"><i>3</i><b>自动化跑通</b><small>待开始</small></div>
              </div>
              <div class="ob__demo-prog"><i style="--w: 42%"></i></div>
              <div class="ob__demo-action ob__demo-action--stack">
                <span class="ob__demo-action__tag">今日行动</span>
                <span class="ob__demo-action__body"><b>跑通第一版数据读取</b><small>阶段 2 / 5 · 约 25 分钟</small></span>
              </div>
            </div>

            <div class="ob__notes">
              <span>拆成阶段与任务</span>
              <span>路径可继续、可调整</span>
              <span>生成失败信息不丢</span>
            </div>

            <div class="ob__nav">
              <button type="button" class="ob__back" @click="prev">‹ 上一步</button>
              <button type="button" class="ob__cta" @click="next">下一步
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
              </button>
            </div>
          </div>

          <!-- ===== 第 4 步：学习 ===== -->
          <div v-else key="s4" class="ob__page">
            <span class="ob__kicker">第三步 · 学习</span>
            <h1 class="ob__title">每天打开学习台，只盯今天这一步</h1>
            <p class="ob__sub">今天该做的一步已经排好；边学边问，听不懂就让问流换一种讲法，节奏也会按你的状态调整。</p>

            <div class="ob__demo" aria-hidden="true">
              <div class="ob__demo-bar">
                <span>学习台</span>
                <span class="ob__chip ob__chip--green">今日行动</span>
              </div>
              <div class="ob__demo-action ob__demo-action--main">
                <span class="ob__demo-action__tag">今日行动</span>
                <span class="ob__demo-action__body"><b>跑通第一版数据读取</b><small>来自「Excel 周报自动化」· 约 25 分钟</small></span>
              </div>
              <div class="ob__demo-metrics">
                <span><small>健康度</small><b>14</b></span>
                <span><small>疲劳度</small><b>33</b></span>
                <span><small>状态</small><b class="is-good">最优训练区</b></span>
              </div>
              <div class="ob__demo-tip">边学边问 · 听不懂就换一种讲法 · 节奏可调</div>
            </div>

            <div class="ob__nav">
              <button type="button" class="ob__back" @click="prev">‹ 上一步</button>
              <button type="button" class="ob__cta" @click="goDashboard">进入学习台
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
              </button>
            </div>

            <router-link to="/goal-conversation" class="ob__goal" @click="markDone">也可以直接去规划第一个目标 ›</router-link>
          </div>
        </Transition>

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

const totalSteps = 4
const step = ref(1)

function next() {
  if (step.value < totalSteps) step.value++
}

function prev() {
  if (step.value > 1) step.value--
}

/* 标记引导完成（完成或跳过时调用） */
async function markDone() {
  try { await api.post('/users/me/onboarding') } catch { /* 不阻塞 */ }
}

/* 引导只教「怎么用」，目标规划交给 /goal-conversation 自己完成 */
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  padding: 40px 20px;
  /* overflow-safe 居中：空间充足时垂直居中，内容超高时从顶部排布（避免顶边被裁无法滚回） */
}
.ob__logo { margin-top: auto; }
.ob__card { margin-bottom: auto; }

.ob__logo { display: inline-flex; }
.ob__logo img { height: 44px; width: auto; display: block; }

.ob__card {
  width: min(520px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 2px 4px rgba(23,32,51,0.04), 0 24px 60px rgba(23,32,51,0.08);
  padding: 26px 30px 24px;
  text-align: center;
  animation: ob-card-in 0.65s cubic-bezier(0.16,1,0.3,1) both;
}
@keyframes ob-card-in {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 步骤进度：4 段 */
.ob__progress {
  display: flex;
  gap: 6px;
  justify-content: center;
  margin-bottom: 20px;
}
.ob__progress span {
  width: 34px; height: 4px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--line) 70%, transparent);
  transition: background 0.35s;
}
.ob__progress span.is-on { background: linear-gradient(90deg, var(--blue), var(--blue-deep)); }

/* 步骤切换动画 */
.ob-swap-enter-active,
.ob-swap-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}
.ob-swap-enter-from {
  opacity: 0;
  transform: translateX(14px);
}
.ob-swap-leave-to {
  opacity: 0;
  transform: translateX(-14px);
}

.ob__page { display: grid; gap: 0; }

.ob__kicker {
  display: inline-block;
  justify-self: center;
  margin-bottom: 10px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--blue-deep);
  background: rgba(52,120,246,0.08);
  border-radius: 999px;
}

.ob__title {
  margin: 0 0 8px;
  font-size: 21px;
  font-weight: 800;
  color: var(--ink);
  line-height: 1.35;
}

.ob__sub {
  margin: 0 0 20px;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--muted);
}

/* ===== 第 1 步：三步流程条 ===== */
.ob__flow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 24px;
}
.ob__flow-item {
  display: grid;
  gap: 2px;
  justify-items: center;
  padding: 12px 10px 10px;
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 96%, var(--canvas));
}
.ob__flow-item i {
  font-style: normal;
  font-size: 11px;
  font-weight: 800;
  color: var(--blue-deep);
  background: rgba(52,120,246,0.1);
  width: 20px; height: 20px;
  display: grid; place-items: center;
  border-radius: 50%;
  margin-bottom: 3px;
}
.ob__flow-item strong { font-size: 13px; color: var(--ink); }
.ob__flow-item small { font-size: 11px; color: var(--faint); }
.ob__flow-arrow { color: var(--blue); opacity: 0.7; flex: none; }

/* ===== 第 2-4 步：产品演示卡 ===== */
.ob__demo {
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 97%, var(--canvas));
  padding: 14px;
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}
.ob__demo-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 800;
  color: var(--ink);
}
.ob__demo-bar span:first-child { flex: 1; }
.ob__chip {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--blue-deep);
  background: rgba(52,120,246,0.1);
  padding: 3px 8px;
  border-radius: 999px;
}
.ob__chip--green {
  color: #0f8a4d;
  background: rgba(22,163,94,0.12);
}

/* 聊天演示（第 2 步） */
.ob__bubble {
  display: flex;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 10px 10px 10px 3px;
  font-size: 12.5px;
  line-height: 1.55;
  max-width: 86%;
}
.ob__bubble--user {
  justify-self: end;
  border-radius: 10px 10px 3px 10px;
  color: var(--ink);
  background: rgba(52,120,246,0.1);
  border: 1px solid rgba(52,120,246,0.16);
}
.ob__bubble--ai {
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: 0 2px 8px rgba(23,32,51,0.05);
}
.ob__bubble--ai img { width: 20px; height: 20px; flex: none; margin-top: 1px; }
.ob__bubble-body p { margin: 0 0 7px; }
.ob__demo-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.ob__demo-tags span {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px 9px;
}
.ob__demo-tags span.is-on {
  color: var(--blue-deep);
  border-color: rgba(52,120,246,0.45);
  background: rgba(52,120,246,0.07);
}

/* 路径演示（第 3 步） */
.ob__demo-stages { display: flex; gap: 8px; }
.ob__stage {
  flex: 1;
  display: grid;
  gap: 2px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  opacity: 0.72;
}
.ob__stage i {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 800;
  color: var(--faint);
  width: 18px; height: 18px;
  display: grid; place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
}
.ob__stage b { font-size: 12px; color: var(--ink); }
.ob__stage small { font-size: 10.5px; color: var(--faint); }
.ob__stage.is-done i {
  color: #0f8a4d;
  border-color: rgba(22,163,94,0.4);
  background: rgba(22,163,94,0.1);
}
.ob__stage.is-on {
  opacity: 1;
  border-color: rgba(52,120,246,0.45);
  box-shadow: 0 0 0 3px rgba(52,120,246,0.08);
}
.ob__stage.is-on i {
  color: #fff;
  border-color: var(--blue);
  background: var(--blue);
}
.ob__demo-prog {
  height: 5px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--line) 60%, transparent);
  overflow: hidden;
}
.ob__demo-prog i {
  display: block;
  height: 100%;
  width: var(--w);
  background: linear-gradient(90deg, var(--blue), var(--blue-deep));
  border-radius: 99px;
}

/* 今日行动行（第 3/4 步共用） */
.ob__demo-action {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
  padding: 11px 12px;
  border: 1px solid rgba(52,120,246,0.22);
  border-radius: 10px;
  background: rgba(52,120,246,0.06);
}
/* 第 3 步：竖向堆叠（chip 在上、标题在下，与真实学习台「今日行动」样式一致，避免任何横向重叠） */
.ob__demo-action--stack {
  display: grid;
  justify-items: start;
  gap: 6px;
}
.ob__demo-action__tag {
  flex: none;
  font-size: 9.5px;
  font-weight: 800;
  line-height: 1;
  color: var(--blue-deep);
  background: rgba(52,120,246,0.12);
  padding: 5px 7px;
  border-radius: 6px;
  white-space: nowrap;
}
.ob__demo-action__body { display: grid; gap: 3px; min-width: 0; }
.ob__demo-action b { font-size: 13px; color: var(--ink); }
.ob__demo-action small { font-size: 11px; color: var(--faint); }

/* 学习状态指标（第 4 步） */
.ob__demo-metrics {
  display: flex;
  gap: 8px;
}
.ob__demo-metrics span {
  flex: 1;
  display: grid;
  gap: 2px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
}
.ob__demo-metrics small { font-size: 10.5px; color: var(--faint); }
.ob__demo-metrics b { font-size: 15px; color: var(--ink); }
.ob__demo-metrics b.is-good { font-size: 11.5px; color: #0f8a4d; }
.ob__demo-tip {
  font-size: 11px;
  color: var(--muted);
  text-align: center;
  padding-top: 2px;
}

/* 关键词条（第 2/3 步） */
.ob__notes {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-bottom: 18px;
}
.ob__notes span {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 10px;
  background: var(--surface);
}

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
  transition: transform 0.18s, box-shadow 0.18s;
}
.ob__cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(52,120,246,0.3);
}
.ob__cta:active {
  transform: translateY(0) scale(0.97);
}

/* 第 4 步：次要入口（不抢 goal 的活，只给入口） */
.ob__goal {
  display: block;
  margin-top: 14px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--blue-deep);
  text-decoration: none;
}
.ob__goal:hover { text-decoration: underline; }

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
  .ob__card { padding: 22px 16px 18px; border-radius: 16px; }
  .ob__title { font-size: 18px; }
  .ob__progress span { width: 24px; }
  .ob__flow-item { padding: 10px 6px 8px; }
  .ob__flow-item strong { font-size: 12px; }
  .ob__stage small { display: none; }
}

[data-theme='dark'] .ob__card {
  box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 24px 60px rgba(0,0,0,0.3);
}
[data-theme='dark'] .ob__cta {
  box-shadow: 0 8px 20px rgba(77,139,248,0.2);
}
</style>