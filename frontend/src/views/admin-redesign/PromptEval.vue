<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Prompt 评估中心</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">用例 {{ cases.length }}</span>
      <span class="mk-status__meta">评估历史 {{ runs.length }}</span>
      <span class="mk-status__meta" :title="lastRunHint">{{ lastRunText }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="!canRunBatch" @click="runBatch">批量跑评估</button>
        <button type="button" class="mk-status__action" @click="tab = 'runs'">评估历史</button>
        <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建用例</button>
      </span>
    </div>

    <!-- 筛选行 -->
    <div class="mk-card">
      <div class="pe-filter">
        <select v-model="agentFilter" class="mk-filter__select" aria-label="按 Agent 筛选" @change="reloadCases">
          <option value="">全部 Agent</option>
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.label }}</option>
        </select>
        <span class="mk-pills">
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'cases' }" @click="switchTab('cases')">评估用例</button>
          <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'runs' }" @click="switchTab('runs')">评估历史</button>
        </span>
        <span v-if="tab === 'cases'" class="pe-filter__hint">用例驱动：为 goal-conversation 等 Agent 维护评估集，一键跑评估验证 prompt 改动</span>
      </div>
    </div>

    <!-- 用例 Tab -->
    <div v-if="tab === 'cases'" class="mk-card">
      <MockSkeletonTable v-if="casesLoading && !cases.length" :cols="6" />
      <div v-else-if="cases.length" class="mk-table-scroll pe-list">
        <table class="mk-table">
          <thead>
            <tr>
              <th>用例</th>
              <th>Agent</th>
              <th>消息</th>
              <th>期望</th>
              <th>状态</th>
              <th class="mk-col--time-full">更新</th>
              <th class="mk-col--actions-wide">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in cases" :key="c.id">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ c.name }}</strong>
                  <span class="mk-cell-sub" :title="c.caseId">{{ c.caseId }}</span>
                </div>
              </td>
              <td><span class="mk-badge mk-badge--info">{{ agentLabel(c.agentId) }}</span></td>
              <td class="mk-num">{{ c.messages.length }}</td>
              <td>
                <div v-if="expectationText(c)" class="pe-expect" :title="expectationText(c)">{{ expectationText(c) }}</div>
                <span v-else class="mk-na">无</span>
              </td>
              <td>
                <span class="mk-badge" :class="c.enabled ? 'mk-badge--ok' : 'mk-badge--muted'">{{ c.enabled ? '启用' : '停用' }}</span>
              </td>
              <td :title="fmtDate(c.updatedAt)">{{ timeAgo(c.updatedAt) }}</td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click="openEdit(c)">编辑</button>
                  <button type="button" class="mk-link" @click="toggleEnabled(c)">{{ c.enabled ? '停用' : '启用' }}</button>
                  <div class="mk-menu">
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === c.id" @click.stop="toggleMenu(c.id)">⋯</button>
                    <div v-if="openMenu === c.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" @click="menuEdit(c)">编辑用例</button>
                      <button type="button" class="mk-menu__item" @click="menuRunSingle(c)">单条试跑</button>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" @click="menuDelete(c)">删除</button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="casesFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">!</span>
        <strong>评估用例加载失败</strong>
        <span>无法从服务读取用例列表。</span>
        <button type="button" class="mk-empty__action" @click="reloadCases">重试</button>
      </div>
      <div v-else class="mk-empty mk-empty--min">
        <strong>还没有评估用例</strong>
        <span>为 Agent 维护输入消息与期望，跑评估验证 prompt 改动是否达标。</span>
        <button type="button" class="mk-empty__action" @click="openCreate">新建用例</button>
      </div>
    </div>

    <!-- 历史 Tab -->
    <div v-else class="mk-card">
      <MockSkeletonTable v-if="runsLoading && !runs.length" :cols="6" />
      <div v-else-if="runs.length" class="mk-table-scroll pe-list">
        <table class="mk-table">
          <thead>
            <tr>
              <th>运行</th>
              <th>Agent</th>
              <th>结果</th>
              <th>用例/次数</th>
              <th>耗时</th>
              <th class="mk-col--time-full">时间</th>
              <th class="mk-col--actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in runs" :key="r.id">
              <td>
                <div class="mk-cell-main">
                  <strong>#{{ shortId(r.id, 8, 4) }}</strong>
                  <span class="mk-cell-sub">{{ r.mode }} · {{ promptSourceText(r.promptSource) }} v{{ r.promptVersion ?? '—' }}</span>
                </div>
              </td>
              <td><span class="mk-badge mk-badge--info">{{ agentLabel(r.agentId) }}</span></td>
              <td>
                <div class="pe-result" :class="resultTone(r)">
                  <strong>{{ r.summary.passRate ?? 0 }}%</strong>
                  <span>{{ r.summary.passedCount ?? 0 }}/{{ r.summary.totalRuns ?? 0 }} 通过</span>
                </div>
              </td>
              <td class="mk-num">{{ r.caseCount }} 例 × {{ r.summary.repeatCount ?? 1 }} 次</td>
              <td class="mk-num">{{ fmtMs(r.durationMs) }}</td>
              <td :title="fmtDate(r.createdAt)">{{ timeAgo(r.createdAt) }}</td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click="openRunDetail(r)">详情</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="runsFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">!</span>
        <strong>评估历史加载失败</strong>
        <button type="button" class="mk-empty__action" @click="reloadRuns">重试</button>
      </div>
      <div v-else class="mk-empty mk-empty--min">
        <strong>还没有评估记录</strong>
        <span>在用例列表选择「跑评估」或「单条试跑」后，历史会记录在这里。</span>
      </div>
    </div>

    <!-- 用例编辑弹窗 -->
    <Teleport to="body">
      <div v-if="formOpen" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="编辑评估用例">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">{{ editingId ? '编辑用例' : '新建用例' }}</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="formOpen = false">✕</button>
          </div>
          <div class="mk-modal__body">
            <!-- 一行引导 -->
            <div class="pe-guide">
              <span class="pe-guide__title">评估用例 = 学生说的话 + 期望助手怎么回</span>
              <span class="pe-guide__steps">改 prompt 后一键重跑防退化；期望可不填，填好直接「保存并立即试跑」。</span>
            </div>

            <!-- 能力 + 名称 -->
            <div class="pe-form-grid">
              <label class="mk-field" :class="{ 'mk-field--error': errors.agentId }">
                <span class="mk-field__label">助手能力 <em class="mk-field__req">*</em></span>
                <select v-model="form.agentId" class="mk-field__select" :disabled="!!editingId">
                  <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.label }}</option>
                </select>
                <span class="mk-field__hint">{{ agentDesc }}</span>
                <span v-if="errors.agentId" class="mk-field__err">{{ errors.agentId }}</span>
              </label>
              <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
                <span class="mk-field__label">用例名称 <em class="mk-field__req">*</em></span>
                <input v-model="form.name" class="mk-field__input" placeholder="例如：学生说要考英语" />
                <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
              </label>
            </div>

            <!-- 学生输入：标准 tab 切换 -->
            <div class="pe-input-block">
              <div class="pe-tabs" role="tablist">
                <button type="button" class="pe-tab" role="tab" :aria-selected="form.inputSource === 'manual'"
                  :class="{ 'pe-tab--on': form.inputSource === 'manual' }" @click="form.inputSource = 'manual'">✍️ 手写对话</button>
                <button type="button" class="pe-tab" role="tab" :aria-selected="form.inputSource === 'simulated'"
                  :class="{ 'pe-tab--on': form.inputSource === 'simulated' }" @click="form.inputSource = 'simulated'">🎭 模拟学生</button>
              </div>

              <div class="pe-tab-body">
                <!-- 手写对话 -->
                <template v-if="form.inputSource === 'manual'">
                  <div class="pe-msgs">
                    <div v-for="(m, i) in form.messages" :key="i" class="pe-msg">
                      <select v-model="m.role" class="mk-input pe-msg__role">
                        <option value="user">学生</option>
                        <option value="assistant">助手</option>
                      </select>
                      <input v-model="m.content" class="mk-input pe-msg__content"
                        :placeholder="m.role === 'user' ? '例如：我想考英语，帮帮我' : '助手的历史回复（可选，模拟多轮）'" />
                      <button type="button" class="mk-link mk-link--danger" :disabled="form.messages.length <= 1" @click="form.messages.splice(i, 1)">✕</button>
                    </div>
                  </div>
                  <button type="button" class="mk-link" @click="form.messages.push({ role: 'user', content: '' })">+ 再加一轮对话</button>
                </template>

                <!-- 模拟学生：虚拟学习者扮演输入 -->
                <template v-else>
                  <div class="mk-field" :class="{ 'mk-field--error': errors.scenario }">
                    <span class="mk-field__label">学生场景 <em class="mk-field__req">*</em></span>
                    <textarea v-model="form.scenario" class="mk-field__textarea" rows="2"
                      placeholder="例如：我想考英语，时间不多，每周只能挤两次一小时" />
                    <span v-if="errors.scenario" class="mk-field__err">{{ errors.scenario }}</span>
                    <span class="mk-field__hint">一句话描述学生是谁、想干什么。跑评估时虚拟学习者按此扮演学生，说得更真实。</span>
                  </div>
                  <label class="mk-field">
                    <span class="mk-field__label">学生人设 <span class="mk-field__opt">（可选）</span></span>
                    <select v-model="form.personaId" class="mk-field__select">
                      <option value="">为这个场景新建（自动生成学生人设）</option>
                      <option v-for="v in virtualLearners" :key="v.id" :value="v.id">{{ v.label }}</option>
                    </select>
                  </label>
                  <!-- 模拟参数：一行内联，不折叠 -->
                  <div class="pe-params">
                    <label class="pe-param">
                      <span class="pe-param__label">对话轮数</span>
                      <input v-model.number="form.dialogueRounds" type="number" min="1" max="5" class="mk-input mono" />
                    </label>
                    <label class="pe-param">
                      <span class="pe-param__label">学生对抗度</span>
                      <select v-model="form.frictionBudget" class="mk-input">
                        <option value="none">none · 配合</option>
                        <option value="low">low · 犹豫</option>
                        <option value="normal">normal · 正常</option>
                        <option value="high">high · 难缠</option>
                        <option value="stress_test">stress · 极端</option>
                      </select>
                    </label>
                    <label class="pe-param pe-param--grow">
                      <span class="pe-param__label">收敛门禁字段（可选）</span>
                      <input v-model="form.convergeRequires" class="mk-input mono" placeholder="real_problem,confirmedProposal" />
                    </label>
                  </div>
                </template>
              </div>
            </div>

            <!-- 期望（可选，单层折叠） -->
            <details class="pe-expect" :open="expectOpen" @toggle="onExpectToggle">
              <summary>期望助手怎么回 <span class="pe-expect__hint">{{ expectSummary }}</span></summary>
              <div class="pe-form-grid">
                <label class="mk-field">
                  <span class="mk-field__label">必须做到 <span class="mk-field__opt">（人话，逗号分隔）</span></span>
                  <input v-model="form.mustContain" class="mk-field__input" :placeholder="agentMustContainPlaceholder" />
                  <span class="mk-field__hint">回复必须包含这些内容才算通过，例如：{{ agentMustContainExample }}</span>
                </label>
                <label class="mk-field">
                  <span class="mk-field__label">不能出现</span>
                  <input v-model="form.mustNotInclude" class="mk-field__input" placeholder="例如：我不知道,去问老师吧" />
                  <span class="mk-field__hint">回复出现这些字样就不通过。</span>
                </label>
              </div>
              <details class="pe-adv">
                <summary>高级校验 <span class="pe-adv__hint">让助手按固定结构输出后，逐项卡结构字段</span></summary>
                <div v-if="form.agentId === 'skill:goal-conversation'" class="mk-field">
                  <span class="mk-field__label">期望输出阶段</span>
                  <input v-model="form.expectedStage" class="mk-field__input mono" placeholder="understanding / proposal / confirmed" />
                  <span class="mk-field__hint">助手内部应进入的阶段（选填）。</span>
                </div>
                <div v-if="form.agentId === 'skill:path-planning'" class="mk-field">
                  <span class="mk-field__label">期望里程碑数</span>
                  <input v-model.number="form.expectedMilestones" type="number" min="1" max="8" class="mk-field__input mono" placeholder="例如：3" />
                  <span class="mk-field__hint">助手必须拆出恰好这么多阶段里程碑。</span>
                </div>
                <div v-if="form.agentId === 'skill:stage-designer'" class="mk-field">
                  <span class="mk-field__label">期望子任务数</span>
                  <input v-model.number="form.expectedSubtaskCount" type="number" min="1" max="8" class="mk-field__input mono" placeholder="例如：4" />
                  <span class="mk-field__hint">助手必须拆出恰好这么多子任务。</span>
                </div>
                <label class="mk-field">
                  <span class="mk-field__label">输出结构字段 <span class="mk-field__opt">（进阶）</span></span>
                  <input v-model="form.mustInclude" class="mk-field__input mono" :placeholder="`例如：${agentFieldHint}`" />
                  <span class="mk-field__hint">{{ agentLabel(form.agentId) }} 的合法输出字段：{{ agentFieldHint }}。只在想精确卡结构时填。</span>
                </label>
                <div v-if="isStructuredSkill(form.agentId)" class="mk-field">
                  <span class="mk-field__label">完整输入结构（JSON，一般不用填）</span>
                  <textarea v-model="form.inputPayloadText" class="mk-field__textarea mono" rows="4"
                    placeholder='例如：{"type":"path","goal":"…","currentLevel":"beginner","expectedMilestones":3}'
                    @change="parseInputPayload" />
                  <span v-if="form.inputPayloadError" class="mk-field__err">{{ form.inputPayloadError }}</span>
                </div>
              </details>
              <label class="mk-field">
                <span class="mk-field__label">备注（可选）</span>
                <textarea v-model="form.description" class="mk-field__textarea" rows="2" placeholder="这个用例想验证什么，比如：学生只说一句话时，助手也要能引导出学习目标" />
              </label>
            </details>

            <label class="mk-field mk-field--switch">
              <input v-model="form.enabled" type="checkbox" />
              <span class="mk-field__label" style="margin:0">参与批量评估（不勾就只单独试跑时用）</span>
            </label>
            <div v-if="formError" class="mk-alert">{{ formError }}</div>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" :disabled="saving || savingRun" @click="formOpen = false">取消</button>
            <button type="button" class="mk-btn" :disabled="saving || savingRun" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="saving || savingRun" @click="saveAndRun">{{ savingRun ? '试跑中…' : '保存并立即试跑' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 运行详情抽屉 -->
    <Teleport to="body">
      <div v-if="runDetailOpen" class="mk-drawer">
        <div class="mk-drawer__mask" @click="runDetailOpen = false"></div>
        <div class="mk-drawer__panel" role="dialog" aria-label="评估运行详情">
          <div class="mk-drawer__head">
            <div>
              <h3 class="mk-drawer__title">评估运行详情</h3>
              <span class="mk-drawer__sub">{{ runDetail?.agentId }} · {{ fmtDate(runDetail?.createdAt || '') }}</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="runDetailOpen = false">✕</button>
          </div>
          <div class="mk-drawer__body">
            <div v-if="runDetailLoading" class="pe-detail-loading"><span class="mk-spinner"></span> 加载中…</div>
            <template v-else-if="runDetail">
              <div class="pe-run-summary">
                <MkKpi label="通过率" :value="`${runDetail.summary.passRate ?? 0}%`" />
                <MkKpi label="通过/总数" :value="`${runDetail.summary.passedCount ?? 0}/${runDetail.summary.totalRuns ?? 0}`" />
                <MkKpi label="结构化输出" :value="`${runDetail.summary.structuredSuccessRate ?? 0}%`" />
                <MkKpi label="总耗时" :value="fmtMs(runDetail.durationMs)" />
              </div>
              <div v-if="runDetail.results.length" class="pe-results">
                <div v-for="(res, i) in runDetail.results" :key="i" class="pe-result-row" :class="{ 'pe-result-row--fail': !res.passed }">
                  <div class="pe-result-row__head">
                    <strong>{{ res.caseName }} <span class="mk-na">({{ res.caseId }})</span></strong>
                    <span class="mk-badge" :class="res.passed ? 'mk-badge--ok' : 'mk-badge--bad'">{{ res.passed ? '通过' : '未通过' }}</span>
                    <span class="pe-result-row__meta mono">#{{ res.runIndex }} · {{ fmtMs(res.durationMs) }} · stage={{ res.output?.stage ?? '—' }}</span>
                  </div>
                  <div v-if="!res.passed" class="pe-result-row__checks">
                    <span v-for="(v, k) in res.checks" :key="k" class="pe-check" :class="v ? 'pe-check--ok' : 'pe-check--fail'">{{ v ? '✓' : '✗' }} {{ checkLabel(String(k)) }}</span>
                  </div>
                  <div v-if="res.transcript?.length" class="pe-transcript">
                    <div v-for="(t, ti) in res.transcript" :key="ti" class="pe-transcript__row">
                      <span class="pe-transcript__role" :class="t.role === 'goal_agent' ? 'pe-transcript__role--goal' : 'pe-transcript__role--learner'">
                        {{ t.role === 'goal_agent' ? '助手' : '学生' }}·{{ t.round }}
                      </span>
                      <div>
                        <div class="pe-transcript__content">{{ t.content }}</div>
                        <div v-if="t.error" class="pe-transcript__meta">⚠️ {{ t.error }}</div>
                        <div v-if="t.learnerState" class="pe-transcript__meta">
                          学生状态：被理解 {{ Math.round((t.learnerState.feltUnderstood ?? 0) * 100) }}% · 目标清晰 {{ Math.round((t.learnerState.problemClarity ?? 0) * 100) }}% ·
                          readyToProceed={{ t.learnerState.readyToProceed === true ? '是' : '否' }}{{ t.emotion ? ` · 情绪 ${t.emotion}` : '' }}
                        </div>
                      </div>
                    </div>
                  </div>
                  <p v-if="res.output?.userVisible" class="pe-result-row__out">{{ res.output.userVisible }}</p>
                </div>
              </div>
              <div v-else class="mk-empty mk-empty--compact"><strong>无结果明细</strong></div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { timeAgo, errMsg, shortId } from './live'
import { adminPromptOpsApi, adminVirtualLearnersApi, type CreateEvalCasePayload } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import MkKpi from './MkKpi.vue'

interface EvalCase {
  id: string
  agentId: string
  caseId: string
  name: string
  description: string | null
  messages: Array<{ role: string; content: string }>
  expectations: {
    mustIncludeFields?: string[]
    mustContainText?: string[]
    mustNotInclude?: string[]
    expectedStage?: string
    expectedMilestones?: number
    expectedSubtaskCount?: number
    mode?: 'manual' | 'simulated'
    scenario?: string
    personaId?: string
    dialogueRounds?: number
    frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test'
    convergeRequires?: string[]
  } | null
  previousState?: Record<string, unknown> | null
  inputPayload?: Record<string, unknown> | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface EvalRun {
  id: string
  agentId: string
  promptVersion: number | null
  promptSource: string
  mode: string
  caseCount: number
  totalRuns: number
  summary: Record<string, any>
  durationMs: number
  createdAt: string
}

// 后端 run-eval 支持的 3 个能力 + 白话元数据（标签/一句话说明/该能力输出的字段名）
const AGENT_META: Record<string, { label: string; desc: string; fields: string; mustContainExample: string }> = {
  'skill:goal-conversation': {
    label: 'goal-conversation · 聊目标摸需求',
    desc: '先和学生对话，摸清真实目标，给出理解和方案，最后确认。',
    fields: 'stage, emotion, need, real_problem, confirmedProposal',
    mustContainExample: '你的目标，学习计划',
  },
  'skill:path-planning': {
    label: 'path-planning · 大目标拆路径',
    desc: '把一个大目标拆成几个阶段里程碑，每段给出核心理念和资源。',
    fields: 'cognitiveCore, milestones, resources',
    mustContainExample: '第一个月，第二阶段',
  },
  'skill:stage-designer': {
    label: 'stage-designer · 里程碑拆子任务',
    desc: '把一个里程碑展开成具体的子任务步骤。',
    fields: 'subtasks',
    mustContainExample: '任务一，学习目标',
  },
}
const agents = Object.entries(AGENT_META).map(([id, m]) => ({ id, label: m.label }))
const agentLabel = (id: string) => AGENT_META[id]?.label || id
const agentDesc = computed(() => AGENT_META[form.value.agentId]?.desc || '')
const agentFieldHint = computed(() => AGENT_META[form.value.agentId]?.fields || '')
const agentMustContainExample = computed(() => AGENT_META[form.value.agentId]?.mustContainExample || '')
const agentMustContainPlaceholder = computed(() => `例如：${AGENT_META[form.value.agentId]?.mustContainExample || ''}`)

const tab = ref<'cases' | 'runs'>('cases')
const agentFilter = ref('')
const cases = ref<EvalCase[]>([])
const runs = ref<EvalRun[]>([])
const casesLoading = ref(false)
const runsLoading = ref(false)
const casesFailed = ref(false)
const runsFailed = ref(false)

const statusTone = computed(() => 'mk-status--ok')
const lastRunText = computed(() => (runs.value.length ? `最近 ${timeAgo(runs.value[0]?.createdAt)}` : '暂无评估记录'))
const lastRunHint = computed(() => (runs.value[0] ? `通过率 ${runs.value[0].summary.passRate ?? 0}%` : ''))

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtMs(ms: number | undefined | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
const promptSourceText = (s: string) => ({ active: 'ACTIVE', version: '版本', custom: '自定义', draft: '草稿' }[s] || s)
/** 把校验 key 翻译成人话，例如 mustContain:先问目标 → 「必须出现"先问目标"」 */
const checkLabel = (rawKey: string): string => {
  const [kind, ...rest] = rawKey.split(':')
  const val = rest.join(':')
  if (kind === 'mustContain') return `必须出现「${val}」`
  if (kind === 'mustNotInclude') return `不能出现「${val}」`
  if (kind === 'mustInclude') return `含字段 ${val}`
  const map: Record<string, string> = {
    parsed: '输出可解析',
    contractValid: '结构契约合法',
    structuredOutputValid: '结构化输出合法',
    stageValid: '阶段识别正确',
    expectedStage: '阶段符合预期',
    milestoneCount: '里程碑数',
    milestoneCountMatchesExpected: '里程碑数与期望一致',
    namePresent: '含名称',
    milestonesPresent: '含里程碑',
    cognitiveCorePresent: '含核心理念',
    subtaskCount: '子任务数',
    subtaskCountMatchesExpected: '子任务数与期望一致',
    subtasksPresent: '含子任务',
    inputsUsingCognitives: '使用认知要素',
  }
  return map[rawKey] || rawKey
}
const resultTone = (r: EvalRun) => {
  const p = r.summary.passRate ?? 0
  return p >= 90 ? 'pe-result--ok' : p >= 60 ? 'pe-result--warn' : 'pe-result--bad'
}
const expectationText = (c: EvalCase) => {
  const e = c.expectations
  if (!e) return ''
  const parts: string[] = []
  if (e.expectedStage) parts.push(`stage=${e.expectedStage}`)
  if (e.mustIncludeFields?.length) parts.push(`含 ${e.mustIncludeFields.length} 字段`)
  if (e.mustNotInclude?.length) parts.push(`不含 ${e.mustNotInclude.length} 词`)
  return parts.join(' · ')
}

async function reloadCases() {
  casesLoading.value = true
  casesFailed.value = false
  try {
    const res = await adminPromptOpsApi.getEvalCases(agentFilter.value || undefined)
    const items = (res.data?.data ?? res.data) || []
    cases.value = items.map((c: Record<string, unknown>) => ({
      id: String(c.id),
      agentId: String(c.agentId),
      caseId: String(c.caseId),
      name: String(c.name || ''),
      description: (c.description as string) || null,
      messages: Array.isArray(c.messages) ? c.messages : [],
      expectations: (c.expectations as EvalCase['expectations']) || null,
      previousState: (c.previousState as Record<string, unknown>) || null,
      inputPayload: (c.inputPayload as Record<string, unknown>) || null,
      enabled: c.enabled !== false,
      createdAt: String(c.createdAt || ''),
      updatedAt: String(c.updatedAt || ''),
    }))
  } catch (e) {
    casesFailed.value = true
    toast.error(`加载用例失败：${errMsg(e)}`)
  } finally {
    casesLoading.value = false
  }
}

async function reloadRuns() {
  runsLoading.value = true
  runsFailed.value = false
  try {
    const res = await adminPromptOpsApi.getEvalRuns(agentFilter.value || undefined, 30)
    const items = (res.data?.data ?? res.data) || []
    runs.value = items.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      agentId: String(r.agentId),
      promptVersion: r.promptVersion != null ? Number(r.promptVersion) : null,
      promptSource: String(r.promptSource || ''),
      mode: String(r.mode || ''),
      caseCount: Number(r.caseCount || 0),
      totalRuns: Number(r.totalRuns || 0),
      summary: (r.summary as Record<string, any>) || {},
      durationMs: Number(r.durationMs || 0),
      createdAt: String(r.createdAt || ''),
    }))
  } catch (e) {
    runsFailed.value = true
    toast.error(`加载历史失败：${errMsg(e)}`)
  } finally {
    runsLoading.value = false
  }
}

function switchTab(t: 'cases' | 'runs') {
  tab.value = t
  if (t === 'cases' && !cases.value.length && !casesLoading.value) void reloadCases()
  if (t === 'runs' && !runs.value.length && !runsLoading.value) void reloadRuns()
}

/* 表单 */
const formOpen = ref(false)
useEscape(() => formOpen.value, () => { formOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => formOpen.value), panelRef)
useMaskClose(maskRef, () => { formOpen.value = false })

const editingId = ref('')
const saving = ref(false)
const formError = ref('')
const form = ref({
  agentId: 'skill:goal-conversation',
  caseId: '',
  name: '',
  description: '',
  messages: [{ role: 'user' as 'user' | 'assistant', content: '' }],
  inputPayloadText: '',
  inputPayloadError: '',
  expectedMilestones: null as number | null,
  expectedSubtaskCount: null as number | null,
  mustContain: '',
  mustInclude: '',
  mustNotInclude: '',
  expectedStage: '',
  enabled: true,
  // 虚拟学习者模拟输入
  inputSource: 'manual' as 'manual' | 'simulated',
  scenario: '',
  personaId: '',
  dialogueRounds: 1,
  frictionBudget: 'normal' as 'none' | 'low' | 'normal' | 'high' | 'stress_test',
  convergeRequires: '',
})
const errors = ref<{ name?: string; agentId?: string; scenario?: string }>({})

/** 折叠状态：期望区默认收起，编辑已有配置时展开 */
const expectOpen = ref(false)
const onExpectToggle = (e: Event) => { expectOpen.value = (e.target as HTMLDetailsElement).open }

const expectSummary = computed(() => {
  const parts: string[] = []
  const mc = form.value.mustContain.split(/[,，]/).filter((s) => s.trim()).length
  const mn = form.value.mustNotInclude.split(/[,，]/).filter((s) => s.trim()).length
  const adv = form.value.expectedStage.trim() || form.value.mustInclude.trim()
    || form.value.expectedMilestones != null || form.value.expectedSubtaskCount != null
  if (mc) parts.push(`必须做到 ${mc} 项`)
  if (mn) parts.push(`不能出现 ${mn} 项`)
  if (adv) parts.push('已配高级校验')
  return parts.length ? `已设置：${parts.join(' · ')}` : '可选，跳过也能试跑'
})

/** 已有虚拟学习者列表（复用其 persona + 故事池） */
const virtualLearners = ref<Array<{ id: string; label: string }>>([])
const virtualLearnersLoading = ref(false)
async function loadVirtualLearners() {
  if (virtualLearners.value.length || virtualLearnersLoading.value) return
  virtualLearnersLoading.value = true
  try {
    const res = await adminVirtualLearnersApi.getVirtualLearners({ limit: 100 })
    const payload: any = res?.data?.data || res?.data || {}
    const profiles = Array.isArray(payload) ? payload : (Array.isArray(payload.profiles) ? payload.profiles : [])
    virtualLearners.value = profiles.map((v: any) => {
      const nameHint = v?.profile?.nameHint || v?.nameHint || ''
      const label = [v?.userName, nameHint].filter(Boolean).join(' · ')
      return { id: v?.id, label: label || String(v?.id || '').slice(0, 8) }
    }).filter((v: any) => v.id)
  } catch (e) {
    // 虚拟学习者列表加载失败不阻断表单（模拟模式为可选能力）
    console.warn('加载虚拟学习者失败', e)
  } finally {
    virtualLearnersLoading.value = false
  }
}

function isStructuredSkill(agentId: string): boolean {
  return agentId === 'skill:path-planning' || agentId === 'skill:stage-designer'
}

function parseInputPayload() {
  form.value.inputPayloadError = ''
  const text = form.value.inputPayloadText.trim()
  if (!text) return
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      form.value.inputPayloadError = '必须是 JSON 对象'
      return
    }
    // 期望数量从输入里同步到独立字段（builder 里同时写 inputPayload + expectations）
    if (parsed.expectedMilestones != null) form.value.expectedMilestones = Number(parsed.expectedMilestones)
    if (parsed.expectedSubtaskCount != null) form.value.expectedSubtaskCount = Number(parsed.expectedSubtaskCount)
  } catch (e: any) {
    form.value.inputPayloadError = `JSON 解析失败：${e?.message || String(e)}`
  }
}

