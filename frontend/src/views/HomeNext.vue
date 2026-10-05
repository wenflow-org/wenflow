<template>
  <div class="hn">
    <MarketingNav :logged-in="loggedIn" />

    <main id="top">
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
              <img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="" />
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
        <div class="hn-end__in" v-reveal>
          <h2>用 2 分钟，理出一条能执行的路径。</h2>
          <div class="hn-end__acts">
            <router-link :to="primaryPath" class="hn-btn hn-btn--primary hn-btn--lg">{{ primaryLabel }}</router-link>
            <!-- 原型 wf-pend：主 CTA「从一个问题开始」→ 注册；次 CTA「已有账号，登录」→ 登录 -->
            <router-link :to="loggedIn ? '/dashboard' : '/login'" class="hn-btn hn-btn--light hn-btn--lg">{{ loggedIn ? '回到学习台' : '已有账号，登录' }}</router-link>
          </div>
        </div>
      </section>
    </main>

    <footer class="hn-foot">
      <div class="hn-shell hn-foot__in">
        <div class="hn-foot__brand">
          <img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="" />
          <span>问流 WenFlow</span>
          <em>从问题到学习路径</em>
        </div>
        <div class="hn-foot__links">
          <router-link to="/">首页</router-link>
          <router-link to="/vision">愿景</router-link>
          <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useIsDark } from '@/composables/useIsDark';

const isDark = useIsDark();
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
  --ink: var(--mk-ink);
  --muted: var(--mk-muted);
  --faint: var(--mk-faint);
  --line: var(--mk-line);
  --canvas: var(--mk-bg);
  --surface: var(--mk-surface);
  /* 原型 --soft：浅灰实色，band / end / footer 的全宽底色（亮暗两档自动推导） */
  --soft: color-mix(in srgb, var(--surface) 92%, var(--ink));
  --tint-blend: color-mix(in srgb, var(--blue) 10%, transparent);
  /* 唯一品牌蓝走 --mk-*（暗色由 --mk-blue 自动翻转到 #5b8def，不再写暗色覆写） */
  --blue: var(--mk-blue);
  --blue-deep: var(--mk-accent-deep);
  --cyan: #43b0d8;
  /* 原型 --green-ink：绿字与 ink 混 78%，亮/暗两档随 --mk-green / --mk-ink 自动推导 */
  --green: var(--mk-green);
  --green-deep: color-mix(in srgb, var(--mk-green) 78%, var(--mk-ink));
  --accent: var(--mk-purple);
  --ease: var(--mk-ease-out);
  [data-theme='dark'] & {
    --ink: var(--mk-ink);
    --muted: var(--mk-muted);
    --faint: var(--mk-faint);
    --line: var(--mk-line);
    --canvas: var(--mk-bg);
    --surface: var(--mk-surface);
    --cyan: #5fc3e6;
    --tint-blend: color-mix(in srgb, var(--blue) 14%, transparent);
  }
  min-height: 100vh;
  background: var(--canvas);
  color: var(--ink);
  font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", Inter, sans-serif;
  overflow-x: clip;
}

.hn-shell {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

/* Nav 由 MarketingNav 组件提供（首页/愿景共用同一份导航） */

main {
  position: relative;
  z-index: 1;
}

/* Hero：对照原型 .wf-phero（985-991）。导航已改 sticky，不再需要 120px 顶部让位 */
.hn-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 420px);
  gap: 44px;
  align-items: center;
  padding: 64px 0 52px;
}
.hn-hero__copy {
  display: grid;
  gap: 16px;
}
.hn-pill {
  width: fit-content;
  padding: 7px 12px;
  border-radius: var(--mk-radius-pill);
  background: color-mix(in srgb, var(--blue) 9%, transparent);
  color: var(--blue-deep);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.hn-hero h1 {
  margin: 0;
  font-size: clamp(34px, 5vw, 58px);
  line-height: 1.08;
  letter-spacing: -0.04em;
  max-width: 10em;
}
.hn-hero__copy > p {
  margin: 0;
  max-width: 36ch;
  font-size: 17px;
  line-height: 1.75;
  color: var(--muted);
}
.hn-hero__cta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}
/* 首屏 CTA：两个按钮统一宽度（原型 .wf-phero__cta .wf-pbtn） */
.hn-hero__cta .hn-btn {
  width: 200px;
  max-width: 100%;
}

