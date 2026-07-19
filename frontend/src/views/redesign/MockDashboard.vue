<template>
  <div class="dash">
    <!-- 应用导航（与线上一致，静态 mock） -->
    <header class="nav">
      <div class="nav__brand">
        <span class="nav__logo">W</span>
        <span class="nav__name">问流 WenFlow</span>
      </div>
      <nav class="nav__links">
        <a class="active">学习台</a>
        <a>目标规划</a>
        <a>学习路径</a>
        <a>学习状态</a>
        <a>成就</a>
      </nav>
      <div class="nav__right">
        <span class="nav__cta">＋ 规划新目标</span>
        <span class="nav__avatar"><i>1</i>123</span>
      </div>
    </header>

    <main class="dash__main">
      <!-- 压缩问候栏 -->
      <div class="greet">
        <div class="greet__left">
          <strong>下午好，123</strong>
          <span class="greet__dot"></span>
          <span>7月19日 周日</span>
        </div>
        <div v-if="state !== 'empty'" class="streak" title="连续学习天数">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>
          连续 2 天 · 今天还没开始
        </div>
      </div>

      <!-- 主区：今日行动 + 路径进度 -->
      <div class="dash__grid-main" :class="`dash__grid-main--${state}`">
        <!-- 进行中：今日行动卡 -->
        <section v-if="state === 'active'" class="card action">
          <div class="action__eyebrow">
            <span>今日行动</span>
            <span class="action__from">来自路径「Excel 报表自动化」</span>
          </div>
          <h1 class="action__title">用 pandas 读取销售报表，预览前 5 行数据</h1>
          <p class="action__desc">三行代码读完一个 Excel 文件。学完这一步，你就拿到了自动化的第一块积木。</p>
          <div class="action__meta">
            <span class="tag tag--blue">阶段 2 / 4</span>
            <span class="tag">约 25 分钟</span>
            <span class="tag">练手任务</span>
          </div>
          <div class="action__footer">
            <span class="btn-primary">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
              开始学习
            </span>
            <span class="btn-ghost">换一个</span>
            <span class="link-muted">今天休息</span>
          </div>
          <div class="action__today">
            <div class="action__today-bar"><i style="width: 0%"></i></div>
            <span>今日已学 0 / 25 分钟</span>
          </div>
        </section>

        <!-- 需要处理：修复卡 -->
        <section v-else-if="state === 'attention'" class="card action action--alert">
          <div class="action__eyebrow action__eyebrow--alert">
            <span>需要先处理</span>
            <span class="action__from">路径「Excel 报表自动化」</span>
          </div>
          <h1 class="action__title">这版路径没生成出来，重试一般能好</h1>
          <p class="action__desc">主结构生成失败（服务响应异常）。你的目标和已确认信息都保留着，不会丢。</p>
          <div class="action__meta">
            <span class="tag tag--red">生成失败</span>
            <span class="tag">已自动重试 1 次</span>
            <span class="tag">信息已保留</span>
          </div>
          <div class="action__footer">
            <span class="btn-primary">重新生成路径</span>
            <span class="btn-ghost">查看失败详情</span>
            <span class="link-muted">先修改目标</span>
          </div>
        </section>

        <!-- 新手态：引导卡 -->
        <section v-else class="card action action--empty">
          <div class="action__eyebrow"><span>开始你的第一个学习计划</span></div>
          <h1 class="action__title">用 2 分钟，聊出一条能执行的路径</h1>
          <p class="action__desc">不用整理、不用说得很准。讲讲最近想解决的事，问流会帮你收敛成目标和阶段安排。</p>
          <div class="action__examples">
            <span class="example">用 Python 自动化处理 Excel 报表</span>
            <span class="example">提升职场沟通和表达能力</span>
            <span class="example">用 AI 工具做自媒体副业</span>
          </div>
          <div class="action__footer">
            <span class="btn-primary">开始规划目标</span>
            <span class="link-muted">先看看路径长什么样</span>
          </div>
        </section>

        <!-- 路径进度卡 -->
        <aside v-if="state !== 'empty'" class="card path">
          <div class="path__head">
            <div class="path__title">
              <strong>Excel 报表自动化</strong>
              <span class="path__sub">每天 1 小时 · 目标 1 周</span>
            </div>
            <span class="badge" :class="state === 'attention' ? 'badge--red' : 'badge--blue'">
              {{ state === 'attention' ? '需要处理' : '进行中' }}
            </span>
          </div>
          <ol class="steps">
            <li class="step step--done">
              <span class="step__dot"></span>
              <div class="step__body">
                <strong>Python 环境搭建与基础概念</strong>
                <small>已完成 · 用时 40 分钟</small>
              </div>
            </li>
            <li class="step" :class="state === 'attention' ? 'step--blocked' : 'step--current'">
              <span class="step__dot"></span>
              <div class="step__body">
                <strong>pandas 读取单个 Excel 文件</strong>
                <small>{{ state === 'attention' ? '等待路径生成完成' : '进行中 · 今天从这里开始' }}</small>
              </div>
            </li>
            <li class="step">
              <span class="step__dot"></span>
              <div class="step__body">
                <strong>将数据写入 / 追加到汇总表</strong>
                <small>未开始</small>
              </div>
            </li>
            <li class="step">
              <span class="step__dot"></span>
              <div class="step__body">
                <strong>封装脚本并测试</strong>
                <small>未开始</small>
              </div>
            </li>
          </ol>
          <div class="path__foot">
            <div class="path__progress"><i :style="{ width: state === 'attention' ? '25%' : '40%' }"></i></div>
            <div class="path__nums">
              <span>整体 {{ state === 'attention' ? '25%' : '40%' }}</span>
              <span>预计还需 4.5 小时</span>
            </div>
          </div>
        </aside>

        <!-- 新手态路径占位卡 -->
        <aside v-else class="card path path--empty">
          <div class="path__head">
            <div class="path__title"><strong>还没有学习路径</strong></div>
          </div>
          <div class="path__empty-body">
            <div class="path__empty-illus">
              <span></span><span></span><span></span><span></span>
            </div>
            <p>规划第一个目标后，这里会出现你的阶段地图。</p>
          </div>
        </aside>
      </div>

      <!-- 本周节奏 + 激励区 -->
      <div class="dash__grid-week">
        <section class="card week">
          <div class="card-head">
            <strong>本周节奏</strong>
            <span class="link-muted">展开整月 ›</span>
          </div>
          <div v-if="state !== 'empty'" class="week__grid">
            <div v-for="d in week" :key="d.label" class="day" :class="{ 'day--today': d.today }">
              <span class="day__label">{{ d.label }}</span>
              <span class="day__cell" :style="{ background: d.color, color: d.ink }">{{ d.minutes || '' }}</span>
              <span class="day__min">{{ d.minutes ? d.minutes + '分' : '—' }}</span>
            </div>
          </div>
          <div v-else class="week__empty">
            完成第一次学习后，这里会点亮你的节奏。
          </div>
          <div v-if="state !== 'empty'" class="week__stats">
            <span>本周 <b>170</b> 分钟</span>
            <span><b>4</b> 天有学习</span>
            <span>比上周多 <b>35</b> 分钟</span>
          </div>
        </section>

        <div class="side-stack">
          <section class="card mini">
            <div class="mini__icon mini__icon--flame">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>
            </div>
            <div>
              <strong>{{ state === 'empty' ? '点亮第一天' : '连续 2 天' }}</strong>
              <p>{{ state === 'empty' ? '今天学 10 分钟，开始连续记录' : '今天再学 25 分钟，续上第 3 天' }}</p>
            </div>
          </section>
          <section class="card mini">
            <div class="mini__icon mini__icon--medal">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V22l4-2 4 2v-7.26A7 7 0 0 0 12 2zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>
            </div>
            <div>
              <strong>成就「小步快跑」</strong>
              <p>{{ state === 'empty' ? '完成 3 次学习即可解锁' : '再完成 1 次学习即可解锁' }}</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ state: 'active' | 'attention' | 'empty' }>();