function openCreate() {
  editingId.value = ''
  form.value = {
    agentId: agentFilter.value || 'skill:goal-conversation',
    caseId: '',
    name: '',
    description: '',
    messages: [{ role: 'user', content: '' }],
    inputPayloadText: '',
    inputPayloadError: '',
    expectedMilestones: null,
    expectedSubtaskCount: null,
    mustContain: '',
    mustInclude: '',
    mustNotInclude: '',
    expectedStage: '',
    enabled: true,
    inputSource: 'manual',
    scenario: '',
    personaId: '',
    dialogueRounds: 1,
    frictionBudget: 'normal',
    convergeRequires: '',
  }
  errors.value = {}
  formError.value = ''
  formOpen.value = true
  expectOpen.value = false
  void loadVirtualLearners()
}

function openEdit(c: EvalCase) {
  editingId.value = c.id
  const e = c.expectations || {}
  // path/stage 结构化输入：从 previousState/inputPayload 回填（DB 用例的 previousStateJson 同时承载）
  const structured = {
    ...((c as any).previousState || {}),
    ...((c as any).inputPayload || {}),
  }
  const structuredKeys = Object.keys(structured)
  const inputPayloadText = structuredKeys.length ? JSON.stringify(structured, null, 2) : ''
  form.value = {
    agentId: c.agentId,
    caseId: c.caseId,
    name: c.name,
    description: c.description || '',
    messages: c.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    inputPayloadText,
    inputPayloadError: '',
    expectedMilestones: typeof e.expectedMilestones === 'number' ? e.expectedMilestones : null,
    expectedSubtaskCount: typeof e.expectedSubtaskCount === 'number' ? e.expectedSubtaskCount : null,
    mustContain: (e.mustContainText || []).join('，'),
    mustInclude: (e.mustIncludeFields || []).join(','),
    mustNotInclude: (e.mustNotInclude || []).join(','),
    expectedStage: e.expectedStage || '',
    enabled: c.enabled,
    inputSource: e.mode === 'simulated' ? 'simulated' : 'manual',
    scenario: e.scenario || '',
    personaId: e.personaId || '',
    dialogueRounds: typeof e.dialogueRounds === 'number' && e.dialogueRounds >= 1 ? e.dialogueRounds : 1,
    frictionBudget: (['none', 'low', 'normal', 'high', 'stress_test'] as const).includes((e as any).frictionBudget)
      ? (e.frictionBudget as typeof form.value.frictionBudget)
      : 'normal',
    convergeRequires: (e.convergeRequires || []).join(','),
  }
  errors.value = {}
  formError.value = ''
  formOpen.value = true
  // 编辑时：已有期望配置则自动展开期望折叠
  const e2 = c.expectations || {}
  expectOpen.value = !!(e2.mustIncludeFields?.length || e2.mustContainText?.length || e2.mustNotInclude?.length || e2.expectedStage || e2.expectedMilestones != null || e2.expectedSubtaskCount != null)
  void loadVirtualLearners()
}

