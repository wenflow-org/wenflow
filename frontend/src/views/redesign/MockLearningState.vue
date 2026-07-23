<template>
  <div class="state">
    <MockNav active="state" />

    <main class="state__main">
      <!-- 页头 -->
      <div class="state__hero">
        <div>
          <span class="kicker">学习状态</span>
          <h1>状态不错，继续保持</h1>
          <p>基于最近 14 天的学习记录评估。数据为演示。</p>
        </div>
        <span class="btn-ghost" @click="labGo('paths')">查看学习路径</span>
      </div>

      <!-- 指标卡 -->
      <div class="metrics">
        <section v-for="m in metricCards" :key="m.label" class="card metric">
          <small>{{ m.label }}</small>
          <div class="metric__value" :style="{ color: m.color }">{{ m.value }}<i>{{ m.unit }}</i></div>
          <span class="metric__note" :class="`metric__note--${m.tone}`">{{ m.note }}</span>
        </section>
      </div>

      <div class="state__grid">
        <div class="state__col">
          <!-- 趋势图 -->
          <section class="card chart">
            <div class="card-head">
              <strong>学习投入趋势</strong>
              <div class="seg">
                <button type="button" :class="{ 'seg__item--on': range === 7 }" class="seg__item" @click="range = 7">近 7 天</button>
                <button type="button" :class="{ 'seg__item--on': range === 30 }" class="seg__item" @click="range = 30">近 30 天</button>
              </div>
            </div>
            <div class="chart__plot" :class="`chart__plot--${range}`">
              <div v-for="d in chartData" :key="d.label" class="chart__col" :title="`${d.label} · ${d.minutes}分钟`">
                <div class="chart__bar" :style="{ height: barHeight(d.minutes) }" :class="{ 'chart__bar--zero': d.minutes === 0 }"></div>
                <span class="chart__label">{{ d.label }}</span>
              </div>
            </div>
            <div class="chart__summary">
              <span>共 <b>{{ totalMinutes }}</b> 分钟</span>
              <span><b>{{ activeDays }}</b> 天有学习</span>
              <span>日均 <b>{{ avgMinutes }}</b> 分钟</span>
            </div>
          </section>

          <!-- AI 建议 -->
          <section class="card suggest">
            <div class="card-head"><strong>AI 建议</strong><span class="muted">3 条</span></div>
            <div class="suggest__list">
              <article v-for="s in suggestions" :key="s.id" class="sug" :class="{ 'sug--done': s.done }">
                <span class="sug__icon" :style="{ background: s.bg, color: s.ink }" v-html="s.icon"></span>
                <div class="sug__body">
                  <strong>{{ s.title }}</strong>
                  <p>{{ s.desc }}</p>
                </div>
                <span v-if="!s.done" class="sug__cta" @click="accept(s.id)">{{ s.cta }}</span>
                <span v-else class="sug__done">
                  <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                  {{ s.doneText }}
                </span>
              </article>
            </div>
          </section>
        </div>

        <!-- 侧栏 -->
        <aside class="side">
          <section class="card sidecard">
            <span class="kicker">学习偏好</span>
            <ul class="pref">
              <li><strong>适合的方式</strong><span>小步练手 + 即时反馈</span></li>
              <li><strong>已有基础</strong><span>Excel 熟练，编程零基础</span></li>
              <li><strong>建议先补</strong><span>无，按当前路径推进即可</span></li>
            </ul>
          </section>
          <section class="card sidecard">
            <span class="kicker">指标说明</span>
            <ul class="legend">
              <li><b class="dot dot--green"></b>整体状态：节奏、负荷、掌握的综合分</li>
              <li><b class="dot dot--blue"></b>学习压力：任务量与时间预算的比值</li>
              <li><b class="dot dot--purple"></b>掌握趋势：知识点掌握数的变化</li>
              <li><b class="dot dot--amber"></b>疲劳程度：连续高强度学习的天数</li>
            </ul>
          </section>
        </aside>
      </div>
    </main>
    <MockFooter />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import MockNav from './MockNav.vue';
