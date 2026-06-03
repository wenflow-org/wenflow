<template>
  <div class="home-page">
    <header class="site-header" :class="{ 'site-header--scrolled': scrolled }">
      <div class="site-nav-shell">
        <router-link to="/" class="site-brand" @click="closeMobileNav">
          <img src="/logo.png" alt="问流 WenFlow" class="site-brand__logo" />
        </router-link>

        <nav class="site-nav" aria-label="页面导航">
          <a href="#start" class="site-nav__item">首页</a>
          <router-link to="/vision" class="site-nav__item">愿景</router-link>
          <a href="https://github.com/wenflow-org/wenflow" class="site-nav__item" target="_blank" rel="noreferrer">GitHub</a>
        </nav>

        <div class="site-actions">
          <template v-if="isLoggedIn">
            <router-link to="/dashboard" class="site-cta site-cta--ghost">回到学习台</router-link>
            <router-link to="/goal-conversation" class="site-cta site-cta--primary">从一个问题开始</router-link>
          </template>
          <template v-else>
            <router-link to="/login" class="site-cta site-cta--ghost">登录</router-link>
            <router-link to="/register" class="site-cta site-cta--primary">从一个问题开始</router-link>
          </template>
        </div>

        <button
          type="button"
          class="mobile-menu-btn"
          :class="{ 'mobile-menu-btn--open': mobileNavOpen }"
          :aria-label="mobileNavOpen ? '关闭菜单' : '打开菜单'"
          :aria-expanded="mobileNavOpen ? 'true' : 'false'"
          aria-controls="home-mobile-nav"
          @click="toggleMobileNav"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>

      <div id="home-mobile-nav" class="mobile-nav" :class="{ 'mobile-nav--open': mobileNavOpen }">
        <a href="#start" class="mobile-nav__item" @click="closeMobileNav">首页</a>
        <router-link to="/vision" class="mobile-nav__item" @click="closeMobileNav">愿景</router-link>
        <a href="https://github.com/wenflow-org/wenflow" class="mobile-nav__item" target="_blank" rel="noreferrer" @click="closeMobileNav">GitHub</a>
        <div class="mobile-nav__actions">
          <router-link :to="isLoggedIn ? '/dashboard' : '/login'" class="site-cta site-cta--ghost" @click="closeMobileNav">{{ isLoggedIn ? '回到学习台' : '登录' }}</router-link>
          <router-link :to="primaryCtaPath" class="site-cta site-cta--primary" @click="closeMobileNav">{{ primaryCtaLabel }}</router-link>
        </div>
      </div>
    </header>

    <div
      class="home-mobile-action-bar"
      :class="{
        'home-mobile-action-bar--visible': mobileActionBarVisible,
        'home-mobile-action-bar--hidden': mobileNavOpen
      }"
      :aria-hidden="mobileActionBarVisible && !mobileNavOpen ? 'false' : 'true'"
      aria-label="移动端快捷操作"
    >
      <router-link :to="primaryCtaPath" class="home-mobile-action-bar__primary">{{ primaryCtaLabel }}</router-link>
      <router-link :to="secondaryCtaPath" class="home-mobile-action-bar__secondary">{{ secondaryCtaLabel }}</router-link>
    </div>

    <main id="start" class="home-main">
      <div class="home-bg-layer">
        <div class="home-bg-orb home-bg-orb--1"></div>
        <div class="home-bg-orb home-bg-orb--2"></div>
        <div class="home-bg-grid"></div>
      </div>

      <section class="home-hero">
        <div class="home-hero__copy">
          <span class="home-kicker">问流 WenFlow</span>
          <h1>先说清你想解决的事，再开始学习。</h1>
          <p>WenFlow 会把一个模糊目标，拆成可以马上行动的学习路径：先确认问题，再生成路线，再根据反馈继续调整。</p>
          <div class="home-hero__actions">
            <router-link :to="primaryCtaPath" class="btn btn--primary btn--lg">{{ primaryCtaLabel }}</router-link>
            <a href="#hero-example" class="btn btn--ghost">看一个示例</a>
          </div>
        </div>

        <aside id="hero-example" class="home-hero__demo" aria-label="产品演示示例">
          <div class="demo-message demo-message--user">
            <p>我想学 Python，但不知道该从哪开始。</p>
          </div>
          <div class="demo-message demo-message--assistant">
            <p>你现在更想学这门技能，还是先解决手头一个具体问题？</p>
          </div>
          <div class="demo-message demo-message--user">
            <p>先解决问题吧。我每周做 Excel 周报很花时间。</p>
          </div>

          <div class="demo-supplements" aria-label="补充条件示例">
            <span>零基础</span>
            <span>每天 1 小时</span>
            <span>两周内想先用起来</span>
          </div>

          <div class="demo-result">
            <div class="demo-result__head">
              <span class="demo-result__eyebrow">确认并生成路径</span>
              <strong>先把问题说清楚，再决定第一步怎么开始。</strong>
            </div>
            <div class="demo-result__list">
              <div class="demo-result__item">
                <strong>核心问题</strong>
                <p>先把每周 Excel 周报里最耗时间的一段自动化掉</p>
              </div>
              <div class="demo-result__item">
                <strong>阶段建议</strong>
                <div class="demo-result__hints">
                  <p>先读懂一份现有周报表</p>
                  <p>找到要保留和处理的关键列</p>
                  <p>跑通第一版自动化结果</p>
                </div>
              </div>
            </div>

            <div class="demo-result__actions" aria-hidden="true">
              <span class="demo-action demo-action--primary">确认并生成路径</span>
              <span class="demo-action">继续补充</span>
            </div>
          </div>
        </aside>
      </section>

      <section class="home-why">
        <div class="home-why__lead section-head">
          <span class="home-kicker">先从起点看</span>
          <h2 class="home-why__title">学习卡住，常常不是因为不努力。</h2>
          <p>而是目标太大、资料太多、第一步不清楚。WenFlow 先帮你把问题缩小到今天能行动的一步。</p>
        </div>
        <div class="home-compare-grid">
          <article class="compare-card compare-card--muted">
            <span>常见开始方式</span>
            <h2>先收藏课程、资料和教程。</h2>
            <p>内容越来越多，但今天该做什么仍然不清楚。</p>
          </article>
          <article class="compare-card compare-card--strong">
            <span>WenFlow 的开始方式</span>
            <h2>先说出一个真实场景。</h2>
            <p>系统会继续追问边界、基础和时间，再生成第一步。</p>
          </article>
        </div>
      </section>

      <section id="how" class="home-how">
        <div class="section-head">
          <span class="home-kicker">怎么开始</span>
          <h2>不用先想完整计划，先说一句真实需求。</h2>
        </div>
        <div class="home-flow">
          <article v-for="(step, idx) in flowSteps" :key="step.title" class="flow-card">
            <span>{{ String(idx + 1).padStart(2, '0') }}</span>
            <strong>{{ step.title }}</strong>
            <p>{{ step.desc }}</p>
          </article>
        </div>
      </section>

      <section class="home-preview">
        <div class="section-head">
          <span class="home-kicker">进入学习后</span>
          <h2>每一步，都让下一步更清楚。</h2>
        </div>
        <div class="preview-grid">
          <article v-for="item in previewCards" :key="item.title" class="preview-card">
            <span>{{ item.label }}</span>
            <strong>{{ item.title }}</strong>
            <p>{{ item.desc }}</p>
          </article>
        </div>
      </section>

      <section ref="productFlowRef" class="home-product-flow" :class="{ 'is-in-view': productFlowInView }">
        <div class="section-head home-product-flow__head">
          <span class="home-kicker">怎么运转</span>
          <h2>从一个真实问题，到一条能开始的学习路径。</h2>
          <p>它不是一次性排课，而是在目标、路径、学习和反馈之间持续流动。</p>
        </div>

        <div class="home-product-flow__canvas">
          <svg class="home-product-flow__svg" viewBox="0 0 1200 220" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <path class="home-product-flow__path home-product-flow__path--glow" d="M 60 108 C 205 36, 345 180, 490 108 C 635 36, 775 180, 920 108 C 1040 50, 1100 108, 1140 108" />
            <path class="home-product-flow__path" d="M 60 108 C 205 36, 345 180, 490 108 C 635 36, 775 180, 920 108 C 1040 50, 1100 108, 1140 108" />
            <defs>
              <linearGradient id="home-product-flow-gradient" x1="60" y1="108" x2="1140" y2="108" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#43b0d8" stop-opacity="0.28" />
                <stop offset="0.45" stop-color="#3478f6" />
                <stop offset="0.72" stop-color="#8d6bff" stop-opacity="0.8" />
                <stop offset="1" stop-color="#43b0d8" stop-opacity="0.28" />
              </linearGradient>
            </defs>
          </svg>

          <div class="home-product-flow__grid">
            <article v-for="(step, idx) in productFlowSteps" :key="step.title" class="product-flow-card" :style="{ '--flow-index': idx }">
              <span>{{ idx + 1 }}</span>
              <strong>{{ step.title }}</strong>
              <p>{{ step.desc }}</p>
            </article>
          </div>
        </div>
      </section>

      <section class="home-capabilities">
        <h2>不只是听懂一节课，而是能在自己的场景里用出来。</h2>
        <div class="capability-list">
          <span v-for="item in capabilityTags" :key="item">{{ item }}</span>
        </div>
      </section>

      <section class="home-final-band">
        <div class="home-final-band__glow"></div>
        <div class="home-final-band__inner">
          <h2 class="home-final-band__title">先体验一次完整学习闭环。</h2>
          <p>从一个模糊目标开始，看看问流如何帮你澄清、规划，并进入真正的学习过程。</p>
          <div class="home-final-band__actions">
            <router-link :to="primaryCtaPath" class="btn btn--primary btn--lg">{{ footerCtaLabel }}</router-link>
            <router-link to="/vision" class="btn btn--ghost btn--ghost-light">查看愿景</router-link>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const scrolled = ref(false);