/* 按钮基础样式（此前缺失导致 .hn-btn 全部渲染为裸文字链接；档位参照 vn-btn 体系） */
.hn-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: var(--mk-radius-pill);
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  border: 1px solid transparent;
  cursor: pointer;
  width: fit-content;
  /* 平面化后按钮已无投影，transition 里一并去掉 box-shadow */
  transition: transform 0.2s var(--ease);
}
/* 「友好而平」：取消 hover 上浮，悬停只允许改背景/描边/文字；
   按压反馈留给 :active 的 scale(0.98)。 */
.hn-btn:active {
  transform: scale(0.98);
}
/* 主按钮：实心品牌蓝，不再用 linear-gradient(135deg, …)；
   原先的 0 14px 30px 蓝色投影属于彩色光晕，一并退休。 */
.hn-btn--primary {
  color: var(--text-on-primary);
  background: var(--blue);
  transition: transform 0.2s var(--ease), background 0.2s var(--ease);
}
.hn-btn--primary:hover {
  background: var(--blue-deep);
}
/* 原型 wf-pbtn--ghost / --light：surface 实底 + line 描边（暗色随 --surface 自动跟随，无需覆写） */
.hn-btn--ghost {
  color: var(--ink);
  background: var(--surface);
  border-color: var(--line);
}
.hn-btn--light {
  color: var(--blue-deep);
  background: var(--surface);
  border-color: var(--line);
}
.hn-btn--lg {
  min-height: 52px;
  padding: 0 26px;
  font-size: 16px;
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
@media (max-width: 1023px) and (prefers-reduced-motion: no-preference) {
  .hn-stage__chat,
  .hn-stage__desk {
    animation-name: hn-rise;
  }
}

/* 移动端：桌面装饰位移（translateX(18px)+rotate）会把卡片推出窄视口，归零防裁切 */
@media (max-width: 1023px) {
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
  background: var(--surface);
  border: 1px solid var(--line);
  /* 圆角与投影（批次 D，2026-10-02）：
     原 border-radius: 18px 是档外值 → --mk-radius-xl(16px)。
     原 box-shadow: 0 12px 30px ink@8% 是规范外的第四档投影：
     这两块是页面里的静态分区面板，不叠在滚动内容上，投影不表达任何层级，
     只是给整页蒙一层灰雾。规范是「面永远是平的，1px 发丝线就是全部质感」——
     上一行的 border 已经承担了。 */
  border-radius: var(--mk-radius-xl);
  padding: 18px;
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
  background: color-mix(in srgb, var(--blue) 4%, var(--surface));
  border-color: color-mix(in srgb, var(--blue) 16%, transparent);
}
.hn-stage__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 800;
  color: var(--ink);
}
.hn-chip {
  font-size: 12px;
  font-weight: 800;
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  padding: 4px 9px;
  border-radius: var(--mk-radius-pill);
}
.hn-chip--green {
  color: var(--green-deep);
  background: color-mix(in srgb, var(--green) 12%, transparent);
}
.hn-bubble {
  font-size: 13px;
  line-height: 1.55;
  margin-bottom: 10px;
}
.hn-bubble--user {
  margin-left: auto;
  max-width: 92%;
  padding: 10px 13px;
  border-radius: 16px 16px 4px 16px;
  color: var(--text-on-primary);
  /* 用户气泡同样退掉渐变，改实心品牌蓝（主色实心化是全站口径） */
  background: var(--blue);
}
.hn-bubble--ai {
  display: flex;
  gap: 8px;
}
.hn-bubble--ai img {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  flex: 0 0 auto;
}
.hn-bubble--ai > div {
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 4px 16px 16px 16px;
  padding: 10px 13px;
  color: var(--ink);
}
.hn-bubble--ai p {
  margin: 0;
  color: var(--ink);
}
.hn-bubble--ai strong {
  color: var(--ink);
}
.hn-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.hn-tag {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  border: 1px solid var(--line);
  background: var(--surface);
  padding: 4px 9px;
  border-radius: var(--mk-radius-pill);
}
.hn-tag--on {
  color: var(--blue-deep);
  border-color: color-mix(in srgb, var(--blue) 36%, transparent);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
}
/* 下一步结果条（原型外有意增强）：配色跟 --on 卡同语言 —— 蓝 5% 实底 + 蓝 18% 描边 */
.hn-stage__result {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  padding: 14px;
  border-radius: var(--mk-radius-modal);
  background: color-mix(in srgb, var(--blue) 5%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--blue) 18%, transparent);
}
.hn-stage__result small {
  font-size: 12px;
  font-weight: 800;
  color: var(--blue-deep);
}
.hn-stage__result strong {
  font-size: 15px;
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
/* 「本阶段刚产出高热结果」的一次性提示脉冲。
   原实现是蓝色外扩光环（box-shadow 0 0 0 0→18px），已退役（批次 D）：
   环形阴影在本仓是**焦点环的专属形态**（唯一全站一圈 --mk-focus-ring），
   拿它做装饰动画等于让「键盘焦点」和「刚出了热结果」长得一样——
   两者一个可键盘到达、一个纯视觉事件，混用会污染焦点态的可辨识性。
   改为只脉冲 border-color：语义强度不变（蓝描边闪一下再退回常态），
   不产生任何投影，且不与焦点环撞形。
   终值必须与基础样式的实际 border-color 一致（.hn-stage__result 的
   color-mix(blue 18%, transparent)，不是 --line），否则动画结束会闪一下变色。 */
@keyframes hn-glow {
  0% { border-color: color-mix(in srgb, var(--blue) 55%, transparent); }
  100% { border-color: color-mix(in srgb, var(--blue) 18%, transparent); }
}
.hn-stage__from {
  margin: 0 0 5px;
  font-size: 12px;
  color: var(--faint);
}
.hn-stage__desk h3,
.hn-panel h3 {
  margin: 0 0 10px;
  font-size: 17px;
  letter-spacing: -0.02em;
}
.hn-stage__meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  margin-bottom: 10px;
}
.hn-stage__prog {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 8%, transparent);
  overflow: hidden;
  margin-bottom: 12px;
}
.hn-stage__prog i {
  display: block;
  height: 100%;
  width: var(--w, 0);
  border-radius: 999px;
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
  padding: 9px 15px;
  border-radius: var(--mk-radius-pill);
  font-size: 13px;
  font-weight: 800;
  color: var(--text-on-primary);
  /* 演示卡片里的伪按钮：主色实心化，不再用渐变 */
  background: var(--blue);
}

