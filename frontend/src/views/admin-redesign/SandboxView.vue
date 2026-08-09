<template>
  <div class="sbx">
    <div v-if="sandboxError" class="sbx__empty">{{ sandboxError }}</div>
    <template v-else-if="sandboxAgents.length">
      <div v-for="agent in sandboxAgents" :key="agent.agentId" class="sbx__agent">
        <div class="sbx__agenthead">
          <span class="sbx__agentname mono">{{ agent.agentId }}</span>
          <span class="sbx__agentdesc">{{ agent.agentName }}</span>
        </div>
        <div class="sbx__grid">
          <div>
            <h4 class="sbx__label">输入通道（编排注入）</h4>
            <ul v-if="agent.inputChannels.length" class="sbx__list mono">
              <li v-for="c in agent.inputChannels" :key="c.path">
                {{ c.path }}<span v-if="c.type" class="sbx__type">（{{ c.type }}）</span>
                <span class="sbx__src">[{{ c.source }}]</span>
              </li>
            </ul>
            <p v-else class="sbx__empty">无登记输入通道</p>
          </div>
          <div>
            <h4 class="sbx__label">输出 / 交付字段</h4>
            <ul v-if="agent.outputFields.length" class="sbx__list mono">
              <li v-for="f in agent.outputFields" :key="f.fieldId">
                {{ f.fieldId }}<span v-if="f.type" class="sbx__type">（{{ f.type }}）</span>
                <span v-if="f.handoff?.length" class="sbx__handoff">移交→{{ f.handoff.join('/') }}</span>
              </li>
            </ul>
            <p v-else class="sbx__empty">无输出字段</p>
          </div>
        </div>
      </div>
    </template>
    <p v-else class="sbx__empty">加载中…</p>
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

onMounted(() => void loadSandboxView());
</script>

<style scoped>
.sbx__agent { margin-bottom: 16px; border: 1px solid var(--mk-border, #ddd); border-radius: 8px; overflow: hidden; }
.sbx__agenthead { padding: 10px 14px; background: #f7f7f9; display: flex; align-items: baseline; gap: 10px; }
.sbx__agentname { font-weight: 600; }
.sbx__agentdesc { color: #888; }
.sbx__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 0 14px 12px; }
.sbx__label { margin: 8px 0 6px; font-size: 12px; color: #888; }
.sbx__list { margin: 0; padding-left: 18px; max-height: 260px; overflow-y: auto; }
.sbx__list li { margin-bottom: 3px; }
.sbx__type { color: #888; }
.sbx__src { color: #aaa; font-size: 12px; }
.sbx__handoff { color: var(--mk-primary, #4f46e5); font-size: 12px; }
.sbx__empty { padding: 20px; color: #888; text-align: center; }
</style>
