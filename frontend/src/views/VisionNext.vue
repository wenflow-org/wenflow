<template>
  <div class="vn">
    <header class="vn-nav" :class="{ 'vn-nav--on': scrolled || menuOpen }">
      <div class="vn-shell vn-nav__in">
        <router-link to="/" class="vn-logo" @click="closeMenu">
          <img src="/logo.png" alt="问流 WenFlow" />
        </router-link>
        <nav class="vn-nav__links" aria-label="页面导航">
          <router-link to="/">首页</router-link>
          <router-link to="/vision" class="is-on">愿景</router-link>
          <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <div class="vn-nav__acts">
          <router-link :to="secondaryPath" class="vn-btn vn-btn--ghost">{{ secondaryLabel }}</router-link>
          <router-link :to="primaryPath" class="vn-btn vn-btn--primary">{{ primaryLabel }}</router-link>
        </div>
        <button
          type="button"
          class="vn-burger"
          :class="{ 'vn-burger--open': menuOpen }"
          :aria-label="menuOpen ? '关闭菜单' : '打开菜单'"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <span /><span /><span />
        </button>
      </div>
      <Transition name="vn-drawer">
        <div v-if="menuOpen" class="vn-drawer vn-shell">
          <router-link to="/" @click="closeMenu">首页</router-link>
          <router-link to="/vision" @click="closeMenu">愿景</router-link>
          <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer" @click="closeMenu">GitHub</a>
          <router-link :to="secondaryPath" class="vn-btn vn-btn--ghost" @click="closeMenu">{{ secondaryLabel }}</router-link>
          <router-link :to="primaryPath" class="vn-btn vn-btn--primary" @click="closeMenu">{{ primaryLabel }}</router-link>
        </div>
      </Transition>
    </header>

    <main>
      <div class="vn-bg" aria-hidden="true">
        <div class="vn-orb vn-orb--a" />
        <div class="vn-orb vn-orb--b" />
        <div class="vn-grid" />
      </div>

      <!-- 时代问题 -->
      <section class="vn-hero vn-shell">
        <div class="vn-hero__copy">
          <span class="vn-pill">WHY WENFLOW</span>
          <h1>答案越来越多时，更值得练的是提问与判断。</h1>
          <p>
            如果 AI 已经能快速给出大量标准答案，人真正需要训练的，可能就不只是「记住知识」，而是定义问题、看见结构、判断取舍，并在反馈里持续修正。
          </p>
        </div>
        <aside class="vn-hero__aside">
          <span>我们相信</span>
          <strong>学习不应只从「找课」开始，而应从「把真正要解决的问题说清楚」开始。</strong>
        </aside>
      </section>

      <!-- 信念对照：少细节 -->
      <section class="vn-stand vn-shell">
        <div class="vn-stand__head" v-reveal>
          <h2>我们不想只让旧学习变得更快。</h2>
          <p>更快找到答案，不等于真正学会。问流更关心：你能不能把目标说清楚，把路径走出来，并在反馈里调整方向。</p>
        </div>
        <div class="vn-stand__grid">
          <article v-reveal>
            <h3>我们坚持</h3>
            <ul>
              <li v-for="item in holds" :key="item">{{ item }}</li>
            </ul>
          </article>
          <article v-reveal="{ delay: 120 }">
            <h3>我们不这样做</h3>
            <ul>
              <li v-for="item in avoids" :key="item">{{ item }}</li>
            </ul>
          </article>
        </div>
      </section>

      <!-- 五种能力：理念层，不绑产品字段 -->
      <section class="vn-cap vn-shell">
        <div class="vn-cap__head" v-reveal>
          <h2>更值得训练的 5 种能力</h2>
          <p>比记住答案更值得练的，是这些。</p>
        </div>
        <ol class="vn-cap__list">
          <li v-for="(item, i) in caps" :key="item.t" v-reveal="{ delay: i * 60 }">
            <span>{{ item.n }}</span>
            <div>
              <strong>{{ item.t }}</strong>
              <p>{{ item.d }}</p>
            </div>
          </li>
        </ol>
      </section>

      <!-- 与产品的关系：只一句桥，不展开实现 -->
      <section class="vn-bridge vn-shell">
        <div class="vn-bridge__box" v-reveal>
          <h2>愿景停在「为什么」。</h2>
          <p>
            产品怎么走——目标规划、路径、今日行动、学习状态——在首页能看见。
            细节仍在验证；我们先把方向说清楚。
          </p>
          <router-link to="/" class="vn-btn vn-btn--ghost">看产品怎么开始 →</router-link>
        </div>
      </section>

      <!-- 现状：诚实、短 -->
      <section class="vn-status vn-shell" v-reveal>
        <h2>它是什么阶段</h2>
        <p>
          WenFlow 目前是<strong>实验型原型</strong>：主链路已经能跑通，方向也相对清楚，但离成熟、稳定的产品还有一段路。
        </p>
        <p>
          它开源（MIT），欢迎查看、讨论和二次开发。哪怕最后证明这条路不对，至少留下了一个可以继续改的起点。
        </p>
        <div class="vn-status__links">
          <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://wenflow.org/" target="_blank" rel="noreferrer">Demo</a>
        </div>
      </section>

      <section class="vn-end">
        <div class="vn-end__glow" />
        <div class="vn-end__in" v-reveal>
          <h2>带着一个真实问题开始。</h2>
          <p>不需要先写完整计划。说出最近真正想解决的事。</p>
          <router-link :to="primaryPath" class="vn-btn vn-btn--primary vn-btn--lg">{{ primaryLabel }}</router-link>
          <router-link to="/" class="vn-end__back">← 返回首页</router-link>
        </div>
      </section>
    </main>

    <footer class="vn-foot">
      <div class="vn-shell vn-foot__in">
        <span>问流 · 从问题到学习路径</span>
        <div>
          <router-link to="/">首页</router-link>
          <router-link to="/legacy/vision">旧版愿景</router-link>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { hasUserSession } from '@/utils/api'

