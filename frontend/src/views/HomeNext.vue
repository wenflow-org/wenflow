<template>
  <div class="hn">
    <MarketingNav :logged-in="loggedIn" />

    <main id="top">
      <div class="hn-bg" aria-hidden="true">
        <div class="hn-orb hn-orb--a" />
        <div class="hn-orb hn-orb--b" />
        <div class="hn-grid" />
      </div>

      <!-- Hero：大字 + 舞台示意 -->
      <section class="hn-hero hn-shell">
        <div class="hn-hero__copy">
          <span class="hn-pill">问流 · 从问题到学习路径</span>
          <h1>先说清你想解决的事，<br />再开始学习。</h1>
          <p>
            不用整理成完美目标。聊几分钟，问流帮你收敛方向、生成路径——学习台直接给出今天能动手的一步。
          </p>
          <div class="hn-hero__cta">
            <router-link :to="primaryPath" class="hn-btn hn-btn--primary hn-btn--lg">{{ primaryLabel }}</router-link>
            <a href="#how" class="hn-btn hn-btn--ghost hn-btn--lg">看产品怎么走</a>
          </div>
        </div>

        <aside class="hn-stage" aria-label="产品示意" ref="stageEl">
          <div class="hn-stage__chat" :class="{ 'is-fading': phase === 7 }">
            <div class="hn-stage__bar">
              <span>目标规划</span>
              <span class="hn-chip">澄清问题</span>
            </div>
            <div class="hn-bubble hn-bubble--user" :class="{ 'hn-demo--off': phase < 1 }">每周 Excel 周报太花时间，想用 Python 自动化</div>
            <div class="hn-bubble hn-bubble--ai" :class="{ 'hn-demo--off': phase < 2 }">
              <img src="/favicon.png" alt="" />
              <div v-if="phase < 3" class="hn-typing__dots" aria-label="正在输入"><i /><i /><i /></div>
              <div v-else>
                <p>好，我们先把问题说小一点。你更想先节省哪一段时间？</p>
                <div class="hn-tags">
                  <span class="hn-tag" :class="{ 'hn-tag--on': phase >= 4 }">清洗与合并数据</span>
                  <span class="hn-tag">出图与汇报</span>
                </div>
              </div>
            </div>
            <div class="hn-stage__result" :class="{ 'hn-demo--off': phase < 5, 'is-hot': phase === 5 }">
              <small>下一步</small>
              <strong>生成可执行的学习路径</strong>
              <em>约 2 分钟</em>
            </div>
          </div>
          <div class="hn-stage__desk">
            <div class="hn-stage__bar">
              <span>学习台</span>
              <span class="hn-chip hn-chip--green">今日行动</span>
            </div>
            <p class="hn-stage__from">来自「Excel 周报自动化」</p>
            <h3>跑通第一版数据读取</h3>
            <div class="hn-stage__meta">
              <span>阶段 2 / 5</span>
              <span>约 25 分钟</span>
            </div>
            <div class="hn-stage__prog"><i style="--w: 42%" /></div>
            <span class="hn-stage__go">开始学习</span>
          </div>
        </aside>
      </section>

      <!-- 痛点：全宽对比带 -->
      <section class="hn-band">
        <div class="hn-shell hn-band__in">
          <div class="hn-band__side" v-reveal>
            <span>常见开始</span>
            <h2>先囤课、囤资料、囤清单。</h2>
            <p>内容越来越多，今天仍不知道做哪一步。</p>
          </div>
          <div class="hn-band__arrow" aria-hidden="true"><span>→</span></div>
          <div class="hn-band__side hn-band__side--on" v-reveal="{ delay: 120 }">
            <span>问流的开始</span>
            <h2>先说出真实场景。</h2>
            <p>追问边界、基础与时间，再落到今天能动手的任务。</p>
          </div>
        </div>
      </section>

      <!-- 怎么走：曲线 + 五步（旧版 product-flow 气质） -->
      <section id="how" class="hn-flow hn-shell">
          <div class="hn-section" v-reveal>
          <span class="hn-pill">怎么开始</span>
          <h2>从一句话，到今天能做的一步。</h2>
          <p>不用先写完整计划。先说清楚，再生成路径，再开始学。</p>
        </div>
        <div class="hn-flow__canvas">
          <svg class="hn-flow__svg" viewBox="0 0 1200 160" fill="none" preserveAspectRatio="none" aria-hidden="true" v-reveal>
            <path
              class="hn-flow__path"
              pathLength="1"
              d="M 40 90 C 180 30, 320 140, 480 90 C 640 40, 780 140, 940 90 C 1040 55, 1120 90, 1160 90"
            />
          </svg>
          <ol class="hn-flow__grid">
            <li v-for="(s, i) in steps" :key="s.t" v-reveal="{ delay: i * 70 }">
              <span>{{ i + 1 }}</span>
              <strong>{{ s.t }}</strong>
              <p>{{ s.d }}</p>
              <em>{{ s.where }}</em>
            </li>
          </ol>
        </div>
      </section>

      <!-- 独特理念：一大块说明 + 四条要点（非对称） -->
      <section class="hn-idea">
        <div class="hn-shell hn-idea__in">
          <div class="hn-idea__lead" v-reveal>
            <span class="hn-pill">和常见开始方式不同</span>
            <h2>先把问题说小，再开始学。</h2>
            <p>
              目标太大、资料太多时，问流先帮你收到能落地的范围，再边学边调。
            </p>
          </div>
          <div class="hn-idea__list">
            <article v-for="(item, i) in modes" :key="item.t" v-reveal="{ delay: i * 70 }">
              <strong>{{ item.t }}</strong>
              <p>{{ item.d }}</p>
            </article>
          </div>
        </div>
      </section>

      <!-- 学习台：错位分栏 -->
      <section class="hn-desk hn-shell">
        <div class="hn-desk__copy" v-reveal>
          <h2>每天打开学习台，只盯今天这一步。</h2>
          <p>路径生成后，「今日行动」直接告诉你学什么、学多久；也可以随时规划新目标。</p>
          <ul>
            <li>今日行动 · 清楚今天学什么</li>
            <li>学习路径 · 阶段与任务可继续</li>
            <li>学习状态 · 看节奏再决定推进或放缓</li>
          </ul>
        </div>
        <div class="hn-desk__card" v-reveal="{ delay: 140 }">
          <div class="hn-panel">
            <div class="hn-stage__bar">
              <span>学习状态</span>
              <span class="hn-chip hn-chip--green">近 7 天</span>
            </div>
            <div class="hn-state__metrics">
              <div><span>健康度</span><b>14</b></div>
              <div><span>疲劳度</span><b>33</b></div>
              <div><span>状态</span><b class="hn-state__form">最优训练区</b></div>
            </div>
            <div class="hn-stage__prog"><i style="--w: 62%" /></div>
            <div class="hn-state__hint">
              本周节奏稳定，状态正处最优训练区——按当前节奏推进即可。
            </div>
          </div>
        </div>
      </section>

      <!-- 全宽收尾 -->
      <section class="hn-end">
        <div class="hn-end__glow" />
        <div class="hn-end__in" v-reveal>
          <h2>用 2 分钟，理出一条能执行的路径。</h2>
          <div class="hn-end__acts">
            <router-link :to="primaryPath" class="hn-btn hn-btn--primary hn-btn--lg">{{ primaryLabel }}</router-link>
            <router-link to="/vision" class="hn-btn hn-btn--light hn-btn--lg">为什么这样学</router-link>
          </div>
        </div>
      </section>
    </main>

    <footer class="hn-foot">
      <div class="hn-shell hn-foot__in">
        <div class="hn-foot__brand">
          <img src="/favicon.png" alt="" />
          <span>问流 WenFlow</span>
          <em>从问题到学习路径</em>
        </div>
        <div class="hn-foot__links">
          <router-link to="/vision">愿景</router-link>
          <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { hasUserSession } from '@/utils/api'