const heat = (m: number) => {
  if (m <= 0) return { color: '#eef2f8', ink: 'transparent' };
  if (m < 30) return { color: 'rgba(52,120,246,.20)', ink: '#1f57cc' };
  if (m < 60) return { color: 'rgba(52,120,246,.45)', ink: '#10337e' };
  return { color: 'rgba(52,120,246,.85)', ink: '#fff' };
};

const rawWeek = [
  { label: '一', minutes: 35 },
  { label: '二', minutes: 0 },
  { label: '三', minutes: 50 },
  { label: '四', minutes: 0 },
  { label: '五', minutes: 20 },
  { label: '六', minutes: 65 },
  { label: '日', minutes: 0, today: true }
];

const week = computed(() =>
  rawWeek.map((d) => ({ ...d, ...heat(props.state === 'empty' ? 0 : d.minutes) }))
);
</script>

<style scoped>
/* ---------- 导航（与线上一致） ---------- */
.nav {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 0 28px;
  height: 60px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--line);
}

.nav__brand {
  display: flex;
  align-items: center;
  gap: 9px;
}

.nav__logo {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--blue), var(--accent));
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  display: grid;
  place-items: center;
}

.nav__name {
  font-weight: 700;
  font-size: 14px;
}

.nav__links {
  display: flex;
  gap: 4px;
  flex: 1;
}

