<template>
  <div class="detail v2-page">
    <V2Nav />

    <main class="detail__main">
      <!-- 面包屑 -->
      <div class="crumbs">
        <router-link to="/learning-paths" class="crumbs__back">‹ 路径列表</router-link>
        <span class="crumbs__sep">/</span>
        <span class="crumbs__current">{{ pathTitle || '路径详情' }}</span>
      </div>

      <!-- 加载 -->
      <div v-if="loading" class="detail__loading">
        <span class="spinner"></span>
        <p>正在加载路径详情…</p>
      </div>

      <!-- 失败 -->
      <div v-else-if="loadError" class="errorbar">
        路径详情加载失败。<button type="button" class="errorbar__retry" @click="load()">重试</button>
      </div>

      <template v-else-if="path">
        <!-- 已下线：内容治理下架。列表已不返回，旧链接/书签直达时明确表态并禁掉开课 -->
        <section v-if="pathOffline" class="genbar card genbar--muted">
          <div class="genbar__text">
            <strong>该学习路径已下线</strong>
            <p>管理员已将其下架，暂不可继续学习。如需恢复请联系管理员。</p>
          </div>
        </section>
        <!-- 生成中/失败横幅 -->
        <section v-if="lifecycle && lifecycle.phase !== 'ready'" class="genbar card" :class="`genbar--${lifecycleFailed ? 'failed' : 'working'}`">
          <template v-if="lifecycleFailed">
            <div class="genbar__text">
              <strong>{{ lifecycle.retryType === 'stage_design' ? '课程准备失败' : '路径生成失败' }}</strong>
              <!-- 保留语义对齐（paths/xiaomi/1）：后端重排/重试保留的是已完成任务与学习进度
                   （preserveCompletedTasks/preserveCoreTasks），标题与描述会被重新生成——
                   旧句「目标和已确认信息已保留」与事实不符（走查实证标题被改写）；
                   也不承诺「一般能成功」，只说状态与动作（仓库文案口径） -->
              <p>{{ lifecycle.errorMessage || '已完成的学习进度会保留，可以重试。' }}</p>
            </div>
            <button type="button" class="btn-primary" :class="{ 'btn-primary--off': retrying }" @click="doRetry">
              <span v-if="retrying" class="spinner spinner--sm"></span>
              {{ retrying ? '正在重新生成…' : (lifecycle.retryType === 'stage_design' ? '重新准备课程' : '重新生成路径') }}
            </button>
          </template>
          <template v-else>
            <span class="spinner"></span>
            <div class="genbar__text">
              <strong>{{ genProgress?.primary }}</strong>
              <p>{{ genProgress?.secondary }}</p>
            </div>
          </template>
        </section>
        <!-- 渐进式路径横幅已移除：lifecycle.progressive/designedStages/totalPathStages
           不在 GenerationLifecycleDTO（api/learning.ts:20-33）中，normalizeGenerationLifecycle
           从不产出，原分支为不可达死代码（2026-09-25 清理） -->

        <!-- 头部 Hero -->
        <section class="hero card">
          <div class="hero__main">
            <div class="hero__tags">
              <span class="badge" :class="badgeCls">{{ badgeText }}</span>
            </div>
            <h1>{{ pathTitle }}</h1>
            <p
              ref="heroDescRef"
              class="hero__desc"
              :class="{ 'hero__desc--expanded': descExpanded }"
            >{{ heroDescription }}</p>
            <button
              v-if="heroDescOverflow"
              type="button"
              class="hero__desc-toggle"
              @click="toggleHeroDesc"
            >{{ descExpanded ? '收起' : '展开全文' }}</button>
            <!-- 指标只放「环以外」的信息：总进度由右侧进度环唯一承载（去重：原「任务进度」格
                 与环的 percent 是同一比值，且每阶段卡、侧栏「还剩 N 个任务」已有计数） -->
            <div class="hero__metrics">
              <!-- 生成中/失败态：阶段与课程都还没备好，此时展示「N/N 当前阶段」「— 已备好」
                   会与横幅的「正在准备阶段任务」自相矛盾（EG24）——此态只报「准备中」，
                   两个指标待 lifecycle ready 再出；失败态由横幅承担，指标一并隐去。 -->
              <span v-if="lifecyclePreparing && !lifecycleFailed" class="metric"><b>准备中</b>课程与任务</span>
              <template v-else-if="!lifecyclePreparing">
                <span class="metric"><b>{{ currentStageNo }} / {{ stages.length || '?' }}</b>当前阶段</span>
                <span class="metric"><b>{{ lessonCount ? `${lessonCount} 节课 · 约 ${path.estimatedHours} 小时` : '—' }}</b>已备好</span>
              </template>
              <span v-if="path.deadlineText" class="metric"><b>{{ path.deadlineText }}</b>目标周期</span>
            </div>
            <div class="hero__actions">
              <button
                v-if="currentTask && canLearn"
                type="button"
                class="btn-primary"
                @click="goLearn(currentTask.id)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                {{ currentTask.status === 'in_progress' ? '继续当前任务' : '开始学习' }}
              </button>
              <button
                v-if="canLearn"
                type="button"
                class="btn-ghost"
                title="按你的情况调整路径：重学、调整剩余或让 AI 按学习情况建议"
                @click="openAdjustDialog"
              >
                调整路径
              </button>
              <button
                v-if="rollbackAvailable"
                type="button"
                class="btn-ghost"
                :disabled="rollingBack"
                title="回到最近一次调整前的安排（已学进度不倒退）"
                @click="confirmRollback"
              >
                <span v-if="rollingBack" class="spinner spinner--sm"></span>
                {{ rollingBack ? '正在回退…' : '回退上次调整' }}
              </button>
              <span v-else-if="allDone" class="btn-ghost">全部任务已完成</span>
            </div>
          </div>
          <div class="hero__ring">
            <svg viewBox="0 0 120 120" class="hero__ring-svg" aria-hidden="true">
              <circle cx="60" cy="60" r="52" fill="none" class="progress-track" stroke-width="10" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke="url(#v2ringGrad)" stroke-width="10" stroke-linecap="round"
                :stroke-dasharray="326.7" :stroke-dashoffset="326.7 * (1 - displayPercent / 100)"
                transform="rotate(-90 60 60)"
              />
              <defs>
                <linearGradient id="v2ringGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="var(--blue)" />
                  <stop offset="100%" stop-color="var(--cyan)" />
                </linearGradient>
              </defs>
            </svg>
            <div class="hero__ring-text"><b>{{ displayPercent }}%</b><small>整体进度</small></div>
          </div>
        </section>

        <div class="detail__grid">
          <!-- 主列 -->
          <div class="stages-col">
          <div class="stages">
            <section v-if="!stages.length" class="stages__empty card">
              <!-- kicker「路径准备中」+ 主行「还没有阶段与任务」已是完整结论；原第三行
                   「生成后…请稍后刷新页面查看」既复述状态、又与本页自动刷新相矛盾
                   （2026-10-29 全站副文审计） -->
              <span class="kicker">路径准备中</span>
              <strong>还没有阶段与任务</strong>
            </section>
            <section v-for="(stage, si) in stages" :key="stage.id || si" class="stage card" :class="`stage--${stageStatus(stage, si)}`">
              <button type="button" class="stage__head" :aria-expanded="openStages.includes(si)" @click="toggleStage(si)">
                <span class="stage__no" :class="`stage__no--${stageStatus(stage, si)}`">
                  <svg v-if="stageStatus(stage, si) === 'done'" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                  <template v-else>{{ stageNo(stage, si) }}</template>
                </span>
                <span class="stage__title">
                  <strong>阶段 {{ stageNo(stage, si) }} · {{ stage.title }}</strong>
                  <small>{{ stage.goal || stage.description }}</small>
                  <!-- 时间说明（2026-10-12）：生成期的诚实声明此前只追加进 description，而本行取 goal 优先
                       ⇒ 学习者永远看不到。显式提到阶段头（折叠态即可见），披露才真正到达学习者。 -->
                  <small v-if="stageCapacityNote(stage)" class="stage__capacity">{{ stageCapacityNote(stage) }}</small>
                </span>
                <span class="stage__prog">{{ stageDoneCount(stage) }} / {{ stageTasks(stage).length }}</span>
                <span class="stage__chev" :class="{ 'stage__chev--open': openStages.includes(si) }">⌄</span>
              </button>

              <div class="stage__body" :class="{ 'stage__body--open': openStages.includes(si) }">
                <div class="stage__body-inner">
                  <ul v-if="objectivesOf(stage).length" class="objectives">
                    <li v-for="(o, oi) in objectivesOf(stage)" :key="oi">{{ o }}</li>
                  </ul>
                  <!-- 阶段级「本阶段依据资料：[📄 公文种类]」整行删除（2026-11-06 二次走查）：
                       它与每个任务自己的引用签是同一批（实测阶段 1 的 2 个任务都挂同一个「公文种类」），
                       同屏读作上下复读机；引用已经挂在任务行上，阶段头再报一遍没有新增信息。 -->
                  <template v-for="task in stageTasks(stage)" :key="task.id">
                  <div
                    class="task"
                    :class="`task--${taskCls(task)}`"
                  >
                  <span class="task__icon">
                    <svg v-if="task.status === 'completed'" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                    <svg v-else-if="taskCls(task) === 'locked'" viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6-6h-1V9a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM9 9a3 3 0 0 1 6 0v2H9V9z"/></svg>
                    <i v-else></i>
                  </span>
                  <div class="task__body">
                    <strong>{{ task.title || task.displayLabel }}</strong>
                  </div>
                  <!-- 任务行（2026-11-06 二次走查·三行压两行）：左「类型 · 时长 · 资料签」、
                       右「操作按钮」同一行两端对齐。
                       资料签从独占一行的「资料：[📄 公文种类]」并进本行——它的信息维度与
                       「类型 · 时长」同级（都是这条任务的属性），单占一行纯属浪费高度。
                       时长 nowrap（bare/15）：「约 18 分钟」不拆成「约 18 分/钟」孤字行。 -->
                  <div class="task__line">
                    <span class="task__meta">
                      {{ taskKindText(task) }} · <span class="task__mins">{{ task.estimatedMinutes ? `约 ${task.estimatedMinutes} 分钟` : '—' }}</span>
                      <!-- 引用签（v-for 走 materialRefsOf：后端按 sectionId|quote 去重，
                           同一章节的不同引文会并存 → 不去重就连排三颗同名签） -->
                      <button
                        v-for="(ref, ri) in materialRefsOf(task)"
                        :key="ri"
                        type="button"
                        class="material-ref material-ref--inline"
                        :disabled="!refClickable(ref)"
                        :title="refTitle(ref)"
                        @click="openMaterialRef(ref)"
                      ><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5L14 3.5zM8 12h8v1.5H8V12zm0 4h8v1.5H8V16z"/></svg>{{ refLabel(ref) }}</button>
                    </span>
                    <div class="task__ops">
                  <button type="button" v-if="task.id === currentTask?.id && canLearn" class="task__cta" @click="goLearn(task.id)">
                    {{ task.status === 'in_progress' ? '继续学习' : '开始学习' }}
                  </button>
                  <button type="button" v-else-if="task.status === 'completed'" class="task__done-label" @click="viewFeedback(task)">查看反馈</button>
                  <span v-else-if="taskCls(task) === 'locked'" class="task__lock-label">待解锁</span>
                  <!-- 未锁且未完成的课次都得有入口（2026-11-03 真人走查根因修复）：
                       此前只给「当前任务」一颗 CTA，其余未完成课次落到不可点的「待开始」文案上——
                       一门已解锁、待开始的课在路径页没有任何进入方式。 -->
                  <button v-else-if="canLearn" type="button" class="task__cta" @click="goLearn(task.id)">
                    {{ task.status === 'in_progress' ? '继续学习' : '开始学习' }}
                  </button>
                  <span v-else class="task__todo-label">待开始</span>
                  <button
                    v-if="canEditTask(task)"
                    type="button"
                    class="task__edit"
                    :aria-expanded="editingTaskId === task.id"
                    @click="toggleTaskEditor(task.id)"
                  >{{ editingTaskId === task.id ? '收起 ▴' : '微调' }}</button>
                  </div>
                  </div>
                  <!-- #64 P-39：手动结构编辑（时长步进 / 插 / 删）。顺序权威=subtasks.order，保存后静默刷新。
                       2026-11-06 二次走查：面板从「卡片外的虚线框」收进任务卡内部
                       （同一张高亮卡、底部一条细分割线），并把三类操作拆成上下两行——
                       此前 6 个控件挤一排，红色「删除」与「插入」只隔 6px，手一抖就删错任务。 -->
                  <div v-if="editingTaskId === task.id" class="task-edit" role="group" aria-label="任务微调">
                    <!-- 第一行：时长步进器（左） + 删除（独立在右端，远离下面的插入键） -->
                    <div class="task-edit__row task-edit__row--split">
                      <span class="task-edit__field">
                        <span class="task-edit__label">预计时长</span>
                        <button
                          type="button"
                          class="task-edit__step"
                          :disabled="structuralEditBusy"
                          aria-label="缩短 10 分钟"
                          @click="changeTaskMinutes(task, -10)"
                        >−10 分</button>
                        <strong class="task-edit__minutes">{{ task.estimatedMinutes || 30 }} 分钟</strong>
                        <button
                          type="button"
                          class="task-edit__step"
                          :disabled="structuralEditBusy"
                          aria-label="延长 10 分钟"
                          @click="changeTaskMinutes(task, 10)"
                        >+10 分</button>
                      </span>
                      <button
                        v-if="task.status === 'todo'"
                        type="button"
                        class="task-edit__danger"
                        :disabled="structuralEditBusy"
                        @click="deleteTask(task)"
                      >
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8zm3 3v8h2v-8H9zm4 0v8h2v-8h-2z"/></svg>
                        删除此任务
                      </button>
                    </div>
                    <!-- 第二行：插入新任务（输入框吃满整行，插入键内嵌右端） -->
                    <div class="task-edit__insert">
                      <span class="task-edit__plus" aria-hidden="true">+</span>
                      <input
                        v-model="insertTitle"
                        class="task-edit__input"
                        maxlength="120"
                        placeholder="在此之后插入一个新任务…"
                        aria-label="插入新任务的内容"
                        @keyup.enter="insertTaskAfter(stage, task)"
                      />
                      <button
                        type="button"
                        class="task-edit__submit"
                        :disabled="structuralEditBusy || !insertTitle.trim()"
                        @click="insertTaskAfter(stage, task)"
                      >插入</button>
                    </div>
                  </div>
                  </div>
                  </template>
                </div>
              </div>
            </section>
          </div>

          </div><!-- /stages-col -->

          <!-- 侧栏（2026-09-25 收敛）：原 6 张异构卡 → 3 组
               「进行到哪」（当前任务 + 接下来合并）／「学习资料」（资料 + 原文预览合并）／
               「设计意图」（默认折叠，依据型信息）；「路径状态」空态卡删除（hero 指标已覆盖） -->
          <aside class="side">
            <!-- 「接下来」卡片整块删除（2026-11-06 走查 图1/2/3）：左栏阶段 1 展开后
                 已经把同一批任务连标题带时长列了一遍，右栏再抄一次且序号对不上
                 （复现缺第 1 条、原第 2 条被标成 1.）。分工改为——
                 左栏只管「阶段与任务」，右栏只管「学习资料」与「设计意图」。 -->

            <section v-if="pathMaterials.length" class="card sidecard">
              <span class="kicker">学习资料</span>
              <ul class="materials-list">
                <li v-for="(material, mi) in pathMaterials" :key="mi">
                  <strong>{{ material.title || '未命名资料' }}</strong>
                  <small v-if="material.sections?.length">{{ material.sections.length }} 个章节</small>
                  <ul v-if="openMaterial === mi" class="materials-sections">
                    <li v-for="(section, si) in material.sections || []" :key="si">{{ section.title }}</li>
                  </ul>
                  <button
                    v-if="material.sections?.length"
                    type="button"
                    class="materials-toggle"
                    @click="openMaterial = openMaterial === mi ? null : mi"
                  >{{ openMaterial === mi ? '收起章节' : '查看章节' }}</button>
                </li>
              </ul>
              <!-- 当前引用的资料（2026-11-06 走查 图3/4）：只讲一件事——用户点的这一条引用。
                   原来这里「原文 · 公文种类」＋「对应章节：公文种类」两行复读同一件事，
                   下面还塞了一个 280px 宽的 <pre> 全文滚动框（从整篇文档第 1 行的英文爬虫头开始
                   显示 6000 字），窄侧栏里根本读不了。
                   现在：一条引用行 + 左竖线引用块（引文本身最该被看见）+ 去大弹窗读全文的入口。 -->
              <div v-if="materialPreview.open" class="sidecard__sub">
                <p v-if="materialPreview.loading" class="materials-note">正在读取…</p>
                <template v-else>
                  <span class="sidecard__sub-head">当前引用：{{ materialPreview.sectionTitle || materialPreview.title }}</span>
                  <blockquote v-if="materialPreview.quote" class="material-quote">{{ materialPreview.quote }}</blockquote>
                  <p v-else class="materials-note">这一条没有可摘录的整句，直接看原文。</p>
                </template>
                <button type="button" class="materials-open" @click="openMaterialReader">
                  查看完整章节原文 ↗
                </button>
                <button type="button" class="materials-toggle" @click="materialPreview.open = false">收起</button>
              </div>
            </section>

            <section v-if="sceneSummary" class="card sidecard">
              <button
                type="button"
                class="sidecard__head"
                :aria-expanded="intentOpen"
                @click="intentOpen = !intentOpen"
              >
                <span class="kicker">设计意图</span>
                <span class="sidecard__chev" :class="{ 'sidecard__chev--open': intentOpen }">▾</span>
              </button>
              <div v-show="intentOpen" class="sidecard__body">
                <strong
                  v-if="sceneSummaryTitle"
                  ref="intentTitleRef"
                  class="sidecard__intent-title"
                  :class="{ 'sidecard__intent-title--expanded': intentExpanded }"
                >{{ sceneSummaryTitle }}</strong>
                <button
                  v-if="intentOverflow"
                  type="button"
                  class="sidecard__intent-toggle"
                  @click="toggleIntentTitle"
                >{{ intentExpanded ? '收起' : '展开全文' }}</button>
                <dl v-if="sceneRows.length" class="sidecard__rows">
                  <div v-for="row in sceneRows" :key="row.label" class="sidecard__row">
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.value }}</dd>
                  </div>
                </dl>
                <div v-if="sceneProblemBackground" class="sidecard__bg">
                  <button
                    type="button"
                    class="sidecard__bg-head"
                    :aria-expanded="bgExpanded"
                    @click="bgExpanded = !bgExpanded"
                  >
                    <span>问题背景</span>
                    <span class="sidecard__bg-chev" :class="{ 'sidecard__bg-chev--open': bgExpanded }">▾</span>
                  </button>
                  <p v-if="bgExpanded" class="sidecard__bg-text">{{ sceneProblemBackground }}</p>
                </div>
              </div>
            </section>

            <!-- 调整历史（replanLineage，单跳链）：本次路径来自哪次调整；旧路径无 lineage 不渲染（不出空态卡） -->
            <section v-if="lineageRows.length || lineageSourcePathId" class="card sidecard">
              <button
                type="button"
                class="sidecard__head"
                :aria-expanded="lineageOpen"
                @click="lineageOpen = !lineageOpen"
              >
                <span class="kicker">调整历史</span>
                <span class="sidecard__chev" :class="{ 'sidecard__chev--open': lineageOpen }">▾</span>
              </button>
              <div v-show="lineageOpen" class="sidecard__body">
                <dl v-if="lineageRows.length" class="sidecard__rows">
                  <div v-for="row in lineageRows" :key="row.label" class="sidecard__row">
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.value }}</dd>
                  </div>
                </dl>
                <router-link
                  v-if="lineageSourcePathId"
                  :to="`/learning-path/${lineageSourcePathId}`"
                  class="lineage-link"
                >查看调整前的路径</router-link>
                <!-- 与快照回退区（hero 的「回退上次调整」）互相指引：历史在这里看，回退在那边做 -->
                <p v-if="rollbackAvailable" class="lineage-note">每次调整前的安排都会自动留存。</p>
              </div>
            </section>
          </aside>
        </div>
      </template>
    </main>

    <!-- 调整路径弹窗：三场景（学不好重来 / 学了些调剩余 / 系统按学习情况建议） -->
    <div v-if="adjustDialogOpen" class="adjust-dialog-mask" @click.self="adjustDialogOpen = false">
      <!-- role/aria-modal + 打开移焦：含破坏性 rebuild，读屏与键盘用户要能感知弹窗边界并从弹窗内开始 Tab -->
      <div ref="adjustDialogRef" class="adjust-dialog card" role="dialog" aria-modal="true" aria-labelledby="adjustDialogTitle" tabindex="-1">
        <div class="adjust-dialog__head">
          <div>
            <h3 id="adjustDialogTitle" class="adjust-dialog__title">调整这条路径</h3>
            <p class="adjust-dialog__desc">说说你的情况和想法，选一种调整方式。已学完的内容会保留并衔接。</p>
          </div>
          <button type="button" class="adjust-dialog__close" aria-label="关闭" @click="adjustDialogOpen = false">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <!-- 挡路课堂清场视图：有未结束课堂时先处理，处理完自动重试原调整 -->
        <div v-if="blockingSessions.length" class="clear-sessions">
          <div class="clear-sessions__head">
            <span class="clear-sessions__tag">还需要一步</span>
            <p>要调整的范围内还有未结束的课堂。结束它们后我们会自动继续刚才的调整。已结束的课堂不会受影响。</p>
          </div>
          <ul class="clear-sessions__list">
            <li v-for="(s, si) in blockingSessions" :key="s.sessionId || si" class="clear-sessions__item">
              <div class="clear-sessions__item-main">
                <strong>{{ s.taskTitle || s.topic || '未命名任务' }}</strong>
                <span class="uc-badge" :class="s.status === 'paused' ? 'uc-badge--muted' : 'uc-badge--warn'">{{ sessionStatusLabel(s.status) }}</span>
              </div>
              <button
                type="button"
                class="btn-primary btn-primary--sm"
                :disabled="clearingSessions || retryingAfterClear"
                @click="clearSessionAndRetry(s)"
              >
                <span v-if="clearingSessions" class="spinner spinner--sm"></span>
                {{ retryingAfterClear ? '正在继续调整…' : '结束并继续调整' }}
              </button>
            </li>
          </ul>
          <div class="adjust-dialog__actions">
            <button type="button" class="btn-ghost" :disabled="clearingSessions || retryingAfterClear" @click="dismissBlockingSessions(); adjustMode = null">
              返回修改
            </button>
            <button
              v-if="blockingSessions.length > 1"
              type="button"
              class="btn-primary"
              :disabled="clearingSessions || retryingAfterClear"
              @click="clearAllSessionsAndRetry"
            >
              <span v-if="clearingSessions" class="spinner spinner--sm"></span>
              {{ retryingAfterClear ? '正在继续调整…' : `全部结束（${blockingSessions.length}）并继续` }}
            </button>
          </div>
          <p class="clear-sessions__hint">按「结束」会把未完成的课堂标记为放弃，不计入学习进度，对话内容仍保留在学习历史中。</p>
        </div>

        <!-- 场景选择：按 adjustmentPolicy.allowedModes 门控（禁用 + 原因），推荐场景带引导标记 -->
        <div v-else-if="!adjustMode" class="adjust-modes">
          <button
            type="button"
            class="adjust-mode"
            :class="{ 'adjust-mode--warn': hasLearningProgress }"
            :disabled="!adjustEntryAllowed('rebuild')"
            :title="adjustEntryBlockReason('rebuild') || undefined"
            @click="selectAdjustMode('rebuild')"
          >
            <span class="adjust-mode__icon" aria-hidden="true">↺</span>
            <span class="adjust-mode__body">
              <strong>学得不好，想重新来一遍<span v-if="isRecommendedEntry('rebuild')" class="adjust-mode__rec">推荐</span></strong>
              <small>整条路径按新说明重新规划，从头开始。已学部分会保留在历史记录里作参考。</small>
              <small v-if="!adjustEntryAllowed('rebuild')" class="adjust-mode__blocked">{{ adjustEntryBlockReason('rebuild') }}</small>
            </span>
            <span class="adjust-mode__arrow" aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            class="adjust-mode"
            :disabled="!adjustEntryAllowed('reshape')"
            :title="adjustEntryBlockReason('reshape') || undefined"
            @click="selectAdjustMode('reshape')"
          >
            <span class="adjust-mode__icon" aria-hidden="true">⇄</span>
            <span class="adjust-mode__body">
              <strong>学了一些，想调整剩余部分<span v-if="isRecommendedEntry('reshape')" class="adjust-mode__rec">推荐</span></strong>
              <small>已完成的阶段/任务原样保留。可只调当前阶段，或从某个未学阶段起把后面的课程一起按新说明调整。</small>
              <small v-if="!adjustEntryAllowed('reshape')" class="adjust-mode__blocked">{{ adjustEntryBlockReason('reshape') }}</small>
            </span>
            <span class="adjust-mode__arrow" aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            class="adjust-mode"
            :disabled="!adjustEntryAllowed('auto')"
            :title="adjustEntryBlockReason('auto') || undefined"
            @click="selectAdjustMode('auto')"
          >
            <span class="adjust-mode__icon" aria-hidden="true">✦</span>
            <span class="adjust-mode__body">
              <strong>让 AI 看我的学习情况来建议<span v-if="isRecommendedEntry('auto')" class="adjust-mode__rec">推荐</span></strong>
              <small>结合你的掌握度、节奏与卡点，由 AI 判断该补基础、放缓还是换路径。</small>
              <small v-if="!adjustEntryAllowed('auto')" class="adjust-mode__blocked">{{ adjustEntryBlockReason('auto') }}</small>
            </span>
            <span class="adjust-mode__arrow" aria-hidden="true">›</span>
          </button>
        </div>

        <!-- 场景说明 + 补充输入 -->
        <template v-else>
          <div class="adjust-form__mode-hint" :class="`adjust-form__mode-hint--${adjustMode}`">
            <template v-if="adjustMode === 'rebuild'">整条重建 · 从头开始学</template>
            <template v-else-if="adjustMode === 'reshape'">调整剩余部分 · 保留已学（可只调当前阶段，或从指定阶段起调整到末尾）</template>
            <template v-else>AI 学习情况诊断 · 建议调整</template>
            <span class="adjust-form__hint-group">
              <span v-if="isRecommendedEntry(adjustMode)" class="adjust-form__rec">按你的情况推荐</span>
              <button type="button" class="adjust-form__back" @click="adjustMode = null">← 换一种方式</button>
            </span>
          </div>
          <p v-if="adjustMode === 'rebuild' && hasLearningProgress" class="adjust-form__warn">
            这条路径已有学习进度。整条重建会把当前规划替换为全新版本，已完成的课堂记录仍保存在学习历史中，但新路径不会延续旧任务。
          </p>

          <!-- reshape 调整范围：仅当前阶段（老行为） / 当前及之后 / 自选起始阶段 -->
          <div v-if="adjustMode === 'reshape' && !aiAdvice && reshapeScopeUsable" class="adjust-scope">
            <p class="adjust-scope__label">调整范围</p>
            <div class="adjust-scope__opts">
              <button
                type="button"
                class="adjust-scope__opt"
                :class="{ 'is-on': adjustScope === 'next' }"
                @click="adjustScope = 'next'; adjustFromStage = null"
              >
                <strong>仅当前阶段</strong>
                <small>重排你正学到的这个阶段，后续阶段保持原计划</small>
              </button>
              <button
                type="button"
                class="adjust-scope__opt"
                :class="{ 'is-on': adjustScope === 'rest' }"
                @click="adjustScope = 'rest'; adjustFromStage = null"
              >
                <strong>当前及之后全部</strong>
                <small>从当前阶段（第 {{ firstOpenStageNo || '?' }} 阶段）起，把后面还没学的阶段一起按新说明调整</small>
              </button>
              <!-- 切到 from 即取第一个可选项：select 所见第一项而 v-model 仍为 null 时，
                   提交判空会静默降级成「仅当前阶段」，与用户所见错配 -->
              <button
                type="button"
                class="adjust-scope__opt"
                :class="{ 'is-on': adjustScope === 'from' }"
                @click="adjustScope = 'from'; adjustFromStage = adjustFromStage ?? reshapeFromOptions[0]?.stageNumber ?? null"
              >
                <strong>自选起始阶段</strong>
                <small>从你指定的某个未学阶段起调整，之前的计划保持不变</small>
              </button>
            </div>
            <div v-if="adjustScope === 'from'" class="adjust-scope__picker">
              <span>从第</span>
              <div class="adjust-scope__select">
                <MkSelect
                  v-model="adjustFromStage"
                  :options="reshapeFromStageOptions"
                  aria-label="起始阶段"
                  block
                />
              </div>
              <span>阶段起，调整到路径结束</span>
            </div>
            <p v-if="adjustScope !== 'next' && !reshapeFromOptions.length" class="adjust-form__warn">
              当前路径没有可调整的未学阶段了。
            </p>
          </div>

          <!-- AI 诊断结果：建议卡（auto 场景诊断完成后展示，确认后才执行） -->
          <div v-if="aiAdvice" class="ai-advice">
            <div class="ai-advice__head">
              <span class="ai-advice__tag">AI 诊断</span>
              <span class="ai-advice__verdict" :class="{ 'ai-advice__verdict--ok': aiAdviceSignal?.recommendation === 'keep' }">
                {{ aiRecommendationText }}
              </span>
            </div>
            <p class="ai-advice__rationale">{{ aiActionText }}</p>
            <div v-if="aiAdviceSignal?.rationale && aiAdviceSignal.recommendation !== 'keep'" class="ai-advice__detail">
              {{ aiAdviceSignal.rationale }}
            </div>
            <div v-if="aiStrugglingConcepts.length" class="ai-advice__chips">
              <span class="ai-advice__chip-label">关注卡点</span>
              <span v-for="(c, ci) in aiStrugglingConcepts" :key="ci" class="ai-advice__chip ai-advice__chip--warn">{{ c }}</span>
            </div>
            <div v-if="aiReasonLabels.length" class="ai-advice__chips">
              <span class="ai-advice__chip-label">诊断依据</span>
              <span v-for="(r, ri) in aiReasonLabels" :key="ri" class="ai-advice__chip">{{ r }}</span>
            </div>
            <div v-if="aiAdviceSignal?.priority && aiAdviceSignal.priority !== 'none'" class="ai-advice__meta">
              {{ aiPriorityText }} · {{ aiScopeText }}
            </div>
            <div class="adjust-dialog__actions ai-advice__actions">
              <button type="button" class="btn-ghost" :disabled="adjusting" @click="dismissAiAdvice">暂不调整</button>
              <button
                v-if="aiAdviceSignal?.recommendation !== 'keep'"
                type="button"
                class="btn-primary"
                :disabled="adjusting"
                @click="confirmAiAdvice"
              >
                <span v-if="adjusting" class="spinner spinner--sm"></span>
                {{ adjusting ? '正在调整…' : '采纳建议，开始调整' }}
              </button>
            </div>
          </div>

          <!-- 输入态（无建议时） -->
          <template v-else>
            <textarea
              v-model="adjustText"
              class="adjust-dialog__textarea"
              rows="4"
              maxlength="500"
              :placeholder="adjustPlaceholder"
            ></textarea>
            <div class="adjust-dialog__actions">
              <button type="button" class="btn-ghost" :disabled="adjusting" @click="adjustMode = null; adjustDialogOpen = false">取消</button>
              <button
                type="button"
                class="btn-primary"
                :class="{ 'btn-primary--off': adjusting || !adjustText.trim(), 'btn-primary--danger': adjustMode === 'rebuild' && hasLearningProgress }"
                :disabled="adjusting"
                @click="submitAdjust"
              >
                <span v-if="adjusting" class="spinner spinner--sm"></span>
                {{ adjusting ? (adjustMode === 'auto' ? '正在诊断…' : '正在提交…') : adjustConfirmText }}
              </button>
            </div>
            <p v-if="!adjustText.trim() && !adjusting" class="adjust-form__hint">先写几句想怎么调整，再点{{ adjustConfirmText }}。</p>
            <!-- 回退保障句跟随真实能力（paths/iphone/2）：AI 重排会留存快照 → 承诺成立并给
                 就地入口（此前入口只挂 hero，审计全 UI 搜索不到「回退」）；无快照（如仅做过
                 手动微调的旧路径）不再凭空承诺 -->
            <p class="adjust-form__hint adjust-form__hint--safety">
              <template v-if="rollbackAvailable">调整前的安排已留存，可随时一键回退。</template>
              <template v-else>调整前的安排会自动留存，调整完成后可一键回退。</template>
            </p>
            <p v-if="rollbackAvailable" class="adjust-form__rollback">
              <button type="button" class="btn-ghost" :disabled="rollingBack" @click="confirmRollback">
                <span v-if="rollingBack" class="spinner spinner--sm"></span>
                {{ rollingBack ? '正在回退…' : '回退上次调整' }}
              </button>
            </p>
          </template>
        </template>
      </div>
    </div>

    <!-- 全文阅读弹窗（2026-11-06 走查 图6）：侧栏卡片里那个 280px 宽的 <pre> 滚动框换成
         这一张正经的阅读面——正文经 markdown 渲染（标题成标题、条文各自成段），
         打开即滚到用户点的那一章。 -->
    <div v-if="reader.open" class="reader" @click.self="closeMaterialReader">
      <section
        ref="readerCardRef"
        class="reader__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-title"
        tabindex="-1"
      >
        <header class="reader__head">
          <div class="reader__head-main">
            <h2 id="reader-title" class="reader__title">{{ reader.title || '资料原文' }}</h2>
            <p v-if="reader.section" class="reader__meta">已定位到：{{ reader.section }}</p>
          </div>
          <button type="button" class="reader__close" aria-label="关闭原文" @click="closeMaterialReader">×</button>
        </header>
        <div ref="readerBodyRef" class="reader__body">
          <p v-if="reader.loading" class="reader__note">正在读取原文…</p>
          <p v-else-if="reader.error" class="reader__note reader__note--error">{{ reader.error }}</p>
          <div v-else class="reader__text" v-html="reader.html"></div>
        </div>
      </section>
    </div>

    <!-- AI 生成提示 + 页脚：一起沉底 -->
    <div class="detail__foot">
      <div class="detail__ai-note">
        <AiContentNote />
      </div>
      <V2Footer />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { learningAPI } from '@/api/learning';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { toast } from '@/utils/toast';