import MarketingNav from '@/components/MarketingNav.vue'

const loggedIn = ref(false)

const steps = [
  { t: '说出问题', d: '从最近真正卡住的事开始，不用说得很完整。', where: '目标规划' },
  { t: '澄清方向', d: '一起把目标收到今天能开始的范围。', where: '目标规划' },
  { t: '生成路径', d: '得到阶段与任务，后面还能随学习调整。', where: '目标规划' },
  { t: '今日行动', d: '打开学习台，今天该做的一步已经排好。', where: '学习台' },
  { t: '边学边调', d: '根据反馈和节奏，决定下一步怎么走。', where: '学习状态' }
]

const modes = [
  { t: '从真实场景开始', d: '先说卡住的事，而不是先选一门课。' },
  { t: '路径可执行', d: '拆成阶段与任务，今天就能动手。' },
  { t: '对话里学', d: '讲、问、练，听不懂就换一种讲法。' },
  { t: '节奏可调', d: '看状态再决定推进或放缓，路径可以改。' }
]

const primaryPath = computed(() => (loggedIn.value ? '/goal-conversation' : '/register'))
const primaryLabel = computed(() => (loggedIn.value ? '规划新目标' : '从一个问题开始'))

function syncAuthState() {
  loggedIn.value = hasUserSession()
}

