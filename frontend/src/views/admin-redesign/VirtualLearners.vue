<template>
  <div class="mk-page mk-page--fill">
    <div class="mk-status" :class="samples.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ samples.length ? '虚拟学习者' : '暂无虚拟学习者' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ samples.length }} 人</span>
      <button
        v-for="opt in stateFilterOptions.filter((o) => o.key)"
        :key="opt.key"
        type="button"
        class="lc-count-link"
        :class="{ 'lc-count-link--on': stateFilter === opt.key }"
        :title="`点击筛选「${opt.label}」虚拟学习者`"
        @click="stateFilter = stateFilter === opt.key ? '' : opt.key"
      >{{ opt.label }} {{ opt.count }}</button>
      <span class="mk-status__meta" :title="'今日虚拟/测试账号的 Agent 调用数（自然日口径，与总览页真实调用互斥）'">今日调用 {{ runStats.todayCalls ?? 0 }}</span>
      <span v-if="isLive && liveVirtualsTotal > samples.length" class="mk-status__meta vl-truncated" :title="`后端共 ${liveVirtualsTotal} 人，列表仅加载前 ${samples.length} 行`">
        已截断 · 共 {{ liveVirtualsTotal }} 人
      </span>
      <span class="mk-status__meta" title="当前运行中 + 创建中会话数（含卡死）">活动会话 {{ partition.running + partition.created }}</span>
      <span class="mk-status__meta" :title="`已完成会话 / 总会话（全量口径）`">完成率 {{ runStats.completionRate }}%</span>
      <span class="mk-status__meta" :class="(runStats.systemFailureRate ?? 0) > 0 ? 'mk-status__meta--bad' : ''" :title="'系统失败会话 / 总会话（与状态条同口径）'">失败率 {{ runStats.systemFailureRate }}%</span>
      <span
        class="mk-status__meta vl-concurrency"
        :class="`is-${concurrencyTone}`"
        :title="`自动驾驶并发 ${concurrency.used}/${concurrency.limit}：同时运行的自动驾驶会话数（env AUTOPILOT_CONCURRENCY_LIMIT 可配）；满员后新启动会被拒绝，请先暂停部分会话`"
      >
        并发 {{ concurrency.used }}/{{ concurrency.limit }}<template v-if="concurrency.used >= concurrency.limit"> · 已满</template>
      </span>
      <span class="mk-status__actions">
        <button
          v-if="partition.stale > 0"
          type="button"
          class="mk-status__action"
          :disabled="reclaimBusy"
          :title="'干跑确认清单后批量标记卡死会话为失败'"
          @click="openReclaimModal()"
        >
          {{ reclaimBusy ? '回收中…' : `回收卡死（${partition.stale}）` }}
        </button>
        <button type="button" class="mk-status__action mk-status__action--primary" title="新建虚拟学习者：填写名称/目标/故事，生成后可运行实验会话" @click="openCreate">新建</button>
        <button type="button" class="mk-status__action" title="批量新建：一次创建多个虚拟学习者（表格批量填写）" @click="batchOpen = true">批量新建</button>
      </span>
    </div>

    <!-- 学习者 / 批量实验 tab 切换 -->
    <div class="mk-pills vl-tabs">
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': vlTab === 'learners' }" @click="vlTab = 'learners'">学习者</button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': vlTab === 'experiments' }" @click="vlTab = 'experiments'">批量实验</button>
    </div>

    <!-- ===== Tab2: 批量实验（嵌入 BatchExperiments 组件） ===== -->
    <BatchExperiments v-if="vlTab === 'experiments'" embedded />

    <!-- ===== Tab1: 学习者列表（默认） ===== -->
    <template v-if="vlTab === 'learners'">
    <!-- 正在运行：列出有活跃会话的虚拟学习者（折叠：默认前 8 个，展开看全部）；批量生成也在此显示 -->
    <div v-if="(runningSamples.length || pausedSamples.length || batchTask.active) && isLive" class="vl-running">
      <span class="vl-running__label">正在运行</span>
      <!-- 批量创建后台进度：创建秒回，AI 身份 + 故事后台推进 -->
      <button v-if="batchTask.active" type="button" class="vl-running__chip vl-running__chip--batch" :class="`is-${batchTask.status}`" :title="batchTaskStatusTitle" @click="batchTask.expanded = !batchTask.expanded">
        <span class="vl-running__dot" aria-hidden="true"></span>
        <template v-if="batchTask.status === 'done'">✓ 批量创建完成</template>
        <template v-else-if="batchTask.status === 'error'">✕ 批量生成有失败</template>
        <template v-else>批量生成中</template>
        <template v-if="batchTask.status === 'running'"> · 身份 {{ batchTask.total - batchTask.personaLeft }}/{{ batchTask.total }}<template v-if="batchTask.totalStories"> · 故事 {{ batchTask.storiesDone }}/{{ batchTask.totalStories }}</template></template>
      </button>
      <!-- 运行中（前 RUN_CHIPS_LIMIT 个，超出折叠） -->
      <button v-for="s in visibleRunChips" :key="s.id" type="button" class="vl-running__chip" :title="`${s.runningCount} 个会话运行中 · 点击进入会话座舱`" @click="openRunningSession(s)">
        <span class="vl-running__dot" aria-hidden="true"></span>
        {{ s.name }}<template v-if="s.currentStage"> · {{ stageLabel(s.currentStage) }}</template>
      </button>
      <!-- 已暂停：autopilot 已停（会话保留），灰色 chip 点击进画像页 -->
      <button v-for="s in visiblePausedChips" :key="`p-${s.id}`" type="button" class="vl-running__chip vl-running__chip--paused" :title="`${s.pausedCount} 个会话已暂停自动驾驶（进度保留）；点击进入画像页`" @click="openSubPage('virtual', s.id)">
        <span class="vl-running__dot" aria-hidden="true"></span>
        {{ s.name }} · 已暂停{{ s.pausedCount > 1 ? ` ${s.pausedCount}` : '' }}
      </button>
      <!-- 折叠展开/收起 -->
      <button v-if="runChipTotal > RUN_CHIPS_LIMIT" type="button" class="vl-running__more" @click="runChipsExpanded = !runChipsExpanded">
        {{ runChipsExpanded ? '收起' : `还有 ${runChipTotal - RUN_CHIPS_LIMIT} 个` }} ▾
      </button>
      <!-- 批量生成详情行（点 chip 展开）：进度 + 重试 + 关闭 -->
      <div v-if="batchTask.active && batchTask.expanded" class="mk-alert mk-alert--info vl-batch-detail" role="status">
        <span class="vl-batch-detail__text">
          创建 {{ batchTask.created }}/{{ batchTask.total }} 人
          <template v-if="batchTask.personaLeft > 0"> · 生成身份 {{ batchTask.total - batchTask.personaLeft }}/{{ batchTask.total }}</template>
          <template v-if="batchTask.totalStories"> · 生成故事 {{ batchTask.storiesDone }}/{{ batchTask.totalStories }}</template>
          <template v-if="batchTask.error"> · <span class="vl-batch-detail__err">{{ batchTask.error }}</span></template>
        </span>
        <button v-if="batchTask.status === 'error'" type="button" class="mk-btn mk-btn--sm" @click="retryBatchTask">重试失败</button>
        <button v-if="batchTask.status === 'done' || batchTask.status === 'error'" type="button" class="mk-link" @click="batchTask.active = false">✕ 关闭</button>
      </div>
    </div>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <input class="mk-filter__input" v-model="keyword" placeholder="搜索名称 / 倾向 / ID" />
        </div>
        <div class="mk-card__head-right">
          <span class="mk-card__meta">{{ filtered.length }} / {{ samples.length }} 人<template v-if="filtered.length < samples.length">（已筛选）</template> · 点击行查看画像</span>
        </div>
      </div>

      <MockSkeletonTable v-if="liveLoading && !samples.length" :cols="6" />
      <div v-else-if="filtered.length" class="mk-table-scroll">
      <table class="mk-table mk-table--click mk-table--fixed">
        <colgroup>
          <col v-if="isLive" style="width:32px">
          <col style="width:var(--mk-col-flex-min, 200px);max-width:var(--mk-col-flex-max, 840px)">
          <col style="width:var(--mk-col-model-wide, 165px)">
          <col style="width:var(--mk-col-badge, 76px)">
          <col style="width:var(--mk-col-num, 64px)">
          <col style="width:150px">
          <col style="width:var(--mk-col-num, 64px)">
          <col style="width:var(--mk-col-num, 64px)">
          <col style="width:var(--mk-col-time-full, 128px)">
          <col style="width:var(--mk-col-actions-wide, 140px)">
        </colgroup>
        <thead>
          <tr>
            <th v-if="isLive" scope="col">
              <input type="checkbox" aria-label="全选" :checked="allChecked" @change="toggleAll" />
            </th>
            <th>虚拟学习者</th>
            <th>长期倾向</th>
            <th>故事池</th>
            <th class="mk-th--right" title="累计会话数（全部会话，含终态）">会话</th>
            <th title="当前运行中/创建中的会话数及最近阶段；点击进入会话座舱">运行中</th>
            <th class="mk-th--right" title="已失败/已终止会话数（全量聚合）">失败</th>
            <th class="mk-th--right" title="超过回收阈值无写入且无活跃租约的会话数（可在状态条一键回收）">卡死</th>
            <th>创建</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in paged" :key="s.id" class="vl-row">
            <td v-if="isLive"><input v-model="selected" type="checkbox" :value="s.id" :aria-label="`选择 ${s.name}`" @click.stop /></td>
            <td>
              <div class="mk-cell-main vl-cell vl-cell--click" role="button" tabindex="0" :title="`查看 ${s.name} 的画像：故事池 / 运行记录 / 会话控制`" @click="openSubPage('virtual', s.id)" @keydown.enter="openSubPage('virtual', s.id)">
                <strong class="vl-name">
                  <span class="vl-avatar" :class="avatarClass(s)" aria-hidden="true">{{ s.name.slice(0, 1) }}</span>
                  <span class="vl-name__text">{{ s.name }}</span>
                </strong>
                <span class="mk-cell-sub">{{ shortId(s.id) }}</span>
              </div>
            </td>
            <td>
              <span class="vl-goal" :class="{ 'vl-goal--empty': !s.goal || s.goal === '—' }" :title="s.goal || undefined">{{ s.goal || '未设置' }}</span>
            </td>
            <td>
              <span class="mk-badge" :class="s.storyCount > 0 ? 'mk-badge--ok' : 'mk-badge--muted'">
                {{ s.storyCount > 0 ? `${s.storyCount} 条` : '未生成' }}
              </span>
            </td>
            <td class="mk-num">{{ s.sessions }}</td>
            <td>
              <div class="vl-state-cell">
                <template v-if="s.runningCount > 0 || (s.pausedCount ?? 0) > 0">
                  <RunStateBadge
                    :status="s.runningCount > 0 ? 'running' : 'paused'"
                    :hint="`${s.runningCount} 个会话运行中 / ${s.pausedCount ?? 0} 个已暂停 · 点击进入会话座舱`"
                    @click.stop="openRunningSession(s)"
                  />
                  <RunStageBar
                    :stage="s.currentStage"
                    :status="s.runningCount > 0 ? 'running' : 'paused'"
                    :task-progress="s.stageProgress?.learnStarted ? { done: s.stageProgress.taskDone, total: s.stageProgress.taskTotal } : null"
                    :show-task-text="false"
                  />
                </template>
                <span v-else class="vl-run vl-run--idle" title="当前没有运行中的会话">空闲</span>
              </div>
            </td>
            <td class="mk-num">
              <button
                type="button"
                class="vl-faillink mk-num"
                :class="{ 'vl-num--bad': s.failedCount > 0 }"
                :title="s.failedCount > 0 ? `${s.failedCount} 个会话已失败/已终止；点击进入画像页，可对失败会话重试（续传保留进度）` : '无失败/终止会话'"
                @click.stop="openSubPage('virtual', s.id)"
              >{{ s.failedCount }}</button>
            </td>
            <td class="mk-num">
              <span v-if="s.stalledCount > 0" class="mk-badge mk-badge--sm mk-badge--bad" :title="`${s.stalledCount} 个运行中会话已卡死（超过回收阈值无写入），可在状态条一键回收`">卡死 {{ s.stalledCount }}</span>
              <span v-else class="mk-num--na" title="无卡死会话">—</span>
            </td>
            <td class="mk-na">{{ s.created }}</td>
            <td>
              <div class="mk-actions mk-actions--left">
                <!-- live：整行点击即进入画像详情，此处只留真正的行内操作（运行 / 更多） -->
                <button
                  v-if="isLive"
                  type="button"
                  class="mk-icon-btn mk-icon-btn--text"
                  :class="{ 'mk-link--muted': s.storyCount === 0 }"
                  :title="s.storyCount === 0 ? '需先生成故事才能运行' : '运行：启动一次新的实验会话（不影响已有会话）'"
                  @click.stop="openLaunch(s)"
                ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8V4z"/></svg><span>{{ s.storyCount === 0 ? '需故事' : '运行' }}</span></button>
                <div v-if="isLive" class="mk-menu">
                  <button type="button" class="mk-menu__btn" aria-label="更多操作（删除）" aria-haspopup="menu" :aria-expanded="menuOpen" :title="'更多操作：删除（不可恢复）'" @click.stop="toggleMenu(s.id)">⋯</button>
                  <div v-if="openMenu === s.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                    <button type="button" class="mk-menu__item mk-menu__item--danger" :disabled="busyId === s.id" title="删除该虚拟学习者（级联删除，不可恢复）" @click="menuRemove(s)">删除</button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <div v-else-if="loadFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">◌</span>
        <strong>虚拟学习者加载失败</strong>
        <span>无法从后端拉取虚拟学习者列表。</span>
        <button type="button" class="mk-empty__action" @click="retryLoad">重试</button>
      </div>
      <div v-else class="mk-empty">
        <strong>{{ samples.length ? '没有匹配的虚拟学习者' : '暂无虚拟学习者' }}</strong>
        <span>新建虚拟学习者后，在画像页生成故事即可运行。</span>
        <button v-if="isFiltered && samples.length" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
      </div>
      <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片 -->
      <Pagination
        v-if="filtered.length"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </div>

    <!-- 批量操作条（全局 mk-batchbar：选中后底部浮现） -->
    <div v-if="isLive && selected.length" class="mk-batchbar">
      <span>已选 {{ selected.length }} 人</span>
      <button type="button" class="mk-link" @click="selected = []">取消选择</button>
      <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" :title="'为每个选中的虚拟学习者启动其全部故事的实验会话（一个故事一个会话）'" @click="batchLaunchAllStories">
        {{ batchActionBusy ? '处理中…' : '启动全部故事' }}
      </button>
      <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" :title="'对选中虚拟人全部故事的最新会话开启自动驾驶（不新建会话；已运行的自动跳过）'" @click="batchAutopilotStart">
        {{ batchActionBusy ? '处理中…' : '批量启动自动驾驶' }}
      </button>
      <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" :title="'停止选中虚拟人全部故事最新会话的自动驾驶（学习进度保留，可随时再启动）'" @click="batchAutopilotStop">
        {{ batchActionBusy ? '处理中…' : '批量停止自动驾驶' }}
      </button>
      <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" @click="batchTerminate">
        {{ batchActionBusy ? '处理中…' : '批量终止' }}
      </button>
      <button type="button" class="mk-batchbar__btn" :disabled="batchActionBusy" @click="batchReclaim">
        {{ batchActionBusy ? '处理中…' : '批量清理卡死' }}
      </button>
      <button type="button" class="mk-batchbar__danger" :disabled="batchActionBusy" @click="batchDelete">
        批量删除
      </button>
    </div>

    <!-- 一键回收卡死：dryRun 先展示清单再确认执行（复用 reclaim-stale dryRun 语义） -->
    <Teleport to="body">
    <div v-if="reclaimOpen" ref="reclaimMaskRef" class="mk-modal">
      <div ref="reclaimPanelRef" class="mk-modal__panel" role="dialog" :aria-label="reclaimProfileIds ? '批量清理卡死会话' : '一键回收卡死会话'">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ reclaimProfileIds ? `批量清理卡死会话（选中 ${selected.length} 人）` : '一键回收卡死会话' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="reclaimOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <p class="mk-alert mk-alert--info vl-steps">
            将把{{ reclaimProfileIds ? '选中虚拟人' : '全部' }}超过回收阈值（{{ reclaimThresholdLabel }}）无写入、且无活跃租约的会话标记为失败（failed, reason=stale）。只改状态，不删除任何数据。
          </p>
          <p v-if="reclaimLoading" class="mk-alert mk-alert--info vl-steps">正在扫描可回收会话…</p>
          <p v-else-if="!reclaimPreview.length" class="mk-alert mk-alert--ok vl-steps">没有可回收的卡死会话。</p>
          <div v-else class="vl-reclaim-list">
            <div v-for="r in reclaimPreview" :key="r.id" class="vl-reclaim-item">
              <code class="vl-reclaim-id">{{ r.id.slice(0, 14) }}…</code>
              <span class="mk-badge mk-badge--muted">{{ r.currentStage }}</span>
              <span class="vl-reclaim-stale">{{ fmtStale(r.staleMs) }}</span>
            </div>
          </div>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="reclaimOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="reclaimBusy || !reclaimPreview.length" @click="confirmReclaim">
            {{ reclaimBusy ? '回收中…' : `确认回收 ${reclaimPreview.length} 个会话` }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>

    <!-- 新建虚拟学习者 -->
    <Teleport to="body">
    <div v-if="createOpen" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="新建虚拟学习者">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">新建虚拟学习者</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <p class="mk-alert mk-alert--info vl-steps">
            ① 称呼与背景 → ② AI 补全身份（可选）→ ③ 创建 → ④ 画像页生成故事 → ⑤ 按故事运行
          </p>
          <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
            <span class="mk-field__label">称呼 / 样本名 <em class="vl-req">必填</em></span>
            <input v-model="form.name" class="mk-field__input" placeholder="例如 焦虑的转行者、自由职业写作者" />
            <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': errors.story }">
            <span class="mk-field__label">人物背景 <em class="vl-req">必填</em></span>
            <textarea
              v-model="form.story"
              class="mk-field__textarea"
              placeholder="她是谁、职业处境、性格与长期底色。这里只写稳定身份，不要写某次具体学习事件。"
            ></textarea>
            <span class="mk-field__hint">{{ form.story.length }} 字 · 建议 ≥ 40 字 · 具体学习需求在画像页用「故事」产生</span>
            <span v-if="errors.story" class="mk-field__err">{{ errors.story }}</span>
          </label>
          <div v-if="isLive" class="vl-ai-row">
            <div class="vl-sample-pills" role="radiogroup" aria-label="样本类型">
              <button
                type="button"
                class="mk-pill"
                :class="{ 'mk-pill--active': sampleType === 'general' }"
                @click="sampleType = 'general'"
              >通用</button>
              <button
                type="button"
                class="mk-pill"
                :class="{ 'mk-pill--active': sampleType === 'student' }"
                title="生成传统学生样本：学段/考试节点/学期节奏/家长与同伴环境"
                @click="sampleType = 'student'"
              >传统学生</button>
            </div>
            <button type="button" class="mk-btn mk-btn--ghost vl-ai" :disabled="personaBusy" @click="generatePersona">
              {{ personaBusy ? '生成身份中…' : '✦ AI 生成身份' }}
            </button>
            <span class="vl-ai-hint">人设 Skill · 只补稳定身份，不依赖学习目标，不写会话故事{{ sampleType === 'student' ? ' · 学生样本含考试节点与学期节奏' : '' }}</span>
          </div>
          <p v-if="personaSeed" class="mk-alert mk-alert--ok vl-persona-ok">已回填人设，可改称呼/背景后创建</p>
          <details class="vl-advanced">
            <summary>可选 · 长期学习倾向（不是某次故事的目标）</summary>
            <label class="mk-field">
              <span class="mk-field__label">长期倾向</span>
              <input
                v-model="form.aspiration"
                class="mk-field__input"
                placeholder="例如 总想补职场工具；可留空，由故事 goalSeed 定义当次需求"
              />
              <span class="mk-field__hint">写入画像备用字段；真正驱动 Path 的是故事里的学习需求</span>
            </label>
          </details>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="createOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="creating" @click="createSample">
            {{ creating ? '创建中…' : '创建虚拟学习者' }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>

    <!-- 启动实验：必须选故事（一人多故事 → 一故事一 Path） -->
    <Teleport to="body">
    <div v-if="launchTarget" ref="launchMaskRef" class="mk-modal">
      <div ref="launchPanelRef" class="mk-modal__panel" role="dialog" aria-label="启动实验">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">启动实验 · {{ launchTarget.name }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="launchTarget = null">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field">
            <span class="mk-field__label">选择故事 <em class="vl-req">必填</em></span>
            <select v-model="launchForm.storyId" class="mk-field__select" :disabled="launchStoriesLoading">
              <option disabled value="">
                {{ launchStoriesLoading ? '加载故事中…' : launchStories.length ? '请选择故事' : '暂无故事，请先在画像页生成' }}
              </option>
              <option v-for="st in launchStories" :key="st.id" :value="st.id">
                {{ st.title }}{{ st.pathId ? ' · 已有 Path' : ' · 尚无 Path' }}（运行 {{ st.runCount }}）
              </option>
            </select>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">运行模式</span>
            <select v-model="launchForm.mode" class="mk-field__select">
              <option value="assisted">辅助模拟（白盒，链路可控）</option>
              <option value="blackbox">黑盒 API（裁判评估，贴近真实）</option>
            </select>
          </label>
          <label class="mk-field">
            <span class="mk-field__label">对抗预算</span>
            <select v-model="launchForm.friction" class="mk-field__select">
              <option value="none">无摩擦</option>
              <option value="low">低</option>
              <option value="normal">正常</option>
              <option value="high">高</option>
              <option value="stress_test">压力测试</option>
            </select>
            <span class="mk-field__hint">预算越高，虚拟学习者越"难带"：分心、畏难、追问</span>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="launchTarget = null">取消</button>
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="launchBusy || !launchForm.storyId"
            @click="startLaunch"
          >
            {{ launchBusy ? '启动中…' : '按故事启动' }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>

    <!-- 批量新建虚拟学习者 -->
    <Teleport to="body">
    <div v-if="batchOpen" ref="batchMaskRef" class="mk-modal" @click.self="batchOpen = false">
      <div ref="batchPanelRef" class="mk-modal__panel" style="width: min(720px, 100%)" role="dialog" aria-label="批量新建虚拟学习者">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">批量新建虚拟学习者</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="batchOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <p class="mk-alert mk-alert--info vl-steps">设置人数与故事数，点击创建后立即返回——AI 会在后台为每人生成身份与故事，页面顶部状态条可查看进度。</p>
          <div class="vl-batch-config">
            <label class="mk-field vl-batch-config__count">
              <span class="mk-field__label">人数</span>
              <input v-model.number="batchFillCount" type="number" class="mk-field__input" min="1" max="20" />
            </label>
            <label class="mk-field vl-batch-config__stories">
              <span class="mk-field__label">每人故事数</span>
              <input v-model.number="batchStoryCount" type="number" class="mk-field__input" min="0" max="5" />
            </label>
            <label class="mk-field vl-batch-config__prefix">
              <span class="mk-field__label">名称前缀 <em class="vl-req-less">可选</em></span>
              <input v-model="batchPrefix" class="mk-field__input" placeholder="默认 虚拟学习者（自动编号 -01/-02…）" />
            </label>
          </div>
          <label class="mk-field">
            <span class="mk-field__label">想要哪类人群？ <em class="vl-req-less">可选，留空 AI 自由发挥</em></span>
            <textarea v-model="batchCohort" class="mk-field__textarea" rows="2" placeholder="例如：25-35 岁职场人，最近想系统补 Excel/数据分析；或 高三学生，备考压力大。AI 会据此为每人生成差异化身份" />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">批次备注 <em class="vl-req-less">可选</em></span>
            <input v-model="batchNote" class="mk-field__input" placeholder="这批学习者用于什么实验 / 验收，方便以后识别" />
          </label>
          <div v-if="batchError" class="mk-alert">{{ batchError }}</div>
          <button type="button" class="mk-btn mk-btn--primary mk-btn--block" :disabled="batchCreating" @click="doBatchCreate">
            {{ batchCreating ? '创建中…' : `创建 ${batchFillCount || 0} 人 × ${batchStoryCount || 0} 故事（后台生成）` }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage, intent, isLive } from './store'
import { liveVirtuals, liveCreateVirtual, liveDeleteVirtual, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg, shortId, liveVirtualsTotal, liveVirtualSessionStats, liveVirtualStaleCount, liveVirtualRunStats, liveAutopilotConcurrency } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { useSafePolling } from '@/composables/useSafePolling'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import RunStateBadge from './RunStateBadge.vue'
import RunStageBar from './RunStageBar.vue'
import BatchExperiments from './BatchExperiments.vue'

/* 学习者 / 批量实验 tab（批量实验为低频调试工具，折叠进本页） */
const vlTab = ref<'learners' | 'experiments'>('learners')

/* 头像色板：按名称哈希取色，同一人恒定同色 */
const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#64748b']
function avatarClass(s: Sample): string {
  let h = 0
  for (let i = 0; i < s.name.length; i++) h = (h * 31 + s.name.charCodeAt(i)) >>> 0
  return `vl-avatar--${h % AVATAR_COLORS.length}`
}

interface Sample {
  id: string
  name: string
  goal: string
  storyCount: number
  sessions: number
  /** 运行中会话数（live：后端全量聚合 runningCount，已扣除暂停的自动驾驶） */
  runningCount: number
  /** 已暂停自动驾驶的会话数（autopilot=stopped，会话数据保留） */
  pausedCount: number
  /** 失败/放弃会话累计数（全量聚合） */
  failedCount: number
  /** 卡死（running 超回收阈值无写入）会话数 */
  stalledCount: number
  /** 运行中会话 id（会话样本内，用于「运行中」列直达座舱） */
  runningSessionIds: string[]
  /** 已暂停会话 id（autopilot=stopped） */
  pausedSessionIds?: string[]
  /** 阶段进度（轴 B）：Goal/Path/Learn 三态 + 任务进度 */
  stageProgress?: {
    goalReady: boolean
    pathReady: boolean
    learnStarted: boolean
    taskDone: number
    taskTotal: number
  } | null
  /** 最近一个运行中会话的阶段（无运行中时回退最近会话阶段） */
  currentStage: string | null
  created: string
}

const samples = computed<Sample[]>(() =>
  liveVirtuals.value.map((v) => ({
    id: v.id,
    name: v.name,
    goal: v.goal,
    storyCount: Number(v.storyCount || 0),
    sessions: v.sessions,
    runningCount: Number(v.runningCount || 0),
    pausedCount: Number(v.pausedCount || 0),
    failedCount: Number(v.failedCount || 0),
    stalledCount: Number(v.stalledCount || 0),
    runningSessionIds: v.runningSessionIds,
    currentStage: v.currentStage || null,
    created: timeAgo(v.createdAt)
  }))
)

const keyword = ref('')
/** 状态过滤（轴 A 生命周期）：'' = 全部 / running / paused / queued / failed / created */
const stateFilter = ref('')
/** 状态过滤 chips 计数（与 samples 联动） */
const stateFilterOptions = computed(() => {
  const count = (pred: (s: Sample) => boolean) => samples.value.filter(pred).length
  return [
    { key: '', label: '全部', count: samples.value.length },
    { key: 'running', label: '运行中', count: count((s) => s.runningCount > 0) },
    { key: 'paused', label: '已暂停', count: count((s) => (s.pausedCount ?? 0) > 0) },
    { key: 'failed', label: '需关注', count: count((s) => s.failedCount > 0) },
  ]
})
/** live 虚拟人域拉取失败（且列表为空）→ 错误态；空态只在真正无数据时展示 */
const loadFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.virtuals && !liveVirtuals.value.length
)
function retryLoad() {
  void loadLiveData()
}
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  let list = samples.value
  if (q) list = list.filter((s) => `${s.name} ${s.goal} ${s.id}`.toLowerCase().includes(q))
  const sf = stateFilter.value
  if (sf === 'running') list = list.filter((s) => s.runningCount > 0)
  else if (sf === 'paused') list = list.filter((s) => s.runningCount === 0 && (s.pausedCount ?? 0) > 0)
  else if (sf === 'failed') list = list.filter((s) => s.failedCount > 0)
  // queued：预留（服务端排队实现后接入）
  return list
})

