<template>
  <div v-if="d" class="mk-page ld">
    <!-- 头部：身份与状态 -->
    <div class="ld-head">
      <button type="button" class="ld-back" @click="closeSubPage">← 学习者中心</button>
      <div class="ld-id">
        <span class="ld-avatar">{{ d.name.charAt(0) }}</span>
        <div>
          <h3>{{ d.name }}</h3>
          <span class="ld-sub">{{ d.email }} · 加入 {{ d.joined }}</span>
        </div>
        <div class="ld-badges">
          <span class="mk-badge" :class="trendBadge">趋势：{{ trendText }}</span>
          <span class="mk-badge" :class="fatigueBadge">疲劳：{{ d.fatigue }}</span>
          <span class="mk-badge mk-badge--muted">快照 {{ d.snapshot.version }} · {{ d.snapshot.generatedAt }}</span>
        </div>
        <button type="button" class="mk-status__action" style="margin-left:auto">重算快照</button>
      </div>
    </div>

    <div class="ld-grid">
      <!-- 左：进度与知识点 -->
      <div class="ld-col">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">当前进度</h3>
            <span class="mk-badge mk-badge--info">{{ d.pct }}%</span>
          </div>
          <div class="ld-progress">
            <strong>{{ d.path }}</strong>
            <span class="ld-progress__stage">{{ d.stage }}</span>
            <div class="ld-progress__bar"><i :style="{ width: d.pct + '%' }"></i></div>
            <p class="ld-progress__task">正在做：{{ d.task }}</p>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">知识点状态</h3>
          </div>
          <div class="ld-concepts">
            <div class="ld-concept-group">
              <span class="ld-concept-label ld-concept-label--ok">已掌握 {{ d.concepts.mastered.length }}</span>
              <div class="ld-concept-list">
                <span v-for="c in d.concepts.mastered" :key="c" class="ld-concept ld-concept--ok">{{ c }}</span>
              </div>
            </div>
            <div class="ld-concept-group">
              <span class="ld-concept-label ld-concept-label--warn">挣扎 {{ d.concepts.struggling.length }}</span>
              <div class="ld-concept-list">
                <span v-for="c in d.concepts.struggling" :key="c" class="ld-concept ld-concept--warn">{{ c }}</span>
              </div>
            </div>
            <div class="ld-concept-group">
              <span class="ld-concept-label ld-concept-label--bad">脆弱 {{ d.concepts.fragile.length }}</span>
              <div class="ld-concept-list">
                <span v-for="c in d.concepts.fragile" :key="c" class="ld-concept ld-concept--bad">{{ c }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 右：趋势与会话 -->
      <div class="ld-col">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">7 天活跃趋势</h3>
            <span class="mk-card__meta">{{ trendHint }}</span>
          </div>
          <div class="ld-trend">
            <span
              v-for="(v, i) in d.trend7d"
              :key="i"
              class="ld-trend__bar"
              :class="{ 'ld-trend__bar--down': d.trend === 'down' }"
              :style="{ height: (v / 7) * 100 + '%' }"
              :title="`${['周一','周二','周三','周四','周五','周六','周日'][i]} · 活跃 ${v}`"
            ></span>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">最近会话</h3>
          </div>
          <div class="ld-sessions">
            <div v-for="(s, i) in d.sessions" :key="i" class="ld-session">
              <span class="ld-session__dot" :class="`is-${s.tone}`"></span>
              <div class="ld-session__main">
                <strong>{{ s.title }}</strong>
                <span>{{ s.result }}</span>
              </div>
              <span class="ld-session__time">{{ s.time }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { subPage, closeSubPage, learnerDetails } from './mockStore'

const d = computed(() => learnerDetails.find((x) => x.id === subPage.value?.id) || learnerDetails[0])

const trendText = computed(() => (d.value.trend === 'up' ? '↗ 上升' : d.value.trend === 'down' ? '↘ 下降' : '→ 稳定'))
const trendBadge = computed(() => (d.value.trend === 'up' ? 'mk-badge--ok' : d.value.trend === 'down' ? 'mk-badge--bad' : 'mk-badge--muted'))
const fatigueBadge = computed(() => (d.value.fatigue === '高' ? 'mk-badge--bad' : d.value.fatigue === '中' ? 'mk-badge--warn' : 'mk-badge--ok'))
const trendHint = computed(() => (d.value.trend === 'down' ? '连续走低，建议介入' : d.value.trend === 'up' ? '稳步上升' : '平稳'))
</script>

<style scoped>
.ld { gap: 16px; }
.ld-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  width: fit-content;
}
.ld-head { display: grid; gap: 12px; }
.ld-id {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.ld-avatar {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #3478f6, #8d6bff);
  color: #fff;
  display: grid;
  place-content: center;
  font-size: 18px;
  font-weight: 800;
}
.ld-id h3 { margin: 0; font-size: 18px; }
.ld-sub { color: var(--mk-faint); font-size: 12px; }
.ld-badges { display: flex; gap: 8px; flex-wrap: wrap; }

.ld-grid {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 14px;
  align-items: start;
}
.ld-col { display: grid; gap: 14px; }

.ld-progress { padding: 16px; display: grid; gap: 8px; }
.ld-progress strong { font-size: 15px; }
.ld-progress__stage { color: var(--mk-muted); font-size: 12.5px; }
.ld-progress__bar {
  height: 8px;
  border-radius: 4px;
  background: #eef2fa;
  overflow: hidden;
  margin: 4px 0;
}
.ld-progress__bar i { display: block; height: 100%; background: linear-gradient(90deg, #6aa0ff, #3478f6); }
.ld-progress__task { margin: 0; font-size: 12.5px; color: var(--mk-muted); }

.ld-concepts { padding: 16px; display: grid; gap: 14px; }
.ld-concept-group { display: grid; gap: 7px; }
.ld-concept-label { font-size: 11px; font-weight: 800; letter-spacing: 0.04em; }
.ld-concept-label--ok { color: var(--mk-green); }
.ld-concept-label--warn { color: var(--mk-amber); }
.ld-concept-label--bad { color: var(--mk-red); }
.ld-concept-list { display: flex; gap: 6px; flex-wrap: wrap; }
.ld-concept {
  padding: 3px 10px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
}
.ld-concept--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.ld-concept--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.ld-concept--bad { background: var(--mk-red-bg); color: var(--mk-red); }

.ld-trend {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 90px;
  padding: 16px;
}
.ld-trend__bar {
  flex: 1;
  border-radius: 4px 4px 2px 2px;
  background: linear-gradient(180deg, #6aa0ff, #3d7cff);
  min-height: 6px;
}
.ld-trend__bar--down { background: linear-gradient(180deg, #fca5a5, #dc2626); }

.ld-sessions { display: grid; }
.ld-session {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.ld-session:last-child { border-bottom: none; }
.ld-session__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ld-session__dot.is-ok { background: var(--mk-green); }
.ld-session__dot.is-warn { background: var(--mk-amber); }
.ld-session__dot.is-bad { background: var(--mk-red); }
.ld-session__main { flex: 1; display: grid; min-width: 0; }
.ld-session__main strong { font-size: 13px; }
.ld-session__main span { font-size: 11.5px; color: var(--mk-faint); }
.ld-session__time { font-size: 11.5px; color: var(--mk-faint); white-space: nowrap; }

@media (max-width: 900px) {
  .ld-grid { grid-template-columns: 1fr; }
}
</style>