import { readMaterial } from '@/api/materials';
import { dedupeMaterialRefs, normalizeMaterialMarkdown } from '@/utils/materialText';
import { plainMessageHtml } from '@/utils/messageMarkdown';
import { askConfirm } from '@/views/admin-redesign/useConfirm';
import { pickCurrentTask } from '@/composables/useCurrentTask';
import { buildGenerationProgress } from './learningPathProgress';
import {
  adjustEntryAllowedByPolicy,
  adjustPolicyBlockReason,
  getReplanActionText,
  getReplanPriorityText,
  getReplanRecommendationText,
  getReplanReasonCodeLabels,
  getReplanScopeText,
  recommendedAdjustEntry,
  replanModeForRecommendation,
  type LearnerAdjustEntry,
  type PathAdjustmentPolicyLike,
} from '@/utils/replanSignal';
import V2Nav from './V2Nav.vue';
import V2Footer from './V2Footer.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import MkSelect from '@/components/mk/MkSelect.vue';
import { retryOnceOnTransient } from '@/utils/retry';

/* 调整闭环里的失败/清理提示多处复用，收成单源避免改一处漏一处 */
const ADJUST_FAIL_MSG = '调整失败，请稍后再试';
const LESSON_END_FAIL_MSG = '结束课堂失败，请稍后再试';
const LESSON_CLEANED_MSG = '课堂已清理，正在重新提交调整…';