const isFiltered = computed(() => !!keyword.value.trim() || !!stateFilter.value)
function clearFilters() {
  keyword.value = ''
  stateFilter.value = ''
}

/* 长列表分批渲染：每批 15 行 */
/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
   筛选/数据变化自动回第 1 页（watch filtered） */
const page = ref(1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch(filtered, () => {
  page.value = 1
})

/* 新建：人设优先（学习需求由故事产生，不在创建时必填） */
const createOpen = ref(false)
const creating = ref(false)
const form = ref({ name: '', story: '', aspiration: '' })
const errors = ref<{ name?: string; story?: string }>({})

function openCreate() {
  form.value = { name: '', story: '', aspiration: '' }
  errors.value = {}
  personaSeed.value = null
  createOpen.value = true
}

async function createSample() {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = '请输入称呼 / 样本名'
  if (form.value.story.trim().length < 20) errors.value.story = '人物背景至少 20 字，稳定人设才有依据'
  if (Object.keys(errors.value).length) return

  creating.value = true
  try {
    const createdId = await liveCreateVirtual({
      name: form.value.name.trim(),
      goal: form.value.aspiration.trim(),
      story: form.value.story.trim(),
      personaSeed: personaSeed.value || undefined
    })
    createOpen.value = false
    if (createdId) {
      toast.success('虚拟人已创建。下一步：在画像页生成故事（产生学习需求）')
      openSubPage('virtual', createdId)
    } else {
      toast.success('虚拟人已创建，但列表刷新失败——若列表未出现，请手动刷新查看')
    }
  } catch (e) {
    toast.error(`创建失败：${errMsg(e)}`)
  } finally {
    creating.value = false
  }
}

async function removeSample(s: Sample) {
  const ok = await askConfirm({
    title: '删除虚拟学习者',
    message: `确认删除虚拟学习者「${s.name}」？\n其会话记录将一并清理，该操作不可撤销。`,
    confirmText: '删除'
  })
  if (!ok) return
  busyId.value = s.id
  try {
    await liveDeleteVirtual(s.id)
    toast.success(`「${s.name}」已删除`)
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  } finally {
    busyId.value = null
  }
}

/* AI 生成身份：skill:virtual-learner-persona-designer（只做人设，不依赖学习目标、不写故事） */
/** 正在删除的样本 id（ref 驱动 :disabled，computed map 出的普通对象上写 busy 不触发重渲染） */
const busyId = ref<string | null>(null)
const personaBusy = ref(false)
const personaSeed = ref<Record<string, unknown> | null>(null)
/** AI 生成身份的样本类型：general=自由生成 / student=传统学生（课纲/考试/学期节奏） */
const sampleType = ref<'general' | 'student'>('general')
async function generatePersona() {
  if (personaBusy.value) return
  personaBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.generatePersona({
      ...(sampleType.value === 'student' ? { sampleType: 'student' } : {}),
      existingPersonaSeed: {
        name: form.value.name.trim() || undefined,
        nameHint: form.value.name.trim() || undefined,
        notes: form.value.story.trim() || undefined,
        background: form.value.story.trim() || undefined
      }
    })
    const d = res.data?.data ?? res.data ?? {}
    const seed = (d.personaSeed || d.profile || d) as Record<string, unknown>
    if (!seed || typeof seed !== 'object') {
      toast.error('生成失败：未返回 personaSeed')
      return
    }
    personaSeed.value = seed
    const nameFromSeed = String(seed.name || seed.nameHint || seed.occupation || '').trim()
    if (nameFromSeed) form.value.name = nameFromSeed
    const background = String(seed.background || seed.corePersonality || seed.behavioralProfileSummary || '').trim()
    if (background) form.value.story = background
    toast.success('人设已回填，可改后点「创建虚拟学习者」')
  } catch (e) {
    toast.error(`生成失败：${errMsg(e)}`)
  } finally {
    personaBusy.value = false
  }
}

