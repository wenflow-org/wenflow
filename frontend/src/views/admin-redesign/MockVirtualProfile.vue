<template>
  <div v-if="d" class="mk-page vp">
    <button type="button" class="vp-back" @click="closeSubPage">← 虚拟学习者</button>

    <div class="vp-grid">
      <!-- 左：故事与画像 -->
      <div class="vp-col">
        <section class="mk-card vp-story">
          <div class="mk-card__head">
            <h3 class="mk-card__title">她的故事</h3>
            <span class="mk-badge mk-badge--info">{{ d.archetype }}</span>
          </div>
          <div class="vp-story__body">
            <h4>{{ d.name }}</h4>
            <p>{{ d.story }}</p>
            <div class="vp-traits">
              <span v-for="t in d.traits" :key="t" class="vp-trait">{{ t }}</span>
            </div>
            <div class="vp-goal">
              <span>学习目标</span>
              <strong>{{ d.goal }}</strong>
            </div>
          </div>
        </section>

        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">AI 画像推断</h3>
            <span class="mk-card__meta">由故事自动生成</span>
          </div>
          <div class="vp-profile">
            <div v-for="p in d.aiProfile" :key="p.label" class="vp-profile__row">
              <span>{{ p.label }}</span>
              <strong>{{ p.value }}</strong>
            </div>
          </div>
        </section>
      </div>

      <!-- 右：运行记录 -->
      <div class="vp-col">
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">运行记录</h3>
            <button type="button" class="mk-status__action mk-status__action--primary">运行一轮</button>
          </div>
          <div class="vp-runs">
            <div v-for="(r, i) in d.runs" :key="i" class="vp-run">
              <span class="vp-run__dot" :class="`is-${r.tone}`"></span>
              <div class="vp-run__main">
                <strong>{{ r.stage }}</strong>
                <span>{{ r.result }}</span>
              </div>
              <span class="vp-run__time">{{ r.time }}</span>
            </div>
          </div>
        </section>

        <section class="vp-preview">
          <h4>黑盒说明</h4>
          <p>虚拟学习者以真实黑盒方式走完整链路：故事 → Goal 对话 → Path 生成 → Learn 回合。运行结果用于评估编排质量，不产生真实用户数据。</p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { subPage, closeSubPage, virtualProfiles } from './mockStore'

const d = computed(() => virtualProfiles.find((x) => x.id === subPage.value?.id) || virtualProfiles[0])
</script>

<style scoped>
.vp { gap: 14px; }
.vp-back {
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
.vp-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 14px;
  align-items: start;
}
.vp-col { display: grid; gap: 14px; }

.vp-story__body { padding: 16px; display: grid; gap: 12px; }
.vp-story__body h4 { margin: 0; font-size: 17px; }
.vp-story__body p { margin: 0; color: var(--mk-muted); font-size: 13px; line-height: 1.75; }
.vp-traits { display: flex; gap: 6px; flex-wrap: wrap; }
.vp-trait {
  padding: 3px 10px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-size: 11.5px;
  font-weight: 700;
}
.vp-goal {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #eef5ff;
}
.vp-goal span { font-size: 11px; color: var(--mk-faint); font-weight: 700; }
.vp-goal strong { color: var(--mk-blue); font-size: 13.5px; }

.vp-profile { display: grid; }
.vp-profile__row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 12.5px;
}
.vp-profile__row:last-child { border-bottom: none; }
.vp-profile__row span { color: var(--mk-faint); }
.vp-profile__row strong { font-weight: 600; }

.vp-runs { display: grid; }
.vp-run {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid #f0f2f5;
}
.vp-run:last-child { border-bottom: none; }
.vp-run__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.vp-run__dot.is-ok { background: var(--mk-green); }
.vp-run__dot.is-warn { background: var(--mk-amber); }
.vp-run__dot.is-bad { background: var(--mk-red); }
.vp-run__main { flex: 1; display: grid; }
.vp-run__main strong { font-size: 13px; }
.vp-run__main span { font-size: 11.5px; color: var(--mk-faint); }
.vp-run__time { font-size: 11.5px; color: var(--mk-faint); white-space: nowrap; }

.vp-preview {
  padding: 14px 16px;
  border: 1px dashed var(--mk-line);
  border-radius: 12px;
  display: grid;
  gap: 6px;
}
.vp-preview h4 { margin: 0; font-size: 12px; color: var(--mk-muted); }
.vp-preview p { margin: 0; font-size: 12px; color: var(--mk-faint); line-height: 1.7; }

@media (max-width: 900px) {
  .vp-grid { grid-template-columns: 1fr; }
}
</style>
