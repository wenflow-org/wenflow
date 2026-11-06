<template>
  <div class="uc v2-page">
    <V2Nav />

    <main class="uc__main">
      <!-- 页头分段器（原型 wf-seg 同构）。2026-11-06 走查：整宽四等分把 2 个字的 tab
           拉成 ~270px 宽的「巨型跑道」，改 fit-content 左对齐（36 高 / 8px 圆角）；
           右侧插槽放页面级总计量（学习历史页的「累计 N 天 · N 次 · N 分钟」），
           同行排布不再单独占一行。 -->
      <div class="uc__segrow">
        <nav class="uc__seg" aria-label="个人中心分区">
          <router-link
            v-for="t in tabs"
            :key="t.to"
            :to="t.to"
            class="uc__seg__btn"
            :class="{ 'uc__seg__btn--on': isActive(t) }"
            :aria-current="ariaCurrent(t)"
          >
            {{ t.label }}
          </router-link>
        </nav>
        <div v-if="$slots['seg-right']" class="uc__seg-right">
          <slot name="seg-right" />
        </div>
      </div>

      <!-- 分段器只覆盖四个能力页；深页（调用日志）保留可见标题与动作区。
           走查 2026-11-01 P20：深页不再点亮父段——此前的 owns 归属会让
           /user/agent-logs 高亮错停在「设置」上；激活判定改为与当前路由精确对应，
           深页的当前页由下面这个可见 h1 承担。 -->
      <div v-if="!onCapabilityTab" class="uc__deeptitle">
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
        <div v-if="$slots.actions" class="uc__head-actions">
          <slot name="actions" />
        </div>
      </div>
      <h1 v-else class="uc__vh">{{ title }}</h1>

      <div class="uc__body">
        <slot />
      </div>
    </main>

    <V2Footer />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import V2Nav from '@/views/v2/V2Nav.vue'
import V2Footer from '@/views/v2/V2Footer.vue'

defineProps<{ title: string; description?: string }>()

const route = useRoute()

/* 2026-09-27 撤入口留能力：「API 接入」「调用日志」从学习者可见的 tab 栏撤下
   （面向开发者/排查的面板，全量库实测零使用；后端路由/网关分支/数据表全部保留，
   需要时直达 URL 仍可用）。未来做开发者/团队版再放出。 */
/* 激活判定与当前路由精确对应（走查 2026-11-01 P20）：此前是 startsWith 前缀匹配 +
   owns 归属（2026-10-08 #52 的口径），/user/agent-logs（调用日志）会点亮「设置」段
   ——高亮错停在上一站。现在每个 tab 只对准自己的路径段，深页（/user/agent-logs）
   四段全不选中，可见页名由 uc__deeptitle 的 h1 承担。 */
const tabs = [
  { to: '/user/account', label: '账户' },
  { to: '/user/achievements', label: '成就' },
  { to: '/user/learning-history', label: '学习历史' },
  { to: '/user/settings', label: '设置' }
]

function isActive(t: { to: string }) {
  return route.path === t.to
}

/* 当前页正好是该段自身路径 → 'page'；深页不点亮任何段 → 不出 aria-current */
function ariaCurrent(t: { to: string }): 'page' | undefined {
  return isActive(t) ? 'page' : undefined
}

const onCapabilityTab = computed(() => tabs.some((t) => route.path === t.to))
</script>

<style scoped>
.uc {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
  color: var(--ink);
}

.uc.v2-page > main.uc__main {
  flex: 1;
  width: min(1080px, calc(100% - 40px));
  margin: 0 auto;
  padding: 22px 0 40px;
  display: grid;
  gap: 16px;
  align-content: start;
}

/* 与 v2 页面一致：≥1680px 加宽 */
@media (min-width: 1680px) {
  .uc.v2-page > main.uc__main {
    width: min(1360px, calc(100% - 40px));
  }
}

