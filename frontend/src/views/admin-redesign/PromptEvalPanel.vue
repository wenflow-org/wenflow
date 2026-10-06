<template>
  <!-- 面板（2026-10-04 独立场景下线，折入 Skills 宿主「Prompt 评估」页签）。多根片段（2026-10-06 审核
       #87）：KPI 带移到宿主页签卡外，与 run 页签同构（KPI 在卡外、卡内只放页签+工具栏+表格），
       不再把 KPI/页签/筛选/表格全塞进同一张 .mk-card--fill（ADMIN_VISUAL_LAYER_SPEC §163）。
       原页头退役——主操作「批量跑评估」上移宿主页头（defineExpose 供宿主驱动）。 -->
  <!-- 运行中常显条（#86）：批量/试跑是真 LLM 调用且跨页签存活（标志模块级），
       切到别的页签再回来仍能看到「还在跑」，不再只靠常驻 toast -->
  <div v-if="running" class="mk-alert mk-alert--row mk-alert--info pe-running" role="status" aria-live="polite">
    <span class="mk-alert__msg">{{ runningInfo || '评估运行中…' }}</span>
  </div>
  <!-- KPI 带（2026-10-04 状态条退役）：原条读数改三卡——最近评测通过率（阈值着色语义不变，
       类名 tone 翻译成 MkKpi tone；agent 筛选限定词与基数并进 hint）、评估用例、评估历史
       （窗口上限口径进 title，上次评估时刻降为 hint）。批量跑评估在宿主页头，工具行动作在本卡 -->
  <section class="mk-kpi-grid" aria-label="Prompt 评估统计">
    <MkKpi
      label="最近评测通过率"
      :value="lastPassRateText"
      :tone="lastRateTone"
      :hint="lastRateHint"
      :title="lastRateTitle"
    />
    <MkKpi label="评估用例" :value="cases.length" :hint="casesKpiHint" :title="casesKpiTitle" />
    <MkKpi label="评估历史" :value="runs.length" :hint="lastRunText" :title="runsKpiTitle" />
  </section>

  <div class="mk-card mk-card--fill pe">
    <!-- 卡内主视图切换（原型 renderPromptEval card > .tabs 页签 + 工具栏 + 页签体；
         对齐 Users.vue / ExecLogs.vue / AuditLogs.vue 卡内页签判例。内层页签寻址用
         ?peTab=（宿主 ?tab= 归 Skills 页签所有，二者不共键） -->
    <!-- 主视图切换（全局 .tabs/.tab 原语，判例 Skills.vue:58-62）：
           2026-10-06 审核收口——此前页内自搓 .pe-tabs/.pe-tab 是全仓最后一份 scoped 拷贝，
           与全局逐字重复且缺 transition（hover/激活硬切）。弹窗内两组改用 MkSubTabs -->
      <div class="tabs" role="tablist" aria-label="评估视图切换">
        <button type="button" role="tab" id="pe-tab-cases" aria-controls="pe-panel-cases" class="tab" :aria-selected="tab === 'cases'" @click="switchTab('cases')">评估用例</button>
        <button type="button" role="tab" id="pe-tab-runs" aria-controls="pe-panel-runs" class="tab" :aria-selected="tab === 'runs'" @click="switchTab('runs')">评估历史</button>
      </div>

      <!-- 筛选/工具栏行（两页签共用 agent 筛选；原型 cases 工具栏右侧的 primary sm
           「新建用例」落在同行最右，仅用例页签可见） -->
      <div class="pe-filter">
        <!-- onAgentFilterChange：用例与历史共用该筛选，切换时两边都重拉（原只刷用例） -->
        <select v-model="agentFilter" class="mk-filter__select" aria-label="按 Agent 筛选" @change="onAgentFilterChange">
          <option value="">全部 Agent</option>
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.label }}</option>
        </select>
        <span v-if="tab === 'cases'" class="pe-filter__hint">用例驱动：为 goal-conversation 等 Agent 维护评估集，一键跑评估验证 prompt 改动</span>
        <button v-if="tab === 'cases'" type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="openCreate">新建用例</button>
      </div>

    <!-- 用例 Tab -->
    <div v-if="tab === 'cases'" id="pe-panel-cases" role="tabpanel" aria-labelledby="pe-tab-cases" class="pe-panel">
      <MockSkeletonTable v-if="casesLoading && !cases.length" :cols="6" />
      <div v-else-if="cases.length" class="mk-table-scroll pe-list">
        <!-- 原型 .tbl：width:100% 自动布局（无 fixed/colgroup），单元格 nowrap、列宽随内容；
             长内容（用例名/期望摘要）由 mk-cell-main 上限与 pe-expect 截断兜底 -->
        <table class="mk-table mk-table--click">
          <thead>
            <tr>
              <th>用例</th>
              <th>Agent</th>
              <th class="mk-th--right">消息数</th>
              <th>期望</th>
              <th>状态</th>
              <th>更新</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 原型 2105：用例行 data-action="open-skill" → 点击/回车打开对应 Skill 详情；
                 行内按钮一律 stop，键盘冒泡在 openCaseSkill 内按 target 守卫 -->
            <tr
              v-for="c in cases"
              :key="c.id"
              tabindex="0"
              role="button"
              :aria-label="`查看用例 ${c.name} 对应的 Skill 详情`"
              @click="openCaseSkill(c)"
              @keydown.enter="openCaseSkill(c, $event)"
            >
              <td>
                <div class="mk-cell-main">
                  <strong>{{ c.name }}</strong>
                  <span class="mk-cell-sub" :title="c.caseId">{{ c.caseId }}</span>
                </div>
              </td>
              <td><span class="mk-badge mk-badge--info" :title="agentLabel(c.agentId)">{{ agentLabel(c.agentId) }}</span></td>
              <!-- P3（设计评审 4.3-19）：「消息」列头下放的是模式词「模拟」，列头与内容错位——
                   列头改「消息数」；模拟用例该格改 mk-badge--muted 徽章与数量值视觉区分（title 保留原解释） -->
              <td class="mk-num" :title="c.messages.length === 0 && c.expectations?.mode === 'simulated' ? '模拟用例：学生话由模拟器生成，无需手写消息' : ''">
                <span v-if="c.messages.length === 0 && c.expectations?.mode === 'simulated'" class="mk-badge mk-badge--muted">模拟</span>
                <template v-else>{{ c.messages.length }}</template>
              </td>
              <td>
                <div v-if="expectationText(c)" class="pe-expect" :title="expectationText(c)">{{ expectationText(c) }}</div>
                <span v-else class="mk-na">无</span>
              </td>
              <td>
                <span class="mk-badge" :class="c.enabled ? 'mk-badge--ok' : 'mk-badge--muted'">{{ c.enabled ? '启用' : '停用' }}</span>
                <span
                  v-if="c.personaMissing"
                  class="mk-badge mk-badge--warn pe-persona-missing"
                  title="引用的虚拟学习者已被删除：批量评估会跳过该用例，请重选学生人设或改用场景描述"
                >人设失效</span>
              </td>
              <td :title="fmtDate(c.updatedAt)">{{ timeAgo(c.updatedAt) }}</td>
              <td>
                <div class="mk-actions">
                  <!-- 原型操作列：文字小钮（.btn--sm 形态）；低频/危险动作留在 ⋯ 菜单 -->
                  <button type="button" class="mk-btn mk-btn--sm" @click.stop="openEdit(c)">编辑</button>
                  <button type="button" class="mk-btn mk-btn--sm" @click.stop="toggleEnabled(c)">{{ c.enabled ? '停用' : '启用' }}</button>
                  <div class="mk-menu">
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === c.id" @click.stop="toggleMenu(c.id)">⋯</button>
                    <div v-if="openMenu === c.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" @click="menuEdit(c)">编辑用例</button>
                      <button type="button" class="mk-menu__item" :disabled="running" @click="menuRunSingle(c)">单条试跑</button>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" @click="menuDelete(c)">删除</button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <MkEmptyState
        v-else-if="casesFailed"
        tone="error"
        icon="!"
        title="评估用例加载失败"
        description="无法从服务读取用例列表。"
        action-text="重试"
        @action="reloadCases"
      />
      <MkEmptyState
        v-else
        icon="◌"
        min
        title="还没有评估用例"
        description="为 Agent 维护输入消息与期望，跑评估验证 prompt 改动是否达标。"
        action-text="新建用例"
        @action="openCreate"
      />
    </div>

    <!-- 历史 Tab -->
    <div v-else id="pe-panel-runs" role="tabpanel" aria-labelledby="pe-tab-runs" class="pe-panel">
      <!-- 跨运行对比（#94）：勾选 ≤2 次运行 → 并排 diff（benchmark 排期第 3 步的最小实现） -->
      <div v-if="runs.length" class="pe-compare-bar">
        <span class="pe-filter__hint">勾选两次运行可并排对比（最多 2 条）</span>
        <button
          type="button"
          class="mk-btn mk-btn--sm mk-btn--primary"
          :disabled="compareIds.length !== 2 || compareLoading"
          @click="openCompare"
        >{{ compareLoading ? '对比中…' : `对比选中 ${compareIds.length}/2` }}</button>
      </div>
      <MockSkeletonTable v-if="runsLoading && !runs.length" :cols="8" />
      <div v-else-if="runs.length" class="mk-table-scroll pe-list">
        <!-- 原型 .tbl：width:100% 自动布局（无 fixed/colgroup），单元格 nowrap、列宽随内容 -->
        <table class="mk-table">
          <thead>
            <tr>
              <th class="pe-compare-col"><span class="visually-hidden">选择对比</span></th>
              <th>运行</th>
              <th>Agent</th>
              <th>结果</th>
              <th>用例/次数</th>
              <th class="mk-th--right">耗时</th>
              <th>时间</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in runs" :key="r.id">
              <td class="pe-compare-col">
                <input
                  type="checkbox"
                  :checked="compareIds.includes(r.id)"
                  :disabled="!compareIds.includes(r.id) && compareIds.length >= 2"
                  :aria-label="`选择运行 ${shortId(r.id, 8, 4)} 参与对比`"
                  @change="toggleCompare(r.id)"
                />
              </td>
              <td>
                <!-- P2-5（2026-09-27 走查）：主标识原先只有截断 UUID（#a1b2c3d4），扫一行看不出
                     这次评估结果如何。主行改为「通过率% · N 例 × M 次」，副行「agent · 时间」，
                     run id 连同 prompt 版本来源降为第三行（mono，title 给全量 id 便于反馈排查） -->
                <div class="mk-cell-main">
                  <strong>{{ runRateText(r) }} · {{ r.caseCount }} 例 × {{ r.summary.repeatCount ?? 1 }} 次</strong>
                  <span class="mk-cell-sub">{{ agentLabel(r.agentId) }} · {{ timeAgo(r.createdAt) }}</span>
                  <span class="mk-cell-sub" :title="`run id ${r.id}`">#{{ shortId(r.id, 8, 4) }} · {{ modeText(r.mode) }} · {{ promptSourceText(r.promptSource) }} v{{ r.promptVersion ?? '—' }}</span>
                </div>
              </td>
              <td><span class="mk-badge mk-badge--info">{{ agentLabel(r.agentId) }}</span></td>
              <td>
                <!-- 通过率缺失显「—」（不按 0% 渲染）：缺数据 ≠ 全挂；着色阈值走 rate-utils 单点 -->
                <div class="pe-result" :class="resultTone(r)" :title="RATE_THRESHOLD_NOTE">
                  <strong>{{ runRateText(r) }}</strong>
                  <span class="mk-minibar pe-result__bar" aria-hidden="true"><i :style="{ width: `${typeof r.summary.passRate === 'number' ? Math.max(0, Math.min(100, r.summary.passRate)) : 0}%` }"></i></span>
                  <span>{{ r.summary.passedCount ?? '—' }}/{{ r.summary.totalRuns ?? '—' }} 通过</span>
                </div>
              </td>
              <td class="mk-num">{{ r.caseCount }} 例 × {{ r.summary.repeatCount ?? 1 }} 次</td>
              <td class="mk-num">{{ fmtMs(r.durationMs) }}</td>
              <td :title="fmtDate(r.createdAt)">{{ timeAgo(r.createdAt) }}</td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-btn mk-btn--sm" @click="openRunDetail(r)">详情</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <MkEmptyState
        v-else-if="runsFailed"
        tone="error"
        icon="!"
        title="评估历史加载失败"
        description="无法从服务读取评估历史。"
        action-text="重试"
        @action="reloadRuns"
      />
      <MkEmptyState
        v-else
        icon="◌"
        min
        title="还没有评估记录"
        description="跑评估的两个真实入口：页头「批量跑评估」一次跑完当前筛选下所有启用用例；单条试跑在用例行 ⋯ 菜单里。运行记录会自动汇总到这里。"
        action-text="去评估用例"
        @action="switchTab('cases')"
      />
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

            <!-- 学生输入：共享 MkSubTabs 原语（role=tablist + roving tabindex + 方向键）。
                 图标为装饰性，原语无 icon 插槽（mk/* 属共享模块不改），此处以纯文字呈现 -->
            <div class="pe-input-block">
              <MkSubTabs
                :tabs="INPUT_SOURCE_TABS"
                :model-value="form.inputSource"
                aria-label="学生输入方式"
                @update:model-value="setInputSource"
              />

              <div class="pe-tab-body" id="pe-input-panel" role="tabpanel" aria-label="学生输入方式">
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
                  <!-- 模拟参数：一行内联，不折叠（收敛门禁字段为进阶配置，挪入下方「高级校验」折叠） -->
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
                  <input v-model="form.mustNotInclude" class="mk-field__input" placeholder="例如：我不知道，去问老师吧" />
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
                <!-- 原「收敛门禁字段」：内部术语白化为「对话收尾条件」，属进阶配置故收进高级折叠 -->
                <div v-if="form.inputSource === 'simulated'" class="mk-field">
                  <span class="mk-field__label">对话收尾条件 <span class="mk-field__opt">（进阶）</span></span>
                  <input v-model="form.convergeRequires" class="mk-field__input mono" placeholder="real_problem,confirmedProposal" />
                  <span class="mk-field__hint">模拟对话收集齐这些信息才算聊完，一般保持默认即可。</span>
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
            <div v-if="formError" class="mk-alert" role="alert">{{ formError }}</div>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" :disabled="saving || savingRun" @click="formOpen = false">取消</button>
            <button type="button" class="mk-btn" :disabled="saving || savingRun" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="saving || savingRun || running" @click="saveAndRun">{{ savingRun ? '试跑中…' : '保存并立即试跑' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 运行详情抽屉 -->
    <Teleport to="body">
      <div v-if="runDetailOpen" ref="runMaskRef" class="mk-drawer">
        <div class="mk-drawer__mask" @click="runDetailOpen = false"></div>
        <div ref="runPanelRef" class="mk-drawer__panel" role="dialog" aria-label="评估运行详情">
          <header class="mk-drawer__head">
            <div class="mk-drawer__heading">
              <h3 class="mk-drawer__title">评估运行详情</h3>
              <span class="mk-drawer__sub">{{ agentLabel(runDetail?.agentId || '') }} · {{ fmtDate(runDetail?.createdAt || '') }}</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="runDetailOpen = false">✕</button>
          </header>
          <!-- 内容层对齐原型三段式：首段 pills → 事实栅格 → 嵌套卡（用例结果 feed）；仅视觉词汇对齐 -->
          <div class="mk-drawer__body pe-detail__body">
            <MkLoading v-if="runDetailLoading" inline />
            <template v-else-if="runDetail">
              <!-- 首段徽章行（原型 .ovl__body 首段 pills）：通过率 / 通过数为 summary 行上已有字段；
                   passRate 缺失显「—」+ title「暂无评测数据」（不 `?? 0` 伪装全挂）；阈值披露于 title -->
              <div class="pe-detail__pills">
                <span class="mk-badge" :class="passTone(runDetail.summary)" :title="detailPassRateText === '—' ? '暂无评测数据：该运行未回传通过率' : RATE_THRESHOLD_NOTE">通过率 {{ detailPassRateText }}</span>
                <span class="mk-badge mk-badge--muted">通过 {{ runDetail.summary.passedCount ?? '—' }} / {{ runDetail.summary.totalRuns ?? '—' }}</span>
              </div>
              <!-- 事实清单（原型 dl.kv → 共享 mk-facts 栅格）：summary 数值不再用页面级 MkKpi 卡 -->
              <div class="mk-facts">
                <div><span>结构化输出</span><strong class="mono">{{ formatRate(runDetail.summary.structuredSuccessRate) || '—' }}</strong></div>
                <div><span>总耗时</span><strong class="mono">{{ fmtMs(runDetail.durationMs) }}</strong></div>
                <div><span>用例数</span><strong class="mono">{{ runDetail.results.length }}</strong></div>
              </div>
              <!-- 用例结果：嵌套无边框卡（原型 .card box-shadow:none + card__head/card__body，内 feed 行） -->
              <section v-if="runDetail.results.length" class="mk-card">
                <div class="mk-card__head">
                  <h4 class="mk-card__title">用例结果</h4>
                  <span class="mk-card__meta mono">{{ runDetail.results.length }}</span>
                </div>
                <div class="pe-results">
                  <div v-for="(res, i) in runDetail.results" :key="i" class="pe-result-row" :class="{ 'pe-result-row--fail': !res.passed }">
                    <div class="pe-result-row__head">
                      <strong>{{ res.caseName }} <span class="mk-na">({{ res.caseId }})</span></strong>
                      <span class="mk-badge" :class="res.passed ? 'mk-badge--ok' : 'mk-badge--bad'">{{ res.passed ? '通过' : '未通过' }}</span>
                      <!-- 失败用例就近跳转（评审「失败用例无『去改 Prompt』链路」）：openCaseSkill 同口径剥 skill: 前缀进 Skill 详情 -->
                      <button v-if="!res.passed && runDetail?.agentId" type="button" class="mk-link" title="打开该用例对应的 Skill 详情（改 Prompt 前先看上下文）" @click="goCaseSkill(runDetail.agentId)">查看该 Skill</button>
                      <span class="pe-result-row__meta mono">#{{ res.runIndex }} · {{ fmtMs(res.durationMs) }} · 阶段：{{ stageText(res.output?.stage) }}</span>
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
                            是否愿意推进：{{ t.learnerState.readyToProceed === true ? '是' : '否' }}{{ t.emotion ? ` · 情绪 ${t.emotion}` : '' }}
                          </div>
                        </div>
                      </div>
                    </div>
                    <p v-if="res.output?.userVisible" class="pe-result-row__out">{{ res.output.userVisible }}</p>
                  </div>
                </div>
              </section>
              <MkEmptyState v-else compact title="无结果明细" />
            </template>
            <!-- P2-1（2026-09-27 走查）：详情拉取失败时抽屉正文此前整块空白、无重试入口
                 （toast 转瞬即逝，用户只能关掉抽屉再点一次「详情」）。补 tone=error 空态，
                 与列表三态（MkLoading / 有数据 / 失败）口径一致 -->
            <MkEmptyState
              v-else
              tone="error"
              compact
              title="详情加载失败"
              description="无法读取该次评估运行的结果明细。"
              action-text="重试"
              @action="retryRunDetail"
            />
          </div>
          <!-- 底部动作（原型 .ovl__foot：上边框、右对齐、常驻滚动区外；同 gc-detail__foot 判例） -->
          <footer class="mk-drawer__foot">
            <button type="button" class="mk-btn" @click="runDetailOpen = false">关闭</button>
          </footer>
        </div>
      </div>
    </Teleport>

    <!-- 跨运行对比抽屉（#94）：按 caseId 对齐两次运行，通过率/耗时差异着色（升绿降红），失败用例标红 -->
    <Teleport to="body">
      <div v-if="compareOpen" ref="compareMaskRef" class="mk-drawer">
        <div class="mk-drawer__mask" @click="closeCompare"></div>
        <div ref="comparePanelRef" class="mk-drawer__panel mk-drawer__panel--wide" role="dialog" aria-label="两次评估运行对比">
          <header class="mk-drawer__head">
            <div class="mk-drawer__heading">
              <h3 class="mk-drawer__title">运行对比</h3>
              <span class="mk-drawer__sub mono">{{ compareLabel }}</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="closeCompare">✕</button>
          </header>
          <div class="mk-drawer__body pe-detail__body">
            <MkLoading v-if="compareLoading" inline />
            <MkEmptyState
              v-else-if="compareFailed"
              tone="error"
              compact
              title="对比加载失败"
              description="无法读取所选运行的结果明细。"
              action-text="重试"
              @action="openCompare"
            />
            <template v-else-if="compareRows.length">
              <div class="pe-detail__pills">
                <span class="mk-badge mk-badge--muted">A {{ compareRunA?.summary?.passRate != null ? formatRate(compareRunA.summary.passRate) : '—' }}</span>
                <span class="mk-badge mk-badge--muted">B {{ compareRunB?.summary?.passRate != null ? formatRate(compareRunB.summary.passRate) : '—' }}</span>
                <span v-if="compareDeltaText" class="mk-badge" :class="compareDeltaTone">{{ compareDeltaText }}</span>
              </div>
              <div class="mk-table-scroll">
                <table class="mk-table pe-compare-table">
                  <thead>
                    <tr>
                      <th>用例</th>
                      <th>A · 结果</th>
                      <th>A · 耗时</th>
                      <th>B · 结果</th>
                      <th>B · 耗时</th>
                      <th class="mk-th--right">耗时差</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in compareRows" :key="row.caseId" :class="{ 'pe-compare-row--fail': row.aPassed === false || row.bPassed === false }">
                      <td>
                        <div class="mk-cell-main">
                          <strong>{{ row.caseName || row.caseId }}</strong>
                          <span class="mk-cell-sub mono">{{ row.caseId }}</span>
                        </div>
                      </td>
                      <td><span class="mk-badge" :class="row.aPassed === true ? 'mk-badge--ok' : row.aPassed === false ? 'mk-badge--bad' : 'mk-badge--muted'">{{ row.aPassed === true ? '通过' : row.aPassed === false ? '未通过' : '未跑' }}</span></td>
                      <td class="mk-num">{{ fmtMs(row.aDurationMs) }}</td>
                      <td><span class="mk-badge" :class="row.bPassed === true ? 'mk-badge--ok' : row.bPassed === false ? 'mk-badge--bad' : 'mk-badge--muted'">{{ row.bPassed === true ? '通过' : row.bPassed === false ? '未通过' : '未跑' }}</span></td>
                      <td class="mk-num">{{ fmtMs(row.bDurationMs) }}</td>
                      <td class="mk-num" :class="deltaClass(row)">{{ deltaText(row) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <MkEmptyState v-else compact title="无可对比的用例明细" />
          </div>
          <footer class="mk-drawer__foot">
            <button type="button" class="mk-btn" @click="closeCompare">关闭</button>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
/* 模块级共享状态（与 <script setup> 编译进同一模块，故用命名空间导入避免 ref 重名） */
import * as vue from 'vue'