/* Hero 对话演示：用户提问 → 正在输入 → AI 回复 → 选中标签 → 高亮结果 → 淡出重播。
   phase 99 = 全部静态可见（reduced-motion 时的兜底，不跑时间轴）。
   phase 7 为淡出过渡（整卡上浮淡出），随后回到 phase 0 重播。 */
const phase = ref(
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 99
    : 0
)

const demoTimeline: Array<[number, number]> = [
  [1, 450],   // 用户气泡出现
  [2, 550],   // 输入中
  [3, 600],   // AI 回复
  [4, 550],   // 选中标签
  [5, 450],   // 高亮结果
  [6, 1300],  // 停留
  [7, 300],   // 整卡淡出
  [0, 250]    // 回到起点，循环
]

const stageEl = ref<HTMLElement | null>(null)
let demoTimer: ReturnType<typeof setTimeout> | null = null
let demoIndex = 0
let demoLoops = 0
let demoVisible = true
let demoObserver: IntersectionObserver | null = null

function stopDemo() {
  if (demoTimer) {
    clearTimeout(demoTimer)
    demoTimer = null
  }
}

function runDemoStep() {
  if (!demoVisible || phase.value === 99) return
  const [nextPhase, delay] = demoTimeline[demoIndex % demoTimeline.length]
  demoIndex++
  // 循环上限：播完 2 轮后停在完成态（phase 5 高亮结果），不再重播（4K 高视口下 hero 常驻视口，
  // 无限循环会造成持续动画干扰）
  if (nextPhase === 0) demoLoops++
  if (demoLoops >= 2 && nextPhase > 5) {
    phase.value = 5
    return
  }
  demoTimer = setTimeout(() => {
    if (!demoVisible) return
    phase.value = nextPhase
    runDemoStep()
  }, delay)
}

onMounted(() => {
  syncAuthState()
  window.addEventListener('storage', syncAuthState)
  if (phase.value === 99) return
  // 舞台离开视口时暂停时间轴，回到视口再继续，避免后台空转
  demoObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((e) => e.isIntersecting)
      demoVisible = visible
      if (visible) {
        runDemoStep()
      } else {
        stopDemo()
      }
    },
    { threshold: 0.15 }
  )
  if (stageEl.value) demoObserver.observe(stageEl.value)
})

onUnmounted(() => {
  window.removeEventListener('storage', syncAuthState)
  stopDemo()
  demoObserver?.disconnect()
})
</script>

<style scoped>
.hn {
  --ink: #172033;
  --muted: #5b6577;
  --faint: #8492ab;
  --line: rgba(23, 32, 51, 0.08);
  --canvas: #f3f6fb;
  --surface: #fff;
  --blue: #3478f6;
  --blue-deep: #1f57cc;
  --cyan: #43b0d8;
  --green: #31b16f;
  --accent: #8d6bff;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  min-height: 100vh;
  background: var(--canvas);
  color: var(--ink);
  font-family: Inter, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  overflow-x: clip;
}

.hn-shell {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

/* Nav 由 MarketingNav 组件提供（首页/愿景共用同一份导航） */

/* BG */
.hn-bg {
  position: absolute;
  inset: 0 0 auto;
  height: 1200px;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}
.hn-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.24;
  will-change: transform;
}
.hn-orb--a {
  width: 520px;
  height: 520px;
  top: 80px;
  right: -140px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.36), transparent 70%);
}
.hn-orb--b {
  width: 420px;
  height: 420px;
  top: 480px;
  left: -140px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.22), transparent 70%);
}