/* Band full-bleed：对照原型 .wf-pband（1015-1023）——卡片无 hover 位移 */
.hn-band {
  margin: 8px 0 44px;
  padding: 36px 0;
  background: var(--soft);
  border-block: 1px solid var(--line);
}
.hn-band__in {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 22px;
  align-items: center;
}
.hn-band__side {
  display: grid;
  gap: 8px;
  padding: 22px;
  border-radius: var(--mk-radius-xl);   /* 批次 D：22px（档外）→ 16px */
  background: var(--surface);
  border: 1px solid var(--line);
}
.hn-band__side--on {
  background: color-mix(in srgb, var(--blue) 5%, var(--surface));
  border-color: color-mix(in srgb, var(--blue) 18%, transparent);
}
.hn-band__side span {
  font-size: 12px;
  font-weight: 800;
  color: var(--faint);
}
.hn-band__side--on span {
  color: var(--blue-deep);
}
.hn-band__side h2 {
  margin: 0;
  font-size: clamp(20px, 2.4vw, 26px);
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.hn-band__side p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted);
}
.hn-band__arrow {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--text-on-primary);
  font-size: 20px;
  font-weight: 900;
  /* 圆形箭头徽标：品牌蓝实心化，不再用渐变 */
  background: var(--blue);
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

