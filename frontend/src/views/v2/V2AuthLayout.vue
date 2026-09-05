<template>
  <div class="auth v2-page">
    <div class="auth__bg" aria-hidden="true"></div>

    <main class="auth__main">
      <router-link to="/" class="auth__logo">
        <img src="/logo.png" alt="问流 WenFlow" />
      </router-link>

      <!-- 一体式双栏卡：左表单 右演示，天然 1:1 平衡 -->
      <div class="auth__card">
        <section class="auth__form-side">
          <slot />
          <router-link to="/" class="auth__back auth__back--bottom">← 返回首页</router-link>
        </section>

        <aside class="auth__demo-side">
          <div class="demo">
            <p class="demo__tagline">说说你最近想解决的事，几轮对话后，得到今天就能开始的第一步。</p>

            <div class="demo__chat">
              <div class="demo__msg demo__msg--user anim-msg" style="--d: 400ms">每周英文周会发言总是磕绊，想练职场英语</div>
              <div class="demo__msg demo__msg--ai anim-msg" style="--d: 900ms">
                <span class="demo__avatar"><img src="/favicon.png" alt="问流" /></span>
                <div>
                  <p>先确定你最需要练的场景——是听懂讨论，还是开口汇报？</p>
                  <div class="demo__chips">
                    <span class="demo__chip demo__chip--on">开口汇报</span>
                    <span class="demo__chip">听懂讨论</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="demo__panel">
              <div class="demo__panel-head">
                <strong>目标信息</strong>
                <span>已收集 3 / 6</span>
              </div>
              <div class="demo__panel-bar"><i></i></div>
              <ul>
                <li class="demo__field demo__field--done anim-field" style="--d: 1300ms">
                  <i class="mark mark--done">✓</i>
                  <div><small>想解决的问题</small><strong>英文周会发言紧张卡壳</strong></div>
                </li>
                <li class="demo__field demo__field--done anim-field" style="--d: 1900ms">
                  <i class="mark mark--done">✓</i>
                  <div><small>学习动机</small><strong>项目汇报与晋升准备</strong></div>
                </li>
                <li class="demo__field demo__field--done anim-field" style="--d: 2200ms">
                  <i class="mark mark--done">✓</i>
                  <div><small>背景经验</small><strong>写过周报，也试着整理过英文会议要点</strong></div>
                </li>
                <li class="demo__field demo__field--asking anim-field" style="--d: 2500ms">
                  <i class="mark mark--asking"></i>
                  <div><small>期望周期</small><strong class="dim">正在聊…</strong></div>
                </li>
                <li class="demo__field anim-field" style="--d: 2600ms">
                  <i class="mark"></i>
                  <div><small>可用时间</small><strong class="dim">待补充</strong></div>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </main>

    <V2Footer />
  </div>
</template>

<script setup lang="ts">
import V2Footer from './V2Footer.vue';

</script>

<style scoped>
.auth { min-height: 100vh; position: relative; }
.auth__bg {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(560px 300px at 12% -4%, rgba(52, 120, 246, 0.07), transparent 60%),
    radial-gradient(480px 260px at 88% 104%, rgba(141, 107, 255, 0.06), transparent 60%);
  overflow: hidden;
}
.auth__bg::before,
.auth__bg::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.22;
  will-change: transform;
}
.auth__bg::before {
  width: 420px; height: 420px;
  top: -90px; right: -120px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.32), transparent 70%);
}
.auth__bg::after {
  width: 340px; height: 340px;
  bottom: -70px; left: -110px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.24), transparent 70%);
}
@media (prefers-reduced-motion: no-preference) {
  .auth__bg::before { animation: auth-orb-a 24s ease-in-out infinite; }
  .auth__bg::after { animation: auth-orb-b 28s ease-in-out infinite; }
}
@keyframes auth-orb-a {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-30px, 24px); }
}
@keyframes auth-orb-b {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(26px, -20px); }
}

.auth__main {
  position: relative;
  min-height: calc(100vh - 129px);
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 30px;
  padding: 48px 20px 40px;
}

.auth__logo { display: inline-flex; }
.auth__logo img { height: 52px; width: auto; display: block; }

/* ---------- 一体式双栏卡 ---------- */
.auth__card {
  width: min(820px, 100%);
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 2px 4px rgba(23, 32, 51, 0.04), 0 24px 60px rgba(23, 32, 51, 0.08);
  overflow: hidden;
}

/* 左：表单 */
.auth__form-side {
  padding: 28px 28px 22px;
  display: grid;
  gap: 18px;
  align-content: start;
}
.auth__back { font-size: 12.5px; font-weight: 600; color: var(--faint); text-decoration: none; justify-self: start; }
.auth__back:hover { color: var(--blue-deep); }
.auth__back--bottom { margin-top: 4px; }

/* 右：演示（柔和蓝调分区） */
.auth__demo-side {
  background:
    radial-gradient(320px 220px at 90% 0%, rgba(141, 107, 255, 0.1), transparent 65%),
    linear-gradient(160deg, rgba(52, 120, 246, 0.07), rgba(67, 176, 216, 0.04));
  border-left: 1px solid var(--line);
  padding: 26px 26px 28px;
  display: grid;
  align-content: center;
}
.demo { display: grid; gap: 16px; }
.demo__tagline {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.7;
  color: var(--ink);
  max-width: 30ch;
}

