<template>
  <div class="detail v2-page">
    <V2Nav />

    <main class="detail__main">
      <!-- 面包屑 + 视图切换（右上角） -->
      <div class="crumbs">
        <router-link to="/learning-paths" class="crumbs__back">‹ 路径列表</router-link>
        <span class="crumbs__sep">/</span>
        <span class="crumbs__current">{{ pathTitle || '路径详情' }}</span>
        <div class="view-toggle crumbs__toggle" role="group" aria-label="切换视图">
          <button
            type="button"
            class="view-toggle__btn"
            :class="{ 'view-toggle__btn--active': viewMode === 'list' }"
            @click="setView('list')"
          >
            <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v3h14V5H5zm0 5v9h6v-9H5zm8 0v9h6v-9h-6z" opacity=".9"/></svg>
            列表
          </button>
          <button
            type="button"
            class="view-toggle__btn"
            :class="{ 'view-toggle__btn--active': viewMode === 'timeline' }"
            @click="setView('timeline')"
          ><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2a1 1 0 0 0-1 1v1H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1V3a1 1 0 1 0-2 0v1H9V3a1 1 0 0 0-2 0v1H7V3a1 1 0 0 0-1-1zM4 8h16v11H4V8zm2 3v2h5v-2H6zm7 0v2h5v-2h-5z" opacity=".9"/></svg>
            时间线
          </button>
        </div>
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
        <!-- 生成中/失败横幅 -->
        <section v-if="lifecycle && lifecycle.phase !== 'ready'" class="genbar card" :class="`genbar--${lifecycleFailed ? 'failed' : 'working'}`">
          <template v-if="lifecycleFailed">
            <div class="genbar__text">
              <strong>{{ lifecycle.retryType === 'stage_design' ? '阶段任务准备失败' : '路径主结构生成失败' }}</strong>
              <p>{{ lifecycle.errorMessage || '目标和已确认信息已保留，重试一般能成功。' }}</p>
            </div>
            <button type="button" class="btn-primary" :class="{ 'btn-primary--off': retrying }" @click="doRetry">
              <span v-if="retrying" class="spinner spinner--sm"></span>
              {{ retrying ? '正在重新生成…' : (lifecycle.retryType === 'stage_design' ? '重新准备阶段任务' : '重新生成主结构') }}
            </button>
          </template>
          <template v-else>
            <span class="spinner"></span>
            <div class="genbar__text">
              <strong>{{ lifecycle.phase === 'core' ? '正在生成路径主结构…' : `正在准备阶段任务（${lifecycle.completedStages}/${lifecycle.totalStages}）…` }}</strong>
              <p>页面会自动刷新，你也可以先去别的页面看看。</p>
            </div>
          </template>
        </section>

        <!-- 头部 Hero -->
        <section class="hero card">
          <div class="hero__main">
            <div class="hero__tags">
              <span class="badge" :class="badgeCls">{{ badgeText }}</span>
            </div>
            <h1>{{ pathTitle }}</h1>
            <p>{{ path.description || path.summary }}</p>
            <AiContentNote class="hero__ai-note" />
            <div class="hero__metrics">
              <span class="metric"><b>{{ currentStageNo }} / {{ stages.length || '?' }}</b>当前阶段</span>
              <span class="metric"><b>{{ path.estimatedHours || '—' }} 小时</b>预计投入</span>
              <span class="metric"><b>{{ doneTasks }} / {{ totalTasks }}</b>任务进度</span>
              <span v-if="path.deadlineText" class="metric"><b>{{ path.deadlineText }}</b>目标周期</span>
            </div>
            <div class="hero__actions">
              <span
                v-if="currentTask && canLearn"
                class="btn-primary"
                @click="goLearn(currentTask.id)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                {{ currentTask.status === 'in_progress' ? '继续当前任务' : '开始学习' }}
              </span>
              <span
                v-if="canLearn"
                class="btn-ghost"
                title="按你的情况调整路径：重学、调整剩余或让 AI 按学习情况建议"
                @click="openAdjustDialog"
              >
                调整路径
              </span>
              <span v-else-if="allDone" class="btn-ghost">全部任务已完成</span>
            </div>
          </div>
          <div class="hero__ring">
            <svg viewBox="0 0 120 120" width="120" height="120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#edf1f8" stroke-width="10" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke="url(#v2ringGrad)" stroke-width="10" stroke-linecap="round"
                :stroke-dasharray="326.7" :stroke-dashoffset="326.7 * (1 - percent / 100)"
                transform="rotate(-90 60 60)"
              />
              <defs>
                <linearGradient id="v2ringGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#3478f6" />
                  <stop offset="100%" stop-color="#43b0d8" />
                </linearGradient>
              </defs>
            </svg>
            <div class="hero__ring-text"><b>{{ percent }}%</b><small>整体进度</small></div>
          </div>
        </section>

        <div class="detail__grid">
          <!-- 主列 -->
          <div class="stages-col">
            <!-- ===== 列表视图 ===== -->
          <div v-if="viewMode === 'list'" class="stages">
            <section v-if="!stages.length" class="stages__empty card">
              <span class="kicker">路径准备中</span>
              <strong>还没有阶段与任务</strong>
              <p>阶段与任务生成后，会在这里展示学习计划。请稍后刷新页面查看。</p>
            </section>
            <section v-for="(stage, si) in stages" :key="stage.id || si" class="stage card" :class="`stage--${stageStatus(stage, si)}`">
              <button type="button" class="stage__head" @click="toggleStage(si)">
                <span class="stage__no" :class="`stage__no--${stageStatus(stage, si)}`">
                  <svg v-if="stageStatus(stage, si) === 'done'" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                  <template v-else>{{ stageNo(stage, si) }}</template>
                </span>
                <span class="stage__title">
                  <strong>阶段 {{ stageNo(stage, si) }} · {{ stage.title }}</strong>
                  <small>{{ stage.goal || stage.description }}</small>
                </span>
                <span class="stage__prog">{{ stageDoneCount(stage) }} / {{ stageTasks(stage).length }}</span>
                <span class="stage__chev" :class="{ 'stage__chev--open': openStages.includes(si) }">⌄</span>
              </button>

              <div class="stage__body" :class="{ 'stage__body--open': openStages.includes(si) }">
                <div class="stage__body-inner">
                  <ul v-if="objectivesOf(stage).length" class="objectives">
                    <li v-for="(o, oi) in objectivesOf(stage)" :key="oi">{{ o }}</li>
                  </ul>
                  <div
                    v-for="task in stageTasks(stage)"
                    :key="task.id"
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
                    <small>{{ taskKindText(task) }} · 约 {{ task.estimatedMinutes || '—' }} 分钟</small>
                  </div>
                  <button type="button" v-if="task.id === currentTask?.id && canLearn" class="task__cta" @click="goLearn(task.id)">
                    {{ task.status === 'in_progress' ? '继续学习' : '开始学习' }}
                  </button>
                  <button type="button" v-else-if="task.status === 'completed'" class="task__done-label" @click="viewFeedback(task)">查看反馈</button>
                  <span v-else-if="taskCls(task) === 'locked'" class="task__lock-label">待解锁</span>
                  <button type="button" v-else-if="task.status === 'in_progress'" class="task__cta" @click="goLearn(task.id)">继续学习</button>
                  <span v-else class="task__todo-label">待开始</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- ===== 时间线视图 ===== -->
          <div v-else-if="viewMode === 'timeline'" class="stages tl">
            <section v-if="!stages.length" class="stages__empty card">
              <span class="kicker">路径准备中</span>
              <strong>还没有阶段与任务</strong>
              <p>阶段与任务生成后，会在这里展示学习计划。请稍后刷新页面查看。</p>
            </section>

            <!-- 开始节点 -->
            <div v-if="stages.length" class="tl__start">
              <span class="tl__node tl__node--start">○</span>
              <span class="tl__label">开始</span>
            </div>

            <!-- 阶段节点 -->
            <div
              v-for="(stage, si) in stages"
              :key="stage.id || si"
              class="tl__stage"
              :class="`tl__stage--${stageStatus(stage, si)}`"
            >
              <!-- 阶段头部 -->
              <div class="tl__row" @click="toggleTimelineStage(si)">
                <span class="tl__node tl__node--stage" :class="`tl__node--${stageStatus(stage, si)}`">
                  <svg v-if="stageStatus(stage, si) === 'done'" viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                </span>
                <div class="tl__info">
                  <div class="tl__head">
                    <strong class="tl__title">阶段{{ stageNo(stage, si) }}: {{ stage.title }}</strong>
                    <span v-if="stageStatus(stage, si) === 'done'" class="tl__badge tl__badge--done">
                      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>已完成
                    </span>
                    <span v-else-if="stageStatus(stage, si) === 'current'" class="tl__badge tl__badge--current">
                      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".9"/><path fill="currentColor" d="M10 16.5l6-4.5-6-4.5z"/></svg>进行中
                    </span>
                    <span v-else class="tl__badge tl__badge--locked">
                      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 0 1 6 0v3H9z"/></svg>待解锁
                    </span>
                  </div>
                  <small class="tl__desc">{{ stage.goal || stage.description }}</small>
                  <div class="tl__prog-bar">
                    <div class="tl__prog-fill" :style="{ width: stagePercent(stage) + '%' }"></div>
                  </div>
                  <small class="tl__prog-text">{{ stageDoneCount(stage) }} / {{ stageTasks(stage).length }} 完成</small>
                </div>
                <span class="tl__chev" :class="{ 'tl__chev--open': timelineOpenStages.includes(si) }">⌄</span>
              </div>

              <!-- 已完成阶段折叠摘要：不展开任务，只保留「走过」的印记 -->
              <div v-if="stageStatus(stage, si) === 'done' && !timelineOpenStages.includes(si)" class="tl__done-summary">
                <span>✓ 本阶段 {{ stageTasks(stage).length }} 个任务已完成</span>
                <button type="button" class="tl__done-review" @click="timelineOpenStages.push(si)">回顾任务</button>
              </div>

              <!-- 任务列表 -->
              <div class="tl__tasks" :class="{ 'tl__tasks--open': timelineOpenStages.includes(si) }">
                <div class="tl__tasks-inner">
                  <div
                    v-for="task in stageTasks(stage)"
                    :key="task.id"
                    class="tl__task"
                    :class="`tl__task--${taskCls(task)}`"
                    @click="onTaskClick(task)"
                  >
                    <span class="tl__task-connector"></span>
                    <span class="tl__task-dot" :class="`tl__task-dot--${taskCls(task)}`">
                      <svg v-if="task.status === 'completed'" viewBox="0 0 24 24" width="8" height="8"><path fill="#fff" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                      <span v-else-if="taskCls(task) === 'current'" class="tl__task-spinner"></span>
                    </span>
                    <div class="tl__task-body">
                      <strong>{{ task.title || task.displayLabel }}</strong>
                      <small>{{ taskKindText(task) }} · {{ task.estimatedMinutes || '—' }}分钟</small>
                    </div>
                    <span class="tl__step-no" aria-hidden="true">第 {{ globalTaskNo(task) }} 步</span>
                    <span class="tl__task-status">
                      <template v-if="task.status === 'completed'">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg> 已完成
                      </template>
                      <template v-else-if="taskCls(task) === 'current'">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" opacity=".9"/><path fill="currentColor" d="M10 16.5l6-4.5-6-4.5z"/></svg> 当前
                      </template>
                      <template v-else-if="taskCls(task) === 'locked'">
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 0 1 6 0v3H9z"/></svg>
                      </template>
                      <template v-else>○ 待开始</template>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 完成节点 -->
            <div v-if="stages.length" class="tl__end" :class="{ 'tl__end--done': allDone }">
              <span class="tl__node tl__node--end" :class="{ 'tl__node--end-done': allDone }">{{ allDone ? '✓' : '○' }}</span>
              <span class="tl__label" :class="{ 'tl__label--done': allDone }">完成</span>
            </div>
          </div>
          </div><!-- /stages-col -->

          <!-- 侧栏 -->
          <aside class="side">
            <section v-if="!stages.length" class="card sidecard">
              <span class="kicker">路径状态</span>
              <p class="chart__empty">暂无任务安排</p>
            </section>

            <section v-if="currentTask" class="card sidecard sidecard--current">
              <span class="kicker">当前任务</span>
              <strong>{{ currentTask.title || currentTask.displayLabel }}</strong>
              <p>完成后还剩 {{ remainingAfterCurrent }} 个任务。</p>
              <div class="sidecard__meta">
                <span class="tag tag--blue">约 {{ currentTask.estimatedMinutes || '—' }} 分钟</span>
                <span class="tag">{{ taskKindText(currentTask) }}</span>
              </div>
              <button type="button" v-if="canLearn" class="btn-primary btn-primary--block" @click="goLearn(currentTask.id)">开始学习</button>
            </section>

            <section v-if="nextTasks.length" class="card sidecard">
              <span class="kicker">接下来的任务</span>
              <ol class="next-list">
                <li v-for="t in nextTasks" :key="t.id">
                  <strong>{{ t.title || t.displayLabel }}</strong>
                  <small>{{ t.estimatedMinutes || '—' }} 分钟</small>
                </li>
              </ol>
            </section>

            <section v-if="sceneSummary" class="card sidecard">
              <span class="kicker">设计意图</span>
              <strong v-if="sceneSummaryTitle" class="sidecard__intent-title">{{ sceneSummaryTitle }}</strong>
              <dl v-if="sceneRows.length" class="sidecard__rows">
                <div v-for="row in sceneRows" :key="row.label" class="sidecard__row">
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </template>
    </main>

    <!-- 调整路径弹窗：三场景（学不好重来 / 学了些调剩余 / 系统按学习情况建议） -->
    <div v-if="adjustDialogOpen" class="adjust-dialog-mask" @click.self="adjustDialogOpen = false">
      <div class="adjust-dialog card">
        <div class="adjust-dialog__head">
          <div>
            <h3 class="adjust-dialog__title">调整这条路径</h3>
            <p class="adjust-dialog__desc">说说你的情况和想法，选一种调整方式。已学完的内容我们会帮你保留衔接。</p>
          </div>
          <button type="button" class="adjust-dialog__close" aria-label="关闭" @click="adjustDialogOpen = false">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <!-- 挡路课堂清场视图：有未结束课堂时先处理，处理完自动重试原调整 -->
        <div v-if="blockingSessions.length" class="clear-sessions">
          <div class="clear-sessions__head">
            <span class="clear-sessions__tag">还需要一步</span>
            <p>要调整的范围内还有未结束的课堂。结束它们后我们会自动继续刚才的调整；已结束的课堂不会受影响。</p>
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
            <button type="button" class="btn-ghost" :disabled="clearingSessions || retryingAfterClear" @click="dismissBlockingSessions; adjustMode = null">
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
          <p class="clear-sessions__hint">按「结束」会把未完成的课堂标记为放弃：不计入学习进度，对话内容仍保留在学习历史中。</p>
        </div>

        <!-- 场景选择 -->
        <div v-else-if="!adjustMode" class="adjust-modes">
          <button type="button" class="adjust-mode" :class="{ 'adjust-mode--warn': hasLearningProgress }" @click="selectAdjustMode('rebuild')">
            <span class="adjust-mode__icon" aria-hidden="true">↺</span>
            <span class="adjust-mode__body">
              <strong>学得不好，想重新来一遍</strong>
              <small>整条路径按新说明重新规划，从头开始；已学部分会保留在历史记录里作参考。</small>
            </span>
            <span class="adjust-mode__arrow" aria-hidden="true">›</span>
          </button>
          <button type="button" class="adjust-mode" @click="selectAdjustMode('reshape')">
            <span class="adjust-mode__icon" aria-hidden="true">⇄</span>
            <span class="adjust-mode__body">
              <strong>学了一些，想调整剩余部分</strong>
              <small>已完成的阶段/任务原样保留；可只调当前阶段，或从某个未学阶段起把后面的课程一起按新说明调整。</small>
            </span>
            <span class="adjust-mode__arrow" aria-hidden="true">›</span>
          </button>
          <button type="button" class="adjust-mode" @click="selectAdjustMode('auto')">
            <span class="adjust-mode__icon" aria-hidden="true">✦</span>
            <span class="adjust-mode__body">
              <strong>让 AI 看我的学习情况来建议</strong>
              <small>结合你的掌握度、节奏与卡点，由 AI 判断该补基础、放缓还是换路径。</small>
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
            <button type="button" class="adjust-form__back" @click="adjustMode = null">← 换一种方式</button>
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
              <button
                type="button"
                class="adjust-scope__opt"
                :class="{ 'is-on': adjustScope === 'from' }"
                @click="adjustScope = 'from'"
              >
                <strong>自选起始阶段</strong>
                <small>从你指定的某个未学阶段起调整，之前的计划保持不变</small>
              </button>
            </div>
            <div v-if="adjustScope === 'from'" class="adjust-scope__picker">
              <span>从第</span>
              <select v-model.number="adjustFromStage" class="adjust-scope__select">
                <option v-for="(opt, oi) in reshapeFromOptions" :key="oi" :value="opt.stageNumber">
                  {{ opt.stageNumber }} 阶段{{ opt.title ? ` · ${opt.title}` : '' }}
                </option>
              </select>
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
          </template>
        </template>
      </div>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { learningAPI } from '@/api/learning';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { toast } from '@/utils/toast';