const mobileNavOpen = ref(false);
const isLoggedIn = ref(false);
const mobileActionBarVisible = ref(false);
const productFlowRef = ref<HTMLElement | null>(null);
const productFlowInView = ref(false);
let productFlowObserver: IntersectionObserver | null = null;

const flowSteps = [
  { title: '先说出真实场景', desc: '不用整理成学习目标，先说最近卡在哪里、想做到什么。' },
  { title: '一起缩小范围', desc: '确认基础、时间和限制，把目标压到今天可以开始。' },
  { title: '生成第一版路径', desc: '先得到一条可执行路线，后面可以随着学习继续调整。' },
  { title: '边学边确认', desc: '通过对话、练习和复盘，确认你能不能在自己的场景里用出来。' }
];

const previewCards = [
  { label: '目标规划', title: '把“我想学 Python”变成“先完成一个 Excel 自动化任务”。', desc: '把模糊目标先压缩成一个可以开始的真实任务。' },
  { label: '学习路径', title: '不一次塞满所有内容，而是按阶段给出最小任务。', desc: '先把今天该做什么说清楚，再继续往后展开。' },
  { label: '课后总结', title: '每次学习后，整理掌握点、卡点和下一步。', desc: '每学完一段，就把进展和下一步收口清楚。' }
];