import MockFooter from './MockFooter.vue';
import { labGo } from './labStore';

const metricCards = [
  { label: '整体状态', value: '72', unit: ' 分', note: '良好', tone: 'green', color: '#31b16f' },
  { label: '学习压力', value: '35', unit: ' 分', note: '适中', tone: 'blue', color: '#3478f6' },
  { label: '掌握趋势', value: '+8', unit: ' 分', note: '上升', tone: 'purple', color: '#8d6bff' },
  { label: '疲劳程度', value: '28', unit: ' 分', note: '较低', tone: 'amber', color: '#d9932e' }
];

const range = ref<7 | 30>(7);

const days7 = [
  { label: '一', minutes: 35 }, { label: '二', minutes: 0 }, { label: '三', minutes: 50 },
  { label: '四', minutes: 0 }, { label: '五', minutes: 20 }, { label: '六', minutes: 65 },
  { label: '日', minutes: 0 }
];

const days30 = Array.from({ length: 30 }, (_, i) => {
  const map: Record<number, number> = { 2: 30, 3: 15, 6: 25, 9: 40, 11: 20, 13: 35, 15: 50, 17: 20, 18: 65, 22: 30, 27: 45 };
  return { label: String(i + 1), minutes: map[i + 1] ?? 0 };
});

const chartData = computed(() => (range.value === 7 ? days7 : days30));
const totalMinutes = computed(() => chartData.value.reduce((s, d) => s + d.minutes, 0));
const activeDays = computed(() => chartData.value.filter((d) => d.minutes > 0).length);
const avgMinutes = computed(() => Math.round(totalMinutes.value / chartData.value.length));

function barHeight(m: number) {
  if (m <= 0) return '6px';
  return `${Math.max(14, Math.round((m / 65) * 120))}px`;
}

const svgBulb = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1zm3-19a7 7 0 0 0-4 12.74c.6.52 1 1.31 1 2.26v1h6v-1c0-.95.4-1.74 1-2.26A7 7 0 0 0 12 2z"/></svg>';
const svgFlame = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67z"/></svg>';
const svgGauge = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4a8 8 0 0 0-8 8 8 8 0 0 0 1.17 4.17l1.5-1.5A6 6 0 1 1 18 12c0 1.3-.42 2.5-1.13 3.47l1.46 1.46A8 8 0 0 0 12 4zm-1 5h2v5h-2V9z"/></svg>';

const suggestions = ref([
  { id: 'time', title: '换个时间段试试', desc: '你最近 3 次都在 21 点后学习。午后的大脑状态更适合新语法，建议今天 25 分钟放在下午。', cta: '加入今日计划', doneText: '已加入', done: false, bg: 'rgba(52,120,246,.12)', ink: '#1f57cc', icon: svgBulb },
  { id: 'streak', title: '连续记录快断了', desc: '已连续 2 天，今天再学 25 分钟就能续上第 3 天，离「七日不断」成就还差 5 天。', cta: '查看成就', doneText: '已查看', done: false, bg: 'rgba(244,170,70,.16)', ink: '#b3540a', icon: svgFlame },
  { id: 'load', title: '负荷在健康区间', desc: '近 7 天共 170 分钟，符合「每天 1 小时」的预算。保持这个节奏，不用加量。', cta: '知道了', doneText: '已了解', done: false, bg: 'rgba(49,177,111,.12)', ink: '#1d7a4c', icon: svgGauge }
]);

function accept(id: string) {
  const s = suggestions.value.find((x) => x.id === id);
  if (!s) return;
  s.done = true;
  if (id === 'streak') labGo('achievements');
}
</script>

