<template>
  <div class="mk-page cp">
    <div class="cp-head">
      <button type="button" class="cp-back" @click="closeSubPage">← {{ backLabel }}</button>
      <h1 class="cp-title">会话座舱 <span class="cp-title__id mono">{{ shortId }}</span></h1>
    </div>


    <!-- 控制台状态条 -->
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta mono">{{ shortId }}</span>
      <span class="mk-status__meta">{{ modeText }}</span>
      <span v-if="isRealMode" class="mk-status__meta">{{ realKindText }}</span>
      <span class="mk-status__meta">{{ statusText(terminalStatus) }}</span>
      <template v-if="isBlackbox">
        <span class="mk-status__meta">{{ blackboxTraceCount }} 条公开轨迹</span>
        <span class="mk-status__meta">{{ refereeTraceCount }} 条裁判轨迹</span>
        <span class="mk-status__meta">{{ privateStateTraceCount }} 条角色私有状态</span>
        <span v-if="refereeReports.length + actorAuditReports.length" class="mk-status__meta">
          {{ refereeReports.length + actorAuditReports.length }} 份终局评估
        </span>
      </template>
      <button type="button" class="mk-status__action" :disabled="busy" @click="refresh">
        <span v-if="busy"><span class="mk-spinner"></span> 执行中…</span>
        <span v-else>刷新</span>
      </button>
      <!-- 会话控制：暂停/恢复/重启/停止 -->
      <template v-if="!isRealMode && session?.status === 'running'">
        <button v-if="!isPaused" type="button" class="mk-status__action" :disabled="busy" @click="pauseSession">⏸ 暂停</button>
        <button v-else type="button" class="mk-status__action mk-status__action--primary" :disabled="busy" @click="resumeSession">▶ 继续</button>
        <button type="button" class="mk-status__action cp-danger" :disabled="busy" @click="stopLearning">⏹ 停止</button>
        <button type="button" class="mk-status__action" :disabled="busy" @click="restartLearning">🔄 重启</button>
      </template>
      <template v-else-if="!isRealMode && session?.status === 'failed'">
        <button type="button" class="mk-status__action mk-status__action--primary" :disabled="busy" @click="restartLearning">🔄 重启学习</button>
      </template>
      <button v-if="!isRealMode" type="button" class="mk-status__action cp-danger" :disabled="busy" @click="removeSession">
        <span v-if="busy"><span class="mk-spinner"></span> 执行中…</span>
        <span v-else>删除会话</span>
      </button>
    </div>

    <!-- 阶段进度（点击切换下方分页） -->
    <div class="cp-stages">
      <template v-for="(st, i) in stageFlow" :key="st">
        <div
          class="cp-stage"
          :class="[stageCls(st), { 'cp-stage--tab': !isBlackbox && activeTab === st, 'cp-stage--locked': isBlackbox }]"
          :title="isBlackbox ? '黑盒模式下阶段不可手动切换' : `查看${stageLabel(st)}`"
          role="button"
          tabindex="0"
          @click="selectStageTab(st)"
          @keydown.enter="selectStageTab(st)"
        >
          <span class="cp-stage__order">{{ String(i + 1).padStart(2, '0') }}</span>
          <strong>{{ stageLabel(st) }}</strong>
          <span class="cp-stage__state">{{ stageState(st) }}</span>
          <span v-if="stageProgress(st)" class="cp-stage__progress">{{ stageProgress(st) }}</span>
        </div>
        <span v-if="i < stageFlow.length - 1" class="cp-stage__arrow">→</span>
      </template>
    </div>

    <div class="cp-grid">
      <!-- 控制面板 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">推进控制</h3>
          <span class="mk-card__meta">{{ isRealMode ? '真实会话 · 只读' : isBlackbox ? '黑盒 API' : '辅助模拟' }}</span>
        </div>
        <div v-if="!isRealMode" class="cp-controls">
          <button v-if="!isBlackbox" type="button" class="cp-btn cp-btn--primary" :disabled="runFullDisabled" :title="runFullTitle" @click="act('runFull')">一键全流程</button>
          <button v-if="isBlackbox && !isTerminal" type="button" class="cp-btn cp-danger-btn" :disabled="busy" :title="busy ? '操作执行中' : '终止当前黑盒实验'" @click="act('abandon')">{{ busy ? '执行中…' : '放弃实验' }}</button>
          <button v-if="isBlackbox && isTerminal" type="button" class="cp-btn cp-btn--primary" :disabled="busy" :title="busy ? '操作执行中' : '生成终局裁判评估'" @click="act('referee')">{{ busy ? '执行中…' : '生成裁判评估' }}</button>
          <button v-if="isBlackbox && isTerminal" type="button" class="cp-btn" :disabled="busy" :title="busy ? '操作执行中' : '以相同输入创建新的实验会话'" @click="act('rerun')">{{ busy ? '执行中…' : '按原输入重跑' }}</button>
          <span v-if="!isBlackbox" class="cp-controls__hint">各阶段操作在下方对应分页内</span>
        </div>
        <div v-else class="cp-controls cp-controls--readonly">
          <span>真实教学会话为只读展示：阶段推进、模拟配置与黑盒操作不适用。</span>
        </div>
        <div v-if="!isBlackbox && !isRealMode" class="cp-config">
          <label>
            对抗预算
            <select v-model="frictionBudget" class="mk-filter__select" :disabled="frictionSaving" @change="saveFriction">
              <option value="none">无</option>
              <option value="low">低</option>
              <option value="normal">正常</option>
              <option value="high">高</option>
              <option value="stress_test">压力测试</option>
            </select>
          </label>
        </div>

        <!-- 阶段摘要 -->
        <div class="cp-summary">
          <div v-if="goalInfo" class="cp-summary__item">
            <span>Goal 对话</span>
            <p>{{ goalInfo }}</p>
          </div>
          <div v-if="pathInfo" class="cp-summary__item">
            <span>路径</span>
            <p>{{ pathInfo }}</p>
          </div>
          <div v-if="learnInfo" class="cp-summary__item">
            <span>学习</span>
            <p>{{ learnInfo }}</p>
          </div>
          <p v-if="!goalInfo && !pathInfo && !learnInfo" class="cp-none">会话刚启动，推进后这里显示各阶段摘要。</p>
          <div v-if="showPathReadiness" class="cp-path-readiness" :class="`cp-path-readiness--${pathReadinessTone}`">
            <span>Path 就绪状态</span>
            <p>{{ pathReadinessText }}</p>
          </div>
        </div>
      </section>

      <!-- 实时日志 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">会话日志</h3>
          <span class="mk-card__meta">{{ isRealMode ? '会话时间线 · 只读' : isTerminal ? '已终态' : '5s 轮询' }}</span>
          <span class="cp-logs__follow" :class="{ 'is-paused': !logFollowsBottom }" :title="logFollowsBottom ? '自动跟随最新日志' : '已暂停跟随 — 滚动到底部恢复'" @click="scrollToBottom">
            {{ logFollowsBottom ? '⏵ 自动跟随' : '⏸ 已暂停' }}
          </span>
        </div>
        <div class="cp-logs" ref="logBox" aria-live="polite" aria-label="实时日志" @scroll="onLogScroll">
          <template v-if="!session">
            <div v-for="n in 4" :key="n" class="cp-log-skel" aria-hidden="true"></div>
          </template>
          <template v-else>
            <div v-for="(l, i) in logs" :key="i" class="cp-log" :class="{ 'cp-log--error': l.view.isError }">
              <span class="cp-log__time">{{ l.time }}</span>
              <span v-if="l.view.phase" class="cp-log__phase" :class="{ 'cp-log__phase--error': l.view.isError }">{{ l.view.phase }}</span>
              <span class="cp-log__text">{{ l.view.text }}</span>
              <span v-if="l.view.durationText" class="cp-log__dur">{{ l.view.durationText }}</span>
              <details v-if="l.view.rawJson" class="cp-log__raw">
                <summary>原文</summary>
                <pre>{{ l.view.rawJson }}</pre>
              </details>
            </div>
            <p v-if="logsFailed" class="cp-degrade">
              日志获取失败
              <button type="button" class="mk-link" @click="loadLogs">重试</button>
            </p>
            <p v-else-if="!logs.length" class="cp-none">暂无日志</p>
          </template>
        </div>
      </section>
    </div>

    <!-- 分页：Path 内容（主）+ 评审（独立旁路） -->
    <section v-if="!isBlackbox && activeTab === 'path'" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">Path 内容</h3>
        <span class="mk-card__meta">{{ pathDetailMeta || '等待 Path 生成' }}</span>
      </div>
      <div v-if="!isRealMode" class="cp-tab-actions">
        <button type="button" class="cp-btn" :disabled="advancePathDisabled" :title="advancePathTitle" @click="act('advancePath')">生成 Path</button>
        <button type="button" class="cp-btn cp-btn--primary" :disabled="startLearningDisabled" :title="startLearningTitle" @click="act('startLearning')">启动 Learn</button>
        <button type="button" class="cp-btn" :disabled="resetPathDisabled" :title="resetPathTitle" @click="act('resetPath')">重建 Path</button>
      </div>
      <div class="cp-path-grid">
        <!-- 主区：路径内容 -->
        <div class="cp-path-detail">
          <div v-if="!session" class="cp-path-skel" aria-hidden="true">
            <div v-for="n in 3" :key="n"></div>
          </div>
          <template v-else>
            <template v-if="hasPath">
              <div class="cp-path-detail__head">
                <strong>{{ pathDetailTitle }}</strong>
                <span v-if="pathDetailMeta" class="cp-path-detail__meta">{{ pathDetailMeta }}</span>
              </div>
              <p v-if="pathDetailSummary" class="cp-path-detail__summary">{{ pathDetailSummary }}</p>
              <details v-if="pathMilestonesView.length" class="cp-transcript" open>
                <summary>里程碑 · {{ pathMilestonesView.length }} 个</summary>
                <article v-for="m in pathMilestonesView" :key="m.stageNumber" class="cp-milestone">
                  <div class="cp-milestone__head">
                    <span class="cp-milestone__order">M{{ m.stageNumber }}</span>
                    <strong>{{ m.title }}</strong>
                    <span v-if="m.estimatedHours" class="cp-milestone__meta">{{ m.estimatedHours }}h</span>
                  </div>
                  <p v-if="m.description" class="cp-milestone__desc">{{ m.description }}</p>
                  <ul v-if="m.tasks.length" class="cp-task-list">
                    <li
                      v-for="t in m.tasks"
                      :key="t.id || t.title"
                      :class="{ 'is-done': t.completed, 'is-current': t.current }"
                    >
                      <span class="cp-task-list__mark">{{ t.completed ? '✓' : t.current ? '▸' : '·' }}</span>
                      {{ t.title }}
                    </li>
                  </ul>
                </article>
              </details>
              <p v-else-if="pathGenerationInProgress" class="cp-none">Path 阶段任务仍在生成，稍后自动刷新。</p>
            </template>
            <p v-if="!hasPath && pathStatusFailed" class="cp-degrade">
              Path 状态获取失败
              <button type="button" class="mk-link" @click="loadPathStatus">重试</button>
            </p>
            <p v-else-if="!hasPath" class="cp-none">{{ pathEmptyHint }}</p>
          </template>
        </div>

        <!-- 旁路：评审面板（独立质量环，不阻塞 Learn；虚拟会话专属） -->
        <aside v-if="!isRealMode" class="cp-review-panel">
          <div class="cp-review-panel__head">
            <span>虚拟学习者评审</span>
            <em>独立旁路 · 不阻塞 Learn</em>
          </div>
          <div class="cp-review-panel__actions">
            <button type="button" class="cp-btn" :disabled="reviewPathDisabled" :title="reviewPathTitle" @click="act('reviewPath')">评审</button>
            <button
              v-if="acceptPathVisible"
              type="button"
              class="cp-btn cp-btn--primary"
              :disabled="acceptPathDisabled"
              :title="acceptPathTitle"
              @click="act('acceptPath')"
            >接受</button>
            <button
              v-if="replanPathVisible"
              type="button"
              class="cp-btn cp-btn--primary"
              :disabled="replanPathDisabled"
              :title="replanPathTitle"
              @click="act('replanPath')"
            >按意见重规划</button>
          </div>
          <div v-if="pathReviewStatus" class="cp-review">
            <div class="cp-review__badges">
              <span class="cp-review__badge" :data-decision="pathReviewDecision">{{ pathReviewDecisionLabel }}</span>
              <span class="cp-review__meta">{{ pathReviewStatusLabel }}<template v-if="pathReviewTime"> · {{ pathReviewTime }}</template></span>
            </div>
            <p v-if="pathReviewReaction" class="cp-review__reaction">{{ pathReviewReaction }}</p>
            <p v-if="pathReviewConcern" class="cp-review__concern">最大顾虑：{{ pathReviewConcern }}</p>
            <ul v-if="pathReviewChanges.length" class="cp-review__changes">
              <li v-for="(c, i) in pathReviewChanges" :key="i">{{ c }}</li>
            </ul>
            <p v-if="pathReviewReplan" class="cp-review__replan">{{ pathReviewReplan }}</p>
          </div>
          <p v-else class="cp-none">尚未评审。评审只是质量检查，可直接启动 Learn。</p>
        </aside>
      </div>
    </section>

    <!-- 分页：Goal 对话 -->
    <section v-if="!isBlackbox && activeTab === 'goal'" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">Goal 对话</h3>
        <span class="mk-card__meta">
          {{ goalConversationMessages.length ? `${goalConversationMessages.length} 条已落库` : '暂无记录' }}
          <template v-if="goalConverged"> · 已收敛</template>
        </span>
      </div>
      <div v-if="!isRealMode" class="cp-tab-actions">
        <button type="button" class="cp-btn" :disabled="goalStepDisabled" :title="goalStepTitle" @click="act('step')">单步推进</button>
        <button type="button" class="cp-btn" :disabled="goalAutoDisabled" :title="goalAutoTitle" @click="act('auto')">自动到 Goal 收敛</button>
        <button type="button" class="cp-btn" :disabled="advancePathDisabled" :title="advancePathTitle" @click="act('advancePath')">生成 Path</button>
        <button v-if="goalConverged" type="button" class="cp-btn" @click="selectStageTab('path')">前往 Path →</button>
      </div>
      <div class="cp-transcripts">
        <article
          v-for="(message, index) in goalConversationMessages"
          :key="`goal-${index}`"
          class="cp-transcript__message"
          :class="message.role === 'assistant' ? 'is-teacher' : 'is-learner'"
        >
          <span>{{ message.role === 'assistant' ? '平台 Goal' : isRealMode ? '学习者' : '虚拟学习者' }}</span>
          <p>{{ message.content }}</p>
        </article>
        <p v-if="!goalConversationMessages.length" class="cp-none">尚未产生 Goal 对话，点击「单步推进」开始。</p>
      </div>
    </section>

    <!-- 分页：Learn 课堂 -->
    <section v-if="!isBlackbox && activeTab === 'learning'" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">Learn 课堂</h3>
        <span class="mk-card__meta">
          <template v-if="learnLessons.length">{{ learnProgressText }} · </template>
          <template v-if="displayedTeachingSessionId">课堂 {{ displayedTeachingSessionId.slice(-8) }}</template>
          <template v-if="learnConversationMessages.length"> · {{ learnConversationMessages.length }} 条</template>
          <template v-if="!learnLessons.length && !displayedTeachingSessionId && !learnConversationMessages.length">暂无记录</template>
        </span>
      </div>
      <div v-if="!isRealMode" class="cp-tab-actions">
        <button type="button" class="cp-btn" :disabled="startLearningDisabled" :title="startLearningTitle" @click="act('startLearning')">启动 Learn</button>
        <button type="button" class="cp-btn" :disabled="learnStepDisabled" :title="learnStepTitle" @click="act('step')">Learn 单步</button>
        <button type="button" class="cp-btn" :disabled="learnAutoDisabled" :title="learnAutoTitle" @click="act('auto')">自动完成本课</button>
        <button type="button" class="cp-btn" :disabled="resetLearningDisabled" :title="resetLearningTitle" @click="act('resetLearn')">重启 Learn</button>
        <button type="button" class="cp-btn cp-danger-btn" :disabled="stopLearningDisabled" :title="stopLearningTitle" @click="act('stop')">停止 Learn</button>
      </div>
      <div class="cp-transcripts">
        <!-- 单课视图：当前查看课节的标题/状态/导航；全量任务列表在 Path 页 -->
        <div v-if="viewedLesson" class="cp-lesson-head">
          <div class="cp-lesson-head__main">
            <span class="cp-lesson-head__state" :data-state="viewedLesson.state">{{ lessonStateLabel(viewedLesson.state) }}</span>
            <strong>第 {{ viewedLessonIndex + 1 }}/{{ learnLessons.length }} 课 · {{ viewedLesson.title }}</strong>
            <span class="cp-lesson-head__ms">{{ viewedLesson.milestone }}</span>
          </div>
          <div class="cp-lesson-head__nav">
            <button
              type="button"
              class="cp-history-btn"
              :disabled="!prevReplayableLesson"
              title="上一节有记录的课"
              @click="prevReplayableLesson && openLesson(prevReplayableLesson)"
            >‹ 上一课</button>
            <select
              v-if="replayableLessons.length > 1"
              class="cp-lesson-head__select"
              :value="viewedLesson.teachingSessionId ? viewedLesson.taskId : ''"
              @change="jumpLesson(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="l in replayableLessons" :key="l.taskId" :value="l.taskId">
                {{ lessonMark(l.state) }} 第 {{ learnLessons.findIndex((x) => x.taskId === l.taskId) + 1 }} 课 · {{ l.title }}
              </option>
            </select>
            <button
              type="button"
              class="cp-history-btn"
              :disabled="!nextReplayableLesson"
              title="下一节有记录的课"
              @click="nextReplayableLesson && openLesson(nextReplayableLesson)"
            >下一课 ›</button>
          </div>
        </div>
        <div v-else-if="teachingSessionHistory.length" class="cp-teaching-history">
          <button
            type="button"
            class="cp-history-btn"
            :class="{ 'is-current': !selectedTeachingSessionId }"
            @click="showCurrentTeaching"
          >
            当前课堂
          </button>
          <button
            v-for="item in teachingSessionHistory"
            :key="item.id"
            type="button"
            class="cp-history-btn"
            :class="{ 'is-current': selectedTeachingSessionId === item.id }"
            @click="showArchivedTeaching(item.id)"
          >
            {{ item.taskTitle || `课堂 ${item.id.slice(-8)}` }}
          </button>
        </div>
        <p v-if="teachingDetailLoading" class="cp-none">正在读取教学会话记录…</p>
        <template v-if="learnConversationMessages.length">
          <article
            v-for="(message, index) in learnConversationMessages"
            :key="`learn-${index}`"
            class="cp-transcript__message"
            :class="message.role === 'assistant' ? 'is-teacher' : 'is-learner'"
          >
            <span>{{ message.role === 'assistant' ? '教师' : isRealMode ? '学习者' : '虚拟学习者' }}</span>
            <p>{{ message.content }}</p>
          </article>
        </template>
        <p v-else-if="teachingDetailFailed && !learnConversationMessages.length" class="cp-degrade">
          教学记录获取失败
          <button type="button" class="mk-link" @click="loadTeachingDetail(selectedTeachingSessionId)">重试</button>
        </p>
        <p v-else-if="!learnConversationMessages.length" class="cp-none">
          {{ learnEmptyHint }}
        </p>
      </div>
    </section>

    <!-- 分页：Wrapup 总结 -->
    <section v-if="!isBlackbox && activeTab === 'wrapup'" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">Wrapup 总结</h3>
        <span class="mk-card__meta">{{ hasWrapup ? '已生成' : '未生成' }}</span>
      </div>
      <div class="cp-tab-actions" v-if="!isRealMode">
        <button type="button" class="cp-btn" :disabled="wrapupDisabled" :title="wrapupTitle" @click="act('wrapup')">生成总结</button>
      </div>
      <div class="cp-transcripts">
        <template v-if="hasWrapup">
          <div v-if="wrapupFieldCards.length" class="cp-eval-card-grid">
            <div v-for="card in wrapupFieldCards" :key="card.label" class="cp-eval-card">
              <span class="cp-eval-card__label">{{ card.label }}</span>
              <p class="cp-eval-card__value">{{ card.value }}</p>
            </div>
            <div v-if="wrapupSourceBadge || wrapupStatusBadge" class="cp-eval-card cp-eval-card--meta">
              <span class="cp-eval-card__label">来源 / 状态</span>
              <p class="cp-eval-card__badges">
                <span v-if="wrapupSourceBadge" class="mk-badge" :class="wrapupSourceBadge === '模型生成' ? 'mk-badge--info' : 'mk-badge--muted'">{{ wrapupSourceBadge }}</span>
                <span v-if="wrapupStatusBadge" class="mk-badge" :class="wrapupStatusBadge === 'complete' ? 'mk-badge--ok' : 'mk-badge--warn'">{{ wrapupStatusBadge === 'complete' ? '总结完整' : '降级总结' }}</span>
              </p>
            </div>
          </div>
          <div v-for="section in wrapupSections" :key="section.label" class="cp-wrapup">
            <span class="cp-wrapup__label">{{ section.label }}</span>
            <pre v-if="section.isJson" class="cp-wrapup__json">{{ section.text }}</pre>
            <p v-else>{{ section.text }}</p>
          </div>
        </template>
        <p v-else class="cp-none">{{ wrapupEmptyHint }}</p>
      </div>
    </section>

    <!-- 裁判报告（黑盒终态） -->
    <section v-if="refereeReports.length || actorAuditReports.length" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">终局评估</h3>
        <span class="mk-card__meta">
          平台 {{ refereeReports.length }} · 角色 {{ actorAuditReports.length }}
        </span>
      </div>

      <div v-if="refereeReports.length" class="cp-eval-group">
        <h4 class="cp-eval-group__title">平台质量裁判</h4>
        <template v-for="(r, i) in refereeReports" :key="`r-${i}`">
          <article v-if="r.report" class="cp-eval">
            <div class="cp-eval__head">
              <div>
                <strong>{{ verdictLabel(r.report.verdict) }}</strong>
                <span class="cp-eval__time">{{ formatTime(r.evaluatedAt) }}</span>
              </div>
              <div class="cp-eval__overall">
                <span class="mk-badge" :class="scoreBadgeCls(r.report.scores?.overall)">
                  {{ scoreToPct(r.report.scores?.overall) }}
                </span>
                <span class="mk-minibar cp-eval__overall-bar">
                  <i class="mk-minibar__fill" :data-tone="scoreTone(r.report.scores?.overall)" :style="{ width: scoreFillPct(r.report.scores?.overall) + '%' }"></i>
                </span>
              </div>
            </div>
            <div v-if="r.report.scores" class="cp-eval__scores">
              <span v-for="item in scoreItems(r.report.scores, 'referee')" :key="item.label" class="cp-eval__score">
                <code>{{ item.label }}</code>
                <strong>{{ scoreToPct(item.value) }}</strong>
                <span class="mk-minibar">
                  <i class="mk-minibar__fill" :data-tone="scoreTone(item.value)" :style="{ width: scoreFillPct(item.value) + '%' }"></i>
                </span>
              </span>
            </div>
            <div v-if="r.report.findings?.length" class="cp-eval__section">
              <h5>平台发现</h5>
              <article v-for="f in r.report.findings" :key="f.code" class="cp-finding">
                <span class="cp-finding__sev" :data-sev="f.severity">{{ f.severity }}</span>
                <div>
                  <strong>{{ f.title }}</strong>
                  <p>{{ f.detail }}</p>
                  <details v-if="findingEvidence(r, f).length" class="cp-evidence">
                    <summary>证据 {{ findingEvidence(r, f).length }}</summary>
                    <div v-for="e in findingEvidence(r, f)" :key="e.id">
                      <code>{{ e.source }}{{ e.index === null ? '' : `[${e.index}]` }} · {{ e.path }}</code>
                      <p>{{ e.excerpt || e.interpretation }}</p>
                    </div>
                  </details>
                </div>
              </article>
            </div>
            <div v-if="r.report.recommendations?.length" class="cp-eval__section">
              <h5>平台建议</h5>
              <article v-for="(rec, rIdx) in r.report.recommendations" :key="`rec-${rIdx}`" class="cp-rec">
                <div class="cp-rec__head">
                  <strong>{{ rec.priority }}</strong>
                  <span v-if="rec.findingCodes?.length" class="cp-rec__codes">
                    <code v-for="c in rec.findingCodes" :key="String(c)">{{ c }}</code>
                  </span>
                </div>
                <p>{{ rec.action }}</p>
                <details v-if="rec.rationale" class="cp-rec__rationale">
                  <summary>依据</summary>
                  <p>{{ rec.rationale }}</p>
                </details>
              </article>
            </div>
          </article>
        </template>
      </div>

      <div v-if="actorAuditReports.length" class="cp-eval-group">
        <h4 class="cp-eval-group__title">角色保真审计</h4>
        <template v-for="(r, i) in actorAuditReports" :key="`a-${i}`">
          <article v-if="r.report" class="cp-eval">
            <div class="cp-eval__head">
              <div>
                <strong>{{ verdictLabel(r.report.verdict) }}</strong>
                <span class="cp-eval__time">{{ formatTime(r.evaluatedAt) }}</span>
              </div>
              <div class="cp-eval__overall">
                <span class="mk-badge" :class="scoreBadgeCls(r.report.scores?.overall)">
                  {{ scoreToPct(r.report.scores?.overall) }}
                </span>
                <span class="mk-minibar cp-eval__overall-bar">
                  <i class="mk-minibar__fill" :data-tone="scoreTone(r.report.scores?.overall)" :style="{ width: scoreFillPct(r.report.scores?.overall) + '%' }"></i>
                </span>
              </div>
            </div>
            <div v-if="r.report.scores" class="cp-eval__scores cp-eval__scores--actor">
              <span v-for="item in scoreItems(r.report.scores, 'actor')" :key="item.label" class="cp-eval__score">
                <code>{{ item.label }}</code>
                <strong>{{ scoreToPct(item.value) }}</strong>
                <span class="mk-minibar">
                  <i class="mk-minibar__fill" :data-tone="scoreTone(item.value)" :style="{ width: scoreFillPct(item.value) + '%' }"></i>
                </span>
              </span>
            </div>
            <div v-if="r.report.findings?.length" class="cp-eval__section">
              <h5>角色发现</h5>
              <article v-for="f in r.report.findings" :key="f.code" class="cp-finding">
                <span class="cp-finding__sev" :data-sev="f.severity">{{ f.severity }}</span>
                <div>
                  <strong>{{ f.title }}</strong>
                  <p>{{ f.detail }}</p>
                  <details v-if="findingEvidence(r, f).length" class="cp-evidence">
                    <summary>证据 {{ findingEvidence(r, f).length }}</summary>
                    <div v-for="e in findingEvidence(r, f)" :key="e.id">
                      <code>{{ e.source }}{{ e.index === null ? '' : `[${e.index}]` }} · {{ e.path }}</code>
                      <p>{{ e.excerpt || e.interpretation }}</p>
                    </div>
                  </details>
                </div>
              </article>
            </div>
            <div v-if="r.report.recommendations?.length" class="cp-eval__section">
              <h5>模拟器建议</h5>
              <article v-for="(rec, rIdx) in r.report.recommendations" :key="`arec-${rIdx}`" class="cp-rec">
                <div class="cp-rec__head">
                  <strong>{{ rec.priority }}</strong>
                  <span v-if="rec.findingCodes?.length" class="cp-rec__codes">
                    <code v-for="c in rec.findingCodes" :key="String(c)">{{ c }}</code>
                  </span>
                </div>
                <p>{{ rec.action }}</p>
                <details v-if="rec.rationale" class="cp-rec__rationale">
                  <summary>依据</summary>
                  <p>{{ rec.rationale }}</p>
                </details>
              </article>
            </div>
          </article>
        </template>
      </div>
    </section>

    <!-- 裁判旁路诊断轨迹 -->
    <details v-if="refereeTrace.length" class="cp-trace-panel">
      <summary>
        <span>裁判旁路诊断</span>
        <code>{{ refereeTrace.length }} 条 · trace={{ refereeTraceCount }}</code>
      </summary>
      <ol class="cp-trace-list">
        <li v-for="(tv, idx) in refereeTraceViews" :key="(tv.item.traceId || '') + idx">
          <div class="cp-trace-list__head">
            <span class="cp-trace-list__seq">#{{ idx + 1 }}</span>
            <time>{{ formatTime(tv.item.timestamp) }}</time>
            <code v-if="tv.item.traceId" class="cp-trace-list__id">{{ tv.item.traceId }}</code>
          </div>
          <div v-if="tv.rows.length" class="cp-trace-list__kv">
            <span v-for="row in tv.rows" :key="row.label">
              <code>{{ row.label }}</code><strong>{{ row.value }}</strong>
            </span>
          </div>
          <details v-if="tv.rawJson" class="cp-trace-list__raw">
            <summary>原文 JSON</summary>
            <pre class="cp-trace-list__body">{{ tv.rawJson }}</pre>
          </details>
        </li>
      </ol>
    </details>

    <!-- 角色私有状态轨迹（虚拟学习者脑子里在想什么） -->
    <details v-if="privateStateTrace.length" class="cp-trace-panel">
      <summary>
        <span>角色私有状态轨迹</span>
        <code>{{ privateStateTraceCount }} 条</code>
      </summary>
      <ol class="cp-trace-list">
        <li v-for="(item, idx) in privateStateTrace" :key="(item.sequence ?? idx)">
          <div class="cp-trace-list__head">
            <span class="cp-trace-list__seq">#{{ item.sequence ?? (idx + 1) }}</span>
            <span class="cp-trace-list__stage" :data-stage="item.stage">{{ item.stage }}</span>
            <code v-if="item.taskId">task={{ item.taskId.slice(0, 8) }}</code>
            <time v-if="item.generatedAt">{{ formatTime(item.generatedAt) }}</time>
            <span v-if="item.emotion" class="cp-trace-list__emotion">{{ item.emotion }}</span>
            <span v-if="item.degraded" class="cp-trace-list__degraded" title="LLM/校验失败时的兜底状态">degraded</span>
            <span v-if="item.transition" class="cp-trace-list__transition">{{ item.transition }}</span>
          </div>
          <div v-if="item.phaseFocus" class="cp-trace-list__focus">聚焦：{{ item.phaseFocus }}</div>
          <div v-if="item.visibleSignal" class="cp-trace-list__signal">{{ item.visibleSignal }}</div>
          <div v-if="item.stateChangeReason" class="cp-trace-list__reason">状态变化：{{ item.stateChangeReason }}</div>
          <div v-if="item.metrics && Object.keys(item.metrics).length" class="cp-trace-list__metrics">
            <span v-for="(v, k) in item.metrics" :key="k">
              <code>{{ k }}</code><strong>{{ v }}</strong>
            </span>
          </div>
          <div v-if="item.flags && Object.keys(item.flags).length" class="cp-trace-list__flags">
            <span v-for="(v, k) in item.flags" :key="k" :class="{ active: !!v }">{{ k }}</span>
          </div>
          <div v-if="item.blockers?.length" class="cp-trace-list__blockers">
            <span>阻塞：</span>
            <span v-for="(b, bIdx) in item.blockers" :key="bIdx" class="cp-trace-list__blocker">{{ b }}</span>
          </div>
        </li>
      </ol>
    </details>

    <!-- 统一时间线：三流合并（裁判诊断 / 私有状态 / 会话日志），按时间升序单轴展示；真实模式由日志卡承载 -->
    <details v-if="!isRealMode && hasTraceFlows && unifiedTimeline.length" class="cp-trace-panel cp-timeline-panel">
      <summary>
        <span>统一时间线（三流合并）</span>
        <code>{{ unifiedTimeline.length }} 条 · {{ timelineSourceSummary }}</code>
      </summary>
      <ol class="cp-trace-list">
        <li v-for="(t, idx) in unifiedTimeline" :key="`tl-${idx}`">
          <div class="cp-trace-list__head">
            <span class="cp-trace-list__seq">#{{ idx + 1 }}</span>
            <time>{{ formatTime(t.time) }}</time>
            <span class="cp-timeline__kind" :data-kind="t.kind">{{ t.kindLabel }}</span>
            <span v-if="t.stage" class="cp-timeline__stage" :data-stage="String(t.stage).toLowerCase()">{{ t.stage }}</span>
            <strong class="cp-timeline__title">{{ t.title }}</strong>
          </div>
          <p v-if="t.detail" class="cp-timeline__detail">{{ t.detail }}</p>
        </li>
      </ol>
    </details>

    <!-- 调试：原始 JSON -->
    <details class="cp-raw">
      <summary>原始会话数据</summary>
      <pre>{{ rawJson }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { subPage, closeSubPage, openSubPage } from './store'
import { errMsg } from './live'
import { askConfirm } from './useConfirm'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { statusText } from './statusText'
import { parseLogEntry, type LogEntryView } from './sessionLog'
import { scoreBadgeCls, scoreFillPct, scoreToPct, scoreTone } from './evalScore'
import { traceSummaryRows, traceRawJson, type TraceKeyValue } from './traceSummary'

const sessionId = computed(() => subPage.value?.id || '')
const shortId = computed(() => (sessionId.value.length > 20 ? `…${sessionId.value.slice(-16)}` : sessionId.value))

/* 双模式：session=虚拟会话控制台（原行为 100% 保留）；session-real=真实教学/目标会话只读控制台 */
const isRealMode = computed(() => subPage.value?.view === 'session-real')
const backLabel = computed(() => (isRealMode.value ? '会话列表' : '虚拟学习者'))
const realKind = ref<'teaching' | 'goal'>('teaching')
const realKindText = computed(() => (realKind.value === 'teaching' ? '真实教学会话' : '真实目标对话'))
/* 真实模式时间线（后端合成）与虚拟模式日志原文（统一时间线三流合并用） */
const timelineEntries = ref<Array<{ time: string; kind: string; title: string; detail: string }>>([])
const rawLogs = ref<Record<string, unknown>[]>([])

const session = ref<Record<string, unknown> | null>(null)
const logs = ref<{ id: string; time: string; text: string; view: LogEntryView }[]>([])
const logsFailed = ref(false)
const logBox = ref<HTMLElement | null>(null)
const LOG_WINDOW = 60
/* 日志滚动：接近底部才跟随，用户上翻时不打扰 */
const logFollowsBottom = ref(true)
function onLogScroll() {
  const box = logBox.value
  if (!box) return
  logFollowsBottom.value = box.scrollHeight - box.scrollTop - box.clientHeight < 80
}
function scrollLogsIfFollowing() {
  void nextTick(() => {
    const box = logBox.value
    if (!box || !logFollowsBottom.value) return
    box.scrollTop = box.scrollHeight
  })
}
function scrollToBottom() {
  const box = logBox.value
  if (!box) return
  box.scrollTop = box.scrollHeight
  logFollowsBottom.value = true
}
/* 按消息 id 去重追加，保留窗口上限 */
function appendLogs(entries: Array<{ id: string; time: string; text: string; view: LogEntryView }>) {
  if (!entries.length) return
  const seen = new Set(logs.value.map((l) => l.id || `${l.time}|${l.view.phase}|${l.text}`))
  const added: Array<{ id: string; time: string; text: string; view: LogEntryView }> = []
  for (const entry of entries) {
    const key = entry.id || `${entry.time}|${entry.view.phase}|${entry.text}`
    if (seen.has(key)) continue
    seen.add(key)
    added.push(entry)
  }
  if (!added.length) return
  logs.value = [...logs.value, ...added].slice(-LOG_WINDOW)
  scrollLogsIfFollowing()
}
const pathStatus = ref<Record<string, unknown> | null>(null)
const pathStatusFailed = ref(false)
const teachingDetail = ref<Record<string, unknown> | null>(null)
const teachingDetailFailed = ref(false)
const teachingDetailLoading = ref(false)
const selectedTeachingSessionId = ref('')

interface EvaluationReport {
  id?: string
  evaluatedAt?: string
  report?: {
    verdict?: string
    scores?: Record<string, number | null>
    findings?: Array<{
      code: string
      severity: string
      title: string
      detail: string
      evidenceIds?: Array<string | number>
    }>
    recommendations?: Array<{
      priority?: string
      action?: string
      rationale?: string
      findingCodes?: Array<string | number>
    }>
    evidence?: Array<{
      id?: string | number
      source?: string
      index?: number | null
      path?: string
      excerpt?: string
      interpretation?: string
    }>
  }
}

interface RefereeTraceItem {
  timestamp: string
  traceId: string | null
  diagnostic: Record<string, unknown> | null
}

interface PrivateStateTraceItem {
  sequence?: number
  stage: 'goal' | 'learning'
  taskId?: string | null
  transition?: string | null
  emotion?: string | null
  phaseFocus?: string | null
  degraded?: boolean
  visibleSignal?: string | null
  stateChangeReason?: string | null
  metrics?: Record<string, number>
  flags?: Record<string, boolean>
  blockers?: string[]
  generatedAt?: string | null
}

const refereeReports = ref<EvaluationReport[]>([])
const actorAuditReports = ref<EvaluationReport[]>([])
const refereeTrace = ref<RefereeTraceItem[]>([])
const refereeTraceCount = ref(0)
const privateStateTrace = ref<PrivateStateTraceItem[]>([])
const privateStateTraceCount = ref(0)
const busy = ref(false)


const stageResults = computed(() => (session.value?.stageResults || {}) as Record<string, unknown>)
const runtime = computed(() => (session.value?.runtime || {}) as Record<string, unknown>)
const stageStatus = computed(() => (runtime.value.stageStatus || {}) as Record<string, Record<string, unknown>>)

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalized(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function boolValue(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function conversationMessages(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ role: string; content: string }>
  return value.map(asRecord).map((message) => ({
    role: normalized(message.role) === 'assistant' || normalized(message.role) === 'teacher' ? 'assistant' : 'user',
    content: firstText(message.content, message.text, message.message)
  })).filter((message) => message.content)
}

const isBlackbox = computed(() => !!(stageResults.value.blackbox || stageResults.value.experiment))
const blackboxTraceCount = computed(() => {
  const bb = (stageResults.value.blackbox || {}) as Record<string, unknown>
  const trace = bb.publicTrace
  return Array.isArray(trace) ? trace.length : 0
})
const modeText = computed(() => (isRealMode.value ? '真实会话' : isBlackbox.value ? '黑盒模式' : '辅助模式'))
const isTerminal = computed(() => {
  const st = normalized(session.value?.status || runtime.value.status)
  return ['completed', 'failed', 'abandoned'].includes(st)
})
const terminalStatus = computed(() => normalized(session.value?.status || runtime.value.status))
const isFailedTerminal = computed(() => ['failed', 'abandoned'].includes(terminalStatus.value))
/* 手动停止（emergencyStop）后后端写 status=failed + stageResults.teaching.manualStop */
const manualStopped = computed(() =>
  learningResult.value.manualStop === true
  || stageStatus.value.learning?.manualStop === true
)
/* 暂停标志：pause API 设 stageResults.teaching.paused = true */
const isPaused = computed(() =>
  stageStatus.value.learning?.paused === true
)
const statusTone = computed(() =>
  !session.value
    ? 'mk-status--muted'
    : terminalStatus.value === 'created'
      ? 'mk-status--muted'
      : isFailedTerminal.value
        ? 'mk-status--bad'
        : isTerminal.value
          ? 'mk-status--ok'
          : 'mk-status--warn'
)
const statusTitle = computed(() =>
  !session.value
    ? '加载中…'
    : terminalStatus.value === 'created'
      ? '会话未开始'
      : isFailedTerminal.value
        ? manualStopped.value ? '已手动停止' : '会话失败'
        : isTerminal.value
          ? '会话已完成'
          : '会话进行中'
)

/* 阶段流：后端 currentStage 枚举是 goal/path/teaching，前端归一为 learning */
const stageFlow = ['goal', 'path', 'learning', 'wrapup'] as const
type StageKey = (typeof stageFlow)[number]

/* 阶段分页：阶段条即 tab，默认跟随 currentStage；控制面板与日志常驻 */
const activeTab = ref<StageKey>('goal')
function selectStageTab(st: StageKey) {
  if (isBlackbox.value) return
  activeTab.value = st
}

const bindings = computed(() => {
  const fromRuntime = (runtime.value.bindings || {}) as Record<string, unknown>
  const fromSession = (session.value?.bindings || {}) as Record<string, unknown>
  return {
    goalConversationId:
      fromRuntime.goalConversationId ||
      fromSession.goalConversationId ||
      session.value?.goalConversationId ||
      stageStatus.value.goal?.conversationId ||
      null,
    learningPathId:
      fromRuntime.learningPathId ||
      fromSession.learningPathId ||
      session.value?.learningPathId ||
      null,
    teachingSessionId:
      fromRuntime.teachingSessionId ||
      fromSession.teachingSessionId ||
      stageStatus.value.learning?.teachingSessionId ||
      null,
    currentTaskId:
      fromRuntime.currentTaskId ||
      fromSession.currentTaskId ||
      session.value?.currentTaskId ||
      stageStatus.value.learning?.currentTaskId ||
      null
  }
})

const goalResult = computed(() => asRecord(stageResults.value.goal))
const pathReview = computed(() => asRecord(stageResults.value.path_review || stageResults.value.pathReview))
/* 后端 stageResults 只写 teaching 键；learningResult 统一读 teaching 分支 */
const learningResult = computed(() => asRecord(stageResults.value.teaching))
const conversations = computed(() => asRecord(session.value?.conversations))
const goalConversationMessages = computed(() => conversationMessages(asRecord(conversations.value.goal).messages))
const fallbackLearnConversationMessages = computed(() => conversationMessages(asRecord(conversations.value.learning).messages))
const teachingSessionHistory = computed(() => {
  const history = learningResult.value.teachingSessionHistory
  if (!Array.isArray(history)) return [] as Array<{ id: string; taskId: string; taskTitle: string }>
  const seen = new Set<string>()
  return history.map(asRecord).map((item) => ({
    id: firstText(item.teachingSessionId),
    taskId: firstText(item.taskId),
    taskTitle: firstText(item.taskTitle)
  })).filter((item) => item.id && !seen.has(item.id) && !!seen.add(item.id))
})
const teachingDetailMessages = computed(() => conversationMessages(teachingDetail.value?.messages))
const learnConversationMessages = computed(() =>
  teachingDetailMessages.value.length ? teachingDetailMessages.value : fallbackLearnConversationMessages.value
)
const displayedTeachingSessionId = computed(() => firstText(
  teachingDetail.value?.id,
  selectedTeachingSessionId.value,
  bindings.value.teachingSessionId
))
/* Path : Learn = 1 : N。课程列表以 Path 任务树为数据源，
   每节课的课堂 id 从 teachingSessionHistory / 当前绑定推导，点击切换 transcript。 */
type LessonState = 'done' | 'active' | 'failed' | 'pending'
interface LearnLesson {
  taskId: string
  title: string
  milestone: string
  state: LessonState
  teachingSessionId: string
}
const learnLessons = computed<LearnLesson[]>(() => {
  const currentTaskId = firstText(bindings.value.currentTaskId, learningResult.value.currentTaskId)
  const currentTeachingId = firstText(bindings.value.teachingSessionId)
  const runtimeStatus = normalized(learningTaskRuntime.value.status)
  const historyByTask = new Map<string, string>()
  for (const item of teachingSessionHistory.value) {
    if (item.taskId) historyByTask.set(item.taskId, item.id)
  }
  const lessons: LearnLesson[] = []
  for (const m of pathMilestonesView.value) {
    for (const t of m.tasks) {
      if (!t.id) continue
      let state: LessonState = 'pending'
      let teachingSessionId = ''
      if (t.completed) {
        state = 'done'
        teachingSessionId = historyByTask.get(t.id) || ''
      }
      if (t.id === currentTaskId) {
        state = ['error', 'next_task_start_failed'].includes(runtimeStatus) ? 'failed' : 'active'
        teachingSessionId = currentTeachingId
      }
      lessons.push({ taskId: t.id, title: t.title, milestone: m.title, state, teachingSessionId })
    }
  }
  return lessons
})

function lessonMark(state: LessonState) {
  return { done: '✓', active: '▸', failed: '✕', pending: '·' }[state]
}
function lessonStateLabel(state: LessonState) {
  return { done: '已完成', active: '进行中', failed: '失败，可重启恢复', pending: '未开始' }[state]
}

/* Learn 页 = 单课视图：正在查看的课节（默认当前进行中的课），
   全量任务列表在 Path 页；这里只保留上一课/下一课/可回放课的紧凑导航。 */
const activeLesson = computed(() =>
  learnLessons.value.find((l) => l.state === 'active' || l.state === 'failed') || null
)
const viewedLesson = computed(() => {
  const displayedId = displayedTeachingSessionId.value
  return learnLessons.value.find((l) => l.teachingSessionId && l.teachingSessionId === displayedId)
    || activeLesson.value
    || null
})
const viewedLessonIndex = computed(() =>
  viewedLesson.value ? learnLessons.value.findIndex((l) => l.taskId === viewedLesson.value!.taskId) : -1
)
const replayableLessons = computed(() => learnLessons.value.filter((l) => !!l.teachingSessionId))
const prevReplayableLesson = computed(() => {
  if (viewedLessonIndex.value <= 0) return null
  for (let i = viewedLessonIndex.value - 1; i >= 0; i -= 1) {
    if (learnLessons.value[i].teachingSessionId) return learnLessons.value[i]
  }
  return null
})
const nextReplayableLesson = computed(() => {
  if (viewedLessonIndex.value < 0) return null
  for (let i = viewedLessonIndex.value + 1; i < learnLessons.value.length; i += 1) {
    if (learnLessons.value[i].teachingSessionId) return learnLessons.value[i]
  }
  return null
})
function jumpLesson(taskId: string) {
  const lesson = learnLessons.value.find((l) => l.taskId === taskId)
  if (lesson) openLesson(lesson)
}
function openLesson(lesson: LearnLesson) {
  if (!lesson.teachingSessionId) return
  const currentTeachingId = firstText(bindings.value.teachingSessionId)
  if (lesson.teachingSessionId === currentTeachingId) {
    showCurrentTeaching()
  } else {
    showArchivedTeaching(lesson.teachingSessionId)
  }
}

/* Learn 空态只反映 Learn 自身状态，不写跨阶段操作引导（解耦：引导在各页操作区与按钮 tooltip） */
const learnEmptyHint = computed(() => {
  if (isRealMode.value) {
    if (!hasPath.value) return '该真实会话尚未开始学习（无关联教学记录）。'
    if (!bindings.value.teachingSessionId) return '该真实会话尚无课堂记录。'
    return '该课堂暂未记录可展示消息。'
  }
  if (teachingDetailFailed.value) return '教学记录获取失败，请重试。'
  if (teachingSessionHistory.value.length) return '该课堂暂未记录可展示消息。'
  if (!hasPath.value) return '尚未启动 Learn。'
  if (learningBlockedReason.value) return `尚未启动 Learn：${learningBlockedReason.value}`
  return '尚未启动 Learn。'
})
const pathStatusPath = computed(() => asRecord(pathStatus.value?.path))
const pathGenerationStatus = computed(() => {
  const value = pathStatusPath.value.generationStatus ?? pathStatus.value?.generationStatus
  return asRecord(value)
})
const pathId = computed(() => firstText(
  bindings.value.learningPathId,
  pathStatus.value?.learningPathId,
  pathStatusPath.value.id,
  stageStatus.value.path?.learningPathId
))
const pathStateValues = computed(() => [
  normalized(pathStatus.value?.status),
  normalized(pathStatusPath.value.status),
  normalized(pathStatusPath.value.generationStatus),
  normalized(pathStatus.value?.generationStatus),
  normalized(pathGenerationStatus.value.status),
  normalized(pathGenerationStatus.value.core),
  normalized(pathGenerationStatus.value.stageDesign),
  normalized(pathGenerationStatus.value.phase)
].filter(Boolean))
const pathGenerationInProgress = computed(() =>
  pathStateValues.value.some((state) => ['generating', 'pending', 'queued', 'processing', 'in_progress', 'running'].includes(state))
)
const pathGenerationFailed = computed(() =>
  pathStateValues.value.some((state) => ['failed', 'error', 'cancelled'].includes(state))
)
const hasPath = computed(() =>
  !!(pathId.value || stageStatus.value.path?.generated)
)
const pathGeneratedOrReady = computed(() =>
  hasPath.value
  && !pathGenerationInProgress.value
  && !pathGenerationFailed.value
  && !['not_started', 'not_found'].includes(normalized(pathStatus.value?.status))
)
const pathStartable = computed(() => {
  const value = boolValue(pathStatusPath.value.canStartLearning)
    ?? boolValue(pathStatus.value?.canStartLearning)
  return value === true
})
const learningBlockedReason = computed(() => firstText(
  pathStatusPath.value.learningBlockedReason,
  pathStatus.value?.learningBlockedReason
))
const pathMilestones = computed(() => {
  const milestones = pathStatusPath.value.milestones
    || pathStatusPath.value.stages
    || pathStatus.value?.milestones
    || pathStatus.value?.stages
    || (stageResults.value.path as Record<string, unknown>)?.milestones
  return Array.isArray(milestones) ? milestones.map(asRecord) : []
})

/* Path 内容展示：标题/摘要/里程碑/任务（读 path-status 的完整结构；真实模式读 stageResults.path） */
const pathDetailTitle = computed(() =>
  firstText(pathStatusPath.value.title, pathStatusPath.value.name)
  || firstText(asRecord(stageResults.value.path).title, asRecord(stageResults.value.path).name)
  || '学习路径'
)
const pathDetailSummary = computed(() =>
  firstText(pathStatusPath.value.summary, pathStatusPath.value.description)
  || firstText(asRecord(stageResults.value.path).summary, asRecord(stageResults.value.path).description)
)
const pathDetailMeta = computed(() => {
  if (!hasPath.value) return ''
  const parts: string[] = []
  const srPath = asRecord(stageResults.value.path)
  const difficulty = firstText(pathStatusPath.value.difficulty, srPath.difficulty)
  const hours = numberValue(pathStatusPath.value.estimatedHours) ?? numberValue(srPath.estimatedHours)
  const total = numberValue(pathStatusPath.value.totalMilestones)
    ?? numberValue(srPath.totalMilestones)
    ?? pathMilestones.value.length
  if (difficulty) parts.push(`难度 ${difficulty}`)
  if (hours !== null) parts.push(`约 ${hours} 小时`)
  if (total) parts.push(`${total} 个里程碑`)
  return parts.join(' · ')
})
const pathMilestonesView = computed(() => pathMilestones.value.map((m, index) => {
  const rawTasks = m.subtasks || m.tasks
  const tasks = (Array.isArray(rawTasks) ? rawTasks : []).map(asRecord).map((t) => {
    const id = firstText(t.id)
    return {
      id,
      title: firstText(t.title, t.name) || '未命名任务',
      completed: normalized(t.status) === 'completed',
      current: !!id && id === bindings.value.currentTaskId
    }
  })
  return {
    stageNumber: numberValue(m.stageNumber) ?? index + 1,
    title: firstText(m.title, m.name) || `里程碑 ${index + 1}`,
    description: firstText(m.description),
    estimatedHours: numberValue(m.estimatedHours),
    tasks
  }
}))

/* Path 评审展示：stageResults.path_review */
const pathReviewStatus = computed(() => normalized(pathReview.value.status))
const pathReviewDecision = computed(() => normalized(pathReview.value.decision) || 'pending')
const pathReviewDecisionLabel = computed(() => ({
  accept: '接受',
  modify: '需要修改',
  reject: '拒绝',
  pending: '待评审'
}[pathReviewDecision.value] || pathReviewDecision.value))
const pathReviewStatusLabel = computed(() => ({
  pending: '评审完成，待人工处理',
  accepted: '已接受',
  replanning: '重规划中',
  replanned: '已生成新版 Path，待再次评审',
  failed: '评审失败'
}[pathReviewStatus.value] || pathReviewStatus.value))
const pathReviewReaction = computed(() => firstText(pathReview.value.reaction))
const pathReviewConcern = computed(() => firstText(pathReview.value.biggestConcern))
const pathReviewChanges = computed(() => {
  const list = pathReview.value.visibleRequestedChanges
  return Array.isArray(list) ? list.map((item) => String(item || '').trim()).filter(Boolean) : []
})
const pathReviewTime = computed(() => {
  const raw = firstText(pathReview.value.reviewedAt)
  return raw ? formatTime(raw) : ''
})
const pathReviewReplan = computed(() => {
  const replan = asRecord(pathReview.value.replan)
  if (!Object.keys(replan).length) return ''
  if (pathReviewStatus.value === 'replanning') return '正在根据评审意见重新规划 Path…'
  if (pathReviewStatus.value === 'replanned') return '已根据评审意见生成新版 Path，请再次评审。'
  return ''
})
/* Path 空态同样只反映状态，不写跨阶段操作引导；真实模式明示数据边界 */
const pathEmptyHint = computed(() => {
  if (isRealMode.value) return '该真实会话尚未生成 Path（无关联学习路径）。'
  return goalConverged.value ? '尚无 Path。' : '尚无 Path：Goal 未收敛。'
})

const currentStage = computed(() => {
  const raw = String(runtime.value.currentStage || session.value?.currentStage || 'goal').toLowerCase()
  // 后端枚举是 teaching，前端统一用 learning；兼容旧日志里的 learn/teach 别名
  if (raw === 'teaching' || raw === 'learn' || raw === 'teach') return 'learning'
  if (raw === 'summary') return 'wrapup'
  return raw
})

const goalConverged = computed(() => {
  const goalStage = normalized(goalResult.value.finalStage || goalResult.value.stage || stageStatus.value.goal?.stage)
  return stageStatus.value.goal?.ready === true
    || ['ready', 'completed'].includes(goalStage)
    || effectiveStageIndex.value >= 1
    || hasPath.value
})

const pathReviewAccepted = computed(() => {
  const reviewStatus = normalized(pathReview.value.status)
  const runtimeReview = asRecord(stageStatus.value.path?.review)
  const decision = normalized(pathReview.value.decision || runtimeReview.decision)
  const reviewedPathId = firstText(pathReview.value.reviewedPathId)
  return reviewStatus === 'accepted'
    && decision === 'accept'
    && !!pathId.value
    && reviewedPathId === pathId.value
})

const learningConversation = computed(() => {
  const history = learningResult.value.conversationHistory
  return Array.isArray(history) ? history : []
})
const learningTaskRuntime = computed(() => asRecord(learningResult.value.taskRuntime))
const completedTaskCount = computed(() => numberValue(session.value?.completedTasks) || 0)
const hasCompletedTask = computed(() =>
  completedTaskCount.value > 0 || normalized(learningTaskRuntime.value.status) === 'completed'
)
const hasRunnablePathTask = computed(() => pathMilestones.value.some((milestone) => {
  const tasks = milestone.subtasks || milestone.tasks
  return Array.isArray(tasks) && tasks.some((task) => normalized(asRecord(task).status) !== 'completed')
}) || (!!bindings.value.currentTaskId && !hasCompletedTask.value))
const hasLearningProgress = computed(() =>
  !!bindings.value.teachingSessionId
  || !!bindings.value.currentTaskId
  || learningConversation.value.length > 0
  || Object.keys(learningTaskRuntime.value).length > 0
  || learningResult.value.currentMilestone !== undefined
  || learningResult.value.currentTaskId !== undefined
  || hasCompletedTask.value
)
const hasLearnHistoryOrProgress = computed(() => hasLearningProgress.value)
const learningActive = computed(() =>
  !isTerminal.value
  && currentStage.value === 'learning'
  && stageStatus.value.learning?.manualStop !== true
  && learningResult.value.manualStop !== true
)
const terminalPathCompleted = computed(() => {
  const completedMilestones = numberValue(pathStatusPath.value.completedMilestones)
  const totalMilestones = numberValue(pathStatusPath.value.totalMilestones)
  const allMilestonesCompleted = completedMilestones !== null
    && totalMilestones !== null
    && totalMilestones > 0
    && completedMilestones >= totalMilestones
  return !isFailedTerminal.value
    && isTerminal.value
    && (allMilestonesCompleted || currentStage.value === 'learning' || hasLearnHistoryOrProgress.value)
})
const wrapupAvailable = computed(() =>
  !hasWrapup.value && (hasLearningProgress.value || terminalPathCompleted.value)
)

const assistedControlBlockReason = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式不支持此辅助控制'
  if (isFailedTerminal.value) return '会话已失败或终止，请保留现场记录'
  if (isTerminal.value) return '会话已完成'
  return ''
})
const stepDisabled = computed(() => !session.value || busy.value || isTerminal.value)
const stepTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isTerminal.value) return '会话已终态，不能继续推进'
  return isBlackbox.value ? '执行一条黑盒实验轨迹' : '推进当前阶段一步'
})
const autoDisabled = computed(() => !session.value || busy.value || isTerminal.value || isBlackbox.value)
const autoTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式仅支持单步推进'
  if (isTerminal.value) return '会话已终态，不能继续推进'
  return '自动推进当前阶段'
})
const runFullDisabled = computed(() => !!assistedControlBlockReason.value)
const runFullTitle = computed(() => assistedControlBlockReason.value || '自动执行 Goal、Path 和 Learn 流程')