@media (prefers-reduced-motion: no-preference) {
  .hn-orb--a {
    animation: hn-drift-a 24s ease-in-out infinite;
  }
  .hn-orb--b {
    animation: hn-drift-b 28s ease-in-out infinite;
  }
}
@keyframes hn-drift-a {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-36px, 28px); }
}
@keyframes hn-drift-b {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(30px, -24px); }
}
.hn-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(23, 32, 51, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(23, 32, 51, 0.035) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.75), transparent 70%);
}

main {
  position: relative;
  z-index: 1;
}

/* Hero */
.hn-hero {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 440px);
  gap: 48px;
  align-items: center;
  padding: 120px 0 72px;
}
.hn-hero__copy {
  display: grid;
  gap: 16px;
}
.hn-pill {
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: var(--blue-deep);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.04em;
}
.hn-hero h1 {
  margin: 0;
  font-size: clamp(40px, 6.2vw, 72px);
  line-height: 1.06;
  letter-spacing: -0.05em;
  max-width: 10em;
}
.hn-hero__copy > p {
  margin: 0;
  max-width: 36ch;
  font-size: 18px;
  line-height: 1.75;
  color: var(--muted);
}
.hn-hero__cta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
}

/* 按钮基础样式（此前缺失导致 .hn-btn 全部渲染为裸文字链接；档位参照 vn-btn 体系） */
.hn-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  border: 1px solid transparent;
  cursor: pointer;
  width: fit-content;
  transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
}
.hn-btn:hover {
  transform: translateY(-2px);
}
.hn-btn:active {
  transform: translateY(0) scale(0.98);
}
.hn-btn--primary {
  color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  box-shadow: 0 16px 34px rgba(52, 120, 246, 0.22);
}
.hn-btn--ghost {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.74);
  border-color: var(--line);
}
.hn-btn--light {
  color: var(--blue-deep);
  background: #fff;
  border-color: var(--line);
}
.hn-btn--lg {
  min-height: 60px;
  padding: 0 32px;
  font-size: 17px;
}

/* Hero 入场编排：依次上浮，舞台卡从更大倾角回正 */
@media (prefers-reduced-motion: no-preference) {
  .hn-hero .hn-pill { animation: hn-rise 0.7s var(--ease) 0.05s both; }
  .hn-hero h1 { animation: hn-rise 0.8s var(--ease) 0.14s both; }
  .hn-hero__copy > p { animation: hn-rise 0.8s var(--ease) 0.24s both; }
  .hn-hero__cta { animation: hn-rise 0.8s var(--ease) 0.34s both; }
  .hn-stage__chat { animation: hn-settle-chat 0.9s var(--ease) 0.42s both; }
  .hn-stage__desk { animation: hn-settle-desk 0.9s var(--ease) 0.54s both; }
}
@keyframes hn-rise {
  from { opacity: 0; transform: translateY(26px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes hn-settle-chat {
  from { opacity: 0; transform: rotate(-5deg) translateY(34px); }
  to { opacity: 1; transform: rotate(-1deg) translateY(0); }
}
@keyframes hn-settle-desk {
  from { opacity: 0; transform: rotate(4.4deg) translateY(38px); }
  to { opacity: 1; transform: rotate(1.2deg) translateX(18px); }
}
@media (max-width: 980px) and (prefers-reduced-motion: no-preference) {
  .hn-stage__chat,
  .hn-stage__desk {
    animation-name: hn-rise;
  }
}

/* 移动端：桌面装饰位移（translateX(18px)+rotate）会把卡片推出窄视口，归零防裁切 */
@media (max-width: 980px) {
  .hn-stage__desk {
    transform: none;
  }
}

/* Stage */
.hn-stage {
  position: relative;
  display: grid;
  gap: 14px;
}
.hn-stage__chat,
.hn-stage__desk,
.hn-panel {
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid var(--line);
  border-radius: 28px;
  padding: 20px;
  box-shadow: 0 28px 80px rgba(58, 101, 197, 0.14);
  backdrop-filter: blur(14px);
}
.hn-stage__chat {
  transform: rotate(-1deg);
  transition: opacity 0.5s var(--ease), transform 0.5s var(--ease);
}
.hn-stage__chat.is-fading {
  opacity: 0;
  transform: rotate(-1deg) translateY(-14px);
}
.hn-stage__desk {
  transform: rotate(1.2deg) translateX(18px);
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.95));
  border-color: rgba(52, 120, 246, 0.14);
}
.hn-stage__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 800;
  color: var(--ink);
}
.hn-chip {
  font-size: 11px;
  font-weight: 800;
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.1);
  padding: 4px 10px;
  border-radius: 999px;
}
.hn-chip--green {
  color: #1f8a52;
  background: rgba(49, 177, 111, 0.12);
}
.hn-bubble {
  font-size: 14px;
  line-height: 1.55;
  margin-bottom: 10px;
}
.hn-bubble--user {
  margin-left: auto;
  max-width: 92%;
  padding: 12px 14px;
  border-radius: 18px 18px 4px 18px;
  color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
}
.hn-bubble--ai {
  display: flex;
  gap: 8px;
}
.hn-bubble--ai img {
  width: 26px;
  height: 26px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: #fff;
  flex: 0 0 auto;
}
.hn-bubble--ai > div {
  background: linear-gradient(180deg, #f7faff, #eef3fb);
  border: 1px solid var(--line);
  border-radius: 4px 18px 18px 18px;
  padding: 12px 14px;
}
.hn-bubble--ai p {
  margin: 0;
}
.hn-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.hn-tag {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  border: 1px solid var(--line);
  background: #fff;
  padding: 5px 10px;
  border-radius: 999px;
}
.hn-tag--on {
  color: var(--blue-deep);
  border-color: rgba(52, 120, 246, 0.35);
  background: rgba(52, 120, 246, 0.08);
}
.hn-stage__result {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  padding: 14px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(255, 255, 255, 0.9));
  border: 1px solid rgba(52, 120, 246, 0.12);
}
.hn-stage__result small {
  font-size: 11px;
  font-weight: 800;
  color: var(--blue-deep);
}
.hn-stage__result strong {
  font-size: 14px;
}
.hn-stage__result em {
  font-style: normal;
  font-size: 12px;
  color: var(--faint);
  font-weight: 700;
}

