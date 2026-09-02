<template>
  <div class="mk-page cp">
    <!-- ===== 顶部栏：身份 + 状态（控制全部下沉到下方统一控制台） ===== -->
    <header class="cp-topbar">
      <div class="cp-topbar__row">
        <button type="button" class="cp-back" @click="goBack">← {{ backLabel }}</button>
        <h1 class="cp-title">会话监控 <span class="cp-title__id mono">{{ shortId }}</span></h1>
        <div class="cp-topbar__spacer"></div>
        <!-- 自动驾驶进行中的状态指示（停止按钮在控制台） -->
        <span v-if="autopilotRunning" class="cp-topbar__autopilot">▶ 自动驾驶 · {{ Number(autopilot.steps || 0) }} 步</span>
        <span class="cp-topbar__sep"></span>
        <!-- 双轴状态：生命周期徽章（轴 A）+ 阶段条（轴 B） -->
        <RunStateBadge :status="runLifecycleState" :hint="statusTitle" :pulse="autopilotRunning" />
        <RunStageBar
          :stage="runStageForBar"
          :status="runLifecycleState"
          :task-progress="runStageTaskProgress"
          :show-task-text="false"
        />
        <span class="cp-topbar__sep"></span>
        <span class="cp-topbar__mode">{{ modeText }}</span>
        <!-- 预算消耗预警条（累积 AI 调用：已用/上限，≥70% 变黄、≥90% 变红） -->
        <span
          class="cp-budget"
          :class="`is-${budgetTone}`"
          :title="`本会话累计 AI 调用 ${budgetUsage.used}/${budgetUsage.limit}（含重试）；可在画像/故事预算中调整上限`"
        >
          <span class="cp-budget__label">AI 调用</span>
          <span class="cp-budget__track"><span class="cp-budget__fill" :style="{ width: `${budgetPct}%` }"></span></span>
          <span class="cp-budget__num">{{ budgetUsage.used }}/{{ budgetUsage.limit }}</span>
        </span>
        <button type="button" class="cp-topbar__btn" :disabled="busy" @click="refresh">刷新</button>
      </div>
    </header>

    <!-- ===== 统一控制台：阶段 tab + 该阶段操作（各阶段操作集中置顶，卡片区只留内容） ===== -->
    <div class="cp-console">
      <div class="cp-console__tabs" role="tablist">
        <button
          v-for="st in stageFlow"
          :key="st"
          type="button"
          class="cp-stage"
          :class="[stageCls(st), { 'cp-stage--tab': !isBlackbox && activeTab === st }]"
          :title="isBlackbox ? '黑盒模式下阶段不可手动切换' : `查看 ${stageLabel(st)} 页签`"
          :disabled="isBlackbox"
          @click="selectStageTab(st)"
        >
          <span class="cp-stage__mark">{{ stageMark(st) }}</span>
          <span class="cp-stage__label">{{ stageLabel(st) }}</span>
          <span v-if="stageProgress(st)" class="cp-stage__progress">{{ stageProgress(st) }}</span>
        </button>
      </div>
      <div class="cp-console__actions">
        <!-- ① 执行推进（跨阶段：自动驾驶（全流程后台）/ 停止自动驾驶；黑盒与真实会话不提供） -->
        <template v-if="!isRealMode && !isBlackbox">
          <template v-if="!autopilotRunning">
            <button v-if="!autopilotStopping" type="button" class="cp-btn cp-btn--primary" :disabled="autopilotStartDisabled" :title="autopilotStartTitle" @click="act('autopilotStart')">自动驾驶</button>
            <button v-else type="button" class="cp-btn" disabled title="已请求停止自动驾驶：后台已停止推进，可点击「自动驾驶」重新启动" @click="act('autopilotStart')">已请求停止</button>
          </template>
          <button v-else type="button" class="cp-btn" :disabled="busy" title="停止自动驾驶：当前课推进完本轮后停止后台自动运行（学习进度与对话保留，可随时再次启动）" @click="act('autopilotStop')">停止自动驾驶</button>
          <span class="cp-console__sep"></span>
        </template>

        <!-- ② 阶段操作（随当前页签切换） -->
        <template v-if="!isRealMode && !isBlackbox && activeTab === 'goal'">
          <button type="button" class="cp-btn" :disabled="goalStepDisabled" :title="goalStepTitle" @click="act('step')">推进一步</button>
          <button type="button" class="cp-btn" :disabled="goalAutoDisabled" :title="goalAutoTitle" @click="act('auto')">自动推进 Goal</button>
          <button type="button" class="cp-btn" :disabled="advancePathDisabled" :title="advancePathTitle" @click="act('advancePath')">生成 Path</button>
          <button v-if="goalConverged" type="button" class="cp-btn" @click="selectStageTab('path')">前往 Path →</button>
        </template>
        <template v-if="!isRealMode && !isBlackbox && activeTab === 'path'">
          <button type="button" class="cp-btn" :disabled="advancePathDisabled" :title="advancePathTitle" @click="act('advancePath')">生成 Path</button>
          <button type="button" class="cp-btn cp-btn--primary" :disabled="startLearningDisabled" :title="startLearningTitle" @click="act('startLearning')">启动 Learn</button>
          <button type="button" class="cp-btn" :disabled="resetPathDisabled" :title="resetPathTitle" @click="act('resetPath')">重建 Path</button>
        </template>
        <template v-if="!isRealMode && !isBlackbox && activeTab === 'learning'">
          <button v-if="!hasLearningProgress" type="button" class="cp-btn cp-btn--primary" :disabled="startLearningDisabled" :title="startLearningTitle" @click="act('startLearning')">启动 Learn</button>
          <template v-else>
            <button type="button" class="cp-btn" :disabled="learnStepDisabled" :title="learnStepTitle" @click="act('step')">推进一步</button>
            <button type="button" class="cp-btn cp-btn--primary" :disabled="learnAutoDisabled" :title="learnAutoTitle" @click="act('auto')">自动推进本课</button>
            <label class="cp-turn-cap-label" title="每课自动推进的回合预算：『自动推进本课』与『自动驾驶』共用；复杂课程可调高到 100">
              每课回合上限
              <input v-model.number="learnAutoTurnCap" type="number" min="1" max="100" class="cp-turn-cap" title="每课自动推进的最大对话轮数（自动推进本课与自动驾驶共用）" aria-label="每课回合上限" />
            </label>
            <!-- 运行中重开本课（失败后的「重试」由生命周期区统一承载，不重复） -->
            <button type="button" class="cp-btn" :disabled="resetLearningDisabled" :title="resetLearningTitle" @click="act('resetLearn')">重开本课</button>
          </template>
        </template>
        <template v-if="!isRealMode && !isBlackbox && activeTab === 'wrapup'">
          <button v-if="!hasWrapup" type="button" class="cp-btn" :disabled="wrapupDisabled" :title="wrapupTitle" @click="act('wrapup')">生成终局总结</button>
        </template>

        <!-- ③ 会话生命周期（vlab-controls 统一模型：暂停/继续/停止/重试，按状态出现；删除仅终态） -->
        <template v-if="!isRealMode && lifeControlsCockpit.length">
          <span class="cp-console__sep"></span>
          <button
            v-for="c in lifeControlsCockpit"
            :key="c.key"
            type="button"
            class="cp-btn"
            :class="{ 'cp-btn--primary': c.tone === 'primary', 'cp-danger-btn': c.tone === 'danger' }"
            :disabled="busy"
            :title="c.hint"
            @click="runCockpitAction(c)"
          >{{ c.label }}</button>
        </template>
        <!-- 真实/黑盒模式声明 -->
        <span v-if="isRealMode || isBlackbox" class="cp-console__note">
          {{ isRealMode ? '真实会话：只读监控' : '黑盒模式：由黑盒执行器驱动，辅助控制不可用' }}
        </span>
      </div>
    </div>

    <!-- ===== 主体：左侧内容 + 右侧控制台 ===== -->
    <div class="cp-body">
      <!-- 主内容区 -->
      <main class="cp-main">
        <!-- Path 内容 -->
        <section v-if="!isBlackbox && activeTab === 'path'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">Path 内容</h3>
            <span class="mk-card__meta">{{ pathDetailMeta || '等待 Path 生成' }}</span>
          </div>
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
                      <li v-for="t in m.tasks" :key="t.id || t.title" :class="{ 'is-done': t.completed, 'is-current': t.current }">
                        <span class="cp-task-list__mark">{{ t.completed ? '✓' : t.current ? '▸' : '·' }}</span>
                        <span v-if="t.id && lessonNumber(t.id)" class="cp-task-list__num">第{{ lessonNumber(t.id) }}课</span>
                        {{ t.title }}
                      </li>
                    </ul>
                  </article>
                </details>
                <p v-else-if="pathGenerationInProgress" class="cp-none">Path 阶段任务仍在生成，稍后自动刷新。</p>
              </template>
              <p v-if="!hasPath && pathStatusFailed" class="cp-degrade">Path 状态获取失败 <button type="button" class="mk-link" @click="loadPathStatus">重试</button></p>
              <p v-else-if="!hasPath" class="cp-none">{{ pathEmptyHint }}</p>
            </template>
          </div>
        </section>

        <!-- Goal 对话 -->
        <section v-if="!isBlackbox && activeTab === 'goal'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">Goal 对话</h3>
            <span class="mk-card__meta">
              {{ goalConversationMessages.length ? `${goalConversationMessages.length} 条已落库` : '暂无记录' }}
              <template v-if="goalConverged"> · 已收敛</template>
            </span>
          </div>
          <div class="cp-transcripts">
            <article v-for="(message, index) in goalConversationMessages" :key="`goal-${index}`" class="cp-transcript__message" :class="message.role === 'assistant' ? 'is-teacher' : 'is-learner'">
              <span>{{ message.role === 'assistant' ? '平台 Goal' : isRealMode ? '学习者' : '虚拟学习者' }}</span>
              <p>{{ message.content }}</p>
            </article>
            <div v-if="!goalConversationMessages.length" class="cp-empty-state">
              <span class="cp-empty-state__icon" aria-hidden="true">◌</span>
              <strong>尚未产生 Goal 对话</strong>
              <p>学习者澄清从零开始；在上方控制台点「推进一步」或「自动推进 Goal」启动。</p>
            </div>
          </div>
        </section>

        <!-- Learn 课堂 -->
        <section v-if="!isBlackbox && activeTab === 'learning'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">Learn 课堂</h3>
            <span class="mk-card__meta">
              <template v-if="learnLessons.length">{{ learnProgressText }}</template>
              <template v-if="!learnLessons.length">暂无记录</template>
            </span>
          </div>
          <!-- 双栏：左侧课程树 + 右侧对话 -->
          <div class="cp-learn-grid">
            <!-- 左侧：里程碑 → 课程树 -->
            <nav class="cp-learn-tree" v-if="lessonTree.length">
              <div v-for="group in lessonTree" :key="group.milestone" class="cp-learn-tree__group">
                <div class="cp-learn-tree__ms">
                  <span class="cp-learn-tree__ms-text">{{ group.milestone }}</span>
                  <span class="cp-learn-tree__ms-count">{{ group.doneCount }}/{{ group.lessons.length }}</span>
                </div>
                <button
                  v-for="l in group.lessons"
                  :key="l.taskId"
                  type="button"
                  class="cp-learn-tree__lesson"
                  :class="{ 'is-active': viewedLesson?.taskId === l.taskId, [`is-${l.state}`]: true }"
                  :disabled="busy"
                  :title="lessonActionTitle(l)"
                  @click="onLessonClick(l)"
                >
                  <span class="cp-learn-tree__mark">{{ lessonMark(l.state) }}</span>
                  <span class="cp-learn-tree__num">第{{ lessonNumber(l.taskId) }}课</span>
                  <span class="cp-learn-tree__title">{{ l.title }}</span>
                </button>
              </div>
            </nav>
            <p v-else class="cp-none">尚未生成课程，请先生成 Path 并启动 Learn。</p>
            <!-- 右侧：对话区 -->
            <div class="cp-learn-chat">
              <div v-if="viewedLesson" class="cp-lesson-head">
                <div class="cp-lesson-head__main">
                  <span class="cp-lesson-head__state" :data-state="viewedLesson.state">{{ lessonStateLabel(viewedLesson.state) }}</span>
                  <strong>第 {{ lessonNumber(viewedLesson.taskId) }} 课 · {{ viewedLesson.title }}</strong>
                  <span class="cp-lesson-head__ms">{{ viewedLesson.milestone }}</span>
                </div>
              </div>
              <p v-if="teachingDetailLoading" class="cp-none">正在读取教学会话记录…</p>
              <!-- 课时总结卡片 -->
              <div v-if="hasLessonWrapup && lessonWrapup" class="cp-lesson-wrapup">
                <div class="cp-lesson-wrapup__head">
                  <span class="cp-lesson-wrapup__badge">✓ 本课总结</span>
                  <span class="cp-lesson-wrapup__scores">
                    <span v-if="lessonWrapup.duration" class="cp-lesson-wrapup__score">{{ lessonWrapup.duration }} 分钟</span>
                    <span v-if="lessonWrapup.turnCount" class="cp-lesson-wrapup__score">{{ lessonWrapup.turnCount }} 轮对话</span>
                    <span v-if="lessonWrapup.avgUnderstanding !== null" class="cp-lesson-wrapup__score">理解 {{ Math.round(lessonWrapup.avgUnderstanding * 100) }}%</span>
                    <span v-if="lessonWrapup.avgEngagement !== null" class="cp-lesson-wrapup__score">参与 {{ Math.round(lessonWrapup.avgEngagement * 100) }}%</span>
                    <span v-if="lessonWrapup.lss !== null" class="cp-lesson-wrapup__score cp-lesson-wrapup__score--primary">LSS {{ Math.round(lessonWrapup.lss * 100) }}%</span>
                    <span v-if="lessonWrapup.ktl !== null" class="cp-lesson-wrapup__score cp-lesson-wrapup__score--primary">KTL {{ Math.round(lessonWrapup.ktl * 100) }}%</span>
                  </span>
                </div>
                <div class="cp-lesson-wrapup__body">
                  <!-- 知识点掌握 -->
                  <div v-if="lessonWrapup.knowledgeItems.length" class="cp-lesson-wrapup__section">
                    <span class="cp-lesson-wrapup__section-title">知识点掌握</span>
                    <div v-for="k in lessonWrapup.knowledgeItems" :key="k.name" class="cp-lesson-wrapup__kp">
                      <span class="cp-lesson-wrapup__kp-name">{{ k.name }}</span>
                      <span class="cp-lesson-wrapup__kp-status" :class="`is-${k.status}`">{{ { mastered: '✓ 已掌握', learning: '学习中', review: '待复习' }[k.status] || k.status }}</span>
                      <span class="cp-lesson-wrapup__kp-bar"><i :style="{ width: (k.progress || 0) + '%' }"></i></span>
                    </div>
                  </div>

                  <!-- 关键收获 -->
                  <div v-if="lessonWrapup.keyTakeaways.length" class="cp-lesson-wrapup__section">
                    <span class="cp-lesson-wrapup__section-title">关键收获</span>
                    <ul class="cp-lesson-wrapup__takeaways">
                      <li v-for="(t, i) in lessonWrapup.keyTakeaways" :key="i">{{ t }}</li>
                    </ul>
                  </div>

                  <!-- 练习建议 -->
                  <div v-if="lessonWrapup.practiceAdvice" class="cp-lesson-wrapup__section">
                    <span class="cp-lesson-wrapup__section-title">练习建议</span>
                    <p class="cp-lesson-wrapup__text">{{ lessonWrapup.practiceAdvice }}</p>
                  </div>

                  <!-- 困惑点 -->
                  <div v-if="lessonWrapup.confusionPoints.length" class="cp-lesson-wrapup__section">
                    <span class="cp-lesson-wrapup__section-title">困惑点</span>
                    <ul class="cp-lesson-wrapup__takeaways">
                      <li v-for="(c, i) in lessonWrapup.confusionPoints" :key="i">{{ c }}</li>
                    </ul>
                  </div>

                  <!-- 评估亮点 -->
                  <div v-if="lessonWrapup.strengths.length || lessonWrapup.improvements.length" class="cp-lesson-wrapup__section">
                    <span class="cp-lesson-wrapup__section-title">评估</span>
                    <div v-if="lessonWrapup.strengths.length" class="cp-lesson-wrapup__eval-item">
                      <span class="cp-lesson-wrapup__eval-label cp-lesson-wrapup__eval-label--good">优势</span>
                      <ul class="cp-lesson-wrapup__eval-list">
                        <li v-for="s in lessonWrapup.strengths" :key="s">{{ s }}</li>
                      </ul>
                    </div>
                    <div v-if="lessonWrapup.improvements.length" class="cp-lesson-wrapup__eval-item">
                      <span class="cp-lesson-wrapup__eval-label cp-lesson-wrapup__eval-label--warn">改进</span>
                      <ul class="cp-lesson-wrapup__eval-list">
                        <li v-for="s in lessonWrapup.improvements" :key="s">{{ s }}</li>
                      </ul>
                    </div>
                  </div>

                  <!-- 情绪 & 认知 -->
                  <div v-if="lessonWrapup.dominantCognitiveLevel" class="cp-lesson-wrapup__meta-row">
                    <span v-if="lessonWrapup.dominantCognitiveLevel">认知: {{ lessonWrapup.dominantCognitiveLevel }} → {{ lessonWrapup.lastCognitiveLevel }}</span>
                    <span>情绪: 😊{{ lessonWrapup.positiveEmotions }} 😐{{ lessonWrapup.neutralEmotions }} 😤{{ lessonWrapup.frustratedEmotions }} 😕{{ lessonWrapup.confusedEmotions }}</span>
                    <span v-if="lessonWrapup.fatigueRisk">疲劳风险: {{ lessonWrapup.fatigueRisk }}</span>
                  </div>
                </div>
              </div>
              <template v-if="learnConversationMessages.length">
                <article v-for="(message, index) in learnConversationMessages" :key="`learn-${index}`" class="cp-transcript__message" :class="message.role === 'assistant' ? 'is-teacher' : 'is-learner'">
                  <span>{{ message.role === 'assistant' ? '教师' : isRealMode ? '学习者' : '虚拟学习者' }}</span>
                  <p>{{ message.content }}</p>
                </article>
              </template>
              <p v-else-if="teachingDetailFailed && !learnConversationMessages.length" class="cp-degrade">教学记录获取失败 <button type="button" class="mk-link" @click="loadTeachingDetail(selectedTeachingSessionId)">重试</button></p>
              <p v-else-if="!viewedLesson" class="cp-none">点击左侧课程查看对话。</p>
              <p v-else-if="!learnConversationMessages.length" class="cp-none">{{ learnEmptyHint }}</p>
            </div>
          </div>
        </section>

        <!-- 总结 -->
        <section v-if="!isBlackbox && activeTab === 'wrapup'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">学习总结</h3>
            <span class="mk-card__meta">
              {{ completedTaskCount }}/{{ learnLessons.length }} 课已完成
              <template v-if="hasWrapup"> · 终局总结已生成</template>
            </span>
          </div>

          <!-- 课时进度概览 -->
          <div class="cp-wrapup-lessons" v-if="lessonTree.length">
            <div v-for="group in lessonTree" :key="group.milestone" class="cp-wrapup-ms">
              <div class="cp-wrapup-ms__head">
                <span class="cp-wrapup-ms__title">{{ group.milestone }}</span>
                <span class="cp-wrapup-ms__count">{{ group.doneCount }}/{{ group.lessons.length }}</span>
              </div>
              <div
                v-for="l in group.lessons"
                :key="l.taskId"
                class="cp-wrapup-lesson"
                :class="{ 'is-done': l.state === 'done', 'is-active': l.state === 'active' }"
                @click="l.state === 'done' && l.teachingSessionId && viewLessonSummary(l)"
              >
                <span class="cp-wrapup-lesson__mark">{{ lessonMark(l.state) }}</span>
                <span class="cp-wrapup-lesson__num">第{{ lessonNumber(l.taskId) }}课</span>
                <span class="cp-wrapup-lesson__title">{{ l.title }}</span>
                <span v-if="l.state === 'done' && l.teachingSessionId" class="cp-wrapup-lesson__action">查看总结 →</span>
              </div>
            </div>
          </div>

          <!-- 终局总结（已生成时） -->
          <template v-if="hasWrapup">
            <div class="cp-wrapup-stats" v-if="pathDetailTitle || wrapupSourceBadge">
              <div class="cp-wrapup-stats__goal" v-if="pathDetailTitle">
                <span class="cp-wrapup-stats__label">学习目标</span>
                <strong>{{ pathDetailTitle }}</strong>
              </div>
              <div class="cp-wrapup-stats__badges">
                <span class="cp-wrapup-stats__item"><em>{{ pathMilestonesView.length }}</em> 个里程碑</span>
                <span class="cp-wrapup-stats__item"><em>{{ learnLessons.length }}</em> 节课</span>
                <span v-if="wrapupSourceBadge" class="mk-badge" :class="wrapupSourceBadge === '模型生成' ? 'mk-badge--info' : 'mk-badge--muted'">{{ wrapupSourceBadge }}</span>
                <span v-if="wrapupStatusBadge" class="mk-badge" :class="wrapupStatusBadge === 'complete' ? 'mk-badge--ok' : 'mk-badge--warn'">{{ wrapupStatusBadge === 'complete' ? '总结完整' : '降级总结' }}</span>
              </div>
            </div>
            <div class="cp-wrapup-cards" v-if="wrapupFieldCards.length">
              <div v-for="card in wrapupFieldCards" :key="card.label" class="cp-wrapup-card">
                <div class="cp-wrapup-card__icon">{{ wrapupCardIcon(card.label) }}</div>
                <div class="cp-wrapup-card__body">
                  <span class="cp-wrapup-card__label">{{ card.label }}</span>
                  <p class="cp-wrapup-card__text">{{ card.value }}</p>
                </div>
              </div>
            </div>
            <div v-if="wrapupSections.length" class="cp-wrapup-sections">
              <div v-for="section in wrapupSections" :key="section.label" class="cp-wrapup-section">
                <span class="cp-wrapup-section__label">{{ section.label }}</span>
                <pre v-if="section.isJson" class="cp-wrapup__json">{{ section.text }}</pre>
                <p v-else class="cp-wrapup-section__text">{{ section.text }}</p>
              </div>
            </div>
            <div class="cp-wrapup-footer" v-if="wrapupSections.length">
              <span v-if="wrapupSourceBadge" class="mk-badge" :class="wrapupSourceBadge === '模型生成' ? 'mk-badge--info' : 'mk-badge--muted'">{{ wrapupSourceBadge }}</span>
              <span v-if="wrapupStatusBadge" class="mk-badge" :class="wrapupStatusBadge === 'complete' ? 'mk-badge--ok' : 'mk-badge--warn'">{{ wrapupStatusBadge === 'complete' ? '总结完整' : '降级总结' }}</span>
            </div>
          </template>

          <p v-if="!hasWrapup && !lessonTree.length" class="cp-none" style="padding: 24px 16px;">{{ wrapupEmptyHint }}</p>
        </section>

        <!-- 终局评估（黑盒终态） -->
        <section v-if="refereeReports.length || actorAuditReports.length" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">终局评估</h3>
            <span class="mk-card__meta">平台 {{ refereeReports.length }} · 角色 {{ actorAuditReports.length }}</span>
          </div>
          <div v-if="refereeReports.length" class="cp-eval-group">
            <h4 class="cp-eval-group__title">平台质量裁判</h4>
            <template v-for="(r, i) in refereeReports" :key="`r-${i}`">
              <article v-if="r.report" class="cp-eval">
                <div class="cp-eval__head">
                  <div><strong>{{ verdictLabel(r.report.verdict) }}</strong><span class="cp-eval__time">{{ formatTime(r.evaluatedAt) }}</span></div>
                  <div class="cp-eval__overall">
                    <span class="mk-badge" :class="scoreBadgeCls(r.report.scores?.overall)">{{ scoreToPct(r.report.scores?.overall) }}</span>
                    <span class="mk-minibar cp-eval__overall-bar"><i class="mk-minibar__fill" :data-tone="scoreTone(r.report.scores?.overall)" :style="{ width: scoreFillPct(r.report.scores?.overall) + '%' }"></i></span>
                  </div>
                </div>
                <div v-if="r.report.scores" class="cp-eval__scores">
                  <span v-for="item in scoreItems(r.report.scores, 'referee')" :key="item.label" class="cp-eval__score"><code>{{ item.label }}</code><strong>{{ scoreToPct(item.value) }}</strong><span class="mk-minibar"><i class="mk-minibar__fill" :data-tone="scoreTone(item.value)" :style="{ width: scoreFillPct(item.value) + '%' }"></i></span></span>
                </div>
                <div v-if="r.report.findings?.length" class="cp-eval__section">
                  <h5>平台发现</h5>
                  <article v-for="f in r.report.findings" :key="f.code" class="cp-finding">
                    <span class="cp-finding__sev" :data-sev="f.severity">{{ f.severity }}</span>
                    <div><strong>{{ f.title }}</strong><p>{{ f.detail }}</p>
                      <details v-if="findingEvidence(r, f).length" class="cp-evidence"><summary>证据 {{ findingEvidence(r, f).length }}</summary><div v-for="e in findingEvidence(r, f)" :key="e.id"><code>{{ e.source }}{{ e.index === null ? '' : `[${e.index}]` }} · {{ e.path }}</code><p>{{ e.excerpt || e.interpretation }}</p></div></details>
                    </div>
                  </article>
                </div>
                <div v-if="r.report.recommendations?.length" class="cp-eval__section">
                  <h5>平台建议</h5>
                  <article v-for="(rec, rIdx) in r.report.recommendations" :key="`rec-${rIdx}`" class="cp-rec">
                    <div class="cp-rec__head"><strong>{{ rec.priority }}</strong><span v-if="rec.findingCodes?.length" class="cp-rec__codes"><code v-for="c in rec.findingCodes" :key="String(c)">{{ c }}</code></span></div>
                    <p>{{ rec.action }}</p>
                    <details v-if="rec.rationale" class="cp-rec__rationale"><summary>依据</summary><p>{{ rec.rationale }}</p></details>
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
                  <div><strong>{{ verdictLabel(r.report.verdict) }}</strong><span class="cp-eval__time">{{ formatTime(r.evaluatedAt) }}</span></div>
                  <div class="cp-eval__overall">
                    <span class="mk-badge" :class="scoreBadgeCls(r.report.scores?.overall)">{{ scoreToPct(r.report.scores?.overall) }}</span>
                    <span class="mk-minibar cp-eval__overall-bar"><i class="mk-minibar__fill" :data-tone="scoreTone(r.report.scores?.overall)" :style="{ width: scoreFillPct(r.report.scores?.overall) + '%' }"></i></span>
                  </div>
                </div>
                <div v-if="r.report.scores" class="cp-eval__scores cp-eval__scores--actor">
                  <span v-for="item in scoreItems(r.report.scores, 'actor')" :key="item.label" class="cp-eval__score"><code>{{ item.label }}</code><strong>{{ scoreToPct(item.value) }}</strong><span class="mk-minibar"><i class="mk-minibar__fill" :data-tone="scoreTone(item.value)" :style="{ width: scoreFillPct(item.value) + '%' }"></i></span></span>
                </div>
                <div v-if="r.report.findings?.length" class="cp-eval__section">
                  <h5>角色发现</h5>
                  <article v-for="f in r.report.findings" :key="f.code" class="cp-finding">
                    <span class="cp-finding__sev" :data-sev="f.severity">{{ f.severity }}</span>
                    <div><strong>{{ f.title }}</strong><p>{{ f.detail }}</p>
                      <details v-if="findingEvidence(r, f).length" class="cp-evidence"><summary>证据 {{ findingEvidence(r, f).length }}</summary><div v-for="e in findingEvidence(r, f)" :key="e.id"><code>{{ e.source }}{{ e.index === null ? '' : `[${e.index}]` }} · {{ e.path }}</code><p>{{ e.excerpt || e.interpretation }}</p></div></details>
                    </div>
                  </article>
                </div>
                <div v-if="r.report.recommendations?.length" class="cp-eval__section">
                  <h5>模拟器建议</h5>
                  <article v-for="(rec, rIdx) in r.report.recommendations" :key="`arec-${rIdx}`" class="cp-rec">
                    <div class="cp-rec__head"><strong>{{ rec.priority }}</strong><span v-if="rec.findingCodes?.length" class="cp-rec__codes"><code v-for="c in rec.findingCodes" :key="String(c)">{{ c }}</code></span></div>
                    <p>{{ rec.action }}</p>
                    <details v-if="rec.rationale" class="cp-rec__rationale"><summary>依据</summary><p>{{ rec.rationale }}</p></details>
                  </article>
                </div>
              </article>
            </template>
          </div>
        </section>

        <!-- 调试：原始 JSON -->
        <details class="cp-raw">
          <summary>原始会话数据</summary>
          <pre>{{ rawJson }}</pre>
        </details>
      </main>

      <!-- ===== 右列：阶段卡（按当前阶段） + 运维面板（折叠） ===== -->
      <aside class="cp-sidebar">
        <!-- Goal 阶段卡：预生成 Path（左对话 / 右提案 两列语义） -->
        <section v-if="!isRealMode && !isBlackbox && activeTab === 'goal'" class="cp-aside-card">
          <div class="cp-aside-card__head">
            <h4>预生成 Path <span class="cp-aside-card__dot" :class="hasPath ? 'is-ok' : goalConverged ? 'is-warn' : 'is-muted'"></span></h4>
            <span class="mk-card__meta">Goal 收敛后生成学习路径方案</span>
          </div>
          <div class="cp-aside-card__body">
            <template v-if="hasPath">
              <div class="cp-aside-state cp-aside-state--ok">
                <strong>✓ Path 方案已生成</strong>
                <p>包含 {{ pathMilestonesView.length }} 个里程碑 · {{ learnLessons.length || '—' }} 节课。</p>
                <button type="button" class="cp-btn cp-btn--sm cp-btn--primary" @click="selectStageTab('path')">查看 Path →</button>
              </div>
            </template>
            <template v-else-if="pathGenerationInProgress">
              <div class="cp-aside-state cp-aside-state--busy">
                <span class="cp-aside-state__spin" aria-hidden="true"></span>
                <strong>正在生成 Path 方案…</strong>
                <p>里程碑与课程树生成中，稍后自动刷新；也可前往 Path 页签查看进度。</p>
              </div>
            </template>
            <template v-else>
              <div class="cp-aside-state" :class="goalConverged ? 'cp-aside-state--warn' : 'cp-aside-state--empty'">
                <span class="cp-aside-state__icon" aria-hidden="true">{{ goalConverged ? '◎' : '◌' }}</span>
                <strong>{{ goalConverged ? 'Path 尚未生成' : 'Goal 尚未收敛' }}</strong>
                <p>{{ goalConverged
                  ? 'Goal 澄清已完成，点击「生成 Path」产出学习路径方案。'
                  : '继续「推进一步」或点「自动推进 Goal」，澄清完成后自动进入 Path 生成。' }}</p>
                <button v-if="!advancePathDisabled" type="button" class="cp-btn cp-btn--sm" @click="act('advancePath')">生成 Path</button>
                <button v-else type="button" class="cp-btn cp-btn--sm cp-btn--primary" @click="act('auto')">自动推进 Goal</button>
              </div>
            </template>
          </div>
        </section>

        <!-- Path 阶段卡：Path 评审（左方案 / 右评审 两列语义） -->
        <section v-if="!isRealMode && !isBlackbox && activeTab === 'path'" class="cp-aside-card">
          <div class="cp-aside-card__head">
            <h4>Path 评审 <span class="cp-aside-card__dot" :class="pathReviewStatus ? 'is-ok' : 'is-muted'"></span></h4>
            <span class="mk-card__meta">{{ pathReviewStatus ? pathReviewDecisionLabel : '未评审 — 评审只是质量检查，可直接启动 Learn' }}</span>
          </div>
          <div class="cp-aside-card__body">
            <div class="cp-review-panel__actions">
              <button type="button" class="cp-btn cp-btn--sm" :disabled="reviewPathDisabled" :title="reviewPathTitle" @click="act('reviewPath')">评审</button>
              <button v-if="acceptPathVisible" type="button" class="cp-btn cp-btn--primary cp-btn--sm" :disabled="acceptPathDisabled" :title="acceptPathTitle" @click="act('acceptPath')">接受</button>
              <button v-if="replanPathVisible" type="button" class="cp-btn cp-btn--primary cp-btn--sm" :disabled="replanPathDisabled" :title="replanPathTitle" @click="act('replanPath')">按意见重规划</button>
            </div>
            <div v-if="pathReviewStatus" class="cp-review">
              <div class="cp-review__badges">
                <span class="cp-review__badge" :data-decision="pathReviewDecision">{{ pathReviewDecisionLabel }}</span>
                <span class="cp-review__meta">{{ pathReviewStatusLabel }}<template v-if="pathReviewTime"> · {{ pathReviewTime }}</template></span>
              </div>
              <p v-if="pathReviewReaction" class="cp-review__reaction">{{ pathReviewReaction }}</p>
              <p v-if="pathReviewConcern" class="cp-review__concern">最大顾虑：{{ pathReviewConcern }}</p>
              <ul v-if="pathReviewChanges.length" class="cp-review__changes"><li v-for="(c, i) in pathReviewChanges" :key="i">{{ c }}</li></ul>
              <p v-if="pathReviewReplan" class="cp-review__replan">{{ pathReviewReplan }}</p>
            </div>
            <p v-else class="cp-none">尚未评审。评审只是质量检查，可直接启动 Learn。</p>
          </div>
        </section>

        <!-- Learn 阶段卡：运行状态（左课堂 / 右监控 两列语义） -->
        <section v-if="!isRealMode && !isBlackbox && activeTab === 'learning'" class="cp-aside-card">
          <div class="cp-aside-card__head">
            <h4>运行状态 <span class="cp-aside-card__dot" :class="autopilotRunning ? 'is-ok' : isPaused ? 'is-warn' : 'is-muted'"></span></h4>
            <span class="mk-card__meta">{{ sessionStatusLabel }}</span>
          </div>
          <div class="cp-aside-card__body">
            <div class="cp-run">
              <div v-if="autopilotResultText && !autopilotRunning" class="cp-run__autopilot-result" :class="{
                'cp-run__autopilot-result--ok': autopilot.status === 'completed',
                'cp-run__autopilot-result--bad': autopilot.status === 'failed',
                'cp-run__autopilot-result--muted': autopilot.status === 'stopped'
              }">{{ autopilotResultText }}</div>
              <div class="cp-run__stages">
                <div class="cp-run__stage-row" v-for="st in stageFlow" :key="st">
                  <span class="cp-run__stage-dot" :class="`cp-run__stage-dot--${stageDone(st as StageKey) ? 'done' : stageActive(st as StageKey) ? 'active' : 'pending'}`"></span>
                  <span class="cp-run__stage-label">{{ stageLabel(st) }}</span>
                  <span class="cp-run__stage-status">{{ stageMiniStatus(st as StageKey) }}</span>
                </div>
              </div>
              <div class="cp-run__foot">
                <label v-if="!isBlackbox && !isRealMode" class="cp-run__budget">
                  难度
                  <select v-model="frictionBudget" class="mk-filter__select" :disabled="frictionSaving" @change="saveFriction">
                    <option value="none">无</option>
                    <option value="low">低</option>
                    <option value="normal">正常</option>
                    <option value="high">高</option>
                    <option value="stress_test">压力测试</option>
                  </select>
                </label>
                <span v-if="showPathReadiness" class="cp-run__readiness" :class="`cp-run__readiness--${pathReadinessTone}`">{{ pathReadinessText }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 总结阶段卡：总结统计 -->
        <section v-if="!isRealMode && !isBlackbox && activeTab === 'wrapup'" class="cp-aside-card">
          <div class="cp-aside-card__head">
            <h4>总结统计 <span class="cp-aside-card__dot" :class="hasWrapup ? 'is-ok' : 'is-muted'"></span></h4>
            <span class="mk-card__meta">{{ hasWrapup ? '终局总结已生成' : '学习完成后生成' }}</span>
          </div>
          <div class="cp-aside-card__body">
            <div class="cp-aside-state" :class="hasWrapup ? 'cp-aside-state--ok' : 'cp-aside-state--empty'">
              <span class="cp-aside-state__icon" aria-hidden="true">{{ hasWrapup ? '✓' : '◌' }}</span>
              <strong>{{ completedTaskCount }}/{{ learnLessons.length || '—' }} 课已完成</strong>
              <p v-if="!hasWrapup && lessonTree.length">全部课程完成后，可在控制台生成终局总结（学习目标、评估、知识掌握）。</p>
              <p v-else-if="!lessonTree.length">尚未开始学习，生成 Path 并启动 Learn 后这里会展示进度。</p>
            </div>
          </div>
        </section>

        <!-- 运行状态（非 Learn tab 时保留为折叠运维面板） -->
        <div v-if="!isRealMode && activeTab !== 'learning'" class="cp-sidebar__section">
          <button type="button" class="cp-sidebar__toggle" :class="{ 'is-open': sidebarOpen.run }" @click="sidebarOpen.run = !sidebarOpen.run">
            <span class="cp-sidebar__toggle-icon">{{ sidebarOpen.run ? '▾' : '▸' }}</span>
            <span>运行状态</span>
            <span class="cp-sidebar__toggle-hint">{{ sessionStatusLabel }}</span>
          </button>
          <div v-if="sidebarOpen.run" class="cp-sidebar__body">
            <div class="cp-run">
              <!-- 自动驾驶结果 -->
              <div v-if="autopilotResultText && !autopilotRunning" class="cp-run__autopilot-result" :class="{
                'cp-run__autopilot-result--ok': autopilot.status === 'completed',
                'cp-run__autopilot-result--bad': autopilot.status === 'failed',
                'cp-run__autopilot-result--muted': autopilot.status === 'stopped'
              }">{{ autopilotResultText }}</div>

              <!-- 阶段进度指示 -->
              <div class="cp-run__stages" v-if="!isRealMode">
                <div class="cp-run__stage-row" v-for="st in stageFlow" :key="st">
                  <span class="cp-run__stage-dot" :class="`cp-run__stage-dot--${stageDone(st as StageKey) ? 'done' : stageActive(st as StageKey) ? 'active' : 'pending'}`"></span>
                  <span class="cp-run__stage-label">{{ stageLabel(st) }}</span>
                  <span class="cp-run__stage-status">{{ stageMiniStatus(st as StageKey) }}</span>
                </div>
              </div>

              <!-- 难度 -->
              <div class="cp-run__foot">
                <label v-if="!isBlackbox && !isRealMode" class="cp-run__budget">
                  难度
                  <select v-model="frictionBudget" class="mk-filter__select" :disabled="frictionSaving" @change="saveFriction">
                    <option value="none">无</option>
                    <option value="low">低</option>
                    <option value="normal">正常</option>
                    <option value="high">高</option>
                    <option value="stress_test">压力测试</option>
                  </select>
                </label>
                <span v-if="showPathReadiness" class="cp-run__readiness" :class="`cp-run__readiness--${pathReadinessTone}`">{{ pathReadinessText }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 会话日志 -->
        <div class="cp-sidebar__section">
          <button type="button" class="cp-sidebar__toggle" :class="{ 'is-open': sidebarOpen.logs }" @click="sidebarOpen.logs = !sidebarOpen.logs">
            <span class="cp-sidebar__toggle-icon">{{ sidebarOpen.logs ? '▾' : '▸' }}</span>
            <span>会话日志</span>
            <span class="cp-sidebar__toggle-hint">{{ isRealMode ? '只读' : isTerminal ? '已终态' : '5s 轮询' }}</span>
          </button>
          <div v-if="sidebarOpen.logs" class="cp-sidebar__body">
            <div v-if="session && logPhases.length > 1" class="cp-logs__filter">
              <button v-for="p in logPhases" :key="p" type="button" class="cp-logs__filter-chip" :class="{ 'is-active': logPhaseFilter === p }" @click="logPhaseFilter = logPhaseFilter === p ? '' : p">{{ p }}</button>
            </div>
            <div class="cp-logs" ref="logBox" aria-live="polite" aria-label="实时日志" @scroll="onLogScroll">
              <span class="cp-logs__follow" :class="{ 'is-paused': !logFollowsBottom }" :title="logFollowsBottom ? '自动跟随最新日志' : '已暂停跟随'" @click="scrollToBottom">{{ logFollowsBottom ? '⏵' : '⏸' }}</span>
              <template v-if="!session">
                <div v-for="n in 4" :key="n" class="cp-log-skel" aria-hidden="true"></div>
              </template>
              <template v-else>
                <div v-for="(l, i) in filteredLogs" :key="i" class="cp-log" :class="{ 'cp-log--error': l.view.isError }">
                  <span class="cp-log__time">{{ l.time }}</span>
                  <span v-if="l.view.phase" class="cp-log__phase" :class="{ 'cp-log__phase--error': l.view.isError }">{{ l.view.phase }}</span>
                  <span class="cp-log__text">{{ l.view.text }}</span>
                  <span v-if="l.view.durationText" class="cp-log__dur">{{ l.view.durationText }}</span>
                  <details v-if="l.view.rawJson" class="cp-log__raw"><summary>原文</summary><pre>{{ l.view.rawJson }}</pre></details>
                </div>
                <p v-if="logsFailed" class="cp-degrade">日志获取失败 <button type="button" class="mk-link" @click="loadLogs">重试</button></p>
                <p v-else-if="!filteredLogs.length" class="cp-none">{{ logPhaseFilter ? '当前筛选无匹配日志' : '暂无日志' }}</p>
              </template>
            </div>
          </div>
        </div>

        <!-- Trace 诊断 -->
        <div v-if="hasTraceFlows" class="cp-sidebar__section">
          <button type="button" class="cp-sidebar__toggle" :class="{ 'is-open': sidebarOpen.trace }" @click="sidebarOpen.trace = !sidebarOpen.trace">
            <span class="cp-sidebar__toggle-icon">{{ sidebarOpen.trace ? '▾' : '▸' }}</span>
            <span>Trace 诊断</span>
            <span class="cp-sidebar__toggle-hint">{{ refereeTraceCount + privateStateTraceCount }} 条</span>
          </button>
          <div v-if="sidebarOpen.trace" class="cp-sidebar__body">
            <!-- 统一时间线 -->
            <details v-if="!isRealMode && unifiedTimeline.length" class="cp-trace-panel" open>
              <summary>统一时间线 · {{ unifiedTimeline.length }} 条</summary>
              <ol class="cp-trace-list">
                <li v-for="(t, idx) in unifiedTimeline" :key="`tl-${idx}`">
                  <div class="cp-trace-list__head"><span class="cp-trace-list__seq">#{{ idx + 1 }}</span><time>{{ formatTime(t.time) }}</time><span class="cp-timeline__kind" :data-kind="t.kind">{{ t.kindLabel }}</span><span v-if="t.stage" class="cp-timeline__stage" :data-stage="String(t.stage).toLowerCase()">{{ t.stage }}</span><strong class="cp-timeline__title">{{ t.title }}</strong></div>
                  <p v-if="t.detail" class="cp-timeline__detail">{{ t.detail }}</p>
                </li>
              </ol>
            </details>
            <!-- 裁判旁路诊断 -->
            <details v-if="refereeTrace.length" class="cp-trace-panel">
              <summary>裁判旁路诊断 · {{ refereeTraceCount }} 条</summary>
              <ol class="cp-trace-list">
                <li v-for="(tv, idx) in refereeTraceViews" :key="(tv.item.traceId || '') + idx">
                  <div class="cp-trace-list__head"><span class="cp-trace-list__seq">#{{ idx + 1 }}</span><time>{{ formatTime(tv.item.timestamp) }}</time><code v-if="tv.item.traceId" class="cp-trace-list__id">{{ tv.item.traceId }}</code></div>
                  <div v-if="tv.rows.length" class="cp-trace-list__kv"><span v-for="row in tv.rows" :key="row.label"><code>{{ row.label }}</code><strong>{{ row.value }}</strong></span></div>
                  <details v-if="tv.rawJson" class="cp-trace-list__raw"><summary>原文 JSON</summary><pre class="cp-trace-list__body">{{ tv.rawJson }}</pre></details>
                </li>
              </ol>
            </details>
            <!-- 角色私有状态 -->
            <details v-if="privateStateTrace.length" class="cp-trace-panel">
              <summary>角色私有状态 · {{ privateStateTraceCount }} 条</summary>
              <ol class="cp-trace-list">
                <li v-for="(item, idx) in privateStateTrace" :key="(item.sequence ?? idx)">
                  <div class="cp-trace-list__head"><span class="cp-trace-list__seq">#{{ item.sequence ?? (idx + 1) }}</span><span class="cp-trace-list__stage" :data-stage="item.stage">{{ item.stage }}</span><code v-if="item.taskId">task={{ item.taskId.slice(0, 8) }}</code><time v-if="item.generatedAt">{{ formatTime(item.generatedAt) }}</time><span v-if="item.emotion" class="cp-trace-list__emotion">{{ item.emotion }}</span><span v-if="item.degraded" class="cp-trace-list__degraded">degraded</span><span v-if="item.transition" class="cp-trace-list__transition">{{ item.transition }}</span></div>
                  <div v-if="item.phaseFocus" class="cp-trace-list__focus">聚焦：{{ item.phaseFocus }}</div>
                  <div v-if="item.visibleSignal" class="cp-trace-list__signal">{{ item.visibleSignal }}</div>
                  <div v-if="item.stateChangeReason" class="cp-trace-list__reason">状态变化：{{ item.stateChangeReason }}</div>
                  <div v-if="item.metrics && Object.keys(item.metrics).length" class="cp-trace-list__metrics"><span v-for="(v, k) in item.metrics" :key="k"><code>{{ k }}</code><strong>{{ v }}</strong></span></div>
                  <div v-if="item.flags && Object.keys(item.flags).length" class="cp-trace-list__flags"><span v-for="(v, k) in item.flags" :key="k" :class="{ active: !!v }">{{ k }}</span></div>
                  <div v-if="item.blockers?.length" class="cp-trace-list__blockers"><span>阻塞：</span><span v-for="(b, bIdx) in item.blockers" :key="bIdx" class="cp-trace-list__blocker">{{ b }}</span></div>
                </li>
              </ol>
            </details>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { subPage, closeSubPage, openSubPage } from './store'
import { errMsg } from './live'
import { askConfirm } from './useConfirm'
import {
  VS_CONTROL_DEFS,
  vlabControlsFor,
  type VsControlDef,
  type VsControlKey,
  type VsLifecycleState
} from './vlab-controls'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import RunStateBadge from './RunStateBadge.vue'
import RunStageBar from './RunStageBar.vue'
import { parseLogEntry, type LogEntryView } from './sessionLog'
import { scoreBadgeCls, scoreFillPct, scoreToPct, scoreTone } from './evalScore'
import { traceSummaryRows, traceRawJson, type TraceKeyValue } from './traceSummary'
import { useSafePolling } from '@/composables/useSafePolling'

const sessionId = computed(() => subPage.value?.id || '')
const shortId = computed(() => (sessionId.value.length > 20 ? `…${sessionId.value.slice(-16)}` : sessionId.value))

/* 双模式：session=虚拟会话控制台（原行为 100% 保留）；session-real=真实教学/目标会话只读控制台 */
const isRealMode = computed(() => subPage.value?.view === 'session-real')
/** 会话所属画像 id（从会话 API 的 virtual_learner_profiles 取；无 from 时用于回二级画像） */
const sessionProfileId = computed(() => {
  const p = (session.value?.virtual_learner_profiles || {}) as Record<string, unknown>
  return String(p.id || '')
})
const backLabel = computed(() => {
  if (subPage.value?.from) return '画像' // 从二级（画像）进来 → 返回画像
  if (sessionProfileId.value) return '画像' // 从一级进三级 → 也回该会话所属画像
  return isRealMode.value ? '会话列表' : '虚拟学习者'
})
/** 返回：有来源 → 回来源页；否则回该会话所属画像（二级）；都没有 → 回一级 */
function goBack() {
  const from = subPage.value?.from
  if (from) {
    closeSubPage()
    return
  }
  const pid = sessionProfileId.value
  if (pid) {
    openSubPage('virtual', pid)
    return
  }
  closeSubPage()
}
const realKind = ref<'teaching' | 'goal'>('teaching')
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
const logPhaseFilter = ref('')
/* 所有出现过的日志阶段，用于筛选 chips */
const logPhases = computed(() => {
  const seen = new Set<string>()
  for (const l of logs.value) {
    if (l.view.phase) seen.add(l.view.phase)
  }
  return [...seen]
})
const filteredLogs = computed(() => {
  if (!logPhaseFilter.value) return logs.value
  return logs.value.filter(l => l.view.phase === logPhaseFilter.value)
})
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
/** 当前查看课时的 wrapup 总结数据 */
const lessonWrapup = computed(() => {
  const wrapup = teachingDetail.value?.wrapup
  if (!wrapup || typeof wrapup !== 'object') return null
  const w = wrapup as Record<string, unknown>
  const summary = (w.summary || {}) as Record<string, unknown>
  const evaluation = (w.evaluation || {}) as Record<string, unknown>
  const evidence = (w.evidence || {}) as Record<string, unknown>
  const progress = (w.progress || {}) as Record<string, unknown>
  const learner = (w.learner || {}) as Record<string, unknown>
  const knowledgeItems = Array.isArray(summary.knowledgeItems) ? summary.knowledgeItems as Array<{ name: string; status: string; progress: number; evidence: string }> : []
  const confusionPoints = Array.isArray(evidence.topConfusionPoints) ? evidence.topConfusionPoints as string[] : []
  const highlights = (summary.evaluationHighlights || {}) as Record<string, unknown>
  const emotions = (evidence.emotionalSignals || {}) as Record<string, unknown>
  return {
    status: String(w.status || ''),
    duration: numberValue(w.duration),
    topicSummary: String(summary.topicSummary || ''),
    knowledgeSummary: String(summary.knowledgeSummary || ''),
    practiceAdvice: String(summary.practiceAdvice || ''),
    learningEvaluation: String(summary.learningEvaluation || ''),
    keyTakeaways: Array.isArray(summary.keyTakeaways) ? summary.keyTakeaways as string[] : [],
    actionPlan: Array.isArray(summary.actionPlan) ? summary.actionPlan as string[] : [],
    knowledgeItems,
    confusionPoints,
    strengths: Array.isArray(highlights.strengths) ? highlights.strengths as string[] : [],
    improvements: Array.isArray(highlights.improvements) ? highlights.improvements as string[] : [],
    lss: numberValue(evaluation.sessionLss),
    ktl: numberValue(evaluation.sessionKtl),
    lf: numberValue(evaluation.sessionLf),
    turnCount: numberValue(evidence.turnCount),
    avgUnderstanding: numberValue(evidence.avgUnderstanding),
    avgEngagement: numberValue(evidence.avgEngagement),
    dominantCognitiveLevel: String(evidence.dominantCognitiveLevel || ''),
    lastCognitiveLevel: String(evidence.lastCognitiveLevel || ''),
    positiveEmotions: numberValue(emotions.positive) || 0,
    neutralEmotions: numberValue(emotions.neutral) || 0,
    frustratedEmotions: numberValue(emotions.frustrated) || 0,
    confusedEmotions: numberValue(emotions.confused) || 0,
    fatigueRisk: String(learner.fatigueRisk || ''),
    recommendedPacing: String(learner.recommendedPacing || ''),
    newlyMastered: Array.isArray(progress.newlyMastered) ? progress.newlyMastered as string[] : [],
  }
})
const hasLessonWrapup = computed(() => !!lessonWrapup.value && (!!lessonWrapup.value.topicSummary || !!lessonWrapup.value.knowledgeSummary))
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

/* ---- 预算消耗（三级页顶栏预警条）：runtimeStats.aiCalls / 画像 maxRetriesTotal ---- */
const budgetUsage = computed(() => {
  const rs = (stageResults.value.runtimeStats || {}) as Record<string, unknown>
  const used = Number(rs.aiCalls) || 0
  // 故事级预算优先，否则画像级（profile.simulationBudget.maxRetriesTotal），否则默认 600
  const storyBudget = ((stageResults.value.story || {}) as Record<string, unknown>).budget as Record<string, unknown> | undefined
  const profileBudget = ((session.value?.virtual_learner_profiles || {}) as Record<string, unknown>).profile as string | undefined
  let limit = 600
  try {
    if (storyBudget && Number.isFinite(Number(storyBudget.maxRetriesTotal))) {
      limit = Number(storyBudget.maxRetriesTotal)
    } else if (profileBudget) {
      const pd = JSON.parse(profileBudget) as Record<string, unknown>
      const sb = (pd.simulationBudget || {}) as Record<string, unknown>
      if (Number.isFinite(Number(sb.maxRetriesTotal))) limit = Number(sb.maxRetriesTotal)
    }
  } catch { /* 忽略解析失败 */ }
  return { used, limit: Math.max(1, limit) }
})
const budgetPct = computed(() => Math.min(100, Math.round((budgetUsage.value.used / budgetUsage.value.limit) * 100)))
const budgetTone = computed(() => {
  const pct = budgetPct.value
  if (pct >= 90) return 'full'
  if (pct >= 70) return 'warn'
  return 'ok'
})

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
/* 暂停标志：pause API 设 stageResults.teaching.paused = true（与 VirtualProfile 的读取位置一致） */
const isPaused = computed(() =>
  learningResult.value.paused === true
  || stageStatus.value.learning?.paused === true
)

/* ===== 全自动模式：以最终目标（Path 全部完成）为终点的无人值守运行 ===== */
const autopilot = computed(() => asRecord(stageResults.value.autopilot) as {
  status?: string
  mode?: string
  steps?: number
  lastStage?: string | null
  lastError?: string | null
  startedAt?: string
  completedAt?: string
  stopRequested?: boolean
})
// stopRequested=true 表示已请求停止（可能主循环已死未消费）：视为未运行，
// 否则会出现「已停止却仍显示停止自动驾驶按钮」的悬挂态（按钮点了没反应）
const autopilotRunning = computed(() => autopilot.value.status === 'running' && autopilot.value.stopRequested !== true)
const autopilotStopping = computed(() => autopilot.value.status === 'running' && autopilot.value.stopRequested === true)
const autopilotStartDisabled = computed(() => {
  if (!session.value) return true
  if (busy.value) return true
  if (isTerminal.value) return true
  return autopilotRunning.value
})
const autopilotStartTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (isTerminal.value) return '会话已终态，无需启动全自动'
  if (autopilotRunning.value) return '全自动正在运行中'
  return '自动驾驶：后台持续推进，直达 Path 全部任务完成（每课回合数受「每课回合上限」约束；可随时「停止自动驾驶」暂停，进度保留）'
})
const autopilotResultText = computed(() => {
  const st = autopilot.value.status
  if (st === 'completed') return '✅ 全部完成：Path 所有任务已跑完'
  if (st === 'failed') return `❌ 运行失败：${firstText(autopilot.value.lastError) || '未知原因'}`
  if (st === 'stopped') return '⏸ 已停止自动驾驶'
  if (st === 'running' && autopilot.value.stopRequested === true) return '⏸ 已请求停止自动驾驶（等待确认）'
  return ''
})
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

