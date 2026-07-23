<template>
  <div class="vision-page">
    <header class="vision-header" :class="{ 'vision-header--scrolled': scrolled }">
      <div class="vision-nav-shell">
        <router-link to="/" class="vision-brand">
          <img src="/logo.png" alt="问流 WenFlow" class="vision-brand__logo" />
        </router-link>

        <nav class="vision-nav" aria-label="页面导航">
          <router-link to="/" class="vision-nav__item">首页</router-link>
          <router-link to="/vision" class="vision-nav__item vision-nav__item--active">愿景</router-link>
          <a href="https://github.com/wenflow-org/wenflow" class="vision-nav__item" target="_blank" rel="noreferrer">GitHub</a>
        </nav>

        <div class="vision-actions">
          <router-link :to="isLoggedIn ? '/dashboard' : '/login'" class="vision-cta vision-cta--ghost">{{ isLoggedIn ? '回到学习台' : '登录' }}</router-link>
          <router-link :to="isLoggedIn ? '/goal-conversation' : '/register'" class="vision-cta vision-cta--primary">从一个问题开始</router-link>
        </div>
      </div>
    </header>

    <main class="vision-main">
      <div class="vision-bg-layer">
        <div class="vision-bg-orb vision-bg-orb--1"></div>
        <div class="vision-bg-orb vision-bg-orb--2"></div>
        <div class="vision-bg-grid"></div>
      </div>

      <section class="vision-hero">
        <div class="vision-hero__copy">
          <span class="vision-kicker">WenFlow 的学习观</span>
          <h1>旧的学习方式，越来越难回应新的问题。</h1>
          <p>当 AI 已经能快速给出答案，学习更需要训练的，不只是记住内容，而是提出问题、判断方向和持续修正。</p>
        </div>
        <aside class="vision-hero__signal">
          <span>1946 → 2026</span>
          <strong>答案变多以后，问题本身变得更重要。</strong>
        </aside>
      </section>

      <section class="vision-quote-section">
        <div class="vision-quote-card">
          <span>一封旧电报，今天重新变得具体</span>
          <blockquote>“原子释放出的力量改变了一切，除了我们的思维方式。”</blockquote>
          <p>1946 年，爱因斯坦等科学家写给联合国。今天，AI 再次提醒我们：真正滞后的往往不是工具，而是人理解世界、提出问题和作出判断的方式。</p>
        </div>
      </section>

      <section class="vision-compare">
        <div class="vision-section-head">
          <h2>我们不想只让旧学习变得更快。</h2>
          <p>更快找到答案并不等于真正学会。WenFlow 更关心的是：你能不能把目标说清楚，把路径走出来，并在反馈里不断调整。</p>
        </div>

        <div class="vision-compare-grid">
          <article class="vision-compare-card vision-compare-card--muted">
            <span>旧学习逻辑</span>
            <ul>
              <li v-for="item in oldLearning" :key="item">{{ item }}</li>
            </ul>
          </article>
          <article class="vision-compare-card vision-compare-card--strong">
            <span>WenFlow 的学习观</span>
            <ul>
              <li v-for="item in wenflowLearning" :key="item">{{ item }}</li>
            </ul>
          </article>
        </div>
      </section>

      <section class="vision-problem-section">
        <div class="vision-section-head">
          <span class="vision-kicker">问题意识</span>
          <h2>真正有价值的学习，往往从自己的问题开始。</h2>
          <p>标准题训练我们找到答案；真实问题要求我们定义边界、判断取舍，并决定下一步怎么走。WenFlow 关注的是后者。</p>
        </div>

        <div class="vision-problem-grid">
          <article>
            <span>别人给的问题</span>
            <ul>
              <li>再难也有既定解法</li>
              <li>有人知道标准答案</li>
              <li>路径与材料已经准备好</li>
              <li>最终会被判对或判错</li>
            </ul>
          </article>
          <article>
            <span>你创建的问题</span>
            <ul>
              <li>没有标准答案，需要自己定义什么是好</li>
              <li>边界会不断变化和扩展</li>
              <li>没有现成路径，必须自己摸索</li>
              <li>没有终点，只有更深的理解</li>
            </ul>
          </article>
        </div>
      </section>

      <section class="vision-mindset-section">
        <div class="vision-section-head">
          <h2>真正留下来的，是思维方式。</h2>
          <p>工具会变，模型会变，界面也会变。但提出问题、组织信息、判断取舍、创造连接的能力，会一直重要。</p>
        </div>

        <div class="vision-mindset-grid">
          <article class="vision-mindset-card vision-mindset-card--strong">
            <span>思维 / 道</span>
            <ul>
              <li v-for="item in mindsetItems" :key="item.title">
                <strong>{{ item.title }}</strong>
                <p>{{ item.desc }}</p>
              </li>
            </ul>
          </article>

          <div class="vision-mindset-arrow">→</div>

          <article class="vision-mindset-card vision-mindset-card--muted">
            <span>工具 / 技</span>
            <ul>
              <li v-for="item in toolItems" :key="item.title">
                <strong>{{ item.title }}</strong>
                <p>{{ item.desc }}</p>
              </li>
            </ul>
          </article>
        </div>

        <p class="vision-mindset-note">工具越强，越需要人知道自己为什么使用它。</p>
      </section>

      <section class="vision-capability-section">
        <div class="vision-section-head vision-section-head--capabilities">
          <h2>AI 时代，更值得训练这 5 种能力。</h2>
        </div>

        <div class="vision-capability-grid">
          <article v-for="item in capabilities" :key="item.title" class="vision-capability-card">
            <span>{{ item.index }}</span>
            <strong>{{ item.title }}</strong>
            <p>{{ item.desc }}</p>
          </article>
        </div>
      </section>

      <section class="vision-why-section">
        <div class="vision-why-card">
          <div class="vision-why-intro">
            <span class="vision-kicker">WHY WENFLOW</span>
            <h2>WenFlow 不是一个终点，而是一条路。</h2>
            <p>WenFlow 是一个 AI 驱动的学习路径原型，也是一次关于未来学习方式的开源探索。</p>
          </div>

          <div class="vision-why-grid">
            <article>
              <span>为什么需要 WenFlow</span>
              <p>在 AI 已经能够回答大量标准问题的时代，真正重要的，不再只是更快获得答案，而是更清楚地提出问题，更准确地理解目标，并在持续输出与反馈中形成自己的判断。</p>
            </article>
            <article>
              <span>WenFlow 想提供什么</span>
              <p>我们相信，学习不应只是内容消费，也不应只是完成既定路径。它更应该是一种不断澄清、不断修正、不断成长的过程。</p>
            </article>
          </div>

          <div class="vision-why-manifesto">
            <p>WenFlow 不试图提供一套标准答案，而是希望留下一块可以继续探索、修改、拆解与重建的基础。</p>
            <p>如果它能帮助某个个体重新理解学习，帮助某个团队重新设计路径，或者帮助某个未来的教育产品少走一点弯路，那它就已经有意义。</p>
          </div>
        </div>
      </section>

      <section class="vision-final-cta">
        <div class="vision-final-cta__glow"></div>
        <div class="vision-final-cta__inner">
          <h2>带着一个真实问题开始。</h2>
          <p>不需要先写完整计划。说出你最近真正想解决的事，让 WenFlow 陪你把它变成下一步行动。</p>
          <router-link :to="isLoggedIn ? '/goal-conversation' : '/register'" class="vision-cta vision-cta--primary vision-cta--large">
            开始第一次目标拆解
          </router-link>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { hasUserSession } from '@/utils/api';