function buildInputPayload(): Record<string, unknown> | null {
  const text = form.value.inputPayloadText.trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function buildPayload(): CreateEvalCasePayload {
  const expectations: Record<string, unknown> = {}
  const mustContain = form.value.mustContain.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  const mustInclude = form.value.mustInclude.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  const mustNotInclude = form.value.mustNotInclude.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  if (mustContain.length) expectations.mustContainText = mustContain
  if (mustInclude.length) expectations.mustIncludeFields = mustInclude
  if (mustNotInclude.length) expectations.mustNotInclude = mustNotInclude
  if (form.value.expectedStage.trim()) expectations.expectedStage = form.value.expectedStage.trim()
  if (form.value.expectedMilestones != null) expectations.expectedMilestones = form.value.expectedMilestones
  if (form.value.expectedSubtaskCount != null) expectations.expectedSubtaskCount = form.value.expectedSubtaskCount

  // 虚拟学习者模拟输入：透传 simulated 配置（后端 run-eval 据此展开学生输入）
  if (form.value.inputSource === 'simulated') {
    expectations.mode = 'simulated'
    if (form.value.scenario.trim()) expectations.scenario = form.value.scenario.trim()
    if (form.value.personaId) expectations.personaId = form.value.personaId
    expectations.dialogueRounds = Math.max(1, Math.min(5, form.value.dialogueRounds || 1))
    expectations.frictionBudget = form.value.frictionBudget
    const converge = form.value.convergeRequires.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    if (converge.length) expectations.convergeRequires = converge
  }

  const inputPayload = buildInputPayload()
  return {
    agentId: form.value.agentId,
    caseId: form.value.caseId.trim() || undefined,
    name: form.value.name.trim(),
    description: form.value.description.trim() || undefined,
    messages: form.value.messages.filter((m) => m.content.trim()).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.trim() })),
    // path/stage：结构化输入透传（后端合并进 previousStateJson）
    ...(inputPayload ? { inputPayload } : {}),
    expectations: Object.keys(expectations).length ? (expectations as CreateEvalCasePayload['expectations']) : undefined,
    enabled: form.value.enabled,
  }
}