const scrolled = ref(false)
const menuOpen = ref(false)
const loggedIn = ref(false)

const holds = [
  '先澄清真正的问题',
  '路径适配当下的约束',
  '在对话与输出中学习',
  '通过反馈不断修正方向'
]
const avoids = [
  '只追求更快找到答案',
  '用标准题替代自己的问题',
  '把学习等同于内容消费'
]

const caps = [
  { n: '01', t: '问题定义', d: '把模糊目标变成可以探索的问题。' },
  { n: '02', t: '系统思维', d: '看见知识、场景和行动之间的结构。' },
  { n: '03', t: '判断力', d: '在信息过载中判断什么值得相信、值得继续。' },
  { n: '04', t: 'AI 协作', d: '把 AI 当成追问、反馈和推演的伙伴。' },
  { n: '05', t: '创造力', d: '在已有知识之间建立新的连接。' }
]

const primaryPath = computed(() => (loggedIn.value ? '/goal-conversation' : '/register'))
const secondaryPath = computed(() => (loggedIn.value ? '/dashboard' : '/login'))
const primaryLabel = computed(() => (loggedIn.value ? '规划新目标' : '从一个问题开始'))
const secondaryLabel = computed(() => (loggedIn.value ? '回到学习台' : '登录'))

function closeMenu() {
  menuOpen.value = false
}

watch(menuOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

function onScroll() {
  scrolled.value = window.scrollY > 20
}

function syncAuthState() {
  loggedIn.value = hasUserSession()
}

onMounted(() => {
  syncAuthState()
  window.addEventListener('storage', syncAuthState)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => {
  window.removeEventListener('storage', syncAuthState)
  window.removeEventListener('scroll', onScroll)
  document.body.style.overflow = ''
})
</script>

<style scoped>
.vn {
  --ink: #172033;
  --muted: #5b6577;
  --faint: #8492ab;
  --line: rgba(23, 32, 51, 0.08);
  --canvas: #f3f6fb;
  --blue: #3478f6;
  --blue-deep: #1f57cc;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  min-height: 100vh;
  background: var(--canvas);
  color: var(--ink);
  font-family: Inter, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  overflow-x: clip;
}

.vn-shell {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

.vn-nav {
  position: fixed;
  inset: 0 0 auto;
  z-index: 40;
  border-bottom: 1px solid transparent;
  transition: 0.24s ease;
}
.vn-nav--on {
  background: rgba(255, 255, 255, 0.88);
  border-color: var(--line);
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(18px);
}
.vn-nav__in {
  min-height: 72px;
  display: flex;
  align-items: center;
  gap: 20px;
}
.vn-logo img {
  height: 48px;
  display: block;
}
.vn-nav__links {
  display: flex;
  gap: 4px;
  flex: 1;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.66);
  border: 1px solid var(--line);
  width: fit-content;
}
.vn-nav__links a {
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  text-decoration: none;
  transition: background 0.2s var(--ease), color 0.2s var(--ease);
}
.vn-nav__links a.is-on,
.vn-nav__links a:hover {
  background: rgba(52, 120, 246, 0.08);
  color: var(--blue-deep);
}
.vn-nav__acts {
  display: flex;
  gap: 10px;
  margin-left: auto;
}
.vn-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
  border: 1px solid transparent;
  transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
  width: fit-content;
}
.vn-btn:hover {
  transform: translateY(-2px);
}
.vn-btn:active {
  transform: translateY(0) scale(0.98);
}
.vn-btn--primary {
  color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  box-shadow: 0 16px 34px rgba(52, 120, 246, 0.22);
}
.vn-btn--ghost {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.74);
  border-color: var(--line);
}
.vn-btn--lg {
  min-height: 50px;
  padding: 0 24px;
}
.vn-burger {
  display: none;
  width: 42px;
  height: 42px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
}
.vn-burger span {
  display: block;
  width: 18px;
  height: 2px;
  margin: 4px auto;
  background: var(--ink);
  border-radius: 99px;
  transition: transform 0.28s var(--ease), opacity 0.2s var(--ease);
}
.vn-burger--open span:nth-child(1) {
  transform: translateY(6px) rotate(45deg);
}
.vn-burger--open span:nth-child(2) {
  opacity: 0;
}
.vn-burger--open span:nth-child(3) {
  transform: translateY(-6px) rotate(-45deg);
}
.vn-drawer {
  display: none;
}
.vn-drawer-enter-active,
.vn-drawer-leave-active {
  transition: opacity 0.24s var(--ease), transform 0.24s var(--ease);
}
.vn-drawer-enter-from,
.vn-drawer-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.vn-bg {
  position: absolute;
  inset: 0 0 auto;
  height: 800px;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}
