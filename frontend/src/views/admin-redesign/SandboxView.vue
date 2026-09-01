<template>
  <div class="sbx">
    <div v-if="sandboxError" class="sbx__empty sbx__empty--error">{{ sandboxError }}<button type="button" class="mk-empty__action" @click="loadSandboxView">重试</button></div>
    <template v-else-if="sandboxAgents.length">
      <div class="sbx__bar">
        <span class="sbx__bar-meta">共 {{ sandboxAgents.length }} 个 Agent</span>
        <button type="button" class="sbx__bar-btn" @click="sandboxAllOpen = !sandboxAllOpen">
          {{ sandboxAllOpen ? '全部收起' : '全部展开' }}
        </button>
      </div>
      <!-- 滚动修复 #7：按 stage 分组 + 每卡 details 折叠（默认收起输入/输出明细） -->
      <div v-for="g in sandboxGroups" :key="g.stage" class="sbx__group">
        <div class="sbx__grouphead">
          <strong class="sbx__groupname">{{ g.label }}</strong>
          <span class="sbx__groupcount">{{ g.agents.length }} 个 Agent</span>
        </div>
        <details v-for="agent in g.agents" :key="agent.agentId" class="sbx__agent" :open="sandboxAllOpen">
          <summary class="sbx__agenthead">
            <span class="sbx__agentname mono">{{ agent.agentId }}</span>
            <span class="sbx__agentdesc">{{ agent.agentName }}</span>
            <span class="sbx__agentcount">{{ agent.inputChannels.length }} 入 · {{ agent.outputFields.length }} 出</span>
          </summary>
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
        </details>
      </div>
    </template>
    <p v-else-if="!sandboxLoaded" class="sbx__empty">加载中…</p>
    <p v-else class="sbx__empty">暂无登记 Agent（沙盘为空）</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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
/** 滚动修复 #7：全部展开/收起开关（details :open 绑定） */
const sandboxAllOpen = ref(false);

/** 来源枚举中文映射（routing-channel=路由通道、routing-output=路由输出） */
function sourceLabel(s: SandboxChannel['source']) {
  return s === 'routing-channel' ? '路由通道' : s === 'routing-output' ? '路由输出' : s;
}

