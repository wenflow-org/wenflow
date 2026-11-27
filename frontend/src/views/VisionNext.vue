<template>
  <div class="vn">
    <MarketingNav :logged-in="loggedIn" />

    <main>
      <!-- 时代问题 + 1946 电报：先让访客慢下来 -->
      <section class="vn-hero vn-shell">
        <div class="vn-hero__copy">
          <span class="vn-pill">WenFlow 学习观</span>
          <h1>旧的学习方式，<br /><span class="vn-keep">越来越难</span>回应新的问题。</h1>
        </div>
        <div class="vn-hero__body">
          <p>
            AI 已经能够快速提供知识与答案。当获取信息不再困难，学习的重心需要回到<span class="vn-keep">界定问题</span>、独立判断与持续修正。
          </p>
        </div>
        <figure class="vn-quote">
          <div class="vn-quote__meta">
            <span>1946 年的一封电报</span>
            <span class="vn-quote__years">1946 → 2026</span>
          </div>
          <blockquote>“原子释放出的力量改变了<span class="vn-keep">一切</span>，除了我们的思维方式。”</blockquote>
          <figcaption>1946 年，爱因斯坦等科学家在写给联合国的电报中留下这句话。八十年后，AI 带来了相似的处境：<span class="vn-keep">工具</span>演进很快，<span class="vn-keep">但大多数</span>学习仍停留在记忆和复述<span class="vn-keep">标准答案</span>上。</figcaption>
          <p class="vn-quote__aside">答案越多，问题本身越重要。</p>
        </figure>
      </section>

      <!-- 正文：问题意识 → 产品取舍 → 开源初心，同一块纯白通栏 -->
      <div class="vn-body">
        <!-- 问题意识：别人给的问题 vs 你创建的问题；道与技压成一段 -->
        <section class="vn-problem vn-shell">
          <div class="vn-problem__head" v-reveal>
            <span class="vn-kicker">问题意识</span>
            <h2>有价值的学习，<br />大多从自己的问题开始。</h2>
            <p>标准题考察的是找到唯一解。面对真实问题，<span class="vn-keep">则需要</span>自行划定边界、权衡取舍并决定下一步。WenFlow 专注后者。</p>
          </div>
          <div class="vn-problem__body">
            <div class="vn-problem__compare">
              <article v-reveal>
                <span>别人给的问题</span>
                <ul>
                  <li>再难也有既定解法</li>
                  <li>存在明确的标准答案</li>
                  <li>路径与材料预先备好</li>
                  <li>结果以对错评判</li>
                </ul>
              </article>
              <article class="is-strong" v-reveal="{ delay: 80 }">
                <span>自己的问题</span>
                <ul>
                  <li>没有标准答案，需自行界定完成标准</li>
                  <li>问题边界会随深入而变化</li>
                  <li>没有现成课表，需在实践中调整</li>
                  <li>没有固定终点，只有更深的理解</li>
                </ul>
              </article>
            </div>
            <p class="vn-problem__note" v-reveal="{ delay: 140 }">
              具体工具、界面和模型版本都会迭代，但厘清问题、<span class="vn-keep">组织结构</span>与独立判断的能力<span class="vn-keep">长期有效</span>。工具越强，越<span class="vn-keep">需要</span>使用者明确自己的目的。
            </p>
          </div>
        </section>

        <!-- 三个判断：编号在标题上方，正文与问题区共用同一条左轴 -->
        <section class="vn-cap vn-shell">
          <div class="vn-cap__head" v-reveal>
            <h2>三个判断</h2>
            <p>基于以上认识，产品上做了三个取舍。</p>
          </div>
          <ol class="vn-cap__list">
            <li v-for="(item, i) in caps" :key="item.t" v-reveal="{ delay: i * 60 }">
              <span>{{ item.n }}</span>
              <strong>{{ item.t }}</strong>
              <p v-html="capHtml(item.d)"></p>
            </li>
          </ol>
        </section>

        <!-- 开源初心：左标题/标签 + 右初心与当前阶段 -->
        <section class="vn-status vn-shell" v-reveal>
          <div class="vn-status__head">
            <h2>开源初心</h2>
            <div class="vn-status__tags">
              <span class="vn-status__tag">MIT 协议</span>
              <span class="vn-status__tag">实验型原型</span>
            </div>
          </div>
          <div class="vn-status__body">
            <p class="vn-origin__lead">
              WenFlow 不试图为“AI 时代如何学习”提供<span class="vn-keep">标准答案</span>，而是希望留下一套可运行、可拆解、可继续演进的开源基础。
            </p>
            <p>
              如果它能帮助学习者建立更清晰的学习路径，或为后来做教育产品的团队减少一些<span class="vn-keep">试错成本</span>，<span class="vn-keep">便已</span><span class="vn-keep">达到初衷</span>。
            </p>
            <p class="vn-origin__status">
              目前项目处于实验型原型阶段：主链路已经跑通，代码与设计文档全部公开，仍在持续<span class="vn-keep">完善细节</span>与稳定性。
            </p>
            <div class="vn-status__links">
              <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer">GitHub</a>
              <a href="https://wenflow.org/" target="_blank" rel="noreferrer">Demo</a>
            </div>
          </div>
        </section>
      </div>

      <section class="vn-end">
        <div class="vn-end__in" v-reveal>
          <h2>带着一个真实问题开始。</h2>
          <p>无需提前整理完整计划，说出你近期希望解决的具体问题即可。</p>
          <!-- 原型 wf-pend__acts：主按钮 + 次按钮「已有账号，登录」+ 返回首页同排 -->
          <div class="vn-end__acts">
            <router-link :to="primaryPath" class="vn-btn vn-btn--primary vn-btn--lg">{{ primaryLabel }}</router-link>
            <!-- 与首页尾屏同口径（2026-11-11）：已登录时不再显示「已有账号，登录」并把人送回登录页 -->
            <router-link :to="loggedIn ? '/dashboard' : '/login'" class="vn-btn vn-btn--light vn-btn--lg">{{ loggedIn ? '回到学习台' : '已有账号，登录' }}</router-link>
            <router-link to="/" class="vn-end__back">← 返回首页</router-link>
          </div>
        </div>
      </section>
    </main>

    <!-- 原型 wf-pfoot：品牌块（favicon + 名称 + 分隔线 + slogan）+ 链接 -->
    <footer class="vn-foot">
      <div class="vn-shell vn-foot__in">
        <div class="vn-foot__brand">
          <img src="/favicon.png" alt="" />
          <span>问流 WenFlow</span>
          <em>从问题到学习路径</em>
        </div>
        <div class="vn-foot__links">
          <router-link to="/">首页</router-link>
          <router-link to="/vision">愿景</router-link>
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