const scrolled = ref(false);
const isLoggedIn = ref(false);

const oldLearning = ['更快找到答案', '更快完成任务', '更快记住内容', '更快走完既定路径'];
const wenflowLearning = ['先澄清真正的问题', '生成适合当前约束的路径', '在对话和输出中学习', '通过反馈不断修正方向'];

const mindsetItems = [
  { title: '看见联系', desc: '理解知识、场景和目标之间的关系。' },
  { title: '组织结构', desc: '把混乱信息整理成可以行动的框架。' },
  { title: '判断取舍', desc: '知道什么时候继续、什么时候换路。' },
  { title: '定义问题', desc: '把模糊困惑变成值得解决的问题。' }
];

const toolItems = [
  { title: '某个语法怎么写', desc: '具体工具和语言会不断替换。' },
  { title: '某个按钮在哪里', desc: '界面变化后经验很容易失效。' },
  { title: '某道题的标准答案', desc: '适合验证，却不一定能迁移。' },
  { title: '某个技巧短期怎么用', desc: '有帮助，但不能替代判断。' }
];

const capabilities = [
  { index: '01', title: '问题定义能力', desc: '把模糊目标变成可以探索的问题。' },
  { index: '02', title: '系统思维能力', desc: '看见知识、场景和行动之间的结构。' },
  { index: '03', title: '判断力', desc: '在信息过载中判断什么值得相信、值得继续。' },
  { index: '04', title: 'AI 协作力', desc: '把 AI 当成追问、反馈和推演的伙伴。' },
  { index: '05', title: '创造力', desc: '在已有知识之间建立新的连接。' }
];

