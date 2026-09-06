<template>
  <div class="vn">
    <MarketingNav :logged-in="loggedIn" />

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
            AI 能快速给出标准答案时，人更值得练的不只是记住知识，而是定义问题、看见结构、判断取舍，并在反馈里持续修正。
          </p>
        </div>
        <aside class="vn-hero__aside">
          <span class="vn-hero__quote" aria-hidden="true">“</span>
          <span>我们相信</span>
          <strong>学习不应只从「找课」开始，而应从「把真正要解决的问题说清楚」开始。</strong>
          <span class="vn-hero__seal">
            <i /><i /><i />
            <em>问题 → 路径 → 学习 → 反馈</em>
          </span>
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
          <h2>愿景只回答「为什么」。</h2>
          <p>
            产品怎么走——目标规划、路径、今日行动、学习状态——在首页能看见。
            细节还在打磨，方向先讲清楚。
          </p>
          <router-link to="/" class="vn-btn vn-btn--ghost">看产品怎么开始 →</router-link>
        </div>
      </section>

      <!-- 现状：诚实、短 -->
      <section class="vn-status vn-shell" v-reveal>
        <h2>它是什么阶段</h2>
        <p>
          WenFlow 目前是<strong>实验型原型</strong>：主链路已经能跑通，方向也相对清楚，正在持续打磨稳定性与细节。
        </p>
        <p>
          它开源（MIT），欢迎查看、讨论和二次开发。
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
          <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://wenflow.org/" target="_blank" rel="noreferrer">Demo</a>
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
const primaryLabel = computed(() => (loggedIn.value ? '规划新目标' : '从一个问题开始'))

function syncAuthState() {
  loggedIn.value = hasUserSession()
}

onMounted(() => {
  syncAuthState()
  window.addEventListener('storage', syncAuthState)
})

onUnmounted(() => {
  window.removeEventListener('storage', syncAuthState)
})
</script>

<style scoped>
.vn {
  --ink: #172033;
  --muted: #5b6577;
  --faint: #8492ab;
  --line: rgba(23, 32, 51, 0.08);
  --canvas: #f3f6fb;
  --surface: #fff;
  --surface-soft: rgba(255, 255, 255, 0.88);   /* 玻璃卡片默认底 */
  --surface-tint: rgba(255, 255, 255, 0.92);   /* 高亮面板底色 */
  --surface-strong: #fff;                      /* 纯色面板（按钮等） */
  --float: rgba(255, 255, 255, 0.75);          /* 页脚全宽半透条 */
  --shade: rgba(15, 23, 42, 0.08);             /* 悬浮阴影（浅色） */
  --card-blend: rgba(255, 255, 255, 0.92);     /* 渐变卡片白色终端 */
  --tint-blend: rgba(52, 120, 246, 0.1);       /* 渐变卡片蓝色起点 */
  --hover-wash: rgba(255, 255, 255, 0.7);      /* 列表行 hover 底色 */
  --accent: #8d6bff;
  --blue: #3478f6;
  --blue-deep: #1f57cc;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  [data-theme='dark'] & {
    --ink: #e6edf7;
    --muted: #9aa8bf;
    --faint: #7d8ba3;
    --line: rgba(230, 237, 247, 0.14);
    --canvas: #0f1620;
    --surface: #182230;
    --surface-soft: rgba(24, 34, 48, 0.72);
    --surface-tint: rgba(26, 37, 53, 0.85);
    --surface-strong: #1a2535;
    --float: rgba(10, 15, 23, 0.5);
    --shade: rgba(0, 0, 0, 0.38);
    --card-blend: rgba(24, 34, 48, 0.85);
    --tint-blend: rgba(77, 139, 248, 0.14);
    --hover-wash: rgba(230, 237, 247, 0.045);
    --accent: #a78bff;
    --blue: #4d8bf8;
    --blue-deep: #6fa3ff;
  }
  min-height: 100vh;
  background: var(--canvas);
  color: var(--ink);
  font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", Inter, sans-serif;
  overflow-x: clip;
}

.vn-shell {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

/* Nav 由 MarketingNav 组件提供（首页/愿景共用同一份导航） */
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
  background: var(--surface-soft);
  border-color: var(--line);
}
.vn-btn--lg {
  min-height: 50px;
  padding: 0 24px;
}