const caps = [
  { n: '01', t: '为什么没有预置课程', d: '许多学习中途停滞，往往源于通用课程与个人当下的实际问题错位，学到一半发现难以应用。WenFlow 从具体问题出发，先澄清目标，再按需生成学习路径与单节内容。' },
  { n: '02', t: '为什么不做自由聊天框', d: '自由对话容易让人产生“看懂了”的错觉，实际却难以独立运用。有效的学习需要节奏控制：分段讲解、随堂提问与即时检验，受阻时切换讲法或补足前置概念。因此课堂按明确回合推进。' },
  { n: '03', t: '为什么把复习和负荷算进来', d: '短期放弃通常源于前期投入过猛导致疲劳，或缺乏复习导致遗忘。系统会记录每节课的掌握情况，按遗忘曲线安排复习，并持续追踪学习负荷与疲劳度，在状态偏低时提示放缓节奏。' }
]

const capKeepWords = /单节内容|节奏|课堂|提示|当下的|讲解|疲劳度|补足|因此课堂/g
function capHtml(text: string) {
  return text.replace(capKeepWords, (word) => `<span class="vn-keep">${word}</span>`)
}

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
  --ink: var(--mk-ink);
  --muted: var(--mk-muted);
  --faint: var(--mk-faint);
  --line: var(--mk-line);
  --canvas: var(--mk-bg);
  --surface: var(--mk-surface);
  /* 面板底（批次 D，2026-10-02 平面化）
     原 --surface-soft 是 rgba(255,255,255,.88) 半透明，注释自称「玻璃卡片默认底」，
     但它**没有** backdrop-filter 配合——半透明却不模糊，等于让下层内容
     「透出来但糊」，比纯平面更难读，且这层半透明白在暗色下是亮斑。
     现全部改为不透明，引用令牌层：soft=沉底、tint=高亮面板、strong=按钮面。 */
  --surface-soft: var(--wf-bg-subtle);
  --surface-tint: var(--wf-bg-elevated);
  --surface-strong: var(--wf-bg-surface);
  /* 原 --shade: rgba(15,23,42,.08) —— 规范外的第四档投影。
     已连同当时的静态面板消费点一并删除：静态面板不承载层级关系，投影在这里只是灰雾。
     需要浮层投影的元素直接引 --wf-shadow-overlay / --mk-shadow-pop，不再走本地别名。 */
  /* 品牌色一律引 --mk-*：暗色档由 main.css 自动翻转，本页不再自带覆写
     （原型 newui/用户侧/index.html 的 --blue/--purple 同值：#2f6ae0 / #8d6bff） */
  --purple: var(--mk-purple);
  --blue: var(--mk-blue);
  --blue-deep: var(--mk-accent-deep);
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  /* 原先这里有一个 [data-theme='dark'] & 块，逐条重写 --ink/--muted/--faint/
     --line/--canvas/--surface 与亮色**同值**（都指 var(--mk-*)），纯冗余；
     真正的暗色值由 tokens.css 的暗色块翻转 --wf-* 给出。
     --surface-soft/tint/strong 的暗色档（原先是 rgba(24,34,48,.72) 这类
     半透明）随平面化一并取消——上面已改指不透明的 --wf-bg-*。
     该块现已整体删除：这一页的暗色配色只有一处事实源。 */
  min-height: 100vh;
  background: var(--canvas);
  color: var(--ink);
  font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", Inter, sans-serif;
  overflow-x: clip;
}

