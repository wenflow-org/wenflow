<template>
  <div class="term">
    <!-- 命令行式筛选条 -->
    <div class="term-bar">
      <span class="term-bar__prompt">wenflow@admin</span>
      <span class="term-bar__path">~/logs</span>
      <span class="term-bar__dollar">$</span>
      <span class="term-bar__cmd">tail -f execution.log <em>{{ filterCmd }}</em></span>
      <span class="term-bar__caret"></span>
      <div class="term-bar__stats">
        <span class="term-stat term-stat--ok">✓ {{ stats.success }}</span>
        <span class="term-stat term-stat--err">✗ {{ stats.error }}</span>
        <span class="term-stat term-stat--warn">⏱ {{ stats.timeout }}</span>
      </div>
    </div>

    <!-- 日志流 -->
    <div v-if="rows.length" class="term-body" role="log">
      <div
        v-for="(row, i) in rows"
        :key="i"
        class="tline"
        :class="[`tline--${row.level}`, { 'tline--open': row.open }]"
      >
        <button type="button" class="tline__main" @click="row.open = !row.open">
          <span class="tline__time">{{ row.time }}</span>
          <span class="tline__level">{{ levelMark(row.level) }}</span>
          <span class="tline__agent">{{ row.agent }}</span>
          <span class="tline__msg">{{ row.msg }}</span>
          <span class="tline__dur">{{ row.dur }}</span>
          <span class="tline__trace">{{ row.trace }}</span>
        </button>
        <div v-if="row.open" class="tline__payload">
          <pre>{{ row.payload }}</pre>
        </div>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else class="term-empty">
      <pre class="term-empty__art">{{ emptyArt }}</pre>
      <p>// 当前筛选无日志。调整时间范围或清除筛选条件。</p>
    </div>

    <!-- 底部状态行 -->
    <div class="term-foot">
      <span>LIVE · 5s 轮询</span>
      <span>{{ rows.length }} 行</span>
      <span>UTF-8</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

type LogLevel = 'ok' | 'err' | 'warn' | 'info';
interface LogRow {
  time: string;
  level: LogLevel;
  agent: string;
  msg: string;
  dur: string;
  trace: string;
  payload?: string;
  open?: boolean;
}

const props = defineProps<{ state: 'normal' | 'incident' | 'empty' }>();

const normalRows: LogRow[] = [
  { time: '16:42:07', level: 'ok', agent: 'goal-conversation', msg: '目标对话回合完成，抽取 2 个概念', dur: '1.2s', trace: 'tr:8f31a2', payload: '{\n  "round": 7,\n  "concepts": ["Excel 周报", "自动化"],\n  "confidence": 0.86\n}' },
  { time: '16:41:55', level: 'ok', agent: 'path-planning', msg: '路径草稿生成，4 个阶段', dur: '3.8s', trace: 'tr:8f319e' },
  { time: '16:41:31', level: 'info', agent: 'learner-model', msg: '快照刷新完成 user_1784…', dur: '210ms', trace: 'tr:8f319a' },
  { time: '16:40:58', level: 'ok', agent: 'teaching-round', msg: '教学回合完成，掌握度 +0.12', dur: '940ms', trace: 'tr:8f3188' },
  { time: '16:40:12', level: 'warn', agent: 'basic-generator', msg: '输出长度接近上限 3800/4000 tokens', dur: '2.1s', trace: 'tr:8f317f', payload: '{\n  "usage": { "prompt": 1240, "completion": 3796 },\n  "model": "deepseek-v4-flash"\n}' },
  { time: '16:39:47', level: 'ok', agent: 'session-wrapup', msg: '课后产出已写入 3 条笔记', dur: '1.6s', trace: 'tr:8f3171' },
  { time: '16:38:59', level: 'info', agent: 'virtual-sim', msg: '虚拟学习者第 4 轮模拟开始', dur: '—', trace: 'tr:8f316b' }
];

const incidentRows: LogRow[] = [
  { time: '16:44:02', level: 'err', agent: 'teaching-round', msg: 'LLM 调用失败：429 rate limit', dur: '18.4s', trace: 'tr:8f31c4', open: true, payload: '{\n  "error": "RateLimitExceeded",\n  "provider": "deepseek",\n  "retryAfterMs": 20000,\n  "attempt": 3\n}' },
  { time: '16:43:58', level: 'err', agent: 'teaching-round', msg: '教学回合中止：上游超时', dur: '30.0s', trace: 'tr:8f31c0' },
  { time: '16:43:41', level: 'warn', agent: 'path-planning', msg: '阶段展开重试 2/3', dur: '9.2s', trace: 'tr:8f31b9' },
  { time: '16:43:30', level: 'err', agent: 'goal-profile', msg: '画像推断输出解析失败，已回退默认', dur: '1.1s', trace: 'tr:8f31b2' },
  { time: '16:42:59', level: 'ok', agent: 'goal-conversation', msg: '目标对话回合完成', dur: '1.3s', trace: 'tr:8f31a9' },
  { time: '16:42:14', level: 'warn', agent: 'session-wrapup', msg: '产出质量评分低于阈值 0.6', dur: '2.0s', trace: 'tr:8f319f' }
];