/* 运行互斥标志提到模块级（#86）：宿主 Skills.vue 用 v-else-if 挂载本面板，切页签即卸载实例——
   实例内的 running 随卸载消失，切回后按钮恢复可点，可再发起第二批真实 LLM 调用（并发烧 token）。
   模块级 ref 跨挂载存活，任何实例都读同一枚标志。 */
const sharedRunning = vue.ref(false)
/** 运行中条文案（用例数 / 试跑名）：模块级同样跨卸载存活 */
const sharedRunningInfo = vue.ref('')
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { timeAgo, errMsg, shortId } from './live'
import { adminPromptOpsApi, adminVirtualLearnersApi, type CreateEvalCasePayload } from '@/api/adminApi'
import { formatRate, rateToneOf, RATE_THRESHOLD_NOTE } from './rate-utils'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import { openSkillDrawer } from './store'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkSubTabs from '@/components/mk/MkSubTabs.vue'

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
  /** 服务端核验：模拟用例引用的虚拟学习者已不存在（跑批会跳过该用例） */
  personaMissing?: boolean
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
/* 弹窗内「手写对话 / 模拟学生」页签定义（表驱动，配共享 MkSubTabs 原语） */
const INPUT_SOURCE_TABS: Array<{ key: string; label: string }> = [
  { key: 'manual', label: '手写对话' },
  { key: 'simulated', label: '模拟学生' },
]
function setInputSource(key: string) {
  if (key === 'manual' || key === 'simulated') form.value.inputSource = key
}
const route = useRoute()
const router = useRouter()
const agentFilter = ref('')
const cases = ref<EvalCase[]>([])
const runs = ref<EvalRun[]>([])
const casesLoading = ref(false)
const runsLoading = ref(false)
const casesFailed = ref(false)
const runsFailed = ref(false)