const route = useRoute();
const router = useRouter();
const pathId = ref(String(route.params.id || ''));

const path = ref<Record<string, any> | null>(null);
const lifecycle = ref<Record<string, any> | null>(null);
/* 生成条副行的「最近一次进展 X 前」需要一个会走的时钟：#112 剩余半——阶段数满后原本文案
   会停 4 分钟，加心跳年龄后用户能看出进程还活着。每次轮询（5s）推进一次，不额外起定时器。 */
const genNowTick = ref(Date.now());
const genProgress = computed(() =>
  lifecycle.value ? buildGenerationProgress(lifecycle.value, genNowTick.value) : null
);
const loading = ref(true);
const loadError = ref(false);
const retrying = ref(false);
const openStages = ref<number[]>([]);

const pathTitle = computed(() => path.value?.title || path.value?.name || '');

/* ---------- 长文本折叠：Hero 描述 / 设计意图标题（默认 line-clamp，溢出才给「展开全文」） ---------- */
function isClampedOverflow(el: HTMLElement | null): boolean {
  if (!el) return false;
  return el.scrollHeight > el.clientHeight + 1;
}

/* Hero 描述：优先 AI 摘要，老数据无 summary 时兜底原文 */
const pathMaterials = computed<any[]>(() => {
  const list = path.value?.materials;
  return Array.isArray(list) ? list : [];
});
const refLabel = (ref: any): string => {
  // 联网引用（materialId=null）：亮出处域名，而不是哑禁用
  if (!ref?.materialId) {
    const domain = webRefDomain(String(ref?.sourceUrl || ''));
    return domain ? `网络资料：${domain}` : '网络资料';
  }
  const label = String(ref?.sectionTitle || ref?.quote || '').trim();
  return label.length > 18 ? `${label.slice(0, 18)}…` : (label || '资料');
};

/** 联网引用按钮是否可点：本地附件点开看章节原文；联网资料跳原文链接；都没有才禁用。 */
const refClickable = (ref: any): boolean => !!(ref?.materialId || ref?.sourceUrl);

const refTitle = (ref: any): string => {
  if (ref?.materialId) return '查看原文';
  if (ref?.sourceUrl) return String(ref.sourceUrl);
  return String(ref?.quote || '网络资料');
};