/* ===== 页头分段器：fit-content 左对齐（2026-11-06 走查改档） ===== */
.uc__segrow {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.uc__seg {
  display: inline-grid;
  grid-template-columns: repeat(4, minmax(0, auto));
  gap: 3px;
  padding: 3px;
  background: color-mix(in srgb, var(--line) 45%, transparent);
  border-radius: 8px;
}

.uc__seg__btn {
  min-height: 34px;
  padding: 0 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}
.uc__seg-right {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
  margin-left: auto;
  min-width: 0;
}

.uc__seg__btn:hover { color: var(--ink); }
.uc__seg__btn--on {
  background: var(--surface);
  color: var(--blue-deep);
  box-shadow: var(--shadow-sm);
}
.uc__seg__btn:focus-visible { outline: none; box-shadow: var(--mk-focus-ring); }

/* 深页（设置/调用日志）标题行：分段器不覆盖时保留可见 h1 */
.uc__deeptitle h1 {
  margin: 4px 0 0;
  font-size: 20px;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.uc__deeptitle p {
  margin: 4px 0 0;
  max-width: 48em;
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted);
}
.uc__head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

/* 能力页 h1 仅供读屏/文档结构（视觉位置由分段器承担） */
.uc__vh {
  position: absolute;
  width: 1px; height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.uc__body {
  display: grid;
  gap: 16px;
  min-width: 0;
}

/* 统一实色卡：覆盖所有用户中心卡片类（含玻璃卡），对齐 v2 16px 实色语言 */
.uc__body :deep(.glass-card),
.uc__body :deep(.profile-card),
.uc__body :deep(.uc-card),
.uc__body :deep(.settings-card),
.uc__body :deep(.agent-model-panel),
.uc__body :deep(.__panel),
.uc__body :deep(.__intro),
.uc__body :deep(.agent-table-panel),
.uc__body :deep(.skills-table-panel),
.uc__body :deep(.logs-list) {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  /* 批次 D「卡片 0 阴影」：.uc-card 本体已删投影，这层 raised 残留同步退役（显式平档） */
  box-shadow: var(--wf-shadow-xs);
  backdrop-filter: none;
}

.uc__body :deep(.btn-primary) {
  border: 0 !important;
  /* 批次 D（2026-10-02）：12px 圆角（档外）→ --wf-radius-control(8px)；
     135deg 渐变底 + rgba(52,120,246,.22) 彩色光晕 → 纯色友好蓝、无投影。
     规范：「主操作为纯色友好蓝 #2f6ae0，不再使用渐变」「禁止彩色光晕」。
     这层用 :deep + !important 覆写外部 .btn-primary（来自 uc.css），
     两侧现在指向同一套规范值，不再各写一套。 */
  border-radius: var(--wf-radius-control) !important;
  background: var(--wf-color-primary) !important;
  font-weight: 700;
}

/* 扩展覆盖：design-system 的 .btn 系（999px）收敛到 12px */
.uc__body :deep(.btn),
.uc__body :deep(.btn--primary),
.uc__body :deep(.btn--ghost) {
  border-radius: 12px !important;
}

@media (max-width: 1100px) {
  .uc.v2-page > main.uc__main {
    width: min(100% - 28px, 1180px);
    /* 底部留白 84→12：v2.css 的 .v2-page 已在根部预留 tabbar 高 + safe-area，
       这里再垫 84px 会叠出 ~156px 空白（2026-09-25 移动端框架审查） */
    padding: 14px 0 12px;
    gap: 12px;
  }

  .uc__head {
    flex-direction: column;
    gap: 12px;
    padding: 0 2px;
  }

  .uc__head-actions {
    width: 100%;
    justify-content: stretch;
    gap: 8px;
  }

  /* 页头动作（调用日志的「导出 JSON / 导出 CSV / 复制排查信息」）：390 下原本
     折成三行占 124px，收紧字号与内边距后 390/320 都能排成一行（38px）。
     用 flex: 0 0 auto 让它放不下时整体换行，而不是把按钮压扁 */
  .uc__head-actions .uc-btn {
    flex: 0 0 auto;
    padding: 8px 10px;
    font-size: 12px;
    white-space: nowrap;
  }

  /* 移动端页头密度：390 下页头 74px + 分段导航 40px，压到 ~56 + ~34 */
  .uc__kicker {
    margin-bottom: 4px;
  }

  /* 移动端页标题：22 → 20 → 18（2026-09-24 两轮反馈，与各页 hero 标题同步收） */
  .uc__head h1 {
    margin-bottom: 4px;
    font-size: 18px;
  }

  .uc__head p {
    font-size: 13px;
    line-height: 1.55;
  }

  /* 分段器窄屏：fit-content 本身就放得下 4 个 2 字 tab（~270px），内衬收一档即可 */
  .uc__seg__btn {
    min-height: 34px;
    padding: 0 14px;
    font-size: 12.5px;
  }

  .uc__seg-right {
    width: 100%;
    margin-left: 0;
  }
}
</style>