import { askConfirm } from '@/views/admin-redesign/useConfirm';
import {
  getReplanActionText,
  getReplanPriorityText,
  getReplanRecommendationText,
  getReplanReasonCodeLabels,
  getReplanScopeText,
} from '@/utils/replanSignal';
import V2Nav from './V2Nav.vue';
import V2Footer from './V2Footer.vue';
import AiContentNote from '@/components/AiContentNote.vue';

const route = useRoute();
const router = useRouter();
const pathId = ref(String(route.params.id || ''));

const path = ref<Record<string, any> | null>(null);
const lifecycle = ref<Record<string, any> | null>(null);
const loading = ref(true);
const loadError = ref(false);
const retrying = ref(false);
const openStages = ref<number[]>([]);

/* ---------- 视图切换 ---------- */
const viewMode = ref<'list' | 'timeline'>((() => {
  try { return (localStorage.getItem('v2_path_view') || 'list') as 'list' | 'timeline'; } catch { return 'list'; }
})());
const timelineOpenStages = ref<number[]>([]);

function setView(mode: 'list' | 'timeline') {
  viewMode.value = mode;
  try { localStorage.setItem('v2_path_view', mode); } catch { /* ignore */ }
}

function toggleTimelineStage(si: number) {
  const i = timelineOpenStages.value.indexOf(si);
  if (i >= 0) timelineOpenStages.value.splice(i, 1);
  else timelineOpenStages.value.push(si);
}