async function save(): Promise<boolean> {
  errors.value = {}
  formError.value = ''
  if (!form.value.agentId) { errors.value.agentId = '请选择助手能力'; return false }
  if (!form.value.name.trim()) { errors.value.name = '请输入用例名称'; return false }
  if (form.value.inputSource === 'simulated') {
    if (!form.value.scenario.trim() && !form.value.personaId) {
      errors.value.scenario = '模拟模式需要学生场景（或选已有虚拟人）'
      return false
    }
  } else if (!form.value.messages.some((m) => m.content.trim())) {
    formError.value = '至少需要一条学生说的话'
    return false
  }
  saving.value = true
  try {
    const payload = buildPayload()
    if (editingId.value) {
      await adminPromptOpsApi.updateEvalCase(editingId.value, payload)
      toast.success('用例已更新')
    } else {
      await adminPromptOpsApi.createEvalCase(payload)
      toast.success('用例已创建')
    }
    formOpen.value = false
    void reloadCases()
    return true
  } catch (e) {
    formError.value = errMsg(e)
    return false
  } finally {
    saving.value = false
  }
}

/** 保存并立即试跑：保存成功后，用表单内容跑一次（adhoc，不进历史） */
const savingRun = ref(false)
async function saveAndRun() {
  if (!(await save())) return
  const c: EvalCase = {
    id: editingId.value || 'new',
    agentId: form.value.agentId,
    caseId: form.value.caseId.trim() || `adhoc-${Date.now().toString(36)}`,
    name: form.value.name.trim(),
    description: form.value.description.trim() || null,
    messages: form.value.messages.filter((m) => m.content.trim()).map((m) => ({ role: m.role, content: m.content.trim() })),
    previousState: buildInputPayload() || undefined,
    inputPayload: buildInputPayload(),
    expectations: buildPayload().expectations || null,
    enabled: form.value.enabled,
    createdAt: '',
    updatedAt: '',
  }
  savingRun.value = true
  try {
    await runSingle(c)
  } finally {
    savingRun.value = false
  }
}