/* 对话演示：相位切换由 script 时间轴驱动，这里只负责过渡 */
.hn-bubble--user,
.hn-bubble--ai,
.hn-stage__result {
  transition: opacity 0.45s var(--ease), transform 0.45s var(--ease);
}
.hn-demo--off {
  opacity: 0;
  transform: translateY(10px);
  pointer-events: none;
}
.hn-typing__dots {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  min-height: 20px;
  min-width: 44px;
}
.hn-typing__dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--faint);
}
@media (prefers-reduced-motion: no-preference) {
  .hn-typing__dots i {
    animation: hn-dot 1s ease-in-out infinite;
  }
  .hn-typing__dots i:nth-child(2) { animation-delay: 0.15s; }
  .hn-typing__dots i:nth-child(3) { animation-delay: 0.3s; }
}
@keyframes hn-dot {
  0%, 100% { opacity: 0.35; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-3px); }
}
.hn-tag {
  transition: color 0.3s var(--ease), border-color 0.3s var(--ease), background 0.3s var(--ease);
}
.hn-stage__result.is-hot {
  animation: hn-glow 1.8s var(--ease) 1;
}
@keyframes hn-glow {
  0% { box-shadow: 0 0 0 0 rgba(52, 120, 246, 0.35); }
  100% { box-shadow: 0 0 0 18px rgba(52, 120, 246, 0); }
}
.hn-stage__from {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--faint);
}
.hn-stage__desk h3,
.hn-panel h3 {
  margin: 0 0 10px;
  font-size: 18px;
  letter-spacing: -0.02em;
}
.hn-stage__meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  margin-bottom: 12px;
}
.hn-stage__prog {
  height: 6px;
  border-radius: 99px;
  background: #edf1f8;
  overflow: hidden;
  margin-bottom: 14px;
}
.hn-stage__prog i {
  display: block;
  height: 100%;
  width: var(--w, 0);
  border-radius: 99px;
  background: linear-gradient(90deg, var(--blue), var(--cyan));
}
/* hero 进度条随入场充能；desk 卡片的进度条随 v-reveal 充能 */
@media (prefers-reduced-motion: no-preference) {
  .hn-stage .hn-stage__prog i {
    animation: hn-prog 1.2s var(--ease) 1.15s both;
  }
}
@keyframes hn-prog {
  from { width: 0; }
  to { width: var(--w, 0); }
}
.rv .hn-stage__prog i {
  width: 0;
  transition: width 1.1s var(--ease) 0.25s;
}
.rv-in .hn-stage__prog i {
  width: var(--w, 0);
}
.hn-stage__go {
  display: inline-flex;
  padding: 10px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  box-shadow: 0 12px 24px rgba(52, 120, 246, 0.22);
}