function webRefDomain(url: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const materialPreview = ref<{
  open: boolean; loading: boolean; title: string; sectionTitle: string; quote: string;
}>({ open: false, loading: false, title: '', sectionTitle: '', quote: '' });

/**
 * 同一章节会被后端切成多个文本切片（实测「公文种类」在同一条任务下挂 3 个），
 * 直接遍历 materialRefs 会连排三颗同名引用。去重规则见 dedupeMaterialRefs
 * （按章节身份，不按引文）——2026-11-06 走查 图1/2/3 的实测根因。
 */
const materialRefsOf = (node: any): any[] => dedupeMaterialRefs(node?.materialRefs);

/**
 * 「点开查看引用」：只把用户点的那一条摆出来（章节名 + 精引文），不再在侧栏里
 * 拉全文——全文由 openMaterialReader 打开阅读弹窗（2026-11-06 走查 图3/4）。
 * 联网资料（materialId=null）没有可读原文，直接开外链。
 */
const openMaterialRef = (ref: any) => {
  if (!ref?.materialId) {
    const url = String(ref?.sourceUrl || '');
    if (url) window.open(url, '_blank', 'noopener');
    return;
  }
  activeMaterialRef.value = ref;
  materialPreview.value = {
    open: true,
    loading: false,
    title: String(ref.sectionTitle || '资料原文'),
    sectionTitle: String(ref.sectionTitle || ''),
    quote: String(ref.quote || ''),
  };
};

/* ---------- 全文阅读弹窗（2026-11-06 走查 图6） ---------- */
const activeMaterialRef = ref<any>(null);
const reader = ref<{ open: boolean; loading: boolean; title: string; section: string; html: string; error: string }>({
  open: false, loading: false, title: '', section: '', html: '', error: '',
});
const readerCardRef = ref<HTMLElement | null>(null);
const readerBodyRef = ref<HTMLElement | null>(null);

function closeMaterialReader() {
  reader.value = { open: false, loading: false, title: '', section: '', html: '', error: '' };
}

/** 打开全文并滚到当前引用那一章：先按章节标题找标题节点，找不到再退回按引文首句定位 */
async function openMaterialReader() {
  const ref = activeMaterialRef.value;
  const materialId = ref?.materialId ? String(ref.materialId) : '';
  reader.value = {
    open: true,
    loading: !!materialId,
    title: String(ref?.sectionTitle || '资料原文'),
    section: String(ref?.sectionTitle || ''),
    html: '',
    error: materialId ? '' : '这份资料没有可读取的原文，请点引用直接打开来源页。',
  };
  await nextTick();
  readerCardRef.value?.focus();
  if (!materialId) return;
  try {
    const material = await readMaterial(materialId);
    const normalized = normalizeMaterialMarkdown(material?.markdown || '');
    reader.value.html = normalized ? plainMessageHtml(normalized) : '';
    if (!reader.value.html) reader.value.error = '（正文为空）';
  } catch (error) {
    reader.value.error = `读取失败：${String((error as { message?: string })?.message || error)}`;
  } finally {
    reader.value.loading = false;
  }
  await nextTick();
  scrollReaderToSection();
}

function scrollReaderToSection() {
  const body = readerBodyRef.value;
  if (!body) return;
  const wanted = String(reader.value.section || '').replace(/\s+/g, '');
  if (!wanted) return;
  const nodes = Array.from(body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,p,li'));
  const hit = nodes.find((el) => (el.textContent || '').replace(/\s+/g, '').includes(wanted));
  if (hit) hit.scrollIntoView({ block: 'start', behavior: 'auto' });
}

function onReaderKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMaterialReader();
}
watch(() => reader.value.open, (open) => {
  if (open) window.addEventListener('keydown', onReaderKey);
  else window.removeEventListener('keydown', onReaderKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onReaderKey));

const openMaterial = ref<number | null>(null);
const heroDescription = computed(() => String(path.value?.summary || path.value?.description || '').trim());
const descExpanded = ref(false);
const heroDescOverflow = ref(false);
const heroDescRef = ref<HTMLElement | null>(null);

function measureHeroDesc() {
  heroDescOverflow.value = !descExpanded.value && isClampedOverflow(heroDescRef.value);
}

function toggleHeroDesc() {
  descExpanded.value = !descExpanded.value;
  if (!descExpanded.value) nextTick(measureHeroDesc);
}

/* 设计意图标题：后端 title 取 problemSpace.realProblem（问题原文，可达数百字） */
const intentExpanded = ref(false);
const intentOverflow = ref(false);
const intentTitleRef = ref<HTMLElement | null>(null);

function measureIntentTitle() {
  intentOverflow.value = !intentExpanded.value && isClampedOverflow(intentTitleRef.value);
}

function toggleIntentTitle() {
  intentExpanded.value = !intentExpanded.value;
  if (!intentExpanded.value) nextTick(measureIntentTitle);
}

/** 一次测量所有折叠文本（首帧 / 静默刷新 / 窗口尺寸变化共用） */
function measureClampedText() {
  measureHeroDesc();
  measureIntentTitle();
}

watch(heroDescription, () => {
  descExpanded.value = false;
  nextTick(measureClampedText);
});

async function load(silent = false) {
  if (!silent) loading.value = true;
  loadError.value = false;
  try {
    // 启动/重启窗口内的 5xx 会自己好（走查 N3）：静默重试一次再报错
    const p = await retryOnceOnTransient(() => learningAPI.getPathDetail(pathId.value)) as unknown as Record<string, any>;
    path.value = p;
    genNowTick.value = Date.now();
    lifecycle.value = p.generationLifecycle ?? null;
    if (p.generationLifecycle && p.generationLifecycle.phase !== 'ready') {
      if (p.generationLifecycle.status === 'processing' || p.generationLifecycle.status === 'queued') {
        schedulePoll();
      }
    }
    // 默认展开：第一个未完成的阶段 + 当前阶段
    const idx = stages.value.findIndex((s) => stageStatusRaw(s) !== 'done');
    openStages.value = idx >= 0 ? [...new Set([Math.max(0, idx - 1), idx])] : stages.value.map((_, i) => i);
    // 回退可用性：有重排快照才显示「回退上次调整」（静默，失败不拦截页面）
    void refreshRollbackAvailability();
    // 学习状态页调控卡「查看建议」直达（2026-09-27）：?adjust=ai 打开调整弹窗的 AI 诊断场景，
    // 用完即清，避免刷新时再次弹出。策略禁用 auto 时不直落诊断步，留在场景选择页看原因。
    if (route.query.adjust === 'ai') {
      adjustDialogOpen.value = true;
      adjustMode.value = adjustEntryAllowed('auto') ? 'auto' : null;
      void router.replace({ query: { ...route.query, adjust: undefined } }).catch(() => {});
    }
    nextTick(measureClampedText);
  } catch {
    if (!silent) loadError.value = true;
  } finally {
    loading.value = false;
  }
}

// 同一路由组件在 /learning-path/a → /learning-path/b 间复用时重新加载
watch(
  () => route.params.id,
  (next) => {
    if (typeof next === 'string' && next !== pathId.value) {
      pathId.value = next;
      openStages.value = [];
      load();
    }
  }
);

const lifecycleFailed = computed(() => lifecycle.value && (lifecycle.value.status === 'failed' || lifecycle.value.status === 'stale'));
/** 生成中（phase 未到 ready）：阶段/课程尚未备好，hero 指标与横幅口径需对齐（EG24） */
const lifecyclePreparing = computed(() => !!lifecycle.value && lifecycle.value.phase !== 'ready');
/* 已下线：管理员在内容治理里下架了这条路径。学习端列表已不再返回，
   但旧链接/书签仍可能直达详情，这里明确表态并禁掉开课（后端也会拒绝）。 */
const pathOffline = computed(() => path.value?.status === 'archived');
const canLearn = computed(() => !pathOffline.value && (!lifecycle.value || lifecycle.value.phase === 'ready'));

// ---- 重排回退（R8 选项 B：调整前安排自动留存，一键回退） ----
const rollbackAvailable = ref(false);
const rollingBack = ref(false);

async function refreshRollbackAvailability() {
  try {
    const snaps = await learningAPI.listPathReplanSnapshots(pathId.value);
    rollbackAvailable.value = Array.isArray(snaps) && snaps.length > 0;
  } catch {
    rollbackAvailable.value = false;
  }
}

async function confirmRollback() {
  if (rollingBack.value) return;
  // 与全站一致：走设计内的确认弹层（焦点管理/Esc/busy 防重），不用原生 window.confirm
  const ok = await askConfirm({
    title: '回退本次调整',
    message: '回退到最近一次调整前的安排？已开始的课堂进度不会被倒退，重排后新增的任务会被移除。',
    confirmText: '回退'
  });
  if (!ok) return;
  rollingBack.value = true;
  try {
    const r = await learningAPI.rollbackPathReplan(pathId.value);
    const warn = Array.isArray(r?.warnings) && r.warnings.length ? `（${r.warnings.join('；')}）` : '';
    toast.success(`已回退到 ${new Date(r.snapshotCreatedAt).toLocaleString('zh-CN',{hour12:false})} 的安排${warn}`);
    rollbackAvailable.value = false;
    await load(true);
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || '回退失败，请稍后再试';
    toast.error(msg);
  } finally {
    rollingBack.value = false;
  }
}

/* ---------- 调整历史（replanLineage） ----------
   后端只投影上一跳（sourcePathId/replanMode/triggerSource[/reason]），非链状 → 单条行展示；
   旧路径无 lineage（null/全空）时整卡不渲染，不出空态卡。 */
const lineageOpen = ref(false);
const lineage = computed(() => (path.value?.replanLineage ?? null) as Record<string, any> | null);
const REPLAN_MODE_LABELS: Record<string, string> = {
  overwrite: '覆盖原路径（在原路径上重排）',
  new_version: '新版本路径',
};
const REPLAN_TRIGGER_LABELS: Record<string, string> = {
  'goal-conversation': '目标对话',
  'learner-model-agent': '学习者模型建议',
  'ai-teaching': 'AI 教学建议',
  'learner-model': '学习者模型建议',
  admin: '管理员',
  system: '系统',
  api: '页面操作',
  learn: '学习侧',
  'path-reviewer': '系统自动评审',
};
const lineageRows = computed(() => {
  const ln = lineage.value;
  if (!ln) return [];
  const rows: Array<{ label: string; value: string }> = [];
  const mode = typeof ln.replanMode === 'string' && ln.replanMode ? (REPLAN_MODE_LABELS[ln.replanMode] || ln.replanMode) : '';
  if (mode) rows.push({ label: '调整方式', value: mode });
  const trigger = typeof ln.triggerSource === 'string' && ln.triggerSource ? (REPLAN_TRIGGER_LABELS[ln.triggerSource] || ln.triggerSource) : '';
  if (trigger) rows.push({ label: '触发来源', value: trigger });
  const reason = typeof ln.reason === 'string' ? ln.reason.trim() : '';
  if (reason) rows.push({ label: '调整原因', value: reason.length > 60 ? `${reason.slice(0, 60)}…` : reason });
  return rows;
});
/** 覆盖式重建（overwrite）的 sourcePathId 就是当前路径自身，自指时不出「查看来源」链接 */
const lineageSourcePathId = computed(() => {
  const src = typeof lineage.value?.sourcePathId === 'string' ? String(lineage.value.sourcePathId) : '';
  return src && src !== path.value?.id ? src : '';
});

/* ---------- 生成轮询 ---------- */
let pollTimer = 0;
/** 状态查询连续失败计数：超过阈值熔断，停止空转轮询（对齐列表页断路器） */
let pollFailCount = 0;
function schedulePoll() {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(pollOnce, 5000);
}
async function pollOnce() {
  try {
    const lc = await learningAPI.getPathGenerationStatus(pathId.value) as unknown as Record<string, any>;
    pollFailCount = 0;
    if (lc.phase === 'ready' || lc.status === 'failed' || lc.status === 'stale') {
      // 生成完成/失败：静默刷新详情，避免整页 loading 闪烁
      await load(true);
      return;
    }
    genNowTick.value = Date.now();
    lifecycle.value = lc;
  } catch {
    // 静默失败不该无限轮询：连续 6 次失败说明状态接口异常，熔断并交还用户手动刷新
    pollFailCount += 1;
    if (pollFailCount >= 6) {
      toast.error('生成状态查询失败，已停止自动刷新，请稍后手动刷新页面');
      return;
    }
  }
  schedulePoll();
}

async function doRetry() {
  if (retrying.value || !lifecycle.value) return;
  retrying.value = true;
  try {
    if (lifecycle.value.retryType === 'stage_design') {
      await learningAPI.retryPathEnrichment(pathId.value);
    } else {
      await learningAPI.retryPathGeneration(pathId.value);
    }
    lifecycle.value = { ...lifecycle.value, status: 'processing' };
    schedulePoll();
  } catch {
    toast.error('重新生成失败，请稍后再试');
  } finally {
    retrying.value = false;
  }
}

/* ---------- 调整路径（三场景） ---------- */
type AdjustMode = 'rebuild' | 'reshape' | 'auto' | null;

/** 调整策略门控：后端随路径下发 adjustmentPolicy（旧路径无此字段 = 不限制，全放行）。
    口径照抄后端动作语义：rebuild/auto 落 replan，reshape 落 expand/compress（详见 replanSignal.ts）。 */
const adjustPolicy = computed(() => (path.value?.adjustmentPolicy ?? null) as PathAdjustmentPolicyLike | null);
const recommendedEntry = computed(() => recommendedAdjustEntry(adjustPolicy.value));

function adjustEntryAllowed(entry: LearnerAdjustEntry): boolean {
  return adjustEntryAllowedByPolicy(adjustPolicy.value, entry);
}
/** 禁用原因（一行副文案 + title tooltip）；未禁用返回空串 */
function adjustEntryBlockReason(entry: LearnerAdjustEntry): string {
  return adjustPolicyBlockReason(adjustPolicy.value, entry);
}
/** 策略推荐入口（含放行校验）：弹窗默认选中 + 场景卡「推荐」引导标记 */
function isRecommendedEntry(entry: LearnerAdjustEntry | null): boolean {
  return !!entry && recommendedEntry.value === entry && adjustEntryAllowed(entry);
}

const adjustDialogOpen = ref(false);
const adjustDialogRef = ref<HTMLElement | null>(null);
/* Esc 关闭调整弹窗（批18）：此前只能点遮罩/关闭钮 */
function onAdjustDialogKey(e: KeyboardEvent) {
  if (e.key === 'Escape') adjustDialogOpen.value = false;
}
watch(adjustDialogOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', onAdjustDialogKey);
    // 打开即移焦到弹窗：否则焦点仍留在页底「调整路径」按钮上，Tab 会先穿过整页内容
    nextTick(() => adjustDialogRef.value?.focus());
  } else window.removeEventListener('keydown', onAdjustDialogKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onAdjustDialogKey));
const adjustText = ref('');
const adjusting = ref(false);
const adjustMode = ref<AdjustMode>(null);
/** reshape 调整范围：'next'（仅当前活动阶段，默认/老行为）| 'rest'（当前及之后所有未学阶段）| 'from'（自选起始阶段） */
const adjustScope = ref<'next' | 'rest' | 'from'>('next');
/** reshape 自选起始阶段（stageNumber，仅 adjustScope='from' 时使用） */
const adjustFromStage = ref<number | null>(null);
/** 409 拦截：调整范围内未结束课堂清单（来自后端 details.sessions），非空时展示清场视图 */
const blockingSessions = ref<Array<Record<string, any>>>([]);
/** 清场中（逐 session 放弃收尾） */
const clearingSessions = ref(false);
/** 本次已放弃的课堂 id（清场后自动重试时透传后端，放行其记录被重排覆盖） */
const clearedSessionIds = ref<string[]>([]);
/** 上次因课堂拦截而未完成的调整意图（收尾成功后自动重试） */
const pendingAdjustRetry = ref<(() => Promise<void>) | null>(null);
/** 清场成功后重试中 */
const retryingAfterClear = ref(false);
/** AI 诊断结果（auto 场景）：非空时展示「建议卡」，用户确认后才执行调整 */
const aiAdvice = ref<{
  signal: Record<string, any> | null;
  projection: Record<string, any> | null;
  reason: string;
  stageNumber: number | null;
} | null>(null);

/** 是否有学习进度（completed / in_progress 任务）——用于整建警示与后端放行判断 */
const hasLearningProgress = computed(() => allTasks.value.some((t) => t.status === 'completed' || t.status === 'in_progress'));

/** 可被选为「从该阶段起调整」的未学阶段（status 非 completed，且不含进行中任务） */
const reshapeFromOptions = computed(() => stages.value
  .filter((s) => {
    const tasks = stageTasks(s);
    return !tasks.every((t) => t.status === 'completed')
      && !tasks.some((t) => t.status === 'in_progress');
  })
  .map((s) => ({ stageNumber: stageNo(s, 0), title: s.title || s.name || `第 ${stageNo(s, 0)} 阶段` })));

/** MkSelect 选项：label 与原 option 文案逐字一致，value 保留 stageNumber（number，不做字符串化） */
const reshapeFromStageOptions = computed<ReadonlyArray<{ value: number | null; label: string }>>(() =>
  reshapeFromOptions.value.map((opt) => ({
    value: opt.stageNumber,
    label: `${opt.stageNumber} 阶段${opt.title ? ` · ${opt.title}` : ''}`,
  }))
);

/** 第一个未完成阶段号（用作「从当前起」默认选项） */
const firstOpenStageNo = computed(() => {
  const idx = stages.value.findIndex((s) => stageStatusRaw(s) !== 'done');
  return idx >= 0 ? stageNo(stages.value[idx], idx) : null;
});

/** reshape 范围选择是否可用（需至少存在一个未学阶段，且该阶段无进行中任务） */
const reshapeScopeUsable = computed(() => stages.value.some((s) => {
  const tasks = stageTasks(s);
  return !tasks.every((t) => t.status === 'completed') && !tasks.some((t) => t.status === 'in_progress');
}));

const adjustPlaceholder = computed(() => {
  if (adjustMode.value === 'rebuild') return '例如：之前选的太偏理论，我其实更需要实操。这次想从真实项目入手重新规划……';
  if (adjustMode.value === 'reshape') return '例如：第二阶段太难了，先补一下基础再进入。或者从第 3 阶段起换成更多实操……';
  if (adjustMode.value === 'auto') return '例如：最近学得有点吃力，卡点主要在 X。帮我看看接下来怎么调整更合适……';
  return '说说你想怎么调整……';
});

const adjustConfirmText = computed(() => {
  if (adjustMode.value === 'rebuild') return hasLearningProgress.value ? '确认整条重建' : '确认重新规划';
  if (adjustMode.value === 'reshape') return '确认调整剩余部分';
  if (adjustMode.value === 'auto') return '让 AI 诊断并建议';
  return '确认';
});

function selectAdjustMode(mode: NonNullable<AdjustMode>) {
  if (!adjustEntryAllowed(mode)) return; // 策略禁用的入口不响应（按钮已 disabled，这里兜底键盘/程序调用）
  adjustMode.value = mode;
  adjustText.value = '';
  aiAdvice.value = null;
  adjustScope.value = 'next';
  adjustFromStage.value = null;
  blockingSessions.value = [];
  pendingAdjustRetry.value = null;
  clearedSessionIds.value = [];
}

function openAdjustDialog() {
  adjustMode.value = null;
  adjustText.value = '';
  aiAdvice.value = null;
  adjustScope.value = 'next';
  adjustFromStage.value = null;
  blockingSessions.value = [];
  pendingAdjustRetry.value = null;
  clearedSessionIds.value = [];
  // 回退可用性打开时刷新（paths/iphone/2）：面板内的「回退上次调整」入口与
  // 保障句都要跟随最新快照状态，不吃页面加载时的旧值
  void refreshRollbackAvailability();
  // recommendedMode 默认选中：直接落到推荐场景的填写步（场景选择页仍可「换一种方式」改选）
  const rec = recommendedEntry.value;
  if (rec && adjustEntryAllowed(rec)) adjustMode.value = rec;
  adjustDialogOpen.value = true;
}

/** 实际执行一次调整（mode 已定）；供「提交」与「课堂清场后自动重试」共用 */
async function runAdjustIntent(mode: NonNullable<AdjustMode>, t: string, fromStageNumber?: number, clearedIds: string[] = []) {
  const cleared = clearedIds.length > 0 ? clearedIds : undefined;
  let res: { message?: string; data?: any };
  if (mode === 'rebuild') {
    // 整条重建：显式声明覆盖当前规划（有进度时后端放行 replace-path）
    res = await learningAPI.regeneratePath(pathId.value, t, { mode: 'rebuild-all', ...(cleared ? { clearedSessionIds: cleared } : {}) }) as unknown as { message?: string; data?: any };
    adjustDialogOpen.value = false;
    toast.success(res?.message || '正在按你的说明整条重建路径');
    schedulePoll();
    setTimeout(() => { load(true); }, 1500);
  } else if (mode === 'reshape') {
    // 调整剩余：保留已完成，重设计后续
    //   scope='next' → 仅当前活动阶段（老行为）
    //   scope='rest'/'from' → 从某未学阶段起重排到末尾（多阶段）
    res = await learningAPI.regeneratePath(pathId.value, t, { fromStageNumber, ...(cleared ? { clearedSessionIds: cleared } : {}) }) as unknown as { message?: string; data?: any };
    adjustDialogOpen.value = false;
    const status = res?.data?.status;
    if (fromStageNumber) {
      // 多阶段重排：后台执行，前端轮询 lifecycle 直到 ready
      toast.success(res?.message || `正在从第 ${fromStageNumber} 阶段起调整剩余部分`);
      schedulePoll();
      setTimeout(() => { load(true); }, 1500);
    } else if (status === 'redesigned-stage') {
      toast.success(res?.message || '已按你的说明调整后续阶段');
      setTimeout(() => { load(true); }, 1500);
    } else if (status === 'awaiting-confirmation') {
      toast.info('调整方案已生成，需确认后生效');
    } else {
      toast.success(res?.message || '正在按你的说明重新规划');
      schedulePoll();
      setTimeout(() => { load(true); }, 1500);
    }
  } else {
    // 系统按学习情况诊断：先只诊断不执行（previewOnly），把建议展示给用户，确认后再调 confirmAiAdvice 执行
    const result = await learningAPI.requestPathReplan(pathId.value, {
      mode: 'overwrite',
      reason: t,
      triggerSource: 'system',
      previewOnly: true,
    }) as unknown as { message?: string; data?: any; status?: string; signal?: any; request?: any };
    const data = (result as any)?.data ?? result;
    if (data?.status === 'awaiting-confirmation' || data?.signal) {
      // 诊断完成：展示 AI 建议卡，等用户确认
      aiAdvice.value = {
        signal: data?.signal ?? data?.request?.evidence?.replanSignal ?? null,
        projection: data?.request?.evidence?.learnerReplanProjection ?? null,
        reason: data?.request?.reason || t,
        stageNumber: data?.request?.stageNumber ?? null,
      };
    } else if (data?.status === 'no-signal') {
      aiAdvice.value = {
        signal: { shouldSuggest: false, recommendation: 'keep', rationale: data?.request?.reason || '当前无需调整路径。' },
        projection: null,
        reason: data?.request?.reason || t,
        stageNumber: null,
      };
    } else if (data?.status === 'redesigned-stage') {
      // 非 preview 执行结果（兜底）
      adjustDialogOpen.value = false;
      toast.success('已结合学习情况调整后续安排');
      setTimeout(() => { load(true); }, 1500);
    } else {
      aiAdvice.value = {
        signal: { shouldSuggest: false, recommendation: 'keep' },
        projection: null,
        reason: t,
        stageNumber: null,
      };
    }
  }
}

/** 409 拦截统一处理（submitAdjust / confirmAiAdvice 两入口共用）：调整范围内有未结束课堂 →
    弹窗内列出，供一键放弃后自动重试原调整；返回是否命中 */
function handleSessionConflict(err: any, retry: () => Promise<void>): boolean {
  const code = err?.response?.data?.error?.code;
  const sessions = err?.response?.data?.error?.details?.sessions;
  if (err?.response?.status === 409 && code === 'PATH_MUTATION_HAS_OPEN_SESSION' && Array.isArray(sessions) && sessions.length > 0) {
    clearedSessionIds.value = [];
    blockingSessions.value = sessions;
    pendingAdjustRetry.value = retry;
    toast.info(`还有 ${sessions.length} 个未结束课堂，结束它们即可继续调整`);
    return true;
  }
  return false;
}

async function submitAdjust() {
  const t = adjustText.value.trim();
  const mode = adjustMode.value;
  if (!mode) return;
  if (!t) {
    // 不再用 disabled 挡：可点但给明确提示，避免「点了没反应」的困惑
    toast.info('先写几句想怎么调整，再点确认。');
    return;
  }
  if (adjusting.value) return;
  adjusting.value = true;
  /* 409 重试闭包在 catch 里也引用起点，故声明提到 try 外（const 在 try 内对 catch 不可见） */
  let fromStageNumber: number | undefined;
  try {
    fromStageNumber = mode === 'reshape'
      ? (adjustScope.value === 'rest' && firstOpenStageNo.value
        ? firstOpenStageNo.value
        : (adjustScope.value === 'from' && adjustFromStage.value
          ? adjustFromStage.value
          : undefined))
      : undefined;
    pendingAdjustRetry.value = () => runAdjustIntent(mode, t, fromStageNumber, clearedSessionIds.value);
    await runAdjustIntent(mode, t, fromStageNumber);
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || err?.message || ADJUST_FAIL_MSG;
    // 409：调整范围内有未结束课堂 → 弹窗内列出，供一键放弃后自动重试
    if (handleSessionConflict(err, () => runAdjustIntent(mode, t, fromStageNumber, clearedSessionIds.value))) {
      adjusting.value = false;
      return;
    }
    toast.error(msg);
    // 冲突类错误（有未结束课堂等）保持弹窗打开，用户可改文案或方式
    if (err?.response?.status !== 409) {
      adjustMode.value = null;
    }
  } finally {
    adjusting.value = false;
  }
}

/** 记录本次清场已放弃的课堂 id（透传后端放行记录覆盖） */
function recordClearedSessions(res: any) {
  const cleared = res?.data?.cleared;
  if (Array.isArray(cleared) && cleared.length) {
    const ids = cleared.map((c: any) => c.sessionId).filter(Boolean);
    clearedSessionIds.value = [...new Set([...clearedSessionIds.value, ...ids])];
  }
}

/** 一键收尾单个挡路课堂（放弃）并自动重试调整 */
async function clearSessionAndRetry(session: Record<string, any>) {
  if (clearingSessions.value || retryingAfterClear.value) return;
  clearingSessions.value = true;
  try {
    const sessionId = session?.sessionId;
    const res = await learningAPI.abandonOpenSessions(pathId.value, { sessionIds: sessionId ? [sessionId] : undefined }) as any;
    recordClearedSessions(res);
    if (res?.success !== false) {
      toast.success(res?.message || '已结束该课堂');
    } else {
      toast.error(res?.error?.message || LESSON_END_FAIL_MSG);
    }
    // 重新拉取仍挡路的课堂
    const leftover = (res?.data?.remaining) || [];
    if (leftover.length === 0) {
      blockingSessions.value = [];
      if (pendingAdjustRetry.value) {
        retryingAfterClear.value = true;
        toast.info(LESSON_CLEANED_MSG);
        await pendingAdjustRetry.value();
      }
    } else {
      blockingSessions.value = leftover;
    }
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || err?.message || LESSON_END_FAIL_MSG);
  } finally {
    clearingSessions.value = false;
    retryingAfterClear.value = false;
  }
}

