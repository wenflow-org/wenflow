<template>
  <div class="brief">
    <!-- 结论先行：今日简报 -->
    <header class="brief-head" :class="`brief-head--${data.tone}`">
      <div class="brief-head__verdict">
        <div class="brief-score" :style="{ '--pct': data.score }">
          <svg viewBox="0 0 44 44">
            <circle class="brief-score__track" cx="22" cy="22" r="19" />
            <circle class="brief-score__bar" cx="22" cy="22" r="19" :stroke-dasharray="scoreDash" />
          </svg>
          <strong>{{ data.score }}</strong>
        </div>
        <div>
          <h3>{{ health.headline }}</h3>
          <p>{{ health.subline }}</p>
        </div>
      </div>
      <ul v-if="data.actions.length" class="brief-actions">
        <li v-for="(a, i) in data.actions" :key="i">
          <span class="brief-actions__dot" :class="`brief-actions__dot--${a.tone}`"></span>
          <span class="brief-actions__text">{{ a.text }}</span>
          <button type="button" class="brief-actions__link" @click="investigateAgent(a.agentId)">{{ a.link }} →</button>
        </li>
      </ul>
      <p v-else class="brief-actions__clear">没有需要立即处理的事项。</p>
    </header>

    <div class="brief-grid">
      <!-- 学习漏斗 -->
      <section class="brief-card">
        <h4>学习漏斗</h4>
        <div class="funnel">
          <template v-for="(n, i) in data.funnel" :key="n.label">
            <div class="funnel__node" :class="{ 'funnel__node--idle': n.idle }">
              <span>{{ n.label }}</span>
              <strong>{{ n.value }}</strong>
            </div>
            <span v-if="i < data.funnel.length - 1" class="funnel__rate">{{ data.rates[i] }}</span>
          </template>
        </div>
        <p class="brief-card__note">{{ data.funnelNote }}</p>
      </section>

      <!-- 系统脉搏 -->
      <section class="brief-card">
        <h4>24h 系统脉搏</h4>
        <div class="pulse">
          <div
            v-for="(b, i) in data.pulse"
            :key="i"
            class="pulse__bar"
            :class="{ 'pulse__bar--issue': b.issue, 'pulse__bar--idle': !b.calls }"
            :style="{ height: barHeight(b.calls) }"
              :title="barTitle(i, b)"
          ></div>
        </div>
        <div class="pulse__meta">
          <span>总调用 <strong>{{ data.totalCalls }}</strong></span>
          <span>异常 <strong :class="{ 'is-bad': data.totalIssues > 0 }">{{ data.totalIssues }}</strong></span>
          <span>高峰 {{ data.peak }}</span>
        </div>
      </section>

      <!-- 动态时间线 -->
      <section class="brief-card brief-card--feed">
        <h4>动态</h4>
        <ul v-if="data.feed.length" class="feed">
          <li v-for="(f, i) in data.feed" :key="i">
            <span class="feed__dot" :class="`feed__dot--${f.tone}`"></span>
            <div>
              <strong>{{ f.text }}</strong>
              <span>{{ f.time }}</span>
            </div>
          </li>
        </ul>
        <p v-else class="feed__empty">还没有动态。第一条会来自第一个真实学习者。</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { overviewHealth, investigateAgent } from './mockStore';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

interface BriefData {
  tone: Tone;
  score: number;
  headline: string;
  subline: string;
  actions: { text: string; link: string; tone: Tone; agentId: string }[];
  funnel: { label: string; value: string; idle: boolean }[];
  rates: string[];
  funnelNote: string;
  pulse: { calls: number; issue: number }[];
  totalCalls: number;
  totalIssues: number;
  peak: string;
  feed: { text: string; time: string; tone: Tone }[];
}

const props = defineProps<{ state: 'normal' | 'incident' | 'fresh' }>();

// 结论来自 mockStore（由 spans 推导，与日志/瀑布/Skill 同源）；funnel/pulse/feed 为静态演示
const health = computed(() => overviewHealth.value);

const pulse = (hot: number[]) =>
  Array.from({ length: 24 }, (_, i) => ({
    calls: hot[i] || 0,
    issue: 0
  }));