/* URL ↔ 内层页签双向同步：键用 ?peTab=（宿主 ?tab= 归 Skills 页签所有，不共键）。
   immediate 首跑兼作唯一挂载加载入口（原先 setup 末尾还有一组裸 reload，深链 ?peTab=runs 时会双拉，
   且该 watch 必须放在 cases/runs 等 ref 声明之后，否则 immediate 回调会撞 TDZ） */
let bootstrapped = false
watch(
  () => route.query.peTab,
  (t) => {
    const v = t === 'runs' ? 'runs' : 'cases'
    if (v !== tab.value) tab.value = v
    if (!bootstrapped) {
      // 首屏用例与历史都拉：KPI「评估历史」卡不因停留在用例 Tab 而显示 0（2026-10-04 状态条退役，读数改挂 KPI 卡）
      bootstrapped = true
      void reloadCases()
      void reloadRuns()
      return
    }
    if (v === 'runs' && !runs.value.length && !runsLoading.value) void reloadRuns()
  },
  { immediate: true }
)

/* agent 筛选同时作用于用例与历史：切换时两边都重拉（原只刷用例，历史还停留在旧 agent 的数据） */
function onAgentFilterChange() {
  void reloadCases()
  void reloadRuns()
}

/* 评估历史加载窗口（getEvalRuns 上限 30）：KPI「评估历史」卡 title 与 reloadRuns 共用此常量 */
const RUNS_LIMIT = 30
/* 最近一次评估的通过率口径（runs[0] 即最新一次，reloadRuns 保持接口倒序）。
   精度/阈值/兜底走 rate-utils 单点：passRate 缺失显「—」+ title「暂无评测数据」（不 ?? 0 伪装 0%）。
   P2（2026-10-04 全站评审）：totalRuns=0（用例全部被跳过）也不是「0% 通过」失败态——红字
   配绿点同条打架；无分母走中性句，红档只留给真跑过且未达标的运行（后端在空跑时仍持久化 passRate=0）。 */
