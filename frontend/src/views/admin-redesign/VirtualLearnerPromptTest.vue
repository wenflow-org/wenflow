<template>
  <!-- 单步 Prompt 测试：用虚拟学习者的人设+故事直接跑一次对话，看字段产出 -->
  <Teleport v-if="render" to="body">
  <div v-if="testTarget" ref="testMaskRef" class="mk-modal" @click.self="closePromptTest">
    <div ref="testPanelRef" class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="单步 Prompt 测试">
      <div class="mk-modal__head">
        <h3 class="mk-modal__title">单步测试 · {{ testTarget.name }}</h3>
        <button type="button" class="mk-modal__close" aria-label="关闭" @click="closePromptTest">✕</button>
      </div>
      <div class="mk-modal__body">
        <p class="mk-alert mk-alert--info vl-steps">
          用「{{ testTarget.name }}」的人设和故事直接跑一次对话，检查助手字段产出。不创建用例、不影响正式会话。
        </p>
        <!-- 配置行 -->
        <div class="pt-config">
          <label class="mk-field">
            <span class="mk-field__label">助手能力</span>
            <select v-model="testForm.agentId" class="mk-field__select">
              <option value="skill:goal-conversation">goal-conversation · 聊目标</option>
              <option value="skill:path-planning">path-planning · 拆路径</option>
              <option value="skill:stage-designer">stage-designer · 拆子任务</option>
            </select>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">对话轮数</span>
            <input v-model.number="testForm.dialogueRounds" type="number" min="1" max="5" class="mk-field__input mono" />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">学生对抗度</span>
            <select v-model="testForm.friction" class="mk-field__select">
              <option value="none">none · 配合</option>
              <option value="low">low · 犹豫</option>
              <option value="normal">normal · 正常</option>
              <option value="high">high · 难缠</option>
              <option value="stress_test">stress · 极端</option>
            </select>
          </label>
        </div>

        <!-- 结果 -->
        <div v-if="testResult" class="pt-result">
          <div class="pt-verdict">
            <span class="mk-badge" :class="testResult.passed ? 'mk-badge--ok' : 'mk-badge--bad'">{{ testResult.passed ? '通过' : '未通过' }}</span>
            <span v-if="testResult.checks" class="pt-meta mono">{{ Object.values(testResult.checks).filter(Boolean).length }}/{{ Object.keys(testResult.checks).length }} 项检查通过</span>
            <span v-if="testResult.transcript?.length" class="pt-meta">对话 {{ testResult.transcript.length }} 轮{{ testResult.converged === true ? ' · 已收敛' : '' }}</span>
          </div>

          <!-- 输入 / 输出：评估的完整上下文 -->
          <div v-if="testResult.simMeta || testResult.output?.fields" class="pt-io">
            <div v-if="testResult.simMeta" class="pt-io__col">
              <div class="pt-io__title">📥 输入</div>
              <div v-if="testResult.simMeta.demandText" class="pt-io__row"><span class="pt-io__k">学生诉求</span>{{ testResult.simMeta.demandText }}</div>
              <div v-if="personaBriefText" class="pt-io__row"><span class="pt-io__k">学生人设</span>{{ personaBriefText }}</div>
              <div class="pt-io__row"><span class="pt-io__k">模拟参数</span>轮数 {{ testResult.simMeta.dialogueRounds }} · 对抗 {{ frictionLabelText }}</div>
            </div>
            <div v-if="testResult.output?.fields" class="pt-io__col">
              <div class="pt-io__title">📤 输出字段{{ (testResult.transcript?.length ?? 0) > 1 ? '（最终轮）' : '' }}</div>
              <div class="pt-fields">
                <span v-for="(fv, fk) in testResult.output.fields" :key="fk" class="pt-field"><b>{{ fk }}</b>={{ shortField(fv) }}</span>
              </div>
            </div>
          </div>

          <div v-if="testResult.checks" class="pt-checks">
            <span v-for="(v, k) in testResult.checks" :key="k" class="pt-check" :class="v ? 'pt-check--ok' : 'pt-check--bad'">{{ v ? '✓' : '✗' }} {{ testCheckLabel(String(k)) }}</span>
          </div>
          <div v-if="testResult.transcript?.length" class="pt-transcript">
            <div v-for="(t, i) in testResult.transcript" :key="i" class="pt-row">
              <span class="pt-role" :class="t.role === 'goal_agent' ? 'pt-role--agent' : 'pt-role--learner'">{{ t.role === 'goal_agent' ? '助手' : '学生' }} · 第{{ t.round }}轮</span>
              <div class="pt-bubble">
                <div class="pt-content">{{ t.content }}</div>
                <div v-if="t.fields" class="pt-fields">
                  <span v-for="(fv, fk) in t.fields" :key="fk" class="pt-field"><b>{{ fk }}</b>={{ shortField(fv) }}</span>
                </div>
                <div v-if="t.error" class="pt-state">⚠️ {{ t.error }}</div>
                <div v-if="t.learnerState" class="pt-state">
                  被理解 {{ Math.round((t.learnerState.feltUnderstood ?? 0) * 100) }}% · 目标清晰 {{ Math.round((t.learnerState.problemClarity ?? 0) * 100) }}% · readyToProceed={{ t.learnerState.readyToProceed === true ? '是' : '否' }}{{ t.emotion ? ` · ${t.emotion}` : '' }}
                </div>
              </div>
            </div>
          </div>
          <p v-else-if="testResult.output?.userVisible" class="pt-out">{{ testResult.output.userVisible }}</p>
        </div>
      </div>
      <div class="mk-modal__foot">
        <button type="button" class="mk-btn" @click="closePromptTest">关闭</button>
        <button type="button" class="mk-btn mk-btn--primary" :disabled="testRunning" @click="runPromptTest">
          {{ testRunning ? '测试中（约 30s-2min）…' : testResult ? '再测一次' : '开始测试' }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { adminPromptOpsApi } from '@/api/adminApi'
import { errMsg } from './live'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'

/* render=false 时不渲染 Teleport（保持与拆分前一致的 tab 条件渲染语义），弹窗状态仍常驻 */
withDefaults(defineProps<{ render?: boolean }>(), { render: true })

/** 测试目标（父页面行内「测试」按钮传入；只依赖 id/name） */
interface PromptTestTarget {
  id: string
  name: string
}

interface PromptTestTurn {
  role: string
  round: number
  content: string
  fields?: Record<string, unknown>
  error?: string
  learnerState?: {
    feltUnderstood?: number
    problemClarity?: number
    readyToProceed?: boolean
  }
  emotion?: string
}

interface PromptTestResult {
  passed?: boolean
  checks?: Record<string, boolean>
  transcript?: PromptTestTurn[]
  converged?: boolean
  simMeta?: {
    persona?: { nameHint?: string; age?: number | string; occupation?: string; background?: string }
    demandText?: string
    dialogueRounds?: number
    frictionBudget?: string
  }
  output?: {
    fields?: Record<string, unknown>
    userVisible?: string
  }
}

const testTarget = ref<PromptTestTarget | null>(null)
const testRunning = ref(false)
const testResult = ref<PromptTestResult | null>(null)
const testForm = ref({
  agentId: 'skill:goal-conversation',
  dialogueRounds: 2,
  friction: 'normal' as 'none' | 'low' | 'normal' | 'high' | 'stress_test',
})
const testPanelRef = ref<HTMLElement | null>(null)
const testMaskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!testTarget.value), testPanelRef)
useMaskClose(testMaskRef, () => { if (!testRunning.value) testTarget.value = null })
useEscape(() => !!testTarget.value, () => { if (!testRunning.value) testTarget.value = null })

