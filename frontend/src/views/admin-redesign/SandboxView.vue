<template>
  <div class="sbx">
    <div v-if="sandboxError" class="sbx__empty sbx__empty--error">{{ sandboxError }}</div>
    <template v-else-if="sandboxAgents.length">
      <div v-for="agent in sandboxAgents" :key="agent.agentId" class="sbx__agent">
        <div class="sbx__agenthead">
          <span class="sbx__agentname mono">{{ agent.agentId }}</span>
          <span class="sbx__agentdesc">{{ agent.agentName }}</span>
          <span class="sbx__agentcount">{{ agent.inputChannels.length }} 入 · {{ agent.outputFields.length }} 出</span>
        </div>
        <div class="sbx__grid">
          <div class="sbx__col">
            <h4 class="sbx__label">输入通道（编排注入）</h4>
            <ul v-if="agent.inputChannels.length" class="sbx__list mono">
              <li v-for="c in agent.inputChannels" :key="c.path" class="sbx__li">
                <span class="sbx__path">{{ c.path }}</span>
                <span v-if="c.type" class="sbx__type">（{{ c.type }}）</span>
                <span class="sbx__src" :class="`sbx__src--${c.source}`" :title="c.source">{{ sourceLabel(c.source) }}</span>
              </li>
            </ul>
            <p v-else class="sbx__empty">无登记输入通道</p>
          </div>
          <div class="sbx__col">
            <h4 class="sbx__label">输出 / 交付字段</h4>
            <ul v-if="agent.outputFields.length" class="sbx__list mono">
              <li v-for="f in agent.outputFields" :key="f.fieldId" class="sbx__li">
                <span class="sbx__path">{{ f.fieldId }}</span>
                <span v-if="f.type" class="sbx__type">（{{ f.type }}）</span>
                <span v-if="f.handoff?.length" class="sbx__handoff">移交 → {{ f.handoff.join(' / ') }}</span>
              </li>
            </ul>
            <p v-else class="sbx__empty">无输出字段</p>
          </div>
        </div>
      </div>
    </template>
    <p v-else-if="!sandboxLoaded" class="sbx__empty">加载中…</p>
    <p v-else class="sbx__empty">暂无登记 Agent（沙盘为空）</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { adminPromptOpsApi } from '@/api/adminApi';

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

const sandboxAgents = ref<SandboxAgent[]>([]);
const sandboxError = ref('');
/** 是否已完成首次加载（区分「加载中」与「合法空沙盘」） */
const sandboxLoaded = ref(false);

/** 来源枚举中文映射（routing-channel=路由通道、routing-output=路由输出） */
function sourceLabel(s: SandboxChannel['source']) {
  return s === 'routing-channel' ? '路由通道' : s === 'routing-output' ? '路由输出' : s;
}

async function loadSandboxView() {
  sandboxError.value = '';
  sandboxLoaded.value = false;
  try {
    const res = await adminPromptOpsApi.getSandboxView();
    sandboxAgents.value = res.data?.data?.agents || [];
  } catch (e: any) {
    sandboxError.value = e?.message || '沙盘契约加载失败';
    sandboxAgents.value = [];
  } finally {
    sandboxLoaded.value = true;
  }
}

onMounted(() => void loadSandboxView());
</script>

<style scoped>
.sbx__agent { margin-bottom: 16px; border: 1px solid var(--mk-line, #e6ebf4); border-radius: 12px; overflow: hidden; background: var(--mk-surface, #fff); box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06)); }
.sbx__agenthead { padding: 10px 14px; background: #fafbfd; border-bottom: 1px solid var(--mk-line, #e6ebf4); display: flex; align-items: baseline; gap: 10px; }
.sbx__agentname { font-weight: 700; color: var(--mk-ink, #1a2a44); }
.sbx__agentdesc { color: var(--mk-faint, #71809a); font-size: 12px; }
.sbx__agentcount { margin-left: auto; padding: 1px 9px; border-radius: 999px; background: #eef2fa; color: var(--mk-muted, #5b6577); font-size: 11px; font-weight: 700; white-space: nowrap; }
.sbx__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 12px 14px 14px; }
@media (max-width: 860px) {
  .sbx__grid { grid-template-columns: 1fr; }
}
.sbx__col { min-width: 0; }
.sbx__label { margin: 2px 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--mk-faint, #71809a); text-transform: uppercase; }
.sbx__list { margin: 0; padding: 8px 12px; list-style: none; max-height: 300px; overflow-y: auto; background: #fafbfd; border: 1px solid var(--mk-line, #e6ebf4); border-radius: 10px; }
.sbx__li { display: flex; align-items: baseline; gap: 6px; padding: 3px 0; border-bottom: 1px dashed #edf0f6; font-size: 12px; }
.sbx__li:last-child { border-bottom: none; }
.sbx__path { color: var(--mk-ink, #1a2a44); word-break: break-all; min-width: 0; }
.sbx__type { color: var(--mk-faint, #71809a); flex-shrink: 0; }
.sbx__src { margin-left: auto; flex-shrink: 0; padding: 0 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
.sbx__src--routing-output { background: #e5f0ff; color: #2563eb; }
.sbx__src--routing-channel { background: #e8f7ef; color: #15803d; }
.sbx__handoff { min-width: 0; padding: 0 8px; border-radius: 999px; background: #eef5ff; color: var(--mk-blue, #3478f6); font-size: 10.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sbx__empty { padding: 20px; color: var(--mk-faint, #71809a); text-align: center; }
.sbx__empty--error { color: var(--mk-red, #dc2626); font-weight: 600; }
</style>