/* 启动实验：必须选故事（一人多故事 → 一故事一 Path） */
interface LaunchStory {
  id: string
  title: string
  runCount: number
  pathId: string | null
}
const launchTarget = ref<Sample | null>(null)
useEscape(() => createOpen.value, () => { createOpen.value = false })
useEscape(() => !!launchTarget.value, () => { launchTarget.value = null })
useEscape(() => reclaimOpen.value, () => { if (!reclaimBusy.value) reclaimOpen.value = false })

/* ===== A2 一键回收 / 批量清理卡死：dryRun 清单 → 确认 → dryRun=false 落地 ===== */
const reclaimOpen = ref(false)
const reclaimBusy = ref(false)
const reclaimLoading = ref(false)
const reclaimPreview = ref<ReclaimPreviewItem[]>([])
const reclaimProfileIds = ref<string[] | undefined>(undefined)
const reclaimThresholdLabel = '24 小时'

const { openMenu, toggleMenu, closeMenu, menuOpen, popStyle } = useRowMenu()
/** 行内 ⋯ 菜单项：先关菜单再执行 */
function menuRemove(s: Sample) {
  closeMenu()
  void removeSample(s)
}

const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
const launchPanelRef = ref<HTMLElement | null>(null)
const launchMaskRef = ref<HTMLElement | null>(null)
const reclaimPanelRef = ref<HTMLElement | null>(null)
const reclaimMaskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => createOpen.value), panelRef)
useMaskClose(maskRef, () => { createOpen.value = false })
useOverlay(computed(() => !!launchTarget.value), launchPanelRef)
useMaskClose(launchMaskRef, () => { launchTarget.value = null })
useOverlay(computed(() => reclaimOpen.value), reclaimPanelRef)
useMaskClose(reclaimMaskRef, () => { if (!reclaimBusy.value) reclaimOpen.value = false })