.vn-shell {
  /* 与首页同一条外边界：页头、正文、页脚不再各收各的。
     正文左标题 + 右阅读栏，靠内部分栏控制行宽，不靠整页缩窄。 */
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}
@media (max-width: 1366px) {
  /* 720p/768p 桌面：1180 只剩 50px 边距，整页贴边；
     收到 1120 后左右各留 80px，且三栏正文仍保持约 680px 的阅读宽度 */
  .vn-shell {
    width: min(1120px, calc(100% - 48px));
  }
}
@media (min-width: 2000px) {
  .vn-shell {
    width: min(1560px, calc(100% - 64px));
  }
}

/* Nav 由 MarketingNav 组件提供（首页/愿景共用同一份导航） */
.vn-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 原型 wf-pbtn：44 / 0 18 / 15px / 800 / 999 */
  min-height: 44px;
  padding: 0 18px;
  border-radius: var(--mk-radius-pill);
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  border: 1px solid transparent;
  /* 平面化后按钮已无投影，transition 里一并去掉 box-shadow */
  transition: transform 0.2s var(--ease);
  width: fit-content;
}
/* 「友好而平」：取消 hover 上浮，悬停只允许改背景/描边/文字；
   按压反馈留给 :active 的 scale(0.98)。 */
.vn-btn:active {
  transform: scale(0.98);
}
/* 主按钮：实心品牌蓝，不再用 linear-gradient(135deg, …)；
   原先的 0 16px 34px 蓝色投影属于彩色光晕，一并退休。 */