/* 分页内的阶段操作：除通用禁用外，还要求后端 currentStage 匹配，防止在错误阶段误推 */
function stageMismatchTitle(stage: StageKey, action: string) {
  return currentStage.value !== stage
    ? `当前阶段是「${stageLabel(currentStage.value)}」，请切换到对应分页再${action}`
    : ''
}
const goalStepDisabled = computed(() => stepDisabled.value || currentStage.value !== 'goal')
const goalStepTitle = computed(() => stageMismatchTitle('goal', '推进 Goal') || stepTitle.value)
const goalAutoDisabled = computed(() => autoDisabled.value || currentStage.value !== 'goal')
const goalAutoTitle = computed(() => stageMismatchTitle('goal', '自动推进 Goal') || autoTitle.value)
const learnStepDisabled = computed(() => stepDisabled.value || currentStage.value !== 'learning')
const learnStepTitle = computed(() => stageMismatchTitle('learning', '推进 Learn') || stepTitle.value)
const learnAutoDisabled = computed(() => autoDisabled.value || currentStage.value !== 'learning')
const learnAutoTitle = computed(() => stageMismatchTitle('learning', '自动推进 Learn') || autoTitle.value)
const advancePathDisabled = computed(() =>
  !!assistedControlBlockReason.value || !goalConverged.value || hasPath.value
)
const advancePathTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (!goalConverged.value) return 'Goal 对话尚未收敛，不能生成 Path'
  if (hasPath.value) return '已有 Path，不能重复生成'
  return '根据已收敛的 Goal 生成 Path'
})
const reviewPathDisabled = computed(() =>
  !!assistedControlBlockReason.value || !pathGeneratedOrReady.value || pathReviewAccepted.value || reviewAwaitingDecision.value
)
const reviewPathTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (pathReviewAccepted.value) return '当前 Path 已通过评审'
  if (reviewAwaitingDecision.value) return '已有评审结论待处理：接受或按意见重规划'
  if (pathGenerationFailed.value) return 'Path 生成失败，请重新生成 Path'
  if (pathGenerationInProgress.value) return 'Path 正在生成或补全阶段任务'
  if (!pathGeneratedOrReady.value) return '请先生成并等待 Path 就绪'
  return '以虚拟学习者视角评审当前 Path'
})