const datasets: Record<string, BriefData> = {
  normal: {
    tone: 'ok',
    score: 92,
    headline: '运行平稳',
    subline: '学习链路与模型服务都在正常区间。',
    actions: [],
    funnel: [
      { label: '用户', value: '128', idle: false },
      { label: '目标', value: '86', idle: false },
      { label: '路径', value: '64', idle: false },
      { label: '任务', value: '342', idle: false },
      { label: '完成', value: '217', idle: false }
    ],
    rates: ['67%', '74%', '×5.3', '63%'],
    funnelNote: '目标 → 路径转化 74%，断点不明显。',
    pulse: pulse([2, 1, 0, 0, 1, 3, 6, 9, 14, 18, 22, 19, 16, 21, 25, 28, 24, 19, 15, 12, 8, 5, 4, 3]),
    totalCalls: 273,
    totalIssues: 0,
    peak: '15:00',
    feed: [
      { text: '「数据分析入门」路径第 3 阶段完成', time: '6 分钟前', tone: 'ok' },
      { text: '新用户注册：liu**@163.com', time: '18 分钟前', tone: 'muted' },
      { text: '路径「Excel 自动化」生成成功', time: '42 分钟前', tone: 'ok' },
      { text: '学习者快照重算完成 ×12', time: '1 小时前', tone: 'muted' }
    ]
  },
  incident: {
    tone: 'warn',
    score: 61,
    headline: '需要关注：2 件',
    subline: '教学链路连续失败，学习侧今日无活跃。',
    actions: [
      { text: 'teaching-round 连续 2 次 429 限流', link: '排查执行日志', tone: 'bad', agentId: 'teaching-round' },
      { text: '伴学降级介入，产出质量下降', link: '查看 Skill 详情', tone: 'warn', agentId: 'companion-boost' }
    ],
    funnel: [
      { label: '用户', value: '128', idle: false },
      { label: '目标', value: '86', idle: false },
      { label: '路径', value: '64', idle: false },
      { label: '任务', value: '342', idle: false },
      { label: '完成', value: '217', idle: false }
    ],
    rates: ['67%', '74%', '×5.3', '63%'],
    funnelNote: '漏斗本身健康，问题在执行层。',
    pulse: (() => {
      const p = pulse([2, 1, 0, 0, 1, 3, 6, 9, 14, 18, 22, 19, 16, 21, 25, 28, 24, 19, 15, 12, 8, 5, 4, 3]);
      p[15].issue = 3;
      p[16].issue = 2;
      return p;
    })(),
    totalCalls: 273,
    totalIssues: 5,
    peak: '15:00',
    feed: [
      { text: 'teaching-round 失败：429 rate limit', time: '2 分钟前', tone: 'bad' },
      { text: '阶段展开重试 2/3', time: '9 分钟前', tone: 'warn' },
      { text: '画像推断解析失败，已回退默认', time: '21 分钟前', tone: 'warn' },
      { text: '目标对话回合完成', time: '36 分钟前', tone: 'ok' }
    ]
  },
  fresh: {
    tone: 'muted',
    score: 100,
    headline: '系统空闲',
    subline: '部署完成，等待第一个真实学习者。比率类指标在有数据后才会出现。',
    actions: [],
    funnel: [
      { label: '用户', value: '2', idle: false },
      { label: '目标', value: '0', idle: true },
      { label: '路径', value: '0', idle: true },
      { label: '任务', value: '0', idle: true },
      { label: '完成', value: '0', idle: true }
    ],
    rates: ['—', '—', '—', '—'],
    funnelNote: '断点在第一步：还没有人创建目标。',
    pulse: pulse([]),
    totalCalls: 0,
    totalIssues: 0,
    peak: '—',
    feed: []
  }
};

const data = computed(() => datasets[props.state]);
const maxCalls = computed(() => Math.max(1, ...data.value.pulse.map((b) => b.calls)));
const barHeight = (calls: number) => `${calls > 0 ? Math.max((calls / maxCalls.value) * 100, 8) : 4}%`;
const scoreDash = computed(() => `${data.value.score * 1.194} 119.4`);
const barTitle = (hour: number, b: { calls: number; issue: number }) =>
  `${String(hour).padStart(2, '0')}:00 · ${b.calls} 次调用 · ${b.issue} 异常`;
</script>

<style scoped>
.brief {
  --ink: #1a2a44;
  --muted: #5b6577;
  --faint: #8492ab;
  --line: #e1e8f2;
  --blue: #3478f6;
  --green: #15803d;
  --amber: #b45309;
  --red: #dc2626;
  padding: 20px;
  display: grid;
  gap: 16px;
  background: #f6f8fc;
  font-size: 14px;
  color: var(--ink);
}