/* Band full-bleed */
.hn-band {
  margin: 20px 0 60px;
  padding: 48px 0;
  background: rgba(255, 255, 255, 0.55);
  border-block: 1px solid var(--line);
}
.hn-band__in {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 24px;
  align-items: center;
}
.hn-band__side {
  display: grid;
  gap: 10px;
  padding: 28px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid var(--line);
  transition: transform 0.28s var(--ease), box-shadow 0.28s var(--ease);
}
.hn-band__side:hover {
  transform: translateY(-3px);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
}
.hn-band__side--on {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(255, 255, 255, 0.92));
  border-color: rgba(52, 120, 246, 0.16);
}
.hn-band__side span {
  font-size: 12px;
  font-weight: 900;
  color: var(--faint);
}
.hn-band__side--on span {
  color: var(--blue-deep);
}
.hn-band__side h2 {
  margin: 0;
  font-size: clamp(22px, 2.8vw, 30px);
  letter-spacing: -0.03em;
  line-height: 1.2;
}
.hn-band__side p {
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
}
.hn-band__arrow {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 24px;
  font-weight: 900;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  box-shadow: 0 14px 30px rgba(52, 120, 246, 0.25);
}
.hn-band__arrow span {
  display: block;
}
@media (prefers-reduced-motion: no-preference) {
  .hn-band__arrow span {
    animation: hn-nudge 2.4s var(--ease) infinite;
  }
}
@keyframes hn-nudge {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(7px); }
}

/* Flow */
.hn-flow {
  padding: 40px 0 80px;
  scroll-margin-top: 96px;
}
.hn-section {
  max-width: 36em;
  margin-bottom: 36px;
  display: grid;
  gap: 12px;
}
.hn-section h2 {
  margin: 0;
  font-size: clamp(32px, 4.5vw, 52px);
  letter-spacing: -0.045em;
  line-height: 1.08;
}
.hn-section p {
  margin: 0;
  font-size: 17px;
  line-height: 1.75;
  color: var(--muted);
}
.hn-flow__canvas {
  position: relative;
}
.hn-flow__svg {
  width: 100%;
  height: auto;
  display: block;
  margin-bottom: -28px;
}
.hn-flow__path {
  stroke: #3478f6;
  stroke-width: 3;
  stroke-linecap: round;
  opacity: 0.35;
  fill: none;
  stroke-dasharray: 1;
  /* 默认保持画完状态：v-reveal 揭示后会移除 .rv/.rv-in，若默认值是未画状态会反向缩回 */
  stroke-dashoffset: 0;
  transition: stroke-dashoffset 1.6s var(--ease) 0.25s;
}
.hn-flow__svg.rv .hn-flow__path {
  stroke-dashoffset: 1;
}
.hn-flow__svg.rv-in .hn-flow__path {
  stroke-dashoffset: 0;
}
.hn-flow__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
  position: relative;
  z-index: 1;
}
.hn-flow__grid li {
  display: grid;
  gap: 10px;
  justify-items: center;
  text-align: center;
  min-height: 210px;
  padding: 22px 16px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid var(--line);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05);
  transition: transform 0.28s var(--ease), box-shadow 0.28s var(--ease);
}
.hn-flow__grid li:hover {
  transform: translateY(-4px);
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.09);
}
.hn-flow__grid span {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 14px;
  font-weight: 900;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  box-shadow: 0 12px 24px rgba(52, 120, 246, 0.22);
}
.hn-flow__grid strong {
  font-size: 16px;
}
.hn-flow__grid p {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--muted);
  max-width: 18ch;
}
.hn-flow__grid em {
  font-style: normal;
  font-size: 11px;
  font-weight: 800;
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.08);
  padding: 4px 9px;
  border-radius: 999px;
}