const syncAuthState = () => {
  isLoggedIn.value = hasUserSession();
};

const handleScroll = () => {
  scrolled.value = window.scrollY > 24;
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
});
</script>

<style scoped>
.vision-page {
  --vision-ink: #172033;
  --vision-muted: #66758d;
  --vision-blue: #3478f6;
  --vision-blue-deep: #1f57cc;
  min-height: 100vh;
  min-height: 100dvh;
  background: #f3f6fb;
  color: var(--vision-ink);
  overflow-x: hidden;
}

.vision-header {
  position: fixed;
  inset: 0 0 auto;
  z-index: 20;
  border-bottom: 1px solid transparent;
  transition: background 0.24s ease, border-color 0.24s ease, box-shadow 0.24s ease;
}

.vision-header--scrolled {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(23, 32, 51, 0.06);
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(18px);
}

.vision-nav-shell,
.vision-hero,
.vision-quote-section,
.vision-compare,
.vision-mindset-section,
  .vision-problem-section,
  .vision-capability-section,
  .vision-why-section {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

.vision-nav-shell,
.vision-brand,
.vision-nav,
.vision-actions,
.vision-final-cta {
  display: flex;
  align-items: center;
}

.vision-nav-shell {
  min-height: 72px;
  justify-content: space-between;
  gap: 24px;
}

.vision-brand__logo {
  height: 54px;
  display: block;
}

.vision-nav {
  gap: 8px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.66);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.vision-nav__item {
  padding: 8px 13px;
  border-radius: 999px;
  color: color-mix(in srgb, var(--vision-ink) 72%, #fff);
  text-decoration: none;
  font-size: 14px;
  font-weight: 800;
}

.vision-nav__item:hover,
.vision-nav__item--active {
  background: rgba(52, 120, 246, 0.08);
  color: var(--vision-blue-deep);
}

.vision-actions {
  gap: 10px;
}

.vision-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 999px;
  border: 1px solid transparent;
  text-decoration: none;
  font-size: 14px;
  font-weight: 900;
}

.vision-cta--primary {
  color: #fff;
  background: linear-gradient(135deg, var(--vision-blue), var(--vision-blue-deep));
  box-shadow: 0 16px 34px rgba(52, 120, 246, 0.22);
}

.vision-cta--ghost {
  color: var(--vision-ink);
  background: rgba(255, 255, 255, 0.74);
  border-color: rgba(23, 32, 51, 0.08);
}

.vision-cta--large {
  min-height: 50px;
  padding-inline: 24px;
}

.vision-main {
  position: relative;
  isolation: isolate;
}

.vision-bg-layer {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
}

.vision-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.22;
}

.vision-bg-orb--1 {
  width: 580px;
  height: 580px;
  top: 80px;
  right: -160px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.36), transparent 70%);
}

.vision-bg-orb--2 {
  width: 500px;
  height: 500px;
  top: 720px;
  left: -180px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
}

.vision-bg-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(23, 32, 51, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(23, 32, 51, 0.035) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.8), transparent 70%);
}

.vision-hero {
  min-height: 88vh;
  min-height: 88dvh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 52px;
  align-items: center;
  padding: 120px 0 72px;
}

.vision-hero__copy,
.vision-section-head,
.vision-hero__signal,
.vision-quote-card,
.vision-compare-card,
.vision-problem-grid article,
.vision-capability-card {
  display: grid;
  gap: 14px;
}

.vision-kicker {
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.09);
  color: var(--vision-blue-deep);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.vision-hero h1,