.vn-btn--primary {
  color: var(--text-on-primary);
  background: var(--blue);
  transition: transform 0.2s var(--ease), background 0.2s var(--ease);
}
.vn-btn--primary:hover {
  background: var(--blue-deep);
}
/* 原型 wf-pbtn--light：尾部「已有账号，登录」次按钮 */
.vn-btn--light {
  color: var(--blue-deep);
  background: var(--surface);
  border: 1px solid var(--line);
}
.vn-btn--lg {
  /* 原型 wf-pbtn--lg：52 / 0 26 / 16px */
  min-height: 52px;
  padding: 0 26px;
  font-size: 16px;
}

main {
  position: relative;
  z-index: 1;
}

.vn-pill {
  width: fit-content;
  padding: 7px 12px;
  border-radius: var(--mk-radius-pill);
  background: color-mix(in srgb, var(--blue) 9%, transparent);
  color: var(--blue-deep);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.vn-hero {
  /* 首屏标题横跨整幅，说明文字必须回到标题左轴；
     320px 参考栏从问题区才开始真正承载左栏标题 */
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  column-gap: 64px;
  row-gap: 32px;
  align-items: start;
  padding: 72px 0 64px;
}
.vn-hero__copy {
  grid-column: 1 / -1;
  display: grid;
  gap: 18px;
}
.vn-hero h1 {
  margin: 0;
  /* 原型 wf-pvis__hero h1：clamp(34px,5vw,58px)、15em（390 视口落 34px） */
  font-size: clamp(34px, 5vw, 58px);
  line-height: 1.1;
  letter-spacing: -0.045em;
  max-width: 15em;
}
.vn-hero__body {
  /* 标题已跨满整幅，说明若缩到右栏会悬在标题中段下方；
     回到 1 / -1 后与 h1 同一条左轴，600px 阅读宽度不变 */
  grid-column: 1 / -1;
  display: grid;
  gap: 22px;
  align-content: start;
  max-width: 600px;
}
.vn-hero__body > p {
  margin: 0;
  max-width: 600px;
  font-size: 16px;
  line-height: 1.8;
  color: var(--muted);
  text-wrap: pretty;
}
.vn-keep {
  white-space: nowrap;
}
/* 1946 电报：首屏里唯一一块“安静下来”的内容 */
.vn-quote {
  grid-column: 1 / -1;
  margin: 0;
  padding: 28px 32px;
  display: grid;
  gap: 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-xl);
}
.vn-quote__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  letter-spacing: 0.04em;
}
.vn-quote__years {
  color: var(--blue-deep);
  white-space: nowrap;
}
.vn-quote blockquote {
  margin: 0;
  max-width: 760px;
  font-size: 24px;
  line-height: 1.5;
  letter-spacing: -0.02em;
  color: var(--ink);
  text-wrap: balance;
}
.vn-quote figcaption {
  max-width: 760px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--muted);
}
.vn-quote__aside {
  margin: 0;
  justify-self: end;
  font-size: 13px;
  font-weight: 800;
  color: var(--blue-deep);
}

/* 首屏入场：按阅读顺序上浮；引用卡片最后出现。
   reduced-motion 下不播放，直接呈现终态。 */
@media (prefers-reduced-motion: no-preference) {
  .vn-hero__copy > .vn-pill {
    animation: vn-rise 0.55s var(--ease) 0.04s both;
  }
  .vn-hero h1 {
    animation: vn-rise 0.75s var(--ease) 0.12s both;
  }
  .vn-hero__body > p {
    animation: vn-rise 0.7s var(--ease) 0.24s both;
  }
  .vn-quote {
    animation: vn-rise 0.8s var(--ease) 0.38s both;
  }
}
@keyframes vn-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 区块级揭示由 v-reveal（.rv）承担；首屏入场用上面的 CSS 时间线，
   这样首屏不用等 IntersectionObserver，滚动到判断/现状时再交给 v-reveal。 */