const lastRunEmpty = computed(() => {
  const s = runs.value[0]?.summary
  return !!s && (s.totalRuns ?? 0) === 0
})
const lastPassRateText = computed(() => {
  if (lastRunEmpty.value) return '暂无通过数据（0 次执行）'
  return formatRate(runs.value[0]?.summary?.passRate) ?? '—'
})
/** 基数（23/25）：summary 带通过数/总次数才拼接，缺一项就不硬凑；0 次执行不拼「（0/0）」 */
const lastRateBase = computed(() => {
  if (lastRunEmpty.value) return ''
  const s = runs.value[0]?.summary
  if (!s || typeof s.passedCount !== 'number' || typeof s.totalRuns !== 'number') return ''
  return `（${s.passedCount}/${s.totalRuns}）`
})
/** KPI tone（2026-10-04 状态条退役，原 lastRateCls 类名着色翻译成 MkKpi tone）：
    阈值纪律走 rate-utils 单点不变；muted（缺 passRate）与 0 次执行不着色 */
const lastRateTone = computed(() => {
  if (lastRunEmpty.value) return '' as const
  const tone = rateToneOf(runs.value[0]?.summary?.passRate)
  return tone === 'muted' ? '' : tone
})
/** 通过率卡 hint（2026-10-04 状态条退役）：基数 + agent 筛选限定词（原条句面口径迁入，数字不裸奔） */
const lastRateHint = computed(() => {
  const parts = [lastRateBase.value]
  if (agentFilter.value) parts.push(`仅 ${agentLabel(agentFilter.value)}`)
  return parts.filter(Boolean).join(' ')
})
const lastRateTitle = computed(() => {
  if (!runs.value.length) return '暂无评测数据'
  if (lastRunEmpty.value) return '最近一次评估 0 次执行（用例全部被跳过或未运行），无通过率可显示'
  return lastPassRateText.value === '—'
    ? '暂无评测数据：该运行未回传通过率'
    : `最近一次评估通过率；${RATE_THRESHOLD_NOTE}`
})
/* P3（设计评审 4.3-20）：同屏两个「最近」异义——「最近 30 次」是窗口、「最近 N 小时前」是时刻；
   时刻改「上次」前缀消歧，作 KPI「评估历史」卡 hint */