/* 简报头 */
.brief-head {
  display: grid;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: #fff;
}
.brief-head--warn { border-color: rgba(180, 83, 9, 0.3); background: linear-gradient(180deg, #fffdf7, #fff); }
.brief-head--muted { background: #fafbfd; }

.brief-head__verdict {
  display: flex;
  align-items: center;
  gap: 14px;
}
.brief-head__verdict h3 { margin: 0; font-size: 18px; }
.brief-head__verdict p { margin: 3px 0 0; color: var(--muted); font-size: 13px; }

.brief-score {
  position: relative;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
}
.brief-score svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.brief-score__track { fill: none; stroke: #edf1f8; stroke-width: 5; }
.brief-score__bar {
  fill: none;
  stroke: var(--blue);
  stroke-width: 5;
  stroke-linecap: round;
  transition: stroke-dasharray 0.5s ease;
}
.brief-head--warn .brief-score__bar { stroke: var(--amber); }
.brief-head--muted .brief-score__bar { stroke: #c3cede; }
.brief-score strong {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.brief-actions {
  margin: 0;
  padding: 10px 0 0;
  list-style: none;
  border-top: 1px dashed var(--line);
  display: grid;
  gap: 8px;
}
.brief-actions li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.brief-actions__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.brief-actions__dot--bad { background: var(--red); }
.brief-actions__dot--warn { background: var(--amber); }
.brief-actions__text { font-weight: 600; }
.brief-actions__link { margin-left: auto; color: var(--blue); font-weight: 700; white-space: nowrap; }
.brief-actions__clear {
  margin: 0;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  color: var(--faint);
  font-size: 13px;
}

/* 三列 */
.brief-grid {
  display: grid;
  grid-template-columns: 1.1fr 1.2fr 1fr;
  gap: 14px;
  align-items: stretch;
}
.brief-card {
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: #fff;
  display: grid;
  gap: 14px;
  align-content: start;
}
.brief-card h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--faint);
}
.brief-card__note { margin: 0; font-size: 12.5px; color: var(--muted); }

/* 漏斗 */
.funnel {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.funnel__node {
  flex: 1 1 64px;
  display: grid;
  gap: 2px;
  padding: 10px 8px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #fafbfe;
  text-align: center;
}
.funnel__node span { font-size: 11.5px; color: var(--muted); font-weight: 600; }
.funnel__node strong { font-size: 19px; font-variant-numeric: tabular-nums; }
.funnel__node--idle { border-style: dashed; background: transparent; }
.funnel__node--idle strong { color: var(--faint); }
.funnel__rate { font-size: 10.5px; font-weight: 800; color: var(--faint); }

/* 脉搏 */
.pulse {
  display: flex;
  align-items: flex-end;
  gap: 2.5px;
  height: 84px;
  padding-top: 6px;
}
.pulse__bar {
  flex: 1 1 0;
  min-width: 4px;
  border-radius: 2.5px 2.5px 1px 1px;
  background: linear-gradient(180deg, #6aa0ff, #3d7cff);
  opacity: 0.9;
}
.pulse__bar--issue { background: linear-gradient(180deg, #f87171, #dc2626); opacity: 1; }
.pulse__bar--idle { background: #e6ebf4; }
.pulse__meta {
  display: flex;
  gap: 16px;
  font-size: 12.5px;
  color: var(--muted);
}
.pulse__meta strong { color: var(--ink); font-variant-numeric: tabular-nums; }
.pulse__meta strong.is-bad { color: var(--red); }

/* 时间线 */
.feed {
  margin: 0;
  padding: 0;
  list-style: none;
  position: relative;
  display: grid;
  gap: 12px;
}
.feed::before {
  content: '';
  position: absolute;
  left: 3.5px;
  top: 6px;
  bottom: 6px;
  width: 1px;
  background: var(--line);
}
.feed li {
  display: flex;
  gap: 10px;
  position: relative;
}
.feed__dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #c3cede;
  box-shadow: 0 0 0 3px #fff;
  z-index: 1;
}
.feed__dot--ok { background: var(--green); }
.feed__dot--warn { background: var(--amber); }
.feed__dot--bad { background: var(--red); }
.feed li div { display: grid; gap: 1px; }
.feed li strong { font-size: 13px; font-weight: 600; }
.feed li span { font-size: 11.5px; color: var(--faint); }
.feed__empty { margin: 0; color: var(--faint); font-size: 13px; }

@media (max-width: 1000px) {
  .brief-grid { grid-template-columns: 1fr; }
}
</style>