/* 首屏浅灰，正文通栏纯白：问题意识 + 三个判断 + 开源初心在同一张白纸上 */
.vn-body {
  background: var(--surface);
  border-top: 1px solid var(--line);
}

.vn-problem {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  column-gap: 64px;
  align-items: start;
  padding: 64px 0;
}
.vn-problem__head {
  display: grid;
  gap: 12px;
}
.vn-kicker {
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: var(--blue-deep);
}
.vn-problem__head h2 {
  margin: 0;
  font-size: clamp(24px, 2.4vw, 28px);
  line-height: 1.25;
  letter-spacing: -0.04em;
}
.vn-problem__head p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted);
}
.vn-problem__body {
  display: grid;
  gap: 28px;
  max-width: 600px;
}
.vn-problem__compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
}
.vn-problem__compare article {
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.vn-problem__compare article.is-strong {
  border-top-color: color-mix(in srgb, var(--blue) 45%, var(--line));
}
.vn-problem__compare article > span {
  display: block;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 800;
  color: var(--muted);
}
.vn-problem__compare article.is-strong > span {
  color: var(--blue-deep);
}
.vn-problem__compare ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}
.vn-problem__compare li {
  position: relative;
  padding-left: 14px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--muted);
}
.vn-problem__compare li::before {
  content: "";
  position: absolute;
  top: 0.72em;
  left: 0;
  width: 5px;
  height: 1px;
  background: var(--line);
}
.vn-problem__compare article.is-strong li {
  color: var(--ink);
}
.vn-problem__compare article.is-strong li::before {
  background: var(--blue);
}
.vn-problem__note {
  max-width: 600px;
  margin: 0;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  font-size: 15px;
  line-height: 1.8;
  color: var(--muted);
}

.vn-cap {
  /* 与首屏/问题/初心共用 320px 左栏 + 64px 栏间距 */
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  column-gap: 64px;
  align-items: start;
  padding: 48px 0 64px;
  border-top: 1px solid var(--line);
}
.vn-cap__head {
  display: grid;
  gap: 8px;
}
.vn-cap__head h2 {
  margin: 0;
  font-size: clamp(24px, 3.2vw, 34px);
  letter-spacing: -0.04em;
}
.vn-cap__head p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted);
}
.vn-cap__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.vn-cap__list li {
  display: block;
  padding: 32px 0;
  margin: 0;
  border-top: 1px solid var(--line);
}
.vn-cap__list li:first-child {
  border-top: 0;
  /* 第一条与左栏标题顶对齐，后续条目用 32px 内边距拉开 */
  padding-top: 0;
}
.vn-cap__list > li > span {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 900;
  color: var(--blue-deep);
  transition: color 0.3s var(--ease);
}
@media (prefers-reduced-motion: no-preference) {
  /* 「友好而平」：取消 hover 位移/缩放（原 scale(1.25) translateX(2px)）；
     悬停只保留纯文字色反馈。 */
  .vn-cap__list li:hover > span {
    color: var(--purple);
  }
}
.vn-cap__list strong {
  display: block;
  margin: 0 0 6px;
  font-size: 18px;
  line-height: 1.4;
}
.vn-cap__list p {
  margin: 0;
  max-width: 600px;
  font-size: 16px;
  color: var(--muted);
  line-height: 1.8;
  text-wrap: pretty;
}
/* v-html 注入的 nowrap 词不会被 scoped 的 .vn-keep 命中，单独下钻 */
.vn-cap__list p :deep(.vn-keep) {
  white-space: nowrap;
}

