<template>
  <div class="vn">
    <MarketingNav :logged-in="loggedIn" />

    <main>
      <!-- 时代问题 -->
      <section class="vn-hero vn-shell">
        <div class="vn-hero__copy">
          <span class="vn-pill">WHY WENFLOW</span>
          <h1>答案越来越多时，<br />更值得练的是提问与判断。</h1>
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
        <div class="vn-end__in" v-reveal>
          <h2>带着一个真实问题开始。</h2>
          <p>不需要先写完整计划。说出最近真正想解决的事。</p>
          <!-- 原型 wf-pend__acts：主按钮 + 次按钮「已有账号，登录」+ 返回首页同排 -->
          <div class="vn-end__acts">
            <router-link :to="primaryPath" class="vn-btn vn-btn--primary vn-btn--lg">{{ primaryLabel }}</router-link>
            <router-link to="/login" class="vn-btn vn-btn--light vn-btn--lg">已有账号，登录</router-link>
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
     已连同唯一消费点（.vn-bridge__box 的静态面板投影）一并删除：
     静态面板不承载层级关系，投影在这里只是灰雾。需要浮层投影的
     元素直接引 --wf-shadow-overlay / --mk-shadow-pop，不再走本地别名。 */
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
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
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
  color: #fff;
  background: var(--blue);
  transition: transform 0.2s var(--ease), background 0.2s var(--ease);
}
.vn-btn--primary:hover {
  background: var(--blue-deep);
}
.vn-btn--ghost {
  color: var(--ink);
  background: var(--surface-soft);
  border-color: var(--line);
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
  /* 原型 wf-pvis__hero：72px 上 / 56px 下（无 min-height，高度由内容决定） */
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(280px, 360px);
  gap: 48px;
  align-items: center;
  padding: 72px 0 56px;
}
.vn-hero__copy {
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
.vn-hero__copy > p {
  margin: 0;
  max-width: 40ch;
  font-size: 17px;
  line-height: 1.75;
  color: var(--muted);
}
.vn-hero__aside {
  position: relative;
  display: grid;
  gap: 12px;
  padding: 32px;
  /* 批次 D（2026-10-02）：20px 圆角（档外）→ --mk-radius-xl；
     180deg 蓝调渐变底 → 单一平涂 color-mix(blue 8%, surface)。
     原渐变两端同色相、差异仅 8%→透明，肉眼看不出渐变，只增加一层
     「这里为什么特殊」的暗示——而这一层 special 感已经由 16% 蓝描边承担。 */
  border-radius: var(--mk-radius-xl);
  background: color-mix(in srgb, var(--blue) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--blue) 16%, transparent);
  /* 原来这层 0 12px 32px 蓝色投影是彩色光晕，平面化后整块去掉 */
  overflow: hidden;
}
.vn-hero__quote {
  position: absolute;
  top: -26px;
  right: 8px;
  font-size: 120px;
  line-height: 1;
  font-weight: 900;
  color: color-mix(in srgb, var(--blue) 8%, transparent);
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
  border-top: 1px dashed color-mix(in srgb, var(--blue) 20%, transparent);
}
.vn-hero__seal i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  /* 印章圆点：品牌蓝实心化，不再用渐变 */
  background: var(--blue);
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

/* 原型愿景屏 hero 无入场动画（wf-pub__screen 里只有首页 hero / 认证页有 wf-rise 编排）；
   区块级揭示仍由 v-reveal（.rv）承担 */

.vn-stand {
  padding: 8px 0 40px;
}
.vn-stand__head {
  max-width: 36em;
  margin-bottom: 26px;
  display: grid;
  gap: 12px;
}
.vn-stand__head h2 {
  margin: 0;
  font-size: clamp(24px, 3.2vw, 34px);
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
  border-radius: var(--mk-radius-xl);   /* 批次 D：20px（档外）→ 16px */
  background: var(--surface-soft);
  border: 1px solid var(--line);
  transition: border-color 0.28s var(--ease);
}
/* 「友好而平」：取消 hover 上浮（translateY(-3px)）与 hover 大投影；
   悬停唯一保留的反馈是描边转蓝，靠 1px 边框读出可点，不做位移。 */