/* 行操作 */
const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()
function menuEdit(c: EvalCase) { closeMenu(); openEdit(c) }
function menuDelete(c: EvalCase) { closeMenu(); void removeCase(c) }
async function menuRunSingle(c: EvalCase) { closeMenu(); await runSingle(c) }

async function removeCase(c: EvalCase) {
  try {
    await adminPromptOpsApi.deleteEvalCase(c.id)
    cases.value = cases.value.filter((x) => x.id !== c.id)
    toast.success('用例已删除')
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  }
}

async function toggleEnabled(c: EvalCase) {
  try {
    await adminPromptOpsApi.updateEvalCase(c.id, {
      enabled: !c.enabled,
      name: c.name,
      messages: c.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    })
    c.enabled = !c.enabled
    toast.success(c.enabled ? '已启用' : '已停用')
  } catch (e) {
    toast.error(`操作失败：${errMsg(e)}`)
  }
}

/** 批量跑评估：对当前 agentFilter 下所有启用用例跑（走 DB caseIds） */
const canRunBatch = computed(() => cases.value.some((c) => c.enabled))
async function runBatch() {
  if (!canRunBatch.value) { toast.info('请先创建并启用至少一个用例'); return }
  const target = agentFilter.value || ''
  const targetCases = cases.value.filter((c) => c.enabled && (!target || c.agentId === target))
  if (!targetCases.length) { toast.info('当前筛选下没有启用的用例'); return }
  const busy = toast.info(`正在批量评估 ${targetCases.length} 个用例…`, 0)
  try {
    const res = await adminPromptOpsApi.runEval({
      agentId: targetCases[0].agentId,
      caseIds: targetCases.map((c) => c.caseId),
      repeatCount: 1,
    })
    const data = res.data?.data ?? res.data
    const summary = data?.summary || {}
    toast.close(busy)
    toast.success(`批量完成：${summary.passedCount ?? 0}/${summary.totalRuns ?? 0} 通过（${summary.passRate ?? 0}%）`)
    void reloadRuns()
  } catch (e) {
    toast.close(busy)
    toast.error(`批量评估失败：${errMsg(e)}`)
  }
}

