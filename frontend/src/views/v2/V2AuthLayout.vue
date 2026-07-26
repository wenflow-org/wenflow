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
          <div class="auth__card-top">
            <span class="auth__pill">{{ mode === 'login' ? '登录' : '注册' }}</span>
            <router-link to="/" class="auth__back">← 返回首页</router-link>
          </div>
          <slot />
        </section>

        <aside class="auth__demo-side">
          <div class="demo">
            <p class="demo__tagline">说出你最近想解决的事，几轮对话后，得到今天就能开始的第一步。</p>

            <div class="demo__chat">
              <div class="demo__msg demo__msg--user anim-msg" style="--d: 400ms">我想用 Python 自动化处理 Excel 报表</div>
              <div class="demo__msg demo__msg--ai anim-msg" style="--d: 900ms">
                <span class="demo__avatar"><img src="/favicon.png" alt="问流" /></span>
                <div>
                  <p>每天处理报表时，最耗时的步骤是什么？</p>
                  <div class="demo__chips">
                    <span class="demo__chip demo__chip--on">数据清洗和合并</span>
                    <span class="demo__chip">生成图表报告</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="demo__panel">
              <div class="demo__panel-head">
                <strong>目标信息</strong>
                <span>已收集 2 / 8</span>
              </div>
              <div class="demo__panel-bar"><i></i></div>
              <ul>
                <li class="demo__field demo__field--done anim-field" style="--d: 1300ms">
                  <i class="mark mark--done">✓</i>
                  <div><small>想解决的问题</small><strong>手动处理报表耗时易错</strong></div>
                </li>
                <li class="demo__field demo__field--done anim-field" style="--d: 1900ms">
                  <i class="mark mark--done">✓</i>
                  <div><small>学习动机</small><strong>节省时间，提升效率</strong></div>
                </li>
                <li class="demo__field demo__field--asking anim-field" style="--d: 2400ms">
                  <i class="mark mark--asking"></i>
                  <div><small>当前水平</small><strong class="dim">正在聊…</strong></div>
                </li>
                <li class="demo__field anim-field" style="--d: 2500ms">
                  <i class="mark"></i>
                  <div><small>期望周期</small><strong class="dim">待补充</strong></div>
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
import './v2.css';

defineProps<{ mode: 'login' | 'register' }>();

</script>

<style scoped>
.auth { min-height: 100vh; position: relative; }
.auth__bg {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(560px 300px at 12% -4%, rgba(52, 120, 246, 0.07), transparent 60%),
    radial-gradient(480px 260px at 88% 104%, rgba(141, 107, 255, 0.06), transparent 60%);
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
  padding: 26px 28px 28px;
  display: grid;
  gap: 18px;
  align-content: start;
}
.auth__card-top { display: flex; align-items: center; justify-content: space-between; }
.auth__pill {
  font-size: 12px; font-weight: 800;
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.09);
  padding: 5px 12px; border-radius: 999px;
}
.auth__back { font-size: 12.5px; font-weight: 600; color: var(--faint); text-decoration: none; }
.auth__back:hover { color: var(--blue-deep); }

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
.demo__panel-bar i { display: block; width: 25%; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }
.demo__panel ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
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

.auth__foot { margin: 0; font-size: 11.5px; color: var(--faint); text-align: center; }

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
@media (prefers-reduced-motion: reduce) {
  .anim-msg, .anim-field, .anim-field .mark--done { animation: none; opacity: 1; transform: none; }
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
</style>