/* Idea asymmetric */
.hn-idea {
  padding: 40px 0 72px;
}
.hn-idea__in {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.15fr);
  gap: 40px;
  align-items: start;
}
.hn-idea__lead {
  display: grid;
  gap: 14px;
  position: sticky;
  top: 100px;
}
.hn-idea__lead h2 {
  margin: 0;
  font-size: clamp(32px, 4vw, 48px);
  letter-spacing: -0.045em;
  line-height: 1.08;
}
.hn-idea__lead p {
  margin: 0;
  font-size: 16px;
  line-height: 1.8;
  color: var(--muted);
  max-width: 34ch;
}
.hn-idea__list {
  display: grid;
  gap: 12px;
}
.hn-idea__list article {
  padding: 22px 24px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid var(--line);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.04);
  transition: transform 0.28s var(--ease), box-shadow 0.28s var(--ease);
}
.hn-idea__list article:hover {
  transform: translateY(-3px);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
}
.hn-idea__list strong {
  display: block;
  font-size: 17px;
  margin-bottom: 6px;
}
.hn-idea__list p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted);
}

/* Desk */
.hn-desk {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 48px;
  align-items: center;
  padding: 40px 0 90px;
}
.hn-desk__copy h2 {
  margin: 0 0 14px;
  font-size: clamp(30px, 4vw, 44px);
  letter-spacing: -0.04em;
  line-height: 1.12;
}
.hn-desk__copy > p {
  margin: 0 0 18px;
  font-size: 16px;
  line-height: 1.75;
  color: var(--muted);
  max-width: 38ch;
}
.hn-desk__copy ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.hn-desk__copy li {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid var(--line);
  font-size: 14px;
  font-weight: 700;
}
.hn-desk__card {
  margin-top: 12px;
}
.hn-panel {
  padding: 26px;
  transition: transform 0.28s var(--ease), box-shadow 0.28s var(--ease);
}
.hn-panel:hover {
  transform: translateY(-4px);
  box-shadow: 0 34px 88px rgba(58, 101, 197, 0.18);
}
.hn-state__metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.hn-state__metrics > div {
  display: grid;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--line);
}
.hn-state__metrics span {
  font-size: 11px;
  font-weight: 800;
  color: var(--faint);
}
.hn-state__metrics b {
  font-size: 20px;
  letter-spacing: -0.02em;
}
.hn-state__metrics .hn-state__form {
  font-size: 12px;
  line-height: 1.3;
  color: var(--green);
}
.hn-state__hint {
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
}

/* End full bleed — light band */
.hn-end {
  position: relative;
  margin-top: 20px;
  padding: 88px 24px 100px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(255, 255, 255, 0.92));
  border-top: 1px solid var(--line);
  color: var(--ink);
  overflow: hidden;
  text-align: center;
}
.hn-end__glow {
  position: absolute;
  inset: auto 50% -180px auto;
  width: 560px;
  height: 300px;
  transform: translateX(50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.18), transparent 68%);
  filter: blur(40px);
  pointer-events: none;
}
.hn-end__in {
  position: relative;
  z-index: 1;
  max-width: 640px;
  margin: 0 auto;
  display: grid;
  gap: 16px;
  justify-items: center;
}
.hn-end h2 {
  margin: 0;
  font-size: clamp(32px, 5vw, 52px);
  letter-spacing: -0.045em;
  line-height: 1.1;
  color: var(--ink);
}
.hn-end p {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.7;
}
.hn-end__acts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 8px;
}

/* Foot */
.hn-foot {
  border-top: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.7);
}
.hn-foot__in {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 22px 0;
}
.hn-foot__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
}
.hn-foot__brand img {
  width: 22px;
  height: 22px;
}
.hn-foot__brand em {
  font-style: normal;
  font-weight: 500;
  color: var(--faint);
  padding-left: 8px;
  border-left: 1px solid var(--line);
  font-size: 12px;
}
.hn-foot__links {
  display: flex;
  gap: 16px;
}
.hn-foot__links a {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  text-decoration: none;
}
.hn-foot__links a:hover {
  color: var(--blue-deep);
}