/** stage 分组（滚动修复 #7）：agentId 形如 <stage>-agent 归该 stage；skill:* 归工具类；其余归其他 */
const STAGE_ORDER = ['goal', 'path', 'teaching', 'profile', 'simulation'] as const
const STAGE_LABELS: Record<string, string> = {
  goal: '澄清', path: '规划', teaching: '教学', profile: '画像', simulation: '仿真',
}
function stageOf(agentId: string) {
  const m = /^([a-z0-9-]+)-agent$/.exec(agentId)
  if (m && STAGE_ORDER.includes(m[1] as (typeof STAGE_ORDER)[number])) return m[1]
  if (agentId.startsWith('skill:')) return 'skill'
  return 'other'
}
function stageLabel(stage: string) {
  return STAGE_LABELS[stage] || (stage === 'skill' ? '工具类' : '其他')
}
const sandboxGroups = computed(() => {
  const map = new Map<string, SandboxAgent[]>()
  for (const a of sandboxAgents.value) {
    const key = stageOf(a.agentId)
    const list = map.get(key) || []
    list.push(a)
    map.set(key, list)
  }
  const rank = (s: string) => {
    const i = STAGE_ORDER.indexOf(s as (typeof STAGE_ORDER)[number])
    return i === -1 ? STAGE_ORDER.length : i
  }
  const keys = [...map.keys()].sort((a, b) => {
    const d = rank(a) - rank(b)
    return d !== 0 ? d : a.localeCompare(b)
  })
  return keys.map((stage) => ({ stage, label: stageLabel(stage), agents: map.get(stage)! }))
})

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
.sbx__bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.sbx__bar-meta { font-size: 12px; color: var(--mk-faint, #71809a); }
.sbx__bar-btn {
  margin-left: auto;
  padding: 4px 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 999px;
  background: var(--mk-surface);
  color: var(--mk-blue, #2c63d0);
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
}
.sbx__bar-btn:hover { border-color: rgba(44, 99, 208, 0.4); }
.sbx__group { margin-bottom: 14px; }
.sbx__grouphead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 4px 2px 8px;
}
.sbx__groupname { font-size: 13px; color: var(--mk-ink, #1a2a44); }
.sbx__groupcount { font-size: 11.5px; color: var(--mk-faint, #71809a); }
.sbx__agent { margin-bottom: 10px; border: 1px solid var(--mk-line, #e6ebf4); border-radius: 12px; overflow: hidden; background: var(--mk-surface, #fff); box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06)); }
.sbx__agenthead { padding: 10px 14px; background: #fafbfd; border-bottom: 1px solid var(--mk-line, #e6ebf4); display: flex; align-items: baseline; gap: 10px; cursor: pointer; user-select: none; list-style: none; }
.sbx__agenthead::-webkit-details-marker { display: none; }
.sbx__agenthead::before {
  content: '▸';
  display: inline-block;
  margin-right: 2px;
  color: var(--mk-blue, #2c63d0);
  transition: transform 0.14s ease;
}
.sbx__agent[open] > .sbx__agenthead::before { transform: rotate(90deg); }
.sbx__agentname { font-weight: 700; color: var(--mk-ink, #1a2a44); }
.sbx__agentdesc { color: var(--mk-faint, #71809a); font-size: 12px; }
.sbx__agentcount { margin-left: auto; padding: 1px 9px; border-radius: 999px; background: var(--mk-line); color: var(--mk-muted, #5b6577); font-size: 11px; font-weight: 700; white-space: nowrap; }
.sbx__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 12px 14px 14px; }
@media (max-width: 860px) {
  .sbx__grid { grid-template-columns: 1fr; }
}
.sbx__col { min-width: 0; }
.sbx__label { margin: 2px 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--mk-faint, #71809a); text-transform: uppercase; }
.sbx__list { margin: 0; padding: 8px 12px; list-style: none; max-height: 300px; overflow-y: auto; background: var(--mk-surface); border: 1px solid var(--mk-line, #e6ebf4); border-radius: 10px; }
.sbx__li { display: flex; align-items: baseline; gap: 6px; padding: 3px 0; border-bottom: 1px dashed #edf0f6; font-size: 12px; }
.sbx__li:last-child { border-bottom: none; }
.sbx__path { color: var(--mk-ink, #1a2a44); word-break: break-all; min-width: 0; }
.sbx__type { color: var(--mk-faint, #71809a); flex-shrink: 0; }
.sbx__src { margin-left: auto; flex-shrink: 0; padding: 0 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
.sbx__src--routing-output { background: #e5f0ff; color: var(--mk-blue, #2c63d0); }
.sbx__src--routing-channel { background: #e8f7ef; color: #15803d; }
.sbx__handoff { min-width: 0; padding: 0 8px; border-radius: 999px; background: #eef5ff; color: var(--mk-blue, #2c63d0); font-size: 10.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sbx__empty { padding: 20px; color: var(--mk-faint, #71809a); text-align: center; }
.sbx__empty--error { color: var(--mk-red, #dc2626); font-weight: 600; }

@media (min-width: 2000px) {
  .sbx__agentdesc { font-size: 13.5px; }
  .sbx__agentcount { font-size: 12px; padding: 2px 11px; }
  .sbx__label { font-size: 12px; }
  .sbx__list { padding: 9px 14px; }
  .sbx__li { font-size: 13.5px; }
  .sbx__src { font-size: 12px; padding: 1px 10px; }
  .sbx__handoff { font-size: 12px; padding: 1px 10px; }
  .sbx__empty { padding: 24px; }
}

@media (min-width: 2800px) {
  .sbx__agentdesc { font-size: 16px; }
  .sbx__agentcount { font-size: 14px; padding: 3px 13px; }
  .sbx__label { font-size: 14px; }
  .sbx__list { padding: 11px 17px; }
  .sbx__li { font-size: 16px; }
  .sbx__src { font-size: 14px; padding: 2px 12px; }
  .sbx__handoff { font-size: 14px; padding: 2px 12px; }
  .sbx__empty { padding: 28px; }
}

/* 暗色模式（D1 补完）：沙盘契约（语义色块转暗色系） */
html[data-theme='dark'] {
  .sbx__agenthead { background: #141c2b; }
  .sbx__src--routing-output { background: rgba(91, 141, 239, 0.18); color: #9db8f5; }
  .sbx__src--routing-channel { background: rgba(74, 222, 128, 0.14); color: #6ee7a0; }
  .sbx__handoff { background: rgba(91, 141, 239, 0.16); color: #9db8f5; }
}
</style>
