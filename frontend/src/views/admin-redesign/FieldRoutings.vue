<template>
  <div class="frc">
    <div class="frc__head">
      <h2 class="frc__title">字段路由中心</h2>
      <p class="frc__sub">字段归属 / 流向 / 可见性配置。修改后由 seed 漂移检测与对账脚本守护一致性（admin 编辑行豁免）。</p>
    </div>

    <details class="frc__sandbox">
      <summary class="frc__sandbox-summary">沙盘契约视图（输入通道 / 输出字段 / 合法沙盘键，只读）</summary>
      <div v-if="sandboxError" class="frc__empty">{{ sandboxError }}</div>
      <template v-else-if="sandboxAgents.length">
        <div v-for="agent in sandboxAgents" :key="agent.agentId" class="frc__agent">
          <div class="frc__agenthead">
            <span class="frc__agentname mono">{{ agent.agentId }}</span>
            <span class="frc__agentdesc">{{ agent.agentName }}</span>
          </div>
          <div class="frc__sandbox-grid">
            <div>
              <h4 class="frc__sandbox-label">输入通道（编排注入）</h4>
              <ul v-if="agent.inputChannels.length" class="frc__sandbox-list mono">
                <li v-for="c in agent.inputChannels" :key="c.path">
                  {{ c.path }}<span v-if="c.type" class="frc__sandbox-type">（{{ c.type }}）</span>
                  <span class="frc__sandbox-src">[{{ c.source }}]</span>
                </li>
              </ul>
              <p v-else class="frc__empty">无登记输入通道</p>
            </div>
            <div>
              <h4 class="frc__sandbox-label">输出 / 交付字段</h4>
              <ul v-if="agent.outputFields.length" class="frc__sandbox-list mono">
                <li v-for="f in agent.outputFields" :key="f.fieldId">
                  {{ f.fieldId }}<span v-if="f.type" class="frc__sandbox-type">（{{ f.type }}）</span>
                  <span v-if="f.handoff?.length" class="frc__sandbox-handoff">移交→{{ f.handoff.join('/') }}</span>
                </li>
              </ul>
              <p v-else class="frc__empty">无输出字段</p>
            </div>
          </div>
        </div>
      </template>
      <p v-else class="frc__empty">加载中…</p>
    </details>

    <div class="frc__tabs">
      <button
        v-for="s in stageList"
        :key="s.id"
        class="frc__tab"
        :class="{ 'is-active': stage === s.id }"
        @click="switchStage(s.id)"
      >{{ s.displayName }}</button>
    </div>

    <div v-if="loading" class="frc__empty">加载中…</div>
    <div v-else-if="error" class="frc__empty">{{ error }}</div>

    <template v-else>
      <div v-for="agent in agents" :key="agent.agentId" class="frc__agent">
        <div class="frc__agenthead">
          <span class="frc__agentname mono">{{ agent.agentId }}</span>
          <span class="frc__agentdesc">{{ agent.description }}</span>
        </div>
        <table class="frc__table">
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
              <td class="mono frc__field">{{ row.fieldId }}</td>
              <td class="mono">{{ typeOf(row.fieldId) }}</td>
              <td>{{ roleOf(row.fieldId) }}</td>
              <td>
                <select :value="row.render" @change="onRender(agent.agentId, row, ($event.target as HTMLSelectElement).value)">
                  <option value="visible">visible</option>
                  <option value="hidden">hidden</option>
                </select>
              </td>
              <td class="mono frc__handoff">{{ formatHandoff(row.handoff) }}</td>
              <td>{{ row.internal ? '是' : '否' }}</td>
              <td>{{ row.accumulate ? '是' : '否' }}</td>
              <td><span class="frc__lock" :class="`frc__lock--${row.locks?.level || 'editable'}`">{{ lockLabel(row.locks?.level) }}</span></td>
              <td>
                <button v-if="row.locks?.level !== 'system-locked'" class="mk-link" @click="toggleInternal(agent.agentId, row)">internal↔</button>
                <button v-if="row.locks?.level !== 'system-locked'" class="mk-link" @click="toggleAccumulate(agent.agentId, row)">accumulate↔</button>
              </td>
            </tr>
            <tr v-if="routingsOf(agent.agentId).length === 0">
              <td colspan="9" class="frc__emptyrow">该 Agent 无字段路由行</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="changes.length" class="frc__changes">
        <h3 class="frc__changes-title">最近变更（审计）</h3>
        <ul class="frc__changes-list">
          <li v-for="(c, i) in changes" :key="i" class="mono">{{ c.changeType }} · {{ c.targetTable }} · {{ c.targetId }}</li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { adminFieldRoutingsApi, adminPromptOpsApi } from '@/api/adminApi';

interface StageItem { id: string; displayName: string }
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
interface SandboxChannel {
  path: string;
  key: string;
  fieldId: string;
  type: string;
  source: 'routing-channel' | 'routing-output';
  pathInRawOutput?: string | null;
  description?: string;
}
interface SandboxAgent {
  agentId: string;
  agentName: string;
  inputChannels: SandboxChannel[];
  outputFields: Array<{ fieldId: string; type: string; handoff: string[] }>;
}

const stageList = ref<StageItem[]>([]);
const stage = ref('');
const fields = ref<FieldItem[]>([]);
const agents = ref<AgentItem[]>([]);
const routings = ref<RoutingItem[]>([]);
const changes = ref<Array<Record<string, unknown>>>([]);
const loading = ref(false);
const error = ref('');
const sandboxAgents = ref<SandboxAgent[]>([]);
const sandboxError = ref('');