/* 双轴状态（与一/二级页同源）：生命周期合成态 + 阶段条输入 */
const runLifecycleState = computed(() => {
  if (!session.value) return 'created'
  const st = normalized(session.value?.status || '')
  // 会话终态优先
  if (['completed', 'failed', 'abandoned'].includes(st)) return st
  // 手动停止（emergencyStop）标 failed + manualStop → 展示为已手动停止
  if (manualStopped.value) return 'abandoned'
  // 暂停（pause API）
  if (isPaused.value) return 'paused'
  // autopilot 停止 → 已暂停
  if (autopilot.value.status === 'stopped') return 'paused'
  // 运行中（含手动步进）
  if (st === 'running' || st === 'created') return st === 'created' ? 'created' : 'running'
  return st || 'created'
})
const runStageForBar = computed(() => {
  if (!session.value) return null
  return String(session.value?.currentStage || runtime.value.currentStage || 'goal').toLowerCase()
})
const runStageTaskProgress = computed(() => {
  const done = numberValue(session.value?.completedTasks) || 0
  const total = numberValue(session.value?.totalTasks) || 0
  if (total <= 0) return null
  return { done, total }
})

/* 阶段流：后端 currentStage 枚举是 goal/path/teaching，前端归一为 learning */
const stageFlow = ['goal', 'path', 'learning', 'wrapup'] as const
type StageKey = (typeof stageFlow)[number]

