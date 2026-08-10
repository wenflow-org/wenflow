<template>
  <div class="frt">
    <div class="frt__toolbar">
      <button type="button" class="frt__toolbar-btn" :disabled="!stage" @click="openOrchestration">编排文件</button>
      <span class="frt__toolbar-hint">编辑 prompts/orchestration/{{ stage }}.yaml（字段路由唯一声明源）</span>
    </div>
    <p class="frt__notice">
      行级编辑已收敛：修改字段路由请使用右上角「编排文件」按钮，保存后新建行即时生效，已有行修改后点「强制同步 DB」
    </p>

    <!-- 图例：角色 / render / 锁定 一句话人话表（可折叠） -->
    <details class="frt__legend" :open="legendOpen" @toggle="legendOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="frt__legend-summary">图例：字段角色 / render / 锁定 —— 不懂就看这里</summary>
      <div class="frt__legend-body">
        <div class="frt__legend-group frt__legend-group--roles">
          <h5 class="frt__legend-title">字段角色（promptRole）</h5>
          <ul class="frt__legend-list">
            <li v-for="m in ROLE_META" :key="m.id" class="frt__legend-item">
              <span class="frt__role" :class="`frt__role--${m.id}`">{{ m.label }}</span>
              <span class="frt__legend-en mono">{{ m.id }}</span>
              <span class="frt__legend-hint">{{ m.hint }}</span>
            </li>
          </ul>
        </div>
        <div class="frt__legend-group">
          <h5 class="frt__legend-title">render（是否对外可见）</h5>
          <ul class="frt__legend-list">
            <li class="frt__legend-item">
              <span class="frt__render-badge frt__render-badge--visible">visible</span>
              <span class="frt__legend-hint">可见：会出现在对外交付（用户 / 界面）</span>
            </li>
            <li class="frt__legend-item">
              <span class="frt__render-badge frt__render-badge--hidden">hidden</span>
              <span class="frt__legend-hint">隐藏：仅内部流转，不对外展示</span>
            </li>
          </ul>
          <h5 class="frt__legend-title">锁定</h5>
          <ul class="frt__legend-list">
            <li class="frt__legend-item">
              <span class="frt__lock frt__lock--system-locked">系统锁</span>
              <span class="frt__legend-hint">平台派生 / 代码消费，admin 不可直接改（需改编排文件）</span>
            </li>
            <li class="frt__legend-item">
              <span class="frt__lock frt__lock--structure-locked">结构锁</span>
              <span class="frt__legend-hint">结构约束锁定，修改需谨慎</span>
            </li>
            <li class="frt__legend-item">
              <span class="frt__lock frt__lock--editable">可编辑</span>
              <span class="frt__legend-hint">可自由调整（仍走编排文件入口）</span>
            </li>
          </ul>
        </div>
      </div>
      <p class="frt__legend-foot">
        机制说明见仓库 <span class="mono">prompts/orchestration/_README.md</span> · 设计落盘
        <span class="mono">doc/FIELD_ROUTING_UX_REDESIGN.md</span>
      </p>
    </details>

    <!-- 搜索 / 角色过滤 -->
    <div class="mk-filter frt__filter">
      <input v-model="keyword" class="mk-filter__input" type="search" placeholder="搜索字段名 / 含义 / 角色 / render / 移交…" />
      <select v-model="roleFilter" class="mk-filter__select" aria-label="按角色过滤">
        <option value="">全部角色</option>
        <option v-for="m in ROLE_META" :key="m.id" :value="m.id">{{ m.label }}（{{ m.id }}）</option>
      </select>
      <span v-if="filterActive" class="frt__filter-count">命中 {{ filteredTotal }} / {{ routings.length }} 行</span>
    </div>

    <div v-if="loading" class="frt__empty">加载中…</div>
    <div v-else-if="error" class="frt__empty">{{ error }}</div>
    <template v-else>
      <div v-for="agent in agents" :key="agent.agentId" class="frt__agent">
        <div class="frt__agenthead">
          <span class="frt__agentname mono">{{ agent.agentId }}</span>
          <span class="frt__agentdesc">{{ agent.description }}</span>
          <span class="frt__agentcount">{{ filteredOf(agent.agentId).length }}<template v-if="filterActive"> / {{ routingsOf(agent.agentId).length }}</template> 行</span>
        </div>
        <div class="frt__scroll">
          <table class="frt__table">
            <thead>
              <tr>
                <th scope="col">字段</th>
                <th scope="col">含义</th>
                <th scope="col">类型</th>
                <th scope="col">角色</th>
                <th scope="col">render</th>
                <th scope="col">handoff</th>
                <th scope="col">internal</th>
                <th scope="col">accumulate</th>
                <th scope="col">锁定</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in filteredOf(agent.agentId)" :key="row.id">
                <td class="frt__fieldcell">
                  <span class="mono frt__field">{{ row.fieldId }}</span>
                  <span v-if="pathParts(row.fieldId).length > 1" class="frt__fieldpath" :title="row.fieldId">{{ pathParts(row.fieldId).join(' · ') }}</span>
                </td>
                <td class="frt__meaning">
                  <span class="frt__meaning-text" :title="meaningTitle(row)">{{ descOf(row.fieldId) || '—' }}</span>
                </td>
                <td class="mono">{{ typeOf(row.fieldId) }}</td>
                <td>
                  <span
                    v-if="roleMetaOf(row.fieldId)"
                    class="frt__role"
                    :class="`frt__role--${roleMetaOf(row.fieldId)!.id}`"
                    :title="roleMetaOf(row.fieldId)!.hint"
                  >{{ roleMetaOf(row.fieldId)!.label }}</span>
                  <span v-else class="mk-na">—</span>
                </td>
                <td>
                  <span
                    class="frt__render-badge"
                    :class="`frt__render-badge--${row.render}`"
                    :title="renderHint(row)"
                  >{{ row.render }}</span>
                </td>
                <td><span class="mono frt__handoff" :title="handoffTitle(row)">{{ formatHandoff(row.handoff) }}</span></td>
                <td>{{ row.internal ? '是' : '否' }}</td>
                <td>{{ row.accumulate ? '是' : '否' }}</td>
                <td><span class="frt__lock" :class="`frt__lock--${row.locks?.level || 'editable'}`" :title="lockHint(row.locks?.level)">{{ lockLabel(row.locks?.level) }}</span></td>
              </tr>
              <tr v-if="filteredOf(agent.agentId).length === 0">
                <td colspan="9" class="frt__emptyrow">
                  {{ routingsOf(agent.agentId).length ? '无匹配行，试试调整搜索或角色过滤' : '该 Agent 无字段路由行' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 编排文件编辑弹窗 -->
    <div v-if="orchOpen" ref="orchMaskRef" class="mk-modal">
      <div ref="orchPanelRef" class="mk-modal__panel frt__orch-panel" role="dialog" aria-label="编排文件编辑">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">编排文件 · {{ stage }}.yaml</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="orchOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <div class="frt__orch-summary">
            <span class="mono">prompts/orchestration/{{ stage }}.yaml</span>
            <span>契约 {{ orchSummary.contractCount }} · 字段 {{ orchSummary.fieldCount }} · 路由 {{ orchSummary.routingCount }}</span>
          </div>
          <textarea
            v-model="orchContent"
            class="frt__orch-textarea mono"
            rows="26"
            spellcheck="false"
            placeholder="编排文件 YAML 原文…"
          ></textarea>
          <p v-if="orchMsg" class="frt__orch-msg">{{ orchMsg }}</p>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" :disabled="orchSaving || orchSyncing" @click="orchOpen = false">关闭</button>
          <button type="button" class="mk-btn" :disabled="orchSaving || orchSyncing" @click="forceSync">强制同步 DB</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="orchSaving || orchSyncing" @click="saveOrchestration">
            {{ orchSaving ? '保存中…' : '保存到编排文件' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { adminFieldRoutingsApi } from '@/api/adminApi';
import { useEscape } from './useEscape';
import { useOverlay, useMaskClose } from './useOverlay';
import { toast } from '@/utils/toast';

interface FieldItem {
  fieldId: string;
  valueType?: string;
  promptRole?: string;
  description?: string | null;
  enumValues?: unknown;
  locks?: { level?: string };
}
interface AgentItem { agentId: string; description?: string }
interface RoutingItem {
  id: string;
  agentId: string;
  fieldId: string;
  render: string;
  handoff: string | string[] | null;
  internal: boolean;
  accumulate: boolean;
  locks?: { level?: string };
  notes?: string | null;
  visibilityPreset?: string | null;
}

const props = defineProps<{ stage: string }>();
const emit = defineEmits<{ changed: [] }>();

/* ============ 词表：角色人话映射（图例 + 单元格共用单一来源） ============ */

const ROLE_META: Array<{ id: string; label: string; hint: string }> = [
  { id: 'hard-required', label: '必填', hint: '必填：缺了这个字段，本阶段流程就无法推进' },
  { id: 'soft-info', label: '可选补充', hint: '可选补充：拿到更好，缺失也能继续' },
  { id: 'hidden-inference', label: '隐式推断', hint: '隐式推断：模型内部推理，不直接展示给用户' },
  { id: 'public-reply', label: '公开回复', hint: '公开回复：直接呈现给用户看的对话内容' },
  { id: 'proposal-output', label: '方案产出', hint: '方案产出：确认下来的结论 / 计划 / 范围' },
  { id: 'derived-presentation', label: '派生展示', hint: '派生展示：由其他字段计算派生，用于界面展示' },
  { id: 'control-signal', label: '控制信号', hint: '控制信号：平台流程 / UI 控制用，不是学习内容' },
];

const fields = ref<FieldItem[]>([]);
const agents = ref<AgentItem[]>([]);
const routings = ref<RoutingItem[]>([]);
const loading = ref(false);
const error = ref('');
const keyword = ref('');
const roleFilter = ref('');
const legendOpen = ref(false);

const fieldMap = () => new Map(fields.value.map((f) => [f.fieldId, f]));

function typeOf(fieldId: string) { return fieldMap().get(fieldId)?.valueType || '—'; }
function descOf(fieldId: string) { return fieldMap().get(fieldId)?.description || ''; }
function roleOf(fieldId: string) { return fieldMap().get(fieldId)?.promptRole || ''; }
function roleMetaOf(fieldId: string) {
  const role = roleOf(fieldId);
  if (!role) return undefined;
  const meta = ROLE_META.find((m) => m.id === role);
  return meta || { id: role, label: role, hint: role };
}
function pathParts(fieldId: string) { return fieldId.split('.'); }
function routingsOf(agentId: string) { return routings.value.filter((r) => r.agentId === agentId); }

const filterActive = computed(() => Boolean(keyword.value.trim() || roleFilter.value));
const filteredTotal = computed(() => routings.value.filter(matches).length);

function matches(r: RoutingItem) {
  if (roleFilter.value && roleOf(r.fieldId) !== roleFilter.value) return false;
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return true;
  const meta = roleMetaOf(r.fieldId);
  const hay = [
    r.fieldId,
    descOf(r.fieldId),
    meta?.label || '',
    meta?.hint || '',
    r.render,
    r.visibilityPreset || '',
    formatHandoff(r.handoff),
    lockLabel(r.locks?.level),
    r.notes || '',
  ].join(' ').toLowerCase();
  return hay.includes(kw);
}

function filteredOf(agentId: string) {
  return routingsOf(agentId).filter(matches);
}

function formatHandoff(raw: string | string[] | null) {
  if (!raw) return '';
  if (Array.isArray(raw)) return raw.join(', ');
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.join(', ') : raw;
  } catch {
    return raw;
  }
}
function handoffTitle(row: RoutingItem) {
  const parts: string[] = [];
  if (row.handoff) parts.push(`移交 → ${formatHandoff(row.handoff)}`);
  if (row.visibilityPreset) parts.push(`可见性预设：${row.visibilityPreset}`);
  if (row.notes) parts.push(`备注：${row.notes}`);
  return parts.join('\n');
}
function meaningTitle(row: RoutingItem) {
  const parts: string[] = [];
  const desc = descOf(row.fieldId);
  if (desc) parts.push(desc);
  const ev = fieldMap().get(row.fieldId)?.enumValues;
  if (Array.isArray(ev) && ev.length) parts.push(`取值：${ev.join(' / ')}`);
  if (row.notes) parts.push(`备注：${row.notes}`);
  return parts.join('\n');
}
function renderHint(row: RoutingItem) {
  const base = row.render === 'hidden' ? '隐藏：仅内部流转，不对外展示' : '可见：会出现在对外交付（用户 / 界面）';
  return row.visibilityPreset ? `${base}\n可见性预设：${row.visibilityPreset}` : base;
}
function lockLabel(level?: string) {
  if (level === 'system-locked') return '系统锁';
  if (level === 'structure-locked') return '结构锁';
  return '可编辑';
}
function lockHint(level?: string) {
  if (level === 'system-locked') return '系统锁：平台派生 / 代码消费，admin 不可直接改（需改编排文件）';
  if (level === 'structure-locked') return '结构锁：结构约束锁定，修改需谨慎';
  return '可编辑：可自由调整（仍走编排文件入口）';
}

async function loadStage() {
  if (!props.stage) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await adminFieldRoutingsApi.getStageDetail(props.stage);
    fields.value = res.data?.data?.fields || [];
    agents.value = res.data?.data?.agents || [];
    routings.value = res.data?.data?.routings || [];
  } catch (e: any) {
    error.value = e?.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

// ============ 编排文件编辑（单源化批次 C） ============

const orchOpen = ref(false);
const orchContent = ref('');
const orchSummary = ref({ contractCount: 0, fieldCount: 0, routingCount: 0 });
const orchSaving = ref(false);
const orchSyncing = ref(false);
const orchMsg = ref('');
const orchPanelRef = ref<HTMLElement | null>(null);
const orchMaskRef = ref<HTMLElement | null>(null);

useEscape(() => orchOpen.value, () => { orchOpen.value = false; });
useOverlay(orchOpen, orchPanelRef);
useMaskClose(orchMaskRef, () => { orchOpen.value = false; });

function errOf(e: any) {
  return e?.response?.data?.error?.message || e?.message || '操作失败';
}

async function openOrchestration() {
  orchMsg.value = '';
  try {
    const res = await adminFieldRoutingsApi.getOrchestrationFile(props.stage);
    const data = res.data?.data || {};
    orchContent.value = data.content || '';
    orchSummary.value = data.parsed || { contractCount: 0, fieldCount: 0, routingCount: 0 };
    orchOpen.value = true;
  } catch (e: any) {
    toast.error(errOf(e));
  }
}

async function saveOrchestration() {
  orchMsg.value = '';
  if (!orchContent.value.trim()) {
    orchMsg.value = '内容为空，未保存';
    return;
  }
  orchSaving.value = true;
  try {
    const res = await adminFieldRoutingsApi.saveOrchestrationFile(props.stage, orchContent.value);
    const data = res.data?.data || {};
    orchSummary.value = {
      contractCount: Number(data.contractCount) || 0,
      fieldCount: Number(data.fieldCount) || 0,
      routingCount: Number(data.routingCount) || 0,
    };
    orchMsg.value = data.syncHint || '已保存';
    toast.success('编排文件已保存');
    await loadStage();
    emit('changed');
  } catch (e: any) {
    orchMsg.value = errOf(e);
  } finally {
    orchSaving.value = false;
  }
}

async function forceSync() {
  orchMsg.value = '';
  orchSyncing.value = true;
  try {
    const res = await adminFieldRoutingsApi.syncOrchestrationFile(props.stage);
    const data = res.data?.data || {};
    const skipped: Array<{ table: string; key: string }> = Array.isArray(data.skippedAdminRows) ? data.skippedAdminRows : [];
    let msg = `已对账：契约 ${data.contractsUpdated ?? 0} · 字段 ${data.fieldsUpdated ?? 0} · 路由 ${data.routingsUpdated ?? 0} · 新建 ${data.createdCount ?? 0}`;
    if (skipped.length) {
      const sample = skipped.slice(0, 5).map((s) => `${s.table}:${s.key}`).join('、');
      msg += `；跳过 admin 覆盖行 ${skipped.length} 条（${sample}${skipped.length > 5 ? '…' : ''}）`;
    } else {
      msg += '；无 admin 覆盖行被跳过';
    }
    orchMsg.value = msg;
    toast.success('强制同步完成');
    await loadStage();
    emit('changed');
  } catch (e: any) {
    orchMsg.value = errOf(e);
  } finally {
    orchSyncing.value = false;
  }
}

onMounted(() => void loadStage());
watch(() => props.stage, () => void loadStage());
</script>

<style scoped>
.frt__toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.frt__notice {
  margin: 0 0 14px;
  padding: 8px 12px;
  border: 1px dashed rgba(52, 120, 246, 0.45);
  border-radius: 9px;
  background: #f0f5ff;
  color: var(--mk-blue, #3478f6);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.55;
}
.frt__toolbar-btn {
  padding: 8px 16px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 8px;
  background: var(--mk-surface, #fff);
  color: var(--mk-blue, #3478f6);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease;
}
.frt__toolbar-btn:hover { background: #f6f9ff; border-color: rgba(52, 120, 246, 0.4); }
.frt__toolbar-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.frt__toolbar-hint { color: var(--mk-faint, #71809a); font-size: 12px; }

/* ========== 图例（可折叠） ========== */
.frt__legend {
  margin: 0 0 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 10px;
  background: var(--mk-surface, #fff);
  box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06));
}
.frt__legend-summary {
  padding: 9px 14px;
  cursor: pointer;
  user-select: none;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-muted, #5b6577);
  list-style: none;
  transition: color 0.14s ease;
}
.frt__legend-summary::-webkit-details-marker { display: none; }
.frt__legend-summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 7px;
  color: var(--mk-blue, #3478f6);
  transition: transform 0.14s ease;
}
.frt__legend[open] .frt__legend-summary::before { transform: rotate(90deg); }
.frt__legend-summary:hover { color: var(--mk-ink, #1a2a44); }
.frt__legend-body {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 14px;
  padding: 4px 14px 10px;
}
@media (max-width: 860px) {
  .frt__legend-body { grid-template-columns: 1fr; }
}
.frt__legend-title {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint, #71809a);
}
.frt__legend-group--roles + .frt__legend-group .frt__legend-title { margin-top: 10px; }
.frt__legend-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
.frt__legend-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
.frt__legend-en { flex-shrink: 0; font-size: 11px; color: var(--mk-faint, #71809a); }
.frt__legend-hint { font-size: 12px; color: var(--mk-muted, #5b6577); min-width: 0; }
.frt__legend-foot {
  margin: 0;
  padding: 6px 14px 10px;
  font-size: 11px;
  color: var(--mk-faint, #71809a);
}
.frt__legend-foot .mono { font-size: 11px; color: var(--mk-blue, #3478f6); }

/* ========== 搜索 / 过滤 ========== */
.frt__filter { margin-bottom: 12px; }
.frt__filter-count { font-size: 11.5px; color: var(--mk-faint, #71809a); font-weight: 600; }

.frt__orch-panel { width: min(820px, 100%); }
.frt__orch-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 9px;
  background: #fafbfd;
  color: var(--mk-muted, #5b6577);
  font-size: 12px;
}
.frt__orch-summary .mono { color: var(--mk-blue, #3478f6); font-weight: 600; }
.frt__orch-textarea {
  width: 100%;
  min-height: 420px;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 10px;
  background: #fbfcfe;
  color: var(--mk-ink, #1a2a44);
  font-size: 12px;
  line-height: 1.55;
  resize: vertical;
  outline: none;
}
.frt__orch-textarea:focus { border-color: var(--mk-blue, #3478f6); }
.frt__orch-msg {
  margin: 0;
  padding: 9px 12px;
  border: 1px solid rgba(52, 120, 246, 0.35);
  border-radius: 9px;
  background: #f0f5ff;
  color: var(--mk-blue, #3478f6);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
}
.frt__agent { margin-bottom: 18px; border: 1px solid var(--mk-line, #e6ebf4); border-radius: 12px; overflow: hidden; background: var(--mk-surface, #fff); box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06)); }
.frt__agenthead { padding: 10px 14px; background: #fafbfd; border-bottom: 1px solid var(--mk-line, #e6ebf4); display: flex; align-items: baseline; gap: 10px; }
.frt__agentname { font-weight: 700; color: var(--mk-ink, #1a2a44); }
.frt__agentdesc { color: var(--mk-faint, #71809a); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frt__agentcount { margin-left: auto; padding: 1px 9px; border-radius: 999px; background: #eef2fa; color: var(--mk-muted, #5b6577); font-size: 11px; font-weight: 700; white-space: nowrap; }
.frt__table { width: 100%; border-collapse: collapse; }
/* 9 列表格：窄屏横向滚动（≤860px 设最小宽度，列不被挤压） */
.frt__scroll { overflow-x: auto; }
@media (max-width: 860px) {
  .frt__table { min-width: 900px; }
  .frt__table th, .frt__table td { padding: 7px 9px; }
}
.frt__table th, .frt__table td { padding: 8px 12px; text-align: left; }
.frt__table th {
  background: #fafbfc;
  border-bottom: 1px solid var(--mk-line, #e6ebf4);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint, #71809a);
  white-space: nowrap;
}
.frt__table td { border-bottom: 1px solid #f6f7f9; font-size: 12.5px; vertical-align: middle; }
.frt__table tr:last-child td { border-bottom: none; }
.frt__table tbody tr { transition: background 0.12s; }
.frt__table tbody tr:hover { background: #f6f9ff; }

/* 字段列：点分名 + 层级分段小字 */
.frt__fieldcell { max-width: 300px; display: grid; gap: 2px; min-width: 0; }
.frt__field { word-break: break-all; color: var(--mk-ink, #1a2a44); }
.frt__fieldpath {
  font-size: 10.5px;
  color: var(--mk-faint, #71809a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 含义列 */
.frt__meaning { min-width: 200px; max-width: 340px; }
.frt__meaning-text {
  display: block;
  color: var(--mk-muted, #5b6577);
  line-height: 1.5;
  max-height: 3em;
  overflow: hidden;
}

/* 角色徽章（7 类着色，与图例共用） */
.frt__role { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.frt__role--hard-required { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red-strong, #b91c1c); }
.frt__role--soft-info { background: #eff6ff; color: #2563eb; }
.frt__role--hidden-inference { background: #f4f0ff; color: #7c3aed; }
.frt__role--public-reply { background: var(--mk-green-bg, #ecfdf5); color: var(--mk-green, #15803d); }
.frt__role--proposal-output { background: #effcf9; color: #0d9488; }
.frt__role--derived-presentation { background: var(--mk-amber-bg, #fffbeb); color: var(--mk-amber, #b45309); }
.frt__role--control-signal { background: #f0f2f5; color: #5b6577; }

/* render 徽章 */
.frt__render-badge { display: inline-block; padding: 1px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.frt__render-badge--visible { background: #e8f7ef; color: #15803d; }
.frt__render-badge--hidden { background: #f0f2f5; color: #5b6577; }

.frt__handoff { max-width: 220px; color: var(--mk-faint, #71809a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frt__lock { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.frt__lock--system-locked { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.frt__lock--structure-locked { background: var(--mk-amber-bg, #fffbeb); color: var(--mk-amber, #b45309); border: 1px dashed rgba(180, 83, 9, 0.45); }
.frt__lock--editable, .frt__lock--fully-editable { background: var(--mk-green-bg, #ecfdf5); color: var(--mk-green, #15803d); }
.frt__empty { padding: 30px; color: var(--mk-faint, #71809a); text-align: center; }
.frt__emptyrow { color: var(--mk-faint, #71809a); text-align: center; padding: 14px; }
</style>