const fieldMap = () => new Map(fields.value.map((f) => [f.fieldId, f]));

function typeOf(fieldId: string) { return fieldMap().get(fieldId)?.valueType || '—'; }
function roleOf(fieldId: string) { return fieldMap().get(fieldId)?.promptRole || '—'; }
function routingsOf(agentId: string) { return routings.value.filter((r) => r.agentId === agentId); }
function formatHandoff(raw: string | null) {
  if (!raw) return '—';
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

async function loadStages() {
  const res = await adminFieldRoutingsApi.getStages();
  stageList.value = (res.data?.data?.stages || []).filter((s: StageItem) => ['goal', 'path', 'teaching', 'profile', 'simulation'].includes(s.id));
  if (stageList.value.length) await switchStage(stageList.value[0].id);
}

async function switchStage(id: string) {
  stage.value = id;
  loading.value = true;
  error.value = '';
  try {
    const res = await adminFieldRoutingsApi.getStageDetail(id);
    fields.value = res.data?.data?.fields || [];
    agents.value = res.data?.data?.agents || [];
    routings.value = res.data?.data?.routings || [];
  } catch (e: any) {
    error.value = e?.message || '加载失败';
  } finally {
    loading.value = false;
  }
  try {
    const c = await adminFieldRoutingsApi.getChanges({ stage: id, limit: 10 });
    changes.value = c.data?.data?.changes || [];
  } catch {
    changes.value = [];
  }
}

async function patch(agentId: string, row: RoutingItem, data: Record<string, unknown>) {
  try {
    await adminFieldRoutingsApi.updateRouting(agentId, row.fieldId, data);
    await switchStage(stage.value);
  } catch (e: any) {
    error.value = e?.message || '保存失败';
  }
}

async function onRender(agentId: string, row: RoutingItem, render: string) {
  await patch(agentId, row, { render: render as 'visible' | 'hidden' });
}

async function toggleInternal(agentId: string, row: RoutingItem) {
  await patch(agentId, row, { internal: !row.internal });
}

async function toggleAccumulate(agentId: string, row: RoutingItem) {
  await patch(agentId, row, { accumulate: !row.accumulate });
}

async function loadSandboxView() {
  sandboxError.value = '';
  try {
    const res = await adminPromptOpsApi.getSandboxView();
    sandboxAgents.value = res.data?.data?.agents || [];
  } catch (e: any) {
    sandboxError.value = e?.message || '沙盘契约加载失败';
    sandboxAgents.value = [];
  }
}

onMounted(() => {
  void loadStages();
  void loadSandboxView();
});
</script>

<style scoped>
.frc { padding: 20px; font-size: 13px; }
.frc__title { margin: 0 0 4px; font-size: 18px; }
.frc__sub { margin: 0 0 14px; color: var(--mk-muted, #888); }
.frc__tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.frc__tab { padding: 6px 14px; border: 1px solid var(--mk-border, #ddd); border-radius: 6px; background: #fff; cursor: pointer; }
.frc__tab.is-active { background: var(--mk-primary, #4f46e5); color: #fff; border-color: transparent; }
.frc__sandbox { margin-bottom: 16px; border: 1px solid var(--mk-border, #ddd); border-radius: 8px; padding: 0 14px; }
.frc__sandbox-summary { padding: 10px 0; cursor: pointer; font-weight: 600; color: var(--mk-primary, #4f46e5); }
.frc__sandbox-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding-bottom: 12px; }
.frc__sandbox-label { margin: 6px 0 6px; font-size: 12px; color: #888; }
.frc__sandbox-list { margin: 0; padding-left: 18px; max-height: 260px; overflow-y: auto; }
.frc__sandbox-list li { margin-bottom: 3px; }
.frc__sandbox-type { color: #888; }
.frc__sandbox-src { color: #aaa; font-size: 12px; }
.frc__sandbox-handoff { color: var(--mk-primary, #4f46e5); font-size: 12px; }
.frc__agent { margin-bottom: 18px; border: 1px solid var(--mk-border, #ddd); border-radius: 8px; overflow: hidden; }
.frc__agenthead { padding: 10px 14px; background: #f7f7f9; display: flex; align-items: baseline; gap: 10px; }
.frc__agentname { font-weight: 600; }
.frc__agentdesc { color: #888; }
.frc__table { width: 100%; border-collapse: collapse; }
.frc__table th, .frc__table td { padding: 6px 10px; border-bottom: 1px solid #eee; text-align: left; }
.frc__table th { background: #fafafa; font-weight: 500; }
.frc__field { max-width: 300px; word-break: break-all; }
.frc__handoff { max-width: 220px; }
.frc__lock { padding: 2px 6px; border-radius: 4px; font-size: 12px; }
.frc__lock--system-locked { background: #fee2e2; color: #b91c1c; }
.frc__lock--structure-locked { background: #fef3c7; color: #92400e; }
.frc__lock--editable { background: #dcfce7; color: #15803d; }
.frc__empty { padding: 30px; color: #888; text-align: center; }
.frc__emptyrow { color: #aaa; text-align: center; padding: 10px; }
.frc__changes { margin-top: 12px; }
.frc__changes-title { font-size: 14px; margin: 0 0 6px; }
.frc__changes-list { margin: 0; padding-left: 18px; color: #666; }
</style>
