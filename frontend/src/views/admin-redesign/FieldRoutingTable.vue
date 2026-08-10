<template>
  <div class="frt">
    <div class="frt__toolbar">
      <button type="button" class="frt__toolbar-btn" :disabled="!stage" @click="openOrchestration">编排文件</button>
      <span class="frt__toolbar-hint">编辑 prompts/orchestration/{{ stage }}.yaml（字段路由唯一声明源）</span>
    </div>
    <p class="frt__notice">
      行级编辑已收敛：修改字段路由请使用右上角「编排文件」按钮，保存后新建行即时生效，已有行修改后点「强制同步 DB」
    </p>
    <div v-if="loading" class="frt__empty">加载中…</div>
    <div v-else-if="error" class="frt__empty">{{ error }}</div>
    <template v-else>
      <div v-for="agent in agents" :key="agent.agentId" class="frt__agent">
        <div class="frt__agenthead">
          <span class="frt__agentname mono">{{ agent.agentId }}</span>
          <span class="frt__agentdesc">{{ agent.description }}</span>
          <span class="frt__agentcount">{{ routingsOf(agent.agentId).length }} 行</span>
        </div>
        <table class="frt__table">
          <thead>
            <tr>
              <th>字段</th>
              <th>类型</th>
              <th>角色</th>
              <th>render</th>
              <th>handoff</th>
              <th>internal</th>
              <th>accumulate</th>
              <th>锁定</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in routingsOf(agent.agentId)" :key="row.id">
              <td class="mono frt__field">{{ row.fieldId }}</td>
              <td class="mono">{{ typeOf(row.fieldId) }}</td>
              <td><span class="frt__role">{{ roleOf(row.fieldId) }}</span></td>
              <td><span class="mono frt__render">{{ row.render }}</span></td>
              <td><span class="mono frt__handoff">{{ formatHandoff(row.handoff) }}</span></td>
              <td>{{ row.internal ? '是' : '否' }}</td>
              <td>{{ row.accumulate ? '是' : '否' }}</td>
              <td><span class="frt__lock" :class="`frt__lock--${row.locks?.level || 'editable'}`">{{ lockLabel(row.locks?.level) }}</span></td>
            </tr>
            <tr v-if="routingsOf(agent.agentId).length === 0">
              <td colspan="8" class="frt__emptyrow">该 Agent 无字段路由行</td>
            </tr>
          </tbody>
        </table>
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
import { onMounted, ref, watch } from 'vue';
import { adminFieldRoutingsApi } from '@/api/adminApi';
import { useEscape } from './useEscape';
import { useOverlay, useMaskClose } from './useOverlay';
import { toast } from '@/utils/toast';

interface FieldItem { fieldId: string; valueType?: string; promptRole?: string; locks?: { level?: string } }
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
}

const props = defineProps<{ stage: string }>();
const emit = defineEmits<{ changed: [] }>();

const fields = ref<FieldItem[]>([]);
const agents = ref<AgentItem[]>([]);
const routings = ref<RoutingItem[]>([]);
const loading = ref(false);
const error = ref('');

const fieldMap = () => new Map(fields.value.map((f) => [f.fieldId, f]));

function typeOf(fieldId: string) { return fieldMap().get(fieldId)?.valueType || '—'; }
function roleOf(fieldId: string) { return fieldMap().get(fieldId)?.promptRole || '—'; }
function routingsOf(agentId: string) { return routings.value.filter((r) => r.agentId === agentId); }
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
function lockLabel(level?: string) {
  if (level === 'system-locked') return '系统锁';
  if (level === 'structure-locked') return '结构锁';
  return '可编辑';
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
  padding: 6px 14px;
  border: 1px solid rgba(52, 120, 246, 0.5);
  border-radius: 8px;
  background: var(--mk-surface, #fff);
  color: var(--mk-blue, #3478f6);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.frt__toolbar-btn:hover { background: #f0f5ff; }
.frt__toolbar-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.frt__toolbar-hint { color: var(--mk-faint, #71809a); font-size: 12px; }
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
.frt__field { max-width: 300px; word-break: break-all; color: var(--mk-ink, #1a2a44); }
.frt__role { display: inline-block; padding: 1px 8px; border-radius: 999px; background: #f0f2f5; color: var(--mk-muted, #5b6577); font-size: 11px; font-weight: 600; }
.frt__render { color: var(--mk-ink, #1a2a44); }
.frt__handoff { max-width: 220px; color: var(--mk-faint, #71809a); }
.frt__lock { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.frt__lock--system-locked { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.frt__lock--structure-locked { background: var(--mk-amber-bg, #fffbeb); color: var(--mk-amber, #b45309); border: 1px dashed rgba(180, 83, 9, 0.45); }
.frt__lock--editable, .frt__lock--fully-editable { background: var(--mk-green-bg, #ecfdf5); color: var(--mk-green, #15803d); }
.frt__empty { padding: 30px; color: var(--mk-faint, #71809a); text-align: center; }
.frt__emptyrow { color: var(--mk-faint, #71809a); text-align: center; padding: 14px; }
</style>