/* Flow：对照原型 .wf-pflow / .wf-psection / .wf-psteps（1025-1034） */
.hn-flow {
  padding: 28px 0 64px;
  scroll-margin-top: 84px;
}
.hn-section {
  max-width: 44em;
  margin-bottom: 28px;
  display: grid;
  gap: 12px;
}
.hn-section h2 {
  margin: 0;
  font-size: clamp(28px, 3.6vw, 44px);
  letter-spacing: -0.035em;
  line-height: 1.1;
  text-wrap: balance;
}
.hn-section p {
  margin: 0;
  font-size: 16px;
  line-height: 1.75;
  max-width: 34em;
  color: var(--muted);
}
.hn-flow__canvas {
  position: relative;
}
.hn-flow__svg {
  width: 100%;
  height: auto;
  display: block;
  margin-bottom: -18px;
}
.hn-flow__path {
  stroke: var(--blue);
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
  gap: 12px;
  position: relative;
  z-index: 1;
}
/* 步骤卡：对照 .wf-psteps li —— 静态卡，无 hover 位移 */
.hn-flow__grid li {
  display: grid;
  gap: 9px;
  justify-items: center;
  text-align: center;
  min-height: 196px;
  padding: 20px 14px;
  /* 批次 D：22px 圆角（档外）→ --mk-radius-xl；第四档投影 ink@6% 删除。
     步骤卡是静态卡，靠 border 分层即可。 */
  border-radius: var(--mk-radius-xl);
  background: var(--surface);
  border: 1px solid var(--line);
}
.hn-flow__grid span {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--text-on-primary);
  font-size: 14px;
  font-weight: 900;
  /* 步骤序号圆牌：品牌蓝实心化，不再用渐变 */
  background: var(--blue);
}
.hn-flow__grid strong {
  font-size: 15px;
}
.hn-flow__grid p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
  max-width: 18ch;
}
.hn-flow__grid em {
  font-style: normal;
  font-size: 12px;
  font-weight: 800;
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  padding: 4px 9px;
  border-radius: var(--mk-radius-pill);
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
  /* 批次 D：18px 圆角（档外）→ --mk-radius-xl；第四档投影 ink@8% 删除。 */
  border-radius: var(--mk-radius-xl);
  background: var(--surface);
  border: 1px solid var(--line);
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
  border-radius: var(--mk-radius-modal);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 14px;
  font-weight: 700;
}
.hn-desk__card {
  margin-top: 12px;
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
  border-radius: var(--mk-radius-modal);
  background: var(--surface);
  border: 1px solid var(--line);
}
.hn-state__metrics span {
  font-size: 12px;
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
  /* 12px 小字给深一档的绿（--green 是 5.0:1，这里 7.1:1 更稳，走查 2026-09-27） */
  color: var(--green-deep);
}
.hn-state__hint {
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
}

/* End full bleed：对照原型 .wf-pend（1036-1039） */
.hn-end {
  position: relative;
  padding: 60px 0 68px;
  background: var(--soft);
  border-top: 1px solid var(--line);
  color: var(--ink);
  overflow: hidden;
  text-align: center;
}
.hn-end__in {
  position: relative;
  z-index: 1;
  /* 原型 .wf-pend 内层是 wf-pwrap（自带 48px 视口留白），这里等价收口到 640px */
  width: min(640px, calc(100% - 48px));
  margin: 0 auto;
  display: grid;
  gap: 16px;
  justify-items: center;
}
.hn-end h2 {
  margin: 0;
  font-size: clamp(26px, 3.6vw, 44px);
  letter-spacing: -0.035em;
  line-height: 1.12;
  max-width: 18ch;
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
  background: var(--soft);
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
  padding: 7px 2px;
}
.hn-foot__links a:hover {
  color: var(--blue-deep);
}