@media (max-width: 980px) {
  .hn-hero {
    grid-template-columns: 1fr;
    min-height: auto;
    padding-top: 100px;
  }
  .hn-stage__chat,
  .hn-stage__desk {
    transform: none;
  }
  .hn-band__in,
  .hn-flow__grid,
  .hn-idea__in,
  .hn-desk {
    grid-template-columns: 1fr;
  }
  .hn-band__arrow {
    justify-self: center;
    transform: rotate(90deg);
  }
  .hn-flow__svg {
    display: none;
  }
  .hn-flow__grid li {
    min-height: 0;
    justify-items: start;
    text-align: left;
    grid-template-columns: 42px 1fr;
    column-gap: 14px;
  }
  .hn-flow__grid span {
    grid-row: span 3;
  }
  /* 移动端描述单行展示：窄列下避免文字断行撑高卡片 */
  .hn-flow__grid p {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .hn-idea__lead {
    position: static;
  }
  .hn-hero h1 br {
    display: none;
  }
}

@media (max-width: 560px) {
  .hn-shell {
    width: min(100% - 28px, 1180px);
  }
  .hn-hero h1 {
    font-size: clamp(32px, 11vw, 42px);
  }
  .hn-foot__brand em {
    display: none;
  }
}

/* ---------- 超大屏（2K/4K）：随视口放大容器与字号，避免整页缩在中间 ---------- */
@media (min-width: 2000px) {
  .hn-shell {
    width: min(1560px, calc(100% - 64px));
  }
  .hn-btn {
    min-height: 48px;
    padding: 0 20px;
    font-size: 16px;
  }
  .hn-btn--lg {
    min-height: 60px;
    padding: 0 32px;
    font-size: 17px;
  }
  .hn-hero {
    grid-template-columns: minmax(0, 1fr) minmax(400px, 560px);
    gap: 72px;
    padding: 150px 0 90px;
  }
  .hn-hero h1 {
    font-size: clamp(76px, 4.2vw, 112px);
    line-height: 1.04;
  }
  .hn-hero__copy > p {
    font-size: 23px;
    max-width: 34ch;
  }
  .hn-pill {
    font-size: 13px;
    padding: 8px 14px;
  }
  .hn-stage__chat,
  .hn-stage__desk,
  .hn-panel {
    padding: 26px;
    border-radius: 32px;
  }
  .hn-stage__bar {
    font-size: 15px;
  }
  .hn-bubble {
    font-size: 16px;
  }
  .hn-stage__result strong {
    font-size: 16px;
  }
  .hn-stage__desk h3,
  .hn-panel h3 {
    font-size: 21px;
  }
  .hn-band {
    padding: 56px 0;
  }
  .hn-band__side {
    padding: 34px;
  }
  .hn-band__side h2 {
    font-size: clamp(30px, 2vw, 42px);
  }
  .hn-band__side p {
    font-size: 18px;
  }
  .hn-section {
    gap: 14px;
  }
  .hn-section h2 {
    font-size: clamp(48px, 3.2vw, 72px);
  }
  .hn-section p {
    font-size: 20px;
  }
  .hn-flow__grid li {
    min-height: 260px;
    padding: 26px 20px;
  }
  .hn-flow__grid strong {
    font-size: 19px;
  }
  .hn-flow__grid p {
    font-size: 15.5px;
  }
  .hn-idea__lead h2 {
    font-size: clamp(44px, 3vw, 64px);
    max-width: 14ch;
  }
  .hn-idea__lead p {
    font-size: 19px;
    max-width: 30ch;
  }
  .hn-idea__list article {
    padding: 26px 30px;
  }
  .hn-idea__list strong {
    font-size: 20px;
  }
  .hn-idea__list p {
    font-size: 16.5px;
  }
  .hn-desk {
    gap: 64px;
  }
  .hn-desk__copy h2 {
    font-size: clamp(40px, 2.8vw, 60px);
  }
  .hn-desk__copy > p {
    font-size: 19px;
    max-width: 34ch;
  }
  .hn-desk__copy li {
    font-size: 16px;
    padding: 16px 18px;
  }
  .hn-state__metrics b {
    font-size: 24px;
  }
  .hn-end {
    padding: 116px 24px 132px;
  }
  .hn-end h2 {
    font-size: clamp(48px, 3.2vw, 72px);
  }
  .hn-end p {
    font-size: 19px;
  }
  .hn-foot__in {
    padding: 26px 0;
  }
}
</style>