const productFlowSteps = [
  { title: '说出问题', desc: '从最近真正卡住的事开始，不用一开始就说得很完整。' },
  { title: '澄清目标', desc: '补齐场景、基础、时间和限制，把问题缩小到能行动的范围。' },
  { title: '生成路径', desc: '把目标拆成阶段、任务和今天就能开始的学习节奏。' },
  { title: '边学边做', desc: '围绕真实问题推进，在解释、练习和输出中巩固理解。' },
  { title: '复盘调整', desc: '根据掌握情况、卡点和反馈，决定下一步怎么调整。' }
];

const capabilityTags = ['问题定义', '拆解目标', '对话学习', '输出检验', '节奏调整'];

const primaryCtaPath = computed(() => (isLoggedIn.value ? '/goal-conversation' : '/register'));
const secondaryCtaPath = computed(() => (isLoggedIn.value ? '/dashboard' : '/login'));
const primaryCtaLabel = '从一个问题开始';
const secondaryCtaLabel = computed(() => (isLoggedIn.value ? '回到学习台' : '先登录'));
const footerCtaLabel = '从一个问题开始';

const syncAuthState = () => {
  isLoggedIn.value = Boolean(localStorage.getItem('token'));
};

const handleScroll = () => {
  scrolled.value = window.scrollY > 24;
  mobileActionBarVisible.value = window.innerWidth <= 640 && window.scrollY > 360;
};

