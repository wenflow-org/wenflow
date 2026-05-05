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
            <router-link to="/goal-conversation" class="site-cta site-cta--primary">新建目标规划</router-link>
          </template>
          <template v-else>
            <router-link to="/login" class="site-cta site-cta--ghost">登录</router-link>
            <router-link to="/register" class="site-cta site-cta--primary">开始规划我的目标</router-link>
          </template>
        </div>

        <button type="button" class="mobile-menu-btn" :aria-label="mobileNavOpen ? '关闭菜单' : '打开菜单'" @click="toggleMobileNav">
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>

      <div class="mobile-nav" :class="{ 'mobile-nav--open': mobileNavOpen }">
        <a href="#start" class="mobile-nav__item" @click="closeMobileNav">首页</a>
        <router-link to="/vision" class="mobile-nav__item" @click="closeMobileNav">愿景</router-link>
        <a href="https://github.com/wenflow-org/wenflow" class="mobile-nav__item" target="_blank" rel="noreferrer" @click="closeMobileNav">GitHub</a>
        <div class="mobile-nav__actions">
          <router-link :to="isLoggedIn ? '/dashboard' : '/login'" class="site-cta site-cta--ghost" @click="closeMobileNav">{{ isLoggedIn ? '回到学习台' : '登录' }}</router-link>
          <router-link :to="primaryCtaPath" class="site-cta site-cta--primary" @click="closeMobileNav">{{ primaryCtaLabel }}</router-link>
        </div>
      </div>
    </header>

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
          <p>问流会陪你把模糊目标拆成第一步：该学什么、先做什么、什么时候算真的会了。</p>
          <div class="home-hero__actions">
            <router-link :to="primaryCtaPath" class="btn btn--primary btn--lg">{{ primaryCtaLabel }}</router-link>
            <a href="#how" class="btn btn--ghost">先看看怎么开始</a>
          </div>
        </div>

        <aside class="home-hero__scene" aria-label="目标澄清示例">
          <div class="scene-turn scene-turn--user">我想学 Python，但不知道从哪里开始。</div>
          <div class="scene-turn scene-turn--ai">先不急着选课。你最近最想用它解决什么？</div>
          <div class="scene-turn scene-turn--user">每周 Excel 周报太耗时间，我想先自动化一部分。</div>
          <div class="scene-outcome">
            <span>可以开始的目标</span>
            <strong>用 Python 自动化一段周报流程</strong>
            <small>下一步：生成第一版学习路径</small>
          </div>
        </aside>
      </section>

      <section class="home-why">
        <div class="home-why__lead">
          <p>很多学习卡住，不是因为你不努力，而是因为一开始的问题太大、太泛、离真实场景太远。</p>
        </div>
        <div class="home-compare-grid">
          <article class="compare-card compare-card--muted">
            <span>常见开始方式</span>
            <h2>先找课程和资料</h2>
            <p>内容很多，但你还是不知道今天先做哪一步，也很难判断自己是不是真的会了。</p>
          </article>
          <article class="compare-card compare-card--strong">
            <span>问流的开始方式</span>
            <h2>先把目标缩小到能行动</h2>
            <p>从你真实想解决的事出发，确认基础、时间和场景，再拆出可以完成的第一步。</p>
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
          <h2>每一步都要帮你决定下一步。</h2>
        </div>
        <div class="preview-grid">
          <article v-for="item in previewCards" :key="item.title" class="preview-card">
            <span>{{ item.label }}</span>
            <strong>{{ item.title }}</strong>
            <p>{{ item.desc }}</p>
          </article>
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
          <h2>先体验一次完整学习闭环。</h2>
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

const flowSteps = [
  { title: '先说出真实场景', desc: '不用整理成学习目标，先说最近卡在哪里、想做到什么。' },
  { title: '一起缩小范围', desc: '确认基础、时间和限制，把目标压到今天可以开始。' },
  { title: '生成第一版路径', desc: '先得到一条可执行路线，后面可以随着学习继续调整。' },
  { title: '边学边确认', desc: '通过对话、练习和复盘，确认你能不能在自己的场景里用出来。' }
];

const previewCards = [
  { label: '目标规划', title: '从一句话到第一步', desc: '把“我想学 Python”变成“先自动化一段周报流程”。' },
  { label: '学习路径', title: '知道今天做什么', desc: '路径不会一次塞满所有内容，而是按阶段给出最小任务。' },
  { label: '课后总结', title: '学完知道哪里还不稳', desc: '每次学习结束后，收口本节掌握、卡点和下一步动作。' }
];