.demo__chat { display: grid; gap: 10px; }
.demo__msg { font-size: 13px; line-height: 1.6; }
.demo__msg--user {
  justify-self: end;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff;
  padding: 9px 13px;
  border-radius: 14px 14px 4px 14px;
  max-width: 88%;
  box-shadow: 0 6px 14px rgba(52, 120, 246, 0.22);
}
.demo__msg--ai { display: flex; gap: 9px; align-items: flex-start; }
.demo__msg--ai > div {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 4px 14px 14px 14px;
  padding: 9px 12px;
}
.demo__msg--ai p { margin: 0; color: var(--ink); }
.demo__avatar {
  width: 24px; height: 24px; border-radius: 8px;
  background: #fff; border: 1px solid var(--line);
  display: grid; place-items: center; flex: 0 0 auto;
}
.demo__avatar img { width: 16px; height: 16px; object-fit: contain; }
.demo__chips { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.demo__chip {
  font-size: 11px; font-weight: 600; color: var(--muted);
  border: 1px solid var(--line); background: #fff;
  padding: 4px 10px; border-radius: 999px;
}
.demo__chip--on {
  color: var(--blue-deep);
  border-color: rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.07);
}

.demo__panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 13px 15px;
  display: grid; gap: 9px;
}
.demo__panel-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.demo__panel-head span { font-size: 11px; font-weight: 800; color: var(--blue-deep); }
.demo__panel-bar { height: 5px; border-radius: 99px; background: #edf1f8; overflow: hidden; }
.demo__panel-bar i { display: block; width: 25%; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }.demo__panel ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.demo__field { display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: start; }
.demo__field small { display: block; font-size: 10.5px; color: var(--faint); font-weight: 700; }
.demo__field strong { display: block; font-size: 12px; font-weight: 600; }
.demo__field strong.dim { color: var(--faint); font-weight: 500; }
.mark {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px dashed #cfdaee;
  display: grid; place-items: center;
  font-size: 9px; font-style: normal;
}
.mark--done { background: var(--green); border: 0; color: #fff; }
.mark--asking { border: 2px solid var(--blue); }
.demo__field--asking {
  background: rgba(52, 120, 246, 0.06);
  border-radius: 8px;
  margin: -3px -6px;
  padding: 3px 6px;
}

/* ---------- 入场动画 ---------- */
.anim-msg {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
  animation: auth-rise 0.5s cubic-bezier(0.22, 0.9, 0.32, 1) forwards;
  animation-delay: var(--d, 0ms);
}
.anim-field {
  opacity: 0;
  transform: translateX(-6px);
  animation: auth-field-in 0.45s ease forwards;
  animation-delay: var(--d, 0ms);
}
.anim-field .mark--done {
  animation: auth-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  animation-delay: calc(var(--d, 0ms) + 100ms);
  transform: scale(0.4);
}
@keyframes auth-rise { to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes auth-field-in { to { opacity: 1; transform: translateX(0); } }
@keyframes auth-pop { to { transform: scale(1); } }

/* 整卡入场：上浮回正 + 进度条充能（reduced-motion 下瞬显） */
.auth__card {
  animation: auth-card-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes auth-card-in {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}
.demo__panel-bar i {
  animation:
    auth-bar-fill 1.6s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both,
    auth-bar-pulse 3.4s ease-in-out 2.4s infinite alternate;
}
@keyframes auth-bar-fill {
  from { width: 0; }
  to { width: 25%; }
}
@keyframes auth-bar-pulse {
  from { width: 25%; }
  to { width: 50%; }
}
.demo__field--asking .mark--asking {
  animation: auth-ask 2.2s ease-in-out 2.4s infinite;
}
@keyframes auth-ask {
  0%, 100% { box-shadow: 0 0 0 0 rgba(52, 120, 246, 0.3); }
  50% { box-shadow: 0 0 0 5px rgba(52, 120, 246, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .anim-msg, .anim-field, .anim-field .mark--done { animation: none; opacity: 1; transform: none; }
  .auth__card, .demo__panel-bar i,
  .demo__field--asking .mark--asking,
  .auth__bg::before, .auth__bg::after { animation: none; }
  .demo__panel-bar i { width: 25%; }
}

/* ---------- 移动端：上下堆叠 ---------- */
@media (max-width: 760px) {
  .auth__card { grid-template-columns: 1fr; }
  .auth__demo-side {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding: 20px 22px 22px;
  }
  .demo__tagline { font-size: 13px; }
  .auth__form-side { padding: 22px 20px 24px; }
}
@media (max-width: 480px) {
  .auth__demo-side { display: none; }
}

/* ---------- 超大屏（2K）：卡片与演示放大；2800+ 交由 v2.css zoom 机制，避免叠加 ---------- */
@media (min-width: 2000px) and (max-width: 2799px) {
  .auth__logo img { height: 64px; }
  .auth__main { gap: 36px; }
  .auth__card {
    width: min(1080px, 100%);
    border-radius: 26px;
  }
  .auth__form-side { padding: 36px 40px 28px; gap: 22px; }
  .auth__demo-side { padding: 36px 36px 38px; }
  .demo__tagline { font-size: 17px; }
  .demo__msg { font-size: 15px; }
  .demo__avatar { width: 28px; height: 28px; }
  .demo__chip { font-size: 12px; }
  .demo__panel { padding: 16px 18px; }
  .demo__panel-head { font-size: 13.5px; }
  .demo__field small { font-size: 12px; }
  .demo__field strong { font-size: 14px; }
  .auth__back { font-size: 14px; }
}
</style>
