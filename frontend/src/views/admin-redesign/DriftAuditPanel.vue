<template>
  <div class="fdp">
    <!-- 新建字段引导（嵌套卡走 mk-card + card__head：原型 .card/.card__head/.card__title 201-215） -->
    <details class="mk-card fdp__box">
      <summary class="mk-card__head mk-section__summary">
        <span class="mk-card__title">新建字段（编辑编排文件）</span>
        <span class="mk-card__meta">唯一声明源</span>
      </summary>
      <div class="fdp__guide">
        <p class="fdp__guide-text">
          新建字段请直接编辑编排文件，保存后新字段/新路由立即进入数据库（已有行修改见下方漂移报告）。
        </p>
        <p class="fdp__guide-file"><span class="mono">prompts/orchestration/{{ stage }}.yaml</span></p>
        <p class="fdp__guide-text">入口：<strong>「字段路由」页顶部「编排文件」按钮</strong>，在文本框中按现有结构追加
          <code class="mono">fields:</code> / <code class="mono">routings:</code> 条目后点击「{{ TERMS.saveToFile }}」。</p>
      </div>
    </details>

    <!-- 漂移报告 -->
    <details class="mk-card fdp__box" open>
      <summary class="mk-card__head mk-section__summary">
        <span class="mk-card__title">漂移报告</span>
        <span class="mk-card__meta">{{ TERMS.driftContractQualified }}：编排文件 vs 数据库 · admin 编辑行豁免</span>
      </summary>
      <div v-if="driftLoading" class="fdp__loading"><MkLoading text="漂移检测中…" inline /></div>
      <MkEmptyState
        v-else-if="driftFailed"
        tone="error"
        title="漂移检测失败"
        description="无法连接字段路由服务，请稍后重试。"
        action-text="重试"
        compact
        @action="loadDrift"
      />
      <!-- 一致（正向后空态）：原型 .empty 词表，图标 + 结论 + 说明 -->
      <MkEmptyState
        v-else-if="drift.items.length === 0"
        icon="✓"
        title="无漂移"
        description="编排文件与数据库一致"
        compact
      />
      <ul v-else class="fdp__drift-list">
        <li v-for="(d, i) in drift.items" :key="i" class="fdp__drift-item">
          <span class="mono mk-badge mk-badge--warn fdp__drift-kind">{{ kindLabel(d.kind) }}</span>
          <span class="mono fdp__drift-key">{{ d.key }}</span>
          <span class="fdp__drift-field">{{ d.field }}</span>
          <span class="mono fdp__drift-val fdp__drift-val--seed">声明={{ stringify(d.seedValue) }}</span>
          <span class="mono fdp__drift-val fdp__drift-val--db">数据库={{ stringify(d.dbValue) }}</span>
        </li>
      </ul>
      <p v-if="drift.totalDriftCount > drift.items.length" class="mk-card__note">（共 {{ drift.totalDriftCount }} 项，当前筛选显示 {{ drift.items.length }}）</p>
    </details>

    <!-- 审计 -->
    <details class="mk-card fdp__box">
      <summary class="mk-card__head mk-section__summary">
        <span class="mk-card__title">最近变更（审计）</span>
        <span v-if="changes.length" class="mk-card__meta">{{ changes.length }} 条</span>
      </summary>
      <ul v-if="changes.length" class="fdp__changes-list">
        <li v-for="(c, i) in changes" :key="i" class="fdp__change">
          <span class="mk-badge mk-badge--muted fdp__change-kind">{{ String(c.changeType || '—') }}</span>
          <span class="fdp__change-target">{{ String(c.targetTable || '') }}</span>
          <span class="mono">{{ String(c.targetId || '') }}</span>
        </li>
      </ul>
      <MkEmptyState
        v-else-if="changesFailed"
        tone="error"
        title="变更记录加载失败"
        description="无法连接审计服务，请稍后重试。"
        action-text="重试"
        compact
        @action="loadChanges"
      />
      <MkEmptyState
        v-else
        icon="⇄"
        title="暂无变更记录"
        description="本阶段尚无配置变更审计流水。"
        action-text="刷新"
        compact
        @action="loadChanges"
      />
    </details>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { adminFieldRoutingsApi } from '@/api/adminApi';
import { TERMS } from './terms';
import MkEmptyState from '@/components/mk/MkEmptyState.vue';
import MkLoading from '@/components/mk/MkLoading.vue';

const props = defineProps<{ stage: string }>();

const drift = ref<{ items: Array<Record<string, unknown>>; totalDriftCount: number }>({ items: [], totalDriftCount: 0 });
const driftLoading = ref(false);
const driftFailed = ref(false);
const changes = ref<Array<Record<string, unknown>>>([]);
const changesFailed = ref(false);

function stringify(value: unknown) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/* drift kind 中文映射（未知值原样展示） */
const driftKindLabels: Record<string, string> = { contract: '契约', field: '字段', routing: '路由' };
function kindLabel(kind: unknown) {
  return driftKindLabels[String(kind || '')] || String(kind || '');
}

async function loadDrift() {
  driftLoading.value = true;
  driftFailed.value = false;
  try {
    const res = await adminFieldRoutingsApi.getDrift({ stage: props.stage });
    drift.value = res.data?.data || { items: [], totalDriftCount: 0 };
  } catch {
    driftFailed.value = true;
    drift.value = { items: [], totalDriftCount: 0 };
  } finally {
    driftLoading.value = false;
  }
}