const toggleMobileNav = () => {
  mobileNavOpen.value = !mobileNavOpen.value;
  document.body.style.overflow = mobileNavOpen.value ? 'hidden' : '';
};

const closeMobileNav = () => {
  mobileNavOpen.value = false;
  document.body.style.overflow = '';
};

const setupProductFlowObserver = () => {
  productFlowObserver?.disconnect();

  if (!productFlowRef.value) return;

  productFlowObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          productFlowInView.value = true;
          productFlowObserver?.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.28 }
  );

  productFlowObserver.observe(productFlowRef.value);
};

onMounted(() => {
  syncAuthState();
  window.addEventListener('storage', syncAuthState);
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
  setupProductFlowObserver();
});

onUnmounted(() => {
  window.removeEventListener('storage', syncAuthState);
  window.removeEventListener('scroll', handleScroll);
  productFlowObserver?.disconnect();
  document.body.style.overflow = '';
});
</script>

<style scoped>
.home-page {
  --home-ink: #172033;
  --home-muted: #66758d;
  --home-line: rgba(23, 32, 51, 0.08);
  --home-blue: #3478f6;
  --home-blue-deep: #1f57cc;
  min-height: 100vh;
  min-height: 100dvh;
  background: #f3f6fb;
  color: var(--home-ink);
  overflow-x: hidden;
}

.site-header {
  position: fixed;
  inset: 0 0 auto;
  z-index: 20;
  border-bottom: 1px solid transparent;
  transition: background 0.24s ease, border-color 0.24s ease, box-shadow 0.24s ease;
}

.site-header--scrolled {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(23, 32, 51, 0.06);
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(18px);
}

.site-nav-shell {
  width: min(1180px, calc(100% - 48px));
  min-height: 72px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.site-brand,
.site-nav,
.site-actions,
.home-hero__actions,
.mobile-nav__actions {
  display: flex;
  align-items: center;
}

.site-brand__logo {
  height: 54px;
  width: auto;
  display: block;
}

.site-nav {
  gap: 8px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.66);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.site-nav__item,
.mobile-nav__item {
  color: color-mix(in srgb, var(--home-ink) 72%, #fff);
  text-decoration: none;
  font-size: 14px;
  font-weight: 700;
}

.site-nav__item {
  padding: 8px 13px;
  border-radius: 999px;
}

.site-nav__item:hover {
  background: rgba(52, 120, 246, 0.08);
  color: var(--home-blue-deep);
}

.site-actions {
  gap: 10px;
}

.site-cta,
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid transparent;
  text-decoration: none;
  font-size: 14px;
  font-weight: 800;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.site-cta--primary,
.btn--primary {
  color: #fff;
  background: linear-gradient(135deg, var(--home-blue), var(--home-blue-deep));
  box-shadow: 0 16px 34px rgba(52, 120, 246, 0.22);
}

.site-cta--ghost,
.btn--ghost {
  color: var(--home-ink);
  background: rgba(255, 255, 255, 0.74);
  border-color: rgba(23, 32, 51, 0.08);
}

.site-cta:hover,
.btn:hover {
  transform: translateY(-2px);
}

.btn--lg {
  min-height: 50px;
  padding-inline: 24px;
}

.mobile-menu-btn {
  display: none;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.76);
}

.mobile-menu-btn span {
  display: block;
  width: 18px;
  height: 2px;
  margin: 4px auto;
  background: var(--home-ink);
  border-radius: 999px;
  transform-origin: center;
  transition: transform 0.22s ease, opacity 0.22s ease;
}

.mobile-menu-btn--open span:nth-child(1) {
  transform: translateY(6px) rotate(45deg);
}

.mobile-menu-btn--open span:nth-child(2) {
  opacity: 0;
}

.mobile-menu-btn--open span:nth-child(3) {
  transform: translateY(-6px) rotate(-45deg);
}

.mobile-nav {
  display: none;
}

.home-mobile-action-bar {
  display: none;
}

.home-mobile-action-bar--visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.home-mobile-action-bar--hidden {
  opacity: 0;
  transform: translateY(18px);
  pointer-events: none;
}

.home-main {
  position: relative;
  isolation: isolate;
}

.home-bg-layer {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
}

.home-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.24;
}