@media (max-width: 1023px) {
  .hn-hero {
    grid-template-columns: 1fr;
    /* 原型 wf-phero ≤980：44px 上 / 40px 下 */
    padding: 44px 0 40px;
    gap: 28px;
  }
  /* 原型移动端 hero CTA：纵向堆叠、按钮 200px 左对齐（原横排两等分） */
  .hn-hero__cta {
    flex-direction: column;
    align-items: flex-start;
  }
  .hn-hero__cta .hn-btn {
    width: 200px;
    max-width: 100%;
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
    grid-template-columns: 40px 1fr;
    column-gap: 12px;
  }
  .hn-flow__grid span {
    grid-row: span 3;
  }
  /* 移动端描述允许换行（原型 .wf-psteps 未做单行截断） */
  .hn-flow__grid p {
    font-size: 13px;
    max-width: 100%;
  }
  .hn-idea__lead {
    position: static;
  }
  .hn-hero h1 br {
    display: none;
  }
}

@media (max-width: 640px) {
  .hn-shell {
    width: min(100% - 28px, 1180px);
  }
  /* 原型 wf-phero h1 = clamp(34px,5vw,58px)，390 视口落 34px（与基础档一致，保留兜底） */
  .hn-hero h1 {
    font-size: 34px;
    line-height: 1.08;
  }
}

/* ---------- 超大屏（2K/4K）：随视口放大容器与字号，避免整页缩在中间 ---------- */
/* 超大屏档（≥2000）。字号纪律见 ADMIN_VISUAL_LAYER_SPEC §7.5 与守卫规则 13：
   文本只有三个角色 token（micro 12 / body 14 / emphasis 15），档位块**只覆写 token**，
   逐个选择器写 16px / 17px / 13px 这类半档字面量正是「同一页在 1440 有 10 个字号档、
   3840 变 17 个」的根源 —— 规则 13 就是为此而设，本档原来 8 处全部在违规。
   现在改成覆写三个角色 token，一次声明让全页文本同步放大；
   展示型字号（hero h1 / 副文案）不在文本带内，保留各自的字面量。 */