/* 评审后的两个人工动作：接受（仅 decision=accept）或按意见重规划（decision=modify/reject） */
const reviewMatchesCurrentPath = computed(() =>
  !!pathId.value && firstText(pathReview.value.reviewedPathId) === pathId.value
)
const reviewAwaitingDecision = computed(() => pathReviewStatus.value === 'pending' && reviewMatchesCurrentPath.value)
const acceptPathVisible = computed(() => reviewAwaitingDecision.value && pathReviewDecision.value === 'accept')
const acceptPathDisabled = computed(() => !!assistedControlBlockReason.value)
const acceptPathTitle = computed(() =>
  assistedControlBlockReason.value || '确认接受评审结论；之后仍需手动启动 Learn'
)
const replanPathVisible = computed(() =>
  reviewAwaitingDecision.value && ['modify', 'reject'].includes(pathReviewDecision.value)
)
const replanPathDisabled = computed(() => !!assistedControlBlockReason.value)
const replanPathTitle = computed(() =>
  assistedControlBlockReason.value || '把评审反应和修改意见交给 Goal 重新生成 Path，完成后需再次评审'
)
const startLearningDisabled = computed(() =>
  !!assistedControlBlockReason.value || !pathStartable.value || learningActive.value
)
const startLearningTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (learningActive.value) return 'Learn 已在进行中'
  if (!pathStartable.value) return learningBlockedReason.value || 'Path 尚未准备好启动 Learn'
  return '启动 Learn（评审为独立旁路，无需先通过评审）'
})
const wrapupDisabled = computed(() => {
  if (!session.value || busy.value || isBlackbox.value || isFailedTerminal.value) return true
  return !wrapupAvailable.value
})
const wrapupTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式不支持此辅助控制'
  if (isFailedTerminal.value) return '会话已失败或终止，不能生成学习总结'
  if (hasWrapup.value) return '学习总结已生成'
  if (!wrapupAvailable.value) return '请先启动 Learn 并产生消息或学习进度'
  return '根据当前 Learn 记录生成总结'
})
const stopLearningDisabled = computed(() => !!assistedControlBlockReason.value || !learningActive.value)
const stopLearningTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (!learningActive.value) return '仅可停止正在进行的 Learn'
  return '停止当前 Learn'
})
const resetPathDisabled = computed(() =>
  !!assistedControlBlockReason.value || !hasPath.value || hasLearnHistoryOrProgress.value
)
const resetPathTitle = computed(() => {
  if (hasLearnHistoryOrProgress.value) return '已有 Learn 历史或进度，为保留历史不能重建 Path'
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (!hasPath.value) return '尚无 Path 可重建'
  return '删除当前 Path 并重新生成'
})
const resetLearningBlockReason = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式不支持此辅助控制'
  if (isTerminal.value && !isFailedTerminal.value) return '会话已完成，不能重启 Learn'
  return ''
})
const canRestartFromFailedLearn = computed(() => isFailedTerminal.value && hasRunnablePathTask.value)
const resetLearningDisabled = computed(() =>
  !!resetLearningBlockReason.value
  || !(pathStartable.value || canRestartFromFailedLearn.value)
  || !hasRunnablePathTask.value
)
const resetLearningTitle = computed(() => {
  if (resetLearningBlockReason.value) return resetLearningBlockReason.value
  if (!pathStartable.value && !canRestartFromFailedLearn.value) return learningBlockedReason.value || 'Path 尚未准备好启动 Learn'
  if (!hasRunnablePathTask.value) return 'Path 中没有可重启的学习任务'
  return isFailedTerminal.value ? '从当前可运行任务恢复失败的 Learn' : '以可运行任务重新启动 Learn（评审为独立旁路）'
})
const showPathReadiness = computed(() =>
  !isBlackbox.value && !isRealMode.value && (pathStatusFailed.value || goalConverged.value || hasPath.value || ['path', 'learning', 'wrapup'].includes(currentStage.value))
)
const pathReadinessTone = computed(() => {
  if (pathStatusFailed.value) return 'bad'
  if (pathGenerationFailed.value) return 'bad'
  if (pathGenerationInProgress.value) return 'warn'
  if (pathStartable.value) return 'ok'
  return 'muted'
})
const pathReadinessText = computed(() => {
  if (pathStatusFailed.value) return 'Path 状态获取失败，请重试。'
  if (!hasPath.value) return goalConverged.value ? 'Goal 已收敛，等待生成 Path。' : '等待 Goal 对话收敛后生成 Path。'
  if (pathGenerationFailed.value) return learningBlockedReason.value || 'Path 生成失败，请重新生成。'
  if (pathGenerationInProgress.value) return learningBlockedReason.value || 'Path 正在生成或补全阶段任务，请稍候。'
  if (pathStartable.value) return pathReviewAccepted.value
    ? 'Path 已就绪，可启动或重启 Learn。'
    : 'Path 已就绪，可启动 Learn；评审为独立旁路，不阻塞启动。'
  return learningBlockedReason.value || 'Path 已生成，正在确认 Learn 启动条件。'
})

