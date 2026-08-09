<template>
  <div class="frt">
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
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in routingsOf(agent.agentId)" :key="row.id">
              <td class="mono frt__field">{{ row.fieldId }}</td>
              <td class="mono">{{ typeOf(row.fieldId) }}</td>
              <td><span class="frt__role">{{ roleOf(row.fieldId) }}</span></td>
              <td>
                <select class="frt__select" :value="row.render" @change="onRender(agent.agentId, row, ($event.target as HTMLSelectElement).value)">
                  <option value="visible">visible</option>
                  <option value="hidden">hidden</option>
                </select>
              </td>
              <td>
                <input
                  v-if="row.locks?.level !== 'system-locked'"
                  class="frt__handoff-input mono"
                  :value="formatHandoff(row.handoff)"
                  placeholder="逗号分隔：skill:xxx / stage"
                  @change="onHandoff(agent.agentId, row, ($event.target as HTMLInputElement).value)"
                />
                <span v-else class="mono frt__handoff">{{ formatHandoff(row.handoff) }}</span>
              </td>
              <td>{{ row.internal ? '是' : '否' }}</td>
              <td>{{ row.accumulate ? '是' : '否' }}</td>
              <td><span class="frt__lock" :class="`frt__lock--${row.locks?.level || 'editable'}`">{{ lockLabel(row.locks?.level) }}</span></td>
              <td>
                <button v-if="row.locks?.level !== 'system-locked'" class="frt__op" @click="toggleInternal(agent.agentId, row)">internal↔</button>
                <button v-if="row.locks?.level !== 'system-locked'" class="frt__op" @click="toggleAccumulate(agent.agentId, row)">accumulate↔</button>
              </td>
            </tr>
            <tr v-if="routingsOf(agent.agentId).length === 0">
              <td colspan="9" class="frt__emptyrow">该 Agent 无字段路由行</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { adminFieldRoutingsApi } from '@/api/adminApi';

interface FieldItem { fieldId: string; valueType?: string; promptRole?: string; locks?: { level?: string } }
interface AgentItem { agentId: string; description?: string }
interface RoutingItem {
  id: string;
  agentId: string;
  fieldId: string;
  render: string;
  handoff: string | null;
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
function formatHandoff(raw: string | null) {
  if (!raw) return '';
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

async function patch(agentId: string, row: RoutingItem, data: Record<string, unknown>) {
  try {
    await adminFieldRoutingsApi.updateRouting(agentId, row.fieldId, data);
    await loadStage();
    emit('changed');
  } catch (e: any) {
    error.value = e?.message || '保存失败';
  }
}

async function onRender(agentId: string, row: RoutingItem, render: string) {
  await patch(agentId, row, { render: render as 'visible' | 'hidden' });
}

async function onHandoff(agentId: string, row: RoutingItem, value: string) {
  const handoff = value.split(',').map((s) => s.trim()).filter(Boolean);
  await patch(agentId, row, { handoff });
}

async function toggleInternal(agentId: string, row: RoutingItem) {
  await patch(agentId, row, { internal: !row.internal });
}

async function toggleAccumulate(agentId: string, row: RoutingItem) {
  await patch(agentId, row, { accumulate: !row.accumulate });
}

onMounted(() => void loadStage());
watch(() => props.stage, () => void loadStage());
</script>

<style scoped>
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
.frt__handoff { max-width: 220px; color: var(--mk-faint, #71809a); }
.frt__select {
  padding: 3px 8px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 7px;
  background: var(--mk-surface, #fff);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.frt__select:focus { border-color: var(--mk-blue, #3478f6); }
.frt__handoff-input {
  width: 220px;
  padding: 4px 8px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 7px;
  background: var(--mk-surface, #fff);
  color: var(--mk-ink, #1a2a44);
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}
.frt__handoff-input:focus { border-color: var(--mk-blue, #3478f6); }
.frt__op {
  padding: 3px 9px;
  margin-right: 4px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 7px;
  background: var(--mk-surface, #fff);
  color: var(--mk-muted, #5b6577);
  cursor: pointer;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  transition: border-color 0.12s ease, color 0.12s ease;
}
.frt__op:hover { border-color: rgba(52, 120, 246, 0.45); color: var(--mk-blue, #3478f6); }
.frt__lock { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.frt__lock--system-locked { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.frt__lock--structure-locked { background: var(--mk-amber-bg, #fffbeb); color: var(--mk-amber, #b45309); border: 1px dashed rgba(180, 83, 9, 0.45); }
.frt__lock--editable, .frt__lock--fully-editable { background: var(--mk-green-bg, #ecfdf5); color: var(--mk-green, #15803d); }
.frt__empty { padding: 30px; color: var(--mk-faint, #71809a); text-align: center; }
.frt__emptyrow { color: var(--mk-faint, #71809a); text-align: center; padding: 14px; }
</style>