/** 单条试跑：直接跑一个用例（不回写历史） */
async function runSingle(c: EvalCase) {
  const busy = toast.info(`正在试跑「${c.name}」…`, 0)
  try {
    const structured = {
      ...((c as any).previousState || {}),
      ...((c as any).inputPayload || {}),
    }
    const inputPayload = Object.keys(structured).length ? structured : undefined
    const res = await adminPromptOpsApi.runEval({
      agentId: c.agentId,
      adhocCases: [{
        id: c.caseId,
        name: c.name,
        messages: c.messages,
        previousState: (c as any).previousState || undefined,
        ...(inputPayload ? { inputPayload } : {}),
        expectations: c.expectations || undefined,
      }],
      repeatCount: 1,
    })
    const data = res.data?.data ?? res.data
    const summary = data?.summary || {}
    toast.close(busy)
    toast.success(`试跑完成：通过率 ${summary.passRate ?? 0}%`)
    void reloadRuns()
  } catch (e) {
    toast.close(busy)
    toast.error(`试跑失败：${errMsg(e)}`)
  }
}

/* 运行详情 */
const runDetailOpen = ref(false)
const runDetailLoading = ref(false)
const runDetail = ref<any>(null)

async function openRunDetail(r: EvalRun) {
  runDetailOpen.value = true
  runDetailLoading.value = true
  runDetail.value = null
  try {
    const res = await adminPromptOpsApi.getEvalRun(r.id)
    runDetail.value = res.data?.data ?? res.data
  } catch (e) {
    toast.error(`加载详情失败：${errMsg(e)}`)
  } finally {
    runDetailLoading.value = false
  }
}