.vn-stand__grid article:hover {
  border-color: color-mix(in srgb, var(--blue) 32%, var(--line));
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
  padding: 8px 0 40px;
}
.vn-cap__head {
  margin-bottom: 26px;
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
  /* 原型 wf-pvis__caps：16px 圆角，无 hover 底色/位移 */
  border-radius: 16px;
}
.vn-cap__list li:last-child {
  border-bottom: 1px solid var(--line);
}
.vn-cap__list > li > span {
  font-size: 13px;
  font-weight: 900;
  color: var(--blue-deep);
  padding-top: 4px;
  transition: transform 0.3s var(--ease), color 0.3s var(--ease);
}
@media (prefers-reduced-motion: no-preference) {
  .vn-cap__list li:hover > span {
    transform: scale(1.25) translateX(2px);
    color: var(--purple);
  }
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
  padding: 8px 0 40px;
}
.vn-bridge__box {
  /* 原型 wf-pvis__box：34 / 38 内边距。
     投影已删（批次 D，2026-10-02）：这是页面里一块**静态**的示意面板，
     不悬浮、不叠在滚动内容之上，投影在这里没有表达任何层级关系，
     只是让整页每张卡都自带一层灰雾。规范的说法是「面永远是平的，
     1px 发丝线就是全部质感」——下面的 border 已经承担了这件事。
     圆角 24px 是档外值，同批归到 --mk-radius-xl（16px）。 */
  padding: 34px 38px;
  border-radius: var(--mk-radius-xl);
  background: var(--surface-soft);
  border: 1px solid var(--line);
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
  padding: 8px 0 52px;
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
  padding: 6px 2px;
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
    /* 原型 wf-pvis__hero ≤980：52px 上 / 40px 下 */
    padding: 52px 0 40px;
    gap: 28px;
  }
  /* 38px 孤词行问题已由「字号下调 + 逗号后显式换行（原型同款 <br/>）」解决，
     不再需要 text-wrap: balance 抹掉原型的断行控制 */
  /* 触屏热区：状态区链接 21px、页脚链接 16px、返回首页 20px——宣传页上这些是唯一的外部/返回
     入口，加纵向内边距抬到 ≥34px（配色不变；块内边距同步收一点，页面不至于变高） */
  .vn-status__links { gap: 12px; margin-top: 10px; }
  .vn-status__links a { padding: 8px 0; }
  .vn-end__back { padding: 9px 0; }
  .vn-foot__in { padding: 14px 0; }
  .vn-foot__links { display: flex; gap: 16px; flex-wrap: wrap; }
  .vn-foot__in a { padding: 8px 0; }
}

@media (max-width: 640px) {
  .vn-shell {
    width: min(100% - 28px, 1180px);
  }
}

/* ---------- 超大屏（2K/4K）：随视口放大容器与字号 ---------- */
/* 超大屏档（≥2000）。同 HomeNext 的处理：文本只有三个角色 token
   （ADMIN_VISUAL_LAYER_SPEC §1），档位块只覆写 token，逐选择器写字面量正是
   「同一页字号档被打散」的根源（守卫规则 13）。
   .vn-btn / .vn-stand__grid ul 基础档均为 15px（--mk-fs-emphasis 档），
   .vn-cap__list p 为 14px（--mk-fs-body 档）；本档删除这三处字面量，
   改为统一放大 token 一档（×1.15）：17.25 / 16.10。
   展示型（.vn-hero h1 clamp(...) / .vn-hero__copy > p 23px）保留字面量。 */
@media (min-width: 2000px) {
  --mk-fs-micro: 13.8px;
  --mk-fs-body: 16.1px;
  --mk-fs-emphasis: 17.25px;
  .vn-shell {
    width: min(1560px, calc(100% - 64px));
  }
  .vn-btn {
    min-height: 48px;
    padding: 0 20px;
  }
  .vn-btn--lg {
    min-height: 60px;
    padding: 0 32px;
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
  /* .vn-stand__head p 继承基础档 --mk-fs-emphasis（本档 17.25） */
  .vn-stand__grid article {
    padding: 34px;
  }
  /* .vn-stand__grid ul / .vn-cap__list p 继承基础档 token（本档放大到 17.25 / 16.10） */
  .vn-cap__list li {
    padding: 24px 14px;
  }
  /* .vn-cap__list strong 21px：> emphasis×1.15（19.84），属展示型，规则 13 允许 */
  .vn-cap__list strong {
    font-size: 21px;
  }
  .vn-bridge__box {
    padding: 44px 48px;
  }
  .vn-bridge h2 {
    font-size: 30px;
  }
  /* .vn-bridge p 继承基础档 --mk-fs-emphasis（本档 17.25） */
  .vn-status h2 {
    font-size: clamp(32px, 2.2vw, 42px);
  }
  /* .vn-status p 继承基础档 --mk-fs-emphasis（17.25） */
  .vn-end {
    padding: 116px 0 132px;
  }
  .vn-end h2 {
    font-size: clamp(40px, 2.8vw, 58px);
  }
  /* .vn-end p 继承基础档 --mk-fs-emphasis（17.25） */
}
</style>
<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   判据同上。实测 390 下：hero 侧栏 32×32、标准卡 28×28（×2）、能力清单 20×12（×5，
   各 95px 高）、桥接盒 36×40（255px 高）；.vn-btn--lg 50px 高；1 处 11px 微标签。
   展示型字号与 20/24px 圆角不动（同首页）。 */
@media (max-width: 900px) {
  .vn-hero__aside { padding: 20px; }
  .vn-stand__grid article { padding: 18px; }
  .vn-cap__list li { padding: 14px 12px; }
  .vn-bridge__box { padding: 22px 18px; }
  .vn-btn--lg { min-height: 44px; padding: 0 20px; }
  .vn-hero__seal em { font-size: 12px; }
}
</style>