const rows = reactive<LogRow[]>([]);
const stats = reactive({ success: 0, error: 0, timeout: 0 });

watch(
  () => props.state,
  (s) => {
    const source = s === 'incident' ? incidentRows : s === 'empty' ? [] : normalRows;
    rows.splice(0, rows.length, ...source.map((r) => ({ ...r })));
    stats.success = rows.filter((r) => r.level === 'ok').length;
    stats.error = rows.filter((r) => r.level === 'err').length;
    stats.timeout = rows.filter((r) => r.level === 'warn').length;
  },
  { immediate: true }
);

const filterCmd = computed(() =>
  props.state === 'incident' ? '| grep -E "err|warn"' : props.state === 'empty' ? '--since 24h' : ''
);

const levelMark = (l: LogLevel) => ({ ok: ' ✓ ', err: ' ✗ ', warn: ' ! ', info: ' i ' })[l];

const emptyArt = [
  '  ┌─────────────────────────┐',
  '  │  no logs matched (0)    │',
  '  └─────────────────────────┘'
].join('\n');
</script>

<style scoped>
.term {
  --bg: #0d1420;
  --bg-alt: #111a2b;
  --line: #1f2c44;
  --ink: #d5e0f2;
  --dim: #6d7f9c;
  --ok: #4ade80;
  --err: #f87171;
  --warn: #fbbf24;
  --info: #5a94f8;
  background: var(--bg);
  color: var(--ink);
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 12.5px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 560px;
}

/* 顶栏 */
.term-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-alt);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.term-bar__prompt { color: var(--ok); font-weight: 700; }
.term-bar__path { color: var(--info); }
.term-bar__dollar { color: var(--dim); }
.term-bar__cmd { color: var(--ink); }
.term-bar__cmd em { color: var(--warn); font-style: normal; }
.term-bar__caret {
  width: 8px;
  height: 16px;
  background: var(--ink);
  animation: blink 1.1s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
.term-bar__stats {
  margin-left: auto;
  display: flex;
  gap: 14px;
  font-weight: 700;
}
.term-stat--ok { color: var(--ok); }
.term-stat--err { color: var(--err); }
.term-stat--warn { color: var(--warn); }

/* 日志行 */
.term-body {
  overflow-y: auto;
  max-height: 620px;
  padding: 6px 0;
}
.tline {
  border-left: 3px solid transparent;
}
.tline--ok { border-left-color: var(--ok); }
.tline--err { border-left-color: var(--err); background: rgba(248, 113, 113, 0.06); }
.tline--warn { border-left-color: var(--warn); }
.tline--info { border-left-color: var(--info); }

.tline__main {
  display: grid;
  grid-template-columns: 74px 30px 170px minmax(0, 1fr) 70px 96px;
  gap: 10px;
  align-items: baseline;
  width: 100%;
  padding: 7px 14px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tline__main:hover { background: rgba(90, 148, 248, 0.07); }

.tline__time { color: var(--dim); }
.tline__level { font-weight: 800; text-align: center; }
.tline--ok .tline__level { color: var(--ok); }
.tline--err .tline__level { color: var(--err); }
.tline--warn .tline__level { color: var(--warn); }
.tline--info .tline__level { color: var(--info); }
.tline__agent { color: var(--info); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tline__msg { color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tline__dur { color: var(--dim); text-align: right; }
.tline__trace { color: var(--warn); font-size: 11.5px; text-align: right; }

.tline__payload {
  padding: 4px 14px 10px 144px;
}
.tline__payload pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--bg-alt);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--dim);
  font: inherit;
  font-size: 11.5px;
  line-height: 1.6;
  overflow-x: auto;
}

/* 空态 */
.term-empty {
  display: grid;
  place-content: center;
  gap: 14px;
  padding: 80px 20px;
  text-align: center;
  color: var(--dim);
}
.term-empty__art {
  margin: 0 auto;
  color: var(--line);
  font: inherit;
  line-height: 1.5;
}
.term-empty p { margin: 0; }

/* 底栏 */
.term-foot {
  display: flex;
  gap: 18px;
  padding: 8px 16px;
  background: var(--bg-alt);
  border-top: 1px solid var(--line);
  color: var(--dim);
  font-size: 11px;
}
.term-foot span:first-child { color: var(--ok); }

@media (max-width: 900px) {
  .tline__main {
    grid-template-columns: 66px 26px minmax(0, 1fr) 64px;
  }
  .tline__agent,
  .tline__trace { display: none; }
  .tline__payload { padding-left: 14px; }
}
</style>