/** 父页面触发：打开测试弹窗并重置状态 */
function open(s: PromptTestTarget) {
  testTarget.value = s
  testResult.value = null
  testForm.value = { agentId: 'skill:goal-conversation', dialogueRounds: 2, friction: 'normal' }
}
function closePromptTest() {
  if (testRunning.value) return
  testTarget.value = null
}

/** 人设摘要（输入区展示） */
const personaBriefText = computed(() => {
  const p = testResult.value?.simMeta?.persona
  if (!p) return ''
  const parts: string[] = []
  if (p.nameHint) parts.push(String(p.nameHint))
  if (p.age) parts.push(`${p.age}岁`)
  if (p.occupation) parts.push(String(p.occupation))
  if (p.background) parts.push(String(p.background).slice(0, 60))
  return parts.join(' · ')
})
const frictionLabelText = computed(() => {
  const m: Record<string, string> = { none: '全程配合', low: '轻微犹豫', normal: '正常', high: '难缠', stress_test: '极端对抗' }
  return m[String(testResult.value?.simMeta?.frictionBudget)] || '正常'
})
function shortField(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/** 把校验 key 翻译成人话 */
function testCheckLabel(rawKey: string): string {
  const [kind, ...rest] = rawKey.split(':')
  const val = rest.join(':')
  if (kind === 'mustContain') return `必须出现「${val}」`
  if (kind === 'mustNotInclude') return `不能出现「${val}」`
  if (kind === 'mustInclude') return `含字段 ${val}`
  if (kind === 'converge') return `收敛产出 ${val}`
  const map: Record<string, string> = {
    parsed: '输出可解析',
    contractValid: '结构契约合法',
    structuredOutputValid: '结构化输出合法',
    stageValid: '阶段识别正确',
    expectedStage: '阶段符合预期',
    milestoneCount: '里程碑数',
    milestoneCountMatchesExpected: '里程碑数符合预期',
    namePresent: '含名称',
    milestonesPresent: '含里程碑',
    cognitiveCorePresent: '含核心理念',
    subtaskCount: '子任务数',
    subtaskCountMatchesExpected: '子任务数符合预期',
    subtasksPresent: '含子任务',
  }
  // 多轮前缀：round1:xxx / allTurns:xxx
  const roundMatch = rawKey.match(/^round(\d+):(.+)$/)
  if (roundMatch) return `第${roundMatch[1]}轮 ${map[roundMatch[2]] || roundMatch[2]}`
  if (rawKey.startsWith('allTurns:')) return `全程${map[rawKey.slice(9)] || rawKey.slice(9)}`
  return map[rawKey] || rawKey
}

async function runPromptTest() {
  const s = testTarget.value
  if (!s || testRunning.value) return
  testRunning.value = true
  testResult.value = null
  const busy = toast.info(`正在测试「${s.name}」…`, 0)
  try {
    const res = await adminPromptOpsApi.runEval({
      agentId: testForm.value.agentId,
      adhocCases: [{
        id: `pt-${s.id.slice(0, 8)}`,
        name: s.name,
        messages: [],
        expectations: {
          mode: 'simulated',
          personaId: s.id,
          dialogueRounds: Math.max(1, Math.min(5, testForm.value.dialogueRounds || 1)),
          frictionBudget: testForm.value.friction,
        },
      }],
      repeatCount: 1,
    })
    const data = res.data?.data ?? res.data
    testResult.value = data?.results?.[0] || null
    toast.close(busy)
    if (testResult.value?.passed) toast.success(`「${s.name}」测试通过`)
    else toast.warning(`「${s.name}」测试未通过，看字段检查明细`)
  } catch (e) {
    toast.close(busy)
    toast.error(`测试失败：${errMsg(e)}`)
  } finally {
    testRunning.value = false
  }
}

defineExpose({ open })
</script>

<style scoped>
/* ===== 单步 Prompt 测试面板 ===== */
.pt-config { display: grid; grid-template-columns: 1fr 100px 170px; gap: 10px; align-items: end; margin-bottom: 14px; }
.pt-config .mk-field { margin-bottom: 0; }
.pt-result { display: grid; gap: 10px; }
.pt-verdict { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pt-meta { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
/* 输入/输出区 */
.pt-io { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border: 1px solid var(--mk-line, #e1e8f2); border-radius: 10px; padding: 10px 12px; background: var(--mk-surface); }
.pt-io__col { display: grid; gap: 6px; align-content: start; }
.pt-io__title { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); }
.pt-io__row { font-size: var(--mk-fs-micro); color: var(--mk-ink); line-height: 1.5; word-break: break-word; }
.pt-io__k { display: inline-block; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint, #94a3b8); margin-right: 6px; }
/* 字段明细 chips */
.pt-fields { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
.pt-field {
  font-size: var(--mk-fs-micro); padding: 1px 7px; border-radius: 6px; font-family: var(--mk-mono, monospace);
  background: rgba(99, 102, 241, 0.08); color: var(--mk-purple); border: 1px solid rgba(99, 102, 241, 0.2);
  word-break: break-all;
}
.pt-field b { font-weight: 700; }
.pt-checks { display: flex; gap: 6px; flex-wrap: wrap; }
.pt-check { font-size: var(--mk-fs-micro); padding: 1px 8px; border-radius: 99px; font-weight: 600; }
.pt-check--ok { background: var(--mk-green-bg, #ecfdf5); color: var(--mk-green, #16a34a); }
.pt-check--bad { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.pt-transcript { display: grid; gap: 8px; border-top: 1px dashed var(--mk-line, #e1e8f2); padding-top: 10px; }
.pt-row { display: grid; grid-template-columns: 92px 1fr; gap: 8px; align-items: start; }
.pt-role { font-size: var(--mk-fs-micro); font-weight: 700; padding-top: 3px; }
.pt-role--agent { color: var(--mk-purple); }
.pt-role--learner { color: var(--mk-green, #16a34a); }
.pt-bubble { display: grid; gap: 4px; }
.pt-content { font-size: var(--mk-fs-micro); color: var(--mk-ink); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.pt-state { font-size: var(--mk-fs-micro); color: var(--mk-faint, #94a3b8); }
.pt-out {
  margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted);
  max-height: 120px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
  border-top: 1px dashed var(--mk-line, #e1e8f2); padding-top: 8px;
}
html[data-theme='dark'] .pt-check--ok { background: rgba(74, 222, 128, 0.14); color: #6ee7a0; }
html[data-theme='dark'] .pt-check--bad { background: rgba(248, 113, 113, 0.14); color: #fca5a5; }
html[data-theme='dark'] .pt-content { color: var(--mk-ink, #e7e8e9); }
html[data-theme='dark'] .pt-io { border-color: #252627; }
html[data-theme='dark'] .pt-field { background: rgba(129, 140, 248, 0.14); color: #a5b4fc; border-color: rgba(129, 140, 248, 0.3); }

/* 弹窗内步骤/结果提示：mk-alert 形态，此处只留边距（本组件独立复制一份） */
.vl-steps {
  margin: 0 0 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f4f7fc;
  color: var(--mk-muted, #5b6577);
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
}
@media (min-width: 2000px) {
  .vl-steps { font-size: var(--mk-fs-micro); padding: 9px 12px; }
}
@media (min-width: 2800px) {
  .vl-steps { font-size: var(--mk-fs-micro); padding: 11px 14px; }
}
@media (min-width: 3600px) {
  .vl-steps { font-size: var(--mk-fs-body); padding: 13px 16px; }
}
</style>