function stagePercent(stage: Record<string, any>): number {
  const tasks = stageTasks(stage);
  if (!tasks.length) return 0;
  return Math.round((tasks.filter(t => t.status === 'completed').length / tasks.length) * 100);
}

/** 任务在整条路径中的全局序号（时间线「第 N 步」叙事） */
function globalTaskNo(task: Record<string, any>): number {
  let n = 0;
  for (const s of stages.value) {
    for (const t of stageTasks(s)) {
      n += 1;
      if (t.id === task.id) return n;
    }
  }
  return n;
}

function onTaskClick(task: Record<string, any>) {
  const cls = taskCls(task);
  if (cls === 'locked') return;
  goLearn(task.id);
}

const pathTitle = computed(() => path.value?.title || path.value?.name || '');

async function load(silent = false) {
  if (!silent) loading.value = true;
  loadError.value = false;
  try {
    const p = await learningAPI.getPathDetail(pathId.value) as unknown as Record<string, any>;
    path.value = p;
    lifecycle.value = p.generationLifecycle ?? null;
    if (p.generationLifecycle && p.generationLifecycle.phase !== 'ready') {
      if (p.generationLifecycle.status === 'processing' || p.generationLifecycle.status === 'queued') {
        schedulePoll();
      }
    }
    // 默认展开：第一个未完成的阶段 + 当前阶段
    const idx = stages.value.findIndex((s) => stageStatusRaw(s) !== 'done');
    openStages.value = idx >= 0 ? [...new Set([Math.max(0, idx - 1), idx])] : stages.value.map((_, i) => i);
    // 时间线视图：只展开当前阶段（进行中/当前），已完成阶段保持折叠 —— 轨迹感：走过的收起来，聚焦脚下
    timelineOpenStages.value = stages.value
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => stageStatus(s, i) === 'current')
      .map(({ i }) => i);
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
const canLearn = computed(() => !lifecycle.value || lifecycle.value.phase === 'ready');

/* ---------- 生成轮询 ---------- */
let pollTimer = 0;
function schedulePoll() {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(pollOnce, 5000);
}
async function pollOnce() {
  try {
    const lc = await learningAPI.getPathGenerationStatus(pathId.value) as unknown as Record<string, any>;
    if (lc.phase === 'ready' || lc.status === 'failed' || lc.status === 'stale') {
      // 生成完成/失败：静默刷新详情，避免整页 loading 闪烁
      await load(true);
      return;
    }
    lifecycle.value = lc;
  } catch { /* ignore */ }
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
const adjustDialogOpen = ref(false);
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
  if (adjustMode.value === 'rebuild') return '例如：之前选的太偏理论，我其实更需要实操；这次想从真实项目入手重新规划……';
  if (adjustMode.value === 'reshape') return '例如：第二阶段太难了，先补一下基础再进入；或者从第 3 阶段起换成更多实操……';
  if (adjustMode.value === 'auto') return '例如：最近学得有点吃力，卡点主要在 X；帮我看看接下来怎么调整更合适……';
  return '说说你想怎么调整……';
});