<style scoped>
.state__main {
  max-width: 1080px; margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid; gap: 16px;
}
.state__hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.kicker { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }
.state__hero h1 { margin: 6px 0 4px; font-size: 28px; letter-spacing: -0.01em; }
.state__hero p { margin: 0; font-size: 13.5px; color: var(--muted); }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}
.card-head { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.muted { font-size: 12px; color: var(--faint); }
.btn-ghost {
  padding: 10px 18px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}

.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.metric { padding: 16px 18px; display: grid; gap: 8px; }
.metric small { font-size: 12px; color: var(--faint); font-weight: 700; }
.metric__value { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.metric__value i { font-size: 13px; font-style: normal; font-weight: 600; color: var(--faint); }
.metric__note { width: fit-content; font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 999px; }
.metric__note--green { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.metric__note--blue { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }
.metric__note--purple { color: var(--accent); background: rgba(141, 107, 255, 0.12); }
.metric__note--amber { color: #b3540a; background: rgba(244, 170, 70, 0.16); }

.state__grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.state__col { display: grid; gap: 16px; }

/* ---------- 趋势图 ---------- */
.chart { padding: 20px 22px; display: grid; gap: 16px; }
.seg { display: inline-flex; padding: 3px; background: #eef2fa; border-radius: 10px; gap: 2px; }
.seg__item {
  border: 0; background: transparent; padding: 5px 11px; border-radius: 8px;
  font: inherit; font-size: 12px; font-weight: 700; color: var(--muted); cursor: pointer;
}
.seg__item--on { background: #fff; color: var(--ink); box-shadow: 0 1px 3px rgba(23, 32, 51, 0.12); }
.chart__plot {
  display: grid;
  grid-auto-flow: column;
  align-items: end;
  gap: 8px;
  height: 160px;
  padding-top: 10px;
}
.chart__plot--30 { gap: 3px; }
.chart__col { display: grid; gap: 6px; justify-items: center; align-content: end; height: 100%; }
.chart__bar {
  width: 100%; max-width: 34px;
  border-radius: 7px 7px 3px 3px;
  background: linear-gradient(180deg, var(--blue), rgba(52, 120, 246, 0.55));
  transition: height .3s ease;
}
.chart__bar--zero { background: #edf1f8; }
.chart__col:hover .chart__bar { filter: brightness(1.12); }
.chart__label { font-size: 10.5px; color: var(--faint); }
.chart__plot--30 .chart__label:nth-child(even) { visibility: hidden; }
.chart__summary { display: flex; gap: 18px; font-size: 12px; color: var(--muted); border-top: 1px dashed var(--line); padding-top: 12px; }
.chart__summary b { color: var(--ink); }

/* ---------- AI 建议 ---------- */
.suggest { padding: 20px 22px; display: grid; gap: 14px; }
.suggest__list { display: grid; gap: 10px; }
.sug {
  display: grid; grid-template-columns: 38px 1fr auto;
  align-items: center; gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 13px;
  transition: .15s ease;
}
.sug--done { opacity: .66; background: #fafcff; }
.sug__icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; }
.sug__body strong { font-size: 13.5px; }
.sug__body p { margin: 3px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.6; }
.sug__cta {
  font-size: 12px; font-weight: 800; color: var(--blue-deep);
  border: 1px solid rgba(52, 120, 246, 0.4);
  background: rgba(52, 120, 246, 0.06);
  padding: 7px 13px; border-radius: 999px;
  cursor: pointer; white-space: nowrap;
}
.sug__cta:hover { background: rgba(52, 120, 246, 0.12); }
.sug__done {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 800; color: var(--green);
  white-space: nowrap;
}

/* ---------- 侧栏 ---------- */
.side { display: grid; gap: 12px; position: sticky; top: 16px; }
.sidecard { padding: 16px 18px; display: grid; gap: 10px; }
.pref, .legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.pref li { display: grid; gap: 2px; }
.pref strong { font-size: 12.5px; }
.pref span { font-size: 12px; color: var(--muted); }
.legend li { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
.dot--green { background: #31b16f; }
.dot--blue { background: #3478f6; }
.dot--purple { background: #8d6bff; }
.dot--amber { background: #f4aa46; }

@media (max-width: 900px) {
  .state__main { padding: 16px 14px 32px; }
  .state__hero h1 { font-size: 22px; }
  .metrics { grid-template-columns: repeat(2, 1fr); }
  .state__grid { grid-template-columns: 1fr; }
  .side { position: static; }
}
</style>
