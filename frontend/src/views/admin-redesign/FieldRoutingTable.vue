<template>
  <div class="frt">
    <div v-if="loading" class="frt__empty">加载中…</div>
    <div v-else-if="error" class="frt__empty">{{ error }}</div>
    <template v-else>
      <div v-for="agent in agents" :key="agent.agentId" class="frt__agent">
        <div class="frt__agenthead">
          <span class="frt__agentname mono">{{ agent.agentId }}</span>
          <span class="frt__agentdesc">{{ agent.description }}</span>
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
              <td>{{ roleOf(row.fieldId) }}</td>
              <td>
                <select :value="row.render" @change="onRender(agent.agentId, row, ($event.target as HTMLSelectElement).value)">
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
.frt__agent { margin-bottom: 18px; border: 1px solid var(--mk-border, #ddd); border-radius: 8px; overflow: hidden; }
.frt__agenthead { padding: 10px 14px; background: #f7f7f9; display: flex; align-items: baseline; gap: 10px; }
.frt__agentname { font-weight: 600; }
.frt__agentdesc { color: #888; }
.frt__table { width: 100%; border-collapse: collapse; }
.frt__table th, .frt__table td { padding: 6px 10px; border-bottom: 1px solid #eee; text-align: left; }
.frt__table th { background: #fafafa; font-weight: 500; }
.frt__field { max-width: 300px; word-break: break-all; }
.frt__handoff { max-width: 220px; }
.frt__handoff-input { width: 220px; padding: 3px 6px; border: 1px solid var(--mk-border, #ddd); border-radius: 4px; font-size: 12px; }
.frt__op { padding: 2px 6px; border: 1px solid var(--mk-border, #ddd); border-radius: 4px; background: #fff; cursor: pointer; font-size: 12px; }
.frt__op:hover { border-color: var(--mk-primary, #4f46e5); color: var(--mk-primary, #4f46e5); }
.frt__lock { padding: 2px 6px; border-radius: 4px; font-size: 12px; }
.frt__lock--system-locked { background: #fee2e2; color: #b91c1c; }
.frt__lock--structure-locked { background: #fef3c7; color: #92400e; }
.frt__lock--editable { background: #dcfce7; color: #15803d; }
.frt__empty { padding: 30px; color: #888; text-align: center; }
.frt__emptyrow { color: #aaa; text-align: center; padding: 10px; }
</style>