.home-bg-orb--1 {
  width: 560px;
  height: 560px;
  top: 90px;
  right: -160px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.36), transparent 70%);
}

.home-bg-orb--2 {
  width: 460px;
  height: 460px;
  top: 620px;
  left: -160px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.22), transparent 70%);
}

.home-bg-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(23, 32, 51, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(23, 32, 51, 0.035) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.8), transparent 68%);
}

.home-hero,
.home-why,
.home-how,
.home-preview,
.home-product-flow,
.home-capabilities {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

.home-hero {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 430px;
  gap: 52px;
  align-items: center;
  padding: 120px 0 72px;
}

.home-hero__copy,
.section-head,
.home-final-cta > div {
  display: grid;
  gap: 14px;
}

.home-kicker {
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: var(--home-blue-deep);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.home-hero h1,
.section-head h2,
.home-capabilities h2,
.home-final-cta h2 {
  margin: 0;
  letter-spacing: -0.055em;
  line-height: 1.06;
}

.home-hero h1 {
  max-width: 760px;
  font-size: clamp(48px, 7vw, 88px);
}

.home-hero__copy p,
.section-head p,
.compare-card p,
.flow-card p,
.preview-card p,
.home-final-cta p {
  margin: 0;
  color: var(--home-muted);
  line-height: 1.75;
}

.home-hero__copy > p {
  max-width: 700px;
  font-size: 18px;
}

.home-hero__actions {
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.home-hero__demo {
  position: relative;
  display: grid;
  gap: 14px;
  padding: 24px;
  border-radius: 34px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 30px 90px rgba(58, 101, 197, 0.15);
  backdrop-filter: blur(16px);
}

.demo-message,
.demo-result {
  display: grid;
  gap: 8px;
  padding: 18px;
  border-radius: 24px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: linear-gradient(180deg, rgba(248, 251, 255, 0.98), rgba(243, 247, 253, 0.92));
}

.demo-message {
  max-width: 84%;
}

.demo-message--assistant {
  justify-self: start;
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.12), rgba(255, 255, 255, 0.96));
  border-color: rgba(52, 120, 246, 0.16);
}

.demo-message--user {
  justify-self: end;
  background: rgba(248, 251, 255, 0.98);
}

.demo-message p,
.demo-result__item p {
  margin: 0;
  color: var(--home-ink);
  font-size: 15px;
  line-height: 1.65;
}

.demo-supplements {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-inline: 6px;
}

.demo-supplements span {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(52, 120, 246, 0.14);
  color: var(--home-blue-deep);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
}

.demo-result {
  display: grid;
  gap: 14px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.12), rgba(255, 255, 255, 0.96));
  border: 1px solid rgba(52, 120, 246, 0.12);
}

.demo-result__head {
  display: grid;
  gap: 6px;
}

.demo-result__head strong {
  font-size: 18px;
  line-height: 1.35;
  letter-spacing: -0.03em;
}

.demo-result__eyebrow,
.compare-card span,
.preview-card span,
.flow-card span {
  color: var(--home-muted);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.demo-result__list {
  display: grid;
  gap: 12px;
}

.demo-result__item {
  display: grid;
  gap: 4px;
}

.demo-result__hints {
  display: grid;
  gap: 6px;
}

.demo-result__item + .demo-result__item {
  padding-top: 12px;
  border-top: 1px solid rgba(23, 32, 51, 0.08);
}

.demo-result__item strong {
  color: var(--home-blue-deep);
  font-size: 14px;
}

.demo-result__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 6px;
}