.vision-section-head h2,
.vision-final-cta h2 {
  margin: 0;
  line-height: 1.06;
  letter-spacing: -0.055em;
}

.vision-hero h1 {
  max-width: 820px;
  font-size: clamp(48px, 7vw, 86px);
}

.vision-hero p,
.vision-section-head p,
.vision-quote-card p,
.vision-compare-card li,
.vision-problem-grid li,
.vision-capability-card p,
.vision-final-cta p {
  margin: 0;
  color: var(--vision-muted);
  line-height: 1.72;
}

.vision-hero__copy > p {
  max-width: 650px;
  font-size: 18px;
}

.vision-hero__signal,
.vision-quote-card,
.vision-compare-card,
.vision-problem-grid article,
.vision-capability-card {
  padding: 26px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.05);
}

.vision-hero__signal span,
.vision-quote-card span,
.vision-compare-card span,
.vision-problem-grid span,
.vision-capability-card span {
  color: var(--vision-blue-deep);
  font-size: 12px;
  font-weight: 900;
}

.vision-hero__signal strong {
  font-size: 24px;
  line-height: 1.25;
}

.vision-quote-section,
.vision-compare,
.vision-mindset-section,
.vision-problem-section,
.vision-capability-section,
.vision-why-section {
  padding: 72px 0;
}

.vision-quote-card {
  max-width: 900px;
}

.vision-quote-card blockquote {
  margin: 0;
  font-size: clamp(30px, 4.6vw, 58px);
  line-height: 1.18;
  letter-spacing: -0.045em;
}

.vision-section-head {
  max-width: 780px;
  margin-bottom: 28px;
}

.vision-section-head--capabilities h2 {
  white-space: nowrap;
}

.vision-section-head h2,
.vision-final-cta h2 {
  font-size: clamp(34px, 5vw, 58px);
}

.vision-compare-grid,
.vision-problem-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.vision-compare-card--strong {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.84));
  border-color: rgba(52, 120, 246, 0.14);
}

.vision-compare-card ul,
.vision-problem-grid ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 10px;
}

.vision-mindset-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 70px minmax(0, 1fr);
  gap: 18px;
  align-items: center;
}

.vision-mindset-card,
.vision-why-card {
  padding: 28px;
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.05);
}

.vision-mindset-card--strong {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(255, 255, 255, 0.84));
  border-color: rgba(52, 120, 246, 0.14);
}

.vision-mindset-card span,
.vision-why-grid span {
  color: var(--vision-blue-deep);
  font-size: 12px;
  font-weight: 900;
}

.vision-mindset-card ul {
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
}

.vision-mindset-card li {
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(23, 32, 51, 0.05);
}

.vision-mindset-card strong {
  display: block;
  margin-bottom: 5px;
  font-size: 16px;
}

.vision-mindset-card p,
.vision-mindset-note,
.vision-why-card p {
  margin: 0;
  color: var(--vision-muted);
  line-height: 1.72;
}

.vision-mindset-arrow {
  width: 70px;
  height: 70px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, var(--vision-blue), var(--vision-blue-deep));
  box-shadow: 0 16px 34px rgba(52, 120, 246, 0.22);
  font-size: 30px;
  font-weight: 900;
}

.vision-mindset-note {
  margin-top: 20px;
  text-align: center;
  font-weight: 900;
  color: var(--vision-blue-deep);
}

.vision-capability-card strong {
  font-size: 17px;
}

.vision-capability-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
}

.vision-capability-card {
  grid-column: span 2;
  min-height: 176px;
  padding: 22px 20px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(246, 249, 255, 0.96), rgba(239, 244, 251, 0.92));
  border: 1px solid rgba(52, 120, 246, 0.08);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.04);
}

.vision-capability-card:nth-child(4),
.vision-capability-card:nth-child(5) {
  grid-column: span 3;
}

.vision-capability-card small {
  color: color-mix(in srgb, var(--vision-muted) 86%, white);
  font-weight: 800;
}

.vision-why-card {
  background: #172033;
  color: #fff;
  overflow: hidden;
  position: relative;
  padding: 34px;
}

