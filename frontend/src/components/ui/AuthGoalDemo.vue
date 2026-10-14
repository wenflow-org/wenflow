<template>
  <div class="demo">
    <p class="demo__tagline">说说你最近想解决的事，几轮对话后，得到今天就能开始的第一步。</p>

    <div class="demo__chat">
      <div class="demo__msg demo__msg--user anim-msg" style="--d: 400ms">每周英文周会发言总是磕绊，想练职场英语</div>
      <div class="demo__msg demo__msg--ai anim-msg" style="--d: 900ms">
        <span class="demo__avatar"><img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" /></span>
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
</template>

<script setup lang="ts">
/* 认证页右侧产品演示（目标对话两轮 + 目标信息收集）：登录/注册/重置（V2AuthLayout）
   与管理端登录（admin-redesign/Login）共用同一套——2026-10-14 用户拍板「保持用户侧一样」，
   管理端此前的自创「安全机制」三条面板（审核 #26）整层退役。
   样式自包含：宿主只负责 aside 的底色/边框/内边距。 */
import { useIsDark } from '@/composables/useIsDark';

const isDark = useIsDark();
</script>

<style scoped>
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
  /* 原注释（走查 2026-09-27 P3）：渐变浅端混 20% 深蓝是因为纯 --blue 偏浅、白字对比度不足。
     现在改回纯色 --blue 仍达标——#2f6ae0 上白字对比度约 4.9:1（AA 需 4.5:1），
     渐变随之退役；下方 22% 蓝色发光投影也一并删掉。 */
  background: var(--blue);
  color: var(--wf-text-on-primary);
  padding: 9px 13px;
  border-radius: 16px 16px 4px 16px;
  max-width: 88%;
}
.demo__msg--ai { display: flex; gap: 9px; align-items: flex-start; }
.demo__msg--ai > div {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 4px 16px 16px 16px;
  padding: 9px 12px;
}
.demo__msg--ai p { margin: 0; color: var(--ink); }
.demo__avatar {
  width: 24px; height: 24px; border-radius: var(--mk-radius-md);
  background: var(--surface); border: 1px solid var(--line);
  display: grid; place-items: center; flex: 0 0 auto;
}
.demo__avatar img { width: 16px; height: 16px; object-fit: contain; }
.demo__chips { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.demo__chip {
  font-size: 12px; font-weight: 600; color: var(--muted);
  border: 1px solid var(--line); background: var(--surface);
  padding: 4px 10px; border-radius: var(--mk-radius-pill);
}
.demo__chip--on {
  color: var(--blue-deep);
  border-color: color-mix(in srgb, var(--blue) 40%, transparent);
  background: color-mix(in srgb, var(--blue) 7%, transparent);
}

.demo__panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px; /* 圆角阶梯：面板 */
  padding: 13px 15px;
  display: grid; gap: 9px;
}
.demo__panel-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.demo__panel-head span { font-size: 12px; font-weight: 800; color: var(--blue-deep); }
.demo__panel-bar { height: 5px; border-radius: 999px; background: var(--bar-track); overflow: hidden; }
.demo__panel-bar i { display: block; width: 25%; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }
.demo__panel ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.demo__field { display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: start; }
.demo__field small { display: block; font-size: 12px; color: var(--faint); font-weight: 700; }
.demo__field strong { display: block; font-size: 12px; font-weight: 600; }
.demo__field strong.dim { color: var(--faint); font-weight: 500; }
.mark {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px dashed color-mix(in srgb, var(--blue) 15%, var(--line));
  display: grid; place-items: center;
  font-size: 12px; font-style: normal;
}
.mark--done { background: var(--mk-green-fill); border: 0; color: var(--wf-text-on-primary); }
.mark--asking { border: 2px solid var(--blue); }
.demo__field--asking {
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  border-radius: var(--mk-radius-md);
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
.demo__panel-bar i {
  animation:
    auth-bar-fill 1.6s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both,
    /* 限 3 次循环：装饰动画无限循环会持续分散注意力（走查 2026-09-27 P3；reduced-motion 已另行兜底） */
    auth-bar-pulse 3.4s ease-in-out 2.4s 3 alternate;
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
  /* 同上：限 3 次后停（走查 2026-09-27 P3） */
  animation: auth-ask 2.2s ease-in-out 2.4s 3;
}
@keyframes auth-ask {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--blue) 30%, transparent); }
  50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--blue) 0%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .anim-msg, .anim-field, .anim-field .mark--done { animation: none; opacity: 1; transform: none; }
  .demo__panel-bar i,
  .demo__field--asking .mark--asking { animation: none; }
  .demo__panel-bar i { width: 25%; }
}

/* ---------- 移动端 ---------- */
@media (max-width: 900px) {
  .demo__tagline { font-size: 13px; }
}

/* ---------- 桌面基线（≥1101）：演示面板字级与表单侧同档起步 ----------
   表单侧在 v2.css 有 ≥1101 抬档（「1080p 不太清楚」），演示面板此前唯一放大档是
   2000+——1920 下同一张卡里左边 22px 标题、右边 10.5px 字段/9px 勾选圈
   （走查 2026-09-27 P1）。2000+ 档在下方保持原有更大值，不受本块影响。 */
@media (min-width: 1101px) {
  .demo__tagline { font-size: 15px; }
  .demo__msg { font-size: 14px; }
  .demo__chip { font-size: 12px; }
  .demo__panel-head { font-size: 13px; }
  .demo__panel-head span { font-size: 12px; }
  .demo__field small { font-size: 12px; }
  .demo__field strong { font-size: 13.5px; }
  .mark { font-size: 12px; }
}

/* ---------- 超大屏（2K）：演示同步放大；2800+ 交由 v2.css zoom 机制 ---------- */
@media (min-width: 2000px) and (max-width: 2799px) {
  .demo__tagline { font-size: 17px; }
  .demo__msg { font-size: 15px; }
  .demo__avatar { width: 28px; height: 28px; }
  .demo__chip { font-size: 12px; }
  .demo__panel { padding: 16px 18px; }
  .demo__panel-head { font-size: 13.5px; }
  .demo__field small { font-size: 12px; }
  .demo__field strong { font-size: 14px; }
}

/* ---------- 暗色模式：芯片/底色直引 var(--surface) 随主题翻转，只有勾选圈边框需覆写 ---------- */
[data-theme='dark'] .mark { border-color: var(--line); }
</style>