/* 命令面板快捷动作：直达并打开新建弹窗 */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-virtual') {
      intent.quickAction = ''
      createOpen.value = true
    }
  },
  { immediate: true }
)
const launchForm = ref({
  storyId: '',
  mode: 'assisted' as 'assisted' | 'blackbox',
  friction: 'normal' as 'none' | 'low' | 'normal' | 'high' | 'stress_test'
})
const launchBusy = ref(false)
const launchStoriesLoading = ref(false)
const launchStories = ref<LaunchStory[]>([])

async function openLaunch(s: Sample) {
  if (s.storyCount === 0 && isLive.value) {
    toast.error('请先在画像页生成故事；故事产生学习需求后才能运行')
    openSubPage('virtual', s.id)
    return
  }
  launchTarget.value = s
  launchForm.value = { storyId: '', mode: 'assisted', friction: 'normal' }
  launchStories.value = []
  launchStoriesLoading.value = true
  try {
    const res = await adminVirtualLearnersApi.getVirtualLearnerStories(s.id)
    const body = res.data?.data ?? res.data ?? {}
    const list = Array.isArray(body.stories) ? body.stories : []
    launchStories.value = list.map((st: Record<string, unknown>, index: number) => {
      const stats = (st.stats || {}) as Record<string, unknown>
      const latest = (st.latestRun || {}) as Record<string, unknown>
      const bindings = (latest.bindings || {}) as Record<string, unknown>
      return {
        id: String(st.storyId || st.id || st.key || `story-${index}`),
        title: String(st.storyTitle || st.title || `故事 ${index + 1}`),
        runCount: Number(stats.totalRuns ?? 0),
        pathId: bindings.learningPathId ? String(bindings.learningPathId) : null
      }
    })
    if (!launchStories.value.length) {
      toast.error('该虚拟人还没有故事，请先在画像页生成')
      launchTarget.value = null
      openSubPage('virtual', s.id)
      return
    }
    if (launchStories.value.length === 1) {
      launchForm.value.storyId = launchStories.value[0].id
    }
  } catch (e) {
    toast.error(`加载故事失败：${errMsg(e)}`)
    launchTarget.value = null
  } finally {
    launchStoriesLoading.value = false
  }
}