.vn-status {
  /* 与「三个判断」同一条 320px 左栏 + 右正文左轴 */
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  column-gap: 64px;
  align-items: start;
  padding: 48px 0 64px;
  border-top: 1px solid var(--line);
}
.vn-status__head {
  display: grid;
  gap: 12px;
}
.vn-status h2 {
  margin: 0;
  font-size: clamp(22px, 3vw, 30px);
  letter-spacing: -0.03em;
}
.vn-status__body {
  display: grid;
  gap: 14px;
}
.vn-status__body p {
  margin: 0;
  max-width: 600px;
  font-size: 16px;
  line-height: 1.8;
  color: var(--muted);
  text-wrap: pretty;
}
.vn-status__body p.vn-origin__lead {
  color: var(--ink);
}
.vn-status__body p.vn-origin__status {
  color: var(--muted);
  font-size: 15px;
}
.vn-status__tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.vn-status__tag {
  font-size: 12px;
  font-weight: 800;
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 9%, transparent);
  padding: 5px 10px;
  border-radius: var(--mk-radius-pill);
}
.vn-status__links {
  display: flex;
  gap: 16px;
}
.vn-status__links a {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  font-size: 14px;
  font-weight: 800;
  color: var(--blue-deep);
  text-decoration: none;
  /* 触控热区 ≥36（2026-10-08 用户侧走查）：纵向内边距原来只写在 ≤900 档，
     1440 档实测 51×21 / 42×21，而同页页脚链接是 36 —— 同页两套标准。
     现在基础档就给足，全档位与 .vn-foot a 同标准（配色不变）。 */
  padding: 8px 0;
}
.vn-status__links a:hover {
  text-decoration: underline;
}

/* 内容块只占 320 + 64 + 600 = 984，必须在页面里居中；
   否则 1180/1560 的外框会把整块阅读内容推到左侧（1920 下尤其明显）。 */
.vn-hero,
.vn-problem,
.vn-cap,
.vn-status {
  max-width: 984px;
  margin-right: auto;
  margin-left: auto;
}
@media (min-width: 2000px) {
  .vn-hero,
  .vn-problem,
  .vn-cap,
  .vn-status {
    max-width: 1180px;
  }
}

.vn-end {
  position: relative;
  /* 原型 wf-pend：60 / 0 68，底色 --soft */
  padding: 60px 0 68px;
  background: color-mix(in srgb, var(--surface) 92%, var(--ink));
  border-top: 1px solid var(--line);
  text-align: center;
  overflow: hidden;
}
.vn-end__in {
  position: relative;
  z-index: 1;
  width: min(560px, calc(100% - 48px));
  margin: 0 auto;
  display: grid;
  gap: 14px;
  justify-items: center;
}
/* 原型 wf-pend__acts：主/次按钮与「返回首页」同排，12px 间距居中 */
.vn-end__acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.vn-end h2 {
  margin: 0;
  font-size: clamp(28px, 4vw, 42px);
  letter-spacing: -0.04em;
  line-height: 1.12;
  text-wrap: balance;
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
  /* 同上：尾屏「← 返回首页」1440 档实测 69×20，纵向内边距提到基础档 */
  padding: 9px 0;
}
.vn-end__back:hover {
  text-decoration: underline;
}

.vn-foot {
  border-top: 1px solid var(--line);
  /* 原型 wf-pfoot：--soft = surface 与 ink 混 92% */
  background: color-mix(in srgb, var(--surface) 92%, var(--ink));
}
.vn-foot__in {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 20px 0;
  font-size: 13px;
  color: var(--faint);
  font-weight: 600;
}
.vn-foot__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.vn-foot__brand img {
  width: 22px;
  height: 22px;
  display: block;
}
.vn-foot__brand em {
  font-style: normal;
  font-weight: 500;
  color: var(--faint);
  padding-left: 8px;
  border-left: 1px solid var(--line);
  font-size: 12px;
}
.vn-foot__links {
  display: flex;
  gap: 14px;
}
.vn-foot a {
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
  font-weight: 700;
  /* 触控热区 ≥36×36（2026-10-08 用户侧走查）：原 padding 6px 2px（窄屏 8px 0）实测 26×36 ——
     高度够、两字链接宽度只有 26px。min-height 保住高度、左右 5px 内边距把宽度撑到 ≥36，
     再用等量负外边距抵消，视觉间距与原来一致。 */
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 5px;
  margin: 0 -5px;
}
.vn-foot a:hover {
  color: var(--blue-deep);
}