/** 一键收尾全部挡路课堂（放弃）并自动重试调整 */
async function clearAllSessionsAndRetry() {
  if (clearingSessions.value || retryingAfterClear.value) return;
  if (!pendingAdjustRetry.value) return;
  clearingSessions.value = true;
  try {
    const res = await learningAPI.abandonOpenSessions(pathId.value) as any;
    recordClearedSessions(res);
    if (res?.success !== false) {
      toast.success(res?.message || '已结束未完成课堂');
    }
    const leftover = (res?.data?.remaining) || [];
    if (leftover.length === 0) {
      blockingSessions.value = [];
      retryingAfterClear.value = true;
      toast.info(LESSON_CLEANED_MSG);
      await pendingAdjustRetry.value();
    } else {
      blockingSessions.value = leftover;
      toast.error(`还有 ${leftover.length} 个课堂未能结束，请稍后重试`);
    }
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || err?.message || LESSON_END_FAIL_MSG);
  } finally {
    clearingSessions.value = false;
    retryingAfterClear.value = false;
  }
}

const statusLabelMap: Record<string, string> = {
  active: '进行中',
  paused: '已暂停',
  initializing: '准备中',
  finalizing: '收尾中',
  timeout: '已超时',
};

function sessionStatusLabel(status?: string) {
  return statusLabelMap[status || ''] || status || '未结束';
}

function dismissBlockingSessions() {
  blockingSessions.value = [];
  pendingAdjustRetry.value = null;
  clearedSessionIds.value = [];
}

/** AI 建议展示所需派生文案（signal → 中文解释） */
const aiAdviceSignal = computed(() => aiAdvice.value?.signal || null);
const aiRecommendationText = computed(() => getReplanRecommendationText(aiAdviceSignal.value?.recommendation));
const aiActionText = computed(() => getReplanActionText(aiAdviceSignal.value));
const aiPriorityText = computed(() => getReplanPriorityText(aiAdviceSignal.value?.priority));
const aiScopeText = computed(() => getReplanScopeText(aiAdviceSignal.value?.scope));
const aiReasonLabels = computed(() => getReplanReasonCodeLabels(aiAdviceSignal.value?.reasonCodes || []));
const aiStrugglingConcepts = computed(() => {
  const proj = aiAdvice.value?.projection as Record<string, any> | null;
  return proj?.mastery?.strugglingConcepts || proj?.adjustmentEvidence?.strugglingConcepts || [];
});

/** 采纳 AI 建议：携带诊断 reason 真正执行 replan */
async function confirmAiAdvice() {
  if (!aiAdvice.value || adjusting.value) return;
  adjusting.value = true;
  try {
    const result = await learningAPI.requestPathReplan(pathId.value, {
      mode: replanModeForRecommendation(aiAdvice.value.signal?.recommendation),
      reason: aiAdvice.value.reason,
      triggerSource: 'system',
      requireConfirmation: false,
      ...(aiAdvice.value.stageNumber ? { stageNumber: aiAdvice.value.stageNumber } : {}),
    }) as unknown as { message?: string; data?: any };
    const data = (result as any)?.data ?? result;
    adjustDialogOpen.value = false;
    aiAdvice.value = null;
    if (data?.status === 'redesigned-stage') {
      toast.success('已按 AI 建议调整后续安排');
      setTimeout(() => { load(true); }, 1500);
    } else if (data?.enabled === false && data?.status === 'awaiting-confirmation') {
      toast.info('诊断状态已变化，请重试');
    } else {
      toast.success('已按 AI 建议调整');
      schedulePoll();
      setTimeout(() => { load(true); }, 1500);
    }
  } catch (err: any) {
    // 与 submitAdjust 对齐：409 课堂拦截复用「清场 → 自动重试」闭环（重试时 aiAdvice 仍在，原诊断 reason 原样再执行）
    if (handleSessionConflict(err, () => confirmAiAdvice())) {
      adjusting.value = false;
      return;
    }
    toast.error(err?.response?.data?.error?.message || err?.message || ADJUST_FAIL_MSG);
  } finally {
    adjusting.value = false;
  }
}

/** 关闭诊断建议视图（返回填写态或关闭弹窗） */
function dismissAiAdvice() {
  aiAdvice.value = null;
  adjustMode.value = null;
  adjustDialogOpen.value = false;
}

/* ---------- 阶段/任务 ---------- */
const stages = computed<Array<Record<string, any>>>(() => {
  const list = path.value?.milestones || path.value?.weeks || [];
  return [...list].sort((a, b) => (a.stageNumber ?? a.weekNumber ?? 0) - (b.stageNumber ?? b.weekNumber ?? 0));
});

function stageTasks(stage: Record<string, any>) {
  return (stage.subtasks || stage.tasks || []) as Array<Record<string, any>>;
}

/* ---------- 手动结构编辑（#64 P-39） ---------- */
const editingTaskId = ref<string | null>(null);
const insertTitle = ref('');
const structuralEditBusy = ref(false);

/** 只允许进行中的路径与未完成、已解锁的任务微调（已完成任务冻结，避免改写结算口径）。 */
function canEditTask(task: Record<string, any>) {
  return path.value?.status === 'active'
    && task.status !== 'completed'
    && taskCls(task) !== 'locked';
}

function toggleTaskEditor(taskId: string) {
  editingTaskId.value = editingTaskId.value === taskId ? null : taskId;
  insertTitle.value = '';
}

async function runStructuralEdit(
  payload: Parameters<typeof learningAPI.applyStructuralEdit>[1],
  successMessage: string,
) {
  if (structuralEditBusy.value) return;
  structuralEditBusy.value = true;
  try {
    await learningAPI.applyStructuralEdit(pathId.value, payload);
    toast.success(successMessage);
    editingTaskId.value = null;
    insertTitle.value = '';
    await load(true);
  } catch (error: any) {
    const code = error?.response?.data?.error?.code;
    const message = error?.response?.data?.error?.message || '调整失败，请稍后再试';
    toast.error(
      code === 'PATH_MUTATION_HAS_OPEN_SESSION'
        ? '这节课还没结束，先结束课堂再调整任务。'
        : message,
    );
  } finally {
    structuralEditBusy.value = false;
  }
}

function changeTaskMinutes(task: Record<string, any>, delta: number) {
  void runStructuralEdit(
    { op: delta > 0 ? 'extend_task' : 'shrink_task', taskId: task.id, deltaMinutes: Math.abs(delta) },
    delta > 0 ? '已延长任务' : '已缩短任务',
  );
}

function insertTaskAfter(stage: Record<string, any>, task: Record<string, any>) {
  const title = insertTitle.value.trim();
  if (!title) return;
  void runStructuralEdit(
    {
      op: 'insert_task',
      milestoneId: String(task.milestoneId || stage.id || ''),
      afterTaskId: task.id,
      title,
    },
    '已插入任务',
  );
}

async function deleteTask(task: Record<string, any>) {
  const confirmed = await askConfirm({
    title: '删除这个任务？',
    message: `「${task.title || task.displayLabel || '该任务'}」会从本阶段移除，顺序自动重排。只允许删除尚未开始的任务。`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) return;
  void runStructuralEdit({ op: 'delete_task', taskId: task.id }, '已删除任务');
}

/**
 * 已备好的课数（2026-09-29 口径修正）。
 * 平台职责是「组课 + 保持就绪」，用户自定真实学习时间；所以这里呈现**已组好的课**，
 * 不写「预计你要投入多少」——后者读起来像承诺，也把「这一轮覆盖什么」说成了「学完所需」。
 */
const lessonCount = computed(() => stages.value.reduce((n, s) => n + stageTasks(s).length, 0));

function stageNo(stage: Record<string, any>, si: number) {
  return stage.stageNumber ?? stage.weekNumber ?? si + 1;
}

function stageDoneCount(stage: Record<string, any>) {
  return stageTasks(stage).filter((t) => t.status === 'completed').length;
}

function stageStatusRaw(stage: Record<string, any>) {
  const tasks = stageTasks(stage);
  if (tasks.length && tasks.every((t) => t.status === 'completed')) return 'done';
  return 'open';
}

function stageStatus(stage: Record<string, any>, si: number) {
  if (stageStatusRaw(stage) === 'done') return 'done';
  const firstOpen = stages.value.findIndex((s) => stageStatusRaw(s) !== 'done');
  return si === firstOpen ? 'current' : 'todo';
}

function objectivesOf(stage: Record<string, any>): string[] {
  const raw = stage.learningObjectives;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string' && x.trim());
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x: unknown) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 阶段时间说明（生成期诚实声明，2026-10-12）：从 description 提取，折叠态在阶段头直接展示 */
function stageCapacityNote(stage: Record<string, any>): string {
  const desc = typeof stage?.description === 'string' ? stage.description : '';
  const matched = desc.match(/(?:容量说明|时间说明)[：:][^\n]*/);
  return matched ? matched[0].trim() : '';
}

function toggleStage(si: number) {
  const i = openStages.value.indexOf(si);
  if (i >= 0) openStages.value.splice(i, 1);
  else openStages.value.push(si);
}

/* ---------- 进度 ---------- */
const allTasks = computed(() => stages.value.flatMap((s) => stageTasks(s)));
const totalTasks = computed(() => allTasks.value.length);
const doneTasks = computed(() => allTasks.value.filter((t) => t.status === 'completed').length);
const percent = computed(() => (totalTasks.value ? Math.round((doneTasks.value / totalTasks.value) * 100) : 0));

/* 进度环数字滚动（批18 招牌动效）：入场与变化时 ease-out 计数。
   rAF 不受全局 prefers-reduced-motion CSS 兜底管，这里手动豁免直出终值。 */
const displayPercent = ref(percent.value);
let percentRaf = 0;
function animatePercent() {
  cancelAnimationFrame(percentRaf);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    displayPercent.value = percent.value;
    return;
  }
  const from = displayPercent.value;
  const to = percent.value;
  if (from === to) return;
  const start = performance.now();
  const dur = 640;
  const step = (now: number) => {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    displayPercent.value = Math.round(from + (to - from) * eased);
    if (t < 1) percentRaf = requestAnimationFrame(step);
  };
  percentRaf = requestAnimationFrame(step);
}
watch(percent, animatePercent);
onMounted(() => {
  // 入场从 0 滚到当前进度（0 值本身不动画）
  if (percent.value > 0) {
    displayPercent.value = 0;
    animatePercent();
  }
});
onBeforeUnmount(() => cancelAnimationFrame(percentRaf));
const allDone = computed(() => totalTasks.value > 0 && doneTasks.value === totalTasks.value);

/* 锁定态以**阶段状态**为权威（2026-11-03 真人走查根因修复）。
   此前锁定由「位置相对当前任务」推断，而当前任务又只按课次状态挑——循环自证：锁着阶段里
   只要有一条 in_progress，它就成了「当前任务」，页头「继续当前任务」指向它、点进去是
   「本节暂时开不了课」，而真正能学的待学课在行内反而落到不可点的「待开始」。 */
function stageLockedOf(task: Record<string, any>) {
  const stage = stages.value.find((s) => stageTasks(s).some((t) => t.id === task.id));
  return String(stage?.status || '') === 'locked';
}

/* 当前任务 = 未锁阶段里第一个 in_progress，否则第一个 todo；与学习台「今日行动」共用
   pickCurrentTask（决策链同源：两页必须指向同一节课，2026-09-25 收口）。
   传入阶段锁定判定，锁着阶段的课次不再被选成「当前任务」（2026-11-03 根因修复）。 */
const currentTask = computed(() => pickCurrentTask(allTasks.value, stageLockedOf));

const currentStageNo = computed(() => {
  if (!currentTask.value) return stages.value.length;
  const idx = stages.value.findIndex((s) => stageTasks(s).some((t) => t.id === currentTask.value?.id));
  return idx >= 0 ? stageNo(stages.value[idx], idx) : 1;
});