async function startLaunch() {
  const target = launchTarget.value
  if (!target || launchBusy.value) return
  if (!launchForm.value.storyId) {
    toast.error('请选择故事；每个故事对应一套学习任务（Path）')
    return
  }
  launchBusy.value = true
  try {
    const payload = {
      storyId: launchForm.value.storyId,
      frictionBudget: launchForm.value.friction
    }
    const res =
      launchForm.value.mode === 'blackbox'
        ? await adminVirtualLearnersApi.startBlackboxVirtualSession(target.id, payload)
        : await adminVirtualLearnersApi.startVirtualSession(target.id, payload)
    const session = res.data?.data ?? res.data ?? {}
    const sid = String(session.id || session.sessionId || '')
    const storyTitle = launchStories.value.find((x) => x.id === launchForm.value.storyId)?.title || '故事'
    launchTarget.value = null
    toast.success(`已按「${storyTitle}」启动：${sid.slice(0, 14)}${sid.length > 14 ? '…' : ''}`)
    openSubPage('virtual', target.id)
  } catch (e) {
    toast.error(`启动失败：${errMsg(e)}`)
  } finally {
    launchBusy.value = false
  }
}

/** 自动驾驶并发配额条数据（used/limit + 分档色调） */
const concurrency = computed(() => ({
  used: Number(liveAutopilotConcurrency.value?.used ?? 0),
  limit: Math.max(1, Number(liveAutopilotConcurrency.value?.limit ?? 5)),
}))
const concurrencyPct = computed(() => Math.min(100, Math.round((concurrency.value.used / concurrency.value.limit) * 100)))
const concurrencyTone = computed(() => {
  const pct = concurrencyPct.value
  if (pct >= 100) return 'full'
  if (pct >= 70) return 'warn'
  return 'ok'
})

/** 当前有活跃会话的虚拟学习者（"正在运行"条直接列名） */
const runningSamples = computed(() => samples.value.filter((s) => s.runningCount > 0))
/** 已暂停自动驾驶的虚拟人：无运行中会话，但有暂停会话（autopilot=stopped） */
const pausedSamples = computed(() => samples.value.filter((s) => s.runningCount === 0 && (s.pausedCount ?? 0) > 0))
/* 「正在运行」区折叠：默认显示前 RUN_CHIPS_LIMIT 个 chip，超出折叠（压缩顶部高度，表格尽早露出） */
const RUN_CHIPS_LIMIT = 4
const runChipsExpanded = ref(false)
const runChipTotal = computed(() => runningSamples.value.length + pausedSamples.value.length)
const visibleRunChips = computed(() => {
  const list = runningSamples.value
  if (runChipsExpanded.value) return list
  return list.slice(0, RUN_CHIPS_LIMIT)
})
const visiblePausedChips = computed(() => {
  const list = pausedSamples.value
  if (runChipsExpanded.value) return list
  const runningShown = visibleRunChips.value.length
  return list.slice(0, Math.max(0, RUN_CHIPS_LIMIT - runningShown))
})

/* ===== A2 生命周期分区：全量聚合口径（后端 sessionStats/staleCount），替代样本口径状态条 ===== */
const partition = computed(() => {
  const st = liveVirtualSessionStats.value
  return {
    created: st.created,
    running: st.running,
    failed: st.failed + st.abandoned,
    stale: liveVirtualStaleCount.value
  }
})

/* ===== A5 运行统计：完成率/失败率/平均时长/卡死最长分钟（GET /virtual-learners/stats） ===== */
const runStats = computed(() => liveVirtualRunStats.value)

/* 仿真概览结论已收敛到单行状态条（KPI/结论随状态条 meta 展示，双块移除） */

/* ===== A1 批量操作：复选框 + 批量条（对齐 Users.vue 模式） ===== */
const selected = ref<string[]>([])
/* batchActionBusy 声明见下方「批量新建」区（与批量删除/清理共用同一互斥标志） */
const selectable = computed(() => filtered.value)
const allChecked = computed(() => selectable.value.length > 0 && selected.value.length === selectable.value.length)

function toggleAll() {
  selected.value = allChecked.value ? [] : selectable.value.map((s) => s.id)
}

/** 批量启动全部故事：为每个选中的虚拟学习者启动其全部故事的实验会话（一个故事一个会话），
 *  并自动开启自动驾驶（target=final 直达 Path 全部完成），无需手动逐个启动 */
async function batchLaunchAllStories() {
  const ids = [...selected.value]
  if (!ids.length || batchActionBusy.value) return
  // 统计将启动的会话数（先确认，避免误操作）
  let totalStories = 0
  for (const id of ids) {
    const s = samples.value.find((x) => x.id === id)
    totalStories += Number(s?.storyCount ?? 0)
  }
  if (totalStories === 0) {
    toast.error('选中的虚拟学习者都还没有故事；请先在画像页生成故事')
    return
  }
  const ok = await askConfirm({
    title: '启动全部故事（含自动驾驶）',
    message: `将为选中的 ${ids.length} 个虚拟学习者启动其全部故事的实验会话，共约 ${totalStories} 个会话，并自动开启自动驾驶（直达 Path 全部完成）。\n注意：并发多个自动驾驶对 LLM 压力较大，建议分批（每批 1-2 人）。确认启动？`,
    confirmText: `启动 ${totalStories} 个会话`
  })
  if (!ok) return
  batchActionBusy.value = true
  let launched = 0
  let autopiloted = 0
  let failed = 0
  for (const id of ids) {
    const s = samples.value.find((x) => x.id === id)
    if (!s) continue
    try {
      // 拿该虚拟人的故事列表
      const res = await adminVirtualLearnersApi.getVirtualLearnerStories(id)
      const body = res.data?.data ?? res.data ?? {}
      const list = Array.isArray(body.stories) ? body.stories : []
      for (const st of list) {
        const storyId = String(st.storyId || st.id || st.key || '')
        if (!storyId) continue
        try {
          const sres = await adminVirtualLearnersApi.startVirtualSession(id, { storyId, frictionBudget: 'normal' })
          const session = sres.data?.data ?? sres.data ?? {}
          const sid = String(session.id || session.sessionId || '')
          if (sid) {
            launched++
            // 创建后自动开启自动驾驶（target=final：直达 Path 全部完成）
            try {
              await adminVirtualLearnersApi.autopilotStart(sid, { target: 'final' })
              autopiloted++
            } catch (e) {
              failed++
              console.error(`「${s.name}」故事 ${storyId} 自动驾驶启动失败:`, e)
            }
          }
        } catch (e) {
          failed++
          console.error(`启动「${s.name}」故事会话失败:`, e)
        }
      }
    } catch (e) {
      failed++
      console.error(`获取「${s.name}」故事列表失败:`, e)
    }
  }
  batchActionBusy.value = false
  if (launched > 0) {
    toast.success(`已启动 ${launched} 个会话并开启自动驾驶 ${autopiloted} 个（失败 ${failed}）`)
    selected.value = []
    void loadLiveData()
  } else {
    toast.error(`启动失败：${failed} 个（请检查故事是否生成）`)
  }
}

/** 批量启动自动驾驶：对选中虚拟人全部故事的最新会话开启自动驾驶（不新建会话；已运行的自动跳过） */
async function batchAutopilotStart() {
  const ids = [...selected.value]
  if (!ids.length || batchActionBusy.value) return
  // 先统计有多少个可启动的会话（有最新会话且非终态）
  let candidates = 0
  for (const id of ids) {
    try {
      const res = await adminVirtualLearnersApi.getVirtualLearnerStories(id)
      const body = res.data?.data ?? res.data ?? {}
      const list = Array.isArray(body.stories) ? body.stories : []
      candidates += list.filter((st: Record<string, unknown>) => {
        const lr = (st.latestRun || {}) as Record<string, unknown>
        const status = String(lr.status || '')
        return !!lr.sessionId && !['completed', 'abandoned'].includes(status)
      }).length
    } catch { /* 统计失败忽略 */ }
  }
  if (!candidates) {
    toast.error('选中的虚拟学习者的故事都还没有可启动的会话；请先「启动全部故事」或单个运行')
    return
  }
  const ok = await askConfirm({
    title: '批量启动自动驾驶',
    message: `将为选中的 ${ids.length} 个虚拟学习者、约 ${candidates} 个最新会话开启自动驾驶（target=final 直达 Path 全部完成）。\n已在运行自动驾驶的会话会自动跳过，不会重复启动。确认启动？`,
    confirmText: `启动 ${candidates} 个会话的自动驾驶`
  })
  if (!ok) return
  batchActionBusy.value = true
  let started = 0
  let skipped = 0
  let failed = 0
  for (const id of ids) {
    const s = samples.value.find((x) => x.id === id)
    try {
      const res = await adminVirtualLearnersApi.getVirtualLearnerStories(id)
      const body = res.data?.data ?? res.data ?? {}
      const list = Array.isArray(body.stories) ? body.stories : []
      for (const st of list) {
        const lr = (st.latestRun || {}) as Record<string, unknown>
        const sid = String(lr.sessionId || '')
        const status = String(lr.status || '')
        if (!sid || ['completed', 'abandoned'].includes(status)) { skipped++; continue }
        try {
          await adminVirtualLearnersApi.autopilotStart(sid, { target: 'final' })
          started++
        } catch (e) {
          if (String(errMsg(e)).includes('已有全自动运行')) { skipped++; continue }
          failed++
          console.error(`「${s?.name || id}」会话 ${sid.slice(0, 8)} 自动驾驶启动失败:`, e)
        }
      }
    } catch (e) {
      failed++
      console.error(`获取「${s?.name || id}」故事列表失败:`, e)
    }
  }
  batchActionBusy.value = false
  if (started > 0 || skipped > 0) {
    toast.success(`已启动自动驾驶 ${started} 个${skipped ? `（跳过 ${skipped}）` : ''}${failed ? `，失败 ${failed}` : ''}`)
    selected.value = []
    void loadLiveData()
  } else {
    toast.error(`启动失败：${failed} 个（请检查故事会话状态）`)
  }
}