/** 进度条索引：优先 currentStage，并用 bindings 兜底（避免 key 不一致时全「未开始」） */
const effectiveStageIndex = computed(() => {
  const raw = currentStage.value
  let idx = stageFlow.indexOf(raw as StageKey)
  if (idx >= 0) return idx

  // 后端偶发非标准 stage 时，用绑定证据推断
  if (bindings.value.teachingSessionId || bindings.value.currentTaskId) return 2
  if (bindings.value.learningPathId || stageStatus.value.path?.generated) return 1
  if (bindings.value.goalConversationId) return 0
  return 0
})

const hasWrapup = computed(() => {
  const teaching = (stageResults.value.teaching || {}) as Record<string, unknown>
  return !!(stageStatus.value.learning?.wrapup || teaching.wrapup)
})

/* Wrapup 分页内容：summary/evaluation 结构化对象 → 字段卡（C4/遗留项 2），字符串保持原样 */
const wrapupObject = computed(() => {
  const learning = asRecord(stageResults.value.teaching)
  return asRecord(learning.wrapup || stageStatus.value.learning?.wrapup)
})
const wrapupSections = computed(() => {
  const wrapup = wrapupObject.value
  if (!Object.keys(wrapup).length) return [] as Array<{ label: string; text: string; isJson: boolean }>
  const render = (value: unknown) => typeof value === 'string'
    ? { text: value, isJson: false }
    : { text: JSON.stringify(value, null, 2), isJson: true }
  const sections: Array<{ label: string; text: string; isJson: boolean }> = []
  // 结构化对象由字段卡承载，字符串走分节卡
  if (typeof wrapup.summary === 'string') sections.push({ label: '学习总结', ...render(wrapup.summary) })
  if (typeof wrapup.evaluation === 'string') sections.push({ label: '评估', ...render(wrapup.evaluation) })
  const generatedAt = firstText(wrapup.generatedAt)
  if (generatedAt) sections.push({ label: '生成时间', text: formatTime(generatedAt), isJson: false })
  return sections
})