const adjustConfirmText = computed(() => {
  if (adjustMode.value === 'rebuild') return hasLearningProgress.value ? '确认整条重建' : '确认重新规划';
  if (adjustMode.value === 'reshape') return '确认调整剩余部分';
  if (adjustMode.value === 'auto') return '让 AI 诊断并建议';
  return '确认';
});

function selectAdjustMode(mode: NonNullable<AdjustMode>) {
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
  try {
    const fromStageNumber = mode === 'reshape'
      ? (adjustScope.value === 'rest' && firstOpenStageNo.value
        ? firstOpenStageNo.value
        : (adjustScope.value === 'from' && adjustFromStage.value
          ? adjustFromStage.value
          : undefined))
      : undefined;
    pendingAdjustRetry.value = () => runAdjustIntent(mode, t, fromStageNumber, clearedSessionIds.value);
    await runAdjustIntent(mode, t, fromStageNumber);
  } catch (err: any) {
    const code = err?.response?.data?.error?.code;
    const sessions = err?.response?.data?.error?.details?.sessions;
    const msg = err?.response?.data?.error?.message || err?.message || '调整失败，请稍后再试';
    // 409：调整范围内有未结束课堂 → 弹窗内列出，供一键放弃后自动重试
    if (err?.response?.status === 409 && code === 'PATH_MUTATION_HAS_OPEN_SESSION' && Array.isArray(sessions) && sessions.length > 0) {
      clearedSessionIds.value = [];
      blockingSessions.value = sessions;
      adjusting.value = false;
      toast.info(`还有 ${sessions.length} 个未结束课堂，结束它们即可继续调整`);
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
      toast.error(res?.error?.message || '结束课堂失败，请稍后再试');
    }
    // 重新拉取仍挡路的课堂
    const leftover = (res?.data?.remaining) || [];
    if (leftover.length === 0) {
      blockingSessions.value = [];
      if (pendingAdjustRetry.value) {
        retryingAfterClear.value = true;
        toast.info('课堂已清理，正在重新提交调整…');
        await pendingAdjustRetry.value();
      }
    } else {
      blockingSessions.value = leftover;
    }
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || err?.message || '结束课堂失败，请稍后再试');
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
      toast.info('课堂已清理，正在重新提交调整…');
      await pendingAdjustRetry.value();
    } else {
      blockingSessions.value = leftover;
      toast.error(`还有 ${leftover.length} 个课堂未能结束，请稍后重试`);
    }
  } catch (err: any) {
    toast.error(err?.response?.data?.error?.message || err?.message || '结束课堂失败，请稍后再试');
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
      mode: 'overwrite',
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
    toast.error(err?.response?.data?.error?.message || err?.message || '调整失败，请稍后再试');
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
const allDone = computed(() => totalTasks.value > 0 && doneTasks.value === totalTasks.value);

const currentTask = computed(() => {
  const inProgress = allTasks.value.find((t) => t.status === 'in_progress');
  if (inProgress) return inProgress;
  return allTasks.value.find((t) => t.status === 'todo' || !t.status) ?? null;
});

const currentStageNo = computed(() => {
  if (!currentTask.value) return stages.value.length;
  const idx = stages.value.findIndex((s) => stageTasks(s).some((t) => t.id === currentTask.value?.id));
  return idx >= 0 ? stageNo(stages.value[idx], idx) : 1;
});

const remainingAfterCurrent = computed(() => {
  if (!currentTask.value) return 0;
  const idx = allTasks.value.findIndex((t) => t.id === currentTask.value?.id);
  return Math.max(0, allTasks.value.length - idx - 1);
});

const nextTasks = computed(() => {
  if (!currentTask.value) return [];
  const idx = allTasks.value.findIndex((t) => t.id === currentTask.value?.id);
  return allTasks.value.slice(idx + 1, idx + 4);
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

const sceneRows = computed(() => {
  const s = sceneSummary.value;
  if (!s || typeof s === 'string') return [];
  const rows: Array<{ label: string; value: string }> = [];
  if (s.firstDeliverable) rows.push({ label: '第一阶段产出', value: String(s.firstDeliverable) });
  if (s.targetState) rows.push({ label: '目标状态', value: String(s.targetState) });
  if (Array.isArray(s.planningFocus) && s.planningFocus.length) rows.push({ label: '规划焦点', value: s.planningFocus.join('、') });
  // 注意：excludedScope/「先不学」不展示——不学的内容无需让用户确认，避免不必要的顾虑（与 goal 预览一致）
  if (s.timeBudget) rows.push({ label: '时间预算', value: String(s.timeBudget) });
  if (s.timeHorizon) rows.push({ label: '时间跨度', value: String(s.timeHorizon) });
  return rows;
});

/* ---------- 展示辅助 ---------- */
const badgeText = computed(() => {
  if (lifecycle.value && lifecycle.value.phase !== 'ready') return lifecycleFailed.value ? '需要处理' : '生成中';
  if (allDone.value) return '已完成';
  return '进行中';
});
const badgeCls = computed(() => {
  if (lifecycle.value && lifecycle.value.phase !== 'ready') return lifecycleFailed.value ? 'badge--red' : 'badge--cyan';
  if (allDone.value) return 'badge--green';
  return 'badge--blue';
});

function taskCls(task: Record<string, any>) {
  if (task.status === 'completed') return 'completed';
  if (task.status === 'in_progress') return 'current';
  if (currentTask.value && task.id === currentTask.value.id) return 'current';
  if (!canLearn.value) return 'locked';
  const curIdx = allTasks.value.findIndex((t) => t.id === currentTask.value?.id);
  const myIdx = allTasks.value.findIndex((t) => t.id === task.id);
  return curIdx >= 0 && myIdx > curIdx ? 'locked' : 'todo';
}

function taskKindText(task: Record<string, any>) {
  return task.displayLabel || task.taskType || task.knowledgeType || '任务';
}

function goLearn(taskId: string) {
  router.push(`/learn/${taskId}`);
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
    message: '这节课还没有生成学习反馈，可能是结算尚未完成。你可以回看学习历史；想继续学这个任务，也可以直接点任务卡片重新进入。',
    confirmText: '回看学习历史',
    danger: false,
  });
  if (go) router.push('/learning-history');
}

onMounted(load);
onBeforeUnmount(() => window.clearTimeout(pollTimer));
</script>

<style scoped>
/* wrapper 沉底：AI 提示与页脚一起贴近底部 */
.detail__foot { margin-top: auto; }
.detail__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.detail__ai-note :deep(.ai-note) { font-size: 11px; opacity: 0.75; }

.detail__main {
  max-width: 1080px; margin: 0 auto;
  padding: 20px 28px 48px;
  display: grid; gap: 16px;
}
.crumbs { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--faint); }
.crumbs__back { font-weight: 600; color: var(--muted); cursor: pointer; }
.crumbs__back:hover { color: var(--blue-deep); }
.crumbs__current { color: var(--ink); font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumbs__toggle { flex: 0 0 auto; margin-left: auto; }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}
.kicker { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }
.badge { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; }
.badge--blue { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }

.hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; padding: 26px 28px; align-items: center; }
.hero__tags { display: flex; align-items: center; gap: 10px; }
.hero h1 { margin: 8px 0 6px; font-size: 28px; letter-spacing: -0.01em; }
.hero p { margin: 0; font-size: 14px; color: var(--muted); line-height: 1.7; max-width: 56ch; }
.hero__metrics { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.metric {
  display: grid; gap: 2px;
  padding: 9px 14px;
  background: var(--canvas, #f7faff); border: 1px solid var(--line, #e8eefb);
  border-radius: 12px;
  font-size: 11.5px; color: var(--faint);
}
.metric b { font-size: 14px; color: var(--ink); }
.hero__actions { display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 14px; font-weight: 700;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
  cursor: pointer; text-decoration: none;
}
.btn-primary--block { justify-content: center; width: 100%; }
.btn-ghost {
  padding: 10px 18px; border-radius: 12px;
  border: 1px solid var(--line); background: var(--surface, #fff);
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}
.hero__ring { position: relative; width: 120px; height: 120px; }
.hero__ring circle[stroke="url(#v2ringGrad)"] { transition: stroke-dashoffset .6s ease; }
.hero__ring-text {
  position: absolute; inset: 0;
  display: grid; place-content: center; text-align: center; gap: 2px;
}
.hero__ring-text b { font-size: 22px; }
.hero__ring-text small { font-size: 11px; color: var(--faint); }

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
  color: var(--ink, #172033);
}

.stages__empty p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted, #5b6577);
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
  width: 30px; height: 30px; border-radius: 10px;
  background: #eef2f8; color: var(--faint);
  font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
}
.stage__no--done { background: var(--green); color: #fff; }
.stage__no--current { background: linear-gradient(135deg, var(--blue), var(--blue-deep)); color: #fff; box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.13); }
.stage__title strong { display: block; font-size: 14.5px; }
.stage__title small { display: block; margin-top: 2px; font-size: 12px; color: var(--faint); }
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
  display: grid; grid-template-columns: 24px 1fr auto;
  align-items: center; gap: 11px;
  padding: 9px 10px;
  border-radius: 11px;
  border: 1px solid transparent;
}
.task--current { background: rgba(52, 120, 246, 0.06); border-color: rgba(52, 120, 246, 0.2); }
.task--locked { opacity: .62; }
.task__icon {
  width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center;
}
.task--completed .task__icon { background: var(--green); color: #fff; }
.task--current .task__icon { border: 2px solid var(--blue); box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.14); }
.task--todo .task__icon { border: 2px dashed #cfdaee; }
.task--locked .task__icon { color: var(--faint); background: #eef2f8; }
.task__body strong { display: block; font-size: 13.5px; }
.task__body small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--faint); }
.task__cta {
  font-size: 12px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  padding: 6px 13px; border-radius: 9px;
  cursor: pointer;
  box-shadow: 0 6px 14px rgba(52, 120, 246, 0.25);
}
.task__done-label { font-size: 12px; font-weight: 600; color: var(--green); cursor: pointer; }
.task__lock-label, .task__todo-label { font-size: 12px; color: var(--faint); }

.side { display: grid; gap: 12px; position: sticky; top: 16px; }
.sidecard { padding: 16px 18px; display: grid; gap: 10px; align-content: start; }
.sidecard strong { font-size: 14.5px; line-height: 1.5; }
.sidecard p { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.65; }
.sidecard__meta { display: flex; gap: 8px; flex-wrap: wrap; }
.sidecard--current { border-color: rgba(52, 120, 246, 0.3); }
.tag {
  padding: 4px 10px; border-radius: 999px;
  background: var(--line, #f1f5fb); border: 1px solid var(--line);
  font-size: 11.5px; font-weight: 600; color: var(--muted);
}
.tag--blue { background: rgba(52, 120, 246, 0.09); border-color: rgba(52, 120, 246, 0.3); color: var(--blue-deep); }
.next-list { margin: 0; padding: 0 0 0 18px; display: grid; gap: 9px; }
.next-list strong { display: block; font-size: 13px; line-height: 1.45; }
.next-list small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--faint); }
.sidecard__sum { font-size: 12px; font-weight: 700; color: var(--muted); border-top: 1px dashed var(--line); padding-top: 9px; }
.sidecard__text { font-size: 13px; }
.sidecard__intent-title { font-size: 14px; line-height: 1.5; }
.sidecard__rows { margin: 0; display: grid; gap: 8px; }
.sidecard__row { display: grid; gap: 2px; }
.sidecard__row dt { font-size: 11px; font-weight: 800; color: var(--faint); letter-spacing: 0.03em; }
.sidecard__row dd { margin: 0; font-size: 12.5px; line-height: 1.65; color: var(--muted); }

@media (max-width: 900px) {
  .detail__main { padding: 14px 14px 32px; }
  .hero { grid-template-columns: 1fr; }
  .hero__ring { justify-self: center; }
  .hero h1 { font-size: 22px; }
  .detail__grid { grid-template-columns: 1fr; }
  .side { position: static; }
}
</style>

<style scoped>
.detail__loading { display: grid; justify-items: center; gap: 12px; padding: 64px 0; color: var(--faint); font-size: 13px; }
.badge--green { color: #1d7a4c; background: rgba(49, 177, 111, 0.12); }
.badge--cyan { color: #2b7a99; background: rgba(67, 176, 216, 0.14); }
.badge--red { color: #c0454a; background: rgba(239, 117, 120, 0.12); }
.genbar {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 20px;
}
.genbar--failed { border-color: rgba(239, 117, 120, 0.35); }
.genbar__text { flex: 1; }
.genbar__text strong { font-size: 14px; }
.genbar__text p { margin: 4px 0 0; font-size: 12.5px; color: var(--muted); }
.objectives {
  margin: 0 0 8px; padding: 10px 12px 10px 28px;
  background: var(--canvas, #f7faff); border: 1px solid var(--line, #e8eefb); border-radius: 10px;
  display: grid; gap: 4px;
}
.objectives li { font-size: 12.5px; color: var(--muted); line-height: 1.55; }
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
/* ===== 主内容列（列表/时间线共用的容器） ===== */
.stages-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ===== 视图切换（小型分段控件） ===== */
.view-toggle {
  display: inline-flex;
  gap: 2px;
  background: color-mix(in srgb, var(--line, #e4e9f2) 45%, transparent);
  border-radius: 8px;
  padding: 2px;
  width: fit-content;
}
.view-toggle__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: none; border-radius: 6px;
  background: transparent;
  font-size: 12px; font-weight: 500;
  line-height: 1.4;
  color: var(--muted, #5b6577);
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
}
.view-toggle__btn svg { opacity: 0.75; }
.view-toggle__btn:hover { color: var(--ink, #172033); }
.view-toggle__btn--active {
  background: var(--surface, #fff);
  color: var(--ink, #172033);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.12);
}
.view-toggle__btn--active svg { opacity: 1; }

/* ===== 时间线容器 ===== */
.tl {
  position: relative;
  display: flex; flex-direction: column;
  gap: 0;
  padding: 0 0 0 8px;
}

/* 垂直时间线连接线 */
.tl::before {
  content: '';
  position: absolute;
  left: 19px; top: 16px; bottom: 16px;
  width: 2px;
  background: var(--line, #e4e9f2);
  border-radius: 1px;
}

/* ===== 开始 / 完成端点 ===== */
.tl__start, .tl__end {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 0;
  position: relative; z-index: 1;
}
.tl__node {
  width: 12px; height: 12px; border-radius: 50%;
  display: grid; place-items: center;
  flex-shrink: 0;
  font-size: 10px; line-height: 1;
}
.tl__node--start {
  border: 2px solid var(--blue, #3478f6);
  background: var(--surface, #fff);
  color: var(--blue, #3478f6);
}
.tl__node--end {
  border: 2px solid var(--faint, #b0b8c8);
  background: var(--surface, #fff);
  color: var(--faint, #b0b8c8);
  font-size: 9px;
}
.tl__node--end-done {
  border-color: var(--green, #31b16f);
  background: var(--green, #31b16f);
  color: #fff;
}
.tl__label {
  font-size: 13px; font-weight: 700;
  color: var(--muted, #5b6577);
}
.tl__label--done { color: var(--green, #31b16f); }

/* ===== 阶段节点 ===== */
.tl__stage {
  position: relative; z-index: 1;
  padding: 4px 0;
}
.tl__row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 10px 14px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.tl__row:hover { background: rgba(52, 120, 246, 0.04); }

/* 阶段圆形节点 */
.tl__node--stage {
  width: 14px; height: 14px; border-radius: 50%;
  margin-top: 3px;
  flex-shrink: 0;
  transition: box-shadow 0.3s, border-color 0.3s, background 0.3s;
}
.tl__node--done {
  border: none;
  background: var(--blue, #3478f6);
  color: #fff;
}
.tl__node--current {
  border: 3px solid var(--blue, #3478f6);
  background: var(--surface, #fff);
  box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.18);
  animation: tl-pulse 2s ease-in-out infinite;
}
.tl__node--todo {
  border: 2px solid var(--faint, #b0b8c8);
  background: var(--surface, #fff);
  color: var(--faint, #b0b8c8);
}

@keyframes tl-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.18); }
  50%      { box-shadow: 0 0 0 8px rgba(52, 120, 246, 0.08); }
}

/* 阶段信息区 */
.tl__info { flex: 1; min-width: 0; }
.tl__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tl__title { font-size: 14.5px; color: var(--ink, #172033); }
.tl__desc { display: block; margin-top: 2px; font-size: 12.5px; color: var(--faint, #b0b8c8); line-height: 1.5; }

/* 状态徽章（图标 + 文字对齐） */
.tl__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px; font-weight: 700;
  white-space: nowrap;
}
.tl__badge--done { background: rgba(49, 177, 111, 0.1); color: #1d7a4c; }
.tl__badge--current { background: rgba(52, 120, 246, 0.1); color: var(--blue-deep, #2563eb); }
.tl__badge--locked { background: var(--line, #f1f5fb); color: var(--muted, #5b6577); }

/* 进度条 */
.tl__prog-bar {
  margin-top: 8px;
  height: 4px; border-radius: 2px;
  background: var(--line, #e4e9f2);
  overflow: hidden;
}
.tl__prog-fill {
  height: 100%; border-radius: 2px;
  background: linear-gradient(90deg, var(--blue, #3478f6), var(--blue-deep, #2563eb));
  transition: width 0.4s ease;
}
.tl__prog-text {
  display: block; margin-top: 4px;
  font-size: 11.5px; color: var(--faint, #b0b8c8);
}

/* 展开/折叠箭头 */
.tl__chev {
  margin-top: 4px;
  color: var(--faint, #b0b8c8);
  font-size: 14px;
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
.tl__chev--open { transform: rotate(180deg); }

/* 左边框：已完成/进行中蓝色，待解锁灰色 */
.tl__stage--done .tl__row,
.tl__stage--current .tl__row {
  border-left: 3px solid var(--blue, #3478f6);
  margin-left: 13px; padding-left: 11px;
}
.tl__stage--todo .tl__row {
  border-left: 3px solid var(--faint, #b0b8c8);
  margin-left: 13px; padding-left: 11px;
}

/* ===== 任务列表（可展开） ===== */
.tl__tasks {
  display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows 0.32s cubic-bezier(0.32, 0.72, 0.24, 1);
}
.tl__tasks--open { grid-template-rows: 1fr; }
.tl__tasks-inner {
  overflow: hidden; min-height: 0;
  padding-left: 32px;
  display: grid; gap: 2px;
}

/* 单个任务行 */
.tl__task {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}
.tl__task:hover { background: rgba(52, 120, 246, 0.04); }
.tl__task--locked { opacity: 0.55; cursor: not-allowed; }

/* 任务连接线 */
.tl__task-connector {
  position: absolute;
  left: -8px; top: 0; bottom: 0;
  width: 2px;
  background: var(--line, #e4e9f2);
}

/* 任务节点圆点 */
.tl__task-dot {
  width: 8px; height: 8px; border-radius: 50%;
  display: grid; place-items: center;
  flex-shrink: 0;
  position: relative; z-index: 1;
}
.tl__task-dot--completed {
  background: var(--green, #31b16f);
}
.tl__task-dot--current {
  background: var(--blue, #3478f6);
  box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.2);
  animation: tl-dot-pulse 1.5s ease-in-out infinite;
}
.tl__task-dot--todo {
  border: 2px dashed #cfdaee;
  background: var(--surface, #fff);
}
.tl__task-dot--locked {
  background: var(--faint, #b0b8c8);
  opacity: 0.4;
}

@keyframes tl-dot-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.2); }
  50%      { box-shadow: 0 0 0 6px rgba(52, 120, 246, 0.08); }
}

/* 任务文本 */
.tl__task-body { flex: 1; min-width: 0; }
.tl__task-body strong { display: block; font-size: 13px; color: var(--ink, #172033); }
.tl__task-body small { display: block; margin-top: 1px; font-size: 11.5px; color: var(--faint, #b0b8c8); }

/* 任务状态标签（图标 + 文字对齐） */
.tl__task-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px; font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 旋转指示器 */
.tl__task-spinner {
  display: block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--blue, #3478f6);
  animation: tl-spin 1s linear infinite;
}

/* 时间线「第 N 步」全局步序 */
.tl__step-no {
  flex: 0 0 auto;
  font-size: 10.5px; font-weight: 600;
  color: var(--faint, #b0b8c8);
  margin-right: 2px;
}

/* 已完成阶段折叠摘要（时间线） */
.tl__done-summary {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 14px 9px 46px;
  font-size: 12px; color: var(--green, #1e9e58);
}
.tl__done-review {
  border: 0; background: transparent;
  font: inherit; font-size: 12px; font-weight: 700;
  color: var(--blue-deep, #1f57cc);
  cursor: pointer;
  padding: 2px 4px;
}
.tl__done-review:hover { text-decoration: underline; }

@keyframes tl-spin {
  0%   { box-shadow: 0 0 0 0 var(--blue, #3478f6); }
  50%  { box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.3); }
  100% { box-shadow: 0 0 0 0 var(--blue, #3478f6); }
}

/* ===== 移动端适配 ===== */
@media (max-width: 900px) {
  .view-toggle { width: auto; }
  .view-toggle__btn { flex: none; font-size: 12px; }
  .crumbs { flex-wrap: wrap; row-gap: 6px; }
  .tl__row { padding: 8px 10px; gap: 10px; }
  .tl__step-no { display: none; }
  .tl__title { font-size: 13.5px; }
  .tl__badge { font-size: 10px; padding: 2px 6px; }
  .tl__tasks-inner { padding-left: 24px; }
  .tl__task-status { font-size: 10px; }
}

/* ===== 补充说明调整弹窗 ===== */
.adjust-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(10, 20, 40, 0.45);
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
.adjust-dialog__title {
  margin: 0 0 8px;
  font-size: 17px;
}
.adjust-dialog__desc {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
  color: #5a6b85;
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
  border: 0; border-radius: 8px;
  background: transparent; color: #8492ab;
  display: grid; place-items: center;
  cursor: pointer;
}
.adjust-dialog__close:hover { background: rgba(23, 32, 51, 0.06); color: #1c2b45; }
/* 三场景卡片选择 */
.adjust-modes { display: grid; gap: 8px; margin-top: 4px; }
.adjust-mode {
  display: flex; align-items: center; gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #dde5f1; border-radius: 12px;
  background: #fff; text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  font: inherit;
}
.adjust-mode:hover { border-color: #8db3f8; background: #f7faff; box-shadow: 0 2px 10px rgba(52, 120, 246, 0.08); }
.adjust-mode--warn .adjust-mode__icon {
  color: #b3540a;
  background: rgba(244, 170, 70, 0.16);
}
.adjust-mode__icon {
  flex: 0 0 auto;
  width: 34px; height: 34px; border-radius: 10px;
  display: grid; place-items: center;
  font-size: 16px; font-weight: 700; color: #3478f6;
  background: rgba(52, 120, 246, 0.1);
}
.adjust-mode__body { flex: 1; min-width: 0; display: grid; gap: 2px; }
.adjust-mode__body strong { font-size: 13.5px; color: #1c2b45; }
.adjust-mode__body small { font-size: 12px; line-height: 1.55; color: #67758f; }
.adjust-mode__arrow { color: #b6c2d6; font-size: 16px; }
/* 选中场景后的头部提示 */
.adjust-form__mode-hint {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 10px;
  padding: 7px 12px;
  font-size: 12.5px; font-weight: 700;
  border-radius: 999px;
  color: #1f57cc; background: rgba(52, 120, 246, 0.1);
}
.adjust-form__mode-hint--rebuild { color: #b3540a; background: rgba(244, 170, 70, 0.14); }
.adjust-form__mode-hint--auto { color: #6b4ae0; background: rgba(141, 107, 255, 0.1); }
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
  font-size: 12.5px; line-height: 1.6;
  color: #9a4b08;
  background: rgba(244, 170, 70, 0.12);
  border: 1px solid rgba(244, 170, 70, 0.35);
  border-radius: 10px;
}
.adjust-form__hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #8492ab;
  text-align: right;
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
  font-size: 10.5px; font-weight: 800;
  color: #b3540a;
  background: rgba(244, 170, 70, 0.14);
  border: 1px solid rgba(244, 170, 70, 0.35);
  padding: 2px 8px; border-radius: 999px;
}
.clear-sessions__head p {
  margin: 0;
  font-size: 12.5px; line-height: 1.6;
  color: #5a6b85;
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
  border: 1px solid #e3e9f2;
  border-radius: 10px;
  background: #fff;
}
.clear-sessions__item-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.clear-sessions__item-main strong {
  font-size: 12.5px; font-weight: 700;
  color: #1c2b45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clear-sessions__item-main .uc-badge { justify-self: start; }
.clear-sessions__hint {
  margin: 0;
  font-size: 11px; line-height: 1.6;
  color: #8492ab;
}
.btn-primary--sm {
  flex: 0 0 auto;
  font-size: 12px;
  padding: 7px 12px;
  border-radius: 8px;
}
[data-theme='dark'] .clear-sessions__head p { color: #9aa8bf; }
[data-theme='dark'] .clear-sessions__item {
  background: #141c2b;
  border-color: #27344d;
}
[data-theme='dark'] .clear-sessions__item-main strong { color: #e6edf7; }

/* reshape 调整范围选择 */
.adjust-scope {
  margin-bottom: 12px;
}
.adjust-scope__label {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 800;
  color: #5a6b85;
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
  border: 1px solid #e3e9f2;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.adjust-scope__opt strong { font-size: 12.5px; color: #1c2b45; }
.adjust-scope__opt small { font-size: 11px; line-height: 1.5; color: #8492ab; }
.adjust-scope__opt:hover { border-color: #c9d6ea; }
.adjust-scope__opt.is-on {
  border-color: rgba(141, 107, 255, 0.55);
  box-shadow: 0 0 0 2px rgba(141, 107, 255, 0.12);
}
.adjust-scope__opt.is-on strong { color: #6b4ae0; }
.adjust-scope__picker {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #5a6b85;
}
.adjust-scope__select {
  max-width: 300px;
  padding: 5px 8px;
  border: 1px solid #d6dfeb;
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  color: #1c2b45;
}
[data-theme='dark'] .adjust-scope__label { color: #9aa8bf; }
[data-theme='dark'] .adjust-scope__opt {
  background: #141c2b;
  border-color: #27344d;
}
[data-theme='dark'] .adjust-scope__opt strong { color: #e6edf7; }
[data-theme='dark'] .adjust-scope__opt small { color: #7c8aa3; }
[data-theme='dark'] .adjust-scope__select {
  background: #141c2b;
  border-color: #33405c;
  color: #e6edf7;
}
/* AI 诊断建议卡（auto 场景） */
.ai-advice {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid rgba(141, 107, 255, 0.25);
  background: linear-gradient(135deg, rgba(141, 107, 255, 0.06), rgba(52, 120, 246, 0.04));
  border-radius: 12px;
}
.ai-advice__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-advice__tag {
  flex: 0 0 auto;
  font-size: 10.5px; font-weight: 800;
  color: #6b4ae0;
  background: rgba(141, 107, 255, 0.12);
  border: 1px solid rgba(141, 107, 255, 0.3);
  padding: 2px 8px; border-radius: 999px;
}
.ai-advice__verdict {
  font-size: 14px; font-weight: 800;
  color: #6b4ae0;
}
.ai-advice__verdict--ok { color: #1e9e58; }
.ai-advice__rationale {
  margin: 0;
  font-size: 13px; line-height: 1.6;
  color: #1c2b45;
}
.ai-advice__detail {
  font-size: 12.5px; line-height: 1.6;
  color: #5a6b85;
  background: rgba(255, 255, 255, 0.55);
  border-radius: 8px;
  padding: 8px 10px;
}
.ai-advice__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.ai-advice__chip-label {
  font-size: 11px; font-weight: 700;
  color: #8492ab;
}
.ai-advice__chip {
  font-size: 11px; font-weight: 600;
  color: #1f57cc;
  background: rgba(52, 120, 246, 0.1);
  border-radius: 999px;
  padding: 2px 9px;
}
.ai-advice__chip--warn {
  color: #b3540a;
  background: rgba(244, 170, 70, 0.14);
  border: 1px solid rgba(244, 170, 70, 0.3);
}
.ai-advice__meta {
  font-size: 11.5px;
  color: #8492ab;
}
.ai-advice__actions { margin-top: 4px; }
[data-theme='dark'] .ai-advice__rationale { color: #e6edf7; }
[data-theme='dark'] .ai-advice__detail {
  color: #9aa8bf;
  background: rgba(15, 22, 32, 0.45);
}
[data-theme='dark'] .ai-advice { background: rgba(141, 107, 255, 0.08); }
.adjust-dialog__textarea {
  width: 100%;
  min-height: 96px;
  padding: 10px 12px;
  border: 1px solid #d9e1ee;
  border-radius: 8px;
  font-size: 13.5px;
  line-height: 1.6;
  resize: vertical;
  background: #fff;
  color: #1c2b45;
  box-sizing: border-box;
}
.adjust-dialog__textarea:focus {
  outline: none;
  border-color: #3478f6;
}
.adjust-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
.adjust-dialog .btn-primary--danger {
  background: linear-gradient(135deg, #e8604f, #cf3f2e);
  box-shadow: 0 8px 20px rgba(207, 63, 46, 0.25);
}
[data-theme='dark'] .adjust-mode {
  background: #182230;
  border-color: #2a3648;
}
[data-theme='dark'] .adjust-mode:hover { border-color: #4d8bf8; background: #1d2a3d; }
[data-theme='dark'] .adjust-mode__body strong { color: #e6edf7; }
[data-theme='dark'] .adjust-mode__body small { color: #9aa8bf; }
[data-theme='dark'] .adjust-dialog__desc { color: #9aa8bf; }
[data-theme='dark'] .adjust-dialog__textarea {
  background: #0f1620;
  border-color: #2a3648;
  color: #e6edf7;
}
[data-theme='dark'] .adjust-dialog__close:hover { background: rgba(230, 237, 247, 0.08); color: #e6edf7; }
</style>