/** 批量停止自动驾驶：停止选中虚拟人全部故事最新会话的自动驾驶（学习进度保留） */
async function batchAutopilotStop() {
  const ids = [...selected.value]
  if (!ids.length || batchActionBusy.value) return
  const ok = await askConfirm({
    title: '批量停止自动驾驶',
    message: `将停止选中的 ${ids.length} 个虚拟学习者全部故事最新会话的自动驾驶。\n学习进度与对话保留，可随时再次启动。确认停止？`,
    confirmText: `停止 ${ids.length} 人`
  })
  if (!ok) return
  batchActionBusy.value = true
  let stopped = 0
  let skipped = 0
  let failed = 0
  for (const id of ids) {
    const s = samples.value.find((x) => x.id === id)
    try {
      const res = await adminVirtualLearnersApi.getVirtualLearnerStories(id)
      const body = res.data?.data ?? res.data ?? {}
      const list = Array.isArray(body.stories) ? body.stories : []
      for (const st of list) {
        const lr = (st.latestRun || {}) as Record<string, unknown>
        const sid = String(lr.sessionId || '')
        const status = String(lr.status || '')
        if (!sid || ['completed', 'abandoned', 'failed'].includes(status)) { skipped++; continue }
        try {
          await adminVirtualLearnersApi.autopilotStop(sid)
          stopped++
        } catch (e) {
          failed++
          console.error(`「${s?.name || id}」会话 ${sid.slice(0, 8)} 停止失败:`, e)
        }
      }
    } catch (e) {
      failed++
      console.error(`获取「${s?.name || id}」故事列表失败:`, e)
    }
  }
  batchActionBusy.value = false
  if (stopped > 0 || skipped > 0) {
    toast.success(`已停止自动驾驶 ${stopped} 个${skipped ? `（跳过 ${skipped}）` : ''}${failed ? `，失败 ${failed}` : ''}`)
    selected.value = []
    void loadLiveData()
  } else {
    toast.error(`停止失败：${failed} 个（请检查故事会话状态）`)
  }
}

/** 批量终止：对选中虚拟人全部非终态会话（运行中/创建中）标记 abandoned；只改状态不删数据 */
async function batchTerminate() {
  const ids = [...selected.value]
  if (!ids.length || batchActionBusy.value) return
  const runningSum = ids.reduce((a, id) => {
    const s = samples.value.find((x) => x.id === id)
    return a + (s?.runningCount ?? 0) + (s?.pausedCount ?? 0)
  }, 0)
  const ok = await askConfirm({
    title: '批量终止会话',
    message: `确认终止选中的 ${ids.length} 个虚拟学习者全部非终态会话（运行中 ${runningSum} + 创建中）？\n会话将标记为已终止，数据保留，该操作不可撤销。`,
    confirmText: `终止 ${ids.length} 人`
  })
  if (!ok) return
  batchActionBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.terminateVirtualSessions({ profileIds: ids, dryRun: false })
    const d = res.data?.data ?? {}
    const terminated = Number(d.terminated ?? 0)
    const skipped = Number(d.skippedTerminal ?? 0)
    toast.success(terminated > 0 ? `已终止 ${terminated} 个会话（跳过已终态 ${skipped}）` : '没有需要终止的非终态会话')
    selected.value = []
    void loadLiveData()
  } catch (e) {
    toast.error(`批量终止失败：${errMsg(e)}`)
  } finally {
    batchActionBusy.value = false
  }
}

/** 批量清理卡死：对选中虚拟人调 reclaim-stale（dryRun 先展示清单再确认执行） */
function batchReclaim() {
  const ids = [...selected.value]
  if (!ids.length) return
  void openReclaimModal(ids)
}

/** 批量删除虚拟学习者：级联删除 profile + 全部虚拟数据，不可撤销 */
async function batchDelete() {
  const ids = [...selected.value]
  if (!ids.length || batchActionBusy.value) return
  const ok = await askConfirm({
    title: '批量删除虚拟学习者',
    message: `确认删除选中的 ${ids.length} 个虚拟学习者？\n将级联删除其全部会话、教学记录、学习数据，该操作不可撤销。`,
    confirmText: `删除 ${ids.length} 人`
  })
  if (!ok) return
  batchActionBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.batchDeleteVirtualLearners(ids)
    const d = res.data?.data ?? {}
    const deleted = (d.deleted || []).length
    const skipped = (d.skipped || []).length
    const errors = (d.errors || []).length
    if (errors > 0) {
      toast.error(`删除 ${deleted} 人，${skipped} 人跳过，${errors} 人失败`)
    } else {
      toast.success(`已删除 ${deleted} 人${skipped > 0 ? `，${skipped} 人跳过` : ''}`)
    }
    selected.value = []
    void loadLiveData()
  } catch (e) {
    toast.error(`批量删除失败：${errMsg(e)}`)
  } finally {
    batchActionBusy.value = false
  }
}

/* ===== A2 一键回收 / 批量清理卡死：dryRun 清单 → 确认 → dryRun=false 落地 ===== */
interface ReclaimPreviewItem {
  id: string
  status: string
  currentStage: string
  staleMs: number
  updatedAt: string
}

async function openReclaimModal(profileIds?: string[]) {
  reclaimProfileIds.value = profileIds?.length ? [...profileIds] : undefined
  reclaimOpen.value = true
  reclaimLoading.value = true
  reclaimBusy.value = true
  reclaimPreview.value = []
  try {
    const res = await adminVirtualLearnersApi.reclaimStaleVirtualSessions({
      dryRun: true,
      ...(reclaimProfileIds.value ? { profileIds: reclaimProfileIds.value } : {})
    })
    const d = res.data?.data ?? {}
    reclaimPreview.value = Array.isArray(d.sessions) ? (d.sessions as ReclaimPreviewItem[]) : []
  } catch (e) {
    toast.error(`扫描卡死会话失败：${errMsg(e)}`)
    reclaimOpen.value = false
  } finally {
    reclaimLoading.value = false
    reclaimBusy.value = false
  }
}

async function confirmReclaim() {
  if (!reclaimPreview.value.length || reclaimBusy.value) return
  reclaimBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.reclaimStaleVirtualSessions({
      dryRun: false,
      ...(reclaimProfileIds.value ? { profileIds: reclaimProfileIds.value } : {})
    })
    const d = res.data?.data ?? {}
    toast.success(`已回收 ${Number(d.reclaimed ?? 0)} 个卡死会话（活跃租约跳过 ${Number(d.skippedActiveLease ?? 0)}）`)
    reclaimOpen.value = false
    selected.value = []
    void loadLiveData()
  } catch (e) {
    toast.error(`回收失败：${errMsg(e)}`)
  } finally {
    reclaimBusy.value = false
  }
}

function fmtStale(ms: number) {
  const mins = Math.max(1, Math.round(ms / 60000))
  if (mins < 60) return `${mins} 分钟无写入`
  return `${(mins / 60).toFixed(1)} 小时无写入`
}

/** 「运行中」列点击直达会话座舱（画像页入口保持：行点击/画像按钮） */
function openRunningSession(s: Sample) {
  const id = s.runningSessionIds[0]
  if (id) openSubPage('session', id)
}

/** 后端 currentStage 原文（goal/path/teaching/learn/wrapup 等）→ 中文阶段名 */
function stageLabel(stage: string | null | undefined): string {
  const s = String(stage || '').toLowerCase()
  if (s.includes('goal')) return 'Goal'
  if (s.includes('path')) return 'Path'
  if (s.includes('learn') || s.includes('teach')) return 'Learn'
  if (s.includes('wrap')) return 'Wrapup'
  return s || '—'
}

/* ===================== 批量新建 ===================== */
const batchOpen = ref(false)
const batchCreating = ref(false)
const batchPrefix = ref('')
const batchFillCount = ref(3)
const batchStoryCount = ref(1)
/** 人群描述（可选）：AI 据此为每人生成差异化身份；留空自由发挥 */
const batchCohort = ref('')
/** 批次备注（可选）：写入每人的 notes 字段，便于识别 */
const batchNote = ref('')
const batchError = ref('')
const batchPanelRef = ref<HTMLElement | null>(null)
const batchMaskRef = ref<HTMLElement | null>(null)
const batchActionBusy = ref(false)
useOverlay(computed(() => batchOpen.value), batchPanelRef)
useMaskClose(batchMaskRef, () => { if (!batchCreating.value) batchOpen.value = false })