const sceneSummary = computed(() => {
  const s = path.value?.sceneSummary;
  if (!s) return null;
  if (typeof s === 'string') return { title: s, rows: [] };
  if (typeof s !== 'object') return null;
  return s as Record<string, any>;
});

const sceneSummaryTitle = computed(() => {
  const s = sceneSummary.value;
  if (!s) return '';
  return typeof s === 'string' ? s : (s.title || s.summary || s.intent || '');
});

watch(sceneSummaryTitle, () => {
  intentExpanded.value = false;
  nextTick(measureIntentTitle);
});

const sceneRows = computed(() => {
  const s = sceneSummary.value;
  if (!s || typeof s === 'string') return [];
  const rows: Array<{ label: string; value: string }> = [];
  // 该字段是**整条路径**的首份产出（confirmedProposal.first_deliverable），
  // 与目标对话预览里同一字段的「预计产出」对齐；旧标签「第一阶段产出」会让人
  // 以为它是阶段 1 的产出（走查 P6）
  if (s.firstDeliverable) rows.push({ label: '预计产出', value: String(s.firstDeliverable) });
  if (s.targetState) rows.push({ label: '目标状态', value: String(s.targetState) });
  // 规划焦点（confirmedProposal.keyStages）与左侧阶段列表重复，不再在此展示
  // 注意：excludedScope/「先不学」不展示——不学的内容无需让用户确认，避免不必要的顾虑（与 goal 预览一致）
  if (s.timeBudget) rows.push({ label: '时间预算', value: String(s.timeBudget) });
  if (s.timeHorizon) rows.push({ label: '时间跨度', value: String(s.timeHorizon) });
  return rows;
});

/** 问题背景（问题原文 realProblem）：默认折叠；标题已是同一段时不再重复展示 */
const bgExpanded = ref(false);
/** 设计意图卡：默认收起（用户侧收敛：侧栏优先「进行到哪」，意图是依据型信息，2026-09-25） */
const intentOpen = ref(false);
const sceneProblemBackground = computed(() => {
  const s = sceneSummary.value;
  if (!s || typeof s === 'string') return '';
  const bg = typeof s.problemBackground === 'string' ? s.problemBackground.trim() : '';
  return bg && bg !== sceneSummaryTitle.value ? bg : '';
});

watch(sceneProblemBackground, () => { bgExpanded.value = false; });

/* ---------- 展示辅助 ---------- */
const badgeText = computed(() => {
  if (pathOffline.value) return '已下线';
  if (lifecycle.value && lifecycle.value.phase !== 'ready') return lifecycleFailed.value ? '需要处理' : '生成中';
  if (allDone.value) return '已完成';
  return '进行中';
});
const badgeCls = computed(() => {
  if (pathOffline.value) return 'badge--muted';
  if (lifecycle.value && lifecycle.value.phase !== 'ready') return lifecycleFailed.value ? 'badge--red' : 'badge--cyan';
  if (allDone.value) return 'badge--green';
  return 'badge--blue';
});

function taskCls(task: Record<string, any>) {
  if (task.status === 'completed') return 'completed';
  if (!canLearn.value) return 'locked';
  // 阶段锁是权威（2026-11-03 根因修复）：锁着阶段的课次一律 locked，不看它自己的 status，
  // 否则残留/异常的 in_progress 会让锁着的行显示成「可继续」。
  if (stageLockedOf(task)) return 'locked';
  if (task.status === 'in_progress') return 'current';
  if (currentTask.value && task.id === currentTask.value.id) return 'current';
  const curIdx = allTasks.value.findIndex((t) => t.id === currentTask.value?.id);
  const myIdx = allTasks.value.findIndex((t) => t.id === task.id);
  return curIdx >= 0 && myIdx > curIdx ? 'locked' : 'todo';
}

/** 任务类型枚举 → 中文标签（2026-11-05 UX 审计 P1）：手动插入的任务不写 displayLabel，
    旧回退链把英文枚举（如 practice）直接亮在「进行到哪」主界面（截图实证），
    与相邻课程的中文标签（理解核心原理/动手实践…）割裂。值域对齐后端
    AITeachingCoordinator normalizeTaskType 的 11 种枚举；displayLabel（LLM 中文标签）
    优先原样透传，未命中映射的枚举也原样兜底，不造新词。 */
const TASK_TYPE_LABELS: Record<string, string> = {
  reading: '阅读材料',
  practice: '动手练习',
  project: '项目实践',
  quiz: '小测验',
  acquire: '理解核心原理',
  deconstruct: '拆解示范',
  model: '模仿练习',
  execute: '动手实操',
  diagnose: '诊断纠错',
  refine: '精进训练',
  consolidate: '巩固复习',
};

function taskKindText(task: Record<string, any>) {
  const raw = task.displayLabel || task.taskType || task.knowledgeType;
  if (!raw) return '任务';
  const text = String(raw).trim();
  return TASK_TYPE_LABELS[text] || text;
}

function goLearn(taskId: string) {
  // 带 pathId 进课堂：评估页的「返回学习路径」据此回本页（缺省只能退回列表，2026-09-25）
  const pid = path.value?.id;
  router.push(pid ? { path: `/learn/${taskId}`, query: { pathId: pid } } : `/learn/${taskId}`);
}

async function viewFeedback(task: Record<string, any>) {
  try {
    const detail = await aiTeachingAPI.getLatestTaskEvaluation(task.id);
    if (detail?.sessionId) {
      const pathQuery = pathId.value ? `?pathId=${encodeURIComponent(pathId.value)}` : '';
      router.push(`/learn/${task.id}/evaluation/${detail.sessionId}${pathQuery}`);
      return;
    }
  } catch {
    /* 无评估记录或加载失败：走降级引导 */
  }
  // 降级：无当堂评估记录时给出可操作的替代入口（回看历史；或用户自行重新进入任务学习）
  const go = await askConfirm({
    title: '暂无当堂评估记录',
    message: '这节课还没有生成学习反馈，可能还在结算中。你可以回看学习历史，也可以直接打开这个任务重新进入。',
    confirmText: '回看学习历史',
    danger: false,
  });
  if (go) router.push('/user/learning-history');
}

onMounted(() => {
  load();
  window.addEventListener('resize', measureClampedText);
});
onBeforeUnmount(() => {
  window.clearTimeout(pollTimer);
  window.removeEventListener('resize', measureClampedText);
});
</script>

<style scoped>
/* wrapper 沉底：AI 提示与页脚一起贴近底部 */
.detail__foot { margin-top: auto; }
.detail__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.detail__ai-note :deep(.ai-note) { font-size: 12px; opacity: 0.75; }

.detail__main {
  max-width: 1080px; margin: 0 auto;
  padding: 20px 28px 48px;
  display: grid; gap: 16px;
}
.crumbs { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--faint); min-width: 0; }
/* 电脑档热区 36px（2026-10-08 走查 #64）：padding 5px 0 实测 61×30，低于仓库 36px 硬线；
   手机档已由文末媒体查询抬到 44px，两档不一致。补 min-height，配色/字号不动。 */
.crumbs__back { font-weight: 600; color: var(--muted); cursor: pointer; padding: 5px 0; display: inline-flex; align-items: center; min-height: 36px; }
.crumbs__back:hover { color: var(--blue-deep); }
.crumbs__current { color: var(--ink); font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumbs__toggle { flex: 0 0 auto; margin-left: auto; }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--shadow-sm);
}
.kicker { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }
/* 状态标签（2026-11-06 §1 标签规范）：非点击类标签禁「全圆胶囊 + 大内边距」，
   收敛为紧凑小方签——高 22px、内边距 1px 6px、半径 6px（--mk-radius-sm）、
   12px 常规偏中字重（原 800 过重），柔和半透明底、无描边。 */
.badge {
  display: inline-flex; align-items: center;
  height: 22px; padding: 1px 6px;
  border-radius: var(--mk-radius-sm);
  font-size: 12px; font-weight: 600;
  border: 0;
}
.badge--blue { color: var(--blue-deep); background: color-mix(in srgb, var(--blue) 10%, transparent); }
.badge--muted { color: var(--muted); background: color-mix(in srgb, var(--ink) 7%, transparent); }

.hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; padding: 26px 28px; align-items: center; }
.hero__tags { display: flex; align-items: center; gap: 10px; }
.hero h1 { margin: 8px 0 6px; font-size: 20px; letter-spacing: -0.01em; }
/* 描述性正文（2026-11-06 §4）：常规字重 400（未声明即默认）+ 行高 1.5 */
.hero p { margin: 0; font-size: 14px; color: var(--muted); line-height: 1.5; }
/* Hero 描述：默认 3 行截断，展开后完整显示（老数据无 summary 时兜底原文，避免整段糊屏） */
.hero__desc {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hero__desc--expanded { display: block; overflow: visible; }
.hero__desc-toggle,
.sidecard__intent-toggle {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--blue-deep);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
/* 指标一行 meta（批18）：去卡片框，值+标签同基线排列——hero 右侧已有进度环，
   这些辅助计数不该再各占一个盒子（KPI 盒子墙观感） */
.hero__metrics { display: flex; gap: 18px; margin-top: 14px; flex-wrap: wrap; }
.metric {
  display: inline-flex; align-items: baseline; gap: 6px;
  padding: 0; background: none; border: 0;
  font-size: 12.5px; color: var(--faint);
}
.metric b { font-size: 13.5px; color: var(--ink); font-variant-numeric: tabular-nums; }
.hero__actions { display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
/* 主/次按钮不再在本页复制一份：本文件曾自带 .btn-primary（11px 22px / 16px 圆角 / 14px 字，
   实测约 39px 高）与 .btn-ghost 副本，与 .card / .adjust-dialog 的 16px 圆角同档，正是 §1
   要消除的「内层与外层同圆角 + 肥大」；且页内 scoped 副本晚于入口样式表加载，会把
   v2.css 已统一的控件档（32px / 0 14px / --mk-radius-md / 13px，移动档 44px）压回去。
   删除副本后由 v2.css「SPEC §1 控件档」唯一承载，hero、生成失败横幅、调整弹窗页脚同规格。 */
.hero__ring { position: relative; width: 120px; height: 120px; }
/* svg 铺满容器而不是写死 120：窄屏容器收到 96 时，写死宽高的 svg 会被裁成 96×120、
   环图与居中文字错位（2026-10-15 移动端重设计实测）。 */
.hero__ring-svg { display: block; width: 100%; height: 100%; }
.progress-track { stroke: var(--mk-surface-2); }
.hero__ring circle[stroke="url(#v2ringGrad)"] { transition: stroke-dashoffset .6s ease; }
.hero__ring-text {
  position: absolute; inset: 0;
  display: grid; place-content: center; text-align: center; gap: 2px;
}
/* 22 → 20：数字档 */
.hero__ring-text b { font-size: 20px; }
.hero__ring-text small { font-size: 12px; color: var(--faint); }

.detail__grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.stages { display: grid; gap: 12px; }

.stages__empty {
  padding: 28px 24px;
  display: grid;
  gap: 6px;
  justify-items: start;
}

.stages__empty strong {
  font-size: 15px;
  color: var(--ink);
}

.stage { overflow: hidden; }
.stage__head {
  display: grid; grid-template-columns: 34px 1fr auto 24px;
  align-items: center; gap: 12px;
  width: 100%;
  padding: 15px 18px;
  background: transparent; border: 0;
  font: inherit; text-align: left; cursor: pointer;
}
.stage__no {
  width: 30px; height: 30px; border-radius: var(--mk-radius-lg);
  background: var(--canvas); color: var(--faint);
  font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
}
.stage__no--done { background: var(--green); color: var(--text-on-primary); }
.stage__no--current { background: var(--blue); color: var(--text-on-primary); box-shadow: 0 0 0 4px color-mix(in srgb, var(--blue) 13%, transparent); }
.stage__title strong { display: block; font-size: 15px; }
.stage__title small { display: block; margin-top: 2px; font-size: 12px; color: var(--faint); }
/* 时间说明（生成期诚实声明）：与常规副行区分——左边一条浅色竖线 + 略深字色，提示"这是口径说明" */
.stage__title .stage__capacity {
  margin-top: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--line);
  color: var(--muted);
  line-height: 1.5;
}
.stage__prog { font-size: 12px; font-weight: 800; color: var(--muted); }
.stage--current .stage__prog { color: var(--blue-deep); }
.stage__chev { color: var(--faint); font-size: 15px; transition: transform .18s ease; justify-self: end; }
.stage__chev--open { transform: rotate(180deg); }

.stage__body {
  display: grid; grid-template-rows: 0fr;
  border-top: 1px solid transparent;
  transition: grid-template-rows 0.32s cubic-bezier(0.32, 0.72, 0.24, 1), border-color 0.24s ease;
}
.stage__body--open { grid-template-rows: 1fr; border-top-color: var(--line); }
.stage__body-inner {
  overflow: hidden; min-height: 0;
  padding: 0 12px;
  display: grid; gap: 4px;
  opacity: 0;
  transition: opacity 0.22s ease, padding 0.32s cubic-bezier(0.32, 0.72, 0.24, 1);
}
.stage__body--open .stage__body-inner { padding: 8px 12px 12px; opacity: 1; }
.task {
  /* 两行结构（2026-11-06 定稿）：第一行「图标 + 完整标题」（标题独占整宽，不被按钮挤压）；
     第二行 .task__line 左放时长属性、右放操作按钮。 */
  display: grid; grid-template-columns: 24px minmax(0, 1fr);
  align-items: start; gap: 4px 11px;
  padding: 9px 10px;
  border-radius: 12px; /* 圆角阶梯：面板 */
  border: 1px solid transparent;
}
.task__body { grid-column: 2; min-width: 0; }
/* 第二行：两端对齐；装不下时按钮整枚换行，靠 margin-left:auto 仍贴右缘 */
.task__line {
  grid-column: 2;
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; flex-wrap: wrap;
  margin-top: 2px;
}
/* 时长属性（左）：类型标签 + 时长，与右侧操作按钮同基线 */
/* 属性行（左）：类型 · 时长 · 引用签同一行，窄屏自动折行 */
.task__meta {
  min-width: 0; font-size: 12px; color: var(--faint);
  display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 6px;
}
/* 行内引用签（2026-11-06 二次走查）：贴着属性行，不再独占一行；
   前置一个「·」把它和「约 45 分钟」隔开，与原型写法一致 */
.task__meta .material-ref--inline:first-of-type::before {
  content: '·';
  margin-right: 6px;
  color: var(--faint);
}
.material-ref--inline { margin: 0; padding: 1px 7px; }
.task__ops {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  margin-left: auto;
}
/* #64 P-39：任务微调入口（只在校验通过的任务上出现）
   尺寸（2026-11-06 §1 内嵌按钮）：高 32px、圆角 8px（卡面 16px 的同心内档）、12px 字号 */
.task__edit {
  font: inherit; font-size: 12px; color: var(--muted);
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; padding: 0 11px; height: 32px;
  display: inline-flex; align-items: center;
  cursor: pointer;
}
.task__edit:hover, .task__edit[aria-expanded="true"] { color: var(--blue); }

/* ---------- 任务微调抽屉（2026-11-06 二次走查重构） ----------
   原先它是任务卡**外面**的一个虚线框（夹在任务 1 与任务 2 之间），既不归属任何任务、
   又读作「未完成占位」；内部 6 个控件挤一排，红色「删除」与「插入」只隔 6px。
   现在：收进任务卡内部（grid-column 1/-1 整宽）、底部一条细分割线表示「正在微调这一条」，
   并拆成上下两行——第一行时长步进器 + 右端删除，第二行插入（独占整行，远离删除键）。
   分割线用 color-mix(--ink 8%) 而不是写死的 rgba(255,255,255,.08)：后者在亮色主题下
   是一条看不见的白线，暗色才对。 */
.task-edit {
  grid-column: 1 / -1;
  display: grid; gap: 8px;
  margin-top: 8px; padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
  font-size: 12px; color: var(--faint);
}
.task-edit__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.task-edit__row--split { justify-content: space-between; }
.task-edit__field { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.task-edit__label { color: var(--faint); }
/* 数值居中定宽：加减各按一次时数字不左右横跳 */
.task-edit__minutes {
  min-width: 54px; text-align: center;
  font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums;
}
/* 步进键：比「缩短 10 分钟」这种 5 字按钮窄一半，宽度留给真正要读的东西 */
.task-edit__step {
  font: inherit; font-size: 12px; height: 32px; padding: 0 8px;
  display: inline-flex; align-items: center;
  border-radius: var(--mk-radius-md); border: 1px solid var(--line);
  background: var(--surface); color: var(--ink); cursor: pointer;
}
.task-edit__step:hover:not(:disabled) { border-color: color-mix(in srgb, var(--blue) 35%, var(--line)); color: var(--blue-deep); }
.task-edit__step:disabled { opacity: .55; cursor: not-allowed; }
/* 删除是这条抽屉里唯一的破坏性动作：独立在右端，与下面的「插入」上下错开 */
.task-edit__danger {
  font: inherit; font-size: 12px; height: 32px; padding: 0 10px;
  display: inline-flex; align-items: center; gap: 5px;
  border-radius: var(--mk-radius-md);
  border: 1px solid color-mix(in srgb, var(--red) 30%, var(--line));
  background: transparent; color: var(--red-ink); cursor: pointer;
}
.task-edit__danger:hover:not(:disabled) { background: color-mix(in srgb, var(--red) 8%, transparent); }
.task-edit__danger:disabled { opacity: .55; cursor: not-allowed; }
/* 插入：组合输入框占满整行，插入键内嵌在右端（不额外吃一行） */
.task-edit__insert {
  display: flex; align-items: stretch; min-height: 32px;
  border: 1px solid var(--line); border-radius: var(--mk-radius-md);
  background: var(--surface); overflow: hidden;
}
.task-edit__insert:focus-within { border-color: var(--blue); box-shadow: var(--mk-focus-ring); }
.task-edit__plus { display: inline-flex; align-items: center; padding-left: 9px; color: var(--faint); }
.task-edit__input {
  flex: 1 1 auto; min-width: 0;
  padding: 0 8px; border: 0; background: none;
  font: inherit; font-size: 12px; color: var(--ink);
}
.task-edit__input::placeholder { color: var(--faint); }
.task-edit__input:focus { outline: none; }
.task-edit__submit {
  flex: none; padding: 0 14px;
  border: 0; border-left: 1px solid var(--line);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  font: inherit; font-size: 12px; font-weight: 700; color: var(--blue-deep);
  cursor: pointer;
}
.task-edit__submit:hover:not(:disabled) { background: color-mix(in srgb, var(--blue) 16%, transparent); }
.task-edit__submit:disabled { color: var(--faint); background: transparent; cursor: not-allowed; }
.task--current { background: color-mix(in srgb, var(--blue) 6%, transparent); border-color: color-mix(in srgb, var(--blue) 20%, transparent); }
/* 锁定态（2026-10-08 走查 #65）：原 `.task--locked { opacity: .62 }` 把整行连文字一起压暗，
   --faint 对卡面只剩 2.45:1（亮）/ 2.91:1（暗），任务名与「待解锁」读不清；
   改为弱化只做在图标上，正文保持 token 原色（--faint 亮 5.07:1 / 暗 5.29:1）。 */
.task__icon {
  width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center;
}
.task--completed .task__icon { background: var(--green); color: var(--text-on-primary); }
.task--current .task__icon { border: 2px solid var(--blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 14%, transparent); }
.task--todo .task__icon { border: 2px dashed color-mix(in srgb, var(--blue) 15%, var(--line)); }
.task--locked .task__icon { color: var(--faint); background: var(--canvas); opacity: .62; }
.task__body strong { display: block; font-size: 13.5px; }
.task__body small { display: block; margin-top: 2px; font-size: 12px; color: var(--faint); }
/* 时长标签禁词中折行（bare/15）：「约 18 分钟」不拆成「约 18 分/钟」 */
.task__mins { white-space: nowrap; }
.task__cta {
  height: 32px;
  display: inline-flex; align-items: center;
  font-size: 12px; font-weight: 600; color: var(--blue-deep);
  /* 主区 hero 已有唯一实心 CTA；任务行这颗降为描边，和相邻「微调」同高同圆角 */
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--blue) 30%, var(--line));
  padding: 0 12px; border-radius: 8px; /* 圆角阶梯：控件 */
  cursor: pointer;
  transition: transform 0.16s ease, background 0.16s ease;
}
.task__cta:not(:disabled):active { transform: scale(0.98); }
.task__done-label { font-size: 12px; font-weight: 600; color: var(--green); cursor: pointer; display: inline-flex; align-items: center; height: 32px; padding: 0 8px; min-width: 44px; border-radius: 8px; }
.task__lock-label, .task__todo-label { font-size: 12px; color: var(--faint); }