@media (max-width: 900px) {
  /* 窄屏收成单栏：首屏标题在上，说明/引用卡片在下；问题/判断/初心同序 */
  .vn-hero {
    grid-template-columns: 1fr;
    row-gap: 24px;
    padding: 52px 0 48px;
  }
  .vn-hero__body {
    grid-column: 1;
    max-width: 600px;
  }
  .vn-problem {
    grid-template-columns: 1fr;
    gap: 20px;
    padding: 48px 0;
  }
  .vn-problem__body {
    max-width: 600px;
  }
  .vn-cap {
    grid-template-columns: 1fr;
    gap: 20px;
    padding: 28px 0 48px;
  }
  .vn-status {
    grid-template-columns: 1fr;
    gap: 20px;
    padding: 40px 0 48px;
  }
  /* 单栏时补回标题与第一条之间的分隔线，并给第一条留出上呼吸 */
  .vn-cap__list li {
    padding: 28px 0;
  }
  .vn-cap__list li:first-child {
    border-top: 1px solid var(--line);
    padding-top: 28px;
  }
  /* 38px 孤词行问题已由「显式换行 + ≤640 档 balance」解决（见本文件最后一个 style 块） */
  /* 触屏热区：状态区链接与「返回首页」的纵向内边距已提到基础档
     （2026-10-08 用户侧走查：只在 ≤900 档生效会留下 1440 档 20–21px 的洞）。
     页脚链接的窄屏覆写已删（2026-10-08 走查）：它在基础档之上又把横向内边距压回 0，
     两字链接宽度掉到 26px；高度与宽度现在都由基础档的 min-height + 左右内边距保证。 */
  .vn-status__links { gap: 12px; }
  .vn-foot__in { padding: 14px 0; }
  .vn-foot__links { display: flex; gap: 16px; flex-wrap: wrap; }
}

@media (max-width: 640px) {
  .vn-quote {
    padding: 24px 20px;
  }
  .vn-quote blockquote {
    font-size: 20px;
  }
  .vn-quote__aside {
    justify-self: start;
  }
  .vn-problem__compare {
    grid-template-columns: 1fr;
    gap: 24px;
  }
}

@media (max-width: 640px) {
  .vn-shell {
    width: min(1180px, calc(100% - 28px));
  }
}

</style>
<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   判据同上。实测 390 下：能力清单 20×12（各 95px 高）、
   .vn-btn--lg 50px 高；1 处 11px 微标签。展示型字号与 20/24px 圆角不动（同首页）。
   2026-11-26：能力条目的 14px 上下内边距已撤，改为首栏 28px 呼吸（见上一个 style 块）。 */
@media (max-width: 900px) {
  .vn-btn--lg { min-height: 44px; padding: 0 20px; }
}

/* 窄屏首屏标题与尾屏副文案的孤字行（2026-10-08 用户侧走查 #26）：390 档 h1 原来被模板里的
   显式 <br/> 折成「答案越来越多时，」/「更值得练的是提问与判」/「断。」，尾屏 p 折出末行「事。」。
   这里只动换行策略、不动字号（.vn-hero h1 没有可覆写的字号 token，改 clamp 会造出半档字面量）：
   窄屏放掉这条原型断行，与 .vn-end p 一起交给 balance 均分。Chromium 实测 390 档
   h1 由 3 行（末行 2 字）变 2 行（末行 6 字）、尾屏 p 由 2 行（末行 1 字）变 2 行（末行 11 字）；
   641 档以上仍保留原型的逗号后换行。 */
@media (max-width: 640px) {
  .vn-hero h1 br { display: none; }
  .vn-hero h1 { text-wrap: balance; }
  .vn-end p { text-wrap: balance; }
}
</style>
