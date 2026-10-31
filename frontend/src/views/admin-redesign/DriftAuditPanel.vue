<template>
  <div class="fdp">
    <!-- 漂移报告 -->
    <details class="mk-card fdp__box" open>
      <summary class="mk-card__head mk-section__summary">
        <span class="mk-card__title">不一致报告</span>
        <span class="mk-card__meta">{{ TERMS.driftContractQualified }}</span>
      </summary>
      <div v-if="driftLoading" class="fdp__loading"><MkLoading text="不一致检测中…" inline /></div>
      <MkEmptyState
        v-else-if="driftFailed"
        tone="error"
        title="不一致检测失败"
        description="无法连接字段路由服务，请稍后重试。"
        action-text="重试"
        compact
        @action="loadDrift"
      />
      <!-- 一致（正向后空态）：原型 .empty 词表，图标 + 结论 -->
      <MkEmptyState
        v-else-if="drift.items.length === 0"
        icon="✓"
        title="无不一致"
        compact
      />
      <template v-else>
        <ul class="fdp__drift-list">
          <li v-for="(d, i) in drift.items" :key="i" class="fdp__drift-item">
            <span class="mk-badge mk-badge--warn fdp__drift-kind">{{ kindLabel(d.kind) }}</span>
            <span class="mono fdp__drift-key">{{ d.key }}</span>
            <span class="fdp__drift-field">{{ d.field }}</span>
            <span class="fdp__drift-val fdp__drift-val--seed">声明=<span class="mono">{{ stringify(d.seedValue) }}</span></span>
            <span class="fdp__drift-val fdp__drift-val--db">数据库=<span class="mono">{{ stringify(d.dbValue) }}</span></span>
            <button type="button" class="mk-link fdp__drift-act" @click="emit('open-orchestration')">打开编排文件</button>
          </li>
        </ul>
        <p v-if="drift.totalDriftCount > drift.items.length" class="mk-card__note">（共 {{ drift.totalDriftCount }} 项，当前筛选显示 {{ drift.items.length }}）</p>
      </template>
    </details>

    <!-- 审计 -->
    <details class="mk-card fdp__box">
      <summary class="mk-card__head mk-section__summary">
        <span class="mk-card__title">最近变更</span>
        <span v-if="changes.length" class="mk-card__meta">{{ changes.length }} 条</span>
      </summary>
      <ul v-if="changes.length" class="fdp__changes-list">
        <li v-for="(c, i) in changes" :key="i" class="fdp__change">
          <span class="mk-badge mk-badge--muted fdp__change-kind">{{ changeTypeText(c.changeType) }}</span>
          <span class="fdp__change-target">{{ targetTableText(c.targetTable) }}</span>
          <span class="mono">{{ String(c.targetId || '') }}</span>
          <span class="fdp__change-time mono" :title="changeTimeFull(c.createdAt)">{{ changeTime(c.createdAt) }}</span>
          <span class="fdp__change-actor" :title="actorTitle(c)">{{ actorText(c) }}</span>
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
        action-text="刷新"
        compact
        @action="loadChanges"
      />
      <div v-if="changes.length" class="fdp__changes-foot">
        <RouterLink class="mk-link" :to="{ path: '/admin/audit-logs' }">在审计日志看全部</RouterLink>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { adminFieldRoutingsApi } from '@/api/adminApi';
import { TERMS } from './terms';
import MkEmptyState from '@/components/mk/MkEmptyState.vue';
import MkLoading from '@/components/mk/MkLoading.vue';

const props = defineProps<{ stage: string }>();
const emit = defineEmits<{ 'open-orchestration': [] }>();

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

/* 变更动作与对象：后端 changeType / targetTable 是内部枚举与下划线表名，直出运营读不懂 */
const CHANGE_TYPE_LABELS: Record<string, string> = {
  'routing-patch': '修改字段路由',
  'orchestration-save': '保存编排文件',
  'orchestration-prune': '清理孤儿行',
  'field-routing-bootstrap-reconcile': '字段路由对账',
  'health-fix': '健康修复',
  'skill-field-delete': '删除字段',
};
const changeTypeText = (v: unknown) => CHANGE_TYPE_LABELS[String(v || '')] || String(v || '—');
const TARGET_TABLE_LABELS: Record<string, string> = {
  agent_field_routings: '字段路由',
  field_definitions: '字段定义',
  agent_contracts: '字段契约',
  node_config_changes: '配置变更',
};
const targetTableText = (v: unknown) => TARGET_TABLE_LABELS[String(v || '')] || String(v || '');

/* 审计行时间/操作人（审核 #81）：接口逐行带 createdAt/actorId/actorRole/reason，
   此前未渲染导致「最近变更」看不出新旧与是谁改的。时间行内取「今天 HH:mm / M/D HH:mm」，
   完整时间戳与原因挂 title；操作人缺省时退回角色或「—」 */
function changeTime(iso: unknown): string {
  const ts = typeof iso === 'string' ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return sameDay ? `今天 ${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function changeTimeFull(iso: unknown): string {
  const ts = typeof iso === 'string' ? new Date(iso).getTime() : NaN;
  return Number.isFinite(ts) ? new Date(ts).toLocaleString() : '时间未知';
}
function actorText(c: Record<string, unknown>): string {
  const id = c.actorId != null && String(c.actorId).trim() ? String(c.actorId) : '';
  if (id) return id;
  const role = c.actorRole != null && String(c.actorRole).trim() ? String(c.actorRole) : '';
  return role || '—';
}
function actorTitle(c: Record<string, unknown>): string {
  const parts: string[] = [`操作人：${actorText(c)}`];
  if (c.actorRole) parts.push(`角色：${String(c.actorRole)}`);
  if (c.reason) parts.push(`原因：${String(c.reason)}`);
  return parts.join(' · ');
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
.fdp__drift-val--db { color: var(--mk-blue, #2f6ae0); font-weight: 600; }
.fdp__drift-act { margin-left: auto; font-size: var(--mk-fs-micro); }
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
/* 时间列等宽数字防跳动；操作人弱化，完整原因/角色在 title（审核 #81） */
.fdp__change-time { color: var(--mk-faint, var(--mk-muted)); font-variant-numeric: tabular-nums; }
.fdp__change-actor { color: var(--mk-muted, #5b6577); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.fdp__changes-foot { display: flex; justify-content: flex-end; padding: 4px 14px 12px; }

@media (min-width: 2000px) {
  .fdp__drift-item { font-size: var(--mk-fs-micro); padding: 9px 14px; }
  .fdp__drift-val { font-size: var(--mk-fs-micro); }
  .fdp__change { font-size: var(--mk-fs-micro); padding: 10px 0; }
}

@media (min-width: 2800px) {
  .fdp__drift-item { font-size: var(--mk-fs-micro); padding: 10px 15px; }
  .fdp__drift-val { font-size: var(--mk-fs-micro); }
  .fdp__change { font-size: var(--mk-fs-micro); padding: 11px 0; }
}
</style>