.vision-why-card::before {
  content: '';
  position: absolute;
  width: 520px;
  height: 520px;
  right: -180px;
  top: -180px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.28), transparent 70%);
  filter: blur(30px);
}

.vision-why-card > * {
  position: relative;
  z-index: 1;
}

.vision-why-intro {
  display: grid;
  gap: 14px;
  max-width: 820px;
}

.vision-why-intro h2 {
  margin: 0;
  font-size: clamp(30px, 4vw, 48px);
  line-height: 1.12;
  letter-spacing: -0.045em;
}

.vision-why-card .vision-kicker {
  background: rgba(255, 255, 255, 0.1);
  color: #b9d1ff;
}

.vision-why-card p {
  color: rgba(255, 255, 255, 0.72);
}

.vision-why-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 32px;
}

.vision-why-grid article,
.vision-why-manifesto {
  padding: 20px 22px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.09);
  display: grid;
  gap: 10px;
}

.vision-why-grid span {
  color: #b9d1ff;
}

.vision-why-manifesto {
  margin-top: 16px;
  max-width: 780px;
  margin-inline: auto;
  gap: 14px;
}

.vision-why-manifesto p:first-child {
  color: rgba(255, 255, 255, 0.88);
  font-weight: 700;
}

.vision-why-manifesto p + p {
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.vision-final-cta {
  width: 100%;
  justify-content: center;
  margin-top: 54px;
  padding: 100px 24px 116px;
  border-radius: 0;
  background: #172033;
  color: #fff;
  overflow: hidden;
  position: relative;
  box-shadow: 0 30px 90px rgba(23, 32, 51, 0.18);
}

.vision-final-cta__glow {
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

.vision-final-cta__inner {
  position: relative;
  z-index: 1;
  max-width: 760px;
  margin: 0 auto;
  display: grid;
  gap: 18px;
  justify-items: center;
  text-align: center;
}

.vision-final-cta p {
  max-width: 590px;
  color: rgba(255, 255, 255, 0.72);
}

.vision-final-cta .vision-kicker {
  background: rgba(255, 255, 255, 0.1);
  color: #b9d1ff;
}

@media (max-width: 1100px) {
  .vision-actions {
    display: none;
  }

  .vision-capability-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .vision-capability-card,
  .vision-capability-card:nth-child(4),
  .vision-capability-card:nth-child(5) {
    grid-column: auto;
  }

  .vision-mindset-grid {
    grid-template-columns: 1fr;
  }

  .vision-mindset-arrow {
    justify-self: center;
    transform: rotate(90deg);
  }
}

@media (max-width: 900px) {
  .vision-hero,
  .vision-compare-grid,
  .vision-problem-grid,
  .vision-why-grid,
  .vision-why-manifesto {
    grid-template-columns: 1fr;
  }

  .vision-hero {
    min-height: auto;
    padding-top: 118px;
  }

  .vision-final-cta {
    display: grid;
  }
}

@media (max-width: 640px) {
  .vision-nav-shell,
  .vision-hero,
    .vision-quote-section,
    .vision-compare,
    .vision-mindset-section,
    .vision-problem-section,
    .vision-capability-section,
    .vision-why-section {
    width: min(100% - 28px, 1180px);
  }

  .vision-brand__logo {
    height: 46px;
  }

  .vision-nav {
    gap: 2px;
    padding: 4px;
  }

  .vision-nav__item {
    padding: 7px 9px;
    font-size: 12px;
  }

  .vision-capability-grid {
    grid-template-columns: 1fr;
  }

  .vision-quote-section,
  .vision-compare,
  .vision-mindset-section,
  .vision-problem-section,
  .vision-capability-section,
  .vision-why-section {
    padding: 52px 0;
  }

  .vision-section-head--capabilities h2 {
    white-space: normal;
  }

  .vision-why-card {
    padding: 32px;
  }

  .vision-final-cta {
    padding: 76px 20px 88px;
  }
}

@media (max-width: 480px) {
  .vision-nav-shell,
  .vision-hero,
  .vision-quote-section,
  .vision-compare,
  .vision-mindset-section,
  .vision-problem-section,
  .vision-capability-section,
  .vision-why-section {
    width: min(100% - 20px, 1180px);
  }

  .vision-hero {
    padding-bottom: calc(40px + var(--safe-area-bottom));
  }
}
</style>