.nav__links a {
  padding: 7px 12px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
}

.nav__links a.active {
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.09);
}

.nav__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav__cta {
  padding: 8px 16px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 8px 18px rgba(52, 120, 246, 0.28);
  cursor: pointer;
}

.nav__avatar {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
}

.nav__avatar i {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--blue-deep);
  color: #fff;
  font-style: normal;
  font-size: 12px;
  display: grid;
  place-items: center;
}

/* ---------- 布局 ---------- */
.dash__main {
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px 28px 40px;
  display: grid;
  gap: 16px;
}

.greet {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}

.greet__left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--muted);
}

.greet__left strong {
  font-size: 16px;
  color: var(--ink);
}

.greet__dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--faint);
}

.streak {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #b3540a;
  background: rgba(244, 170, 70, 0.16);
  border: 1px solid rgba(244, 170, 70, 0.35);
  padding: 5px 11px;
  border-radius: 999px;
}

/* ---------- 卡片基座 ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}

.link-muted {
  font-size: 13px;
  font-weight: 600;
  color: var(--faint);
  cursor: pointer;
}

/* ---------- 主区 ---------- */
.dash__grid-main {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}

.action {
  padding: 26px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  overflow: hidden;
}

.action::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: linear-gradient(180deg, var(--blue), var(--accent));
}

.action--alert::before {
  background: linear-gradient(180deg, var(--red), var(--amber));
}

.action--empty::before {
  background: linear-gradient(180deg, var(--cyan), var(--blue));
}

.action__eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--blue-deep);
}

.action__eyebrow--alert {
  color: #c0454a;
}

.action__from {
  font-weight: 600;
  letter-spacing: 0;
  color: var(--faint);
}

.action__title {
  margin: 0;
  font-size: 26px;
  line-height: 1.3;
  letter-spacing: -0.01em;
}

.action__desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted);
  max-width: 56ch;
}

.action__meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tag {
  padding: 5px 11px;
  border-radius: 999px;
  background: #f1f5fb;
  border: 1px solid var(--line);
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.tag--blue {
  background: rgba(52, 120, 246, 0.09);
  border-color: rgba(52, 120, 246, 0.3);
  color: var(--blue-deep);
}

.tag--red {
  background: rgba(239, 117, 120, 0.1);
  border-color: rgba(239, 117, 120, 0.35);
  color: #c0454a;
}

.action__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 11px 22px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
  cursor: pointer;
}

.btn-ghost {
  padding: 10px 18px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: #fff;
  font-size: 14px;
  font-weight: 700;
  color: var(--muted);
  cursor: pointer;
}

.action__today {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--faint);
}

.action__today-bar {
  width: 120px;
  height: 6px;
  border-radius: 99px;
  background: #edf1f8;
  overflow: hidden;
}

.action__today-bar i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--blue), var(--cyan));
}

.action__examples {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.example {
  padding: 9px 14px;
  border-radius: 12px;
  border: 1px dashed rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.05);
  color: var(--blue-deep);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

/* ---------- 路径进度卡 ---------- */
.path {
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.path__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.path__title strong {
  font-size: 16px;
}

.path__sub {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--faint);
}

.badge {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
}

.badge--blue {
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.1);
}