/* 终局评估区 wrapup 评价字段卡：评价/评估摘要/来源徽章 */
const wrapupFieldCards = computed(() => {
  const wrapup = wrapupObject.value
  const cards: Array<{ label: string; value: string }> = []
  const summary = wrapup.summary
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    const s = summary as Record<string, unknown>
    const labels: Record<string, string> = {
      topicSummary: '主题摘要',
      knowledgeSummary: '知识总结',
      practiceAdvice: '练习建议',
      learningEvaluation: '学习评估'
    }
    for (const [key, label] of Object.entries(labels)) {
      const v = s[key]
      if (typeof v === 'string' && v.trim()) cards.push({ label, value: v.trim() })
    }
  }
  const evaluation = wrapup.evaluation
  if (evaluation && typeof evaluation === 'object' && !Array.isArray(evaluation)) {
    const e = evaluation as Record<string, unknown>
    for (const [key, value] of Object.entries(e)) {
      if (key === 'summary') continue
      if (typeof value === 'string' && value.trim()) cards.push({ label: `评估 · ${key}`, value: value.trim() })
    }
    const evaluationSummary = firstText(e.summary, e.verdict, e.conclusion)
    if (evaluationSummary) cards.push({ label: '评估摘要', value: evaluationSummary })
  }
  return cards
})
const wrapupSourceBadge = computed(() => {
  const sources = asRecord(wrapupObject.value.sources)
  return sources.summary === 'model' ? '模型生成' : sources.summary === 'rule' || sources.summary ? '规则回退' : ''
})
const wrapupStatusBadge = computed(() => String(wrapupObject.value.status || ''))
const wrapupEmptyHint = computed(() =>
  isRealMode.value
    ? '该真实会话未生成总结（无 wrapup 记录）。'
    : '尚无学习总结。Learn 产生进度后点击「生成总结」。'
)

function stageLabel(st: string) {
  return {
    goal: 'Goal 对话',
    path: 'Path 生成',
    learning: 'Learn 学习',
    wrapup: 'Wrapup 总结'
  }[st] || st
}

function stageDone(st: StageKey) {
  const idx = stageFlow.indexOf(st)
  const cur = effectiveStageIndex.value

  // Wrapup 不是会话终态的同义词：只有确实写出总结时才算完成。
  if (st === 'wrapup') return hasWrapup.value
  // 失败终态只确认失败点以前的阶段；当前失败阶段不能伪装成完成。
  if (isFailedTerminal.value && idx === cur) return false
  if (isTerminal.value && idx <= cur) return true
  if (idx < cur) return true
  // 同阶段但已有下游证据时，也标完成（如 learning 时 Goal/Path 已完成）
  if (st === 'goal' && (bindings.value.learningPathId || bindings.value.teachingSessionId || cur >= 1)) return true
  if (st === 'path' && (bindings.value.teachingSessionId || cur >= 2)) return true
  if (st === 'learning' && (isTerminal.value || stageStatus.value.learning?.wrapup)) return true
  return false
}

function stageActive(st: StageKey) {
  if (isTerminal.value) {
    return st === 'wrapup'
      ? hasWrapup.value
      : stageFlow.indexOf(st) === effectiveStageIndex.value
  }
  if (stageDone(st) && stageFlow.indexOf(st) !== effectiveStageIndex.value) return false
  return stageFlow.indexOf(st) === effectiveStageIndex.value
}

function stageCls(st: string) {
  const key = st as StageKey
  return {
    'cp-stage--done': stageDone(key),
    'cp-stage--active': stageActive(key) && !isTerminal.value
  }
}

function stageState(st: string) {
  const key = st as StageKey
  if (isFailedTerminal.value && stageFlow.indexOf(key) === effectiveStageIndex.value) return '失败'
  if (stageDone(key) && !stageActive(key)) return '已完成'
  if (stageActive(key)) return isTerminal.value ? '已完成' : '进行中'
  if (stageDone(key)) return '已完成'
  return '未开始'
}

/* 阶段条进度副标（遗留项 2 C2）：当前阶段显示 x/y 或百分比；数据源不足给空串 */
const goalRoundText = computed(() => {
  const n = goalConversationMessages.value.length
  if (n) return `对话 ${n} 轮`
  const confidence = numberValue(stageStatus.value.goal?.confidence)
  if (confidence !== null) return `置信度 ${Math.round(confidence * 100)}%`
  return ''
})
const pathProgressText = computed(() => {
  const srPath = asRecord(stageResults.value.path)
  const completed = numberValue(srPath.completedMilestones)
    ?? numberValue(pathStatusPath.value.completedMilestones)
    ?? numberValue(stageStatus.value.path?.completedMilestones)
  const total = numberValue(srPath.totalMilestones)
    ?? numberValue(pathStatusPath.value.totalMilestones)
    ?? numberValue(stageStatus.value.path?.totalMilestones)
  if (completed !== null && total) return `${completed}/${total} 里程碑`
  const milestones = pathMilestonesView.value
  if (milestones.length) {
    const done = milestones.filter((m) => m.tasks.length && m.tasks.every((t) => t.completed)).length
    return `${done}/${milestones.length} 里程碑`
  }
  return ''
})
const learnProgressText = computed(() => {
  const done = learnLessons.value.filter((l) => l.state === 'done').length
  const total = learnLessons.value.length
  return `课程进度 ${done}/${total}`
})
function stageProgress(st: string) {
  const key = st as StageKey
  switch (key) {
    case 'goal':
      return goalRoundText.value
    case 'path':
      return pathProgressText.value
    case 'learning':
      return learnLessons.value.length ? `课程 ${learnLessons.value.filter((l) => l.state === 'done').length}/${learnLessons.value.length}` : ''
    case 'wrapup':
      return hasWrapup.value ? '总结已生成' : ''
    default:
      return ''
  }
}

/* 阶段摘要（读 runtime.stageStatus + bindings） */
const goalInfo = computed(() => {
  const g = stageStatus.value.goal || {}
  const id = bindings.value.goalConversationId || g.conversationId
  if (!id) return ''
  if (g.ready || effectiveStageIndex.value >= 1) return `对话已创建 · 已收敛/可生成 Path`
  return `对话已创建 · 进行中`
})
const pathInfo = computed(() => {
  const p = stageStatus.value.path || {}
  if (bindings.value.learningPathId || p.generated) {
    return p.totalMilestones ? `${p.totalMilestones} 个里程碑已生成` : '路径已生成'
  }
  return ''
})
const learnInfo = computed(() => {
  const l = stageStatus.value.learning || {}
  if (l.currentTaskTitle) return `当前任务：${String(l.currentTaskTitle)}`
  if (bindings.value.teachingSessionId || l.teachingSessionId) return '教学会话进行中'
  return ''
})

/* 数据加载 */
async function refresh() {
  const id = sessionId.value
  if (!id) return
  try {
    if (isRealMode.value) {
      const res = await adminVirtualLearnersApi.getRealSessionConsole(id)
      if (sessionId.value !== id) return
      session.value = res.data?.data ?? res.data ?? {}
      const kind = String((session.value as Record<string, unknown>)?.kind || '')
      realKind.value = kind === 'goal' ? 'goal' : 'teaching'
      timelineEntries.value = Array.isArray((session.value as Record<string, unknown>)?.timeline)
        ? (session.value as { timeline: Array<{ time: string; kind: string; title: string; detail: string }> }).timeline
        : []
      pathStatus.value = null
      teachingDetail.value = null
      await loadLogs()
      return
    }
    const res = await adminVirtualLearnersApi.getVirtualSession(id)
    if (sessionId.value !== id) return
    session.value = res.data?.data ?? res.data ?? {}
    const sr = (session.value?.stageResults || {}) as Record<string, unknown>
    const simCfg = (sr.simulationConfig || {}) as Record<string, unknown>
    const fb = String(simCfg.frictionBudget || '')
    if (['none', 'low', 'normal', 'high', 'stress_test'].includes(fb)) {
      frictionBudget.value = fb as typeof frictionBudget.value
    }
    parseBlackbox()
    await Promise.all([
      loadLogs(),
      isBlackbox.value ? Promise.resolve() : loadPathStatus(),
      isBlackbox.value ? Promise.resolve() : loadTeachingDetail()
    ])
  } catch (e) {
    if (sessionId.value !== id) return
    toast.error(`加载失败：${errMsg(e)}`)
  }
}

async function loadLogs() {
  const id = sessionId.value
  if (!id) return
  try {
    if (isRealMode.value) {
      const items = timelineEntries.value.map((t, i) => ({
        id: `tl-${i}`,
        createdAt: t.time || '',
        timestamp: t.time || '',
        phase: t.kind,
        message: t.title || '',
        details: t.detail ? { text: t.detail } : undefined
      }))
      appendLogs(items.slice(-LOG_WINDOW).map((l: Record<string, unknown>) => {
        const view = parseLogEntry(l)
        return {
          id: String(l.id ?? ''),
          time: l.createdAt ? new Date(String(l.createdAt)).toLocaleTimeString('zh-CN', { hour12: false }) : '',
          text: view.text || view.phase,
          view: { ...view, phase: timelineKindLabel(String(l.phase)) }
        }
      }))
      logsFailed.value = false
      return
    }
    const res = await adminVirtualLearnersApi.getVirtualSessionLogs(id)
    if (sessionId.value !== id) return
    const body = res.data?.data ?? res.data ?? []
    let items = Array.isArray(body) ? body : body.logs || body.items || []
    // 回退：会话对象自带的 logs 字段
    if (!items.length && Array.isArray(session.value?.logs)) {
      items = session.value.logs as Record<string, unknown>[]
    }
    rawLogs.value = items
    appendLogs(items.slice(-LOG_WINDOW).map((l: Record<string, unknown>) => {
      const view = parseLogEntry(l)
      return {
        id: String(l.id ?? l.messageId ?? ''),
        time: l.createdAt ? new Date(String(l.createdAt)).toLocaleTimeString('zh-CN', { hour12: false }) : '',
        text: view.text || view.phase,
        view
      }
    }))
    logsFailed.value = false
  } catch {
    // 失败保留旧日志，标记降级并给出重试入口（不把「无日志」误读为空）
    if (sessionId.value !== id) return
    logsFailed.value = true
  }
}

async function loadPathStatus() {
  const id = sessionId.value
  if (!id || isBlackbox.value || isRealMode.value) {
    pathStatus.value = null
    return
  }
  try {
    const res = await adminVirtualLearnersApi.getVirtualSessionPathStatus(id)
    if (sessionId.value !== id) return
    pathStatus.value = asRecord(res.data?.data ?? res.data)
    pathStatusFailed.value = false
  } catch {
    // 失败保留旧快照，标记降级（避免把「获取失败」误读成「Goal 未收敛 / 尚无 Path」）
    if (sessionId.value !== id) return
    pathStatusFailed.value = true
  }
}

async function loadTeachingDetail(teachingSessionId = selectedTeachingSessionId.value, options: { silent?: boolean } = {}) {
  const id = sessionId.value
  if (!id || isBlackbox.value || isRealMode.value) {
    teachingDetail.value = null
    return
  }

  const currentTeachingSessionId = firstText(bindings.value.teachingSessionId)
  if (!teachingSessionId && !currentTeachingSessionId) {
    teachingDetail.value = null
    return
  }

  // 轮询走静默刷新：不闪「正在读取」占位，避免页面高度变化导致滚动跳动。
  if (!options.silent) teachingDetailLoading.value = true
  try {
    const res = await adminVirtualLearnersApi.getVirtualSessionTeachingDetail(id, teachingSessionId || undefined)
    if (sessionId.value !== id) return
    teachingDetail.value = asRecord(res.data?.data ?? res.data)
    teachingDetailFailed.value = false
  } catch {
    // 失败保留旧记录，标记降级（避免把「获取失败」误读成「该课堂暂未记录」）
    if (sessionId.value !== id) return
    teachingDetailFailed.value = true
  } finally {
    if (!options.silent && sessionId.value === id) teachingDetailLoading.value = false
  }
}