/* 阶段分页：阶段条即 tab，默认跟随 currentStage；控制面板与日志常驻 */
const activeTab = ref<StageKey>('goal')
const sidebarOpen = reactive({ run: true, logs: true, review: false, trace: false })
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

/** Path → Milestones → Lessons 的层级分组，用于 Learn 树形视图 */
const lessonTree = computed(() => {
  const tree: { milestone: string; lessons: LearnLesson[]; doneCount: number }[] = []
  const map = new Map<string, LearnLesson[]>()
  for (const l of learnLessons.value) {
    const key = l.milestone
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(l)
  }
  for (const m of pathMilestonesView.value) {
    const lessons = map.get(m.title) || []
    if (lessons.length) {
      tree.push({ milestone: m.title, lessons, doneCount: lessons.filter(l => l.state === 'done').length })
    }
  }
  return tree
})

function lessonMark(state: LessonState) {
  return { done: '✓', active: '▸', failed: '✕', pending: '·' }[state]
}
function lessonStateLabel(state: LessonState) {
  return { done: '已完成', active: '进行中', failed: '失败，可重启恢复', pending: '未开始' }[state]
}
/** 全局课程编号（跨里程碑递增） */
function lessonNumber(taskId: string) {
  const idx = learnLessons.value.findIndex(l => l.taskId === taskId)
  return idx >= 0 ? idx + 1 : 0
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
function openLesson(lesson: LearnLesson) {
  if (!lesson.teachingSessionId) return
  const currentTeachingId = firstText(bindings.value.teachingSessionId)
  if (lesson.teachingSessionId === currentTeachingId) {
    showCurrentTeaching()
  } else {
    showArchivedTeaching(lesson.teachingSessionId)
  }
}

/* 课程按钮点击：已有课堂 → 查看对话；未开始（pending）→ 手动选择从该课开始学习。
   用途：当前课卡住（如回合预算耗尽）时，可跳过直接学习后续课程，不再被 disabled 锁死。 */
function lessonActionTitle(l: LearnLesson): string {
  if (l.teachingSessionId) return '查看课堂对话'
  if (l.state === 'done') return '已完成'
  return '尚未开始；点击可从该课开始学习（跳过当前卡住的课）'
}
async function onLessonClick(l: LearnLesson) {
  if (l.teachingSessionId) {
    openLesson(l)
    return
  }
  const id = sessionId.value
  if (!id || busy.value) return
  const ok = await askConfirm({
    title: '从该课开始学习',
    message: `将从「第 ${lessonNumber(l.taskId)} 课 · ${l.title}」开始学习（跳过当前卡住的课）。\n已完成课程进度保留，未开始课程不会受影响。确认？`,
    confirmText: '开始学习'
  })
  if (!ok) return
  busy.value = true
  try {
    await adminVirtualLearnersApi.startVirtualLearning(id, { taskId: l.taskId })
    toast.success(`已从「第 ${lessonNumber(l.taskId)} 课」开始学习`)
    if (!pollingActive.value && !isTerminal.value) startPolling()
    void refresh()
  } catch (e) {
    toast.error(`启动失败：${errMsg(e)}`)
  } finally { busy.value = false }
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
const wrapupTaskSettled = computed(() => {
  // 与后端 generateWrapupForSession 闸门一致：任务结算或整路径完成才可生成总结
  if (terminalStatus.value === 'completed' || terminalPathCompleted.value) return true
  const runtimeStatus = String(
    (learningResult.value.taskRuntime as Record<string, unknown> | undefined)?.status || ''
  )
  return runtimeStatus === 'completed' || runtimeStatus === 'task_completion_pending'
})
const wrapupAvailable = computed(() =>
  !hasWrapup.value && (hasLearningProgress.value || terminalPathCompleted.value) && wrapupTaskSettled.value
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
  return isBlackbox.value ? '执行一条黑盒实验轨迹' : '推进一步：当前阶段前进一轮（Goal=对话一轮 / Learn=教学对话一轮），结果即时可见'
})
const autoDisabled = computed(() => !session.value || busy.value || isTerminal.value || isBlackbox.value)
const autoTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式仅支持单步推进'
  if (isTerminal.value) return '会话已终态，不能继续推进'
  return '自动推进当前阶段直到收敛或回合上限（Goal=跑到收敛转 Path；Learn=跑完当前课）'
})

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
const learnAutoTitle = computed(() => stageMismatchTitle('learning', '自动推进对话直至本课收束') || autoTitle.value)
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
  return '启动 Learn：从第一个可运行课程开始（评审不是前置条件，可直接启动）'
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
  if (!wrapupAvailable.value && !wrapupTaskSettled.value && learningActive.value) return '课堂总结在课程完成后才会生成：当前任务尚未结算完成'
  if (!wrapupAvailable.value) return '请先启动 Learn 并产生消息或学习进度'
  return '根据当前 Learn 记录生成总结'
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
/** Wrapup 卡片图标映射 */
function wrapupCardIcon(label: string) {
  const map: Record<string, string> = {
    '主题摘要': '📖',
    '知识总结': '🧠',
    '练习建议': '💡',
    '学习评估': '📊',
  }
  return map[label] || '📋'
}
/** 从总结页点击课时 → 跳转到 Learn 标签并打开该课时的总结 */
function viewLessonSummary(lesson: LearnLesson) {
  activeTab.value = 'learning'
  nextTick(() => openLesson(lesson))
}

