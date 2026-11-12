<template>
  <!-- 用人设模拟试跑（2026-11-10 从「虚拟学习者」行菜单迁入）：
       被测对象是**本页 Skill 的生效提示词**，虚拟学习者只是那个会追问、会跑题的学生。
       此前挂在虚拟学习者列表的行菜单里，读起来像「试跑这个人」，位置与主语都不对。 -->
  <div class="spt">
    <div class="spt__form">
      <label class="mk-field">
        <span class="mk-field__label">虚拟学习者</span>
        <MkSelect v-model="personaId" :options="personaOptions" aria-label="虚拟学习者" block />
      </label>
      <label v-if="isGoal" class="mk-field spt__field--num">
        <span class="mk-field__label">对话轮数</span>
        <input v-model.number="rounds" type="number" min="1" max="5" class="mk-field__input mono" />
      </label>
      <label v-if="isGoal" class="mk-field">
        <span class="mk-field__label">学习者对抗度</span>
        <MkSelect v-model="friction" :options="FRICTION_OPTIONS" aria-label="学习者对抗度" block />
      </label>
      <button type="button" class="mk-btn mk-btn--primary mk-btn--sm spt__run" :disabled="!personaId || running" @click="run">
        {{ running ? '试跑中（约 30s-2min）…' : result ? '再试跑一次' : '开始试跑' }}
      </button>
    </div>

    <p v-if="!personaOptions.length" class="spt__note">
      还没有虚拟学习者。先到「虚拟学习者」页创建一位，或从学习者卡库派生一个。
    </p>
    <p v-else class="spt__note">
      使用本页提示词{{ promptVersionText ? `的生效版本 ${promptVersionText}` : '的当前生效内容' }}，
      模拟这位学习者把人设与故事当诉求发起对话{{ isGoal ? '，按设定轮数与对抗度多轮往返' : '' }}。
    </p>

    <!-- 用例被跳过（人设已被删除 / 模拟输入解析失败）：没有结果 ≠ 未通过 -->
    <p v-if="!result && skipReason" class="spt__skip">本次未执行：{{ skipReason }}</p>

    <div v-if="result" class="spt__result">
      <div class="spt__verdict">
        <span class="mk-badge" :class="result.passed ? 'mk-badge--ok' : 'mk-badge--bad'">{{ result.passed ? '通过' : '未通过' }}</span>
        <span v-if="result.checks" class="spt__meta mono">{{ Object.values(result.checks).filter(Boolean).length }}/{{ Object.keys(result.checks).length }} 项检查通过</span>
        <span v-if="result.transcript?.length" class="spt__meta">对话 {{ result.transcript.length }} 轮{{ result.converged === true ? ' · 已完成产出' : '' }}</span>
        <button type="button" class="mk-link spt__clear" title="保留人设与参数，仅清除本次结果" @click="clear">清除结果</button>
      </div>

      <div v-if="result.simMeta || result.output?.fields" class="spt__io">
        <div v-if="result.simMeta" class="spt__io-col">
          <div class="spt__io-title">输入</div>
          <div v-if="result.simMeta.demandText" class="spt__io-row"><span class="spt__io-k">学生诉求</span>{{ result.simMeta.demandText }}</div>
          <div v-if="personaBriefText" class="spt__io-row"><span class="spt__io-k">学生人设</span>{{ personaBriefText }}</div>
          <div class="spt__io-row"><span class="spt__io-k">模拟参数</span>{{ isGoal ? `轮数 ${result.simMeta.dialogueRounds} · 对抗 ${frictionLabelText}` : '单次调用' }}</div>
        </div>
        <div v-if="result.output?.fields" class="spt__io-col">
          <div class="spt__io-title">输出字段{{ (result.transcript?.length ?? 0) > 1 ? '（最终轮）' : '' }}</div>
          <div class="spt__fields">
            <span v-for="(fv, fk) in result.output.fields" :key="fk" class="spt__field"><b>{{ fk }}</b>={{ shortField(fv) }}</span>
          </div>
        </div>
      </div>

      <div v-if="result.checks" class="spt__checks">
        <span v-for="(v, k) in result.checks" :key="k" class="spt__check" :class="v ? 'spt__check--ok' : 'spt__check--bad'">{{ v ? '✓' : '✗' }} {{ checkLabel(String(k)) }}</span>
      </div>

      <div v-if="result.transcript?.length" class="spt__transcript">
        <div v-for="(t, i) in result.transcript" :key="i" class="spt__row">
          <span class="spt__role" :class="t.role === 'goal_agent' ? 'spt__role--agent' : 'spt__role--learner'">{{ t.role === 'goal_agent' ? '助手' : '学生' }} · 第{{ t.round }}轮</span>
          <div class="spt__bubble">
            <div class="spt__content">{{ t.content }}</div>
            <div v-if="t.fields" class="spt__fields">
              <span v-for="(fv, fk) in t.fields" :key="fk" class="spt__field"><b>{{ fk }}</b>={{ shortField(fv) }}</span>
            </div>
            <div v-if="t.error" class="spt__state">{{ t.error }}</div>
            <div v-if="t.learnerState" class="spt__state">
              被理解 {{ Math.round((t.learnerState.feltUnderstood ?? 0) * 100) }}% · 目标清晰 {{ Math.round((t.learnerState.problemClarity ?? 0) * 100) }}% · 可继续={{ t.learnerState.readyToProceed === true ? '是' : '否' }}{{ t.emotion ? ` · ${t.emotion}` : '' }}
            </div>
          </div>
        </div>
      </div>
      <pre v-else-if="result.output?.userVisible" class="spt__out">{{ result.output.userVisible }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { adminPromptOpsApi, adminSkillsApi } from '@/api/adminApi'
import { errMsg, liveVirtuals, refreshLiveVirtuals } from '../live'
import { toast } from '@/utils/toast'
import { FRICTION_OPTIONS, frictionLabel, type FrictionBudget } from '../vlab'
import MkSelect from '@/components/mk/MkSelect.vue'

/** 只有这两个 Skill 的评测适配器支持「模拟人设输入」（后端 runSkillEvalCase 分发） */
const PERSONA_SKILLS = ['goal-conversation', 'path-planning'] as const

const props = defineProps<{ skillId: string }>()

interface Turn {
  role: string
  round: number
  content: string
  fields?: Record<string, unknown>
  error?: string
  learnerState?: { feltUnderstood?: number; problemClarity?: number; readyToProceed?: boolean }
  emotion?: string
}
interface EvalResult {
  passed?: boolean
  checks?: Record<string, boolean>
  transcript?: Turn[]
  converged?: boolean
  simMeta?: {
    persona?: { nameHint?: string; age?: number | string; occupation?: string; background?: string }
    demandText?: string
    dialogueRounds?: number
    frictionBudget?: string
  }
  output?: { fields?: Record<string, unknown>; userVisible?: string }
}

const isGoal = computed(() => props.skillId === 'goal-conversation')
const personaId = ref('')
const rounds = ref(2)
const friction = ref<FrictionBudget>('normal')
const running = ref(false)
const result = ref<EvalResult | null>(null)
const skipReason = ref('')
const promptVersion = ref('')

const personaOptions = computed(() =>
  liveVirtuals.value
    .map((v) => ({ value: v.id, label: v.name || v.id }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
)
const promptVersionText = computed(() => (promptVersion.value ? `v${promptVersion.value}` : ''))
const personaBriefText = computed(() => {
  const p = result.value?.simMeta?.persona
  if (!p) return ''
  const parts: string[] = []
  if (p.nameHint) parts.push(String(p.nameHint))
  if (p.age) parts.push(`${p.age}岁`)
  if (p.occupation) parts.push(String(p.occupation))
  if (p.background) parts.push(String(p.background).slice(0, 60))
  return parts.join(' · ')
})
const frictionLabelText = computed(() => frictionLabel(result.value?.simMeta?.frictionBudget))

/** 只有这两个 Skill 才有这一档入口（其余 Skill 塞人设也跑不通适配器） */
const supportsPersona = computed(() => (PERSONA_SKILLS as readonly string[]).includes(props.skillId))

/* immediate：名单通常在本组件挂载前就已由壳层载入，等到下一次变化才选默认值
   会让「开始试跑」一直是灰的（首屏就是空 personaId）。 */
watch(personaOptions, (opts) => {
  if (!opts.length) return
  if (!opts.some((o) => o.value === personaId.value)) personaId.value = opts[0].value
}, { immediate: true })

async function loadPromptVersion() {
  const id = props.skillId
  promptVersion.value = ''
  try {
    const res = await adminSkillsApi.getEffectiveSkillPrompt(id)
    if (id !== props.skillId) return
    const body = (res.data?.data ?? res.data ?? {}) as { prompt?: { version?: number | string } }
    promptVersion.value = body.prompt?.version == null ? '' : String(body.prompt.version)
  } catch {
    // 版本只是说明文字：读不到就不写版本，不影响试跑本身
  }
}

onMounted(() => {
  if (!supportsPersona.value) return
  if (!liveVirtuals.value.length) void refreshLiveVirtuals()
  void loadPromptVersion()
})
watch(() => props.skillId, () => {
  result.value = null
  skipReason.value = ''
  void loadPromptVersion()
})

function shortField(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/** 把校验 key 翻译成人话 */
function checkLabel(rawKey: string): string {
  const [kind, ...rest] = rawKey.split(':')
  const val = rest.join(':')
  if (kind === 'mustContain') return `必须出现「${val}」`
  if (kind === 'mustNotInclude') return `不能出现「${val}」`
  if (kind === 'mustInclude') return `含字段 ${val}`
  if (kind === 'converge') return `完成产出 ${val}`
  const map: Record<string, string> = {
    parsed: '输出可解析',
    contractValid: '结构符合约定',
    structuredOutputValid: '输出结构合法',
    stageValid: '阶段识别正确',
    expectedStage: '阶段符合预期',
    milestoneCount: '里程碑数',
    milestoneCountMatchesExpected: '里程碑数符合预期',
    namePresent: '含名称',
    milestonesPresent: '含里程碑',
    cognitiveCorePresent: '含核心理念',
    subtaskCount: '子任务数',
    subtaskCountMatchesExpected: '子任务数符合预期',
    subtasksPresent: '含子任务'
  }
  const roundMatch = rawKey.match(/^round(\d+):(.+)$/)
  if (roundMatch) return `第${roundMatch[1]}轮 ${map[roundMatch[2]] || roundMatch[2]}`
  if (rawKey.startsWith('allTurns:')) return `全程${map[rawKey.slice(9)] || rawKey.slice(9)}`
  return map[rawKey] || rawKey
}

function clear() {
  result.value = null
  skipReason.value = ''
}

async function run() {
  if (running.value || !personaId.value) return
  const persona = personaOptions.value.find((o) => o.value === personaId.value)
  const name = persona?.label || personaId.value
  running.value = true
  result.value = null
  skipReason.value = ''
  const busy = toast.info(`正在试跑「${name}」…`, 0)
  const caseId = `pt-${personaId.value.slice(0, 8)}`
  try {
    const res = await adminPromptOpsApi.runEval({
      agentId: `skill:${props.skillId}`,
      adhocCases: [{
        id: caseId,
        name,
        messages: [],
        expectations: {
          mode: 'simulated',
          personaId: personaId.value,
          dialogueRounds: isGoal.value ? Math.max(1, Math.min(5, rounds.value || 1)) : 1,
          frictionBudget: friction.value
        }
      }],
      repeatCount: 1
    })
    const data = res.data?.data ?? res.data
    const results = Array.isArray(data?.results) ? data.results : []
    result.value = results.find((r: { caseId?: string }) => r?.caseId === caseId) ?? results[0] ?? null
    const skip = Array.isArray(data?.skipped)
      ? data.skipped.find((x: { caseId?: string }) => x?.caseId === caseId)
      : undefined
    skipReason.value = result.value ? '' : String(skip?.reason || '后端未返回本次用例结果')
    toast.close(busy)
    if (result.value?.passed) toast.success(`「${name}」通过`)
    else if (!result.value) toast.warning(`「${name}」未执行：${skipReason.value}`)
    else toast.warning(`「${name}」未通过，看字段检查明细`)
  } catch (e) {
    toast.close(busy)
    toast.error(`试跑失败：${errMsg(e)}`)
  } finally {
    running.value = false
  }
}

</script>

<style scoped>
.spt { display: grid; gap: 12px; padding: 14px 16px; }
.spt__form { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
.spt__form .mk-field { margin: 0; flex: 1 1 200px; min-width: 170px; max-width: 300px; }
.spt__form .spt__field--num { flex: 0 0 110px; min-width: 0; }
.spt__run { margin-left: auto; }
.spt__note { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }
/* 跳过提示：与「未通过」区分——中性告警底色，不出现通过/未通过徽标 */
.spt__skip { margin: 0; padding: 8px 12px; border-radius: var(--mk-radius-xl); border: 1px solid var(--mk-line); background: var(--mk-surface); font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.spt__result { display: grid; gap: 10px; }
.spt__verdict { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.spt__meta { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.spt__clear { margin-left: auto; }
.spt__io { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl); padding: 10px 12px; background: var(--mk-surface); }
.spt__io-col { display: grid; gap: 6px; align-content: start; }
.spt__io-title { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); }
.spt__io-row { font-size: var(--mk-fs-micro); color: var(--mk-ink); line-height: 1.5; word-break: break-word; }
.spt__io-k { display: inline-block; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); margin-right: 6px; }
.spt__fields { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
.spt__field {
  font-size: var(--mk-fs-micro);
  padding: 1px 7px;
  border-radius: var(--mk-radius-sm);
  font-family: var(--mk-mono);
  background: color-mix(in srgb, var(--mk-purple) 10%, transparent);
  color: var(--mk-purple);
  border: 1px solid color-mix(in srgb, var(--mk-purple) 24%, transparent);
  word-break: break-all;
}
.spt__field b { font-weight: 700; }
.spt__checks { display: flex; gap: 6px; flex-wrap: wrap; }
.spt__check { font-size: var(--mk-fs-micro); padding: 1px 8px; border-radius: var(--mk-radius-pill); font-weight: 600; }
.spt__check--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.spt__check--bad { background: var(--mk-red-bg); color: var(--mk-red); }
.spt__transcript { display: grid; gap: 8px; border-top: 1px dashed var(--mk-line); padding-top: 10px; }
.spt__row { display: grid; grid-template-columns: 92px 1fr; gap: 8px; align-items: start; }
.spt__role { font-size: var(--mk-fs-micro); font-weight: 700; padding-top: 3px; }
.spt__role--agent { color: var(--mk-purple); }
.spt__role--learner { color: var(--mk-green); }
.spt__bubble { display: grid; gap: 4px; }
.spt__content { font-size: var(--mk-fs-micro); color: var(--mk-ink); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.spt__state { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.spt__out {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  max-height: 120px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  border-top: 1px dashed var(--mk-line);
  padding-top: 8px;
}
</style>