function showCurrentTeaching() {
  selectedTeachingSessionId.value = ''
  void loadTeachingDetail()
}

function showArchivedTeaching(teachingSessionId: string) {
  selectedTeachingSessionId.value = teachingSessionId
  void loadTeachingDetail(teachingSessionId)
}

function parseBlackbox() {
  const bb = (stageResults.value.blackbox || {}) as Record<string, unknown>
  // 平台质量裁判与角色保真审计（结构化报告）
  refereeReports.value = Array.isArray(bb.refereeReports) ? bb.refereeReports as EvaluationReport[] : []
  actorAuditReports.value = Array.isArray(bb.actorAuditReports) ? bb.actorAuditReports as EvaluationReport[] : []
  // 裁判旁路诊断轨迹
  const rawRefereeTrace = Array.isArray(bb.refereeTrace) ? bb.refereeTrace : []
  refereeTrace.value = rawRefereeTrace as RefereeTraceItem[]
  refereeTraceCount.value = rawRefereeTrace.length
  // 角色私有状态轨迹
  const rawPrivateTrace = Array.isArray(bb.learnerPrivateStateTrace) ? bb.learnerPrivateStateTrace : []
  privateStateTrace.value = rawPrivateTrace as PrivateStateTraceItem[]
  privateStateTraceCount.value = rawPrivateTrace.length
}

/* 裁判轨迹视图：键值摘要行 + 原文 JSON（C3，展开不丢原始数据） */
interface RefereeTraceView {
  item: RefereeTraceItem
  rows: TraceKeyValue[]
  rawJson: string
}
const refereeTraceViews = computed<RefereeTraceView[]>(() =>
  refereeTrace.value.map((item) => ({
    item,
    rows: traceSummaryRows(item.diagnostic),
    rawJson: traceRawJson(item.diagnostic)
  }))
)

/* 统一时间线（遗留项 2）：三流合并（裁判诊断 / 私有状态 / 会话日志），按时间升序单轴 */
interface TimelineEntry {
  time: string
  kind: string
  kindLabel: string
  stage: string
  title: string
  detail: string
}
function timelineKindLabel(kind: string): string {
  const map: Record<string, string> = {
    referee: '裁判',
    private: '私有状态',
    log: '日志',
    goal: '目标对话',
    path: '路径',
    teaching: '课堂',
    evidence: '证据'
  }
  return map[kind] || kind
}
const timelineSourceSummary = computed(() => {
  const counts = new Map<string, number>()
  for (const t of unifiedTimeline.value) counts.set(t.kind, (counts.get(t.kind) || 0) + 1)
  return [...counts.entries()].map(([kind, n]) => `${timelineKindLabel(kind)} ${n}`).join(' · ')
})
/* 裁判/私有轨迹流任一存在才展示统一时间线（仅日志时与会话日志卡重复） */
const hasTraceFlows = computed(() => refereeTrace.value.length > 0 || privateStateTrace.value.length > 0)
const unifiedTimeline = computed<TimelineEntry[]>(() => {
  // 真实模式：后端合成时间线已由日志卡承载（同屏对照简化版），此面板仅服务虚拟三流合并
  if (isRealMode.value) return []
  const entries: TimelineEntry[] = []
  for (const item of refereeTrace.value) {
    entries.push({
      time: item.timestamp || '',
      kind: 'referee',
      kindLabel: timelineKindLabel('referee'),
      stage: 'learning',
      title: `裁判诊断${item.traceId ? ` · ${item.traceId.slice(0, 8)}` : ''}`,
      detail: traceSummaryRows(item.diagnostic).map((r) => `${r.label}: ${r.value}`).join(' · ')
    })
  }
  for (const item of privateStateTrace.value) {
    entries.push({
      time: item.generatedAt || '',
      kind: 'private',
      kindLabel: timelineKindLabel('private'),
      stage: item.stage || '',
      title: `${item.transition || '状态'}${item.emotion ? ` · ${item.emotion}` : ''}`,
      detail: [item.phaseFocus, item.visibleSignal, item.stateChangeReason]
        .filter((v): v is string => !!v && typeof v === 'string')
        .join(' · ')
    })
  }
  for (const raw of rawLogs.value) {
    const ts = String(raw.timestamp || raw.createdAt || '')
    const view = parseLogEntry(raw)
    entries.push({
      time: ts,
      kind: 'log',
      kindLabel: timelineKindLabel('log'),
      stage: view.phase,
      title: view.text || view.phase || '会话日志',
      detail: ''
    })
  }
  return entries
    .filter((e) => !!e.time)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .slice(-200)
})

/* 评估报告展示助手 */
function verdictLabel(verdict?: string) {
  if (!verdict) return '未生成'
  const map: Record<string, string> = {
    pass: '通过', pass_with_concerns: '有条件通过',
    fail: '失败', inconclusive: '证据不足',
    credible: '可信', credible_with_concerns: '基本可信',
    invalid: '无效'
  }
  return map[verdict] || verdict
}
function formatTime(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN', { hour12: false })
}
function scoreItems(scores: Record<string, number | null>, kind: 'referee' | 'actor') {
  const labels = kind === 'referee'
    ? [['goalExperience', 'Goal 体验'], ['pathExperience', 'Path 体验'], ['teachingExperience', 'Teaching 体验'], ['controlConsistency', '控制一致'], ['boundaryIntegrity', '边界完整'], ['evidenceSufficiency', '证据充分']]
    : [['personaConsistency', '画像一致'], ['storyConsistency', '故事一致'], ['disclosureDiscipline', '披露节奏'], ['frictionCalibration', '摩擦校准'], ['stateContinuity', '状态连续'], ['behaviorPlausibility', '行为可信'], ['evidenceSufficiency', '证据充分']]
  return labels.map(([key, label]) => ({ label, value: scores[key] ?? null }))
}
function findingEvidence(report: EvaluationReport, finding: { evidenceIds?: Array<string | number> }) {
  const ids = new Set(Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [])
  return (Array.isArray(report.report?.evidence) ? report.report.evidence : []).filter((e) => ids.has(e.id as never))
}

const frictionBudget = ref<'none' | 'low' | 'normal' | 'high' | 'stress_test'>('normal')
const frictionSaving = ref(false)

async function saveFriction() {
  if (!sessionId.value || isBlackbox.value || busy.value || frictionSaving.value) return
  frictionSaving.value = true
  const previous = frictionBudget.value
  try {
    await adminVirtualLearnersApi.updateSessionSimulationConfig(sessionId.value, {
      frictionBudget: frictionBudget.value
    })
    toast.success(`对抗预算已更新：${frictionBudget.value}`)
  } catch (e) {
    frictionBudget.value = previous
    toast.error(`更新失败：${errMsg(e)}`)
  } finally {
    frictionSaving.value = false
  }
}

/* 会话状态控制：暂停/恢复/停止/重启（独立于 act()，走专用 API） */
async function pauseSession() {
  if (busy.value || !sessionId.value) return
  busy.value = true
  try {
    await adminVirtualLearnersApi.pauseVirtualSession(sessionId.value)
    void refresh()
  } catch (e) { /* act() 的 catch 统一处理 */ }
  finally { busy.value = false }
}
async function resumeSession() {
  if (busy.value || !sessionId.value) return
  busy.value = true
  try {
    await adminVirtualLearnersApi.resumeVirtualSession(sessionId.value)
    void refresh()
  } catch (e) { /* act() 的 catch 统一处理 */ }
  finally { busy.value = false }
}
async function stopLearning() {
  if (busy.value) return
  busy.value = true
  try {
    await adminVirtualLearnersApi.stopVirtualLearning(sessionId.value)
    void refresh()
  } catch (e) { /* */ }
  finally { busy.value = false }
}
async function restartLearning() {
  if (busy.value) return
  busy.value = true
  try {
    await adminVirtualLearnersApi.restartVirtualLearning(sessionId.value)
    void refresh()
  } catch (e) { /* */ }
  finally { busy.value = false }
}

/* 控制动作：按阶段路由（learning 走 learning-step / auto-learning） */
async function act(kind: string) {
  if (busy.value) return
  busy.value = true
  try {
    /* 终止黑盒实验：不可撤销，先二次确认（确认框弹出期间按钮保持禁用） */
    if (kind === 'abandon') {
      const ok = await askConfirm({
        title: '终止黑盒实验',
        message: '确认终止当前黑盒实验？\n实验将被标记为已终止，公开轨迹与评估保留，该操作不可撤销。',
        confirmText: '终止实验'
      })
      if (!ok) return
    }
    const id = sessionId.value
    const stage = currentStage.value
    switch (kind) {
      case 'step':
        // 黑盒模式无 step 入口（仅 abandon/referee/rerun），此分支只服务辅助模式
        if (stage === 'learning') {
          await adminVirtualLearnersApi.virtualSessionLearningStep(id)
        } else {
          await adminVirtualLearnersApi.virtualSessionStep(id)
        }
        break
      case 'auto':
        if (stage === 'learning') {
          await adminVirtualLearnersApi.virtualSessionAutoLearning(id, { maxMilestones: 1 })
        } else {
          await adminVirtualLearnersApi.virtualSessionAuto(id, { maxRounds: 10 })
        }
        break
      case 'runFull':
        await adminVirtualLearnersApi.virtualSessionRunFull(id, {
          maxRounds: 10,
          maxMilestones: 5,
          autoAdvanceToPath: true,
          autoAdvanceToLearning: true
        })
        break
      case 'advancePath':
        await adminVirtualLearnersApi.virtualSessionAdvancePath(id)
        break
      case 'reviewPath':
        await adminVirtualLearnersApi.reviewVirtualSessionPath(id)
        break
      case 'acceptPath':
        await adminVirtualLearnersApi.acceptVirtualSessionPath(id)
        break
      case 'replanPath':
        await adminVirtualLearnersApi.replanVirtualSessionPath(id)
        break
      case 'startLearning':
        await adminVirtualLearnersApi.startVirtualLearning(id)
        break
      case 'wrapup':
        await adminVirtualLearnersApi.virtualSessionWrapup(id)
        break
      case 'stop':
        await adminVirtualLearnersApi.stopVirtualLearning(id)
        break
      case 'resetPath':
        await adminVirtualLearnersApi.restartVirtualSessionPath(id)
        break
      case 'resetLearn':
        await adminVirtualLearnersApi.restartVirtualLearning(id)
        break
      case 'abandon':
        await adminVirtualLearnersApi.executeBlackboxVirtualAction(
          id,
          { type: 'abandon', reason: 'operator_abandon' },
          blackboxTraceCount.value
        )
        break
      case 'referee':
        await adminVirtualLearnersApi.generateBlackboxEvaluations(id)
        break
      case 'rerun': {
        const res = await adminVirtualLearnersApi.rerunBlackboxVirtualSession(id)
        const d = res.data?.data ?? res.data ?? {}
        const newId = String(d.id || d.sessionId || '')
        if (!newId) {
          toast.info('已按原输入重跑，但未返回新会话 ID；已刷新当前会话')
          await refresh()
          return
        }
        toast.info('已按原输入重跑，正在切换到新会话')
        openSubPage('session', newId)
        return
      }
    }
    toast.success('指令已执行')
    await refresh()
    // 操作闭环：成功后跳到结果所在分页；推进类操作跟随新的当前阶段
    if (!isBlackbox.value) {
      const tabAfterAction: Record<string, StageKey> = {
        advancePath: 'path',
        reviewPath: 'path',
        acceptPath: 'path',
        replanPath: 'path',
        resetPath: 'path',
        startLearning: 'learning',
        resetLearn: 'learning',
        stop: 'learning',
        wrapup: 'wrapup'
      }
      const target = tabAfterAction[kind]
      if (target) {
        activeTab.value = target
      } else if (['step', 'auto', 'runFull'].includes(kind)) {
        const next = currentStage.value
        if ((stageFlow as readonly string[]).includes(next)) activeTab.value = next as StageKey
      }
    }
  } catch (e) {
    const message = `执行失败：${errMsg(e)}`
    await refresh()
    toast.error(message)
  } finally {
    busy.value = false
  }
}

async function removeSession() {
  if (isRealMode.value) return
  const ok = await askConfirm({
    title: '删除会话',
    message: '确认删除该会话？\n运行记录将一并清理，该操作不可撤销。',
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await adminVirtualLearnersApi.deleteVirtualSession(sessionId.value)
    closeSubPage()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  }
}

/* 会话、日志与 Path 就绪状态共用同一轮询（非终态 5s；终态即停止，act 期间跳过） */
let pollTimer: ReturnType<typeof setInterval> | null = null
function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (isTerminal.value) {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      return
    }
    if (document.hidden || busy.value) return
    const id = sessionId.value
    if (!id) return
    void loadLogs()
    if (isRealMode.value) {
      void adminVirtualLearnersApi.getRealSessionConsole(id).then((res) => {
        if (sessionId.value !== id) return
        session.value = res.data?.data ?? res.data ?? {}
        timelineEntries.value = Array.isArray((session.value as Record<string, unknown>)?.timeline)
          ? (session.value as { timeline: Array<{ time: string; kind: string; title: string; detail: string }> }).timeline
          : []
      }).catch(() => undefined)
      return
    }
    void adminVirtualLearnersApi.getVirtualSession(id).then((res) => {
      if (sessionId.value !== id) return
      session.value = res.data?.data ?? res.data ?? {}
      parseBlackbox()
      if (isBlackbox.value) {
        pathStatus.value = null
        teachingDetail.value = null
      } else {
        void loadPathStatus()
        void loadTeachingDetail(selectedTeachingSessionId.value, { silent: true })
      }
    }).catch(() => undefined)
  }, 5000)
}