/* ===== 批量创建后台任务：创建人秒回，AI 身份 + 故事后台轮询推进（不占用窗口） ===== */
interface BatchTask {
  active: boolean
  status: 'creating' | 'running' | 'done' | 'error'
  /** 后端任务 id（服务端队列） */
  batchId: string
  total: number
  created: number
  totalStories: number
  storiesDone: number
  /** 剩余待生成身份的人数 */
  personaLeft: number
  /** 每人的队列：{ profileId, name, storyCount, needsPersona }（前端不再驱动，保留类型兼容） */
  queue: Array<{ profileId: string; name: string; storyCount: number; needsPersona: boolean }>
  /** 失败项（重试用） */
  failed: Array<{ profileId: string; name: string; storyCount: number; needsPersona: boolean }>
  error: string
  /** 当前处理索引 */
  currentIdx: number
  /** 详情行是否展开 */
  expanded: boolean
}
const batchTask = ref<BatchTask>({ active: false, status: 'creating', batchId: '', total: 0, created: 0, totalStories: 0, storiesDone: 0, personaLeft: 0, queue: [], failed: [], error: '', currentIdx: 0, expanded: false })
const batchTaskStatusTitle = computed(() => {
  const t = batchTask.value
  if (t.status === 'done') return `批量创建完成：${t.created} 人${t.totalStories ? ` · ${t.storiesDone} 个故事` : ''}`
  if (t.status === 'error') return `批量生成有失败：${t.error}（点击展开可重试）`
  return `后台生成中：身份 ${t.total - t.personaLeft}/${t.total}${t.totalStories ? ` · 故事 ${t.storiesDone}/${t.totalStories}` : ''}（点击展开详情）`
})

/** 轮询后端批量任务进度（服务端队列：刷新/切页不影响执行） */
async function batchTaskStep() {
  const task = batchTask.value
  if (!task.active || task.status !== 'running') return
  if (!task.batchId) return
  try {
    const res = await adminVirtualLearnersApi.batchCreateJob(task.batchId)
    const d = res.data?.data ?? res.data ?? {}
    if (!d || typeof d !== 'object') return
    task.total = Number(d.total ?? task.total)
    task.created = Number(d.created ?? task.created)
    task.totalStories = Number(d.totalStories ?? task.totalStories)
    task.storiesDone = Number(d.storiesDone ?? 0)
    task.personaLeft = Number(d.personaLeft ?? 0)
    const failed = Array.isArray(d.failed) ? d.failed : []
    task.failed = failed as BatchTask['failed']
    const st = String(d.status || 'running')
    if (st === 'done') {
      task.status = 'done'
      task.error = ''
      if (task.totalStories > 0) toast.success(`批量创建完成：${task.created} 人 · 生成 ${task.storiesDone} 个故事`)
      else toast.success(`批量创建完成：${task.created} 人（未生成故事）`)
    } else if (st === 'error') {
      task.status = 'error'
      task.error = String(d.error || `${failed.length} 项生成失败（可重试）`)
    }
  } catch (e) {
    console.error('批量任务轮询失败:', e)
    throw e // 让 useSafePolling 退避/断路器处理
  }
}

/** 重试失败项（后端队列重试） */
async function retryBatchTask() {
  const task = batchTask.value
  if (!task.active || task.status !== 'error') return
  if (!task.batchId) return
  try {
    await adminVirtualLearnersApi.batchCreateRetry(task.batchId)
    task.failed = []
    task.error = ''
    task.status = 'running'
    toast.info('已重试失败项')
  } catch (e) {
    toast.error(`重试失败：${errMsg(e)}`)
  }
}

async function doBatchCreate() {
  const count = Math.max(1, Math.min(20, Math.round(Number(batchFillCount.value)) || 3))
  const stories = Math.max(0, Math.min(5, Math.round(Number(batchStoryCount.value)) || 0))
  const prefix = batchPrefix.value.trim() || '虚拟学习者'
  batchError.value = ''
  batchCreating.value = true
  try {
    const rows = Array.from({ length: count }, (_, i) => ({
      name: `${prefix}-${String(i + 1).padStart(2, '0')}`,
      storyCount: stories
    }))
    const res = await adminVirtualLearnersApi.batchCreateLearners({
      rows,
      ...(batchCohort.value.trim() ? { cohort: batchCohort.value.trim() } : {}),
      ...(batchNote.value.trim() ? { note: batchNote.value.trim() } : {})
    })
    const d = res.data?.data ?? res.data ?? {}
    const batchId = String(d.batchId || '')
    const created = Number(d.created ?? 0)
    const totalStories = Number(d.totalStories ?? 0)
    batchCreating.value = false
    batchOpen.value = false
    if (!batchId || created <= 0) {
      toast.error('批量创建失败，请检查后重试')
      return
    }
    toast.success(`已创建 ${created} 个虚拟学习者，后台开始生成身份与故事（服务端队列，刷新/切页不受影响）`)
    void loadLiveData()
    batchTask.value = {
      active: true,
      status: 'running',
      batchId,
      total: created,
      created,
      totalStories,
      storiesDone: 0,
      personaLeft: created,
      queue: [],
      failed: [],
      error: '',
      currentIdx: 0,
      expanded: true
    }
    startBatchPolling()
  } catch (e) {
    batchCreating.value = false
    toast.error(`批量创建失败：${errMsg(e)}`)
  }
}

/* 批量后台任务轮询：复用 useSafePolling 范式（页面隐藏跳过、失败退避、断路器） */
const batchPolling = useSafePolling(() => batchTaskStep(), {
  interval: 2000,
  maxBackoff: 10000,
  circuitBreakerThreshold: 5,
  skipWhenHidden: true,
  immediate: true
})
function startBatchPolling() { batchPolling.start() }
</script>