const lastRunText = computed(() => (runs.value.length ? `上次 ${timeAgo(runs.value[0]?.createdAt)}` : '暂无评估记录'))
const lastRunHint = computed(() => {
  const s = runs.value[0]?.summary
  if (!s) return ''
  const rate = formatRate(s.passRate)
  return `${rate ? `通过率 ${rate}` : '通过率暂无数据'}；${RATE_THRESHOLD_NOTE}`
})
/** 评估历史卡 title（2026-10-04 状态条退役）：窗口上限口径 + 原条 lastRunHint 语义并入。
    #88：数字随 agent 筛选收窄，限定词一并披露 */
const runsKpiTitle = computed(() =>
  `评估历史按最近 ${RUNS_LIMIT} 次窗口加载（上限非总数）${agentFilter.value ? `；仅 ${agentLabel(agentFilter.value)}` : ''}${lastRunHint.value ? `；${lastRunHint.value}` : ''}`
)
/* #88：用例/历史两张 KPI 的数字随顶部 agent 筛选收窄（reloadCases/reloadRuns 都带 agentFilter），
   口径文案必须同步披露这层限定——否则「用例总数」被读成全站总数，切筛选后数字骤降像「用例丢了」 */
const casesKpiHint = computed(() => (agentFilter.value ? `仅 ${agentLabel(agentFilter.value)}` : '全部 Agent'))
const casesKpiTitle = computed(() =>
  agentFilter.value
    ? `当前 agent 筛选「${agentLabel(agentFilter.value)}」下的评估用例数（非全站总数）`
    : '全部 Agent 的评估用例数（可按顶部 Agent 筛选收窄）'
)

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
/** mode 枚举 → 中文（后端 prompt_eval_runs.mode 现仅 eval-set；未知值回退原文） */
const modeText = (m: string) => ({ 'eval-set': '用例集' }[m] || m || '—')
/** 0 次执行（totalRuns=0，用例全被跳过）不是「0% 通过」失败态（D15）：
    无分母不着色、显「—」，与同屏 KPI「暂无通过数据」口径一致。 */
const isEmptyRun = (summary: { totalRuns?: number } | null | undefined) => (summary?.totalRuns ?? 0) === 0
/** 运行行通过率文案：缺失显「—」（不 ?? 0 把缺数据伪装成 0%）；0 次执行同样显「—」 */
const runRateText = (r: EvalRun) => (isEmptyRun(r.summary) ? '—' : formatRate(r.summary?.passRate) ?? '—')
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
/** 结果格基调：阈值走 rate-utils 单点（原私有 90/60 两档）；passRate 缺失或 0 次执行不着色（muted） */
const resultTone = (r: EvalRun) => {
  if (isEmptyRun(r.summary)) return ''
  const tone = rateToneOf(typeof r.summary?.passRate === 'number' ? r.summary.passRate : null)
  return tone === 'muted' ? '' : `pe-result--${tone}`
}
/** stage 英文枚举 → 白话（结果明细不再直接甩原始字段；未知值原样兜底） */
const stageText = (v: unknown): string => {
  if (v == null || v === '') return '—'
  const map: Record<string, string> = { understanding: '理解目标', proposal: '给出方案', confirmed: '已确认' }
  return map[String(v)] || String(v)
}
const expectationText = (c: EvalCase) => {
  const e = c.expectations
  if (!e) return ''
  const parts: string[] = []
  if (e.mode === 'simulated') parts.push(`模拟场景${e.scenario ? `：${e.scenario}` : ''}`)
  if (e.dialogueRounds) parts.push(`${e.dialogueRounds} 轮`)
  // 原漏计 mustContainText：列表期望摘要看不到「必须做到」配置，会误判用例没有期望
  if (e.mustContainText?.length) parts.push(`须含 ${e.mustContainText.length} 句`)
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
      personaMissing: c.personaMissing === true,
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
    const res = await adminPromptOpsApi.getEvalRuns(agentFilter.value || undefined, RUNS_LIMIT)
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
  if (route.query.peTab !== t) void router.replace({ query: { ...route.query, peTab: t } })
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

/* 用例行点击 → 对应 Skill 详情（原型 2105：data-action="open-skill"）。
   用例 agentId 形如 skill:goal-conversation，而 openSkillDrawer 收的是裸 skill id
   （store 原样存进 subPage.id，SkillDetail 再自行补 skill: 前缀；判例 live.ts:180 同样剥前缀），
   故必须剥掉 skill: ——直接透传会落到 SkillDetail「未注册或 ID 有误」错误态。
   e 存在（键盘触发）时，行内按钮/菜单上的回车会冒泡到行：target 非行本身则忽略（判例 ExecLogs.toggleRowOpen）。 */
function openCaseSkill(c: EvalCase, e?: Event) {
  if (e && e.target !== e.currentTarget) return
  const skillId = c.agentId.replace(/^skill:/, '')
  if (skillId) openSkillDrawer(skillId)
}

async function removeCase(c: EvalCase) {
  // 删除不可恢复且可能连带调好的期望配置：先二次确认（对齐全站 askConfirm 模式）
  const ok = await askConfirm({
    title: '删除用例',
    message: `确认删除用例「${c.name}」？删除后不可恢复。`,
    confirmText: '删除',
  })
  if (!ok) return
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
/* 运行互斥：批量/试跑都是真实 LLM 调用，运行期间禁用全部入口，防止并发多批重复烧 token。
   running 为模块级 ref（见文件头 <script> 块）：面板被宿主切页签卸载后标志仍在，切回不可再发起 */
const running = sharedRunning
const runningInfo = sharedRunningInfo
async function runBatch() {
  if (running.value) return
  if (!canRunBatch.value) { toast.info('请先创建并启用至少一个用例'); return }
  const target = agentFilter.value || ''
  const targetCases = cases.value.filter((c) => c.enabled && (!target || c.agentId === target))
  if (!targetCases.length) { toast.info('当前筛选下没有启用的用例'); return }
  // 后端按 agentId 过滤 caseIds（findEnabledEvalCasesByIds）：跨 agent 混一批会被静默丢弃、
  // toast 却谎报全部已跑，必须按 agentId 分组逐批提交；串行避免并发压 LLM
  const groups = new Map<string, EvalCase[]>()
  for (const c of targetCases) {
    const list = groups.get(c.agentId)
    if (list) list.push(c)
    else groups.set(c.agentId, [c])
  }
  const totalCases = targetCases.length
  const busy = toast.info(`正在批量评估 ${totalCases} 个用例…`, 0)
  running.value = true
  runningInfo.value = `批量评估运行中：${totalCases} 个用例（切换页签不会中断，完成前不可再发起）`
  try {
    let passed = 0
    let totalRuns = 0
    const skippedAll: string[] = []
    for (const [agentId, list] of groups) {
      const res = await adminPromptOpsApi.runEval({
        agentId,
        caseIds: list.map((c) => c.caseId),
        repeatCount: 1,
      })
      const data = res.data?.data ?? res.data
      const summary = data?.summary || {}
      passed += Number(summary.passedCount ?? 0)
      totalRuns += Number(summary.totalRuns ?? 0)
      const skipped = Array.isArray(data?.skipped) ? data.skipped : []
      for (const s of skipped) skippedAll.push(`[${agentLabel(agentId)}] ${String((s as any)?.reason || '未知原因')}`)
    }
    toast.close(busy)
    const passRate = totalRuns > 0 ? Math.round((passed / totalRuns) * 100) : 0
    toast.success(`批量完成 ${totalCases} 个用例：${passed}/${totalRuns} 通过（${passRate}%）`)
    if (skippedAll.length) {
      toast.info(`跳过 ${skippedAll.length} 个用例：${skippedAll.join('；')}`, 0)
    }
    void reloadRuns()
  } catch (e) {
    toast.close(busy)
    toast.error(`批量评估失败：${errMsg(e)}`)
  } finally {
    running.value = false
    runningInfo.value = ''
  }
}

/** 单条试跑：直接跑一个用例（不回写历史） */
async function runSingle(c: EvalCase) {
  if (running.value) { toast.info('已有评估在运行，请等它结束再试跑'); return }
  const busy = toast.info(`正在试跑「${c.name}」…`, 0)
  running.value = true
  runningInfo.value = `单条试跑运行中：「${c.name}」`
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
    toast.success(`试跑完成：通过率 ${formatRate(summary.passRate) ?? '—'}`)
    void reloadRuns()
  } catch (e) {
    toast.close(busy)
    toast.error(`试跑失败：${errMsg(e)}`)
  } finally {
    running.value = false
    runningInfo.value = ''
  }
}

/* 运行详情 */
const runDetailOpen = ref(false)
/* 运行详情抽屉行为四件套（2026-09-26 弹层对齐）：与上方用例弹窗同一套钩子，ref 独立 */
const runMaskRef = ref<HTMLElement | null>(null)
const runPanelRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => runDetailOpen.value), runPanelRef)
useMaskClose(runMaskRef, () => { runDetailOpen.value = false })
useEscape(() => runDetailOpen.value, () => { runDetailOpen.value = false })
const runDetailLoading = ref(false)
const runDetail = ref<any>(null)
/* 当前抽屉对应的运行行：失败空态的「重试」需要拿到它（openRunDetail 入参在抽屉打开后即丢失） */
const runDetailTarget = ref<EvalRun | null>(null)