.side { display: grid; gap: 12px; position: sticky; top: 16px; }
.sidecard { padding: 16px 18px; display: grid; gap: 10px; align-content: start; }
.sidecard strong { font-size: 15px; line-height: 1.5; }
.sidecard p { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
/* 侧栏折叠头（设计意图，2026-09-25）：与问题背景的 bg-head 同款箭头语言 */
.sidecard__head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 44px;
  border: 0; background: transparent; padding: 0; margin: 0; font: inherit;
  color: inherit; cursor: pointer; text-align: left;
}
.sidecard__chev { display: inline-block; color: var(--faint); transition: transform 0.16s ease; }
/* 展开方向与阶段卡（.stage__chev--open）一致：rotate(180deg) 朝上；
   原 rotate(90deg) 把「▾」转成朝左，看不出是展开态（2026-10-08 走查 #77）。 */
.sidecard__chev--open { transform: rotate(180deg); }
.sidecard__body { display: grid; gap: 10px; align-content: start; }
/* 卡内子分区（接下来 / 原文预览）：与主 kicker 同语言、低一档 */
.sidecard__sub { display: grid; gap: 6px; align-content: start; border-top: 1px solid var(--line); padding-top: 10px; margin-top: 2px; }
.sidecard__sub-head { font-size: 12px; font-weight: 700; color: var(--muted); }
.materials-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.materials-list > li { display: flex; flex-direction: column; gap: 4px; }
.materials-list strong { font-size: 13.5px; color: var(--ink); }
.materials-list small { font-size: 12px; color: var(--muted); }
.materials-sections { list-style: none; margin: 4px 0 0; padding: 0 0 0 10px; display: flex; flex-direction: column; gap: 2px; border-left: 1px solid var(--line); }
.materials-sections li { font-size: 12px; color: var(--muted); }
.materials-toggle { align-self: flex-start; background: none; border: none; padding: 0; font-size: 12px; color: var(--blue); cursor: pointer; }
.materials-note { margin: 10px 0 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
/* .task__material / .stage__material 随「资料」独占行一并删除（2026-11-06 二次走查）：
   引用签已并入 .task__meta，阶段头那行「本阶段依据资料」与任务行重复 */
/* 资料引用＝胶囊微签（2026-11-06 走查 图1/2/3）：原生蓝字下划线像 90 年代网页，
   而且一行三颗同名链接时下划线把字连成一条。4px 控件圆角 + 蓝 10% 底 + 文档小图标，
   行内换行时每颗都是独立可点的胶囊。 */
.material-ref {
  display: inline-flex; align-items: center; gap: 4px;
  margin: 2px 6px 2px 0; padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--blue) 22%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  font-size: 12px; font-weight: 600; line-height: 1.4;
  color: var(--blue-deep);
  cursor: pointer;
  text-decoration: none;
}
.material-ref:hover { background: color-mix(in srgb, var(--blue) 16%, transparent); }
.material-ref svg { flex: none; opacity: .85; }
.material-ref:disabled { color: var(--muted); background: var(--line); border-color: transparent; cursor: default; }
/* 引文块（2026-11-06 走查 图3/4）：左竖线 + 浅底，用户最该看的就是这一句 */
.material-quote {
  margin: 0;
  padding: 6px 0 6px 10px;
  border-left: 2px solid color-mix(in srgb, var(--blue) 45%, transparent);
  font-size: 12.5px; line-height: 1.7; color: var(--ink);
}
/* 去大弹窗读全文的轻量入口 */
.materials-open {
  align-self: flex-start;
  display: inline-flex; align-items: center;
  min-height: 30px; padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  font-family: inherit; font-size: 12px; font-weight: 700;
  color: var(--blue-deep);
  cursor: pointer;
}
.materials-open:hover { background: color-mix(in srgb, var(--blue) 16%, transparent); }
/* 通用小签（§1）：同样收紧为紧凑小方签，不再全圆胶囊 */
.tag {
  display: inline-flex; align-items: center;
  height: 20px; padding: 1px 6px; border-radius: var(--mk-radius-sm);
  background: var(--line);
  font-size: 12px; font-weight: 600; color: var(--muted);
}
.tag--blue { background: color-mix(in srgb, var(--blue) 9%, transparent); color: var(--blue-deep); }
/* .next-list 随「接下来」卡片一并删除（2026-11-06 走查 图1/2/3） */
.sidecard__sum { font-size: 12px; font-weight: 700; color: var(--muted); border-top: 1px dashed var(--line); padding-top: 9px; }
.sidecard__text { font-size: 13px; }
.sidecard__intent-title {
  font-size: 14px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sidecard__intent-title--expanded { display: block; overflow: visible; }
.sidecard__rows { margin: 0; display: grid; gap: 8px; }
.sidecard__row { display: grid; gap: 2px; }
.sidecard__row dt { font-size: 12px; font-weight: 600; color: var(--faint); letter-spacing: 0.03em; }
.sidecard__row dd { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
.sidecard__bg { border-top: 1px dashed var(--line); padding-top: 8px; }
/* 调整历史卡：来源路径链接 + 与快照回退区的互引说明 */
.lineage-link { font-size: 12px; font-weight: 600; color: var(--blue); text-decoration: underline; }
.lineage-note { margin: 0; padding-top: 8px; border-top: 1px dashed var(--line); font-size: 12px; line-height: 1.5; color: var(--faint); }
.sidecard__bg-head {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 600; letter-spacing: 0.03em; color: var(--faint);
}
.sidecard__bg-head:hover { color: var(--blue-deep); }
.sidecard__bg-chev { font-size: 12px; transition: transform 0.15s ease; }
.sidecard__bg-chev--open { transform: rotate(180deg); }
.sidecard__bg-text { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted); white-space: pre-wrap; }

@media (max-width: 1100px) {
  .detail__main { padding: 14px 14px 32px; }
  .detail__grid { grid-template-columns: 1fr; }
  /* 单列顺序改回 DOM 序（2026-11-06 走查 图7）：原先 order:-1 把「学习资料/设计意图」
     提到阶段列表之前，一旦展开学习资料，阶段 1~4 就被挤到屏外最底下。
     现在 = 概览卡 → 阶段与任务 → 学习资料 → 设计意图，任务永远排第一优先级。 */
  .side { position: static; }
}
</style>

<style scoped>
.detail__loading { display: grid; justify-items: center; gap: 12px; padding: 64px 0; color: var(--faint); font-size: 13px; }
.badge--green { color: var(--green-ink); background: color-mix(in srgb, var(--wf-color-success) 12%, transparent); }
.badge--cyan { color: var(--cyan-ink); background: color-mix(in srgb, var(--cyan) 14%, transparent); }
.badge--red { color: var(--red-ink); background: color-mix(in srgb, var(--wf-color-danger) 12%, transparent); }
.genbar {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 20px;
}
.genbar--failed { border-color: color-mix(in srgb, var(--red) 35%, transparent); }
.genbar--muted { border-color: var(--line); }
.genbar__text { flex: 1; }
.genbar__text strong { font-size: 14px; }
.genbar__text p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
.objectives {
  margin: 0 0 8px; padding: 10px 12px 10px 28px;
  background: var(--canvas); border: 1px solid var(--line); border-radius: var(--mk-radius-lg);
  display: grid; gap: 4px;
}
.objectives li { font-size: 12.5px; color: var(--muted); line-height: 1.5; }
.task--current .task__todo-label { color: var(--blue-deep); font-weight: 700; }
.detail__main { width: 100%; }
</style>

<style scoped>
/* 超长机器生成标题：两行截断 */
.pcard__title, .hero h1, .path__title strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>

<style scoped>
/* ===== 主内容列（主内容列） ===== */
.stages-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ===== 移动端适配 ===== */
@media (max-width: 1100px) {
  .crumbs { flex-wrap: wrap; row-gap: 6px; }
}

/* ===== 补充说明调整弹窗 ===== */
.adjust-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--wf-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.adjust-dialog {
  width: 100%;
  max-width: 480px;
  padding: 22px 24px;
}
/* tabindex=-1 承接打开移焦：编程性聚焦不画焦点框，键盘 Tab 进入控件时仍正常显示 */
.adjust-dialog:focus { outline: none; }
.adjust-dialog__title {
  margin: 0 0 8px;
  font-size: 17px;
}
.adjust-dialog__desc {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
}
.adjust-dialog__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.adjust-dialog__close {
  flex: 0 0 auto;
  width: 26px; height: 26px;
  border: 0; border-radius: var(--mk-radius-md);
  background: transparent; color: var(--faint);
  display: grid; place-items: center;
  cursor: pointer;
}
.adjust-dialog__close:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
/* 三场景卡片选择 */
.adjust-modes { display: grid; gap: 8px; margin-top: 4px; }
.adjust-mode {
  display: flex; align-items: center; gap: 12px;
  width: 100%;
  padding: 12px 14px;
  /* 同心圆角（2026-11-06 §1）：外层弹窗 16px → 内层选项 12px，不再与弹窗同档 */
  border: 1px solid var(--line); border-radius: var(--mk-radius-lg);
  background: var(--surface); text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  font: inherit;
}
/* hover 的 0 2px 10px 蓝色 8% 发光改为中性 raised 档（边框/底色变化仍是允许的 hover 反馈） */
.adjust-mode:hover { border-color: var(--wf-color-primary-lighter); background: var(--canvas); box-shadow: var(--wf-shadow-raised); }
.adjust-mode--warn .adjust-mode__icon {
  color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber) 16%, transparent);
}
.adjust-mode__icon {
  flex: 0 0 auto;
  width: 34px; height: 34px; border-radius: var(--mk-radius-lg);
  display: grid; place-items: center;
  font-size: 16px; font-weight: 700; color: var(--blue);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
}
.adjust-mode__body { flex: 1; min-width: 0; display: grid; gap: 2px; }
.adjust-mode__body strong { font-size: 13.5px; color: var(--ink); }
.adjust-mode__body small { font-size: 12px; line-height: 1.5; color: var(--mk-faint); }
.adjust-mode__arrow { color: var(--faint); font-size: 16px; }
/* 策略禁用的场景入口：压暗 + 原因副文案（amber 一档，与整建警示同色语言） */
.adjust-mode:disabled { opacity: 0.55; cursor: not-allowed; }
.adjust-mode:disabled:hover { border-color: var(--line); background: var(--surface); box-shadow: none; }
.adjust-mode__blocked { color: var(--amber-ink); }
/* 策略推荐引导标记：场景卡标题角标 + 填写步提示条内文案
   （2026-11-06 §1）：胶囊 → 紧凑小方签，去掉 1px 描边，只留柔和半透明底 */