<style scoped>
/* 操作列：图标+文字标签按钮 */
.mk-actions .mk-icon-btn--text {
  width: auto;
  padding: 0 5px;
  gap: 3px;
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
}
.mk-actions .mk-icon-btn--text span { font-size: var(--mk-fs-11); }
.mk-actions .mk-icon-btn--text svg { width: 13px; height: 13px; }
/* 窄屏表格：8 列在 704px 内容区会被压扁操作列，设 min-width 触发 .mk-table-scroll 横向滚动（对齐 AuditLogs 模式） */
.mk-table-scroll .mk-table { min-width: 860px; }
.mk-link--muted { opacity: 0.55; }
.vl-row { cursor: pointer; }
/* 长期倾向列：单行截断 + title（原可换行撑高行，ADMIN_COLUMN_WIDTH_AUDIT ⑤）；空值统一「未设置」降噪 */
.vl-goal {
  display: inline-block;
  max-width: var(--mk-cell-main-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.vl-goal--empty { color: var(--mk-faint); font-size: var(--mk-fs-12); }
/* 状态列：运行中胶囊 / 失败数 / 卡死徽章 分列展示（一列一语义） */
.vl-state-cell { display: flex; align-items: center; min-height: 26px; }
.vl-run {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-faint);
  white-space: nowrap;
}
/* 失败列：全量聚合数字（>0 标红，可点击直达画像页的重试入口） */
.vl-num--bad { color: var(--mk-red, #dc2626); font-weight: 800; }
.vl-faillink {
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.12s ease, background 0.12s ease;
}
.vl-faillink:hover { color: var(--mk-blue); background: #eff6ff; box-shadow: 0 0 0 3px #eff6ff; }
.mk-num--na { color: var(--mk-faint); font-weight: 600; }

/* 状态过滤 chips（一级页：与搜索同行，计数联动 samples） */
/* 页头计数锚点（对齐 LearnerCenter lc-count-link）：运行中/已暂停/需关注 可点击筛选 */
.lc-count-link {
  border: 0; background: transparent; padding: 0;
  font: inherit; font-size: var(--mk-fs-12_5); font-weight: 700;
  color: var(--mk-muted); cursor: pointer;
  border-radius: 6px;
  transition: color 0.12s ease, background 0.12s ease;
}
.lc-count-link:hover { color: var(--mk-blue); background: rgba(44, 99, 208, 0.08); padding: 2px 6px; margin: -2px -6px; }
.lc-count-link--on { color: var(--mk-blue); background: rgba(44, 99, 208, 0.12); padding: 2px 6px; margin: -2px -6px; }
.vl-state-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* 自动驾驶并发配额（状态条 meta：紧凑文字形态，满员红色警示） */
.vl-concurrency {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--mk-fs-12);
  cursor: help;
  font-weight: 700;
  color: var(--mk-muted);
}
.vl-concurrency.is-full { color: var(--mk-red, #dc2626); }
.vl-concurrency.is-warn { color: var(--mk-amber, #f59e0b); }

/* 「正在运行」折叠展开按钮 */
.vl-running__more {
  border: 1px dashed #cbd5e1;
  background: #fff;
  color: #64748b;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.12s ease;
  flex-shrink: 0;
}
.vl-running__more:hover { background: rgba(100, 116, 139, 0.08); }

/* ===== 批量新建配置区 ===== */
.vl-batch-config { display: flex; gap: 14px; align-items: flex-end; margin-bottom: 12px; flex-wrap: wrap; }
.vl-batch-config .mk-field { margin-bottom: 0; }
.vl-batch-config__count { width: 100px; }
.vl-batch-config__stories { width: 120px; }
.vl-batch-config__prefix { flex: 1; min-width: 200px; }
.vl-req-less { font-style: normal; font-weight: 400; color: var(--mk-faint, #94a3b8); font-size: var(--mk-fs-11); }
/* 批量生成 chip（并入「正在运行」区） */
.vl-running__chip--batch { border-color: rgba(59, 130, 246, 0.4); color: #1d4ed8; }
.vl-running__chip--batch .vl-running__dot { background: #3b82f6; box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); animation: vl-pulse 1.6s infinite; }
/* 已暂停自动驾驶：灰色静态（无脉冲），点击进画像页 */
.vl-running__chip--paused { border-color: rgba(148, 163, 184, 0.45); color: #64748b; }
.vl-running__chip--paused .vl-running__dot { background: #94a3b8; box-shadow: none; animation: none; }
.vl-running__chip--paused:hover { background: rgba(148, 163, 184, 0.12); }
.vl-running__chip--batch.is-running { border-color: rgba(59, 130, 246, 0.45); }
.vl-running__chip--batch.is-done { border-color: rgba(16, 185, 129, 0.4); color: #065f46; }
.vl-running__chip--batch.is-done .vl-running__dot { background: #10b981; animation: none; }
.vl-running__chip--batch.is-error { border-color: rgba(239, 68, 68, 0.45); color: #dc2626; }
.vl-running__chip--batch.is-error .vl-running__dot { background: #ef4444; animation: none; }
@keyframes vl-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); } 50% { box-shadow: 0 0 0 5px rgba(59, 130, 246, 0); } }
/* 批量生成详情行（点 chip 展开）：mk-alert 形态，此处只留弹性布局 */
.vl-batch-detail { display: flex; align-items: center; gap: 12px; margin-top: 8px; flex-basis: 100%; }
.vl-batch-detail__text { color: var(--mk-muted, #5b6577); flex: 1; }
.vl-batch-detail__err { color: var(--mk-red, #dc2626); }
/* 弹窗内步骤/结果提示：mk-alert 形态，此处只留边距 */
.vl-steps { margin: 0 0 12px; line-height: 1.6; }
.vl-truncated { color: var(--mk-amber); font-weight: 700; }

/* ===== 正在运行条：直接列名当前活跃虚拟学习者（绿点呼吸动画） ===== */
.vl-running {
  margin: 10px 0 0;
  padding: 5px 12px;
  border-radius: 10px;
  border: 1px solid rgba(16, 185, 129, 0.3);
  background: rgba(16, 185, 129, 0.06);
  display: flex;
  align-items: center;
  gap: 6px;
  /* 单行 + 横向滚动：chips 再多也不换行撑高，保持顶部紧凑 */
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
}
.vl-running::-webkit-scrollbar { height: 4px; }
.vl-running::-webkit-scrollbar-thumb { background: rgba(16, 185, 129, 0.3); border-radius: 2px; }
.vl-running__label {
  font-size: var(--mk-fs-12);
  font-weight: 800;
  color: #047857;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.vl-running__label::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5);
  animation: vl-pulse 1.6s infinite;
}
.vl-running__label--inline { padding: 3px 10px; border-radius: 999px; background: rgba(16, 185, 129, 0.12); }
.vl-running__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid rgba(16, 185, 129, 0.35);
  background: #fff;
  color: #065f46;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease;
  flex-shrink: 0;
  white-space: nowrap;
}
.vl-running__chip:hover { background: rgba(16, 185, 129, 0.1); }
.vl-running__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5);
  animation: vl-pulse 1.6s infinite;
  flex-shrink: 0;
}
@keyframes vl-pulse {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
  70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

/* 名称头像：按名字哈希取色，同一人恒定同色 */
.vl-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: var(--mk-fs-12);
  font-weight: 800;
  flex-shrink: 0;
}
.vl-avatar--0 { background: #3b82f6; }
.vl-avatar--1 { background: #8b5cf6; }
.vl-avatar--2 { background: #10b981; }
.vl-avatar--3 { background: #f59e0b; }
.vl-avatar--4 { background: #ef4444; }
.vl-avatar--5 { background: #06b6d4; }
.vl-avatar--6 { background: #ec4899; }
.vl-avatar--7 { background: #64748b; }
.vl-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* 名称列可点击进二级（整行不再监听点击，避免多选勾选时误触） */
.vl-cell--click { cursor: pointer; border-radius: 6px; transition: background 0.12s ease; }
.vl-cell--click:hover { background: rgba(44, 99, 208, 0.06); }
.vl-cell--click:focus-visible { outline: 2px solid rgba(44, 99, 208, 0.4); outline-offset: 1px; }
.vl-name__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
/* 一键回收清单 */
.vl-reclaim-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
  margin-top: 8px;
}
.vl-reclaim-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 10px;
  background: #fafbfd;
  border: 1px solid #e8ecf2;
  font-size: var(--mk-fs-12);
}
.vl-reclaim-id { font-size: var(--mk-fs-11); color: var(--mk-muted, #5b6577); }
.vl-reclaim-stale { margin-left: auto; color: var(--mk-red, #dc2626); font-weight: 700; white-space: nowrap; }
.vl-steps--ok { background: #e8f7ee; color: #1a7f4b; }
.vl-steps {
  margin: 0 0 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f4f7fc;
  color: var(--mk-muted, #5b6577);
  font-size: var(--mk-fs-12);
  line-height: 1.5;
}
.vl-req {
  font-style: normal;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: var(--mk-blue, #2c63d0);
  margin-left: 4px;
}
.vl-ai-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 2px 0 4px;
}
.vl-sample-pills {
  display: inline-flex;
  gap: 4px;
  flex: 0 0 auto;
}
.vl-ai { flex: 0 0 auto; }
.vl-ai-hint {
  margin: 0;
  font-size: var(--mk-fs-11);
  color: var(--mk-faint, #8492ab);
  line-height: 1.45;
}
.vl-persona-ok {
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: #e8f7ee;
  color: #1a7f4b;
  font-size: var(--mk-fs-12);
  font-weight: 600;
}
.vl-advanced {
  margin-top: 4px;
  border-radius: 10px;
  border: 1px solid #e8ecf2;
  background: #fafbfd;
  padding: 8px 12px;
}
.vl-advanced summary {
  cursor: pointer;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-muted, #5b6577);
  list-style: none;
}
.vl-advanced summary::-webkit-details-marker { display: none; }
.vl-advanced[open] summary { margin-bottom: 8px; }
.vl-advanced .mk-field { margin-bottom: 0; }

@media (min-width: 2000px) {
  .vl-steps { font-size: 13px; padding: 9px 12px; }
  .vl-req { font-size: 12px; }
  .vl-ai-row { gap: 12px; }
  .vl-ai-hint { font-size: 12.5px; }
  .vl-persona-ok { font-size: 14px; padding: 7px 12px; }
  .vl-advanced { padding: 10px 14px; }
  .vl-advanced summary { font-size: 14px; }
  .vl-advanced[open] summary { margin-bottom: 9px; }
  .vl-reclaim-item { font-size: 13.5px; padding: 8px 12px; }
  .vl-reclaim-id { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  .vl-steps { font-size: 15.5px; padding: 11px 14px; }
  .vl-req { font-size: 14px; }
  .vl-ai-row { gap: 14px; }
  .vl-ai-hint { font-size: 15px; }
  .vl-persona-ok { font-size: 16.5px; padding: 8px 14px; }
  .vl-advanced { padding: 12px 17px; }
  .vl-advanced summary { font-size: 16.5px; }
  .vl-advanced[open] summary { margin-bottom: 11px; }
  .vl-reclaim-item { font-size: 15.5px; padding: 9px 14px; }
  .vl-reclaim-id { font-size: 14.5px; }
}
@media (min-width: 3600px) {
  .vl-steps { font-size: 18px; padding: 13px 16px; }
  .vl-req { font-size: 16.5px; }
  .vl-ai-row { gap: 16px; }
  .vl-ai-hint { font-size: 17.5px; }
  .vl-persona-ok { font-size: 19px; padding: 9px 16px; }
  .vl-advanced { padding: 14px 20px; }
  .vl-advanced summary { font-size: 19px; }
  .vl-advanced[open] summary { margin-bottom: 13px; }
  .vl-reclaim-item { font-size: 18px; padding: 11px 16px; }
  .vl-reclaim-id { font-size: 17px; }
}

/* ================= 暗色模式（D1 补完）：虚拟学习者列表 ================= */
html[data-theme='dark'] {
  .vl-faillink:hover { background: rgba(91, 141, 239, 0.14); box-shadow: 0 0 0 3px rgba(91, 141, 239, 0.08); }
  /* 并发条 / 批量详情：已改用 var(--mk-*) token，暗色由全局 token 覆盖，不再需要页面补丁 */
  .vl-running__chip { background: #141c2b; border-color: #232f45; }
  .vl-steps--ok { background: rgba(74, 222, 128, 0.12); color: #6ee7a0; }
  /* 补漏：折叠展开按钮/回收清单/高级区/人设成功提示（硬编码浅底） */
  .vl-running__more { background: #141c2b; border-color: #2a3850; color: #8fa3bd; }
  .vl-reclaim-item,
  .vl-advanced { background: #141c2b; border-color: #232f45; }
  .vl-persona-ok { background: rgba(74, 222, 128, 0.12); color: #6ee7a0; }
}
</style>