.vn-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.22;
}
.vn-orb--a {
  width: 480px;
  height: 480px;
  top: 60px;
  right: -140px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.34), transparent 70%);
}
.vn-orb--b {
  width: 360px;
  height: 360px;
  top: 380px;
  left: -120px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
}

@media (prefers-reduced-motion: no-preference) {
  .vn-orb--a {
    animation: vn-drift-a 24s ease-in-out infinite;
  }
  .vn-orb--b {
    animation: vn-drift-b 28s ease-in-out infinite;
  }
}
@keyframes vn-drift-a {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-32px, 26px); }
}
@keyframes vn-drift-b {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(28px, -22px); }
}
.vn-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(23, 32, 51, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(23, 32, 51, 0.035) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.7), transparent 72%);
}

main {
  position: relative;
  z-index: 1;
}

.vn-pill {
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: var(--blue-deep);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.vn-hero {
  min-height: 78dvh;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(280px, 360px);
  gap: 48px;
  align-items: center;
  padding: 120px 0 72px;
}
.vn-hero__copy {
  display: grid;
  gap: 18px;
}
.vn-hero h1 {
  margin: 0;
  font-size: clamp(34px, 5vw, 54px);
  line-height: 1.1;
  letter-spacing: -0.045em;
  max-width: 14em;
}
.vn-hero__copy > p {
  margin: 0;
  max-width: 40ch;
  font-size: 18px;
  line-height: 1.75;
  color: var(--muted);
}
.vn-hero__aside {
  display: grid;
  gap: 12px;
  padding: 28px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid var(--line);
  box-shadow: 0 28px 80px rgba(58, 101, 197, 0.12);
  backdrop-filter: blur(14px);
}
.vn-hero__aside span {
  font-size: 12px;
  font-weight: 900;
  color: var(--blue-deep);
}
.vn-hero__aside strong {
  font-size: 20px;
  line-height: 1.45;
  letter-spacing: -0.025em;
}

/* Hero 入场编排 */
@media (prefers-reduced-motion: no-preference) {
  .vn-hero .vn-pill { animation: vn-rise 0.7s var(--ease) 0.05s both; }
  .vn-hero h1 { animation: vn-rise 0.8s var(--ease) 0.14s both; }
  .vn-hero__copy > p { animation: vn-rise 0.8s var(--ease) 0.24s both; }
  .vn-hero__aside { animation: vn-rise 0.9s var(--ease) 0.36s both; }
}
@keyframes vn-rise {
  from { opacity: 0; transform: translateY(26px); }
  to { opacity: 1; transform: translateY(0); }
}

.vn-stand {
  padding: 24px 0 72px;
}
.vn-stand__head {
  max-width: 36em;
  margin-bottom: 28px;
  display: grid;
  gap: 12px;
}
.vn-stand__head h2 {
  margin: 0;
  font-size: clamp(28px, 3.8vw, 40px);
  letter-spacing: -0.04em;
  line-height: 1.12;
}
.vn-stand__head p {
  margin: 0;
  font-size: 16px;
  line-height: 1.75;
  color: var(--muted);
}
.vn-stand__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.vn-stand__grid article {
  padding: 28px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid var(--line);
  transition: transform 0.28s var(--ease), box-shadow 0.28s var(--ease);
}
.vn-stand__grid article:hover {
  transform: translateY(-3px);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
}
.vn-stand__grid h3 {
  margin: 0 0 14px;
  font-size: 13px;
  font-weight: 900;
  color: var(--blue-deep);
}
.vn-stand__grid article:last-child h3 {
  color: var(--faint);
}
.vn-stand__grid ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 10px;
  font-size: 15px;
  line-height: 1.55;
}