const capabilityTags = ['问题定义', '拆解目标', '对话学习', '输出检验', '节奏调整'];

const primaryCtaPath = computed(() => (isLoggedIn.value ? '/goal-conversation' : '/register'));
const primaryCtaLabel = computed(() => (isLoggedIn.value ? '新建目标规划' : '开始规划我的目标'));
const footerCtaLabel = computed(() => (isLoggedIn.value ? '继续规划一个新目标' : '开始第一次目标规划'));

const syncAuthState = () => {
  isLoggedIn.value = Boolean(localStorage.getItem('token'));
};

const handleScroll = () => {
  scrolled.value = window.scrollY > 24;
};

const toggleMobileNav = () => {
  mobileNavOpen.value = !mobileNavOpen.value;
  document.body.style.overflow = mobileNavOpen.value ? 'hidden' : '';
};

const closeMobileNav = () => {
  mobileNavOpen.value = false;
  document.body.style.overflow = '';
};

onMounted(() => {
  syncAuthState();
  window.addEventListener('storage', syncAuthState);
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
});

onUnmounted(() => {
  window.removeEventListener('storage', syncAuthState);
  window.removeEventListener('scroll', handleScroll);
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
}

.mobile-nav {
  display: none;
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
.home-capabilities {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

.home-hero {
  min-height: 100vh;
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
  max-width: 620px;
  font-size: 18px;
}

.home-hero__actions {
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.home-hero__scene {
  position: relative;
  display: grid;
  gap: 14px;
  padding: 24px;
  border-radius: 34px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 30px 90px rgba(58, 101, 197, 0.15);
  backdrop-filter: blur(16px);
}

.scene-turn {
  width: fit-content;
  max-width: 86%;
  padding: 14px 16px;
  border-radius: 20px;
  font-size: 14px;
  line-height: 1.55;
}

.scene-turn--user {
  justify-self: end;
  background: rgba(52, 120, 246, 0.1);
  color: var(--home-blue-deep);
}

.scene-turn--ai {
  justify-self: start;
  background: #f2f5fb;
}

.scene-outcome {
  display: grid;
  gap: 8px;
  margin-top: 6px;
  padding: 18px;
  border-radius: 22px;
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.1), rgba(255, 255, 255, 0.9));
  border: 1px solid rgba(52, 120, 246, 0.12);
}

.scene-outcome span,
.scene-outcome small,
.compare-card span,
.preview-card span,
.flow-card span {
  color: var(--home-muted);
  font-size: 12px;
  font-weight: 800;
}

.scene-outcome strong {
  font-size: 20px;
}

.home-why,
.home-how,
.home-preview,
.home-capabilities {
  padding: 76px 0;
}

.home-why__lead {
  max-width: 780px;
  margin-bottom: 28px;
}

.home-why__lead p {
  margin: 0;
  font-size: clamp(28px, 4vw, 48px);
  line-height: 1.2;
  letter-spacing: -0.045em;
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

  .mobile-menu-btn {
    display: block;
  }

  .mobile-nav--open {
    display: grid;
    gap: 10px;
    width: calc(100% - 32px);
    margin: 0 auto 12px;
    padding: 16px;
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid rgba(23, 32, 51, 0.08);
    box-shadow: 0 22px 60px rgba(15, 23, 42, 0.1);
  }

  .mobile-nav__item {
    padding: 11px 12px;
    border-radius: 14px;
  }

  .mobile-nav__actions {
    gap: 10px;
    flex-wrap: wrap;
  }

  .home-hero {
    grid-template-columns: 1fr;
    min-height: auto;
    padding-top: 118px;
  }

  .home-hero__scene {
    max-width: 560px;
  }

  .home-flow,
  .preview-grid,
  .home-compare-grid {
    grid-template-columns: 1fr;
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
  .home-capabilities {
    width: min(100% - 28px, 1180px);
  }

  .site-brand__logo {
    height: 46px;
  }

  .home-hero h1 {
    font-size: clamp(40px, 14vw, 64px);
  }

  .home-why,
  .home-how,
  .home-preview,
  .home-capabilities {
    padding: 52px 0;
  }

  .home-hero__actions,
  .mobile-nav__actions,
  .home-final-band__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .btn,
  .site-cta {
    width: 100%;
  }
}
</style>