.demo-action {
  min-height: 40px;
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.88);
  color: var(--home-ink);
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
}

.demo-action--primary {
  border-color: rgba(52, 120, 246, 0.18);
  background: linear-gradient(135deg, var(--home-blue), var(--home-blue-deep));
  box-shadow: 0 14px 26px rgba(52, 120, 246, 0.22);
  color: #fff;
}

.home-why,
.home-how,
.home-preview,
.home-product-flow,
.home-capabilities {
  padding: 76px 0;
}

.home-why__lead {
  max-width: 780px;
}

.home-why__title {
  white-space: nowrap;
}

.home-why__lead p {
  max-width: 700px;
  font-size: 18px;
}

.home-compare-grid,
.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.compare-card,
.preview-card,
.flow-card {
  display: grid;
  gap: 12px;
  padding: 26px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.compare-card--strong {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.84));
  border-color: rgba(52, 120, 246, 0.14);
}

.compare-card h2 {
  margin: 0;
  font-size: 28px;
  letter-spacing: -0.035em;
}

.section-head {
  max-width: 720px;
  margin-bottom: 28px;
}

.section-head h2,
.home-capabilities h2,
.home-final-cta h2 {
  font-size: clamp(34px, 5vw, 58px);
}

.home-flow {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.flow-card strong,
.preview-card strong {
  font-size: 18px;
}

.preview-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.home-product-flow__head {
  max-width: 760px;
  margin-bottom: 32px;
}

.home-product-flow__canvas {
  position: relative;
  max-width: 1120px;
  margin: 0 auto;
  padding-top: 6px;
}

.home-product-flow__svg {
  width: 100%;
  height: auto;
  display: block;
}

.home-product-flow__path {
  stroke: url(#home-product-flow-gradient);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 1900;
  stroke-dashoffset: 1900;
  filter: drop-shadow(0 14px 22px rgba(52, 120, 246, 0.2));
  transition: stroke-dashoffset 1.8s cubic-bezier(0.22, 1, 0.36, 1);
}

.home-product-flow__path--glow {
  stroke: rgba(52, 120, 246, 0.16);
  stroke-width: 18;
  filter: blur(8px);
}

.home-product-flow.is-in-view .home-product-flow__path {
  stroke-dashoffset: 0;
}

.home-product-flow__grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 18px;
  margin-top: -54px;
  position: relative;
  z-index: 2;
}

.product-flow-card {
  display: grid;
  gap: 12px;
  justify-items: center;
  text-align: center;
  min-height: 220px;
  padding: 24px 22px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.06);
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.5s ease, transform 0.5s ease;
  transition-delay: calc(var(--flow-index) * 130ms + 520ms);
}

.home-product-flow.is-in-view .product-flow-card {
  opacity: 1;
  transform: translateY(0);
}

.product-flow-card span {
  width: 46px;
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--home-blue), var(--home-blue-deep));
  box-shadow: 0 14px 26px rgba(52, 120, 246, 0.2);
  color: #fff;
  font-size: 14px;
  font-weight: 900;
}

.product-flow-card strong {
  font-size: 18px;
}

.product-flow-card p {
  margin: 0;
  max-width: 190px;
  color: var(--home-muted);
  line-height: 1.75;
}

.home-capabilities {
  display: grid;
  gap: 28px;
  text-align: center;
}

.home-capabilities h2 {
  max-width: 850px;
  margin-inline: auto;
}

.capability-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.capability-list span {
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(23, 32, 51, 0.06);
  color: color-mix(in srgb, var(--home-ink) 74%, #fff);
  font-size: 14px;
  font-weight: 800;
}

.home-final-band {
  position: relative;
  margin-top: 60px;
  padding: 104px 24px 118px;
  background: #121b2d;
  color: #fff;
  overflow: hidden;
}

.home-final-band__glow {
  position: absolute;
  inset: auto 50% -220px auto;
  width: 620px;
  height: 360px;
  transform: translateX(50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.28), transparent 68%);
  filter: blur(45px);
  pointer-events: none;
}