.vn-cap {
  padding: 40px 0 72px;
}
.vn-cap__head {
  margin-bottom: 28px;
  display: grid;
  gap: 8px;
}
.vn-cap__head h2 {
  margin: 0;
  font-size: clamp(28px, 3.8vw, 40px);
  letter-spacing: -0.04em;
}
.vn-cap__head p {
  margin: 0;
  color: var(--muted);
}
.vn-cap__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.vn-cap__list li {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 16px;
  padding: 20px 12px;
  margin: 0 -12px;
  border-top: 1px solid var(--line);
  align-items: start;
  border-radius: 12px;
  transition: background 0.25s var(--ease);
}
.vn-cap__list li:hover {
  background: rgba(255, 255, 255, 0.7);
}
.vn-cap__list li:last-child {
  border-bottom: 1px solid var(--line);
}
.vn-cap__list span {
  font-size: 13px;
  font-weight: 900;
  color: var(--blue-deep);
  padding-top: 4px;
}
.vn-cap__list strong {
  display: block;
  font-size: 18px;
  margin-bottom: 4px;
}
.vn-cap__list p {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
  line-height: 1.65;
}

.vn-bridge {
  padding: 12px 0 56px;
}
.vn-bridge__box {
  padding: 36px 40px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--line);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05);
  display: grid;
  gap: 12px;
  width: 100%;
  max-width: none;
  box-sizing: border-box;
}
.vn-bridge h2 {
  margin: 0;
  font-size: 24px;
  letter-spacing: -0.03em;
}
.vn-bridge p {
  margin: 0;
  font-size: 15px;
  line-height: 1.75;
  color: var(--muted);
}

.vn-status {
  padding: 24px 0 72px;
}
.vn-status h2 {
  margin: 0 0 14px;
  font-size: clamp(24px, 3vw, 32px);
  letter-spacing: -0.03em;
  max-width: 36em;
}
.vn-status p {
  margin: 0 0 12px;
  font-size: 16px;
  line-height: 1.8;
  color: var(--muted);
  max-width: 42em;
}
.vn-status strong {
  color: var(--ink);
}
.vn-status__links {
  display: flex;
  gap: 18px;
  margin-top: 16px;
}
.vn-status__links a {
  font-size: 14px;
  font-weight: 800;
  color: var(--blue-deep);
  text-decoration: none;
}
.vn-status__links a:hover {
  text-decoration: underline;
}

.vn-end {
  position: relative;
  padding: 88px 24px 100px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(255, 255, 255, 0.92));
  border-top: 1px solid var(--line);
  text-align: center;
  overflow: hidden;
}
.vn-end__glow {
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
.vn-end__in {
  position: relative;
  z-index: 1;
  max-width: 560px;
  margin: 0 auto;
  display: grid;
  gap: 14px;
  justify-items: center;
}
.vn-end h2 {
  margin: 0;
  font-size: clamp(28px, 4vw, 42px);
  letter-spacing: -0.04em;
  line-height: 1.12;
}
.vn-end p {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
}
.vn-end__back {
  font-size: 13px;
  font-weight: 700;
  color: var(--blue-deep);
  text-decoration: none;
}
.vn-end__back:hover {
  text-decoration: underline;
}

.vn-foot {
  border-top: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.75);
}
.vn-foot__in {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 0;
  font-size: 12.5px;
  color: var(--faint);
  font-weight: 600;
}
.vn-foot a {
  color: var(--muted);
  text-decoration: none;
  margin-left: 14px;
  font-weight: 700;
}
.vn-foot a:hover {
  color: var(--blue-deep);
}

@media (max-width: 900px) {
  .vn-hero,
  .vn-stand__grid {
    grid-template-columns: 1fr;
  }
  .vn-hero {
    min-height: auto;
    padding-top: 110px;
  }
  .vn-nav__links,
  .vn-nav__acts {
    display: none;
  }
  .vn-burger {
    display: block;
    margin-left: auto;
  }
  .vn-drawer {
    display: grid;
    gap: 8px;
    margin: 0 auto 14px;
    padding: 16px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid var(--line);
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.1);
  }
  .vn-drawer a {
    padding: 12px;
    border-radius: 12px;
    text-decoration: none;
    color: var(--ink);
    font-weight: 700;
    background: #f7faff;
  }
  .vn-drawer .vn-btn {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .vn-shell {
    width: min(100% - 28px, 1180px);
  }
}
</style>
