<template>
  <div class="fdp">
    <!-- 新建字段引导 -->
    <details class="fdp__box">
      <summary class="fdp__box-summary">新建字段（编辑编排文件）</summary>
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
    <details class="fdp__box" open>
      <summary class="fdp__box-summary">漂移报告（{{ TERMS.driftContractQualified }}：编排文件 vs 数据库，admin 编辑行豁免）</summary>
      <div v-if="driftLoading" class="fdp__empty">检测中…</div>
      <div v-else-if="driftFailed" class="fdp__empty fdp__empty--error">漂移检测失败：无法连接字段路由服务，请稍后重试。<button type="button" class="mk-empty__action" @click="loadDrift">重试</button></div>
      <div v-else-if="drift.items.length === 0" class="fdp__empty">✅ 无漂移（编排文件与数据库一致）</div>
      <ul v-else class="fdp__drift-list">
        <li v-for="(d, i) in drift.items" :key="i" class="fdp__drift-item">
          <span class="mono fdp__drift-kind">{{ kindLabel(d.kind) }}</span>
          <span class="mono fdp__drift-key">{{ d.key }}</span>
          <span class="fdp__drift-field">{{ d.field }}</span>
          <span class="mono fdp__drift-val fdp__drift-val--seed">声明={{ stringify(d.seedValue) }}</span>
          <span class="mono fdp__drift-val fdp__drift-val--db">数据库={{ stringify(d.dbValue) }}</span>
        </li>
      </ul>
      <p v-if="drift.totalDriftCount > drift.items.length" class="fdp__empty">（共 {{ drift.totalDriftCount }} 项，当前筛选显示 {{ drift.items.length }}）</p>
    </details>

    <!-- 审计 -->
    <details class="fdp__box">
      <summary class="fdp__box-summary">最近变更（审计）</summary>
      <ul v-if="changes.length" class="fdp__changes-list">
        <li v-for="(c, i) in changes" :key="i" class="fdp__change">
          <span class="fdp__change-kind">{{ String(c.changeType || '—') }}</span>
          <span class="fdp__change-target">{{ String(c.targetTable || '') }}</span>
          <span class="mono">{{ String(c.targetId || '') }}</span>
        </li>
      </ul>
      <p v-else-if="changesFailed" class="fdp__empty fdp__empty--error">变更记录加载失败：无法连接审计服务，请稍后重试。<button type="button" class="mk-empty__action" @click="loadChanges">重试</button></p>
      <p v-else class="fdp__empty">暂无变更记录</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { adminFieldRoutingsApi } from '@/api/adminApi';
import { TERMS } from './terms';

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
.fdp__box {
  margin-bottom: 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 12px;
  background: var(--mk-surface, #fff);
  box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06));
  overflow: hidden;
}
.fdp__box-summary {
  padding: 11px 14px;
  cursor: pointer;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-ink, #1a2a44);
  list-style: none;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.fdp__box-summary::-webkit-details-marker { display: none; }
.fdp__box-summary::before {
  content: '▸';
  font-size: 11px;
  color: var(--mk-faint, #71809a);
  transition: transform 0.16s ease;
}
.fdp__box[open] > .fdp__box-summary::before { transform: rotate(90deg); }
.fdp__box[open] > .fdp__box-summary { border-bottom: 1px solid var(--mk-line, #e6ebf4); }
.fdp__guide { display: grid; gap: 8px; padding: 12px 14px; }
.fdp__guide-text { margin: 0; color: var(--mk-muted, #5b6577); font-size: 12.5px; line-height: 1.6; }
.fdp__guide-file {
  margin: 0;
  padding: 8px 12px;
  border: 1px solid rgba(44, 99, 208, 0.35);
  border-radius: 9px;
  background: var(--mk-blue-bg, #eff6ff);
  color: var(--mk-blue, #2c63d0);
  font-size: 12.5px;
  font-weight: 700;
}
.fdp__guide-file .mono { font-size: 12px; font-weight: 700; color: var(--mk-blue, #2c63d0); }
.fdp__guide-text code { font-family: var(--mk-mono, ui-monospace, monospace); font-size: 11.5px; background: #f0f2f5; padding: 1px 6px; border-radius: 5px; }
.fdp__drift-list { margin: 0; padding: 6px 14px 12px; list-style: none; }
.fdp__drift-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 7px 10px;
  margin-top: 6px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 9px;
  background: #fafbfd;
  font-size: 12px;
  flex-wrap: wrap;
}
.fdp__drift-kind {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--mk-amber-bg, #fffbeb);
  color: var(--mk-amber, #b45309);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.fdp__drift-key { font-weight: 700; color: var(--mk-ink, #1a2a44); }
.fdp__drift-field { color: var(--mk-faint, #71809a); }
.fdp__drift-val { font-size: 11.5px; }
.fdp__drift-val--seed { color: var(--mk-muted, #5b6577); }
.fdp__drift-val--db { color: var(--mk-blue, #2c63d0); font-weight: 600; }
.fdp__changes-list { margin: 0; padding: 8px 14px 12px; list-style: none; }
.fdp__change {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  margin-top: 6px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 9px;
  background: #fafbfd;
  font-size: 12px;
  flex-wrap: wrap;
}
.fdp__change-kind {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted, #5b6577);
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
}
.fdp__change-target { color: var(--mk-muted, #5b6577); }
.fdp__empty { padding: 20px; color: var(--mk-faint, #71809a); text-align: center; }
.fdp__empty--error { color: var(--mk-red, #dc2626); font-weight: 600; }

@media (min-width: 2000px) {
  .fdp__box-summary { font-size: 14px; padding: 13px 17px; }
  .fdp__guide { padding: 14px 17px; }
  .fdp__guide-text { font-size: 14px; }
  .fdp__guide-file { font-size: 14px; padding: 9px 14px; }
  .fdp__guide-file .mono { font-size: 13.5px; }
  .fdp__guide-text code { font-size: 13px; }
  .fdp__drift-item { font-size: 13.5px; padding: 8px 12px; }
  .fdp__drift-kind { font-size: 12px; padding: 1px 10px; }
  .fdp__drift-val { font-size: 13px; }
  .fdp__change { font-size: 13.5px; padding: 8px 12px; }
  .fdp__change-kind { font-size: 12px; padding: 1px 10px; }
  .fdp__empty { padding: 24px; }
}

@media (min-width: 2800px) {
  .fdp__box-summary { font-size: 16.5px; padding: 15px 21px; }
  .fdp__guide { padding: 17px 21px; }
  .fdp__guide-text { font-size: 16.5px; }
  .fdp__guide-file { font-size: 16.5px; padding: 11px 17px; }
  .fdp__guide-file .mono { font-size: 16px; }
  .fdp__guide-text code { font-size: 15.5px; }
  .fdp__drift-item { font-size: 16px; padding: 10px 15px; }
  .fdp__drift-kind { font-size: 14px; padding: 2px 12px; }
  .fdp__drift-val { font-size: 15.5px; }
  .fdp__change { font-size: 16px; padding: 10px 15px; }
  .fdp__change-kind { font-size: 14px; padding: 2px 12px; }
  .fdp__empty { padding: 28px; }
}

/* ================= 暗色模式（D1 补完）：治理漂移审计 ================= */
html[data-theme='dark'] {
  .fdp__guide-text code { background: #253049; }
  .fdp__drift-item { background: #161f2f; }
  .fdp__change { background: #161f2f; }
  .fdp__change-kind { background: #253049; color: #9fb0c8; }
}
</style>