.home-final-band__inner {
  position: relative;
  z-index: 1;
  max-width: 760px;
  margin: 0 auto;
  display: grid;
  gap: 18px;
  justify-items: center;
  text-align: center;
}

.home-final-band h2 {
  margin: 0;
  font-size: clamp(40px, 5.4vw, 68px);
  line-height: 1.08;
  letter-spacing: -0.055em;
}

.home-final-band__title {
  white-space: nowrap;
}

.home-final-band p {
  max-width: 580px;
  margin: 0;
  color: rgba(255, 255, 255, 0.68);
  font-size: 17px;
  line-height: 1.75;
}

.home-final-band__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 10px;
}

.btn--ghost-light {
  color: #172033;
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(255, 255, 255, 0.2);
}

@media (max-width: 980px) {
  .site-nav,
  .site-actions {
    display: none;
  }

  .site-header {
    background: rgba(243, 246, 251, 0.8);
    backdrop-filter: blur(16px);
  }

  .site-nav-shell {
    width: min(100% - 28px, 1180px);
    min-height: 68px;
    gap: 16px;
  }

  .mobile-menu-btn {
    display: block;
    flex-shrink: 0;
  }

  .mobile-nav--open {
    display: grid;
    gap: 10px;
    width: min(100% - 28px, 1180px);
    margin: 0 auto 14px;
    padding: 18px;
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(23, 32, 51, 0.08);
    box-shadow: 0 22px 60px rgba(15, 23, 42, 0.1);
  }

  .mobile-nav__item {
    padding: 13px 14px;
    border-radius: 16px;
    background: rgba(248, 251, 255, 0.86);
    border: 1px solid rgba(23, 32, 51, 0.04);
  }

  .mobile-nav__actions {
    gap: 10px;
    flex-wrap: wrap;
  }

  .home-hero {
    grid-template-columns: 1fr;
    min-height: auto;
    gap: 32px;
    padding-top: 104px;
    padding-bottom: 48px;
  }

  .home-hero__demo {
    max-width: 620px;
  }

  .home-flow,
  .home-product-flow__grid,
  .preview-grid,
  .home-compare-grid {
    grid-template-columns: 1fr;
  }

  .home-product-flow__svg {
    display: none;
  }

  .home-product-flow__grid {
    margin-top: 0;
  }

  .product-flow-card {
    opacity: 1;
    transform: none;
    min-height: auto;
  }

  .home-final-band {
    margin-top: 36px;
    padding: 84px 20px 96px;
  }
}