void reloadCases()
</script>

<style scoped>
.pe-filter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 14px; }
.pe-filter__hint { color: var(--mk-faint); font-size: var(--mk-fs-12); margin-left: auto; }
/* 列表高度：空态占位交给 mk-empty--min，有数据时表格自然高度（不再硬撑满屏） */
.pe-list { min-height: 0; }
.pe-expect { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--mk-fs-12); color: var(--mk-muted); }
.pe-result { display: flex; align-items: baseline; gap: 6px; }
.pe-result strong { font-size: var(--mk-fs-13); font-family: var(--mk-mono); }
.pe-result span { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.pe-result--ok strong { color: var(--mk-green); }
.pe-result--warn strong { color: var(--mk-amber); }
.pe-result--bad strong { color: var(--mk-red); }

.pe-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pe-msgs { display: grid; gap: 6px; }
/* 消息行：三列统一自然高度（select/input 同用 .mk-input 自然高度，不做固定 height，
   否则 1440px+ 字号档 padding 放大后会裁切 select 文字） */
.pe-msg { display: grid; grid-template-columns: 92px 1fr 30px; gap: 8px; align-items: center; }
/* 统一 select/input 的行高，让高度由 padding+line-height 自然决定；
   不固定 height，避免 1440/2000/2800px 字号档 padding 放大后裁切文字 */
.pe-msg .mk-input { line-height: 18px; }
.pe-msg select.mk-input { line-height: 19px; }
.pe-msg .mk-link {
  justify-self: center;
  width: 28px;
  height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: 6px;
}

/* 用例表单：白话引导 + 分步区块 */
.pe-guide {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.08), rgba(14, 165, 233, 0.06));
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 4px;
}
.pe-guide__title { font-size: var(--mk-fs-12_5); font-weight: 700; color: var(--mk-indigo, #4f46e5); }
.pe-guide__steps { font-size: var(--mk-fs-12); color: var(--mk-muted); line-height: 1.5; }
.mk-field__opt { font-size: var(--mk-fs-11); color: var(--mk-faint); font-weight: 500; }

/* ===== 学生输入：标准 tab ===== */
.pe-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--mk-line); }
.pe-tab {
  border: 0;
  background: transparent;
  padding: 8px 14px;
  cursor: pointer;
  font-size: var(--mk-fs-13);
  font-weight: 600;
  color: var(--mk-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.pe-tab:hover { color: var(--mk-ink); }
.pe-tab--on { color: var(--mk-blue, #2c63d0); border-bottom-color: var(--mk-blue, #2c63d0); }
.pe-tab-body {
  border: 1px solid var(--mk-line);
  border-top: 0;
  border-radius: 0 0 10px 10px;
  padding: 12px;
  display: grid;
  gap: 10px;
  background: var(--mk-surface);
}

/* 模拟参数：一行内联 */
.pe-params { display: grid; grid-template-columns: 84px 150px 1fr; gap: 10px; align-items: end; }
.pe-param { display: grid; gap: 4px; }
.pe-param__label { font-size: var(--mk-fs-11_5); font-weight: 600; color: var(--mk-muted); }

/* ===== 期望（可选，单层折叠） ===== */
.pe-expect { border-top: 1px solid var(--mk-line); padding-top: 10px; }
.pe-expect summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mk-fs-13);
  font-weight: 700;
  color: var(--mk-text);
  user-select: none;
}
.pe-expect summary::-webkit-details-marker { display: none; }
.pe-expect summary::before { content: '▸'; font-size: var(--mk-fs-11); color: var(--mk-faint); transition: transform .15s ease; }
.pe-expect[open] summary::before { transform: rotate(90deg); }
.pe-expect__hint { font-size: var(--mk-fs-11); font-weight: 400; color: var(--mk-faint); }
.pe-expect > * + * { margin-top: 10px; }
/* 折叠语义恢复：内容元素的显式 display（grid 等）会覆盖 UA 的 display:none */
.pe-expect:not([open]) > *:not(summary),
.pe-adv:not([open]) > *:not(summary) { display: none !important; }

/* ===== 高级校验（期望内的二级折叠） ===== */
.pe-adv {
  border: 1px dashed var(--mk-line);
  border-radius: 10px;
  padding: 8px 12px 12px;
  display: block;
}
.pe-adv > * + * { margin-top: 10px; }
.pe-adv summary {
  cursor: pointer;
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
  color: var(--mk-muted);
  padding: 4px 0;
  user-select: none;
}
.pe-adv summary:hover { color: var(--mk-indigo, #4f46e5); }
.pe-adv__hint { font-size: var(--mk-fs-11); font-weight: 400; color: var(--mk-faint); margin-left: 6px; }

/* 模拟对话轨迹 */
.pe-transcript { display: grid; gap: 6px; margin-top: 6px; }
.pe-transcript__row { display: grid; grid-template-columns: 56px 1fr; gap: 8px; font-size: var(--mk-fs-12); }
.pe-transcript__role { font-weight: 700; padding-top: 2px; }
.pe-transcript__role--goal { color: var(--mk-indigo, #6366f1); }
.pe-transcript__role--learner { color: var(--mk-green); }
.pe-transcript__content { color: var(--mk-muted); line-height: 1.6; word-break: break-all; }
.pe-transcript__meta { grid-column: 2; font-size: var(--mk-fs-11); color: var(--mk-faint); }

.pe-detail-loading { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 40px 0; color: var(--mk-muted); font-size: var(--mk-fs-13); }
/* 运行概要：MkKpi 网格容器（统计卡本体由 MkKpi 提供） */
.pe-run-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.pe-results { display: grid; gap: 8px; }
.pe-result-row { border: 1px solid var(--mk-line); border-radius: 10px; padding: 10px 12px; display: grid; gap: 8px; background: var(--mk-surface); }
.pe-result-row--fail { border-color: rgba(220, 38, 38, 0.35); background: var(--mk-red-bg, #fef2f2); }
.pe-result-row__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pe-result-row__head strong { font-size: var(--mk-fs-12_5); }
.pe-result-row__meta { margin-left: auto; font-size: var(--mk-fs-11); color: var(--mk-faint); }
.pe-result-row__checks { display: flex; gap: 6px; flex-wrap: wrap; }
.pe-check { font-size: var(--mk-fs-11); padding: 1px 8px; border-radius: 99px; font-weight: 600; }
.pe-check--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.pe-check--fail { background: var(--mk-red-bg); color: var(--mk-red); }
.pe-result-row__out {
  margin: 0;
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
  max-height: 96px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  border-top: 1px dashed var(--mk-line);
  padding-top: 8px;
}

@media (min-width: 2000px) {
  .pe-result-row__head strong { font-size: 14px; }
  .pe-result-row__out { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .pe-result-row__head strong { font-size: 16.5px; }
  .pe-result-row__out { font-size: 16px; }
  .pe-expect { font-size: 13.5px; max-width: 300px; }
}
@media (min-width: 3600px) {
  .pe-result-row__head strong { font-size: 19.5px; }
  .pe-result-row__out { font-size: 18.5px; }
  .pe-expect { font-size: 16px; max-width: 350px; }
}

/* 暗色模式（D1 补完）：Prompt 评估（此前完全缺失） */
html[data-theme='dark'] {
  .pe-result-row { background: #141c2b; border-color: #232f45; }
  .pe-result-row--fail { background: rgba(248, 113, 113, 0.08); border-color: rgba(248, 113, 113, 0.35); }
  .pe-check--ok { background: rgba(74, 222, 128, 0.14); color: #6ee7a0; }
  .pe-check--fail { background: rgba(248, 113, 113, 0.14); color: #fca5a5; }
}
</style>