/* BG */

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
  padding: 96px 0 64px;
}
.vn-hero__copy {
  display: grid;
  gap: 18px;
}
.vn-hero h1 {
  margin: 0;
  font-size: clamp(38px, 5.5vw, 64px);
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
  position: relative;
  display: grid;
  gap: 12px;
  padding: 32px;
  border-radius: 28px;
  background: linear-gradient(180deg, var(--tint-blend), var(--card-blend));
  border: 1px solid rgba(52, 120, 246, 0.16);
  box-shadow: 0 28px 80px rgba(58, 101, 197, 0.12);
  backdrop-filter: blur(14px);
  overflow: hidden;
}
[data-theme='dark'] .vn-hero__aside {
  border-color: rgba(111, 163, 255, 0.25);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42);
}
.vn-hero__quote {
  position: absolute;
  top: -26px;
  right: 8px;
  font-size: 120px;
  line-height: 1;
  font-weight: 900;
  color: rgba(52, 120, 246, 0.08);
  pointer-events: none;
}
.vn-hero__aside span:not(.vn-hero__quote):not(.vn-hero__seal) {
  font-size: 12px;
  font-weight: 900;
  color: var(--blue-deep);
}
.vn-hero__aside strong {
  font-size: 20px;
  line-height: 1.45;
  letter-spacing: -0.025em;
}
.vn-hero__seal {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding-top: 14px;
  border-top: 1px dashed rgba(52, 120, 246, 0.2);
}
.vn-hero__seal i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  opacity: 0.55;
}
.vn-hero__seal i:nth-child(2) { opacity: 0.8; }
.vn-hero__seal i:nth-child(3) { opacity: 1; }
.vn-hero__seal em {
  font-style: normal;
  margin-left: 6px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--faint);
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
  padding: 16px 0 56px;
}
.vn-stand__head {
  max-width: 36em;
  margin-bottom: 28px;
  display: grid;
  gap: 12px;
}
.vn-stand__head h2 {
  margin: 0;
  font-size: clamp(26px, 3.2vw, 34px);
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
  background: var(--surface-soft);
  border: 1px solid var(--line);
  transition: transform 0.28s var(--ease), box-shadow 0.28s var(--ease);
}
.vn-stand__grid article:hover {
  transform: translateY(-3px);
  box-shadow: 0 18px 42px var(--shade);
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
  padding: 24px 0 56px;
}
.vn-cap__head {
  margin-bottom: 28px;
  display: grid;
  gap: 8px;
}
.vn-cap__head h2 {
  margin: 0;
  font-size: clamp(26px, 3.2vw, 34px);
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
  transition: background 0.25s var(--ease), padding 0.25s var(--ease);
}
.vn-cap__list li:hover {
  background: var(--hover-wash);
  padding-left: 18px;
}
.vn-cap__list li:last-child {
  border-bottom: 1px solid var(--line);
}
.vn-cap__list span {
  font-size: 13px;
  font-weight: 900;
  color: var(--blue-deep);
  padding-top: 4px;
  transition: transform 0.3s var(--ease), color 0.3s var(--ease);
}
@media (prefers-reduced-motion: no-preference) {
  .vn-cap__list li:hover span {
    transform: scale(1.25) translateX(2px);
    color: var(--accent, #8d6bff);
  }
}
.vn-cap__list strong {
  display: block;
  font-size: 18px;
  margin-bottom: 4px;
  transition: color 0.25s var(--ease);
}
.vn-cap__list li:hover strong {
  color: var(--blue-deep);
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
  background: var(--surface-soft);
  border: 1px solid var(--line);
  box-shadow: 0 16px 40px var(--shade);
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
  background: linear-gradient(180deg, var(--tint-blend), var(--card-blend));
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
[data-theme='dark'] .vn-end__glow {
  background: radial-gradient(circle, rgba(77, 139, 248, 0.22), transparent 68%);
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
  background: var(--float);
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
.vn-foot a:first-child {
  margin-left: 0;
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
}

@media (max-width: 640px) {
  .vn-shell {
    width: min(100% - 28px, 1180px);
  }
}

/* ---------- 超大屏（2K/4K）：随视口放大容器与字号 ---------- */
@media (min-width: 2000px) {
  .vn-shell {
    width: min(1560px, calc(100% - 64px));
  }
  .vn-btn {
    min-height: 48px;
    padding: 0 20px;
    font-size: 16px;
  }
  .vn-btn--lg {
    min-height: 60px;
    padding: 0 32px;
    font-size: 17px;
  }
  .vn-hero {
    grid-template-columns: minmax(0, 1.15fr) minmax(360px, 460px);
    gap: 72px;
    padding: 150px 0 90px;
  }
  .vn-hero h1 {
    font-size: clamp(60px, 3.6vw, 92px);
    line-height: 1.08;
  }
  .vn-hero__copy > p {
    font-size: 23px;
    max-width: 36ch;
  }
  .vn-hero__aside {
    padding: 38px;
  }
  .vn-hero__aside strong {
    font-size: 24px;
  }
  .vn-stand__head h2,
  .vn-cap__head h2 {
    font-size: clamp(42px, 2.8vw, 58px);
  }
  .vn-stand__head p {
    font-size: 19px;
  }
  .vn-stand__grid article {
    padding: 34px;
  }
  .vn-stand__grid ul {
    font-size: 17px;
  }
  .vn-cap__list li {
    padding: 24px 14px;
  }
  .vn-cap__list strong {
    font-size: 21px;
  }
  .vn-cap__list p {
    font-size: 16.5px;
  }
  .vn-bridge__box {
    padding: 44px 48px;
  }
  .vn-bridge h2 {
    font-size: 30px;
  }
  .vn-bridge p {
    font-size: 18px;
  }
  .vn-status h2 {
    font-size: clamp(32px, 2.2vw, 42px);
  }
  .vn-status p {
    font-size: 19px;
  }
  .vn-end {
    padding: 116px 24px 132px;
  }
  .vn-end h2 {
    font-size: clamp(40px, 2.8vw, 58px);
  }
  .vn-end p {
    font-size: 19px;
  }
}
</style>