@media (max-width: 640px) {
  .site-nav-shell,
  .home-hero,
  .home-why,
  .home-how,
  .home-preview,
  .home-product-flow,
  .home-capabilities {
    width: min(100% - 28px, 1180px);
  }

  .home-mobile-action-bar {
    position: fixed;
    inset: auto 14px calc(14px + var(--safe-area-bottom)) 14px;
    z-index: 22;
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
    gap: 10px;
    padding: 10px;
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(23, 32, 51, 0.08);
    box-shadow: 0 24px 52px rgba(15, 23, 42, 0.16);
    backdrop-filter: blur(18px);
    opacity: 0;
    transform: translateY(18px);
    pointer-events: none;
    transition: opacity 0.22s ease, transform 0.22s ease;
  }

  .home-mobile-action-bar__primary,
  .home-mobile-action-bar__secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 16px;
    border-radius: 16px;
    text-decoration: none;
    font-size: 14px;
    font-weight: 800;
  }

  .home-mobile-action-bar__primary {
    color: #fff;
    background: linear-gradient(135deg, var(--home-blue), var(--home-blue-deep));
    box-shadow: 0 14px 28px rgba(52, 120, 246, 0.24);
  }

  .home-mobile-action-bar__secondary {
    color: var(--home-ink);
    background: rgba(244, 247, 252, 0.96);
    border: 1px solid rgba(23, 32, 51, 0.08);
  }

  .site-brand__logo {
    height: 46px;
  }

  .home-hero h1 {
    font-size: clamp(34px, 13vw, 54px);
    line-height: 1.02;
    letter-spacing: -0.045em;
  }

  .home-hero__copy {
    gap: 12px;
  }

  .home-hero__copy > p,
  .home-why__lead p,
  .home-final-band p {
    font-size: 16px;
    line-height: 1.65;
  }

  .home-why,
  .home-how,
  .home-preview,
  .home-capabilities,
  .home-product-flow {
    padding: 52px 0;
  }

  .section-head {
    margin-bottom: 22px;
  }

  .section-head h2,
  .home-capabilities h2,
  .home-final-band h2 {
    font-size: clamp(28px, 9vw, 40px);
    line-height: 1.08;
    letter-spacing: -0.035em;
  }

  .home-hero__actions,
  .mobile-nav__actions,
  .home-final-band__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .home-hero__actions {
    margin-top: 4px;
  }

  .btn--lg {
    min-height: 52px;
  }

  .home-hero__demo {
    gap: 12px;
    padding: 18px;
    border-radius: 26px;
  }

  .home-hero__demo::before {
    top: -12px;
    left: 18px;
  }

  .demo-message,
  .demo-result {
    padding: 14px;
    border-radius: 18px;
  }

  .demo-message {
    max-width: 100%;
  }

  .demo-message--assistant,
  .demo-message--user {
    justify-self: stretch;
  }

  .demo-message p,
  .demo-result__item p {
    font-size: 14px;
    line-height: 1.55;
  }

  .demo-result__head strong {
    font-size: 16px;
  }

  .demo-result__actions {
    display: none;
  }

  .compare-card,
  .preview-card,
  .flow-card,
  .product-flow-card {
    gap: 10px;
    padding: 20px 18px;
    border-radius: 22px;
  }

  .compare-card h2 {
    font-size: 23px;
    line-height: 1.18;
  }

  .flow-card {
    grid-template-columns: auto 1fr;
    align-items: start;
    column-gap: 14px;
  }

  .flow-card span {
    min-width: 34px;
    padding-top: 2px;
  }

  .flow-card strong,
  .preview-card strong,
  .product-flow-card strong {
    font-size: 17px;
  }

  .product-flow-card {
    justify-items: start;
    text-align: left;
    grid-template-columns: auto 1fr;
    column-gap: 14px;
  }

  .product-flow-card span {
    width: 40px;
    height: 40px;
  }

  .product-flow-card strong,
  .product-flow-card p {
    max-width: none;
  }

  .capability-list {
    justify-content: flex-start;
  }

  .capability-list span {
    padding: 10px 12px;
    font-size: 13px;
  }

  .home-final-band__title {
    white-space: normal;
  }

  .home-why__title {
    white-space: normal;
  }

  .btn,
  .site-cta {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .site-nav-shell,
  .home-hero,
  .home-why,
  .home-how,
  .home-preview,
  .home-product-flow,
  .home-capabilities {
    width: min(100% - 20px, 1180px);
  }

  .home-hero {
    min-height: auto;
    padding-top: 96px;
    padding-bottom: calc(108px + var(--safe-area-bottom));
  }

  .home-bg-orb--1 {
    width: 320px;
    height: 320px;
    top: 88px;
    right: -120px;
  }

  .home-bg-orb--2 {
    width: 280px;
    height: 280px;
    top: 520px;
    left: -110px;
  }

  .home-kicker {
    font-size: 11px;
  }

  .home-hero__copy > p {
    max-width: 32ch;
  }

  .demo-supplements {
    padding-inline: 0;
  }

  .home-mobile-action-bar {
    inset-inline: 10px;
    grid-template-columns: 1fr;
  }

  .home-mobile-action-bar__primary,
  .home-mobile-action-bar__secondary {
    min-height: 46px;
  }

  .home-final-band {
    padding: 72px 18px 92px;
  }
}
</style>