/* 通过率徽章基调收敛到 rate-utils 三档 + 无数据档（原「全过=ok 否则 warn」两档：90 分与 0 分同色）；
   阈值在徽章 title 披露（调用处）。passRate 缺失 → muted 徽章（缺数据 ≠ 未达成） */
function passTone(summary: { passRate?: number; passedCount?: number; totalRuns?: number } | null | undefined): string {
  if (isEmptyRun(summary)) return 'mk-badge--muted'
  const tone = rateToneOf(typeof summary?.passRate === 'number' ? summary.passRate : null)
  return tone === 'ok' ? 'mk-badge--ok' : tone === 'bad' ? 'mk-badge--bad' : tone === 'warn' ? 'mk-badge--warn' : 'mk-badge--muted'
}

/** 抽屉通过率文案：缺失或 0 次执行显「—」（不 ?? 0） */
const detailPassRateText = computed(() =>
  isEmptyRun(runDetail.value?.summary) ? '—' : formatRate(runDetail.value?.summary?.passRate) ?? '—'
)

/** 失败用例 → 对应 Skill 详情（openCaseSkill 同口径剥 skill: 前缀；评审「失败用例无去改 Prompt 链路」） */
function goCaseSkill(agentId: unknown) {
  const skillId = String(agentId || '').replace(/^skill:/, '')
  if (skillId) openSkillDrawer(skillId)
}

async function openRunDetail(r: EvalRun) {
  runDetailTarget.value = r
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

/** 抽屉内「重试」：重拉同一运行的详情 */
function retryRunDetail() {
  if (runDetailTarget.value) void openRunDetail(runDetailTarget.value)
}

/* ===== 跨运行对比（#94，benchmark 排期第 3 步的最小实现）=====
   历史表勾选 ≤2 次运行 → 并排 diff：按 caseId 对齐，通过率/耗时差异着色（升绿降红），失败用例标红。 */
const compareIds = ref<string[]>([])
const compareOpen = ref(false)
const compareLoading = ref(false)
const compareFailed = ref(false)
const compareMaskRef = ref<HTMLElement | null>(null)
const comparePanelRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => compareOpen.value), comparePanelRef)
useMaskClose(compareMaskRef, closeCompare)
useEscape(() => compareOpen.value, closeCompare)
interface CompareDetailResult { caseId: string; caseName?: string; passed?: boolean; durationMs?: number }
const compareRunA = ref<any>(null)
const compareRunB = ref<any>(null)