.adjust-mode__rec {
  margin-left: 6px;
  display: inline-flex; align-items: center;
  height: 20px; padding: 1px 6px;
  border-radius: var(--mk-radius-sm);
  font-size: 12px; font-weight: 600;
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  vertical-align: 1px;
}
.adjust-form__hint-group { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
.adjust-form__rec { font-size: 12px; font-weight: 700; opacity: 0.9; }
/* 选中场景后的头部提示。
   flex-wrap（bare/20）：窄屏（iPhone 402 实测）长模式说明与右侧「← 换一种方式」
   挤同一行，按钮压在折行后的标题文字上；wrap 让按钮组在装不下时换行到下一行，
   与文字分离。
   圆角（2026-11-06 §1）：整条通栏提示条不用胶囊，收敛为 8px 控件档。 */
.adjust-form__mode-hint {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  padding: 7px 12px;
  font-size: 12.5px; font-weight: 700;
  border-radius: var(--mk-radius-md);
  color: var(--blue-ink); background: color-mix(in srgb, var(--blue) 10%, transparent);
}
.adjust-form__mode-hint--rebuild { color: var(--amber-ink); background: color-mix(in srgb, var(--amber) 14%, transparent); }
.adjust-form__mode-hint--auto { color: var(--purple-ink); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.adjust-form__back {
  border: 0; background: transparent; padding: 2px 4px;
  font: inherit; font-size: 12px; font-weight: 600;
  color: inherit; opacity: 0.75; cursor: pointer;
  text-decoration: underline;
}
.adjust-form__back:hover { opacity: 1; }
.adjust-form__warn {
  margin: 0 0 10px;
  padding: 9px 12px;
  font-size: 12.5px; line-height: 1.5;
  color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber) 35%, transparent);
  border-radius: var(--mk-radius-lg);
}
.adjust-form__hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--faint);
  text-align: right;
}
/* 回退保障提示：与操作提示同区、弱化一档 */
.adjust-form__hint--safety {
  margin-top: 4px;
  color: var(--faint);
}
/* 面板内回退入口（paths/iphone/2）：承诺「可一键回退」就必须可达，不再只挂 hero。
   尺寸交给 v2.css 的控件档（电脑 32px / 移动 44px），本页不再单独写 min-height 把它压到 36px */
.adjust-form__rollback {
  margin: 8px 0 0;
  display: flex;
}
/* 挡路课堂清场视图 */
.clear-sessions {
  display: grid;
  gap: 12px;
}
.clear-sessions__head {
  display: grid;
  gap: 6px;
}
.clear-sessions__tag {
  justify-self: start;
  display: inline-flex; align-items: center;
  height: 20px; padding: 1px 6px;
  font-size: 12px; font-weight: 600;
  color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber) 14%, transparent);
  border-radius: var(--mk-radius-sm);
}
.clear-sessions__head p {
  margin: 0;
  font-size: 12.5px; line-height: 1.5;
  color: var(--muted);
}
.clear-sessions__list {
  list-style: none;
  margin: 0; padding: 0;
  display: grid;
  gap: 8px;
}
.clear-sessions__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-lg);
  background: var(--surface);
}
.clear-sessions__item-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.clear-sessions__item-main strong {
  font-size: 12.5px; font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 课堂状态标签（2026-11-06 §1）：类名来自全站通用壳（本仓无全局底样式），
   这里按「状态标签=紧凑小方签」给底色，不再是一行裸文字（进行中/已暂停/收尾中…） */
.clear-sessions__item-main .uc-badge {
  justify-self: start;
  display: inline-flex; align-items: center;
  height: 20px; padding: 1px 6px;
  font-size: 12px; font-weight: 600;
  border-radius: var(--mk-radius-sm);
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.clear-sessions__item-main .uc-badge--warn {
  color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber) 14%, transparent);
}
.clear-sessions__hint {
  margin: 0;
  font-size: 12px; line-height: 1.5;
  color: var(--faint);
}
/* 行内主按钮（清场列表）：§1 内嵌按钮档——高 32px、圆角 8px、12px 字号 */
.btn-primary--sm {
  flex: 0 0 auto;
  height: 32px;
  font-size: 12px;
  padding: 0 12px;
  border-radius: var(--mk-radius-md);
}

/* reshape 调整范围选择 */
.adjust-scope {
  margin-bottom: 12px;
}
.adjust-scope__label {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.adjust-scope__opts {
  display: grid;
  gap: 6px;
}
.adjust-scope__opt {
  display: grid;
  gap: 2px;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-lg);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.adjust-scope__opt strong { font-size: 12.5px; color: var(--ink); }
.adjust-scope__opt small { font-size: 12px; line-height: 1.5; color: var(--faint); }
.adjust-scope__opt:hover { border-color: color-mix(in srgb, var(--blue) 20%, var(--line)); }
.adjust-scope__opt.is-on {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent);
}
.adjust-scope__opt.is-on strong { color: var(--purple-ink); }
.adjust-scope__picker {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}
/* 包裹层只限宽，按钮视觉由 MkSelect 承担（2026-10-27 自绘下拉） */
.adjust-scope__select {
  max-width: 300px;
  min-width: 0;
}
/* AI 建议卡的嵌套面板（2026-11-06 §1）：与弹窗内层同档 12px，不同档于外层弹窗 */
.ai-advice {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), color-mix(in srgb, var(--blue) 4%, transparent));
  border-radius: var(--mk-radius-lg);
}
.ai-advice__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 「AI 诊断」标签 + 诊断依据/卡点小签（2026-11-06 §1）：一律紧凑小方签 */
.ai-advice__tag {
  flex: 0 0 auto;
  display: inline-flex; align-items: center;
  height: 20px; padding: 1px 6px;
  font-size: 12px; font-weight: 600;
  color: var(--purple-ink);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: var(--mk-radius-sm);
}
.ai-advice__verdict {
  font-size: 14px; font-weight: 700;
  color: var(--purple-ink);
}
.ai-advice__verdict--ok { color: var(--green-ink); }
.ai-advice__rationale {
  margin: 0;
  font-size: 13px; line-height: 1.5;
  color: var(--ink);
}
.ai-advice__detail {
  font-size: 12.5px; line-height: 1.5;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  border-radius: var(--mk-radius-md);
  padding: 8px 10px;
}
.ai-advice__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.ai-advice__chip-label {
  font-size: 12px; font-weight: 700;
  color: var(--faint);
}
.ai-advice__chip {
  display: inline-flex; align-items: center;
  height: 20px; padding: 1px 6px;
  font-size: 12px; font-weight: 600;
  color: var(--blue-ink);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  border-radius: var(--mk-radius-sm);
}
.ai-advice__chip--warn {
  color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber) 14%, transparent);
}
.ai-advice__meta {
  font-size: 12px;
  color: var(--faint);
}
.ai-advice__actions { margin-top: 4px; }
.adjust-dialog__textarea {
  width: 100%;
  min-height: 96px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-md);
  font-size: 13.5px;
  line-height: 1.6;
  resize: vertical;
  background: var(--surface);
  color: var(--ink);
  box-sizing: border-box;
}
.adjust-dialog__textarea:focus {
  outline: none;
  border-color: var(--blue);
}
.adjust-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
/* 危险态确认键：批次 D 把红色染色投影与 135deg 渐变一并退役 → 纯色危险档。
   取 --wf-color-danger-dark（#d95054，白字 4.6:1 达 AA）。 */
.adjust-dialog .btn-primary--danger {
  background: var(--wf-color-danger-dark);
}
/* 弹窗内文字已全部令牌化（--muted/--faint/--amber-ink/--ink），随主题自动翻转，暗色逐条覆写退役 */
[data-theme='dark'] .adjust-form__warn { color: var(--amber-ink); }
[data-theme='dark'] .adjust-form__hint,
[data-theme='dark'] .adjust-scope__picker,
[data-theme='dark'] .clear-sessions__hint,
[data-theme='dark'] .ai-advice__chip-label,
[data-theme='dark'] .ai-advice__meta { color: var(--mk-muted); }

/* 触屏热区（放在文件末尾：这几个控件的基础规则散在后面的 style 块里，同权重下先出现会被覆盖）：
   它们在桌面是「一行小字 + 光标」，触屏上却是主要入口，实测高度只有 17–24px——
   「问题背景」17、「展开全文 / 更多意图」19、视图切换 24、面包屑返回 30。加纵向 padding
   抬到 32–40，文字与配色不变；这几处背景都透明，加 padding 不产生视觉变化。
   #64（2026-10-08）：面包屑返回键的基础规则也补了 min-height: 36px（电脑档），这里保持
   44px 的触屏档更宽松，两档均 ≥36。 */
@media (max-width: 1100px) {
  .crumbs__back { padding: 9px 0; min-height: 44px; display: inline-flex; align-items: center; }
  .hero__desc-toggle,
  .sidecard__intent-toggle { padding: 7px 0; }  /* 19 → 33 */
  .sidecard__bg-head { padding: 8px 0; }        /* 17 → 33 */
}
</style>

<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   判据：卡片内边距 12–16px、hero 标题 22px、KPI 数字 20–22px、弹层 16–18px、加载留白 ≤32px。
   实测 390 下整页 2726px（第二长），其中 .hero 26×28 是全站最厚的 hero 卡、
   进度环 120px 占 390 宽近 1/3、.sidecard 16×18、加载态 64px。
   放在文件末尾：同权重下后出现者胜（本文件有 4 个 style 块，基础规则在后面几块里）。 */
@media (max-width: 1100px) {
  /* ── Hero 移动端重设计（2026-10-15）──────────────────────────────
     原单列把整块进度环甩到卡底、居中孤立，hero 撑到 415px 且环下留约 100px 死区。
     改为「状态条 + 进度环」紧凑头：徽章与标题在左列，进度环锚在右上角（占两行、
     收到 84px——再小装不下环内「整体进度」字样），描述/指标/动作整宽铺开。
     hero__main 用 display:contents 拆成直接网格项摆位，不改 DOM 结构。 */
  .hero {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    padding: 16px 18px;
    gap: 10px 14px;
  }
  .hero__main { display: contents; }
  .hero__tags { grid-column: 1; grid-row: 1; }
  .hero h1 { grid-column: 1; grid-row: 2; font-size: 18px; align-self: center; }
  .hero__ring {
    grid-column: 2; grid-row: 1 / span 2;
    align-self: center;
    width: 84px; height: 84px;
  }
  .hero__ring-text b { font-size: 16px; }
  .hero__desc,
  .hero__desc-toggle,
  .hero__metrics,
  .hero__actions { grid-column: 1 / -1; }
  .stages__empty { padding: 20px 16px; }
  .sidecard { padding: 12px 14px; }
  .sidecard strong { font-size: 14px; }
  .stage__title strong { font-size: 14px; }
  .detail__loading { padding: 32px 0; }
  .genbar { padding: 12px 14px; flex-wrap: wrap; }
  /* 失败横幅主 CTA「重新准备阶段任务」在窄屏换行成两行、与左侧文案不齐（LY16）：
     窄屏让按钮独占一行、通栏居中，并禁止文字换行 */
  .genbar--failed .btn-primary { width: 100%; justify-content: center; white-space: nowrap; }
  /* 任务行操作钮：电脑档按 §1 收到 32px（30–34 档），触屏档回到 40px——
     守住仓库 mobile:spec「可点元素任何一维 ≥36px」（lt36 预算 0）的硬线，
     375 实测口径下不再新增不足 36 的点击目标；字号维持 12px 不动。 */
  .task__cta, .task__edit, .task__done-label { height: 40px; padding: 0 14px; }
  /* 微调抽屉（点开后才出现在 DOM 里）：步进键 / 删除 / 插入组合框同抬到 40px，
     避免触屏上出现 <36 的目标（lt36 预算 0）；字号维持 12px 不动。 */
  .task-edit__step,
  .task-edit__danger,
  .task-edit__insert { height: 40px; }
  .task-edit__input { height: 38px; }
  .adjust-dialog-mask { padding: 14px; }
  .adjust-dialog { padding: 16px 18px; }
  /* 26×26 对拇指偏小（弹窗右上角唯一退出路径），抬到 36 */
  .adjust-dialog__close { width: 36px; height: 36px; }
  /* 「展开全文 / 收起」纯文字链在 375 实测 50×36，低于触屏 40 下限（LY17）：
     抬到 40（仍不动字号） */
  .hero__desc-toggle,
  .sidecard__intent-toggle {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
  }
}
</style>

<style scoped>
/* ===== 全文阅读弹窗（2026-11-06 走查 图6）=====
   侧栏里那个 280px 宽、从整篇文档第一行英文爬虫头开始显示的 <pre> 滚动框，
   字面意义上「没法读」：换成这张正经阅读面（宽度 760、行高 1.75、条文各自成段）。 */
.reader {
  position: fixed; inset: 0; z-index: 60;
  display: grid; place-items: center;
  padding: 24px;
  background: var(--wf-overlay);
}
.reader__card {
  width: min(760px, 100%);
  max-height: min(86dvh, 900px);
  display: flex; flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--mk-shadow-modal);
  overflow: hidden;
}
.reader__card:focus { outline: none; }
.reader__head {
  flex: none;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--line);
}
.reader__title { margin: 0; font-size: 15px; font-weight: 800; line-height: 1.4; color: var(--ink); }
.reader__meta { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
.reader__close {
  flex: none;
  width: 32px; height: 32px;
  display: grid; place-items: center;
  border: 0; border-radius: var(--mk-radius-sm);
  background: transparent;
  font-size: 18px; line-height: 1; color: var(--muted);
  cursor: pointer;
}
.reader__close:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 8%, transparent); }
.reader__body {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 28px;
}
.reader__note { margin: 0; font-size: 13px; color: var(--muted); }
.reader__note--error { color: var(--red-ink); }
/* 正文排版：1.75 行高 + 段落间距。条文由 normalizeMaterialMarkdown 在句末标点后断段，
   标题由 markdown 渲染成 h1~h3，所以这里只管字距行距，不再碰内容。 */
.reader__text { font-size: 13.5px; line-height: 1.75; color: var(--ink); }
.reader__text :deep(p) { margin: 0 0 10px; }
.reader__text :deep(h1),
.reader__text :deep(h2) { margin: 20px 0 10px; font-size: 15px; font-weight: 800; line-height: 1.45; }
.reader__text :deep(h3),
.reader__text :deep(h4) { margin: 16px 0 8px; font-size: 14px; font-weight: 800; line-height: 1.45; }
.reader__text :deep(h1:first-child),
.reader__text :deep(h2:first-child),
.reader__text :deep(h3:first-child) { margin-top: 0; }
.reader__text :deep(strong) { font-weight: 800; }
.reader__text :deep(ul),
.reader__text :deep(ol) { margin: 0 0 10px; padding-left: 20px; }
.reader__text :deep(blockquote) {
  margin: 0 0 10px; padding: 4px 0 4px 10px;
  border-left: 2px solid color-mix(in srgb, var(--blue) 45%, transparent);
  color: var(--muted);
}
.reader__text :deep(code) {
  padding: 1px 5px; border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  font-size: 12.5px;
}
.reader__text :deep(pre) { margin: 0 0 10px; padding: 10px; border-radius: var(--mk-radius-md); background: var(--canvas); overflow-x: auto; }
.reader__text :deep(a) { color: var(--blue-deep); }

@media (max-width: 1100px) {
  .reader { padding: 12px; }
  .reader__card { max-height: 90dvh; }
  .reader__head { padding: 14px 14px 10px; }
  .reader__body { padding: 14px 14px 24px; }
}
</style>