async function loadChanges() {
  changesFailed.value = false;
  try {
    const c = await adminFieldRoutingsApi.getChanges({ stage: props.stage, limit: 10 });
    changes.value = Array.isArray(c.data?.data) ? c.data.data : (c.data?.data?.changes || []);
  } catch {
    changesFailed.value = true;
    changes.value = [];
  }
}

defineExpose({ reload: () => Promise.all([loadDrift(), loadChanges()]) });

onMounted(() => {
  void loadDrift();
  void loadChanges();
});

// 切换阶段时刷新（审计按 stage 过滤）
watch(() => props.stage, () => {
  void loadDrift();
  void loadChanges();
});
</script>

<style scoped>
/* 卡皮走全局 .mk-card（原型 .card 201-215）；此处只留本页间距。
   卡头 .mk-card__head 自带 border-bottom，折叠时 summary 即卡底 —— 复位避免双线。 */
.fdp__box { margin-bottom: 12px; }
.fdp__box[open] > .mk-section__summary { border-bottom: 1px solid var(--mk-line, #e6ebf4); }
.fdp__box:not([open]) > .mk-card__head { border-bottom: 0; }
.fdp__loading { display: flex; justify-content: center; padding: 20px 0; }
.fdp__guide { display: grid; gap: 8px; padding: 12px 14px; }
.fdp__guide-text { margin: 0; color: var(--mk-muted, #5b6577); font-size: var(--mk-fs-micro); line-height: 1.6; }
.fdp__guide-file {
  margin: 0;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--mk-blue) 35%, var(--mk-line));
  border-radius: var(--mk-radius-xl);
  background: var(--mk-blue-bg, #eff6ff);
  color: var(--mk-blue, #2c63d0);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
}
.fdp__guide-file .mono { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue, #2c63d0); }
.fdp__guide-text code { font-family: var(--mk-mono, ui-monospace, monospace); font-size: var(--mk-fs-micro); background: var(--mk-surface-3); padding: 1px 6px; border-radius: var(--mk-radius-sm); }
.fdp__drift-list { margin: 0; padding: 6px 14px 12px; list-style: none; }
/* 漂移条目：原型 .note--warn 语义（soft 琥珀底 + 圆角，不再自搓描边盒）——原型 .note 438-439 */
.fdp__drift-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 8px 12px;
  margin-top: 6px;
  border: 0;
  border-radius: var(--mk-radius-md);
  background: var(--mk-amber-bg, #fffbeb);
  font-size: var(--mk-fs-micro);
  flex-wrap: wrap;
}
/* 类别徽章走全局 .mk-badge 胶囊（自搓 pill 已删）；本类只保留行内布局位 */
.fdp__drift-kind { flex-shrink: 0; }
.fdp__drift-key { font-weight: 700; color: var(--mk-ink, #1a2a44); }
.fdp__drift-field { color: var(--mk-faint, var(--mk-faint-soft)); }
.fdp__drift-val { font-size: var(--mk-fs-micro); }
.fdp__drift-val--seed { color: var(--mk-muted, #5b6577); }
.fdp__drift-val--db { color: var(--mk-blue, #2c63d0); font-weight: 600; }
.fdp__changes-list { margin: 0; padding: 2px 14px 8px; list-style: none; }
/* 审计行：原型 .rankrow/.vrow 分隔线列表（行间 1px 底线、末行不画，不再逐条描边盒）297-302 */
.fdp__change {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 0;
  border-bottom: 1px solid var(--mk-line, #e6ebf4);
  font-size: var(--mk-fs-micro);
  flex-wrap: wrap;
}
.fdp__change:last-child { border-bottom: 0; }
.fdp__change-kind { flex-shrink: 0; }
.fdp__change-target { color: var(--mk-muted, #5b6577); }

@media (min-width: 2000px) {
  .fdp__guide { padding: 14px 17px; }
  .fdp__guide-text { font-size: var(--mk-fs-body); }
  .fdp__guide-file { font-size: var(--mk-fs-body); padding: 9px 14px; }
  .fdp__guide-file .mono { font-size: var(--mk-fs-micro); }
  .fdp__guide-text code { font-size: var(--mk-fs-micro); }
  .fdp__drift-item { font-size: var(--mk-fs-micro); padding: 9px 14px; }
  .fdp__drift-val { font-size: var(--mk-fs-micro); }
  .fdp__change { font-size: var(--mk-fs-micro); padding: 10px 0; }
}

@media (min-width: 2800px) {
  .fdp__guide { padding: 17px 21px; }
  .fdp__guide-text { font-size: var(--mk-fs-body); }
  .fdp__guide-file { font-size: var(--mk-fs-body); padding: 11px 17px; }
  .fdp__guide-file .mono { font-size: var(--mk-fs-micro); }
  .fdp__guide-text code { font-size: var(--mk-fs-micro); }
  .fdp__drift-item { font-size: var(--mk-fs-micro); padding: 10px 15px; }
  .fdp__drift-val { font-size: var(--mk-fs-micro); }
  .fdp__change { font-size: var(--mk-fs-micro); padding: 11px 0; }
}
</style>