/** 勾选/取消一条运行（最多 2 条，超出时忽略——checkbox 已 disabled） */
function toggleCompare(id: string) {
  const i = compareIds.value.indexOf(id)
  if (i >= 0) compareIds.value = compareIds.value.filter((x) => x !== id)
  else if (compareIds.value.length < 2) compareIds.value = [...compareIds.value, id]
}
function closeCompare() {
  compareOpen.value = false
}
/** 按 caseId 对齐两次运行的结果明细；某次缺该用例 → 该侧「未跑」 */
const compareRows = computed(() => {
  const a = (compareRunA.value?.results || []) as CompareDetailResult[]
  const b = (compareRunB.value?.results || []) as CompareDetailResult[]
  const keys: string[] = []
  const push = (k: string) => { if (k && !keys.includes(k)) keys.push(k) }
  for (const r of a) push(String(r.caseId || ''))
  for (const r of b) push(String(r.caseId || ''))
  return keys.map((caseId) => {
    const ra = a.find((x) => String(x.caseId || '') === caseId)
    const rb = b.find((x) => String(x.caseId || '') === caseId)
    return {
      caseId,
      caseName: ra?.caseName || rb?.caseName || '',
      aPassed: typeof ra?.passed === 'boolean' ? ra.passed : null,
      bPassed: typeof rb?.passed === 'boolean' ? rb.passed : null,
      aDurationMs: ra?.durationMs,
      bDurationMs: rb?.durationMs,
    }
  })
})
const compareLabel = computed(() => {
  const a = compareRunA.value
  const b = compareRunB.value
  if (!a || !b) return ''
  return `A v${a.promptVersion ?? '—'} ↔ B v${b.promptVersion ?? '—'}`
})
/** 两次运行整体通过率差（B − A）：升绿降红；无分母不出结论 */
const compareDeltaText = computed(() => {
  const a = compareRunA.value?.summary?.passRate
  const b = compareRunB.value?.summary?.passRate
  if (typeof a !== 'number' || typeof b !== 'number') return ''
  const d = Math.round((b - a) * 1000) / 10
  return `通过率 ${d > 0 ? '+' : ''}${d} pt`
})
const compareDeltaTone = computed(() => {
  const a = compareRunA.value?.summary?.passRate
  const b = compareRunB.value?.summary?.passRate
  if (typeof a !== 'number' || typeof b !== 'number') return 'mk-badge--muted'
  return b > a ? 'mk-badge--ok' : b < a ? 'mk-badge--bad' : 'mk-badge--muted'
})
/** 单用例耗时差（B − A）：正=变慢红、负=变快绿；任一侧缺失不出结论 */
function deltaText(row: { aDurationMs?: number; bDurationMs?: number }): string {
  if (typeof row.aDurationMs !== 'number' || typeof row.bDurationMs !== 'number') return '—'
  const d = row.bDurationMs - row.aDurationMs
  return `${d > 0 ? '+' : ''}${d}ms`
}
function deltaClass(row: { aDurationMs?: number; bDurationMs?: number }): string {
  if (typeof row.aDurationMs !== 'number' || typeof row.bDurationMs !== 'number') return ''
  return row.bDurationMs > row.aDurationMs ? 'pe-delta--slow' : row.bDurationMs < row.aDurationMs ? 'pe-delta--fast' : ''
}

async function openCompare() {
  if (compareIds.value.length !== 2) return
  compareOpen.value = true
  compareLoading.value = true
  compareFailed.value = false
  compareRunA.value = null
  compareRunB.value = null
  try {
    const [ra, rb] = await Promise.all([
      adminPromptOpsApi.getEvalRun(compareIds.value[0]),
      adminPromptOpsApi.getEvalRun(compareIds.value[1]),
    ])
    compareRunA.value = ra.data?.data ?? ra.data ?? null
    compareRunB.value = rb.data?.data ?? rb.data ?? null
  } catch (e) {
    compareFailed.value = true
    toast.error(`加载对比失败：${errMsg(e)}`)
  } finally {
    compareLoading.value = false
  }
}
/* 切换筛选后旧的选中运行可能已不在列表里：清掉避免对比到看不见的行 */
watch(agentFilter, () => { compareIds.value = [] })

// 挂载加载统一走上方 watch 的 immediate 首跑（bootstrapped 分支），此处不再裸拉一遍

/* 宿主协作面：批量跑评估上移 Skills 宿主页头（本面板无页头），宿主经模板 ref 驱动——
   running/canRunBatch 供禁用态，runBatch 供点击（ref 上 ref 自动解包，宿主读布尔值即可） */
defineExpose({ running, canRunBatch, runBatch })
</script>

<style scoped>
/* 运行中条（#86）：卡外通栏，与 KPI 带同宽 */
.pe-running { flex: none; }
/* 筛选/工具栏行收进单卡容器：与页签体之间以发丝线分层（原型 .toolbar border-bottom） */
.pe-filter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--mk-line); }
.pe-filter__hint { color: var(--mk-faint); font-size: var(--mk-fs-micro); margin-left: auto; }

/* 跨运行对比（#94）：选择列窄 + 对比工具条 */
.pe-compare-bar { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid var(--mk-line); }
.pe-compare-col { width: 32px; }
.pe-compare-col input { accent-color: var(--mk-blue); }
.pe-compare-row--fail { background: var(--mk-red-bg); }
.pe-delta--slow { color: var(--mk-red); font-weight: 700; }
.pe-delta--fast { color: var(--mk-green); font-weight: 700; }
/* 列表高度：空态占位交给 mk-empty--min，有数据时表格自然高度（不再硬撑满屏） */
.pe-list { min-height: 0; }
/* 原型 .tbl td：nowrap（自动布局下列宽随内容；长内容由 mk-cell-main 上限与 pe-expect 截断兜底，
   不换行撑行高） */
.pe-list .mk-table td { white-space: nowrap; }
.pe-expect { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.pe-persona-missing { margin-left: 6px; }
.pe-result { display: grid; gap: 3px; justify-items: start; }
.pe-result strong { font-size: var(--mk-fs-body); font-family: var(--mk-mono); }
.pe-result span { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.pe-result__bar { display: block; width: 64px; }
.pe-result--ok .pe-result__bar i { background: var(--mk-green); }
.pe-result--warn .pe-result__bar i { background: var(--mk-amber); }
.pe-result--bad .pe-result__bar i { background: var(--mk-red-fill); }
.pe-result--ok strong { color: var(--mk-green); }
.pe-result--warn strong { color: var(--mk-amber); }
.pe-result--bad strong { color: var(--mk-red); }

.pe-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
/* mk-field 是 grid 容器，两列等高拉伸会把内部 input/select 也拉高（input 被撑到 51px 的根因）。
   顶部对齐、不拉伸，让字段保持自身自然高度 */
.pe-form-grid .mk-field { align-content: start; }
.pe-msgs { display: grid; gap: 6px; }
/* 消息行：三列统一自然高度（行高统一由下方 .pe-tab-body .mk-input 规则处理，
   不固定 height，避免 1440px+ 字号档 padding 放大后裁切 select 文字） */
.pe-msg { display: grid; grid-template-columns: 92px 1fr 30px; gap: 8px; align-items: center; }
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
  background: color-mix(in srgb, var(--mk-purple) 7%, transparent); /* 原 135deg 靛蓝渐变已退役（材质一律平面），取最近语义色 --mk-purple 平铺 */
  border: 1px solid color-mix(in srgb, var(--mk-purple) 25%, transparent);
  border-radius: var(--mk-radius-xl);
  padding: 8px 12px;
  margin-bottom: 4px;
}
.pe-guide__title { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-purple); }
.pe-guide__steps { font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.5; }
/* .mk-field__opt（字段标签内的「（可选）」次级提示）已提升为全局，见 shared.css */