watch(
  sessionId,
  async (id) => {
    if (!id) return
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    session.value = null
    logs.value = []
    logsFailed.value = false
    logFollowsBottom.value = true
    pathStatus.value = null
    pathStatusFailed.value = false
    teachingDetail.value = null
    teachingDetailFailed.value = false
    selectedTeachingSessionId.value = ''
    refereeReports.value = []
    actorAuditReports.value = []
    refereeTrace.value = []
    refereeTraceCount.value = 0
    privateStateTrace.value = []
    privateStateTraceCount.value = 0
    frictionBudget.value = 'normal'
    timelineEntries.value = []
    rawLogs.value = []
    await refresh()
    if (sessionId.value !== id) return
    const stage = currentStage.value
    activeTab.value = (stageFlow as readonly string[]).includes(stage) ? stage as StageKey : 'goal'
    startPolling()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const rawJson = computed(() => JSON.stringify(session.value, null, 2)?.slice(0, 4000) || '')
</script>

<style scoped>
.cp { gap: 14px; }
.cp-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.cp-title { margin: 0; font-size: 16px; line-height: 1.4; }
.cp-title__id { font-size: 11.5px; color: var(--mk-faint); font-weight: 600; }
.cp-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  width: fit-content;
  transition: background-color 0.1s ease, transform 0.1s ease;
}
.cp-back:hover { background: #eff6ff; }
.cp-back:active { transform: translateY(1px); }
.cp-danger { background: var(--mk-red-strong, var(--mk-red)); border-color: var(--mk-red-strong, var(--mk-red)); color: #fff; }
.cp-danger:hover:not(:disabled) { opacity: 0.9; }

.cp-stages {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cp-stage {
  display: grid;
  gap: 2px;
  padding: 10px 16px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  min-width: 130px;
}
.cp-stage__order { font-size: 10px; font-weight: 800; color: var(--mk-faint); letter-spacing: 0.08em; }
.cp-stage strong { font-size: 13px; }
.cp-stage__state { font-size: 11px; color: var(--mk-faint); }
.cp-stage { cursor: pointer; }
.cp-stage--locked { cursor: default; opacity: 0.85; }
.cp-stage--locked:hover { background: transparent; }
.cp-stage--active { border-color: var(--mk-blue); background: #eef5ff; }
.cp-stage--active .cp-stage__state { color: var(--mk-blue); font-weight: 700; }
.cp-stage--tab { box-shadow: 0 0 0 2px rgba(44, 99, 208, 0.35); }
.cp-stage--done { border-color: rgba(21, 128, 61, 0.3); }
.cp-stage--done .cp-stage__state { color: var(--mk-green); }
.cp-stage__arrow { color: var(--mk-faint); }

.cp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}

.cp-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 14px 16px 0;
}
.cp-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
.cp-btn:hover:not(:disabled) { border-color: rgba(44, 99, 208, 0.4); color: var(--mk-blue); }
.cp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cp-btn--primary { background: var(--mk-blue); border-color: var(--mk-blue); color: #fff; }
.cp-btn--primary:hover:not(:disabled) { color: #fff; opacity: 0.9; }
/* 危险操作：实心红（与 .mk-btn--danger 一致） */
.cp-danger-btn { background: var(--mk-red-strong, var(--mk-red)); border-color: var(--mk-red-strong, var(--mk-red)); color: #fff; }
.cp-danger-btn:hover:not(:disabled) { color: #fff; opacity: 0.9; }
.cp-config {
  padding: 10px 16px 0;
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  color: var(--mk-muted);
}
.cp-config label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}
.cp-config select { min-width: 140px; }
.cp-controls__hint { font-size: 11px; color: var(--mk-faint); align-self: center; }
.cp-tab-actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 10px 16px 0; }

.cp-summary { padding: 12px 16px 16px; display: grid; gap: 8px; }
.cp-summary__item {
  display: grid;
  gap: 3px;
  padding: 9px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 9px;
}
.cp-summary__item span { font-size: 11px; font-weight: 700; color: var(--mk-faint); }
.cp-summary__item p { margin: 0; font-size: 12.5px; }
.cp-none { margin: 0; font-size: 12.5px; color: var(--mk-faint); }
.cp-path-readiness {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 10px;
  border-left: 3px solid var(--mk-line);
  border-radius: 5px;
  background: #f8fafc;
}
.cp-path-readiness span { flex: 0 0 auto; font-size: 11px; font-weight: 800; color: var(--mk-muted); }
.cp-path-readiness p { margin: 0; font-size: 11.5px; color: var(--mk-muted); line-height: 1.5; }
.cp-path-readiness--ok { border-left-color: var(--mk-green); background: #f0fdf4; }
.cp-path-readiness--ok p { color: #15803d; }
.cp-path-readiness--warn { border-left-color: #d97706; background: #fffbeb; }
.cp-path-readiness--warn p { color: #b45309; }
.cp-path-readiness--bad { border-left-color: var(--mk-red); background: var(--mk-red-bg); }
.cp-path-readiness--bad p { color: var(--mk-red); }

.cp-logs__follow {
  font-size: 10.5px; font-weight: 700; color: var(--mk-green); cursor: pointer;
  padding: 2px 8px; border-radius: 999px; background: rgba(16, 185, 129, 0.08);
  transition: background 0.12s ease;
}
.cp-logs__follow:hover { background: rgba(16, 185, 129, 0.15); }
.cp-logs__follow.is-paused { color: var(--mk-amber); background: rgba(217, 119, 6, 0.08); }

.cp-logs {
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 16px 14px;
  display: grid;
  gap: 6px;
}
.cp-log { display: flex; align-items: baseline; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.cp-log--error { padding: 6px 10px; border-radius: 8px; background: var(--mk-red-bg); }
.cp-log__time { color: var(--mk-faint); font-family: var(--mk-mono); font-size: 10.5px; white-space: nowrap; padding-top: 1px; }
.cp-log__phase {
  padding: 0 7px;
  border-radius: 99px;
  font-size: 10.5px;
  font-weight: 700;
  background: #eef2ff;
  color: #4453a1;
  white-space: nowrap;
}
.cp-log__phase--error { background: var(--mk-red); color: #fff; }
.cp-log__text { color: var(--mk-muted); word-break: break-all; min-width: 0; flex: 1 1 auto; }
.cp-log--error .cp-log__text { color: var(--mk-red); font-weight: 600; }
.cp-log__dur {
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  font-size: 10.5px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.cp-log__raw { font-size: 11px; flex-basis: 100%; }
.cp-log__raw summary { cursor: pointer; color: var(--mk-faint); font-weight: 600; user-select: none; }
.cp-log__raw pre {
  margin: 4px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  font: 10.5px/1.5 var(--mk-mono);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow: auto;
}

/* 初始加载占位（session 未就绪时不显示假空态） */
.cp-log-skel { height: 13px; border-radius: 4px; background: linear-gradient(90deg, #eef2fa, #f7f9fc 55%, #eef2fa); background-size: 220% 100%; animation: cp-skel 1.4s ease infinite; }
@keyframes cp-skel { from { background-position: 120% 0; } to { background-position: -120% 0; } }
.cp-path-skel { display: grid; gap: 8px; }
.cp-path-skel > div { height: 40px; border-radius: 8px; background: linear-gradient(90deg, #eef2fa, #f7f9fc 55%, #eef2fa); background-size: 220% 100%; animation: cp-skel 1.4s ease infinite; }

/* 区块降级提示（获取失败 + 重试） */
.cp-degrade {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-red);
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--mk-red-bg);
}
.cp-degrade .mk-link { font-size: 12px; }

.cp-transcripts { display: grid; gap: 10px; padding: 12px 16px 16px; }
.cp-transcript {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
}
.cp-transcript summary { cursor: pointer; font-size: 12px; font-weight: 800; color: var(--mk-muted); }
.cp-transcript__message {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border-left: 3px solid #cbd5e1;
  border-radius: 5px;
  background: #f8fafc;
}
.cp-transcript__message.is-teacher { border-left-color: var(--mk-blue); background: #eff6ff; }
.cp-transcript__message.is-learner { border-left-color: var(--mk-teal); background: #f0fdfa; }
.cp-transcript__message span { font-size: 10.5px; font-weight: 800; color: var(--mk-faint); }
.cp-transcript__message p { margin: 0; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.cp-teaching-history { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-history-btn {
  border: 1px solid var(--mk-line);
  border-radius: 6px;
  background: var(--mk-surface);
  color: var(--mk-muted);
  padding: 4px 7px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.cp-history-btn:hover, .cp-history-btn.is-current { border-color: var(--mk-blue); color: var(--mk-blue); background: #eff6ff; }

.cp-lesson-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: #f8fafc;
}
.cp-lesson-head__main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.cp-lesson-head__main strong { font-size: 13px; }
.cp-lesson-head__ms { font-size: 11px; color: var(--mk-faint); }
.cp-lesson-head__state { padding: 2px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 800; background: #f3f5f9; color: var(--mk-muted); }
.cp-lesson-head__state[data-state='done'] { background: var(--mk-green-bg); color: var(--mk-green); }
.cp-lesson-head__state[data-state='active'] { background: #eff6ff; color: var(--mk-blue); }
.cp-lesson-head__state[data-state='failed'] { background: var(--mk-red-bg); color: var(--mk-red); }
.cp-lesson-head__nav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cp-lesson-head__select {
  max-width: 240px;
  border: 1px solid var(--mk-line);
  border-radius: 6px;
  background: var(--mk-surface);
  color: var(--mk-muted);
  padding: 4px 6px;
  font: inherit;
  font-size: 11px;
}

.cp-path-detail { display: grid; gap: 10px; padding: 12px 16px 16px; align-content: start; }
.cp-path-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 0;
  align-items: start;
}
.cp-review-panel {
  display: grid;
  gap: 10px;
  padding: 12px 16px 16px;
  border-left: 1px solid var(--mk-line);
  align-content: start;
}
.cp-review-panel__head { display: grid; gap: 2px; }
.cp-review-panel__head span { font-size: 12.5px; font-weight: 800; }
.cp-review-panel__head em { font-style: normal; font-size: 10.5px; color: var(--mk-faint); }
.cp-review-panel__actions { display: flex; flex-wrap: wrap; gap: 6px; }
@media (max-width: 1100px) {
  .cp-path-grid { grid-template-columns: 1fr; }
  .cp-review-panel { border-left: none; border-top: 1px solid var(--mk-line); }
}
.cp-path-detail__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.cp-path-detail__head strong { font-size: 13.5px; }
.cp-path-detail__meta { font-size: 11px; color: var(--mk-faint); }
.cp-path-detail__summary { margin: 0; font-size: 12px; color: var(--mk-muted); line-height: 1.6; }
.cp-milestone { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid var(--mk-line); border-radius: 8px; }
.cp-milestone__head { display: flex; align-items: baseline; gap: 8px; }
.cp-milestone__head strong { font-size: 12.5px; }
.cp-milestone__order { font-size: 10.5px; font-weight: 800; color: var(--mk-faint); font-family: var(--mk-mono); }
.cp-milestone__meta { font-size: 10.5px; color: var(--mk-faint); }
.cp-milestone__desc { margin: 0; font-size: 11.5px; color: var(--mk-muted); line-height: 1.55; }
.cp-task-list { margin: 2px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.cp-task-list li { display: flex; gap: 6px; font-size: 11.5px; color: var(--mk-muted); line-height: 1.5; }
.cp-task-list li.is-done { color: var(--mk-green); }
.cp-task-list li.is-current { color: var(--mk-blue); font-weight: 700; }
.cp-task-list__mark { flex: 0 0 auto; font-family: var(--mk-mono); }
.cp-review { display: grid; gap: 8px; padding: 8px 10px; border-radius: 8px; background: #f8fafc; }
.cp-review__badges { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.cp-review__badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 800; background: #f3f5f9; color: var(--mk-muted); }
.cp-review__badge[data-decision='accept'] { background: var(--mk-green-bg); color: var(--mk-green); }
.cp-review__badge[data-decision='modify'] { background: var(--mk-amber-bg); color: var(--mk-amber); }
.cp-review__badge[data-decision='reject'] { background: var(--mk-red-bg); color: var(--mk-red); }
.cp-review__meta { font-size: 10.5px; color: var(--mk-faint); }
.cp-review__reaction { margin: 0; font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
.cp-review__concern { margin: 0; font-size: 11.5px; color: #b45309; }
.cp-review__changes { margin: 0; padding-left: 18px; display: grid; gap: 3px; font-size: 11.5px; color: var(--mk-muted); }
.cp-review__replan { margin: 0; font-size: 11px; color: var(--mk-blue); }

.cp-wrapup { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: 9px; }
.cp-wrapup__label { font-size: 11px; font-weight: 800; color: var(--mk-faint); }
.cp-wrapup p { margin: 0; font-size: 12.5px; line-height: 1.65; white-space: pre-wrap; }
.cp-wrapup__json { margin: 0; font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; font-family: var(--mk-mono); color: var(--mk-muted); max-height: 240px; overflow: auto; }

.cp-raw { font-size: 12px; color: var(--mk-faint); }
.cp-raw summary { cursor: pointer; padding: 4px 2px; }
.cp-raw pre {
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  font: 10.5px/1.6 var(--mk-mono);
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

@media (max-width: 1100px) {
  .cp-grid { grid-template-columns: 1fr; }
}

/* ===== 终局评估结构化渲染 ===== */
.cp-eval-group { display: grid; gap: 10px; padding: 14px 16px 4px; }
.cp-eval-group + .cp-eval-group { border-top: 1px solid var(--mk-line); }
.cp-eval-group__title { margin: 0; font-size: 12px; font-weight: 700; color: var(--mk-muted); letter-spacing: 0.04em; }

.cp-eval {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 12px 14px;
  display: grid;
  gap: 10px;
  margin-bottom: 8px;
}
.cp-eval__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.cp-eval__head strong { font-size: 13px; }
.cp-eval__time { display: block; font-size: 11px; color: var(--mk-faint); margin-top: 2px; }
.cp-eval__overall { display: grid; gap: 4px; justify-items: end; }
.cp-eval__overall-bar { width: 110px; }

.cp-eval__scores { display: flex; flex-wrap: wrap; gap: 8px; }
.cp-eval__score {
  display: grid;
  gap: 3px;
  min-width: 104px;
  padding: 6px 9px;
  border-radius: 6px;
  background: #f6f8fb;
  font-size: 11px;
}
.cp-eval__score code { font-size: 10.5px; color: var(--mk-faint); }
.cp-eval__score strong { font-variant-numeric: tabular-nums; color: var(--mk-ink); font-size: 12px; }

.cp-eval__section { display: grid; gap: 6px; }
.cp-eval__section h5 { margin: 0; font-size: 11.5px; font-weight: 700; color: var(--mk-muted); }

.cp-finding {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--mk-line);
}
.cp-finding:last-child { border-bottom: none; }
.cp-finding strong { font-size: 12.5px; }
.cp-finding p { margin: 4px 0 0; font-size: 12px; color: var(--mk-muted); line-height: 1.6; }
.cp-finding__sev {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 700;
  height: fit-content;
  background: #f3f5f9;
  color: var(--mk-muted);
}
.cp-finding__sev[data-sev='critical'] { background: var(--mk-red-bg); color: var(--mk-red); }
.cp-finding__sev[data-sev='major'] { background: var(--mk-amber-bg); color: var(--mk-amber); }
.cp-finding__sev[data-sev='minor'] { background: #e6f4ff; color: #0958d9; }
.cp-finding__sev[data-sev='info'] { background: #f0fff5; color: #389e0d; }

.cp-evidence { margin-top: 6px; font-size: 11.5px; }
.cp-evidence summary { cursor: pointer; color: var(--mk-faint); font-weight: 600; }
.cp-evidence > div { padding: 4px 8px; border-left: 2px solid var(--mk-line); margin: 6px 0; }
.cp-evidence code { font-size: 10.5px; color: var(--mk-faint); }
.cp-evidence p { margin: 2px 0 0; font-size: 11.5px; color: var(--mk-muted); }

.cp-rec { padding: 6px 0; border-bottom: 1px dashed var(--mk-line); }
.cp-rec:last-child { border-bottom: none; }
.cp-rec__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cp-rec strong { font-size: 12px; }
.cp-rec__codes { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.cp-rec__codes code { font-size: 10px; padding: 1px 5px; background: #f3f5f9; color: var(--mk-faint); border-radius: 4px; }
.cp-rec p { margin: 4px 0 0; font-size: 12.5px; color: var(--mk-muted); }
.cp-rec__rationale { margin-top: 6px; font-size: 11.5px; color: var(--mk-faint); }
.cp-rec__rationale summary { cursor: pointer; font-weight: 600; }
.cp-rec__rationale p { margin: 6px 0 0; }

/* =====三类轨迹折叠面板 ===== */
.cp-trace-panel {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: #f8fafc;
  margin-top: 12px;
}
.cp-trace-panel > summary {
  list-style: none;
  cursor: pointer;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-ink);
  user-select: none;
}
.cp-trace-panel > summary::-webkit-details-marker { display: none; }
.cp-trace-panel > summary::before { content: '▸'; font-size: 11px; color: var(--mk-faint); margin-right: 4px; }
.cp-trace-panel[open] > summary::before { content: '▾'; }
.cp-trace-panel > summary code { font-size: 11px; color: var(--mk-faint); }

.cp-trace-list {
  list-style: none;
  margin: 0;
  padding: 0 14px 14px;
  max-height: 460px;
  overflow-y: auto;
  display: grid;
  gap: 8px;
}
.cp-trace-list > li {
  padding: 9px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 6px;
  background: #fff;
  display: grid;
  gap: 6px;
}
.cp-trace-list__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11.5px; }
.cp-trace-list__seq { font-variant-numeric: tabular-nums; color: var(--mk-faint); font-weight: 700; }
.cp-trace-list__head time { color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.cp-trace-list__id { font-size: 10.5px; color: var(--mk-faint); }
.cp-trace-list__stage {
  padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700;
  background: #eef2ff; color: #4453a1;
}
.cp-trace-list__stage[data-stage='learning'] { background: #ecfdf5; color: #0a8551; }
.cp-trace-list__emotion,
.cp-trace-list__transition {
  padding: 1px 6px; border-radius: 4px; font-size: 10.5px;
  background: #f3f5f9; color: var(--mk-muted);
}
.cp-trace-list__degraded { padding: 1px 6px; border-radius: 4px; font-size: 10.5px; background: var(--mk-red-bg); color: var(--mk-red); }
.cp-trace-list__focus,
.cp-trace-list__reason { font-size: 11.5px; color: var(--mk-muted); }
.cp-trace-list__signal { font-size: 11.5px; color: var(--mk-faint); font-style: italic; }
.cp-trace-list__metrics { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-trace-list__metrics > span { display: inline-flex; align-items: baseline; gap: 4px; padding: 2px 6px; background: #f6f8fb; border-radius: 4px; font-size: 10.5px; }
.cp-trace-list__metrics code { font-size: 10.5px; color: var(--mk-faint); }
.cp-trace-list__metrics strong { font-variant-numeric: tabular-nums; color: var(--mk-ink); }
.cp-trace-list__kv { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-trace-list__kv > span {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 5px;
  background: #f6f8fb;
  font-size: 10.5px;
  max-width: 100%;
}
.cp-trace-list__kv code { flex: 0 0 auto; color: var(--mk-faint); }
.cp-trace-list__kv strong { color: var(--mk-ink); font-weight: 600; word-break: break-all; }
.cp-trace-list__raw { font-size: 11px; }
.cp-trace-list__raw summary { cursor: pointer; color: var(--mk-faint); font-weight: 600; user-select: none; }
.cp-trace-list__raw .cp-trace-list__body { margin-top: 4px; }
.cp-trace-list__flags { display: flex; flex-wrap: wrap; gap: 5px; }
.cp-trace-list__flags > span { padding: 2px 7px; border-radius: 4px; font-size: 10.5px; background: #f3f5f9; color: var(--mk-faint); border: 1px solid transparent; }
.cp-trace-list__flags > span.active { background: #e6f4ff; color: #0958d9; border-color: #91caff; }
.cp-trace-list__blockers { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11.5px; color: var(--mk-muted); }
.cp-trace-list__blocker { padding: 1px 6px; background: var(--mk-amber-bg); color: var(--mk-amber); border-radius: 4px; }
.cp-trace-list__body {
  margin: 4px 0 0; padding: 8px 10px; background: #f8fafc;
  border-radius: 4px; font-size: 10.5px; line-height: 1.5;
  color: var(--mk-muted); white-space: pre-wrap;
  word-break: break-word; max-height: 200px; overflow-y: auto;
}

/* 阶段条进度副标（遗留项 2 C2） */
.cp-stage__progress {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  padding-top: 1px;
}
.cp-stage--active .cp-stage__progress { color: var(--mk-blue); }
.cp-stage--done .cp-stage__progress { color: #15803d; }

/* 真实模式只读提示（推进控制卡内） */
.cp-controls--readonly { font-size: 12px; color: var(--mk-muted); }
.cp-controls--readonly span { line-height: 1.6; }

/* Wrapup 评价字段卡（遗留项 2：评价/评估摘要/来源徽章） */
.cp-eval-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.cp-eval-card {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  gap: 5px;
  background: #fbfcfe;
}
.cp-eval-card--meta { background: #fffdf5; border-color: rgba(180, 83, 9, 0.25); }
.cp-eval-card__label {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.cp-eval-card__value {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--mk-ink);
  white-space: pre-wrap;
  word-break: break-word;
}
.cp-eval-card__badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
.cp-eval-card__badges .mk-badge { margin: 0; }

/* 统一时间线（三流合并）类型/阶段徽章 */
.cp-timeline__kind {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  background: #f1f5f9;
  color: var(--mk-muted);
  white-space: nowrap;
}
.cp-timeline__kind[data-kind='referee'] { background: #fef2f2; color: #b91c1c; }
.cp-timeline__kind[data-kind='private'] { background: #f5f3ff; color: #6d28d9; }
.cp-timeline__kind[data-kind='log'] { background: #eef2ff; color: #4453a1; }
.cp-timeline__kind[data-kind='goal'] { background: #faf5ff; color: #7c3aed; }
.cp-timeline__kind[data-kind='path'] { background: #fff7ed; color: #c2410c; }
.cp-timeline__kind[data-kind='teaching'] { background: #ecfdf5; color: #0a8551; }
.cp-timeline__kind[data-kind='evidence'] { background: #ecfeff; color: #0e7490; }
.cp-timeline__stage {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  background: #eef2ff;
  color: #4453a1;
  white-space: nowrap;
}
.cp-timeline__stage[data-stage='learning'], .cp-timeline__stage[data-stage='teaching'] { background: #ecfdf5; color: #0a8551; }
.cp-timeline__stage[data-stage='goal'] { background: #faf5ff; color: #7c3aed; }
.cp-timeline__stage[data-stage='path'] { background: #fff7ed; color: #c2410c; }
.cp-timeline__title { color: var(--mk-ink); font-weight: 600; word-break: break-word; }
.cp-timeline__detail {
  margin: 0;
  font-size: 11px;
  color: var(--mk-muted);
  line-height: 1.6;
  word-break: break-word;
}

@media (min-width: 2000px) {
  .cp-title { font-size: 18px; }
  .cp-title__id { font-size: 13px; }
  .cp-back { font-size: 14px; }
  .cp-btn { font-size: 14px; padding: 10px 18px; }
  .cp-config { font-size: 13.5px; }
  .cp-controls__hint { font-size: 12.5px; }
  .cp-stage__order { font-size: 11.5px; }
  .cp-stage strong { font-size: 15px; }
  .cp-stage__state { font-size: 12.5px; }
  .cp-stage__progress { font-size: 12px; }
  .cp-controls--readonly { font-size: 13.5px; }
  .cp-eval-card__label { font-size: 12px; }
  .cp-eval-card__value { font-size: 14px; }
  .cp-timeline__kind { font-size: 12px; }
  .cp-timeline__stage { font-size: 12px; }
  .cp-timeline__title { font-size: 13.5px; }
  .cp-timeline__detail { font-size: 12.5px; }
  .cp-summary__item span { font-size: 12.5px; }
  .cp-summary__item p { font-size: 14px; }
  .cp-none { font-size: 14px; }
  .cp-path-readiness span { font-size: 12.5px; }
  .cp-path-readiness p { font-size: 13px; }
  .cp-log { font-size: 13.5px; }
  .cp-log__time { font-size: 12px; }
  .cp-log__phase { font-size: 12px; }
  .cp-log__dur { font-size: 12px; }
  .cp-log__raw { font-size: 12.5px; }
  .cp-degrade { font-size: 13.5px; }
  .cp-degrade .mk-link { font-size: 13.5px; }
  .cp-transcript summary { font-size: 13.5px; }
  .cp-transcript__message span { font-size: 12px; }
  .cp-transcript__message p { font-size: 13.5px; }
  .cp-history-btn { font-size: 12.5px; padding: 5px 8px; }
  .cp-lesson-head__main strong { font-size: 15px; }
  .cp-lesson-head__ms { font-size: 12.5px; }
  .cp-lesson-head__state { font-size: 12px; }
  .cp-lesson-head__select { font-size: 12.5px; padding: 5px 8px; }
  .cp-review-panel__head span { font-size: 14px; }
  .cp-review-panel__head em { font-size: 12px; }
  .cp-path-detail__head strong { font-size: 15.5px; }
  .cp-path-detail__meta { font-size: 12.5px; }
  .cp-path-detail__summary { font-size: 13.5px; }
  .cp-milestone__head strong { font-size: 14px; }
  .cp-milestone__order { font-size: 12px; }
  .cp-milestone__meta { font-size: 12px; }
  .cp-milestone__desc { font-size: 13px; }
  .cp-task-list li { font-size: 13px; }
  .cp-review__badge { font-size: 12.5px; }
  .cp-review__meta { font-size: 12px; }
  .cp-review__reaction { font-size: 13.5px; }
  .cp-review__concern { font-size: 13px; }
  .cp-review__changes { font-size: 13px; }
  .cp-review__replan { font-size: 12.5px; }
  .cp-wrapup__label { font-size: 12.5px; }
  .cp-wrapup p { font-size: 14px; }
  .cp-wrapup__json { font-size: 12.5px; }
  .cp-raw { font-size: 13.5px; }
  .cp-raw pre { font-size: 12px; }
  .cp-eval-group__title { font-size: 13.5px; }
  .cp-eval__head strong { font-size: 15px; }
  .cp-eval__time { font-size: 12.5px; }
  .cp-eval__score { font-size: 12.5px; }
  .cp-eval__score code { font-size: 12.5px; }
  .cp-eval__score strong { font-size: 13.5px; }
  .cp-eval__section h5 { font-size: 13px; }
  .cp-finding strong { font-size: 14px; }
  .cp-finding p { font-size: 13.5px; }
  .cp-finding__sev { font-size: 12px; }
  .cp-evidence { font-size: 13px; }
  .cp-evidence code { font-size: 12px; }
  .cp-evidence p { font-size: 13px; }
  .cp-rec strong { font-size: 13.5px; }
  .cp-rec__codes code { font-size: 11.5px; }
  .cp-rec p { font-size: 14px; }
  .cp-rec__rationale { font-size: 13px; }
  .cp-trace-panel > summary { font-size: 14px; }
  .cp-trace-panel > summary code { font-size: 12.5px; }
  .cp-trace-list__head { font-size: 13px; }
  .cp-trace-list__id { font-size: 12px; }
  .cp-trace-list__stage { font-size: 12px; }
  .cp-trace-list__emotion,
  .cp-trace-list__transition { font-size: 12px; }
  .cp-trace-list__degraded { font-size: 12px; }
  .cp-trace-list__focus,
  .cp-trace-list__reason { font-size: 13px; }
  .cp-trace-list__signal { font-size: 13px; }
  .cp-trace-list__metrics > span { font-size: 12px; }
  .cp-trace-list__metrics code { font-size: 12px; }
  .cp-trace-list__flags > span { font-size: 12px; }
  .cp-trace-list__blockers { font-size: 13px; }
  .cp-trace-list__body { font-size: 12px; }
}

@media (min-width: 2800px) {
  .cp-title { font-size: 21px; }
  .cp-title__id { font-size: 15.5px; }
  .cp-back { font-size: 16.5px; }
  .cp-btn { font-size: 16.5px; padding: 12px 22px; }
  .cp-config { font-size: 16px; }
  .cp-controls__hint { font-size: 14.5px; }
  .cp-stage__order { font-size: 13.5px; }
  .cp-stage strong { font-size: 17.5px; }
  .cp-stage__state { font-size: 14.5px; }
  .cp-summary__item span { font-size: 14.5px; }
  .cp-summary__item p { font-size: 16.5px; }
  .cp-none { font-size: 16.5px; }
  .cp-path-readiness span { font-size: 14.5px; }
  .cp-path-readiness p { font-size: 15.5px; }
  .cp-log { font-size: 16px; }
  .cp-log__time { font-size: 14px; }
  .cp-log__phase { font-size: 14px; }
  .cp-log__dur { font-size: 14px; }
  .cp-log__raw { font-size: 15px; }
  .cp-degrade { font-size: 16px; }
  .cp-degrade .mk-link { font-size: 16px; }
  .cp-transcript summary { font-size: 16px; }
  .cp-transcript__message span { font-size: 14px; }
  .cp-transcript__message p { font-size: 16px; }
  .cp-history-btn { font-size: 14.5px; padding: 6px 10px; }
  .cp-lesson-head__main strong { font-size: 17.5px; }
  .cp-lesson-head__ms { font-size: 14.5px; }
  .cp-lesson-head__state { font-size: 14px; }
  .cp-lesson-head__select { font-size: 14.5px; padding: 6px 10px; }
  .cp-review-panel__head span { font-size: 16.5px; }
  .cp-review-panel__head em { font-size: 14px; }
  .cp-path-detail__head strong { font-size: 18px; }
  .cp-path-detail__meta { font-size: 14.5px; }
  .cp-path-detail__summary { font-size: 16px; }
  .cp-milestone__head strong { font-size: 16.5px; }
  .cp-milestone__order { font-size: 14px; }
  .cp-milestone__meta { font-size: 14px; }
  .cp-milestone__desc { font-size: 15.5px; }
  .cp-task-list li { font-size: 15.5px; }
  .cp-review__badge { font-size: 14.5px; }
  .cp-review__meta { font-size: 14px; }
  .cp-review__reaction { font-size: 16px; }
  .cp-review__concern { font-size: 15.5px; }
  .cp-review__changes { font-size: 15.5px; }
  .cp-review__replan { font-size: 14.5px; }
  .cp-wrapup__label { font-size: 14.5px; }
  .cp-wrapup p { font-size: 16.5px; }
  .cp-wrapup__json { font-size: 14.5px; }
  .cp-raw { font-size: 16px; }
  .cp-raw pre { font-size: 14px; }
  .cp-eval-group__title { font-size: 16px; }
  .cp-eval__head strong { font-size: 17.5px; }
  .cp-eval__time { font-size: 14.5px; }
  .cp-eval__score { font-size: 14.5px; }
  .cp-eval__score code { font-size: 14.5px; }
  .cp-eval__score strong { font-size: 16px; }
  .cp-eval__section h5 { font-size: 15.5px; }
  .cp-finding strong { font-size: 16.5px; }
  .cp-finding p { font-size: 16px; }
  .cp-finding__sev { font-size: 14px; }
  .cp-evidence { font-size: 15.5px; }
  .cp-evidence code { font-size: 14px; }
  .cp-evidence p { font-size: 15.5px; }
  .cp-rec strong { font-size: 16px; }
  .cp-rec__codes code { font-size: 13.5px; }
  .cp-rec p { font-size: 16.5px; }
  .cp-rec__rationale { font-size: 15.5px; }
  .cp-trace-panel > summary { font-size: 16.5px; }
  .cp-trace-panel > summary code { font-size: 14.5px; }
  .cp-trace-list__head { font-size: 15.5px; }
  .cp-trace-list__id { font-size: 14px; }
  .cp-trace-list__stage { font-size: 14px; }
  .cp-trace-list__emotion,
  .cp-trace-list__transition { font-size: 14px; }
  .cp-trace-list__degraded { font-size: 14px; }
  .cp-trace-list__focus,
  .cp-trace-list__reason { font-size: 15.5px; }
  .cp-trace-list__signal { font-size: 15.5px; }
  .cp-trace-list__metrics > span { font-size: 14px; }
  .cp-trace-list__metrics code { font-size: 14px; }
  .cp-trace-list__flags > span { font-size: 14px; }
  .cp-trace-list__blockers { font-size: 15.5px; }
  .cp-trace-list__body { font-size: 14px; }
}
</style>