function stageLabel(st: string) {
  return {
    goal: 'Goal',
    path: 'Path',
    learning: 'Learn',
    wrapup: '总结'
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

/* 阶段胶囊状态标记：已完成 ✓ / 当前 · / 其他空 */
function stageMark(st: string) {
  const key = st as StageKey
  if (stageDone(key)) return '✓'
  if (stageActive(key)) return '·'
  return ''
}

/** 会话状态简短标签 */
const sessionStatusLabel = computed(() => {
  if (isRealMode.value) return '只读'
  if (autopilotRunning.value) return '自动驾驶'
  if (session.value?.status === 'running') return '运行中'
  if (session.value?.status === 'completed') return '已完成'
  if (session.value?.status === 'failed') return '失败'
  return ''
})
/** 阶段迷你状态文本 */
function stageMiniStatus(st: StageKey) {
  if (st === 'goal') {
    const n = goalConversationMessages.value.length
    return n ? `${n} 轮` : (stageDone(st) ? '已收敛' : '')
  }
  if (st === 'path') {
    return pathMilestonesView.value.length ? `${pathMilestonesView.value.length} 个里程碑` : ''
  }
  if (st === 'learning') {
    const done = learnLessons.value.filter(l => l.state === 'done').length
    const total = learnLessons.value.length
    return total ? `${done}/${total}` : ''
  }
  if (st === 'wrapup') {
    return hasWrapup.value ? '已生成' : ''
  }
  return ''
}

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
    // 每课回合上限初始值：画像运行偏好（会话创建时写入 simulationConfig），驾驶舱可临时调
    const turnCap = Number(simCfg.turnCapPerLesson)
    if (Number.isFinite(turnCap) && turnCap >= 1 && turnCap <= 100) {
      learnAutoTurnCap.value = Math.round(turnCap)
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
          // 虚拟会话日志字段是 timestamp（非 createdAt）；兼容两者
          time: l.timestamp || l.createdAt ? new Date(String(l.timestamp || l.createdAt)).toLocaleTimeString('zh-CN', { hour12: false }) : '',
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
        time: l.timestamp || l.createdAt ? new Date(String(l.timestamp || l.createdAt)).toLocaleTimeString('zh-CN', { hour12: false }) : '',
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
// 自动学习回合上限（前端可配，默认 40，不同课收束节奏不同；画像预算可设默认值）
const learnAutoTurnCap = ref(40)

function clampLearnAutoTurnCap(): number {
  const n = Math.round(Number(learnAutoTurnCap.value))
  if (!Number.isFinite(n)) return 40
  return Math.min(100, Math.max(1, n))
}

async function saveFriction() {
  if (!sessionId.value || isBlackbox.value || busy.value || frictionSaving.value) return
  frictionSaving.value = true
  const previous = frictionBudget.value
  try {
    await adminVirtualLearnersApi.updateSessionSimulationConfig(sessionId.value, {
      frictionBudget: frictionBudget.value
    })
    toast.success(`难度等级已更新：${frictionBudget.value}`)
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
    toast.success('已请求暂停：当前回合结束后生效')
    void refresh()
  } catch (e) {
    toast.error(`暂停失败：${errMsg(e)}`)
  } finally { busy.value = false }
}
async function resumeSession() {
  if (busy.value || !sessionId.value) return
  busy.value = true
  try {
    await adminVirtualLearnersApi.resumeVirtualSession(sessionId.value)
    toast.success('已恢复自动学习')
    void refresh()
  } catch (e) {
    toast.error(`恢复失败：${errMsg(e)}`)
  } finally { busy.value = false }
}
async function stopLearning() {
  if (busy.value) return
  // 语义与文案由统一模型提供（vlab-controls stop），此处只执行动作
  busy.value = true
  try {
    await adminVirtualLearnersApi.stopVirtualLearning(sessionId.value)
    toast.success('已终止学习会话')
    void refresh()
  } catch (e) {
    toast.error(`停止失败：${errMsg(e)}`)
  } finally { busy.value = false }
}
async function restartLearning() {
  if (busy.value) return
  // 语义与文案由统一模型提供（vlab-controls retry：保留进度续传），此处只执行动作
  busy.value = true
  try {
    await adminVirtualLearnersApi.restartVirtualLearning(sessionId.value)
    toast.success('已重启学习阶段')
    // 失败会话的轮询定时器此前已自毁，sessionId 未变、watch 不触发，必须显式拉起
    if (!pollingActive.value && !isTerminal.value) startPolling()
    void refresh()
  } catch (e) {
    toast.error(`重启失败：${errMsg(e)}`)
  } finally { busy.value = false }
}

/* ===== 生命周期控制（统一模型 vlab-controls）：顶栏操作按钮由状态机派生 ===== */
const lifeStateCockpit = computed<VsLifecycleState>(() => {
  const st = String(session.value?.status || '')
  if (st === 'running') return isPaused.value ? 'paused' : 'running'
  if (st === 'created') return 'created'
  if (st === 'failed') return 'failed'
  if (st === 'abandoned') return 'abandoned'
  if (st === 'completed') return 'completed'
  return 'idle'
})
const lifeHandlersCockpit: Partial<Record<VsControlKey, () => void>> = {
  pause: pauseSession,
  resume: resumeSession,
  stop: stopLearning,
  retry: restartLearning,
  delete: () => { void removeSession() }
}
const lifeControlsCockpit = computed(() =>
  vlabControlsFor(lifeStateCockpit.value).filter((c) => lifeHandlersCockpit[c.key])
)
/** 统一操作入口：需确认的操作（stop/retry）先过模型文案确认，再执行 */
function runCockpitAction(c: VsControlDef) {
  const fn = lifeHandlersCockpit[c.key]
  if (!fn) return
  if (c.confirm) {
    void askConfirm({ title: c.confirm.title, message: c.confirm.message, confirmText: c.confirm.confirmText }).then((ok) => {
      if (ok) fn()
    })
    return
  }
  fn()
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
    /* 重开学习/结束学习：确认文案统一来自 vlab-controls（retry/stop），防语义漂移 */
    if (kind === 'resetLearn' || kind === 'stop') {
      const c = VS_CONTROL_DEFS[kind === 'resetLearn' ? 'retry' : 'stop']
      if (!c.confirm) return
      const ok = await askConfirm({ title: c.confirm.title, message: c.confirm.message, confirmText: c.confirm.confirmText })
      if (!ok) return
    }
    /* 重建路径/按评审意见重规划：都会替换现有 Path 方案（覆盖型操作），必须确认 */
    if (kind === 'resetPath') {
      const ok = await askConfirm({
        title: '重建学习路径',
        message: '将删除当前 Path 方案并重新生成（Goal 上下文保留）。\n已有 Learn 历史或进度时会拒绝执行。确认？',
        confirmText: '重建 Path'
      })
      if (!ok) return
    }
    if (kind === 'replanPath') {
      const ok = await askConfirm({
        title: '按评审意见重规划',
        message: '将按当前评审意见重新规划 Path 方案，替换现有方案（Goal 上下文保留）。\n确认？',
        confirmText: '重新规划'
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
          await adminVirtualLearnersApi.virtualSessionAutoLearning(id, { maxMilestones: 1, maxTurns: clampLearnAutoTurnCap() })
        } else {
          await adminVirtualLearnersApi.virtualSessionAuto(id, { maxRounds: 10 })
        }
        break
      case 'autopilotStart':
        await adminVirtualLearnersApi.autopilotStart(id, { maxTurns: clampLearnAutoTurnCap() })
        toast.info('全自动模式已启动：将以最终目标（Path 全部完成）为终点持续运行，每课回合上限随「回合上限」设置')
        break
      case 'autopilotStop':
        await adminVirtualLearnersApi.autopilotStop(id)
        toast.info('已请求停止全自动')
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
        openSubPage('session', newId, subPage.value?.from ? { from: subPage.value.from } : undefined)
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
      } else if (['step', 'auto'].includes(kind)) {
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
  // 确认由统一模型执行（vlab-controls delete.confirm；删除仅终态可触发），此处只执行动作
  try {
    await adminVirtualLearnersApi.deleteVirtualSession(sessionId.value)
    goBack()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  }
}

/* 会话、日志与 Path 就绪状态共用同一轮询（非终态 5s；终态即停止，act 期间跳过；
   setTimeout 链 + 并发守卫 + 指数退避，后端不可用时不会堆积请求） */
const { start: startPolling, stop: stopPolling, isActive: pollingActive } = useSafePolling(
  async () => {
    if (isTerminal.value) {
      stopPolling()
      return
    }
    const id = sessionId.value
    if (!id) return
    await loadLogs()
    if (isRealMode.value) {
      try {
        const res = await adminVirtualLearnersApi.getRealSessionConsole(id)
        if (sessionId.value !== id) return
        session.value = res.data?.data ?? res.data ?? {}
        timelineEntries.value = Array.isArray((session.value as Record<string, unknown>)?.timeline)
          ? (session.value as { timeline: Array<{ time: string; kind: string; title: string; detail: string }> }).timeline
          : []
      } catch { /* 静默忽略 */ }
      return
    }
    try {
      const res = await adminVirtualLearnersApi.getVirtualSession(id)
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
    } catch { /* 静默忽略 */ }
  },
  {
    interval: 5000,
    maxBackoff: 30000,
    circuitBreakerThreshold: 8,
    skipWhenHidden: true,
  }
)

watch(
  sessionId,
  async (id) => {
    if (!id) return
    stopPolling()
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

const rawJson = computed(() => JSON.stringify(session.value, null, 2)?.slice(0, 4000) || '')
</script>

<style scoped>
/* ===== Top bar ===== */
.cp { gap: 0; }
.cp-topbar {
  background: var(--mk-surface);
  border-bottom: 1px solid var(--mk-line);
  padding: 12px 16px 0;
  position: sticky;
  top: 0;
  z-index: 10;
  margin: -8px -8px 0;
}
.cp-topbar__row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 8px;
}
.cp-title { margin: 0; font-size: var(--mk-fs-15); line-height: 1.4; }
.cp-title__id { font-size: var(--mk-fs-11); color: var(--mk-faint); font-weight: 600; }
.cp-topbar__spacer { flex: 1; }
.cp-topbar__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.cp-topbar__dot--ok { background: var(--mk-green); }
.cp-topbar__dot--info { background: var(--mk-blue); }
.cp-topbar__dot--warn { background: var(--mk-amber); }
.cp-topbar__dot--bad { background: var(--mk-red); }
.cp-topbar__dot--muted { background: var(--mk-faint); }
.cp-topbar__status { font-size: var(--mk-fs-13); font-weight: 700; }
.cp-topbar__mode { font-size: var(--mk-fs-12); color: var(--mk-faint); }
.cp-topbar__btn {
  border: 1px solid var(--mk-line);
  border-radius: 6px;
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 600;
  padding: 4px 10px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.cp-topbar__btn:hover:not(:disabled) { border-color: var(--mk-blue); color: var(--mk-blue); }
.cp-topbar__btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cp-topbar__btn--primary { background: var(--mk-blue); border-color: var(--mk-blue); color: #fff; }
.cp-topbar__btn--primary:hover:not(:disabled) { opacity: 0.9; }
.cp-topbar__btn--danger { background: var(--mk-red-strong, var(--mk-red)); border-color: var(--mk-red-strong, var(--mk-red)); color: #fff; }
.cp-topbar__sep { width: 1px; height: 20px; background: var(--mk-line); flex-shrink: 0; margin: 0 2px; }
.cp-topbar__autopilot {
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-amber);
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.1);
  white-space: nowrap;
}

/* 预算消耗预警条（顶栏：累积 AI 调用 used/limit，分档变色） */
.cp-budget {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  font-size: var(--mk-fs-11);
  white-space: nowrap;
  cursor: help;
}
.cp-budget__label { font-weight: 700; color: #64748b; }
.cp-budget__track { width: 56px; height: 6px; border-radius: 3px; background: #e2e8f0; overflow: hidden; }
.cp-budget__fill { display: block; height: 100%; border-radius: 3px; background: #10b981; transition: width 0.3s ease; }
.cp-budget__num { font-weight: 800; color: #334155; font-variant-numeric: tabular-nums; }
.cp-budget.is-warn { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.07); }
.cp-budget.is-warn .cp-budget__fill { background: #f59e0b; }
.cp-budget.is-full { border-color: rgba(239, 68, 68, 0.5); background: rgba(239, 68, 68, 0.07); }
.cp-budget.is-full .cp-budget__fill { background: #ef4444; }
.cp-budget.is-full .cp-budget__num { color: #dc2626; }

.cp-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: var(--mk-fs-12_5);
  font-weight: 700;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background-color 0.1s ease;
}
.cp-back:hover { background: #eff6ff; }

/* ===== 统一控制台（阶段 tab + 该阶段操作，置顶汇聚） ===== */
.cp-console {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-sm);
  margin-top: 12px;
}
.cp-console__tabs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.cp-console__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.cp-console__sep { width: 1px; height: 18px; background: var(--mk-line); flex-shrink: 0; }
.cp-console__spacer { flex: 1; }
.cp-console__note { font-size: var(--mk-fs-12); color: var(--mk-faint); }

/* ----- Stage tabs（pill 形态，置于控制台内） ----- */
.cp-stage {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-12_5);
  font-weight: 700;
  color: var(--mk-muted);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.cp-stage:hover:not(:disabled) { color: var(--mk-ink); background: #f1f5f9; }
.cp-stage__mark { font-size: var(--mk-fs-11); width: 14px; text-align: center; }
.cp-stage__label { font-size: var(--mk-fs-12_5); }
.cp-stage__progress { font-size: var(--mk-fs-11); font-weight: 600; color: var(--mk-faint); }
.cp-stage:disabled { cursor: default; opacity: 0.8; }
.cp-stage--active { border-color: rgba(44, 99, 208, 0.35); background: #eff6ff; color: var(--mk-blue); }
.cp-stage--active .cp-stage__mark { color: var(--mk-blue); }
.cp-stage--active .cp-stage__progress { color: var(--mk-blue); }
.cp-stage--tab { border-color: rgba(44, 99, 208, 0.35); }
.cp-stage--tab:hover:not(:disabled) { color: var(--mk-blue); }
.cp-stage--done { color: var(--mk-green); }
.cp-stage--done .cp-stage__mark { color: var(--mk-green); }
.cp-stage--done .cp-stage__progress { color: var(--mk-green); }

/* ===== Body: main + sidebar ===== */
.cp-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 14px;
  align-items: start;
  margin-top: 14px;
}
.cp-main {
  display: grid;
  gap: 14px;
  align-content: start;
  min-width: 0;
}

/* ===== 右列阶段卡（goal→预生成 Path / path→评审 / learning→运行 / wrapup→统计） ===== */
.cp-aside-card {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-sm);
  overflow: hidden;
}
.cp-aside-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--mk-line);
}
.cp-aside-card__head h4 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--mk-fs-12_5);
  font-weight: 800;
}
.cp-aside-card__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-faint); flex-shrink: 0; }
.cp-aside-card__dot.is-ok { background: var(--mk-green); }
.cp-aside-card__dot.is-warn { background: var(--mk-amber); }
.cp-aside-card__dot.is-muted { background: var(--mk-faint); }
.cp-aside-card__body { padding: 12px 14px; }

/* 阶段卡内的状态块（空态/就绪/进行中） */
.cp-aside-state {
  display: grid;
  gap: 7px;
  justify-items: start;
}
.cp-aside-state__icon {
  font-size: 26px;
  line-height: 1;
  color: var(--mk-faint);
}
.cp-aside-state strong { font-size: var(--mk-fs-13); font-weight: 800; }
.cp-aside-state p { margin: 0; font-size: var(--mk-fs-12); line-height: 1.6; color: var(--mk-muted); }
.cp-aside-state--ok strong { color: var(--mk-green); }
.cp-aside-state--ok .cp-aside-state__icon { color: var(--mk-green); }
.cp-aside-state--warn strong { color: var(--mk-amber); }
.cp-aside-state--warn .cp-aside-state__icon { color: var(--mk-amber); }
.cp-aside-state--empty strong { color: var(--mk-ink); }
.cp-aside-state--busy strong { color: var(--mk-blue); }
.cp-aside-state__spin {
  width: 14px;
  height: 14px;
  border: 2px solid var(--mk-line);
  border-top-color: var(--mk-blue);
  border-radius: 50%;
  animation: cp-spin 0.8s linear infinite;
}
@keyframes cp-spin { to { transform: rotate(360deg); } }

/* ===== Sidebar ===== */
.cp-sidebar {
  display: grid;
  gap: 8px;
  align-content: start;
  position: sticky;
  top: 84px;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}
.cp-sidebar__section {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: var(--mk-surface);
  overflow: hidden;
}
.cp-sidebar__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-12_5);
  font-weight: 700;
  color: var(--mk-ink);
  cursor: pointer;
  transition: background 0.1s ease;
  text-align: left;
}
.cp-sidebar__toggle:hover { background: rgba(0,0,0,0.02); }
.cp-sidebar__toggle.is-open { border-bottom: 1px solid var(--mk-line); }
.cp-sidebar__toggle-icon { font-size: var(--mk-fs-11); color: var(--mk-faint); width: 14px; flex-shrink: 0; }
.cp-sidebar__toggle-hint { font-size: var(--mk-fs-11); color: var(--mk-faint); font-weight: 400; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
.cp-sidebar__body { padding: 10px 14px 14px; display: grid; gap: 8px; }

/* ----- Run in sidebar ----- */
.cp-run { display: grid; gap: 10px; }
.cp-run__actions { display: grid; gap: 6px; }
.cp-btn--block { width: 100%; justify-content: center; }
.cp-run__autopilot-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.1);
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-amber);
}
.cp-run__autopilot-alert-icon { font-size: var(--mk-fs-14); }
.cp-run__autopilot-result { font-size: var(--mk-fs-12); font-weight: 700; padding: 6px 10px; border-radius: 6px; background: #f8fafc; }
.cp-run__autopilot-result--ok { color: var(--mk-green, #15803d); }
.cp-run__autopilot-result--bad { color: var(--mk-red, #b91c1c); }
.cp-run__autopilot-result--muted { color: var(--mk-muted); }

/* 阶段进度指示 */
.cp-run__stages {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  background: #f8fafc;
  border-radius: 8px;
}
.cp-run__stage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--mk-fs-12);
}
.cp-run__stage-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cp-run__stage-dot--done { background: var(--mk-green); }
.cp-run__stage-dot--active { background: var(--mk-blue); }
.cp-run__stage-dot--pending { background: var(--mk-line); }
.cp-run__stage-label {
  font-weight: 700;
  color: var(--mk-ink);
  width: 40px;
  flex-shrink: 0;
}
.cp-run__stage-status {
  color: var(--mk-faint);
  font-size: var(--mk-fs-11);
  font-variant-numeric: tabular-nums;
}

.cp-run__foot {
  display: grid;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--mk-line);
}
.cp-run__budget { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: var(--mk-fs-12); color: var(--mk-muted); }
.cp-run__budget select { min-width: 90px; font-size: var(--mk-fs-12); }
.cp-run__readiness { font-size: var(--mk-fs-11); font-weight: 700; }
.cp-run__readiness--ok { color: var(--mk-green, #15803d); }
.cp-run__readiness--pending { color: var(--mk-amber, #b45309); }
.cp-run__readiness--bad { color: var(--mk-red, #b91c1c); }
.cp-autopilot__badge {
  font-size: var(--mk-fs-11); font-weight: 700; padding: 3px 8px; border-radius: 999px;
}
.cp-autopilot__badge--running { background: rgba(245, 158, 11, 0.14); color: var(--mk-amber, #b45309); }

/* ----- Logs in sidebar ----- */
.cp-logs {
  max-height: 360px;
  overflow-y: auto;
  display: grid;
  gap: 4px;
  position: relative;
}
.cp-logs__follow {
  position: sticky;
  top: 0;
  right: 0;
  z-index: 2;
  margin-left: auto;
  width: fit-content;
  font-size: var(--mk-fs-11); font-weight: 700; color: var(--mk-green); cursor: pointer;
  padding: 2px 6px; border-radius: 999px; background: rgba(16, 185, 129, 0.08);
}
.cp-logs__follow:hover { background: rgba(16, 185, 129, 0.15); }
.cp-logs__follow.is-paused { color: var(--mk-amber); background: rgba(217, 119, 6, 0.08); }
.cp-logs__filter { display: flex; gap: 4px; flex-wrap: wrap; padding-bottom: 6px; border-bottom: 1px solid var(--mk-line); margin-bottom: 4px; }
.cp-logs__filter-chip {
  padding: 2px 8px; border-radius: 999px; border: 1px solid var(--mk-line);
  background: var(--mk-surface); font: inherit; font-size: var(--mk-fs-11); font-weight: 600;
  color: var(--mk-muted); cursor: pointer; transition: all 0.12s ease;
}
.cp-logs__filter-chip:hover { border-color: var(--mk-blue); color: var(--mk-blue); }
.cp-logs__filter-chip.is-active { background: var(--mk-blue); border-color: var(--mk-blue); color: #fff; }

/* ----- Review in sidebar ----- */
.cp-review-panel__actions { display: flex; flex-wrap: wrap; gap: 5px; }

/* ===== Shared components ===== */
.cp-btn {
  padding: 7px 14px;
  border-radius: 7px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  cursor: pointer;
  transition: all 0.12s ease;
}
.cp-btn--sm { padding: 5px 10px; font-size: var(--mk-fs-11); border-radius: 6px; }
.cp-btn:hover:not(:disabled) { border-color: rgba(44, 99, 208, 0.4); color: var(--mk-blue); }
.cp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cp-btn--primary { background: var(--mk-blue); border-color: var(--mk-blue); color: #fff; }
.cp-btn--primary:hover:not(:disabled) { color: #fff; opacity: 0.9; }
.cp-danger-btn { background: var(--mk-red-strong, var(--mk-red)); border-color: var(--mk-red-strong, var(--mk-red)); color: #fff; }
.cp-danger-btn:hover:not(:disabled) { color: #fff; opacity: 0.9; }
.cp-turn-cap {
  width: 56px; padding: 5px 6px; border-radius: 6px; border: 1px solid var(--mk-line);
  background: var(--mk-surface); color: var(--mk-ink); font: inherit; font-size: var(--mk-fs-12);
}
.cp-turn-cap-label { display: inline-flex; align-items: center; gap: 5px; font-size: var(--mk-fs-11); color: var(--mk-faint); font-weight: 600; }
.cp-none { margin: 0; font-size: var(--mk-fs-12); color: var(--mk-faint); }

/* 主内容区空数据态（与右列阶段卡空态同一语言） */
.cp-empty-state {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 36px 20px;
  text-align: center;
}
.cp-empty-state__icon { font-size: 30px; line-height: 1; color: var(--mk-faint); }
.cp-empty-state strong { font-size: var(--mk-fs-13); font-weight: 800; color: var(--mk-ink); }
.cp-empty-state p { margin: 0; font-size: var(--mk-fs-12); line-height: 1.6; color: var(--mk-muted); max-width: 320px; }

/* Log line */
.cp-log { display: flex; align-items: baseline; gap: 6px; font-size: var(--mk-fs-11); flex-wrap: wrap; }
.cp-log--error { padding: 4px 8px; border-radius: 6px; background: var(--mk-red-bg); }
.cp-log__time { color: var(--mk-faint); font-family: var(--mk-mono); font-size: var(--mk-fs-11); white-space: nowrap; padding-top: 1px; }
.cp-log__phase {
  padding: 0 5px; border-radius: 99px; font-size: var(--mk-fs-11); font-weight: 700;
  background: #eef2ff; color: #4453a1; white-space: nowrap;
}
.cp-log__phase--error { background: var(--mk-red); color: #fff; }
.cp-log__text { color: var(--mk-muted); word-break: break-all; min-width: 0; flex: 1 1 auto; }
.cp-log--error .cp-log__text { color: var(--mk-red); font-weight: 600; }
.cp-log__dur { color: var(--mk-faint); font-family: var(--mk-mono); font-size: var(--mk-fs-11); white-space: nowrap; font-variant-numeric: tabular-nums; }
.cp-log__raw { font-size: var(--mk-fs-11); flex-basis: 100%; }
.cp-log__raw summary { cursor: pointer; color: var(--mk-faint); font-weight: 600; user-select: none; }
.cp-log__raw pre {
  margin: 4px 0 0; padding: 6px 8px; border-radius: 6px; background: var(--mk-code-bg);
  color: var(--mk-code-fg); font: 10px/1.5 var(--mk-mono); white-space: pre-wrap;
  word-break: break-all; max-height: 120px; overflow: auto;
}
.cp-log-skel { height: 11px; border-radius: 4px; background: linear-gradient(90deg, #eef2fa, #f7f9fc 55%, #eef2fa); background-size: 220% 100%; animation: cp-skel 1.4s ease infinite; }
@keyframes cp-skel { from { background-position: 120% 0; } to { background-position: -120% 0; } }
.cp-path-skel { display: grid; gap: 8px; }
.cp-path-skel > div { height: 40px; border-radius: 8px; background: linear-gradient(90deg, #eef2fa, #f7f9fc 55%, #eef2fa); background-size: 220% 100%; animation: cp-skel 1.4s ease infinite; }

/* Degrade */
.cp-degrade {
  margin: 0; display: flex; align-items: center; gap: 8px; font-size: var(--mk-fs-12);
  font-weight: 600; color: var(--mk-red); padding: 7px 10px; border-radius: 8px; background: var(--mk-red-bg);
}
.cp-degrade .mk-link { font-size: var(--mk-fs-12); }

/* Transcripts */
.cp-transcripts { display: grid; gap: 10px; padding: 12px 16px 16px; }
.cp-transcript {
  display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: 10px;
}
.cp-transcript summary { cursor: pointer; font-size: var(--mk-fs-12); font-weight: 800; color: var(--mk-muted); }
.cp-transcript__message {
  display: grid; gap: 3px; padding: 8px 10px; border-left: 3px solid #cbd5e1; border-radius: 5px; background: #f8fafc;
}
.cp-transcript__message.is-teacher { border-left-color: var(--mk-blue); background: #eff6ff; }
.cp-transcript__message.is-learner { border-left-color: var(--mk-teal); background: #f0fdfa; }
.cp-transcript__message span { font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-faint); }
.cp-transcript__message p { margin: 0; font-size: var(--mk-fs-12); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }

/* Path detail */
.cp-path-detail { display: grid; gap: 10px; padding: 12px 16px 16px; align-content: start; }
.cp-path-detail__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.cp-path-detail__head strong { font-size: 13.5px; }
.cp-path-detail__meta { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.cp-path-detail__summary { margin: 0; font-size: var(--mk-fs-12); color: var(--mk-muted); line-height: 1.6; }
.cp-milestone { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid var(--mk-line); border-radius: 8px; }
.cp-milestone__head { display: flex; align-items: baseline; gap: 8px; }
.cp-milestone__head strong { font-size: var(--mk-fs-12_5); }
.cp-milestone__order { font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-faint); font-family: var(--mk-mono); }
.cp-milestone__meta { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.cp-milestone__desc { margin: 0; font-size: var(--mk-fs-12); color: var(--mk-muted); line-height: 1.55; }
.cp-task-list { margin: 2px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.cp-task-list li { display: flex; gap: 6px; font-size: var(--mk-fs-12); color: var(--mk-muted); line-height: 1.5; }
.cp-task-list li.is-done { color: var(--mk-green); }
.cp-task-list li.is-current { color: var(--mk-blue); font-weight: 700; }
.cp-task-list__mark { flex: 0 0 auto; font-family: var(--mk-mono); }
.cp-task-list__num { font-size: var(--mk-fs-11); color: var(--mk-faint); font-weight: 600; flex-shrink: 0; }

/* Review */
.cp-review { display: grid; gap: 8px; padding: 8px 10px; border-radius: 8px; background: #f8fafc; }
.cp-review__badges { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.cp-review__badge { padding: 2px 8px; border-radius: 4px; font-size: var(--mk-fs-11); font-weight: 800; background: #f3f5f9; color: var(--mk-muted); }
.cp-review__badge[data-decision='accept'] { background: var(--mk-green-bg); color: var(--mk-green); }
.cp-review__badge[data-decision='modify'] { background: var(--mk-amber-bg); color: var(--mk-amber); }
.cp-review__badge[data-decision='reject'] { background: var(--mk-red-bg); color: var(--mk-red); }
.cp-review__meta { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.cp-review__reaction { margin: 0; font-size: var(--mk-fs-12); line-height: 1.6; white-space: pre-wrap; }
.cp-review__concern { margin: 0; font-size: var(--mk-fs-12); color: #b45309; }
.cp-review__changes { margin: 0; padding-left: 18px; display: grid; gap: 3px; font-size: var(--mk-fs-12); color: var(--mk-muted); }
.cp-review__replan { margin: 0; font-size: var(--mk-fs-11); color: var(--mk-blue); }

/* ===== Learn 双栏：课程树 + 对话 ===== */
.cp-learn-grid {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 0;
  min-height: 300px;
}
.cp-learn-tree {
  border-right: 1px solid var(--mk-line);
  padding: 6px 0;
  overflow-y: auto;
  max-height: 520px;
}
.cp-learn-tree__group {
  padding: 0;
}
.cp-learn-tree__group + .cp-learn-tree__group {
  border-top: 1px solid var(--mk-line);
}
.cp-learn-tree__ms {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px;
  font-size: var(--mk-fs-12);
  font-weight: 800;
  color: var(--mk-ink);
  background: #f8fafc;
  letter-spacing: 0.02em;
}
.cp-learn-tree__ms-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 6px;
}
.cp-learn-tree__ms-count {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: var(--mk-fs-11);
  color: var(--mk-muted);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: var(--mk-surface);
  padding: 1px 6px;
  border-radius: 999px;
}
.cp-learn-tree__lesson {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 12px 7px 24px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease, color 0.1s ease;
  border-left: 3px solid transparent;
}
.cp-learn-tree__lesson:hover:not(:disabled) { background: rgba(0,0,0,0.02); color: var(--mk-ink); }
.cp-learn-tree__lesson:disabled { opacity: 0.45; cursor: default; }
.cp-learn-tree__lesson.is-active { background: #eff6ff; color: var(--mk-blue); border-left-color: var(--mk-blue); font-weight: 700; }
.cp-learn-tree__lesson.is-done { color: var(--mk-green); }
.cp-learn-tree__lesson.is-active.is-done { color: var(--mk-blue); }
/* pending（未开始）也可点击：悬停时提示可从此课开始 */
.cp-learn-tree__lesson.is-pending:hover { background: #fff8e8; color: var(--mk-amber); }
.cp-learn-tree__mark { font-size: var(--mk-fs-11); width: 14px; text-align: center; flex-shrink: 0; }
.cp-learn-tree__lesson.is-done .cp-learn-tree__mark { color: var(--mk-green); }
.cp-learn-tree__lesson.is-active .cp-learn-tree__mark { color: var(--mk-blue); }
.cp-learn-tree__num { font-size: var(--mk-fs-11); color: var(--mk-faint); font-weight: 600; flex-shrink: 0; }
.cp-learn-tree__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-learn-chat {
  padding: 12px 16px 16px;
  overflow-y: auto;
  display: grid;
  gap: 10px;
  align-content: start;
}
@media (max-width: 900px) {
  .cp-learn-grid { grid-template-columns: 1fr; }
  .cp-learn-tree { border-right: none; border-bottom: 1px solid var(--mk-line); max-height: 200px; }
}

/* Lesson head */
.cp-lesson-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: 10px; background: #f8fafc;
  margin-bottom: 10px;
}

/* ===== 课时总结卡片 ===== */
.cp-lesson-wrapup {
  border: 1px solid rgba(21, 128, 61, 0.3);
  border-radius: 10px;
  background: linear-gradient(135deg, #f0fdf4 0%, #f8fafc 100%);
  overflow: hidden;
  margin-bottom: 10px;
}
.cp-lesson-wrapup__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: rgba(21, 128, 61, 0.06);
  border-bottom: 1px solid rgba(21, 128, 61, 0.12);
}
.cp-lesson-wrapup__badge {
  font-size: var(--mk-fs-13);
  font-weight: 800;
  color: var(--mk-green);
}
.cp-lesson-wrapup__scores {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.cp-lesson-wrapup__score {
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: var(--mk-muted);
  background: #fff;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--mk-line);
}
.cp-lesson-wrapup__score--primary {
  color: var(--mk-blue);
  border-color: rgba(44, 99, 208, 0.3);
  background: #eff6ff;
}
.cp-lesson-wrapup__body {
  padding: 12px 14px;
  display: grid;
  gap: 12px;
}
.cp-lesson-wrapup__section {
  display: grid;
  gap: 6px;
}
.cp-lesson-wrapup__section-title {
  font-size: var(--mk-fs-11);
  font-weight: 800;
  color: var(--mk-faint);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.cp-lesson-wrapup__text {
  margin: 0;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-ink);
  line-height: 1.7;
  white-space: pre-wrap;
}
.cp-lesson-wrapup__takeaways {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 3px;
}
.cp-lesson-wrapup__takeaways li {
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
  line-height: 1.5;
}

/* 知识点 */
.cp-lesson-wrapup__kp {
  display: grid;
  grid-template-columns: 1fr auto 80px;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.cp-lesson-wrapup__kp-name {
  font-size: var(--mk-fs-12);
  color: var(--mk-ink);
  font-weight: 600;
}
.cp-lesson-wrapup__kp-status {
  font-size: var(--mk-fs-11);
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}
.cp-lesson-wrapup__kp-status.is-mastered { background: var(--mk-green-bg); color: var(--mk-green); }
.cp-lesson-wrapup__kp-status.is-learning { background: #eff6ff; color: var(--mk-blue); }
.cp-lesson-wrapup__kp-status.is-review { background: var(--mk-amber-bg); color: var(--mk-amber); }
.cp-lesson-wrapup__kp-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--mk-line);
  overflow: hidden;
}
.cp-lesson-wrapup__kp-bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--mk-green);
  transition: width 0.3s ease;
}

/* 评估 */
.cp-lesson-wrapup__eval-item {
  display: grid;
  grid-template-columns: 50px 1fr;
  gap: 8px;
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
  line-height: 1.5;
  align-items: start;
}
.cp-lesson-wrapup__eval-label {
  font-size: var(--mk-fs-11);
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  text-align: center;
  height: fit-content;
}
.cp-lesson-wrapup__eval-label--good { background: var(--mk-green-bg); color: var(--mk-green); }
.cp-lesson-wrapup__eval-label--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
/* 优势/改进列表：每条一项，明确分段（替代原 span 碎片换行） */
.cp-lesson-wrapup__eval-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}
.cp-lesson-wrapup__eval-list li {
  padding-left: 14px;
  position: relative;
  line-height: 1.55;
}
.cp-lesson-wrapup__eval-list li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 7px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
}

/* 底部元信息 */
.cp-lesson-wrapup__meta-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
  padding-top: 4px;
  border-top: 1px solid var(--mk-line);
}
.cp-lesson-head__main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.cp-lesson-head__main strong { font-size: var(--mk-fs-13); }
.cp-lesson-head__ms { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.cp-lesson-head__state { padding: 2px 8px; border-radius: 4px; font-size: var(--mk-fs-11); font-weight: 800; background: #f3f5f9; color: var(--mk-muted); }
.cp-lesson-head__state[data-state='done'] { background: var(--mk-green-bg); color: var(--mk-green); }
.cp-lesson-head__state[data-state='active'] { background: #eff6ff; color: var(--mk-blue); }
.cp-lesson-head__state[data-state='failed'] { background: var(--mk-red-bg); color: var(--mk-red); }
.cp-lesson-head__nav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cp-lesson-head__select { max-width: 240px; border: 1px solid var(--mk-line); border-radius: 6px; background: var(--mk-surface); color: var(--mk-muted); padding: 4px 6px; font: inherit; font-size: var(--mk-fs-11); }
.cp-teaching-history { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-history-btn {
  border: 1px solid var(--mk-line); border-radius: 6px; background: var(--mk-surface); color: var(--mk-muted);
  padding: 4px 7px; font: inherit; font-size: var(--mk-fs-11); cursor: pointer;
}
.cp-history-btn:hover, .cp-history-btn.is-current { border-color: var(--mk-blue); color: var(--mk-blue); background: #eff6ff; }

/* ===== Wrapup 学习报告 ===== */
.cp-wrapup-lessons {
  display: grid;
  gap: 0;
  border-bottom: 1px solid var(--mk-line);
}
.cp-wrapup-ms {
  padding: 0;
}
.cp-wrapup-ms + .cp-wrapup-ms {
  border-top: 1px solid var(--mk-line);
}
.cp-wrapup-ms__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px 6px;
  font-size: var(--mk-fs-12);
  font-weight: 800;
  color: var(--mk-ink);
  background: #f8fafc;
}
.cp-wrapup-ms__count {
  font-size: var(--mk-fs-11);
  color: var(--mk-muted);
  font-weight: 600;
  background: var(--mk-surface);
  padding: 1px 6px;
  border-radius: 999px;
}
.cp-wrapup-lesson {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px 8px 32px;
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
  cursor: default;
  border-left: 3px solid transparent;
  transition: background 0.1s ease;
}
.cp-wrapup-lesson.is-done {
  color: var(--mk-green);
  cursor: pointer;
}
.cp-wrapup-lesson.is-done:hover {
  background: #f0fdf4;
}
.cp-wrapup-lesson.is-active {
  color: var(--mk-blue);
  font-weight: 700;
  background: #eff6ff;
  border-left-color: var(--mk-blue);
}
.cp-wrapup-lesson__mark {
  font-size: var(--mk-fs-11);
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}
.cp-wrapup-lesson__num {
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
  font-weight: 600;
  flex-shrink: 0;
}
.cp-wrapup-lesson__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-wrapup-lesson__action {
  font-size: var(--mk-fs-11);
  color: var(--mk-blue);
  font-weight: 600;
  flex-shrink: 0;
}
.cp-wrapup-stats {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 16px 20px;
  background: linear-gradient(135deg, #f0f5ff 0%, #f8fafc 100%);
  border-bottom: 1px solid var(--mk-line);
}
.cp-wrapup-stats__goal { display: grid; gap: 4px; min-width: 0; flex: 1 1 300px; }
.cp-wrapup-stats__label { font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em; text-transform: uppercase; }
.cp-wrapup-stats__goal strong { font-size: var(--mk-fs-14); color: var(--mk-ink); line-height: 1.4; }
.cp-wrapup-stats__badges { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cp-wrapup-stats__item { display: inline-flex; align-items: baseline; gap: 4px; font-size: var(--mk-fs-12); color: var(--mk-muted); }
.cp-wrapup-stats__item em { font-style: normal; font-weight: 800; font-size: var(--mk-fs-16); color: var(--mk-blue); font-variant-numeric: tabular-nums; }

.cp-wrapup-cards {
  display: grid;
  gap: 10px;
  padding: 16px 20px;
}
.cp-wrapup-card {
  display: flex;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: #fbfcfe;
  transition: border-color 0.12s ease;
}
.cp-wrapup-card:hover { border-color: rgba(44, 99, 208, 0.25); }
.cp-wrapup-card__icon {
  font-size: var(--mk-fs-20);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #eef2ff;
  flex-shrink: 0;
}
.cp-wrapup-card__body { display: grid; gap: 4px; min-width: 0; }
.cp-wrapup-card__label { font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em; text-transform: uppercase; }
.cp-wrapup-card__text { margin: 0; font-size: var(--mk-fs-12_5); color: var(--mk-ink); line-height: 1.7; white-space: pre-wrap; word-break: break-word; }

.cp-wrapup-sections {
  display: grid;
  gap: 10px;
  padding: 0 20px 16px;
}
.cp-wrapup-section {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: 9px;
  background: #fafbfc;
}
.cp-wrapup-section__label { font-size: var(--mk-fs-11); font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em; }
.cp-wrapup-section__text { margin: 0; font-size: var(--mk-fs-12_5); line-height: 1.7; white-space: pre-wrap; color: var(--mk-ink); }
.cp-wrapup__json { margin: 0; font-size: var(--mk-fs-11); line-height: 1.6; white-space: pre-wrap; word-break: break-word; font-family: var(--mk-mono); color: var(--mk-muted); max-height: 240px; overflow: auto; }

.cp-wrapup-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px 16px;
  border-top: 1px solid var(--mk-line);
  margin: 0 20px;
}
.cp-wrapup-footer .mk-badge { margin: 0; }

/* Raw data */
.cp-raw { font-size: var(--mk-fs-12); color: var(--mk-faint); }
.cp-raw summary { cursor: pointer; padding: 4px 2px; }
.cp-raw pre {
  margin: 8px 0 0; padding: 12px; border-radius: 10px; background: var(--mk-code-bg); color: var(--mk-code-fg);
  font: 10.5px/1.6 var(--mk-mono); max-height: 300px; overflow: auto; white-space: pre-wrap; word-break: break-all;
}

/* ===== 终局评估 ===== */
.cp-eval-group { display: grid; gap: 10px; padding: 14px 16px 4px; }
.cp-eval-group + .cp-eval-group { border-top: 1px solid var(--mk-line); }
.cp-eval-group__title { margin: 0; font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-muted); letter-spacing: 0.04em; }
.cp-eval { border: 1px solid var(--mk-line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 10px; margin-bottom: 8px; }
.cp-eval__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.cp-eval__head strong { font-size: var(--mk-fs-13); }
.cp-eval__time { display: block; font-size: var(--mk-fs-11); color: var(--mk-faint); margin-top: 2px; }
.cp-eval__overall { display: grid; gap: 4px; justify-items: end; }
.cp-eval__overall-bar { width: 110px; }
.cp-eval__scores { display: flex; flex-wrap: wrap; gap: 8px; }
.cp-eval__score { display: grid; gap: 3px; min-width: 104px; padding: 6px 9px; border-radius: 6px; background: #f6f8fb; font-size: var(--mk-fs-11); }
.cp-eval__score code { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.cp-eval__score strong { font-variant-numeric: tabular-nums; color: var(--mk-ink); font-size: var(--mk-fs-12); }
.cp-eval__section { display: grid; gap: 6px; }
.cp-eval__section h5 { margin: 0; font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-muted); }
.cp-finding { display: grid; grid-template-columns: auto 1fr; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--mk-line); }
.cp-finding:last-child { border-bottom: none; }
.cp-finding strong { font-size: var(--mk-fs-12_5); }
.cp-finding p { margin: 4px 0 0; font-size: var(--mk-fs-12); color: var(--mk-muted); line-height: 1.6; }
.cp-finding__sev { padding: 1px 6px; border-radius: 4px; font-size: var(--mk-fs-11); font-weight: 700; height: fit-content; background: #f3f5f9; color: var(--mk-muted); }
.cp-finding__sev[data-sev='critical'] { background: var(--mk-red-bg); color: var(--mk-red); }
.cp-finding__sev[data-sev='major'] { background: var(--mk-amber-bg); color: var(--mk-amber); }
.cp-finding__sev[data-sev='minor'] { background: #e6f4ff; color: #0958d9; }
.cp-finding__sev[data-sev='info'] { background: #f0fff5; color: #389e0d; }
.cp-evidence { margin-top: 6px; font-size: var(--mk-fs-12); }
.cp-evidence summary { cursor: pointer; color: var(--mk-faint); font-weight: 600; }
.cp-evidence > div { padding: 4px 8px; border-left: 2px solid var(--mk-line); margin: 6px 0; }
.cp-evidence code { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.cp-evidence p { margin: 2px 0 0; font-size: var(--mk-fs-12); color: var(--mk-muted); }
.cp-rec { padding: 6px 0; border-bottom: 1px dashed var(--mk-line); }
.cp-rec:last-child { border-bottom: none; }
.cp-rec__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cp-rec strong { font-size: var(--mk-fs-12); }
.cp-rec__codes { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.cp-rec__codes code { font-size: var(--mk-fs-11); padding: 1px 5px; background: #f3f5f9; color: var(--mk-faint); border-radius: 4px; }
.cp-rec p { margin: 4px 0 0; font-size: var(--mk-fs-12_5); color: var(--mk-muted); }
.cp-rec__rationale { margin-top: 6px; font-size: var(--mk-fs-12); color: var(--mk-faint); }
.cp-rec__rationale summary { cursor: pointer; font-weight: 600; }
.cp-rec__rationale p { margin: 6px 0 0; }

/* ===== Trace panels ===== */
.cp-trace-panel {
  border: 1px solid var(--mk-line); border-radius: 8px; background: #f8fafc;
}
.cp-trace-panel > summary {
  list-style: none; cursor: pointer; padding: 8px 12px; display: flex; align-items: center;
  justify-content: space-between; gap: 8px; font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-ink); user-select: none;
}
.cp-trace-panel > summary::-webkit-details-marker { display: none; }
.cp-trace-panel > summary::before { content: '▸'; font-size: var(--mk-fs-11); color: var(--mk-faint); margin-right: 4px; }
.cp-trace-panel[open] > summary::before { content: '▾'; }
.cp-trace-panel > summary code { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.cp-trace-list { list-style: none; margin: 0; padding: 0 12px 12px; max-height: 360px; overflow-y: auto; display: grid; gap: 6px; }
.cp-trace-list > li { padding: 7px 10px; border: 1px solid var(--mk-line); border-radius: 6px; background: #fff; display: grid; gap: 4px; }
.cp-trace-list__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--mk-fs-11); }
.cp-trace-list__seq { font-variant-numeric: tabular-nums; color: var(--mk-faint); font-weight: 700; }
.cp-trace-list__head time { color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.cp-trace-list__id { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.cp-trace-list__stage { padding: 1px 6px; border-radius: 999px; font-size: var(--mk-fs-11); font-weight: 700; background: #eef2ff; color: #4453a1; }
.cp-trace-list__stage[data-stage='learning'] { background: #ecfdf5; color: #0a8551; }
.cp-trace-list__emotion, .cp-trace-list__transition { padding: 1px 5px; border-radius: 4px; font-size: var(--mk-fs-11); background: #f3f5f9; color: var(--mk-muted); }
.cp-trace-list__degraded { padding: 1px 5px; border-radius: 4px; font-size: var(--mk-fs-11); background: var(--mk-red-bg); color: var(--mk-red); }
.cp-trace-list__focus, .cp-trace-list__reason { font-size: var(--mk-fs-11); color: var(--mk-muted); }
.cp-trace-list__signal { font-size: var(--mk-fs-11); color: var(--mk-faint); font-style: italic; }
.cp-trace-list__metrics { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-trace-list__metrics > span { display: inline-flex; align-items: baseline; gap: 3px; padding: 2px 5px; background: #f6f8fb; border-radius: 4px; font-size: var(--mk-fs-11); }
.cp-trace-list__metrics code { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.cp-trace-list__metrics strong { font-variant-numeric: tabular-nums; color: var(--mk-ink); }
.cp-trace-list__kv { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-trace-list__kv > span { display: inline-flex; align-items: baseline; gap: 4px; padding: 2px 6px; border-radius: 4px; background: #f6f8fb; font-size: var(--mk-fs-11); max-width: 100%; }
.cp-trace-list__kv code { flex: 0 0 auto; color: var(--mk-faint); }
.cp-trace-list__kv strong { color: var(--mk-ink); font-weight: 600; word-break: break-all; }
.cp-trace-list__raw { font-size: var(--mk-fs-11); }
.cp-trace-list__raw summary { cursor: pointer; color: var(--mk-faint); font-weight: 600; user-select: none; }
.cp-trace-list__raw .cp-trace-list__body { margin-top: 4px; }
.cp-trace-list__flags { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-trace-list__flags > span { padding: 2px 5px; border-radius: 4px; font-size: var(--mk-fs-11); background: #f3f5f9; color: var(--mk-faint); border: 1px solid transparent; }
.cp-trace-list__flags > span.active { background: #e6f4ff; color: #0958d9; border-color: #91caff; }
.cp-trace-list__blockers { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: var(--mk-fs-11); color: var(--mk-muted); }
.cp-trace-list__blocker { padding: 1px 5px; background: var(--mk-amber-bg); color: var(--mk-amber); border-radius: 4px; }
.cp-trace-list__body { margin: 4px 0 0; padding: 6px 8px; background: #f8fafc; border-radius: 4px; font-size: var(--mk-fs-11); line-height: 1.5; color: var(--mk-muted); white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow-y: auto; }

/* Timeline */
.cp-timeline__kind {
  padding: 1px 6px; border-radius: 999px; font-size: var(--mk-fs-11); font-weight: 700; background: #f1f5f9; color: var(--mk-muted); white-space: nowrap;
}
.cp-timeline__kind[data-kind='referee'] { background: #fef2f2; color: #b91c1c; }
.cp-timeline__kind[data-kind='private'] { background: #f5f3ff; color: #6d28d9; }
.cp-timeline__kind[data-kind='log'] { background: #eef2ff; color: #4453a1; }
.cp-timeline__kind[data-kind='goal'] { background: #faf5ff; color: #7c3aed; }
.cp-timeline__kind[data-kind='path'] { background: #fff7ed; color: #c2410c; }
.cp-timeline__kind[data-kind='teaching'] { background: #ecfdf5; color: #0a8551; }
.cp-timeline__kind[data-kind='evidence'] { background: #ecfeff; color: #0e7490; }
.cp-timeline__stage { padding: 1px 6px; border-radius: 999px; font-size: var(--mk-fs-11); font-weight: 700; background: #eef2ff; color: #4453a1; white-space: nowrap; }
.cp-timeline__stage[data-stage='learning'], .cp-timeline__stage[data-stage='teaching'] { background: #ecfdf5; color: #0a8551; }
.cp-timeline__stage[data-stage='goal'] { background: #faf5ff; color: #7c3aed; }
.cp-timeline__stage[data-stage='path'] { background: #fff7ed; color: #c2410c; }
.cp-timeline__title { color: var(--mk-ink); font-weight: 600; word-break: break-word; }
.cp-timeline__detail { margin: 0; font-size: var(--mk-fs-11); color: var(--mk-muted); line-height: 1.6; word-break: break-word; }

/* ===== Responsive ===== */
@media (max-width: 1100px) {
  .cp-body { grid-template-columns: 1fr; }
  .cp-sidebar { position: static; max-height: none; }
}
@media (min-width: 2000px) {
  .cp-body { grid-template-columns: minmax(0, 1fr) 380px; }
  .cp-title { font-size: 18px; }
  .cp-title__id { font-size: 13px; }
  .cp-back { font-size: 14px; }
  .cp-topbar__btn { font-size: 13px; }
  .cp-topbar__status { font-size: 15px; }
  .cp-stage { font-size: 15px; }
  .cp-stage__label { font-size: 15px; }
  .cp-stage__progress { font-size: 12px; }
  .cp-btn { font-size: 14px; padding: 9px 16px; }
  .cp-btn--sm { font-size: 12.5px; padding: 6px 12px; }
  .cp-none { font-size: 14px; }
  .cp-sidebar__toggle { font-size: 14px; }
  .cp-eval-card__label { font-size: 12px; }
  .cp-eval-card__value { font-size: 14px; }
  .cp-timeline__kind { font-size: 12px; }
  .cp-timeline__stage { font-size: 12px; }
  .cp-timeline__title { font-size: 13.5px; }
  .cp-timeline__detail { font-size: 12.5px; }
  .cp-log { font-size: 13px; }
  .cp-log__time { font-size: 11.5px; }
  .cp-log__phase { font-size: 11.5px; }
  .cp-log__dur { font-size: 11.5px; }
  .cp-transcript summary { font-size: 13.5px; }
  .cp-transcript__message span { font-size: 12px; }
  .cp-transcript__message p { font-size: 13.5px; }
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
  .cp-wrapup-card__label { font-size: 12.5px; }
  .cp-wrapup-card__text { font-size: 14px; }
  .cp-wrapup-section__label { font-size: 12.5px; }
  .cp-wrapup-section__text { font-size: 14px; }
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
  .cp-trace-panel > summary { font-size: 13px; }
  .cp-trace-panel > summary code { font-size: 12px; }
  .cp-trace-list__head { font-size: 12.5px; }
  .cp-trace-list__id { font-size: 11.5px; }
  .cp-trace-list__stage { font-size: 11.5px; }
  .cp-trace-list__emotion, .cp-trace-list__transition { font-size: 11.5px; }
  .cp-trace-list__degraded { font-size: 11.5px; }
  .cp-trace-list__focus, .cp-trace-list__reason { font-size: 12.5px; }
  .cp-trace-list__signal { font-size: 12.5px; }
  .cp-trace-list__metrics > span { font-size: 11.5px; }
  .cp-trace-list__metrics code { font-size: 11.5px; }
  .cp-trace-list__flags > span { font-size: 11.5px; }
  .cp-trace-list__blockers { font-size: 12.5px; }
  .cp-trace-list__body { font-size: 11.5px; }
}
@media (min-width: 2800px) {
  .cp-body { grid-template-columns: minmax(0, 1fr) 440px; }
  .cp-title { font-size: 21px; }
  .cp-title__id { font-size: 15.5px; }
  .cp-back { font-size: 16.5px; }
  .cp-topbar__btn { font-size: 15.5px; }
  .cp-topbar__status { font-size: 17.5px; }
  .cp-stage { font-size: 17.5px; }
  .cp-stage__label { font-size: 17.5px; }
  .cp-stage__progress { font-size: 14px; }
  .cp-btn { font-size: 16.5px; padding: 11px 20px; }
  .cp-btn--sm { font-size: 14.5px; padding: 7px 14px; }
  .cp-none { font-size: 16.5px; }
  .cp-sidebar__toggle { font-size: 16.5px; }
  .cp-eval-card__label { font-size: 14px; }
  .cp-eval-card__value { font-size: 16.5px; }
  .cp-timeline__kind { font-size: 14px; }
  .cp-timeline__stage { font-size: 14px; }
  .cp-timeline__title { font-size: 16px; }
  .cp-timeline__detail { font-size: 14.5px; }
  .cp-log { font-size: 15.5px; }
  .cp-log__time { font-size: 13.5px; }
  .cp-log__phase { font-size: 13.5px; }
  .cp-log__dur { font-size: 13.5px; }
  .cp-transcript summary { font-size: 16px; }
  .cp-transcript__message span { font-size: 14px; }
  .cp-transcript__message p { font-size: 16px; }
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
  .cp-wrapup-card__label { font-size: 14.5px; }
  .cp-wrapup-card__text { font-size: 16.5px; }
  .cp-wrapup-section__label { font-size: 14.5px; }
  .cp-wrapup-section__text { font-size: 16.5px; }
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
  .cp-trace-panel > summary { font-size: 15.5px; }
  .cp-trace-panel > summary code { font-size: 14px; }
  .cp-trace-list__head { font-size: 14.5px; }
  .cp-trace-list__id { font-size: 13.5px; }
  .cp-trace-list__stage { font-size: 13.5px; }
  .cp-trace-list__emotion, .cp-trace-list__transition { font-size: 13.5px; }
  .cp-trace-list__degraded { font-size: 13.5px; }
  .cp-trace-list__focus, .cp-trace-list__reason { font-size: 14.5px; }
  .cp-trace-list__signal { font-size: 14.5px; }
  .cp-trace-list__metrics > span { font-size: 13.5px; }
  .cp-trace-list__metrics code { font-size: 13.5px; }
  .cp-trace-list__flags > span { font-size: 13.5px; }
  .cp-trace-list__blockers { font-size: 14.5px; }
  .cp-trace-list__body { font-size: 13.5px; }
}

/* ================= 暗色模式（D1 补完）：会话座舱 ================= */
html[data-theme='dark'] {
  .cp-budget__track { background: #232f45; }
  .cp-back:hover { background: #1f2b40; }
  .cp-stage:hover:not(:disabled) { background: #1f2b40; }
  .cp-stage--active { background: rgba(91, 141, 239, 0.16); color: #7aa2ff; border-color: rgba(91, 141, 239, 0.4); }
  .cp-run__autopilot-result { background: #141c2b; }
  .cp-kv, .cp-kv--wrap, .cp-flag, .cp-budget { background: #141c2b; }
  .cp-transcript__message { background: #141c2b; border-left-color: #2a3850; }
  .cp-transcript__message.is-teacher { background: rgba(91, 141, 239, 0.12); border-left-color: var(--mk-blue); }
  .cp-transcript__message.is-learner { background: rgba(45, 212, 191, 0.1); border-left-color: var(--mk-teal); }
  .cp-review { background: #141c2b; }
  .cp-review__badge, .cp-lesson-head__state { background: #253049; }
  .cp-lesson-head__state[data-state='active'] { background: rgba(91, 141, 239, 0.18); color: #7aa2ff; }
  .cp-learn-tree__lesson.is-active { background: rgba(91, 141, 239, 0.16); color: #7aa2ff; border-left-color: var(--mk-blue); }
  .cp-learn-tree__lesson.is-pending:hover { background: rgba(251, 191, 36, 0.12); color: #fcd34d; }
  .cp-lesson-wrapup__kp-status.is-learning { background: rgba(91, 141, 239, 0.16); color: #7aa2ff; }
  .cp-history-btn:hover, .cp-history-btn.is-current { background: rgba(91, 141, 239, 0.16); color: #7aa2ff; }
  .cp-lesson-wrapup__ok { background: rgba(74, 222, 128, 0.12); }
  .cp-wrapup-badge { background: rgba(91, 141, 239, 0.16); color: #7aa2ff; }
  .cp-timeline__row { background: #141c2b; }
  .cp-verdict { background: #141c2b; }
  .cp-log__phase { background: rgba(91, 141, 239, 0.16); color: #93b4f5; }
  /* 补漏：wrapup 分数/卡片/小节/trace 面板/时间线标签 */
  .cp-lesson-wrapup__score { background: #1d2739; color: #9fb0c8; }
  .cp-lesson-wrapup__score--primary { background: rgba(91, 141, 239, 0.16); color: #9db8f5; }
  .cp-wrapup-card,
  .cp-wrapup-section,
  .cp-trace-panel { background: #141c2b; border-color: #232f45; }
  .cp-trace-list__body { background: #1b2537; }
  .cp-run__stages { background: #141c2b; }
  .cp-wrapup-lesson.is-active { background: rgba(91, 141, 239, 0.16); color: #9db8f5; }
  .cp-wrapup-lesson.is-done:hover { background: rgba(74, 222, 128, 0.1); }
  .cp-timeline__kind[data-kind='referee'] { background: rgba(248, 113, 113, 0.14); color: #fca5a5; }
  .cp-timeline__kind[data-kind='private'] { background: rgba(167, 139, 250, 0.16); color: #c4b5fd; }
  .cp-timeline__kind[data-kind='log'] { background: rgba(129, 140, 248, 0.14); color: #a5b4fc; }
  .cp-timeline__kind[data-kind='goal'] { background: rgba(167, 139, 250, 0.16); color: #c4b5fd; }
  .cp-timeline__kind[data-kind='path'] { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
  .cp-timeline__kind[data-kind='teaching'] { background: rgba(74, 222, 128, 0.14); color: #6ee7a0; }
  .cp-timeline__kind[data-kind='evidence'] { background: rgba(45, 212, 191, 0.14); color: #5eead4; }
  .cp-timeline__stage[data-stage='goal'] { background: rgba(167, 139, 250, 0.16); color: #c4b5fd; }
  .cp-timeline__stage[data-stage='path'] { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
}
</style>