/* ===== 宿主 fill 内滚（2026-10-04 折入 Skills 页签）：原独立页整页滚，折入 .mk-card--fill
   后由面板接管纵向滚动——fill 卡只给「直接子」.mk-table-scroll 授权内滚，pe-panel 不是
   直接子，须自补同一套 flex:1 + min-height:0 + overflow-y（判例 .orch-handoff .mk-table-scroll）。
   KPI 带/页签/筛选行钉在卡顶，仅页签体滚 ===== */
.pe > .pe-panel { flex: 1 1 auto; min-height: 0; overflow-y: auto; }

/* ===== 页签（主视图切换走全局 .tabs/.tab 原语；弹窗内学生输入方式走共享 MkSubTabs）。
   2026-10-06 审核收口：删除 .pe-tabs/.pe-tab 全仓最后一份 scoped 拷贝（与 mk-primitives.css
   .tabs/.tab 逐字重复且缺 transition），只保留页签体容器样式 ===== */
.pe-input-block { display: grid; gap: 10px; }
/* 页签体接在 MkSubTabs 的下划线之下：去顶边、只圆下方两角（与宿主 .tabs/.tab 同视觉） */
.pe-tab-body {
  border: 1px solid var(--mk-line);
  border-top: 0;
  border-radius: 0 0 var(--mk-radius-xl) var(--mk-radius-xl);
  padding: 12px;
  display: grid;
  gap: 10px;
  background: var(--mk-surface);
}

/* 模拟参数：一行内联（收尾条件挪进高级折叠后只剩两项） */
.pe-params { display: grid; grid-template-columns: 84px 150px; gap: 10px; align-items: end; }
.pe-param { display: grid; gap: 4px; }
.pe-param__label { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-muted); }

/* ===== select 与 input 高度统一 =====
   Chrome 原生 select 有 appearance 导致的盒模型差异（与 input 差 1-2px）。
   去掉原生外观 + 统一 line-height 后两者高度完全一致，且随各字号档同步放大不裁切。 */
.mk-field__select,
.pe-tab-body select.mk-input,
.pe-params select.mk-input {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238492ab' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 12px 12px;
  padding-right: 32px;
  line-height: 20px;
}
.mk-field__input { line-height: 20px; }
.pe-tab-body .mk-input { line-height: 20px; }

/* ===== 期望（可选，单层折叠） ===== */
.pe-expect { border-top: 1px solid var(--mk-line); padding-top: 10px; }
.pe-expect summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mk-fs-body);
  font-weight: 700;
  color: var(--mk-ink);
  user-select: none;
}
.pe-expect summary::-webkit-details-marker { display: none; }
.pe-expect summary::before { content: '▸'; font-size: var(--mk-fs-micro); color: var(--mk-faint); transition: transform .15s ease; }
.pe-expect[open] summary::before { transform: rotate(90deg); }
.pe-expect__hint { font-size: var(--mk-fs-micro); font-weight: 400; color: var(--mk-faint); }
.pe-expect > * + * { margin-top: 10px; }
/* 折叠语义恢复：内容元素的显式 display（grid 等）会覆盖 UA 的 display:none */
.pe-expect:not([open]) > *:not(summary),
.pe-adv:not([open]) > *:not(summary) { display: none !important; }

/* ===== 高级校验（期望内的二级折叠） ===== */
.pe-adv {
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-xl);
  padding: 8px 12px 12px;
  display: block;
}
.pe-adv > * + * { margin-top: 10px; }
.pe-adv summary {
  cursor: pointer;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-muted);
  padding: 4px 0;
  user-select: none;
}
.pe-adv summary:hover { color: var(--mk-purple); }
.pe-adv__hint { font-size: var(--mk-fs-micro); font-weight: 400; color: var(--mk-faint); margin-left: 6px; }

/* 模拟对话轨迹 */
.pe-transcript { display: grid; gap: 6px; margin-top: 6px; }
.pe-transcript__row { display: grid; grid-template-columns: 56px 1fr; gap: 8px; font-size: var(--mk-fs-micro); }
.pe-transcript__role { font-weight: 700; padding-top: 2px; }
.pe-transcript__role--goal { color: var(--mk-purple); }
.pe-transcript__role--learner { color: var(--mk-green); }
.pe-transcript__content { color: var(--mk-muted); line-height: 1.6; word-break: break-all; }
.pe-transcript__meta { grid-column: 2; font-size: var(--mk-fs-micro); color: var(--mk-faint); }


/* 运行详情抽屉（原型 openTurnDetail/openLearner 三段式）：头部标题 + 正文 pills/事实栅格/嵌套卡 + 常驻 foot */
.pe-detail__body { display: grid; gap: 16px; align-content: start; }
/* 首段徽章行（原型 .ovl__body 首段 pills）：通过率 / 通过数 */
.pe-detail__pills { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
/* 底部动作条（原型 .ovl__foot：上边框、右对齐、常驻滚动区外；同 gc-detail__foot 判例） */
/* 用例结果：嵌套无边框卡内的 feed 行（原型 .card box-shadow:none 内 feed，行间发丝线分隔） */
.pe-results { display: grid; }
.pe-result-row { padding: 12px 16px; display: grid; gap: 8px; }
.pe-result-row + .pe-result-row { border-top: 1px solid var(--mk-line); }
/* 未通过行：卡内只留浅红底提示，不再自绘边框/圆角（避免卡内套卡） */
.pe-result-row--fail { background: var(--mk-red-bg, #fef2f2); }
.pe-result-row__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pe-result-row__head strong { font-size: var(--mk-fs-micro); }
.pe-result-row__meta { margin-left: auto; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.pe-result-row__checks { display: flex; gap: 6px; flex-wrap: wrap; }
.pe-check { font-size: var(--mk-fs-micro); padding: 1px 8px; border-radius: var(--mk-radius-pill); font-weight: 600; }
.pe-check--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.pe-check--fail { background: var(--mk-red-bg); color: var(--mk-red); }
.pe-result-row__out {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  max-height: 96px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  border-top: 1px dashed var(--mk-line);
  padding-top: 8px;
}

@media (min-width: 2000px) {
  .pe-result-row__head strong { font-size: var(--mk-fs-body); }
  .pe-result-row__out { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .pe-result-row__head strong { font-size: var(--mk-fs-body); }
  .pe-result-row__out { font-size: var(--mk-fs-micro); }
  .pe-expect { font-size: var(--mk-fs-micro); max-width: 300px; }
}
@media (min-width: 3600px) {
  .pe-result-row__head strong { font-size: var(--mk-fs-emphasis); }
  .pe-result-row__out { font-size: var(--mk-fs-emphasis); }
  .pe-expect { font-size: var(--mk-fs-micro); max-width: 350px; }
}

/* 暗色模式（D1 补完）：Prompt 评估（此前完全缺失） */
html[data-theme='dark'] {
  /* 卡底/描边由共享 mk-card 与 --mk-* token 接管；此处只保留未通过行的浅红底 */
  .pe-result-row--fail { background: rgba(248, 113, 113, 0.08); }
  .pe-check--ok { background: rgba(74, 222, 128, 0.14); color: #6ee7a0; }
  .pe-check--fail { background: rgba(248, 113, 113, 0.14); color: #fca5a5; }
}
</style>