.badge--red {
  color: #c0454a;
  background: rgba(239, 117, 120, 0.12);
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}

.step {
  display: grid;
  grid-template-columns: 18px 1fr;
  gap: 10px;
  position: relative;
  padding-bottom: 16px;
}

.step:last-child {
  padding-bottom: 0;
}

.step::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 18px;
  bottom: 0;
  width: 2px;
  background: #e7edf7;
}

.step:last-child::before {
  display: none;
}

.step__dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #d4deee;
  background: #fff;
  margin-top: 1px;
  position: relative;
  z-index: 1;
}

.step--done .step__dot {
  border-color: var(--green);
  background: var(--green);
  box-shadow: inset 0 0 0 3px #fff;
}

.step--done::before {
  background: var(--green);
}

.step--current .step__dot {
  border-color: var(--blue);
  box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.15);
}

.step--blocked .step__dot {
  border-color: var(--red);
  box-shadow: 0 0 0 4px rgba(239, 117, 120, 0.14);
}

.step__body strong {
  display: block;
  font-size: 13.5px;
  line-height: 1.4;
}

.step__body small {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--faint);
}

.step--current .step__body small {
  color: var(--blue-deep);
  font-weight: 600;
}

.path__foot {
  border-top: 1px solid var(--line);
  padding-top: 12px;
  display: grid;
  gap: 8px;
}

.path__progress {
  height: 8px;
  border-radius: 99px;
  background: #edf1f8;
  overflow: hidden;
}

.path__progress i {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--blue), var(--cyan));
}

.path__nums {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
}

.path--empty {
  justify-content: flex-start;
}

.path__empty-body {
  flex: 1;
  display: grid;
  place-content: center;
  gap: 14px;
  text-align: center;
  color: var(--faint);
  font-size: 13px;
  padding: 24px 0;
}

.path__empty-illus {
  display: flex;
  gap: 6px;
  justify-content: center;
}

.path__empty-illus span {
  width: 26px;
  height: 8px;
  border-radius: 99px;
  background: #e7edf7;
}

.path__empty-illus span:nth-child(1) { background: rgba(49, 177, 111, 0.4); }
.path__empty-illus span:nth-child(2) { background: rgba(52, 120, 246, 0.4); }

/* ---------- 本周节奏 ---------- */
.dash__grid-week {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 16px;
}

.week {
  padding: 20px 22px;
  display: grid;
  gap: 14px;
  align-content: start;
}

.week__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
}

.day {
  display: grid;
  gap: 6px;
  justify-items: center;
  padding: 8px 4px 10px;
  border-radius: 12px;
  border: 1px solid transparent;
}

.day--today {
  border-color: rgba(52, 120, 246, 0.45);
  background: rgba(52, 120, 246, 0.05);
}

.day__label {
  font-size: 11px;
  color: var(--faint);
  font-weight: 700;
}

.day__cell {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 800;
}

.day__min {
  font-size: 11px;
  color: var(--faint);
}

.week__empty {
  padding: 26px 0;
  text-align: center;
  color: var(--faint);
  font-size: 13px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  background: #fafcff;
}

.week__stats {
  display: flex;
  gap: 18px;
  font-size: 12px;
  color: var(--muted);
}

.week__stats b {
  color: var(--ink);
}

/* ---------- 激励小卡 ---------- */
.side-stack {
  display: grid;
  gap: 16px;
  align-content: start;
}

.mini {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
}

.mini__icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.mini__icon--flame {
  color: #d9741a;
  background: rgba(244, 170, 70, 0.16);
}

.mini__icon--medal {
  color: var(--accent);
  background: rgba(141, 107, 255, 0.13);
}

.mini strong {
  font-size: 14px;
}

.mini p {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--muted);
}

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .nav__links { display: none; }
  .dash__grid-main,
  .dash__grid-week {
    grid-template-columns: 1fr;
  }
  .action__title { font-size: 21px; }
  .dash__main { padding: 16px 14px 32px; }
  .greet { flex-direction: column; align-items: flex-start; gap: 8px; }
}
</style>