@media (min-width: 2000px) {
  /* 档位文本尺度：×1.15（与 admin 的 4K 档倍率同口径） */
  --mk-fs-micro: 13.8px;
  --mk-fs-body: 16.1px;
  --mk-fs-emphasis: 17.25px;
  .hn-shell {
    width: min(1560px, calc(100% - 64px));
  }
  .hn-btn {
    min-height: 48px;
    padding: 0 20px;
  }
  .hn-btn--lg {
    min-height: 56px;
    padding: 0 28px;
  }
  /* hero 超大屏档：随新口径（基础档 64/52 + clamp(34,5vw,58)）等比放大，不再有 120px 顶部让位 */
  .hn-hero {
    grid-template-columns: minmax(0, 1fr) minmax(400px, 560px);
    gap: 72px;
    padding: 96px 0 76px;
  }
  /* 展示型字号（> emphasis × 1.15 = 19.8px）：不在文本带内，规则 13 允许 */
  .hn-hero h1 {
    font-size: clamp(58px, 4.2vw, 90px);
  }
  .hn-hero__copy > p {
    font-size: 22px;
    max-width: 34ch;
  }
  .hn-pill {
    padding: 8px 14px;
  }
  .hn-stage__chat,
  .hn-stage__desk,
  .hn-panel {
    padding: 24px;
  }
  /* 以下文本档选择器（.hn-stage__bar / .hn-bubble / .hn-stage__result strong /
     .hn-flow__grid p / .hn-idea__list p / .hn-desk__copy li 等）原先在本档
     各写一个字面量（15/16/16.5/18/19/20px）。现已删除：它们继承基础档的
     --mk-fs-* 引用，由本档顶部的三个角色 token 统一放大。
     基础档 → 本档的实际倍率随之从「各写各的」收敛为 ×1.15 一档：
       .hn-stage__bar        13 → 14.95（原 15）
       .hn-bubble            13 → 14.95（原 16）
       .hn-stage__result     15 → 17.25（原 16，**变大**）
       .hn-band__side p      14 → 16.10（原 18）
       .hn-flow__grid strong 15 → 17.25（原 19）
       .hn-flow__grid p      13 → 14.95（原 15.5）
       .hn-idea__lead p      16 → 18.40（原 19）
       .hn-idea__list strong 17 → 19.55（原 20）
       .hn-idea__list p      14 → 16.10（原 16.5）
       .hn-desk__copy li     14 → 16.10（原 16）
       .hn-desk__copy > p    16 → 18.40（原 19）
       .hn-end p             16 → 18.40（原 19）
     差异在 ±2px 内，属「从 12 个独立倍率收敛为 1 档」的必然代价 ——
     收益是这一档不再是字号孤岛。展示型（.hn-stage__desk h3 21px、
     .hn-flow__grid strong 之类 > emphasis×1.15 的）保留字面量。 */
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
  /* .hn-band__side p 的字号继承基础档 --mk-fs-body，随本档 token 放大到 16.1px */
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
  /* .hn-flow__grid strong / p 同样继承基础档 token（17.25 / 14.95） */
  .hn-idea__lead h2 {
    font-size: clamp(44px, 3vw, 64px);
    max-width: 14ch;
  }
  /* .hn-idea__lead p 继承基础档 --mk-fs-emphasis（17.25） */
  .hn-idea__lead p {
    max-width: 30ch;
  }
  .hn-idea__list article {
    padding: 26px 30px;
  }
  /* .hn-idea__list strong / p 继承基础档 token（19.55 / 16.10） */
  .hn-desk {
    gap: 64px;
  }
  .hn-desk__copy h2 {
    font-size: clamp(40px, 2.8vw, 60px);
  }
  /* .hn-desk__copy > p 继承基础档 --mk-fs-emphasis（17.25），仅保留行长约束 */
  .hn-desk__copy > p {
    max-width: 34ch;
  }
  /* .hn-desk__copy li 继承基础档 --mk-fs-body（16.10），本档只放大内边距 */
  .hn-desk__copy li {
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
  /* .hn-end p 继承基础档 --mk-fs-emphasis（17.25） */
  .hn-foot__in {
    padding: 26px 0;
  }
}
</style>
<style scoped>
/* ===== 移动端密度（2026-09-24；2026-09-30 随原型公开层口径更新）=====
   判据与用户侧一致：卡片内边距 12–18px、按钮 44–46px 档、微标签 ≥12px。
   对齐原型 .wf-pcard2 / .wf-pband__side / .wf-psteps 后：舞台卡 18×14、band 卡 22×18、
   流程卡 22×16（×5）、idea 卡 18×16（×4）；hero CTA 是 .hn-btn--lg
   （基础档 52px 高 / 26px 横向内边距 / 16px 字 → 移动端 46 / 22 / 15）。
   展示型字号（hero 的 clamp）与 18/22px 圆角是这一页的视觉语言，不动。 */
@media (max-width: 1023px) {
  .hn-stage__chat,
  .hn-stage__desk,
  .hn-panel { padding: 14px; }
  .hn-band__side { padding: 18px; }
  .hn-flow__grid li { padding: 16px 14px; }
  .hn-idea__list article { padding: 16px 18px; }
  .hn-btn--lg { min-height: 46px; padding: 0 22px; font-size: 15px; }
  .hn-chip,
  .hn-tag,
  .hn-flow__grid em,
  .hn-state__metrics span,
  .hn-stage__result small { font-size: 12px; }
}
</style>
