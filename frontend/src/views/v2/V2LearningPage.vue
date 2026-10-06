<template>
  <div class="learn v2-page">
    <!-- 沉浸式头部 -->
    <header class="learn__head">
      <button type="button" class="learn__back" @click="goBack">‹ 返回路径详情</button>
      <div class="learn__title">
        <strong>{{ taskTitle || '学习会话' }}</strong>
        <small>{{ pathName }}</small>
      </div>
      <div class="learn__head-right">
        <!-- 知识点入口：原型单列无侧栏 → 常驻左栏降级为浮层抽屉的开关（功能不删） -->
        <button
          v-if="knowledgePoints.length"
          type="button"
          class="learn__kpbtn"
          :aria-expanded="kpOpen"
          aria-controls="learn-kp-panel"
          @click="toggleKp"
        >知识点 <b>{{ masteredCount }}/{{ knowledgePoints.length }}</b></button>
        <span class="learn__live" :class="{ 'learn__live--err': !!initError }">{{ liveState }}</span>
        <ImmersiveMenu>
          <div class="learn__menu-group">
              <span class="learn__menu-label">结束本节课</span>
              <button type="button" class="learn__menu-item learn__menu-item--primary" @click="completeAndSettle">
                <span class="learn__menu-item-main"><strong>完成并结算任务</strong><small>{{ finishHint }}</small></span>
              </button>
              <button type="button" class="learn__menu-item" @click="endSession">
                <span class="learn__menu-item-main"><strong>结束学习（不计入完成）</strong><small>生成本次总结，不推进任务进度</small></span>
              </button>
            </div>
            <div class="learn__menu-sep"></div>
            <div class="learn__menu-group">
              <span class="learn__menu-label">暂离或重学</span>
              <!-- 纯返回：移动端「‹ 返回」按钮被收起后，菜单里原本每个离开项都带副作用
                   （暂停/结束/完成），没有「只是回去看看」的出口（2026-09-25 移动框架审查 A2） -->
              <button type="button" class="learn__menu-item" @click="leaveWithoutSideEffect">
                <span class="learn__menu-item-main"><strong>返回路径详情</strong><small>不结束会话，进度原样保留</small></span>
              </button>
              <button type="button" class="learn__menu-item" @click="pauseAndLeave">
                <span class="learn__menu-item-main"><strong>暂停并离开</strong><small>进度保留，下次从这继续</small></span>
              </button>
              <button type="button" class="learn__menu-item learn__menu-item--danger" @click="restart">
                <span class="learn__menu-item-main"><strong>重新开始</strong><small>清空当前进度与消息</small></span>
              </button>
            </div>
        </ImmersiveMenu>
      </div>
    </header>

    <!-- 初始化中 / 初始化失败 / 正文：三态直接切换，**刻意不套 Vue Transition**。
         原因：Transition 的进入/离开动画靠 requestAnimationFrame 推进，rAF 被节流或不触发时
         （嵌入 webview、长时间后台标签、无合成器的渲染环境）离开动画永不收尾，而 mode="out-in"
         要求旧分支走完才挂新分支 —— 结果是正文永不挂载，页面永久停在「正在准备本节内容…」。
         改用 CSS 关键帧做淡入（见 .learn__stage/.learn__body 的 animation）：CSS 动画即使不执行，
         元素也停在默认的可见状态，不会把关键内容藏起来。 -->
    <div v-if="initing" class="learn__stage">
      <div class="stage-card">
        <span class="spinner"></span>
        <h2>正在准备本节内容…</h2>
        <p>问流正在为「{{ taskTitle || '当前任务' }}」组织讲解和练习，一般几秒到十几秒。</p>
        <div class="stage-card__skeleton"><i style="width: 82%"></i><i style="width: 64%"></i><i style="width: 74%"></i></div>
        <!-- 返回常驻（移动端头部返回键被隐藏）；长时间无响应再亮出重试，页面不无出口 -->
        <div class="stage-card__actions">
          <button v-if="initStuck" type="button" class="btn-primary" @click="boot">重新尝试</button>
          <button type="button" class="btn-ghost" @click="goBack">‹ 返回路径详情</button>
        </div>
      </div>
    </div>

    <!-- 初始化失败 -->
    <div v-else-if="initError" class="learn__stage">
      <div class="stage-card">
        <span class="stage-card__warn">!</span>
        <h2>本节暂时开不了课</h2>
        <p>{{ friendlyError }}</p>
        <div class="stage-card__actions">
          <button type="button" class="btn-primary" @click="boot">重新尝试</button>
          <button type="button" class="btn-ghost" @click="goBack">返回路径详情</button>
          <router-link to="/learning-paths" class="btn-ghost">查看路径列表</router-link>
        </div>
      </div>
    </div>

    <div v-else class="learn__body">
      <!-- 知识点抽屉（原型单列无侧栏 → 由头部「知识点 N/M」入口开合的浮层；功能全保留） -->
      <div v-if="knowledgePoints.length && kpOpen" class="kp-scrim" @click="closeKp"></div>
      <aside v-if="knowledgePoints.length" id="learn-kp-panel" class="kp" :class="{ 'kp--open': kpOpen }">
        <button type="button" class="kp__head" :aria-expanded="kpOpen" @click="toggleKp">
          <span class="kp__head-main">
            <svg class="kp__ring" viewBox="0 0 20 20" aria-hidden="true">
              <circle class="kp__ring-track" cx="10" cy="10" r="8" />
              <circle class="kp__ring-val" :class="{ 'kp__ring-val--none': !masteredCount }" cx="10" cy="10" r="8" :stroke-dasharray="kpRingDash" />
            </svg>
            <strong>本节知识点</strong>
          </span>
          <span class="kp__head-meta">
            <span
              class="kp__chip kp__chip--mastered"
              :class="{ 'kp__chip--empty': !masteredCount, 'kp__chip--none': !knowledgePoints.length }"
            >{{ masteredCount }}/{{ knowledgePoints.length }} 已掌握</span>
            <span class="kp__caret" aria-hidden="true">{{ kpOpen ? '▾' : '▸' }}</span>
          </span>
        </button>
        <div class="kp__body">
          <div class="kp__bar"><i :style="{ width: weightedProgressPct + '%' }"></i></div>
          <!-- 视图切换：列表（默认）/ 图谱。图谱按需加载——只在切过去时才发请求 -->
          <div class="kp__views" role="tablist" aria-label="知识点视图">
            <button
              type="button" role="tab" class="kp__view"
              :class="{ 'kp__view--on': kpView === 'list' }"
              :aria-selected="kpView === 'list'"
              @click="kpView = 'list'"
            >列表</button>
            <button
              type="button" role="tab" class="kp__view"
              :class="{ 'kp__view--on': kpView === 'graph' }"
              :aria-selected="kpView === 'graph'"
              @click="switchKpToGraph"
            >图谱</button>
          </div>
          <template v-if="kpView === 'graph'">
            <p v-if="graphError" class="kp__hint kp__hint--err">{{ graphError }}</p>
            <MkLoading v-else-if="graphLoading" inline />
            <p v-else-if="!graphNodes.length" class="kp__hint">这条路径还没有概念图数据——路径生成完成后会出现在这里。</p>
            <MkGraph
              v-else
              :nodes="graphNodes"
              :edges="graphEdges"
              :theme="kpGraphTheme"
              height="320px"
              @select="kpSelected = $event"
            />
            <p v-if="graphMeta" class="kp__hint">
              {{ graphMeta.nodeCount }} 个概念 · {{ graphMeta.edgeCount }} 条关系
              <router-link to="/knowledge-map" class="kp__more">全部路径 →</router-link>
            </p>
            <p v-if="kpSelected" class="kp__hint">
              选中：{{ kpSelected.label }} ·
              {{ kpSelected.masteryScore === null || kpSelected.masteryScore === undefined ? '未评估' : Math.round(kpSelected.masteryScore * 100) + '%' }}
            </p>
          </template>
          <ol v-else class="kp__list">
            <li v-for="(kp, i) in knowledgePoints" :key="kp.id || i" class="kp__item" :class="kpCls(kp)">
              <span class="kp__mark">
                <svg v-if="isMastered(kp)" viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                <i v-else></i>
              </span>
              <div class="kp__name">
                <strong>{{ kp.name || kp.title }}</strong>
                <small>{{ kpStatusText(kp) }}</small>
              </div>
            </li>
          </ol>
        </div>
      </aside>

      <!-- 通栏进度卡（原型 .wf-learn__progress：知识点 + 8px 进度条，位于对话区上方） -->
      <div v-if="knowledgePoints.length" class="lessonbar">
        <div class="lessonbar__head"><span>本节课知识点</span><strong>{{ masteredCount }} / {{ knowledgePoints.length }} 已掌握</strong></div>
        <div class="lessonbar__track"><i :style="{ width: weightedProgressPct + '%' }"></i></div>
      </div>

      <!-- 中：导师对话 -->
      <section class="tutor">
        <!-- 恢复进度横幅：续上历史时可见，明确「已恢复到上次进度」并提供重新开始出口 -->
        <div v-if="resumedNotice" class="tutor__resume">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z"/></svg>
          <span class="tutor__resume-text">已恢复上次学习进度，接着继续</span>
          <button type="button" class="tutor__resume-restart" @click="restart">重新开始</button>
          <button type="button" class="tutor__resume-close" aria-label="关闭提示" @click="resumedNotice = false">
            <svg viewBox="0 0 24 24" width="10" height="10"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <!-- 开场景卡片：resumed / 接续 / 重学 / 复习 的结构化开场（取代模板双气泡的空转重复） -->
        <div v-if="openingScene && !openingSceneDone" class="oscene" :class="`oscene--${openingScene.kind || 'first'}`">
          <div class="oscene__tag">{{ sceneTag }}</div>
          <h3 class="oscene__title">{{ openingScene.title || sceneDefaultTitle }}</h3>
          <p v-if="sceneLead" class="oscene__lead">{{ sceneLead }}</p>
          <div v-if="openingScene.recap?.summary" class="oscene__summary">{{ openingScene.recap.summary }}</div>
          <div v-if="sceneUnresolved.length" class="oscene__chips">
            <span class="oscene__chip-label">上次还没完全掌握</span>
            <span v-for="(u, ui) in sceneUnresolved" :key="ui" class="oscene__chip">{{ u }}</span>
          </div>
          <div v-if="sceneMasteryWarn.length" class="oscene__warn">
            <span>前序基础提醒：</span>{{ sceneMasteryWarn }}
          </div>
          <div class="oscene__actions">
            <button type="button" class="btn-primary" :disabled="typing || actionBusy" @click="startFromScene">
              <span v-if="typing" class="spinner spinner--sm"></span>
              {{ scenePrimaryText }}
            </button>
            <button
              v-if="openingScene.kind === 'resume'"
              type="button"
              class="btn-ghost"
              :disabled="typing || actionBusy"
              @click="restart"
            >重新开始</button>
            <button type="button" class="btn-ghost" :disabled="typing || actionBusy" @click="openingSceneDone = true">先看看</button>
          </div>
        </div>

        <div ref="scrollEl" class="tutor__scroll" @scroll="updateNearBottom">
          <!-- 消息空态（批20）：跳过开场（「先看看」）或会话被清空时不再是纯白滚动区 -->
          <div v-if="!msgs.length" class="tutor__empty">
            <strong>准备开始</strong>
            <p>发一条消息，或点下面的选项告诉老师你的情况。</p>
          </div>
          <template v-for="(m, mi) in msgs" :key="m.id">
            <div v-if="m.role === 'user'" class="msg msg--user" :class="{ 'msg--editing': editingMsgId === m.id }">
              <!-- 编辑态：textarea 替换气泡 -->
              <div v-if="editingMsgId === m.id" class="msg__edit">
                <textarea
                  v-model="editingText"
                  class="msg__edit-input"
                  rows="2"
                  maxlength="800"
                  @keydown.enter.exact.prevent="saveEdit(m)"
                  @keydown.esc="cancelEdit"
                ></textarea>
                <div class="msg__edit-actions">
                  <span class="msg__edit-save" role="button" tabindex="0" @click="saveEdit(m)" @keydown.enter="saveEdit(m)" @keydown.space.prevent="saveEdit(m)">保存</span>
                  <span class="msg__edit-cancel" role="button" tabindex="0" @click="cancelEdit" @keydown.enter="cancelEdit" @keydown.space.prevent="cancelEdit">取消</span>
                </div>
              </div>
              <template v-else>
                <div class="msg__bubble">{{ m.text }}</div>
              </template>
              <div class="msg__meta">
                你 · {{ m.time }}
                <!-- 编辑入口归 meta 行（与 AI 操作条同一语言）：不再悬浮在气泡外遮字 -->
                <button
                  v-if="canEditMessage(m)"
                  type="button"
                  class="msg__edit-btn"
                  title="编辑这条消息"
                  aria-label="编辑这条消息"
                  @click="startEdit(m)"
                ><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>
              </div>
            </div>
            <div v-else class="msg msg--ai">
              <span class="msg__avatar"><img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" /></span>
              <div class="msg__content msg__content--actions"
                @mouseenter="onBubbleEnter(m.id || '')"
                @mouseleave="onBubbleLeave"
              >
                <div class="msg__bubble msg__bubble--html msg__bubble--relative" v-html="htmlFor(m)" @click="onCodeCopy"></div>
                <!-- 教学配图（owner 口径：图片是一种特殊的文字）——由老师给的一段文字生成，内联在回复里；
                     文本仍自洽：不看图也能继续。 -->
                <div v-if="m.images && m.images.length" class="msg__visuals">
                  <figure v-for="(img, ii) in m.images" :key="ii" class="msg__visual">
                    <img :src="img.url" :alt="img.caption || '教学配图'" loading="lazy" referrerpolicy="no-referrer" />
                    <figcaption v-if="img.caption">{{ img.caption }}</figcaption>
                  </figure>
                </div>
                <!-- 课堂结构图（2026-09-27 双通道重构）——老师给的 mermaid 源码，前端确定性渲染；
                     图内中文标签就是教学信息，文本仍自洽（不看图也能继续）。 -->
                <TeachingDiagram
                  v-for="(d, di) in m.diagrams"
                  :key="'d' + di"
                  :code="d.code"
                  :caption="d.caption"
                />
                <!-- 位置线图（Scope B）——空间位置关系的确定性渲染（追及/相遇这类"摆成一条线"的内容） -->
                <TeachingFigure
                  v-for="(f, fi) in m.figures"
                  :key="'f' + fi"
                  :figure="f"
                />
                <!-- 教师补充材料卡片（批次 E）：主线之外的公开网络资料，点开看原文窗口 -->
                <button
                  v-if="m.supplement?.materialId"
                  type="button"
                  class="msg__supplement"
                  @click="openSupplement(m.supplement)"
                >
                  <span class="msg__supplement-tag">补充资料</span>
                  <span class="msg__supplement-title">{{ m.supplement.title }}</span>
                  <span class="msg__supplement-topic">关于「{{ m.supplement.topic }}」· 点开看原文</span>
                </button>
                <!-- streaming 复用为「不可重生成」口径：MessageActions 以 streaming 隐藏「重新生成」，
                     非最后一条 AI 消息一律不可重生成（避免历史中段重生成导致顺序错乱） -->
                <MessageActions
                  :show="hoveredMsgId === m.id"
                  :streaming="(typing && streamingBubbleIndex === mi) || mi !== lastAiIndex"
                  @regenerate="regenerateMessage(m)"
                  @copy="copyMessage(m.text)"
                  @feedback="(up) => sendMessageFeedback(m, up)"
                />
                <span v-if="confusionDeltas[mi]?.length" class="msg__chip msg__chip--confuse">捕获到卡点「{{ confusionDeltas[mi]?.join('、') }}」· 导师会在这里多做确认</span>
                <div class="msg__meta">
                  问流导师 · {{ m.time }}
                  <button v-if="m.failed" type="button" class="msg__retry" @click="retryLast">重试</button>
                </div>
              </div>
            </div>
          </template>

          <div v-if="typing && streamingBubbleIndex === -1" class="msg msg--ai">
            <span class="msg__avatar"><img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" /></span>
            <div class="msg__bubble msg__bubble--typing"><i></i><i></i><i></i></div>
          </div>
        </div>

        <!-- 回到底部浮标：用户上翻看旧内容期间显示，点击回到最新消息 -->
        <button
          v-if="!nearBottom && msgs.length > 3"
          type="button"
          class="tutor__jump-bottom"
          aria-label="回到底部"
          @click="jumpToBottom"
        >↓ 回到底部</button>

        <!-- 开场行动台：AI 给的「下一步动作」选项，点一下直接执行（即点即达） -->
        <!-- 摸底 question 不再单独成待答气泡，收进面板作一行可选引导；想回答就打字，不想答就选动作直接开始 -->
        <div v-if="(quickReplies.length || openingQuestion) && !typing && !checkpoint" class="replies">
          <!-- 面板头（kicker/hint）降级为读屏可见：原型 .wf-replies 是裸按钮列表，没有白面板与面板头 -->
          <div class="replies__head visually-hidden">
            <span class="replies__kicker">{{ quickReplyKicker }}</span>
            <span class="replies__hint">{{ quickReplies.length ? '选一个，直接开始' : '也可以直接输入回答' }}</span>
          </div>
          <p v-if="openingQuestion" class="replies__question">{{ openingQuestion }}</p>
          <div v-if="quickReplies.length" class="replies__row">
            <button
              v-for="q in quickReplies"
              :key="q"
              type="button"
              class="reply"
              @click="sendDirect(q)"
            >
              <span class="reply__text">{{ q }}</span>
            </button>
          </div>
        </div>

        <!-- 知识点确认（动态行动台）：AI 讲完一个点、给出 confirmCheck 时出现 -->
        <div v-if="shouldAskSelfAssess && confirmCheck" class="kp-actions kp-actions--dynamic">
          <div class="kp-actions__head">
            <span class="kp-actions__kicker">{{ confirmCheck.prompt || '这个点感觉怎么样？' }}</span>
          </div>
          <div class="kp-actions__row kp-actions__row--stack">
            <button
              v-for="(a, ai) in confirmCheck.actions"
              :key="ai"
              type="button"
              class="kp-act"
              :class="`kp-act--${ai === 0 ? 'ok' : 'retry'}`"
              @click="sendDirect(a.message)"
            >
              <span class="kp-act__mark" aria-hidden="true">{{ ai === 0 ? '✓' : '↻' }}</span>
              <span class="kp-act__text">{{ a.label }}</span>
              <span class="kp-act__go" aria-hidden="true">→</span>
            </button>
          </div>
        </div>

        <!-- 检查点 -->
        <Transition name="cp">
          <div v-if="checkpoint && !completed" class="checkpoint">
          <div class="checkpoint__head">
            <span class="checkpoint__badge">检查点</span>
            <strong>{{ checkpoint.title || checkpoint.question }}</strong>
            <!-- 模型偶发把 title 与 question 填成同一句：重复渲染成"检查点出现两次"，同文去重 -->
            <p v-if="checkpoint.title && checkpoint.question && checkpoint.title !== checkpoint.question">{{ checkpoint.question }}</p>
          </div>
          <template v-if="checkpoint.options?.length">
            <label
              v-for="(opt, oi) in checkpoint.options"
              :key="opt.id"
              class="checkpoint__option"
              :class="{
                'checkpoint__option--on': selectedOptions.includes(opt.id),
                'checkpoint__option--ok': cpOptionMark(opt.id) === 'ok',
                'checkpoint__option--wrong': cpOptionMark(opt.id) === 'wrong',
                'checkpoint__option--lock': checkpointPending || checkpointSubmitting,
              }"
            >
              <input
                :type="checkpoint.type === 'multi_choice' ? 'checkbox' : 'radio'"
                :value="opt.id"
                :checked="selectedOptions.includes(opt.id)"
                :disabled="checkpointPending || checkpointSubmitting"
                @change="toggleOption(opt.id)"
              />
              <span class="checkpoint__key" aria-hidden="true">{{ optionLetter(oi) }}</span>
              <span class="checkpoint__text">{{ opt.text }}</span>
            </label>
          </template>
          <textarea v-else v-model="answerText" class="checkpoint__input" rows="3" :disabled="checkpointPending || checkpointSubmitting" placeholder="写下你的答案…"></textarea>
          <div v-if="checkpointFeedback" class="checkpoint__feedback" :class="{ 'checkpoint__feedback--ok': checkpointPassed }">
            {{ checkpointFeedback }}
          </div>
          <div class="checkpoint__actions">
            <span
              v-if="!checkpointSubmitting"
              class="btn-primary"
              :class="{ 'btn-primary--off': checkpointPending }"
              role="button"
              :tabindex="checkpointPending ? -1 : 0"
              @click="submitCheckpoint"
              @keydown.enter="submitCheckpoint"
              @keydown.space.prevent="submitCheckpoint"
            >{{ checkpointPending ? '判定中…' : '提交' }}</span>
            <span
              v-if="checkpoint.allowSkip !== false && !checkpointPending && !checkpointSubmitting"
              class="btn-ghost"
              role="button"
              tabindex="0"
              @click="skipCheckpoint"
              @keydown.enter="skipCheckpoint"
              @keydown.space.prevent="skipCheckpoint"
            >跳过</span>
            <span
              v-if="checkpointSubmitting && !checkpointStreaming"
              class="btn-ghost"
              role="button"
              tabindex="0"
              @click="dismissCheckpoint"
              @keydown.enter="dismissCheckpoint"
              @keydown.space.prevent="dismissCheckpoint"
            >继续 ›</span>
            <span v-else-if="checkpointStreaming" class="checkpoint__streaming">导师正在讲解…</span>
          </div>
          </div>
        </Transition>

        <!-- 输入区 -->
        <div class="composer">
          <div class="composer__box">
            <textarea
              v-model="input"
              class="composer__textarea"
              rows="1"
              maxlength="800"
              :disabled="completed"
              placeholder="随时提问，或说说你的理解…"
              @input="interactionMeta.onInput(input.length)"
              @keydown.enter.exact.prevent="send"
            ></textarea>
            <span class="composer__count">{{ input.length }} / 800</span>
            <!-- 发送/停止 同位置切换：导师流式中变停止（checkpointPending 判定中不可停止，保持禁用） -->
            <span
              v-if="!typing"
              class="composer__send"
              :class="{ 'composer__send--off': !input.trim() || checkpointPending || completed }"
              role="button"
              tabindex="0"
              aria-label="发送"
              @click="send"
              @keydown.enter="send"
              @keydown.space.prevent="send"
            >
              <svg viewBox="0 0 24 24" width="19" height="19"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
            </span>
            <span
              v-else
              class="composer__send composer__send--stop"
              role="button"
              tabindex="0"
              title="停止生成"
              @click="stopGeneration"
              @keydown.enter="stopGeneration"
              @keydown.space.prevent="stopGeneration"
            >
              <svg viewBox="0 0 24 24" width="13" height="13"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
            </span>
          </div>
          <!-- 提示统一右带（goal 页同款口径）：快捷键与 AI 声明并到一条基线，不再两侧分散 -->
          <div class="composer__hint composer__hint--single">
            <span class="composer__hint-note">Enter 发送 · Shift+Enter 换行</span>
            <AiContentNote />
          </div>
        </div>

        <!-- 完成浮层 -->
        <Transition name="finish-pop">
          <div v-if="completed" class="finish">
          <div class="finish__card">
            <span class="finish__ring">
              <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
            </span>
            <h2>本节完成</h2>
            <p>{{ wrapupText || '这次学习已经记录。' }}</p>
            <div v-if="finishStats.length" class="finish__stats">
              <span v-for="(s, i) in finishStats" :key="i"><b>{{ s.value }}</b>{{ s.label }}</span>
            </div>
            <div class="finish__actions">
              <span class="btn-primary" role="button" tabindex="0" @click="goBack" @keydown.enter="goBack" @keydown.space.prevent="goBack">回到路径详情</span>
              <span v-if="evaluationUrl" class="btn-ghost" role="button" tabindex="0" @click="goEvaluation" @keydown.enter="goEvaluation" @keydown.space.prevent="goEvaluation">查看学习反馈</span>
            </div>
          </div>
        </div>
        </Transition>
      </section>
    </div>

    <!-- 伴学浮窗：小启（独立角色，暖橙系）；不占主对话区，可回复、可收起成悬浮球 -->
    <Transition name="peer-pop">
      <div v-if="peerOpen && peerItems.length" class="peerdock" role="dialog" aria-label="小启伴学" aria-live="polite">
        <div class="peerdock__head">
          <span class="peerdock__avatar" aria-hidden="true">
            <span class="peerdock__avatar-q">Q</span>
          </span>
          <div class="peerdock__title">
            <span class="peerdock__name">
              <strong>小启</strong>
              <span class="peerdock__tag">伴学伙伴</span>
            </span>
            <span class="peerdock__status">
              <i class="peerdock__status-dot"></i>{{ peerHeadline }}
            </span>
          </div>
          <button type="button" class="peerdock__min" title="收起" aria-label="收起伴学窗" @click="minimizePeer">
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M5 12h14"/></svg>
          </button>
        </div>
        <div ref="peerScrollEl" class="peerdock__scroll">
          <div v-for="(p, i) in peerItems" :key="i" class="peerdock__msg" :class="`peerdock__msg--${p.role}`">
            <div class="peerdock__bubble" v-html="formatMessage(p.text)"></div>
            <template v-if="p.role === 'peer'">
              <div v-if="p.followUps?.length" class="peerdock__follows">
                <button
                  v-for="(q, qi) in p.followUps"
                  :key="qi"
                  type="button"
                  class="peerdock__follow"
                  :disabled="peerSending"
                  @click="sendPeerDirect(q)"
                >{{ q }}</button>
              </div>
              <div class="peerdock__meta">
                <span v-if="strategyLabelOf(p)" class="peerdock__strategy">{{ strategyLabelOf(p) }}</span>
                <small>小启 · {{ p.time }}</small>
              </div>
            </template>
            <small v-else>你 · {{ p.time }}</small>
          </div>
          <div v-if="peerSending" class="peerdock__msg peerdock__msg--peer">
            <div class="peerdock__bubble peerdock__bubble--typing"><i></i><i></i><i></i></div>
          </div>
          <div class="peerdock__ai-note"><AiContentNote /></div>
        </div>
        <div class="peerdock__input">
          <input
            v-model="peerInput"
            type="text"
            maxlength="500"
            placeholder="和小启聊聊你的卡点…"
            @keydown.enter.exact.prevent="sendPeer"
          />
          <button type="button" :disabled="!peerInput.trim() || peerSending" @click="sendPeer">发送</button>
        </div>
      </div>
    </Transition>
    <button
      v-if="!peerOpen && peerItems.length"
      type="button"
      class="peerfab"
      aria-label="打开小启伴学"
      @click="openPeerByUser"
    >
      <span class="peerfab__q" aria-hidden="true">Q</span>
      <i v-if="peerUnread" class="peerfab__dot"></i>
    </button>
    <!-- 教师补充材料弹层（批次 E） -->
    <div v-if="supplementPreview.open" class="supmodal" @click.self="closeSupplement">
      <div class="supmodal__card" role="dialog" aria-label="补充资料原文">
        <div class="supmodal__head">
          <strong>{{ supplementPreview.title }}</strong>
          <button ref="supCloseBtn" type="button" class="supmodal__close" aria-label="关闭" @click="closeSupplement">✕</button>
        </div>
        <div class="supmodal__body">
          <p v-if="supplementPreview.loading" class="supmodal__loading">正在读取原文…</p>
          <p v-else class="supmodal__text">{{ supplementPreview.text }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useIsDark } from '@/composables/useIsDark';

const isDark = useIsDark();
import { useRoute, useRouter } from 'vue-router';
import request, { API_BASE_URL } from '@/utils/api';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { readMaterialSection } from '@/api/materials';
import AiContentNote from '@/components/AiContentNote.vue';
import ImmersiveMenu from '@/components/ImmersiveMenu.vue';
import MessageActions from '@/components/chat/MessageActions.vue';
import TeachingDiagram from '@/components/TeachingDiagram.vue';
import TeachingFigure from '@/components/TeachingFigure.vue';
import { toast } from '@/utils/toast';
import { useInteractionMeta } from '@/composables/useInteractionMeta';
import { cachedMessageHtml, plainMessageHtml } from '@/utils/messageMarkdown';
/* 代码块语法高亮（原型 .wf-code）：本页 AI 气泡走 htmlFor → renderAiMessageHtml（markdown-it），
   与 MarkdownRenderer 同一套 highlight.js，按需注册教学常用语言（避免全量语言包 ~1MB）。
   样式不引 hljs 主题 CSS——代码面板恒深，token 配色在本文件 :deep 里按原型 --tok-* 上色。 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { askConfirm } from '@/views/admin-redesign/useConfirm';
import { unwrap } from './unwrap';
import { nowTime, type ChatMsg, type ChatSupplement } from './learningChat';
import MkGraph from '@/components/mk/MkGraph.vue'
import type { MkGraphNode, MkGraphEdge } from '@/components/mk/MkGraph.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import { learningAPI } from '@/api/learning'
import { isMastered, kpCls, kpStatusText, useKnowledgePanel } from './learningKp';
import { useOpeningSceneViews } from './learningScene';
import { usePeerAssistant } from './usePeerAssistant';
import { useMessageActions } from './useMessageActions';
import { useCheckpointFlow } from './useCheckpointFlow';

/** 按需注册（与 MarkdownRenderer.vue 同口径的常用教学语言子集） */
const LEARN_HLJS_LANGS: Array<[string, unknown]> = [
  ['python', python], ['javascript', javascript], ['typescript', typescript],
  ['java', java], ['c', c], ['cpp', cpp], ['bash', bash], ['shell', bash],
  ['json', json], ['yaml', yaml], ['xml', xml], ['sql', sql], ['plaintext', plaintext],
];
for (const [name, def] of LEARN_HLJS_LANGS) hljs.registerLanguage(name, def as never);
hljs.registerAliases(['js', 'jsx', 'mjs', 'node'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['sh', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html', 'xhtml', 'vue', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['c++', 'hpp'], { languageName: 'cpp' });
hljs.registerAliases(['txt', 'text'], { languageName: 'plaintext' });

const route = useRoute();
const router = useRouter();
const taskId = String(route.params.taskId || '');
const isReviewMode = computed(() => route.query.mode === 'review');
const interactionMeta = useInteractionMeta();

/* 知识点面板：原型是单列 880 无侧栏 → 常驻左栏降级为「头部入口 + 浮层抽屉」
   （功能不删：列表/图谱、掌握度、进度条全在抽屉里；桌面与移动端同一套开合逻辑） */
const kpOpen = ref(false);
/** 收起抽屉并把焦点还给头部入口（模态浮层不吞键盘焦点） */
function closeKp() {
  if (!kpOpen.value) return;
  kpOpen.value = false;
  document.querySelector<HTMLElement>('.learn__kpbtn')?.focus();
}
function toggleKp() {
  if (kpOpen.value) {
    closeKp();
    return;
  }
  kpOpen.value = true;
  // 打开后焦点跟进抽屉头（有列表/图谱两个 tab 与收起键），键盘用户不会停在被遮住的头部按钮上
  void nextTick(() => {
    document.querySelector<HTMLElement>('#learn-kp-panel .kp__head')?.focus();
  });
}

/* ---------- 键盘快捷键 ---------- */
/* Esc 由页面自管 window keydown（不走 useKeyboardShortcuts）：处理器需要拿到事件目标——
   焦点处于输入区（composer/检查点作答/消息编辑框）或弹层时必须直返，
   否则编辑态 Esc 会冒泡误触「停止生成/跳过检查点」（跳过会真调后端计一次跳过）。
   菜单开着时由 ImmersiveMenu 在 document 层 stopPropagation，本处理器收不到。 */
function onPageKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  // 补充资料弹层在场：Esc 只关弹层
  if (supplementPreview.value.open) {
    e.preventDefault();
    closeSupplement();
    return;
  }
  // 目标守卫：焦点在输入控件内 → 交给元素自身（如编辑框的 @keydown.esc 退出编辑）
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
  // 知识点抽屉开着：Esc 收起（抽屉是本页浮层，优先于停止生成/跳过检查点这类有副作用的动作）
  if (kpOpen.value) {
    closeKp();
    return;
  }
  // 目标守卫：焦点在任何弹层/菜单弹层内 → 不做全局动作（确认框、伴学窗等自带 Esc 语义）
  if (t && typeof t.closest === 'function' && t.closest('[role="dialog"], .imm-menu__pop')) return;
  if (completed.value) return;
  // 流式生成中：中止
  if (typing.value && streamAbort) {
    stopGeneration();
    return;
  }
  // 检查点可见：已提交（含答错上锁）时 Esc 收起，未提交时才「跳过」
  if (checkpoint.value && checkpointSubmitting.value) {
    dismissCheckpoint();
    return;
  }
  // 必答检查点（allowSkip:false）没有跳过出口：Esc 不绕过（与「跳过」按钮渲染条件同口径）
  if (checkpoint.value && checkpoint.value.allowSkip !== false) {
    skipCheckpoint();
  }
}

/* ---------- 基础 ---------- */
const taskTitle = ref('');
const pathName = ref('');
const pathId = ref('');
const session = ref<{ sessionId: string; revision: number } | null>(null);
const initing = ref(true);
const initError = ref('');
/** initing 卡死出口：开课请求可能长时间无响应（弱网/代理挂起），20s 后亮出「重新尝试」；
    「返回」入口常驻——移动端头部返回键 display:none，挂起时页面原本没有任何出口 */
const initStuck = ref(false);
let initStuckTimer = 0;
/** initing 收尾统一出口：清挂起计时器（try 正常完成与 catch 失败两条路都要走） */
function finishInit() {
  window.clearTimeout(initStuckTimer);
  initing.value = false;
}
const typing = ref(false);
// 菜单危险动作（结束/重新开始）in-flight 防重
const actionBusy = ref(false);
/** 完课结算 in-flight：finalize 含自动关课+wrapup（LLM，可达数十秒），期间锁发送，
    防止用户在结算窗口发消息打出「面板弹出后教师又回消息」的幽灵回合 */
const finalizing = ref(false);

const friendlyError = computed(() => {
  const raw = initError.value || '';
  if (/429|Insufficient|insufficient|余额|额度|quota/i.test(raw)) {
    return 'AI 服务额度暂时不足，恢复后再试。你的任务和进度都还在，也可以先去别的页面看看。';
  }
  if (/not found|不存在|404/i.test(raw)) {
    return '没有找到这个学习任务，它可能已被删除或重建。';
  }
  return raw || '开课失败，请重试。';
});

/* 顶栏连接态（P2-25 附带核查 2026-10-04，评审记为「未稳定复现」的稳定形态）：
   此前 `session ? '学习中' : '连接中'` 与错误态无关——boot 失败（initError）时 session
   恒为 null，正文已是「本节暂时开不了课」而顶栏绿显「连接中」，同屏自相矛盾。
   失败显式（三态纪律）：错误态改红字「连接失败」；点「重新尝试」成功（initError 清空）
   自动回到「连接中/学习中」流转。 */
const liveState = computed(() => {
  if (initError.value) return '连接失败';
  return session.value ? '学习中' : '连接中';
});

const msgs = ref<ChatMsg[]>([]);
let msgSeq = 0;
function pushMsg(m: ChatMsg): ChatMsg {
  const withId: ChatMsg = { ...m, id: m.id ?? `lm_${Date.now().toString(36)}_${++msgSeq}` };
  msgs.value.push(withId);
  return withId;
}

/** 教师补充材料弹层（批次 E）：点卡片看原文窗口（章节取回，失败回退摘要）。 */
const supplementPreview = ref<{ open: boolean; loading: boolean; title: string; text: string }>({
  open: false, loading: false, title: '', text: '',
});
const supCloseBtn = ref<HTMLButtonElement | null>(null);
/** 焦点管理：打开前记住触发元素，关闭时归还——键盘用户按 Esc 关掉弹层后不被丢在文档顶部 */
let supplementReturnFocus: HTMLElement | null = null;
async function openSupplement(supplement: ChatSupplement): Promise<void> {
  supplementReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  supplementPreview.value = { open: true, loading: true, title: supplement.title, text: '' };
  // 聚焦关闭键：Esc/Enter 都能立刻关掉弹层（Esc 走页面级 onPageKeydown 的弹层分支）
  await nextTick();
  supCloseBtn.value?.focus();
  try {
    const section = await readMaterialSection(supplement.materialId, {});
    supplementPreview.value.text = String(section?.excerpt || supplement.excerpt || '') || '（正文为空）';
  } catch {
    supplementPreview.value.text = String(supplement.excerpt || '') || '读取失败，请稍后重试。';
  } finally {
    supplementPreview.value.loading = false;
  }
}
function closeSupplement(): void {
  supplementPreview.value.open = false;
  supplementReturnFocus?.focus();
  supplementReturnFocus = null;
}
/**
 * 卡点条只在出现「没见过的新卡点」时展示一次，且只展示新增部分。
 * 后端的 confusionPoints 会逐轮累积/改写，旧口径只和紧邻上一条比对，
 * 内容稍有变化就再挂一条（真课实测：几乎每条老师消息都带，像坏了一样）。
 * 现在与前面**所有**消息的卡点并集比对取差集：差集为空 → 隐藏。
 */
/** 卡点相似度：字符二元组（bigram）Jaccard。措辞级去重会漏掉同义改写
 *  （"时间长度未经校准" vs "时长未确认"零字符串交集但语义相同），
 *  bigram 重叠 ≥0.5 视为同一卡点的改写，不再重复挂 chip（基线 31 格实测连续 4 轮刷屏）。 */
function confusionSimilar(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[\s，。、「」『』""''？！?!,.:：;；的了吗呢吧啊地得]/g, '');
  const x = norm(a); const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let k = 0; k < s.length - 1; k++) set.add(s.slice(k, k + 2));
    return set;
  };
  const gx = grams(x); const gy = grams(y);
  if (!gx.size || !gy.size) return x === y;
  let inter = 0;
  for (const g of gx) if (gy.has(g)) inter++;
  return inter / (gx.size + gy.size - inter) >= 0.5;
}
/** 卡点增量一次性预计算（下标与 msgs 对齐，空数组 = 无新增不挂 chip）。
 *  旧实现 showConfusionAt/confusionDeltaAt 在模板里逐条调用，每条都要与前面
 *  所有消息的卡点并集做 bigram 相似度比对（O(n²)），流式期间每次重渲染都全量重算。
 *  computed 只在 msgs 变化时算一遍，模板按 v-for 索引直接取用。 */
const confusionDeltas = computed<string[][]>(() => {
  const seen: string[] = [];
  return msgs.value.map((m) => {
    const cur = Array.isArray(m.confusion) ? (m.confusion as string[]).map(String) : [];
    // 当前条目若与历史任一卡点相似 → 视为同一卡点的改写，不计为新增
    const fresh = cur.filter((item) => !seen.some((prev) => confusionSimilar(item, prev)));
    for (const item of cur) seen.push(item);
    return fresh;
  });
});
const quickReplies = ref<string[]>([]);
/** 开场摸底引导（opening.question 收敛进行动台面板的一行小字，不再单独成待答气泡）；仅在有动作选项时收进面板 */
const openingQuestion = ref('');
/** 开场景卡片（后端 session.scene）：resumed/new 的恢复·接续·重学·复习信息，取代模板双气泡 */
const openingScene = ref<Record<string, any> | null>(null);
/** 卡片已被用户处理（点主按钮/关闭）后不再展示 */
const openingSceneDone = ref(false);
const knowledgePoints = ref<Array<Record<string, any>>>([]);
/**
 * 「快选确认」出现条件：AI 本轮抛出了需要学习者表态的确认点（当前知识点的掌握边界）
 * - 有 checkpoint 客观验证时不出（避免与验证题重复）
 * - 当前点已 mastered 或没有 learning/pending 的点时不出（无需表态）
 * - 开场建议 / 输入中 / 完成态 / 检查点态都不出
 */
const assessTarget = ref<{ name: string } | null>(null); // 待确认知识点名（本轮 AI 讲完的点）
/** teaching-turn 输出的动态确认动作组（讲完一个点让学生表态）；未输出则回退固定双按钮 */
const confirmCheck = ref<{ prompt: string; actions: Array<{ label: string; message: string }> } | null>(null);
const shouldAskSelfAssess = computed(() => {
  // 动态确认动作组（teaching-turn 明确输出 confirmCheck）→ 显示；
  // 模型未输出则视为本轮不需要表态（新版 prompt 已由 AI 自主决定），不再弹固定按钮，
  // 避免"问环境/给操作指令"这类轮次也弹"掌握了/再讲一遍"的过触发。
  if (typing.value || completed.value || checkpoint.value || quickReplies.value.length) return false;
  return !!confirmCheck.value;
});

const completed = ref(false);
const {
  checkpoint, selectedOptions, answerText, checkpointFeedback, checkpointPassed,
  checkpointPending, checkpointSubmitting, checkpointStreaming,
  toggleOption, dismissCheckpoint, submitCheckpoint, skipCheckpoint, disposeCheckpoint
} = useCheckpointFlow(session, typing, completed)
/** 检查点选项前缀（A/B/C/D…）：原型 .wf-cp__opt 里是字母小方块 + 文本两段 */
function optionLetter(i: number): string {
  return String.fromCharCode(65 + Math.max(0, Math.min(25, i)));
}
/**
 * 选项对错态（原型 .wf-cp__opt--ok/--wrong）：
 * 代码裁决到达即 checkpointSubmitting 上锁 + checkpointFeedback 落地（见 useCheckpointFlow.onJudgement），
 * 两者同时成立才算「已判定」，此时按 checkpointPassed 给**被选中的**选项上绿/红；未判定不染色。
 */
function cpOptionMark(id: string): 'ok' | 'wrong' | '' {
  if (!checkpointSubmitting.value || !checkpointFeedback.value) return '';
  if (!selectedOptions.value.includes(id)) return '';
  return checkpointPassed.value ? 'ok' : 'wrong';
}
/** 恢复会话提示条：mode=resumed 且回填到历史时显示「已恢复上次进度」，附重新开始出口 */
const resumedNotice = ref(false);

/* ---------- 开场景卡片（resumed / continuation / relearn / review） ---------- */
const {
  sceneTag, scenePrimaryText, sceneDefaultTitle, sceneLead,
  sceneUnresolved, sceneMasteryWarn, quickReplyKicker
} = useOpeningSceneViews(openingScene)

/** 卡片主按钮：resume（断线续课）= 走无输入续讲回合（不发伪消息）；其余场景 = 把用户"从这继续/开始"作为消息发给导师 */
function startFromScene() {
  if (typing.value || actionBusy.value || !session.value) return;
  const kind = openingScene.value?.kind;
  openingSceneDone.value = true;
  resumedNotice.value = false;
  if (kind === 'resume') {
    // 恢复续课：不发"继续上次进度"伪消息，直接触发后端纯续讲回合并流式渲染 AI 接续开场白
    void continueFromScene();
    return;
  }
  const quick = quickReplies.value[0];
  const sendText = quick || (kind === 'review' ? '开始复习' : '继续上次进度');
  void sendDirect(sendText);
}

/**
 * 恢复续讲（resume-continue）：无学生输入的教学回合。
 * 不 push 用户气泡、不收集交互 meta；流式渲染 AI 接续开场白，响应应用与 doSend 共用。
 */
async function continueFromScene() {
  if (typing.value || actionBusy.value || !session.value) return;
  quickReplies.value = [];
  openingQuestion.value = '';
  confirmCheck.value = null;
  assessTarget.value = null;
  typing.value = true;
  scrollDown();
  const s = session.value;
  // P5：续讲 revision 是必填项；缺失/非法时先向服务端拉一次最新 revision，
  // 否则请求必然 409 TEACHING_REVISION_REQUIRED——最需要恢复续讲的时刻反而恢复不了。
  if (!Number.isInteger(s.revision) || s.revision < 0) {
    try {
      const detail = await aiTeachingAPI.getSessionDetail(s.sessionId);
      if (detail && Number.isInteger(detail.revision) && detail.revision >= 0) {
        s.revision = detail.revision;
      }
    } catch {
      /* 拉取失败：沿用原值，由后端返回明确错误 */
    }
  }
  try {
    let r: Record<string, any>;
    try {
      streamAbort = new AbortController();
      r = await aiTeachingAPI.streamContinueSession(s.sessionId, s.revision, {
        signal: streamAbort.signal,
        onDelta: (delta) => {
          // 首个 delta 到达时才建 AI 气泡
          let m = streamingBubbleIndex.value >= 0 ? msgs.value[streamingBubbleIndex.value] : undefined;
          if (!m || m.role !== 'ai') {
            pushMsg({ role: 'ai', text: '', time: nowTime() });
            streamingBubbleIndex.value = msgs.value.length - 1;
            m = msgs.value[streamingBubbleIndex.value];
          }
          if (m) {
            m.text += delta;
            if (nearBottom.value) void scrollDown();
          }
        },
        onRestart: () => {
          const m = streamingBubbleIndex.value >= 0 ? msgs.value[streamingBubbleIndex.value] : undefined;
          if (m?.role === 'ai') m.text = '';
        },
      }) as unknown as Record<string, any>;
    } catch (streamError) {
      // 用户离页中止：静默丢弃
      if ((streamError as { cancelled?: boolean })?.cancelled) throw streamError;
      // 传输层失败且未收到任何内容：安全回退非流式 continue
      if (!(streamError as { transport?: boolean })?.transport) throw streamError;
      if (streamingBubbleIndex.value >= 0) msgs.value.splice(streamingBubbleIndex.value, 1);
      streamingBubbleIndex.value = -1;
      const streamRes = await request.post(`/ai-teaching/sessions/${s.sessionId}/continue`, { revision: s.revision }, { timeout: 120000 });
      r = (streamRes.data?.data || streamRes.data) as unknown as Record<string, any>;
    } finally {
      streamAbort = null;
    }
    session.value.revision = r.revision ?? s.revision + 1;
    const aiMsg = streamingBubbleIndex.value >= 0 ? msgs.value[streamingBubbleIndex.value] : undefined;
    await applyTurnResult(r, aiMsg);
  } catch (e) {
    if ((e as { cancelled?: boolean })?.cancelled) return;
    if (streamingBubbleIndex.value >= 0) msgs.value.splice(streamingBubbleIndex.value, 1);
    pushMsg({ role: 'ai', text: '恢复续讲失败了，你可以直接输入消息继续，或点下方「重试」。', time: nowTime(), failed: true });
  } finally {
    streamingBubbleIndex.value = -1;
    typing.value = false;
    scrollDown();
  }
}
const wrapupText = ref('');
const finishStats = ref<Array<{ label: string; value: string | number }>>([]);
const evaluationUrl = ref('');

const input = ref('');
const scrollEl = ref<HTMLElement | null>(null);

/* ---------- 伴学浮窗（角色「小启」，dock 式不占主对话区） ---------- */
const {
  peerOpen, peerUnread, peerItems, peerInput, peerSending, peerScrollEl,
  peerHeadline, strategyLabelOf, openPeerByUser, openPeerByTrigger, minimizePeer,
  pushPeerItem, sendPeer, sendPeerDirect, resetPeer, restorePeerHistory, abortPeer
} = usePeerAssistant(session)

const formatMessage = (text: string) => plainMessageHtml(text);

/* ---------- 代码块（原型 .wf-code：语言头 + 复制 + 语法高亮） ----------
   markdown-it 只吐 <pre><code class="language-x">，头部条/复制键/token 上色都在这里补齐：
   消毒后的 HTML 再走一次本地装饰（新增的是我们自己生成的标记，不引入任何外部输入）。
   结果按消息对象缓存——流式期间只有正在增长的那条消息会重算。 */
const codeBlockCache = new WeakMap<object, { text: string; html: string }>();

function decorateCodeBlocks(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = html;
  for (const pre of Array.from(host.querySelectorAll('pre'))) {
    if (pre.parentElement?.classList.contains('codeblock')) continue;
    const code = pre.querySelector('code');
    const langRaw = code?.className.match(/language-([\w+#-]+)/)?.[1] || '';
    const lang = langRaw.toLowerCase();
    if (code && lang && hljs.getLanguage(lang)) {
      try {
        code.innerHTML = hljs.highlight(code.textContent || '', { language: lang, ignoreIllegals: true }).value;
      } catch { /* 高亮失败：保留纯文本 */ }
    }
    const wrap = document.createElement('div');
    wrap.className = 'codeblock';
    const head = document.createElement('div');
    head.className = 'codeblock__head';
    const label = document.createElement('span');
    label.className = 'codeblock__lang';
    label.textContent = lang || 'text';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'codeblock__copy';
    copy.setAttribute('aria-label', '复制代码');
    copy.textContent = '复制';
    head.append(label, copy);
    pre.parentElement?.insertBefore(wrap, pre);
    wrap.append(head, pre);
  }
  return host.innerHTML;
}

/** 气泡内点击代理：复制键由 v-html 注入，事件挂在 Vue 绑定的气泡元素上 */
async function onCodeCopy(e: MouseEvent) {
  const btn = (e.target as HTMLElement | null)?.closest?.('.codeblock__copy') as HTMLElement | null;
  if (!btn) return;
  const text = btn.closest('.codeblock')?.querySelector('pre')?.textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent || '复制';
    btn.textContent = '已复制';
    window.setTimeout(() => { if (btn.isConnected) btn.textContent = prev; }, 1600);
  } catch {
    toast.error('复制失败，可手动选中代码复制');
  }
}

/** 气泡 HTML：消毒渲染 → 代码块装饰（语言头/复制/高亮），按消息对象缓存。
 *  流式渲染记忆化：直接调渲染函数会在每个 delta 触发全列表重渲染 + 全部历史消息重跑
 *  markdown/DOMPurify（50 条消息 × 每秒数十 delta 开销显著）。 */
const htmlFor = (m: { text: string }) => {
  const raw = cachedMessageHtml(m);
  if (typeof document === 'undefined' || raw.indexOf('<pre') === -1) return raw;
  const hit = codeBlockCache.get(m);
  if (hit && hit.text === m.text) return hit.html;
  const html = decorateCodeBlocks(raw);
  codeBlockCache.set(m, { text: m.text, html });
  return html;
};

/* 贴底跟随：用户上翻看旧内容时暂停自动滚动（避免被持续拽回底部），
   并在滚动到底部时清除「回到底部」浮标 */
const nearBottom = ref(true);
function updateNearBottom() {
  const el = scrollEl.value;
  if (!el) return;
  nearBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
}

async function scrollDown() {
  await nextTick();
  if (scrollEl.value) {
    scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
    nearBottom.value = true;
  }
}

function jumpToBottom() {
  scrollDown();
}

/* ---------- 启动 ---------- */
async function boot() {
  initing.value = true;
  initError.value = '';
  // 开课挂起计时：20s 无响应亮出「重新尝试」（见 initStuck 注释）
  initStuck.value = false;
  window.clearTimeout(initStuckTimer);
  initStuckTimer = window.setTimeout(() => { if (initing.value) initStuck.value = true; }, 20000);
  resumedNotice.value = false;
  assessTarget.value = null;
  confirmCheck.value = null;
  openingQuestion.value = '';
  try {
    // 任务详情与开课无数据依赖(仅回填标题/路径名),与 LLM 开场生成并行,
    // 省掉开课路径上一个串行 RTT;拿不到任务信息也能上课(原语义)
    const taskPromise = request
      .get(`/learning/tasks/${taskId}`)
      .then((t) => unwrap<Record<string, any>>(t))
      .catch(() => null);

    const s = (isReviewMode.value
      ? await aiTeachingAPI.startReviewSession(taskId)
      : await aiTeachingAPI.startSession(taskId)) as unknown as Record<string, any>;

    const task = await taskPromise;
    if (task) {
      taskTitle.value = task?.title || task?.displayLabel || '';
      pathName.value = task?.pathTitle || task?.learningPathTitle || task?.learningPath?.title || '';
    }
    /* pathId 取任务负载，query 兜底：任务负载偶发不带 learningPathId（旧路径/直进场），
       此时入口若带 ?pathId= （学习台 CTA）就靠它把「评估页 → 返回学习路径」接回详情页 */
    pathId.value = (route.query.pathId as string) || task?.learningPathId || task?.pathId || task?.learningPath?.id || '';
    if (s.mode === 'completed') {
      // P3：服务端已把上次「完成并结算」补结算完成（该任务已完成），直接进入学习反馈，不再新建课堂
      // pathId 透传不断：少了它，评估页的「返回学习路径」只能退回列表页（2026-09-25）
      router.replace({
        name: 'LearningEvaluationPage',
        params: { taskId, sessionId: s.sessionId },
        query: pathId.value ? { pathId: pathId.value } : {},
      });
      return;
    }
    session.value = { sessionId: s.sessionId, revision: s.revision ?? 0 };
    // 开场景卡片数据（scene 驱动；resume/复习/重学/接续的结构化开场）
    const sceneRaw = s?.scene && typeof s.scene === 'object' ? s.scene : null;
    // 首课（first）不需要卡片：AI 真实开场白已足够，避免双重介绍
    openingScene.value = sceneRaw && sceneRaw.kind !== 'first' ? sceneRaw : null;
    openingSceneDone.value = !openingScene.value;
    const openingText = s.opening?.message || s.welcomeMessage;
    if (s.mode === 'resumed') {
      // 恢复：不再 push 模板双气泡（"已恢复…我们继续"），由场景卡片承接；
      // 快选也由卡片主按钮承担，避免「卡片按钮 + 底部开场建议」两处重复
      quickReplies.value = [];
      openingQuestion.value = '';
    } else {
      // 新开课（含接续/重学/首课）：保留 AI 的真实教学开场白（承接上节/切入本节）
      if (openingText) pushMsg({ role: 'ai', text: openingText, time: nowTime() });
      // 摸底 question 不再单独成待答气泡：有动作选项时收进面板作一行可选引导（想答打字、不答选动作直接开始）；
      // 无动作选项（纯 question 开场）时仍作为气泡，避免问题无处安放
      const qActions = (s.opening?.quickReplies || []).map((q: Record<string, any>) => q.text || q).filter(Boolean);
      if (s.opening?.question) {
        if (qActions.length) openingQuestion.value = String(s.opening.question);
        else pushMsg({ role: 'ai', text: String(s.opening.question), time: nowTime() });
      }
      quickReplies.value = qActions;
    }
    if (Array.isArray(s.knowledgePoints) && s.knowledgePoints.length) {
      knowledgePoints.value = s.knowledgePoints;
    }
    // 会话来源提示：恢复上次课堂 / 已学完重开（避免「从头开始」困惑）
    if (s.mode === 'resumed') {
      // 恢复上下文：回填历史对话与待处理检查点，避免刷新后课堂记忆断裂
      try {
        const detail = await aiTeachingAPI.getSessionDetail(s.sessionId);
        if (detail) {
          let restoredCount = 0;
          if (Array.isArray(detail.messages)) {
            // 主对话历史（user/assistant 非 peer 标记）
            const restored = detail.messages
              .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.peer)
              .map((m) => pushMsg({
                role: m.role === 'user' ? 'user' : 'ai',
                text: String(m.content || ''),
                time: nowTime(),
                ...(Array.isArray(m.images) && m.images.length ? { images: m.images } : {}),
                ...(Array.isArray(m.diagrams) && m.diagrams.length ? { diagrams: m.diagrams } : {}),
                ...(Array.isArray(m.figures) && m.figures.length ? { figures: m.figures } : {}),
              }));
            restoredCount = restored.length;
            if (restored.length) scrollDown();
            // 伴学历史回填进小启浮窗（刷新后不丢失）：
            // ① 主动伴学 = peer 标记消息；② 自动触发伴学 = assistant 消息内嵌的 peerMessage
            const peerRestored: Array<{ role: 'me' | 'peer'; text: string; strategy: string | null }> = [];
            for (const m of detail.messages) {
              if (m.peer) {
                peerRestored.push({
                  role: m.role === 'user' ? 'me' : 'peer',
                  text: String(m.content || ''),
                  strategy: m.role === 'assistant' ? m.peerStrategy || null : null,
                });
              } else if (m.role === 'assistant' && m.peerTriggered && m.peerMessage) {
                peerRestored.push({
                  role: 'peer',
                  text: String(m.peerMessage),
                  strategy: m.peerStrategy || null,
                });
              }
            }
            restorePeerHistory(peerRestored);
          }
          // 有可续历史才显示恢复横幅（附「重新开始」出口）；全新无历史则不必打扰。
          // 有开场景卡片时横幅让位给卡片（卡片已含恢复信息与重新开始出口），避免重复提示
          resumedNotice.value = restoredCount > 0 && !openingScene.value;
          if (detail.pendingCheckpoint) {
            checkpoint.value = detail.pendingCheckpoint;
            checkpointFeedback.value = '';
            selectedOptions.value = [];
            answerText.value = '';
            checkpointSubmitting.value = false;
          }
          if (Array.isArray(detail.knowledgePoints) && detail.knowledgePoints.length) {
            knowledgePoints.value = detail.knowledgePoints;
          }
          session.value.revision = typeof detail.revision === 'number' ? detail.revision : session.value.revision;
        }
      } catch { /* 历史回填失败不阻断上课 */ }
    } else if (s.mode === 'new') {
      aiTeachingAPI.getLatestTaskEvaluation(taskId)
        .then((latest) => {
          if (latest?.sessionId) toast.info('本课已学过，本次将重新开始');
        })
        .catch(() => {});
    }
    finishInit();
  } catch (e: any) {
    initError.value = e?.message || e?.response?.data?.error?.message || '开课失败，请重试';
    finishInit();
  }
}

/* ---------- 对话 ---------- */
let lastUserText = '';
/** 流式发送中的 AbortController：离页/卸载时中止，触发后端 res close 止损上游生成 */
let streamAbort: AbortController | null = null;
/**
 * 流式内容气泡下标（-1 = 尚无气泡）：
 * teaching-turn 为 JSON 输出无 delta，期间仅显示 typing 指示器；首个 delta 到达时才建气泡，
 * 避免「空气泡 + typing 指示器」双气泡。
 */
const streamingBubbleIndex = ref(-1);

/** 最后一条 AI 消息的下标：「重新生成」入口只对它开放——重生成会删掉该气泡并重发
 *  其前驱问题，对历史中段的 AI 消息触发会把其后整个对话错位清掉 */
const lastAiIndex = computed(() => {
  for (let i = msgs.value.length - 1; i >= 0; i--) {
    if (msgs.value[i].role === 'ai') return i;
  }
  return -1;
});
const {
  hoveredMsgId, onBubbleEnter, onBubbleLeave, copyMessage, sendMessageFeedback,
  editingMsgId, editingText, canEditMessage, startEdit, cancelEdit, saveEdit, regenerateMessage
} = useMessageActions({ msgs, typing, completed, session, doSend })

/** 向服务端向前同步 revision（尽力而为）：中止流式生成后，服务端可能已消费该回合并 +1，
 *  本地 revision 落后。doSend 撞 TEACHING_SESSION_STALE 有自愈重发，但 finalize
 *  （finalizeSessionReliably）没有 STALE 自愈——必须在结算前主动拉一次权威 revision。 */
async function syncRevisionFromServer(): Promise<void> {
  if (!session.value) return;
  try {
    const detail = await aiTeachingAPI.getSessionDetail(session.value.sessionId);
    if (detail && Number.isInteger(detail.revision) && session.value) {
      session.value.revision = detail.revision;
    }
  } catch { /* 拉取失败沿用本地值，由后端返回明确错误 */ }
}

function stopGeneration() {
  streamAbort?.abort();
  streamAbort = null;
  // 中止后立即向前同步：用户「停止 → 完成并结算」是常见路径，不等下一步才补
  void syncRevisionFromServer();
}

async function send(e?: unknown) {
  // IME 组合期守卫：拼音选词回车不发送
  const ke = e as KeyboardEvent | undefined;
  if (ke && (ke.isComposing || ke.keyCode === 229)) return;
  const t = input.value.trim();
  // 完课后输入即锁：完成候选轮教师常带一个收尾追问，若放行发送，回答会打给已终态化的会话
  // （服务端拒绝、消息不入库、误报失败，且陈旧重试会重复推送同一条用户消息）。
  // 结算中（finalizing）同样锁：finalize 含自动关课+wrapup，期间放行会打出面板后的幽灵教师回合。
  if (!t || typing.value || checkpointPending.value || !session.value || completed.value || finalizing.value) return;
  input.value = '';
  assessTarget.value = null; // 用户已表态/新回合开始，快选确认清除
  confirmCheck.value = null;
  await doSend(t);
}

async function sendDirect(text: string) {
  if (typing.value || !session.value || completed.value || finalizing.value) return;
  assessTarget.value = null; // 点击快选确认/开场建议即表态，清除待确认
  await doSend(text);
}

async function doSend(text: string, allowStaleRetry = true, skipUserPush = false) {
  if (!session.value) return;
  lastUserText = text;
  if (!skipUserPush) pushMsg({ role: 'user', text, time: nowTime() });
  quickReplies.value = [];
  openingQuestion.value = '';
  confirmCheck.value = null;
  assessTarget.value = null;
  typing.value = true;
  scrollDown();
  const meta = interactionMeta.collect(text);
  try {
    let r: Record<string, any>;
    try {
      streamAbort = new AbortController();
      r = await aiTeachingAPI.streamSendMessage(session.value.sessionId, text, session.value.revision, {
        signal: streamAbort.signal,
        onDelta: (delta) => {
          // 首个 delta 到达时才建 AI 气泡，避免 JSON 输出（无 delta）产生空气泡
          let m = streamingBubbleIndex.value >= 0 ? msgs.value[streamingBubbleIndex.value] : undefined;
          if (!m || m.role !== 'ai') {
            pushMsg({ role: 'ai', text: '', time: nowTime() });
            streamingBubbleIndex.value = msgs.value.length - 1;
            m = msgs.value[streamingBubbleIndex.value];
          }
          if (m) {
            m.text += delta;
            // 仅贴底时自动跟随（用户上翻看旧内容时不打断）
            if (nearBottom.value) void scrollDown();
          }
        },
        onRestart: () => {
          const m = streamingBubbleIndex.value >= 0 ? msgs.value[streamingBubbleIndex.value] : undefined;
          if (m?.role === 'ai') m.text = '';
        },
      }, meta) as unknown as Record<string, any>;
    } catch (streamError) {
      // 用户离页触发的 abort：不重发、不当作失败
      if ((streamError as { cancelled?: boolean })?.cancelled) throw streamError;
      // 传输层失败且未收到任何内容：安全回退非流式重发；业务失败或已收到部分内容则交给外层报错
      if (!(streamError as { transport?: boolean })?.transport) throw streamError;
      if (streamingBubbleIndex.value >= 0) msgs.value.splice(streamingBubbleIndex.value, 1);
      streamingBubbleIndex.value = -1;
      r = await aiTeachingAPI.sendMessage(session.value.sessionId, text, session.value.revision, meta) as unknown as Record<string, any>;
    } finally {
      streamAbort = null;
    }
    session.value.revision = r.revision ?? session.value.revision + 1;
    interactionMeta.markAssistantLanded();
    const aiMsg = streamingBubbleIndex.value >= 0 ? msgs.value[streamingBubbleIndex.value] : undefined;
    await applyTurnResult(r, aiMsg);
  } catch (e) {
    // 离页中止：静默丢弃，不重发也不展示失败气泡
    if ((e as { cancelled?: boolean })?.cancelled) return;
    // 流式气泡可能已有部分内容：移除后展示统一失败气泡
    if (streamingBubbleIndex.value >= 0) msgs.value.splice(streamingBubbleIndex.value, 1);
    // 陈旧 revision（多标签页/刷新竞态）：同步最新 revision 后重发一次，避免重试死循环
    const raw = e as any;
    const staleCode = raw?.response?.data?.error?.code || raw?.response?.data?.error || raw?.code || '';
    if (String(staleCode).includes('TEACHING_SESSION_STALE') && session.value && allowStaleRetry) {
      try {
        const fresh = (isReviewMode.value
          ? await aiTeachingAPI.startReviewSession(taskId)
          : await aiTeachingAPI.startSession(taskId)) as unknown as Record<string, any>;
        if (typeof fresh?.revision === 'number') session.value.revision = fresh.revision;
      } catch { /* 同步失败则直接展示失败气泡 */ }
      // 重发不再重复推送用户气泡：首轮已经乐观渲染过，再推一次就是两条同样的「你」
      await doSend(text, false, true);
      return;
    }
    pushMsg({ role: 'ai', text: '这次回复失败了，点下方「重试」。', time: nowTime(), failed: true });
  } finally {
    streamingBubbleIndex.value = -1;
    typing.value = false;
    scrollDown();
  }
}

/**
 * 应用一轮教学回合的完整返回（AI 气泡定型 + 卡点 chip + 伴学 + 知识看板 + 确认动作组 + 检查点 + 收束）。
 * doSend 与 continueFromScene（恢复续讲）共用，保证两条通道行为一致。
 */
async function applyTurnResult(r: Record<string, any>, aiMsg?: { role: string; text: string; confusion?: unknown[] } | undefined) {
  // 导师回复（附带本轮捕获到的卡点，作为气泡下方的依据 chip）
  const confusion = Array.isArray(r.analysis?.confusionPoints)
    ? r.analysis.confusionPoints.map((p: unknown) => String(p || '').trim()).filter(Boolean).slice(0, 2)
    : [];
  if (aiMsg?.role === 'ai') {
    aiMsg.text = r.aiResponse || aiMsg.text;
    aiMsg.confusion = confusion;
    if (Array.isArray(r.images) && r.images.length) (aiMsg as ChatMsg).images = r.images;
    if (Array.isArray(r.diagrams) && r.diagrams.length) (aiMsg as ChatMsg).diagrams = r.diagrams;
    if (Array.isArray(r.figures) && r.figures.length) (aiMsg as ChatMsg).figures = r.figures;
    // 教师补充材料卡片（批次 E）：承诺的"下轮补充"在本轮送达
    if (r.supplementaryMaterial?.materialId) (aiMsg as ChatMsg).supplement = r.supplementaryMaterial;
  } else if (r.aiResponse) {
    pushMsg({ role: 'ai', text: r.aiResponse, time: nowTime(), confusion, ...(Array.isArray(r.images) && r.images.length ? { images: r.images } : {}), ...(Array.isArray(r.diagrams) && r.diagrams.length ? { diagrams: r.diagrams } : {}), ...(Array.isArray(r.figures) && r.figures.length ? { figures: r.figures } : {}), ...(r.supplementaryMaterial ? { supplement: r.supplementaryMaterial } : {}) });
  }
  // 兜底：AI 全程未返回任何内容（空响应）时给占位气泡，避免本轮「无声消失」
  if (!r.aiResponse && (!aiMsg || !aiMsg.text.trim())) {
    if (aiMsg?.role === 'ai') {
      aiMsg.text = '（本轮没有收到回复，你可以换个说法再试一次。）';
    } else {
      pushMsg({ role: 'ai', text: '（本轮没有收到回复，你可以换个说法再试一次。）', time: nowTime() });
    }
  }
  // 伴学触发：进独立浮动窗，不占主对话区（角色小启，暖橙系）。
  // 频控：冷却期（60s）内或用户手动收起过 → 仅累计未读红点，不强制展开，避免打扰循环
  if (r.peerTriggered && r.peerMessage) {
    pushPeerItem({
      role: 'peer',
      text: String(r.peerMessage),
      time: nowTime(),
      strategy: r.peerStrategy || null,
      followUps: Array.isArray(r.peerFollowUpQuestions)
        ? r.peerFollowUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, 3)
        : [],
    });
    openPeerByTrigger();
  }
  if (Array.isArray(r.knowledgePoints) && r.knowledgePoints.length) {
    knowledgePoints.value = r.knowledgePoints;
    // AI 本轮讲完后：若指向某个当前点且没有客观 checkpoint，则在该点形成待确认边界
    assessTarget.value = !r.checkpoint && r.knowledgePoint
      ? { name: String(r.knowledgePoint) }
      : null;
    // 动态确认动作组（teaching-turn 输出）优先；未输出则回退固定文案
    const cc = r.confirmCheck;
    confirmCheck.value = (cc && Array.isArray(cc.actions) && cc.actions.length === 2)
      ? {
          prompt: String(cc.prompt || '').trim(),
          actions: cc.actions
            .filter((a: any) => a && typeof a.label === 'string' && typeof a.message === 'string')
            .map((a: any) => ({ label: a.label, message: a.message })),
        }
      : null;
  } else {
    assessTarget.value = null;
    confirmCheck.value = null;
  }
  // 完课回合不落检查点：服务端已终态化（提交必 409），卡片只会成为面板后的死入口
  if (r.checkpoint && !r.isCompletion) {
    checkpoint.value = r.checkpoint;
    checkpointFeedback.value = '';
    selectedOptions.value = [];
    answerText.value = '';
    checkpointSubmitting.value = false;
    assessTarget.value = null; // 有客观验证题，不再弹快选确认
    confirmCheck.value = null;
  }
  if (r.isCompletion) {
    await finish(isReviewMode.value ? 'complete_review' : 'complete_task');
  }
}

async function retryLast() {
  // 结算中/已完课不放行重试：会话已（或将）终态化，重试只会打出幽灵回合
  if (finalizing.value || completed.value) return;
  msgs.value = msgs.value.filter((m) => !m.failed);
  if (!lastUserText) return;
  // 失败回合的用户气泡还留在列表里（过滤只清失败气泡）：重试复用它，不再追加第二条同样的「你」
  const last = msgs.value[msgs.value.length - 1];
  const reuseUserBubble = last?.role === 'user' && last.text === lastUserText;
  await doSend(lastUserText, true, reuseUserBubble);
}

/* ---------- 结束 ---------- */
async function finish(action: 'complete_task' | 'end_only' | 'complete_review') {
  if (!session.value || completed.value) return;
  finalizing.value = true;
  try {
    // 结算前向前同步 revision：complete/end 的入口会先 abort 在途流式（不走 stopGeneration），
    // 同步兜住这条路径的陈旧 revision——finalize 无 STALE 自愈，409 后只能整单失败
    await syncRevisionFromServer();
    const r = await aiTeachingAPI.finalizeSessionReliably(session.value.sessionId, {
      action,
      revision: session.value.revision,
      // 三种 action 的收尾原因统一为 manual-end（task-completed 由后端 task 完成事件单独判定）
      reason: 'manual-end'
    }) as unknown as Record<string, any>;
    completed.value = true;
    const wrapup = r.wrapup;
    // 收尾寄语兜底链：topicSummary → learningEvaluation → practiceAdvice → knowledgeSummary，
    // 最后才落「这次学习已经记录。」（避免 wrapup 缺字段时干巴巴收尾）
    wrapupText.value =
      wrapup?.summary?.topicSummary ||
      wrapup?.summary?.learningEvaluation ||
      wrapup?.summary?.practiceAdvice ||
      wrapup?.summary?.knowledgeSummary ||
      '';
    const stats: Array<{ label: string; value: string | number }> = [];
    if (wrapup?.progress?.newlyMastered?.length) stats.push({ label: '新掌握知识点', value: wrapup.progress.newlyMastered.length });
    if (wrapup?.evaluation?.duration) stats.push({ label: '分钟', value: Math.round(wrapup.evaluation.duration) });
    if (wrapup?.evaluation?.messageCount) stats.push({ label: '次对话', value: wrapup.evaluation.messageCount });
    finishStats.value = stats;
    evaluationUrl.value = `/learn/${taskId}/evaluation/${session.value.sessionId}${pathId.value ? `?pathId=${encodeURIComponent(pathId.value)}` : ''}`;
  } catch (e: any) {
    // 结算失败不冒充完成：保留重试入口，用户仍可去学习反馈页查看
    const msg = e?.message || e?.response?.data?.error?.message || '结算失败';
    toast.error(`课堂收束未完成：${msg}`);
    evaluationUrl.value = `/learn/${taskId}/evaluation/${session.value.sessionId}${pathId.value ? `?pathId=${encodeURIComponent(pathId.value)}` : ''}`;
    // 会话可能已收束但轮询异常：提供进入反馈页的途径（完成浮层不弹，直接弹全局确认引导，
    // 不再用 setTimeout（此前 timer 未在卸载清理，路由离开后弹窗会出现在下一个页面上））
    if (session.value) {
      const go = await askConfirm({
        title: '收束未完成',
        message: '课堂收束遇到问题。你可以稍后重试，或直接查看学习反馈（反馈可能仍在生成中）。',
        confirmText: '查看学习反馈',
        danger: false,
      });
      if (go && evaluationUrl.value) router.push(evaluationUrl.value);
    }
    // 结算失败回到对话态：解锁发送（会话可能仍可继续或重试结算）
    finalizing.value = false;
  }
}

/** 完成并结算（拍板 2026-08-21 方案 B 主路径）：计入任务/里程碑/路径完成进度 */
async function completeAndSettle() {
  if (actionBusy.value) return;
  const ok = await askConfirm({
    title: '完成并结算任务',
    message: '确认当前任务已学完？将结算任务并计入里程碑与路径进度，同时生成本次学习总结。',
    confirmText: '完成并结算',
    danger: false,
  });
  if (!ok) return;
  actionBusy.value = true;
  try {
    // 流式回复或检查点判定 in-flight：先中止在途请求并等待收尾，避免「完成浮层已弹但会话实际未结束」的假完成
    if (typing.value || checkpointPending.value) {
      streamAbort?.abort();
      streamAbort = null;
      for (let i = 0; i < 20 && (typing.value || checkpointPending.value); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await finish('complete_task');
  } finally {
    actionBusy.value = false;
  }
}

async function endSession() {
  if (actionBusy.value) return;
  const ok = await askConfirm({
    title: '结束学习（不计入完成）',
    message: '结束本次学习？将生成本次学习总结，但当前任务不会计入完成进度（里程碑/路径进度不动）。',
    confirmText: '结束学习',
    danger: false,
  });
  if (!ok) return;
  actionBusy.value = true;
  try {
    // 流式回复或检查点判定 in-flight：先中止在途请求并等待收尾，避免「完成浮层已弹但会话实际未结束」的假完成
    if (typing.value || checkpointPending.value) {
      streamAbort?.abort();
      streamAbort = null;
      for (let i = 0; i < 20 && (typing.value || checkpointPending.value); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await finish('end_only');
  } finally {
    actionBusy.value = false;
  }
}

async function pauseAndLeave() {
  if (session.value) {
    try {
      const rev = await aiTeachingAPI.pauseSession(session.value.sessionId, 'manual', session.value.revision);
      if (typeof rev === 'number' && session.value) session.value.revision = rev;
    } catch { /* ignore */ }
  }
  goBack();
}

/** 纯返回：不调任何接口，会话保持原状（in_progress 照旧，下次进来续上）。
    「暂停并离开」会写 pause 状态，「结束/完成」会结算——都替用户做了决定。 */
function leaveWithoutSideEffect() {
  goBack();
}

async function restart() {
  resumedNotice.value = false;
  openingSceneDone.value = true;
  assessTarget.value = null;
  confirmCheck.value = null;
  if (actionBusy.value) return;
  if (!session.value) return;
  const ok = await askConfirm({
    title: '重新开始',
    message: '重新开始将清空当前学习进度与消息记录，此操作不可恢复。',
    confirmText: '重新开始',
    danger: true,
  });
  if (!ok) return;
  actionBusy.value = true;
  try {
    // 流式生成或检查点判定 in-flight：先中止并等它收尾再 reset（与 complete/end 同一套等待循环）。
    // 检查点提交 settle 时会把 revision 回写 session（useCheckpointFlow.ts）——不等它就 reset+boot，
    // 旧提交的收尾代码会把旧会话的 revision 写到新开课的 session 上，后续请求必 409 STALE
    streamAbort?.abort();
    streamAbort = null;
    for (let i = 0; i < 20 && (typing.value || checkpointPending.value); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const rev = await aiTeachingAPI.resetSession(session.value.sessionId, session.value.revision);
    session.value.revision = typeof rev === 'number' ? rev : session.value.revision + 1;
    msgs.value = [];
    checkpoint.value = null;
    checkpointPending.value = false;
    completed.value = false;
    finalizing.value = false;
    // 伴学窗同步重置（B7：上一会话内容不残留到新开课）
    resetPeer();
    await boot();
  } catch (e: any) {
    toast.error(e?.message || e?.response?.data?.error?.message || '重新开始失败，请稍后重试');
  } finally {
    actionBusy.value = false;
  }
}

/* ---------- 知识点 ---------- */
const {
  masteredCount, weightedProgressPct
} = useKnowledgePanel(knowledgePoints)

/* 完课入口的位置（2026-10-06 用户指令「把完成本课放在这里，不合适吧」）：
   原先在快捷回复之后、composer 之前常驻一颗整宽「完成本课」（原型 #wfFinishLesson 带来的），
   它与 ⋯ 菜单里的「完成并结算任务」是同一个 handler（completeAndSettle），属重复入口；
   而且它压在输入流上方、与当前任务（上课）相逆 —— P2-28（2026-10-04 评审）当时已指出
   「主 CTA 与当前任务相逆、压在输入流上方易误触」，但只降了材质（lesson-cta--damped）没动位置。
   现改为：完课只保留 ⋯ 菜单一处（课级动作与「结束学习/暂离或重学」同组，语义正确），
   并把「本课知识点尚未全部掌握」的信号带进该菜单项副文，不再丢信息。 */
const kpIncomplete = computed(() => {
  const total = knowledgePoints.value.length;
  return total > 0 && masteredCount.value < total;
});
/** ⋯ 菜单「完成并结算任务」副文：知识点未掌握时前置提示，其余为常规口径 */
const finishHint = computed(() =>
  kpIncomplete.value
    ? '本课知识点尚未全部掌握 · 仍可计入进度并生成总结'
    : '计入进度 · 生成本次学习总结'
);

/* 头部掌握度小圆环：r=8 → 周长 2πr≈50.27，弧长 = 已掌握/总数（与「n/N 已掌握」胶囊同口径） */
const KP_RING_C = 2 * Math.PI * 8;
const kpRingDash = computed(() => {
  const total = knowledgePoints.value.length;
  const frac = total ? masteredCount.value / total : 0;
  return `${(frac * KP_RING_C).toFixed(2)} ${KP_RING_C.toFixed(2)}`;
});

/* ---------- 知识点图谱（列表/图谱切换；图谱按需加载，只取当前路径） ---------- */
const kpView = ref<'list' | 'graph'>('list')
const graphNodes = ref<MkGraphNode[]>([])
const graphEdges = ref<MkGraphEdge[]>([])
const graphMeta = ref<{ nodeCount: number; edgeCount: number; totalConcepts: number; truncated: boolean } | null>(null)
const graphLoading = ref(false)
const graphError = ref('')
const kpSelected = ref<MkGraphNode | null>(null)
/** 跟随站点主题（v2 与 admin 共用 documentElement.dataset.theme） */
const kpGraphTheme = computed<'light' | 'dark'>(() =>
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
)
async function switchKpToGraph() {
  kpView.value = 'graph'
  if (graphNodes.value.length || graphLoading.value) return
  graphLoading.value = true
  graphError.value = ''
  try {
    const data = (await learningAPI.getConceptGraph(pathId.value ? { pathId: pathId.value } : undefined)) as {
      nodes?: MkGraphNode[]; edges?: MkGraphEdge[]; meta?: typeof graphMeta.value
    } | null
    graphNodes.value = Array.isArray(data?.nodes) ? data!.nodes! : []
    graphEdges.value = Array.isArray(data?.edges) ? data!.edges! : []
    graphMeta.value = data?.meta ?? null
  } catch (e) {
    graphError.value = `图谱加载失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    graphLoading.value = false
  }
}

/* ---------- 导航 ---------- */
function goBack() {
  if (pathId.value) router.push(`/learning-path/${pathId.value}`);
  else router.push('/learning-paths');
}
function goEvaluation() {
  if (evaluationUrl.value) router.push(evaluationUrl.value);
}

/* 关闭标签页/整页刷新时 Vue 不会走 onBeforeUnmount，
   用 pagehide + sendBeacon 兜底记暂停，避免时长统计把闲置时间算进去。 */
function onPageHide() {
  streamAbort?.abort();
  abortPeer();
  if (!session.value || completed.value) return;
  const payload = JSON.stringify({ reason: 'pagehide', revision: session.value.revision });
  const blob = new Blob([payload], { type: 'application/json' });
  navigator.sendBeacon?.(`${API_BASE_URL}/ai-teaching/sessions/${session.value.sessionId}/pause`, blob);
}

/* 切换标签页/窗口：隐藏时暂停、切回可见时恢复，学习时长只计页面激活时间。
   pause/resume 返回值（服务端 revision+1 后的新值）写回 session.value.revision，
   避免本地 revision 落后导致 resume/后续请求触发 TEACHING_SESSION_STALE 409 后会话永久卡死。
   操作串行化：先等 pause 落定并回写 revision，再发 resume，杜绝并发导致的 expectedRevision 冲突。 */
let lifecycleChain: Promise<void> = Promise.resolve();

/** resume 失败后的会话恢复：重新 startSession 拿新 revision（服务端会 resume 同一会话），
    无法恢复时明确提示刷新，绝不静默忽略。 */
async function recoverSession(sid: string) {
  const cur = session.value;
  if (!cur || cur.sessionId !== sid || completed.value) return;
  try {
    const s = (isReviewMode.value
      ? await aiTeachingAPI.startReviewSession(taskId)
      : await aiTeachingAPI.startSession(taskId)) as unknown as Record<string, any>;
    if (!session.value || session.value.sessionId !== sid) return;
    session.value = { sessionId: s.sessionId, revision: s.revision ?? 0 };
    if (s.mode === 'resumed') {
      // 同一会话在后端恢复：本地消息仍有效，仅同步新 revision 与知识点状态
      if (Array.isArray(s.knowledgePoints) && s.knowledgePoints.length) {
        knowledgePoints.value = s.knowledgePoints;
      }
      toast.info('已恢复课堂连接');
    } else {
      // 旧会话已失效、服务端重新开课：清空本地展示并按新开场白初始化
      msgs.value = [];
      checkpoint.value = null;
      checkpointFeedback.value = '';
      checkpointPending.value = false;
      completed.value = false;
      finalizing.value = false;
      quickReplies.value = (s.opening?.quickReplies || []).map((q: Record<string, any>) => q.text || q).filter(Boolean);
      if (Array.isArray(s.knowledgePoints) && s.knowledgePoints.length) {
        knowledgePoints.value = s.knowledgePoints;
      }
      const openingText = s.opening?.message || s.welcomeMessage;
      if (openingText) msgs.value.push({ role: 'ai', text: openingText, time: nowTime() });
      // 摸底 question 收进面板作一行可选引导（与 boot 一致）；无动作时仍 push 气泡
      if (s.opening?.question) {
        if (quickReplies.value.length) openingQuestion.value = String(s.opening.question);
        else msgs.value.push({ role: 'ai', text: String(s.opening.question), time: nowTime() });
      }
      toast.info('已重新开课');
    }
  } catch {
    toast.error('课堂连接恢复失败，请刷新页面后继续');
  }
}

function onVisibilityChange() {
  if (!session.value || completed.value) return;
  const sid = session.value.sessionId;
  const hidden = document.hidden;
  lifecycleChain = lifecycleChain.then(async () => {
    const s = session.value;
    if (!s || s.sessionId !== sid || completed.value) return;
    try {
      if (hidden) {
        const rev = await aiTeachingAPI.pauseSession(sid, 'hidden', s.revision);
        if (typeof rev === 'number' && session.value?.sessionId === sid) session.value.revision = rev;
      } else {
        try {
          const rev = await aiTeachingAPI.resumeSession(sid, s.revision);
          if (typeof rev === 'number' && session.value?.sessionId === sid) session.value.revision = rev;
        } catch (resumeError) {
          await recoverSession(sid);
        }
      }
    } catch {
      // pause 失败不致命：会话仍可交互，下次 visible 时由 resume/恢复逻辑兜底
    }
  });
}

onMounted(() => {
  boot();
  window.addEventListener('keydown', onPageKeydown);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibilityChange);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPageKeydown);
  window.clearTimeout(initStuckTimer);
  streamAbort?.abort();
  abortPeer();
  disposeCheckpoint();
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (session.value && !completed.value) {
    aiTeachingAPI.pauseSession(session.value.sessionId, 'pagehide', session.value.revision).catch(() => {});
  }
});
</script>

<style scoped>
.learn { min-height: calc(100vh / var(--vp-zoom, 1)); display: flex; flex-direction: column; background: var(--canvas); }

/* ---------- 头部 ---------- */
.learn__head {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 18px;
  padding: 12px 24px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  border-bottom: 1px solid var(--line);
  /* position+z-index 建立堆叠上下文：若不设会按文档顺序排，位于其后的 .tutor 将盖住「⋯」弹层。显式提升，让头部与菜单弹层始终在对话框之上。 */
  position: relative;
  z-index: 50;
}
.learn__back { font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer; white-space: nowrap; background: none; border: 0; padding: 0; font-family: inherit; }
.learn__back:hover { color: var(--blue-deep); }
.learn__title { display: grid; gap: 3px; min-width: 0; }
.learn__title strong { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.learn__title small { font-size: 12px; color: var(--faint); }
.learn__head-right { display: flex; align-items: center; gap: 10px; }
.learn__state-link {
  font-size: 12px; font-weight: 700;
  color: var(--muted);
  text-decoration: none;
  padding: 4px 11px; border-radius: var(--mk-radius-pill);
  border: 1px solid var(--line);
  background: var(--surface);
  transition: color 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}
.learn__state-link:hover { color: var(--blue-deep); border-color: color-mix(in srgb, var(--blue) 40%, transparent); background: color-mix(in srgb, var(--blue) 6%, transparent); }
/* 知识点入口（头部精简：原型顶栏没有常驻状态胶囊，侧栏入口收成一颗轻量 chip） */
.learn__kpbtn {
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: 12px; font-weight: 700; line-height: 1.4;
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--blue) 26%, transparent);
  padding: 5px 11px; border-radius: var(--mk-radius-pill);
  cursor: pointer; white-space: nowrap;
  transition: background 0.14s ease, border-color 0.14s ease;
}
.learn__kpbtn:hover { background: color-mix(in srgb, var(--blue) 14%, transparent); border-color: color-mix(in srgb, var(--blue) 44%, transparent); }
.learn__kpbtn b { font-weight: 800; font-variant-numeric: tabular-nums; }
/* 连接态：降为纯文字（原型顶栏只有一行状态字，不再挂绿胶囊） */
.learn__live {
  font-size: 12px; font-weight: 700; color: var(--green-ink);
}
/* boot 失败态（P2-25 核查 2026-10-04）：红字显式失败——正文已显「本节暂时开不了课」，
   顶栏不再绿显「连接中」假装还在连接 */
.learn__live--err { color: var(--red-ink); }

/* ---------- 布局（原型 .wf-screen：单列、gap 14、≥1024 定宽 880 居中） ----------
   原型的课堂屏没有左侧栏：知识点从常驻列降级成「头部入口 + 浮层抽屉」，正文只剩一列。 */
.learn__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px 18px;
  max-width: 880px;
  width: 100%;
  margin: 0 auto;
}
@media (min-width: 1024px) {
  .learn__body { padding: 22px 30px 36px; }
}

/* ---------- 知识点抽屉（原型单列无侧栏 → 头部「知识点 N/M」开合的左侧浮层） ----------
   z-index：抽屉整体盖过头部（header 50）——抽屉自带标题与收起键，压住头部才不会出现
   「面板头被半透明顶栏遮住」的重影；遮罩 60 / 抽屉 61，其余浮层（补充资料弹层 90）仍在其上。 */
.kp-scrim {
  position: fixed; inset: 0;
  z-index: 60;
  background: var(--wf-overlay);
  animation: kp-fade-in 0.2s ease both;
}
@keyframes kp-fade-in { from { opacity: 0; } to { opacity: 1; } }
.kp {
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: min(340px, 86vw);
  z-index: 61;
  background: var(--surface);
  border-right: 1px solid var(--line);
  border-radius: 0;
  padding: 14px 16px calc(14px + env(safe-area-inset-bottom, 0px));
  display: flex; flex-direction: column; gap: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  box-shadow: var(--mk-shadow-modal); /* 抽屉 = 模态档 */
  transform: translateX(-102%);
  visibility: hidden;
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), visibility 0s linear 0.28s;
}
.kp.kp--open {
  transform: none;
  visibility: visible;
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), visibility 0s;
}
.kp__head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  /* font 简写必须写在 font-size 之前：它会把字体重置为继承值，写在后面就把字号一起
     打回 16px。这个顺序错误让「本节知识点」按 16px 渲染，需要 80px 而卡头只给 67px，
     折成两行把卡头从 20px 撑到 48px（2026-09-26 用户侧对齐走查）。 */
  font: inherit;
  font-size: 13px;
  border: 0; background: transparent; padding: 0; margin: 0;
  color: inherit; text-align: left; cursor: pointer;
}
/* 头部信息组（2026-09-26 用户「0/2已掌握进行中1 太丑，数据平摊着」）：
   左 = 掌握度小圆环 + 标题，右 = 语义色胶囊（掌握绿 / 进行中蓝，全空灰显），
   数据不再是裸文字平铺。 */
.kp__head-main { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.kp__ring { width: 18px; height: 18px; flex-shrink: 0; transform: rotate(-90deg); }
.kp__ring circle { fill: none; stroke-width: 3; }
.kp__ring-track { stroke: var(--line); }
.kp__ring-val { stroke: var(--green); stroke-linecap: round; transition: stroke-dasharray .4s ease; }
/* 0 掌握时 round 端帽会在起点渲染出绿点（读作进度假象），整段隐藏 */
.kp__ring-val--none { visibility: hidden; }
.kp__head-meta { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
.kp__chip {
  font-size: 12px; font-weight: 800; line-height: 1;
  padding: 4px 8px; border-radius: 999px; white-space: nowrap;
}
.kp__chip--mastered { color: var(--green-ink); background: color-mix(in srgb, var(--green) 12%, transparent); }
/* 0 态也用蓝 chip（2026-09-27 用户反馈：进行中 chip 删除后，颜色转移到已掌握）：
   有知识点在进行中（未全掌握且存在）时，0/N 本身就是「进行中」的信息 */
.kp__chip--mastered.kp__chip--empty { color: var(--blue-ink); background: color-mix(in srgb, var(--blue) 10%, transparent); }
.kp__chip--mastered.kp__chip--empty.kp__chip--none { color: var(--faint); background: var(--mk-surface-2); }
.kp__caret { display: inline; font-size: 12px; color: var(--faint); flex-shrink: 0; }
.kp__body { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.kp__bar { height: 6px; border-radius: 999px; background: var(--bar-track); overflow: hidden; }
.kp__bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width .4s ease; }
/* 视图切换（列表/图谱）：轻量分段控件，走既有 token（mk token 深浅主题自动跟随，2026-09-25 深色修复） */
.kp__views { display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px; background: var(--mk-surface-2); align-self: flex-start; }
.kp__view { border: 0; background: transparent; cursor: pointer; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; color: var(--faint); }
.kp__view--on { background: var(--surface); color: var(--blue-deep); box-shadow: var(--wf-shadow-raised); }
.kp__hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--faint); }
.kp__hint--err { color: var(--red-ink); }
/* 通向「知识图谱」聚合页的桥：学习页这里只画当前路径，想看全部路径要去聚合页 */
.kp__more { margin-left: 6px; color: var(--mk-blue); text-decoration: none; white-space: nowrap; }
.kp__more:hover { text-decoration: underline; }
.kp__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.kp__item {
  display: grid; grid-template-columns: 20px 1fr; gap: 9px;
  padding: 8px;
  border-radius: var(--mk-radius-lg);
  border: 1px solid transparent;
}
.kp__item--current { background: color-mix(in srgb, var(--blue) 6%, transparent); border-color: color-mix(in srgb, var(--blue) 20%, transparent); }
.kp__mark {
  width: 18px; height: 18px; border-radius: 50%;
  margin-top: 2px;
  border: 2px dashed color-mix(in srgb, var(--blue) 15%, var(--line));
  display: grid; place-items: center;
}
.kp__item--done .kp__mark { background: var(--green); border: 0; color: #fff; }
.kp__item--current .kp__mark { border: 2px solid var(--blue); border-style: solid; }
.kp__name strong { display: block; font-size: 13px; line-height: 1.45; }
.kp__name small { display: block; margin-top: 2px; font-size: 12px; color: var(--faint); }
.kp__item--current .kp__name small { color: var(--blue-deep); font-weight: 700; }
.kp__time { font-size: 12px; color: var(--faint); border-top: 1px solid var(--line); padding-top: 10px; }

/* ---------- 通栏进度卡（原型 .wf-learn__progress：卡壳 + 12.5/13.5 两行 + 8px 进度条） ---------- */
.lessonbar {
  flex: 0 0 auto;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--shadow-sm);
  padding: 14px 16px;
  display: grid; gap: 11px;
}
.lessonbar__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.lessonbar__head span { font-size: 12.5px; color: var(--muted); }
.lessonbar__head strong { font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.lessonbar__track { height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--line) 60%, transparent); overflow: hidden; }
.lessonbar__track i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width .4s ease; }

/* ---------- 导师对话 ---------- */
.tutor {
  position: relative;
  display: flex; flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  overflow: hidden;
  /* 单列布局：tutor 吃掉 .learn__body 的全部剩余高度（进度卡 + gap 之外），
     高度由 flex 决定 —— 不再写死 vh 上限，避免「有/无进度卡」两套高度口径。 */
  flex: 1 1 auto;
  min-height: 560px;
}
.tutor__scroll {
  flex: 1; overflow-y: auto;
  padding: 20px;
  display: flex; flex-direction: column; gap: 18px;
}
/* 消息从上方开始、向下生长：桌面**刻意不做贴底**（同目标对话页）。
   2026-10-05 曾把窄屏那条贴底规则提到基础档，结果短会话整段对话吊在对话区底部、
   看起来像从下往上长；2026-10-06 用户否掉，回退为窄屏专属（见 ≤1100 档）。 */

/* 消息空态（批20）：居中轻提示，不抢开场卡 */
.tutor__empty {
  margin: auto;
  display: grid;
  justify-items: center;
  gap: 6px;
  text-align: center;
  color: var(--faint);
}
.tutor__empty strong { font-size: 15px; color: var(--muted); }
.tutor__empty p { margin: 0; font-size: 13px; }

/* 恢复进度横幅：续上历史时的可见确认（替代一次性 toast） */
.tutor__resume {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 14px 0;
  padding: 8px 10px 8px 14px;
  border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
  border-radius: var(--mk-radius-xl);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  color: var(--blue-deep);
  font-size: 12.5px;
  flex: 0 0 auto;
}
.tutor__resume-text { flex: 1; font-weight: 600; }
.tutor__resume-restart {
  border: 1px solid color-mix(in srgb, var(--blue) 35%, transparent);
  background: var(--surface);
  color: var(--blue-deep);
  font: inherit; font-size: 12px; font-weight: 700;
  padding: 4px 12px; border-radius: var(--mk-radius-pill); cursor: pointer;
}
.tutor__resume-restart:hover { background: color-mix(in srgb, var(--blue) 10%, transparent); }
.tutor__resume-close {
  display: grid; place-items: center;
  width: 44px; height: 44px;
  border: 0; border-radius: var(--mk-radius-sm);
  background: transparent; color: var(--faint);
  cursor: pointer; flex: 0 0 auto;
}
.tutor__resume-close:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--muted); }
/* 开场景卡片：resumed / 接续 / 重学 / 复习 的结构化开场 */
.oscene {
  margin: 10px 14px 0;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  display: grid; gap: 8px;
  flex: 0 0 auto;
}
.oscene--review { border-color: color-mix(in srgb, var(--blue) 30%, transparent); }
.oscene__tag {
  justify-self: start;
  font-size: 12px; font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
  padding: 2px 9px; border-radius: var(--mk-radius-pill);
}
.oscene--review .oscene__tag { color: var(--blue-deep); background: color-mix(in srgb, var(--blue) 12%, transparent); border-color: color-mix(in srgb, var(--blue) 32%, transparent); }
.oscene__title { margin: 0; font-size: 15px; font-weight: 800; color: var(--ink); }
.oscene__lead { margin: 0; font-size: 12.5px; line-height: 1.65; color: var(--muted); }
.oscene__summary {
  margin: 0;
  font-size: 12.5px; line-height: 1.7;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 3.5%, transparent);
  border-radius: var(--mk-radius-lg); padding: 8px 11px;
}
.oscene__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.oscene__chip-label { font-size: 12px; font-weight: 700; color: var(--faint); }
.oscene__chip {
  font-size: 12px; font-weight: 700;
  color: var(--amber);
  background: color-mix(in srgb, var(--amber) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber) 32%, transparent);
  padding: 2px 9px; border-radius: var(--mk-radius-pill);
}
.oscene__warn { font-size: 12px; line-height: 1.6; color: var(--amber); }
.oscene__warn span { font-weight: 700; }
.oscene__actions { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.oscene__actions .btn-ghost { font-size: 12.5px; }
/* 暗色：底色/描边已全部令牌化，自动翻转，原逐条暗色字面量覆写退役 */
.tutor__jump-bottom {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 5;
  padding: 7px 14px; border: 1px solid var(--line); border-radius: var(--mk-radius-pill);
  background: var(--surface); color: var(--muted);
  font: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer;
  /* 悬浮在滚动内容之上的常驻控件，保留 raised 档让它读得出来；
     规则里唯一保留的 transform 是居中用的 translateX(-50%)，与抬升无关。 */
  box-shadow: var(--wf-shadow-raised);
  transition: transform 0.15s ease, color 0.15s ease;
}
/* hover 只变色，不抬升（translateX(-50%) 是居中必须保留的那一半） */
.tutor__jump-bottom:hover { color: var(--blue); transform: translateX(-50%); }
.msg { display: flex; flex-direction: column; gap: 5px; max-width: 76%; } /* 85→76：与 goal 页同口径收窄对话行（2026-09-27 用户反馈） */
.msg--user { align-self: flex-end; align-items: flex-end; position: relative; }
.msg--user .msg__bubble {
  /* 用户气泡改实色 --blue：蓝→深蓝渐变已随「友好而平」批次退役，
     白字在 #2f6ae0 上对比度约 4.9:1，仍过 AA。 */
  background: var(--blue);
  color: var(--text-on-primary);
  border-radius: 16px 16px 4px 16px;
  white-space: pre-wrap;
}
/* 用户消息编辑按钮（hover 显示；触屏常显） */
/* 编辑入口收进 meta 行：你 · 时间（左）… 铅笔（右），hover 消息显现 */
.msg--user .msg__meta { display: inline-flex; align-items: center; gap: 7px; }
.msg--user .msg__edit-btn {
  width: 20px; height: 20px;
  display: inline-grid; place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--mk-radius-sm);
  background: none;
  color: var(--faint);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}
.msg--user:hover .msg__edit-btn { opacity: 1; }
.msg--user .msg__edit-btn:hover { color: var(--blue-deep); }
@media (hover: none) {
  .msg--user .msg__edit-btn {
    opacity: 1;
    /* EG20：触屏触控地板 40（与 AI 操作条 msg-actions 同口径），图标居中 */
    width: 40px;
    height: 40px;
  }
}
/* 编辑态 */
.msg--editing { align-self: flex-end; align-items: flex-end; }
.msg__edit {
  display: grid; gap: 6px;
  min-width: min(320px, 70vw);
}
.msg__edit-input {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--blue) 40%, transparent);
  border-radius: var(--mk-radius-xl);
  padding: 9px 12px;
  font: inherit; font-size: 13.5px; line-height: 1.6;
  color: var(--ink);
  background: var(--surface);
  resize: vertical;
  outline: none;
}
.msg__edit-actions { display: flex; gap: 8px; justify-content: flex-end; }
.msg__edit-save, .msg__edit-cancel {
  font-size: 12px; font-weight: 700;
  padding: 5px 14px;
  border-radius: var(--mk-radius-pill);
  cursor: pointer;
}
.msg__edit-save {
  color: var(--text-on-primary);
  /* 实色主按钮（原蓝渐变退役）；按压反馈用 scale(.98)，替掉原先的 hover 抬升 */
  background: var(--blue);
}
.msg__edit-save:not(:disabled):active { transform: scale(0.98); }
.msg__edit-cancel {
  color: var(--muted);
  border: 1px solid var(--line);
  background: var(--surface);
}
.msg__bubble {
  padding: 11px 15px;
  font-size: 14px; line-height: 1.65;
  border-radius: 4px 16px 16px 16px;
  background: color-mix(in srgb, var(--surface) 72%, var(--blue) 4%); color: var(--ink);
}
.msg__bubble p { margin: 0 0 8px; }
.msg__bubble p:last-child { margin-bottom: 0; }
.msg--ai { flex-direction: row; align-items: flex-start; gap: 10px; max-width: 94%; }
.msg--ai .msg__content { display: grid; gap: 5px; min-width: 0; }
/* 教学配图（owner 口径 2026-09-23：图片是一种特殊的文字）——内联在老师回复里的图；
   图只是辅助：文本仍自洽，不看图也能继续。 */
.msg__visuals { display: grid; gap: 8px; }
/* 教师补充材料卡片（批次 E）：轻量、可点、不抢正文视觉 */
.msg__supplement {
  display: grid; gap: 2px; width: 100%; margin-top: 8px; padding: 8px 10px;
  text-align: left; cursor: pointer;
  border: 1px solid var(--line); border-radius: 8px; /* 圆角阶梯：控件 */
  background: var(--surface); color: inherit;
}
.msg__supplement:hover { border-color: var(--blue); }
.msg__supplement-tag {
  justify-self: start; padding: 1px 6px; border-radius: 999px;
  background: var(--blue); color: var(--text-on-primary); font-size: 12px; font-weight: 700;
}
.msg__supplement-title { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg__supplement-topic { font-size: 12px; color: var(--muted); }
/* 补充材料弹层 */
.supmodal { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, .45); }
.supmodal__card { width: min(640px, 100%); max-height: 80vh; display: flex; flex-direction: column; background: var(--surface); border-radius: 16px; /* 圆角阶梯：弹层 */ box-shadow: var(--wf-shadow-modal); }
.supmodal__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.supmodal__head strong { font-size: 14px; }
.supmodal__close { border: 0; background: transparent; font-size: 14px; cursor: pointer; color: var(--muted); }
.supmodal__body { padding: 12px 16px 16px; overflow-y: auto; }
.supmodal__text, .supmodal__loading { margin: 0; font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; color: var(--ink); }
/* 补充资料弹窗已全部令牌化（--surface/--line/--muted/--ink），投影走 --wf-shadow-modal 自动翻转，
   原暗色逐条覆写块退役；仅保留关闭钮 hover 的暗色轻底 */
[data-theme='dark'] .supmodal__close:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }
.msg__visual { margin: 0; display: grid; gap: 4px; }
.msg__visual img {
  display: block; max-width: 100%; max-height: 320px;
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-md);
  background: var(--surface);
}
.msg__visual figcaption { font-size: 12px; color: var(--faint); line-height: 1.5; }
.msg__avatar {
  /* 原型 wf-msg__avatar：蓝 12% 扁平圆 + blue-deep 字（去蓝→紫渐变方块，2026-09-30 视觉收敛） */
  width: 30px; height: 30px; border-radius: 50%;
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  color: var(--blue-deep); font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
  flex: 0 0 auto; margin-top: 2px;
}
/* P3-40（设计评审）：「问流导师 · 00:37」在 73px 窄容器折行断眉标——nowrap 单行；
   时间戳 tabular-nums 定宽不会撑破气泡 */
.msg__meta { font-size: 12px; color: var(--faint); white-space: nowrap; font-variant-numeric: tabular-nums; }

/* 消息入场：新气泡浮出（typing 圆点除外） */
@media (prefers-reduced-motion: no-preference) {
  .msg { animation: msg-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both; }


  /* 初始化/错误/课堂 三态切换：淡入。
     用 CSS 关键帧而非 Vue Transition —— 关键帧即使不执行，元素也停在默认的可见状态；
     而 Transition 的类是在 rAF 里加的，rAF 不触发会把正文永久留在 opacity:0 / 不挂载。 */
  .learn__stage, .learn__body { animation: stage-fade-in .2s ease; }
  @keyframes stage-fade-in { from { opacity: 0; } }

  /* 检查点：上浮淡入 / 收缩淡出 */
  .cp-enter-active { transition: opacity .25s ease, transform .25s cubic-bezier(0.16, 1, 0.3, 1); }
  .cp-leave-active { transition: opacity .2s ease, transform .2s ease; }
  .cp-enter-from { opacity: 0; transform: translateY(10px); }
  .cp-leave-to { opacity: 0; transform: scale(.98) translateY(-4px); }

  /* 完成浮层：遮罩淡入 + 卡片弹簧弹入 + 对勾弹性 pop */
  .finish-pop-enter-active { transition: opacity .2s ease; }
  .finish-pop-leave-active { transition: opacity .15s ease; }
  .finish-pop-enter-from, .finish-pop-leave-to { opacity: 0; }
  .finish-pop-enter-active .finish__card { animation: finish-card-in .35s cubic-bezier(0.34, 1.56, 0.64, 1) .05s both; }
  .finish-pop-enter-active .finish__ring svg { animation: finish-check-pop .4s cubic-bezier(0.34, 1.56, 0.64, 1) .2s both; }

  /* 知识点状态过渡：标记底色渐变 + 勾号弹性 pop */
  .kp__mark { transition: background .2s ease, border-color .2s ease; }
  .kp__mark svg { animation: kp-check-pop .25s cubic-bezier(0.34, 1.56, 0.64, 1) both; }

  /* 检查点反馈条：淡入上浮 */
  .checkpoint__feedback { animation: cp-fb-in .2s ease both; }
}
@keyframes msg-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes finish-card-in {
  from { opacity: 0; transform: scale(.92) translateY(10px); }
  to { opacity: 1; transform: none; }
}
@keyframes finish-check-pop {
  from { transform: scale(.4) rotate(-30deg); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes kp-check-pop {
  from { transform: scale(.4); }
  to { transform: none; }
}
@keyframes cp-fb-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

/* 卡点依据 chip */
.msg__chip {
  display: inline-flex; align-items: center; gap: 5px;
  width: fit-content; max-width: 100%; padding: 4px 10px; border-radius: var(--mk-radius-pill);
  font-size: 12px; font-weight: 700; line-height: 1.5;
  /* chip 放在 grid 布局的 msg__content 里时必须跨全列，否则被挤进窄列竖排 */
  grid-column: 1 / -1;
}
.msg__chip--confuse { color: var(--amber-ink); background: color-mix(in srgb, var(--wf-color-warning) 12%, transparent); border: 1px solid color-mix(in srgb, var(--wf-color-warning) 20%, transparent); margin-top: 6px; }

/* ---------- 伴学浮窗（角色「小启」· 暖橙系，dock 式不占主对话区） ---------- */
.peerdock {
  position: fixed; right: 22px; bottom: 132px; z-index: 60;
  /* bottom 抬升避开底部输入区（composer ≈104px + 间距 28px），
     否则 dock 内容高时（长消息）覆盖发送按钮 */
  width: min(340px, calc(100vw - 32px));
  display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
  max-height: 440px;
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--wf-color-warning) 28%, transparent);
  border-radius: 16px; /* 圆角阶梯：弹层 */
  /* 原 0 16px 40px rgba(190,92,26,.14) 是橙色染色投影：按三档中性档改用 overlay
     （悬浮抽屉本就该压住滚动内容，不靠颜色分层）。 */
  box-shadow: var(--wf-shadow-overlay);
  overflow: hidden;
}
.peer-pop-enter-active { transition: opacity 0.28s ease, transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1); }
.peer-pop-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.peer-pop-enter-from,
.peer-pop-leave-to { opacity: 0; transform: translateY(16px) scale(0.96); }
.peerdock__head {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px;
  background: linear-gradient(135deg, rgba(255, 152, 67, 0.12), color-mix(in srgb, var(--amber) 5%, transparent));
  border-bottom: 1px solid color-mix(in srgb, var(--wf-color-warning) 18%, transparent);
}
/* 小启 Q 头像：暖橙实底 + 白字 Q，与导师问流（蓝紫 favicon）明确区分。
   批次 D：135deg 橙渐变 → 纯色 #d97706（对白字 4.52:1，达 WCAG AA；
   原渐变两端 #ff9d4d / #f4791f 对白字分别只有 2.0:1 / 2.9:1，本就不达标）。 */
.peerdock__avatar {
  width: 32px; height: 32px; border-radius: 50%; flex: 0 0 auto;
  background: #d97706;
  /* 原 0 6px 14px rgba(244,121,31,.35) 橙色发光已删：头像在 dock 卡内，不承担层级 */
  display: grid; place-items: center;
}
.peerdock__avatar-q {
  color: #fff; font-size: 17px; font-weight: 800; font-style: italic;
  font-family: Georgia, 'Times New Roman', serif;
  line-height: 1;
  transform: translateX(-0.5px);
}
.peerdock__title { flex: 1; min-width: 0; display: grid; gap: 2px; }
.peerdock__name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.peerdock__name strong { font-size: 13.5px; color: var(--ink); }
.peerdock__tag {
  flex: 0 0 auto;
  font-size: 12px; font-weight: 700; color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber) 35%, transparent);
  padding: 1px 7px; border-radius: var(--mk-radius-pill);
  line-height: 1.6;
}
.peerdock__status {
  display: flex; align-items: center; gap: 5px; min-width: 0;
  font-size: 12px; color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.peerdock__status-dot {
  flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%;
  background: var(--wf-color-success);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--wf-color-success) 18%, transparent);
}
/* 收起键：原生 button（键盘可聚焦、Enter/Space 触发——原 span 无 tabindex，键盘用户
   开窗后只能用鼠标收起）；热区 36px（原 24px 对拇指偏小）。视觉仍是 12px 图标。 */
.peerdock__min {
  flex: 0 0 auto;
  width: 36px; height: 36px; border-radius: var(--mk-radius-md);
  display: grid; place-items: center;
  border: 0; background: transparent; padding: 0;
  color: var(--muted); cursor: pointer;
}
.peerdock__min:hover { background: color-mix(in srgb, var(--wf-color-warning) 12%, transparent); color: var(--ink); }
.peerdock__scroll {
  overflow-y: auto; padding: 12px;
  display: grid; gap: 10px; align-content: start;
  background: var(--canvas);
}
.peerdock__msg { display: grid; gap: 3px; justify-items: start; max-width: 100%; }
.peerdock__msg--me { justify-items: end; }
.peerdock__bubble {
  max-width: 100%; padding: 9px 12px;
  font-size: 13px; line-height: 1.6;
  border-radius: 4px 16px 16px 16px; /* 圆角阶梯：卡片/弹层 + 内芯尾角 */
  background: color-mix(in srgb, var(--wf-color-warning) 9%, transparent); color: var(--ink);
  border: 1px solid color-mix(in srgb, var(--wf-color-warning) 18%, transparent);
}
.peerdock__msg--me .peerdock__bubble {
  border-radius: 16px 16px 4px 16px;
  /* 实色 --blue（原 var(--blue,·)→var(--blue-deep,·) 渐变退役；--blue 挂在 :root，无需 fallback） */
  background: var(--blue);
  color: var(--text-on-primary); border: 0;
}
.peerdock__bubble :deep(p) { margin: 0 0 6px; }
.peerdock__bubble :deep(p:last-child) { margin-bottom: 0; }
.peerdock__bubble--typing { display: inline-flex; gap: 4px; align-items: center; }
.peerdock__bubble--typing i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--faint);
  animation: learn-typing 1.2s ease-in-out infinite;
}
.peerdock__bubble--typing i:nth-child(2) { animation-delay: 0.15s; }
.peerdock__bubble--typing i:nth-child(3) { animation-delay: 0.3s; }
.peerdock__msg > small { font-size: 12px; color: var(--faint); padding: 0 2px; }
/* 小启消息元信息行：学法徽章 + 时间戳 */
.peerdock__meta {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  padding: 0 2px;
}
.peerdock__meta small { font-size: 12px; color: var(--faint); }
.peerdock__strategy {
  font-size: 12px; font-weight: 700; color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber) 25%, transparent);
  padding: 1px 7px; border-radius: var(--mk-radius-pill);
  line-height: 1.6;
}
/* 小启追问快选：轻量 chips，点一下直接发（与输入框发送等价） */
.peerdock__follows {
  display: flex; flex-direction: column; align-items: flex-start;
  gap: 6px; margin-top: 2px; padding: 0 2px; width: 100%;
}
.peerdock__follow {
  text-align: left;
  max-width: 92%; padding: 6px 11px;
  font: inherit; font-size: 12px; line-height: 1.5; color: var(--amber-ink);
  background: color-mix(in srgb, var(--surface) 82%, color-mix(in srgb, var(--amber) 35%, transparent));
  border: 1px solid color-mix(in srgb, var(--wf-color-warning) 35%, transparent); border-radius: var(--mk-radius-xl);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
[data-theme='dark'] .peerdock__follow {
  background: color-mix(in srgb, var(--amber) 8%, transparent);
  color: var(--wf-color-warning-light);
}
.peerdock__follow:hover { background: color-mix(in srgb, var(--amber) 16%, transparent); border-color: color-mix(in srgb, var(--wf-color-warning) 55%, transparent); }
.peerdock__follow:disabled { opacity: 0.5; cursor: default; }
/* AI 生成合规提示：常驻滚动区底部，不打扰对话 */
.peerdock__ai-note {
  display: flex; justify-content: center;
  padding: 2px 0 0;
}
.peerdock__ai-note :deep(.ai-note) { font-size: 12px; color: var(--faint); opacity: 0.75; }
.peerdock__input {
  display: flex; gap: 8px; padding: 10px 12px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}
.peerdock__input input {
  flex: 1; min-width: 0; padding: 8px 12px;
  font: inherit; font-size: 13px;
  border: 1px solid var(--line); border-radius: var(--mk-radius-pill);
  outline: none;
  background: var(--surface);
  color: var(--ink);
}
.peerdock__input input:focus { border-color: color-mix(in srgb, var(--wf-color-warning) 55%, transparent); box-shadow: var(--mk-focus-ring); }
.peerdock__input button {
  padding: 8px 14px; border: 0; border-radius: var(--mk-radius-pill);
  font: inherit; font-size: 12.5px; font-weight: 700;
  /* 批次 D：135deg 橙渐变（#ff9d4d→#ef7d1f）→ 纯色 #d97706。
   为什么不是 --wf-color-efficient-dark：规范橙族的两个档对白字只有
   2.19:1 / 2.82:1，均不足 AA；#d97706 是同色相下唯一达 4.52:1 的实底色。
   按钮文字 12.5px/700 属小字，必须按 AA 正文 4.5:1 判，不能按大字 3:1 放行。
   这是一处**规范缺口**：--wf-color-efficient 族缺一档「可配白字的实底色」。
   已登记待体系包补档，补后此处改回令牌引用。 */
  color: #fff; background: #d97706;
  cursor: pointer;
  transition: filter 0.15s ease;
}
.peerdock__input button:hover:not(:disabled) { filter: brightness(1.05); }
.peerdock__input button:disabled { opacity: 0.45; cursor: default; }
/* 小启悬浮球：暖橙 Q（区别于导师品牌蓝紫） */
.peerfab {
  position: fixed; right: 22px; bottom: 22px; z-index: 59;
  width: 52px; height: 52px; border: 0; border-radius: 50%;
  background: #d97706;   /* 批次 D：135deg 橙渐变 → 纯色（白字 4.52:1，AA） */
  /* 原 0 14px 32px rgba(239,125,31,.4) 橙色发光改为 overlay 中性档：
     FAB 常驻压在滚动内容之上，确实需要抬升才能读出来，这是规范允许的例外；
     但颜色必须中性，彩色光晕一律不行。 */
  box-shadow: var(--wf-shadow-overlay);
  display: grid; place-items: center; cursor: pointer;
  transition: transform 0.18s ease;
}
/* hover 不再抬升也不换投影（两态已无差别），按压反馈留给 :active */
.peerfab:active { transform: scale(0.98); }
.peerfab__q {
  color: #fff; font-size: 26px; font-weight: 800; font-style: italic;
  font-family: Georgia, 'Times New Roman', serif;
  line-height: 1;
}
.peerfab__dot {
  position: absolute; top: 1px; right: 1px;
  width: 13px; height: 13px; border-radius: 50%;
  background: var(--red); border: 2px solid #fff;
}
@media (max-width: 640px) {
  /* 小启整体抬到 composer 上方（composer ≈90px 高）——此前 fab bottom:14 正压在发送键上、
     dock 展开盖住整个输入区（2026-09-26 用户：「挡住了发送按钮」）；面板限高收一档 */
  .peerdock { right: 12px; left: 12px; bottom: 104px; width: auto; max-height: 52dvh; }
  .peerfab { right: 14px; bottom: 104px; width: 44px; height: 44px; }
  .peerfab__q { font-size: 20px; }
}
/* 窄屏（平板/小窗）：dock 收窄并抬高，避免与底部输入区重叠（长消息上探场景） */
@media (min-width: 641px) and (max-width: 1100px) {
  .peerdock { width: min(300px, calc(100vw - 24px)); right: 12px; bottom: 140px; max-height: 380px; }
}
.msg__code {
  margin: 8px 0 0;
  background: #182338;
  color: #d6e4ff;
  border-radius: var(--mk-radius-lg);
  padding: 12px 14px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12.5px; line-height: 1.6;
  overflow-x: auto;
}
.msg__bubble--typing { display: inline-flex; gap: 5px; align-items: center; padding: 14px 16px; }
.msg__bubble--typing i {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--faint);
  animation: learn-typing 1.2s ease-in-out infinite;
}
.msg__bubble--typing i:nth-child(2) { animation-delay: .15s; }
.msg__bubble--typing i:nth-child(3) { animation-delay: .3s; }
@keyframes learn-typing { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

/* ---------- 知识点操作 ---------- */
.kp-actions {
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 96%, transparent);
  display: grid; gap: 9px;
}
.kp-actions__label { font-size: 12px; font-weight: 700; color: var(--faint); }
.kp-actions__row { display: flex; gap: 10px; flex-wrap: wrap; }
/* 自我评估二选一：掌握 ✓ 绿实心 / 未理解 ✗ 琥珀描边——语义色一眼可辨 */
.kp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 40px; padding: 0 16px;
  border-radius: var(--mk-radius-pill); border: 1px solid transparent;
  font: inherit; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: transform 0.15s ease, background 0.15s ease;
}
/* 原 .kp-btn:hover 的 translateY(-1px) 已删（hover 不得抬升），按压走 :active */
.kp-btn:active { transform: scale(0.98); }
.kp-btn__icon { font-size: 14px; line-height: 1; }
.kp-btn--mastered {
  color: #fff;
  /* 批次 D：135deg 绿渐变 → 纯色 #15803d。
     不用 --wf-color-success-dark（#28965a，白字 3.75:1 不足 AA）：
     #15803d 对白字 6.13:1 达标，且它就是本仓既有的 --mk-green / --mk-green-fill
     实心绿档（白底文字基线 5.0:1 的那一族），不是新造的颜色。
     掌握态是实心绿本身够醒目，不需要外发光。 */
  background: var(--mk-green-fill);
}
.kp-btn--retry {
  color: var(--amber);
  background: color-mix(in srgb, var(--amber) 10%, transparent);
  border-color: color-mix(in srgb, var(--amber) 32%, transparent);
}
.kp-btn--retry:hover { background: color-mix(in srgb, var(--amber) 18%, transparent); }

/* 动态确认（teaching-turn 输出 confirmCheck）：行动台式卡片按钮，与开场行动台同语言（白卡/蓝主色） */
.kp-actions--dynamic {
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 96%, transparent);
}
.kp-actions__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 0 2px 9px; }
.kp-actions__kicker { font-size: 12px; font-weight: 800; letter-spacing: 0.04em; color: var(--blue-deep); }
.kp-actions__row--stack { display: grid; grid-template-columns: 1fr; gap: 7px; }
.kp-act {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border-radius: 12px; /* 圆角阶梯：面板 */
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  font: inherit; font-size: 13px; font-weight: 600; line-height: 1.4;
  cursor: pointer;
  transition: border-color 0.16s ease, transform 0.12s ease, box-shadow 0.16s ease;
}
.kp-act__mark {
  flex: 0 0 auto;
  display: grid; place-items: center;
  width: 22px; height: 22px;
  /* 22px 图标底：7px 圆角是档外值（规范最小档 6px），→ --wf-radius-sm；
   批次 D 另把 135deg 绿/橙渐变改为平涂，底色选对白字达 AA 的一档：
   ok #15803d（6.13:1）/ retry #d97706（4.52:1）。
   原渐变起点 --green(#15803d) 与 --amber(#f4aa46) 对白字只有 5.0:1 / 1.97:1，
   后者不达标——22px 方块里的 12px 字按正文标准判。 */
  border-radius: var(--wf-radius-sm);
  font-size: 12px; font-weight: 800;
  color: #fff; /* on-fill 白字：--mk-green-fill/--wf 实底橙族暂无配白令牌（规范缺口 §7.5.2） */
}
.kp-act--ok .kp-act__mark { background: var(--mk-green-fill); }
.kp-act--retry .kp-act__mark { background: #d97706; /* 规范缺口：待 --wf-color-*-fill 补档（§7.5.2 登记） */ }
.kp-act__text { flex: 1; min-width: 0; }
.kp-act__go {
  flex: 0 0 auto;
  color: var(--faint);
  font-weight: 800;
  transition: transform 0.15s ease, color 0.15s ease;
}
.kp-act:hover {
  border-color: color-mix(in srgb, var(--blue) 40%, transparent);
  /* 中性抬升（raised 档）替代原 rgba(23,32,51,.08) 自定义值；抬升的 translateY(-1px) 已删 */
  box-shadow: var(--wf-shadow-raised);
}
.kp-act:hover .kp-act__go { color: var(--blue); transform: translateX(2px); }
.kp-act:active { transform: scale(0.99); }
/* 暗色：底/描边已令牌化（raised 档自动翻转），原逐条字面量覆写退役 */

/* ---------- 检查点（原型 .wf-checkpoint：紫框卡 + 11.5px 标签 + 44px 选项 + 对/错态） ---------- */
.checkpoint {
  margin: 0 14px;
  padding: 13px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 26%, transparent);
  background: color-mix(in srgb, var(--accent) 5%, var(--surface));
  border-radius: var(--mk-radius-modal);
  display: grid; gap: 8px;
}
.checkpoint__head { display: grid; gap: 6px; }
.checkpoint__head strong { font-size: 13.5px; line-height: 1.5; }
.checkpoint__head code { background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-deep); padding: 1px 6px; border-radius: var(--mk-radius-sm); font-size: 12.5px; }
/* 标签是纯文字（原型 .wf-checkpoint__label 不做胶囊），紫字 + 字距 */
.checkpoint__badge {
  width: fit-content;
  font-size: 12px; font-weight: 800; letter-spacing: .05em;
  color: var(--purple-ink);
  padding: 0; border: 0; background: none;
}
.checkpoint__input {
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-lg);
  padding: 10px 12px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  resize: none; outline: none;
  background: var(--surface);
}
.checkpoint__input:focus { border-color: color-mix(in srgb, var(--blue) 50%, transparent); }
.checkpoint__actions { display: flex; gap: 10px; }

/* ---------- 完课入口 ----------
   整宽 .lesson-cta（原型 #wfFinishLesson：快捷回复之后、输入条之前）2026-10-06 退役：
   与 ⋯ 菜单「完成并结算任务」重复，且压在输入流上方。完课入口现只在 ⋯ 菜单里。 */

/* ---------- 输入区（对齐原型 .wf-composer：760 居中收纳盒 + focus-within 光环） ---------- */
.composer {
  display: grid; gap: 6px; justify-items: center;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 96%, transparent);
}
.composer__box {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  max-width: 760px;
  min-height: 54px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 6px 6px 6px 16px;
  /* 原 0 6px 20px color-mix(in srgb, var(--ink) 6%, transparent) 是墨色染色投影
     （暗色下会翻成发光），按三档中性档改用 raised 档。 */
  box-shadow: var(--wf-shadow-raised);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
/* 聚焦：柔和提示 —— 细蓝边 + 全站唯一一圈（替代原按内容切换的整圈硬蓝边） */
.composer__box:focus-within {
  border-color: color-mix(in srgb, var(--blue) 55%, transparent);
  box-shadow: var(--mk-focus-ring);
}
.composer__textarea {
  flex: 1; border: 0; outline: none; resize: none;
  font: inherit; font-size: 14px; line-height: 1.5;
  color: var(--ink); background: transparent;
  padding: 7px 0; max-height: 120px; align-self: center;
}
.composer__count { font-size: 12px; color: var(--faint); align-self: center; font-variant-numeric: tabular-nums; }
.composer__send {
  width: 42px; height: 42px; border-radius: 12px; /* 原型 .wf-composer__send 42×42/r12，与 54px 盒的内高对齐 */
  display: grid; place-items: center;
  /* 实色 --blue（蓝渐变与 28% 发光一并退役） */
  background: var(--blue);
  color: var(--text-on-primary); cursor: pointer;
  flex: 0 0 auto;
  transition: background 0.15s ease, transform 0.15s ease;
}
.composer__send:active { transform: scale(0.98); }
.composer__send--off { background: var(--mk-surface-2); color: var(--faint); cursor: default; }
/* 生成中：同一按钮切换为红色停止态（主流聊天交互，替代原独立 stop-btn）。
   批次 D：红色 28%/36% 两档发光与 135deg 渐变底一并退役 → 纯色危险档。
   取 --wf-color-danger-dark（#d95054）：规范的危险色 #ef757e 对白字仅 3.2:1
   不足 AA，深一档 4.6:1 达标。停止键靠「更深」而非「更亮」表达。 */
.composer__send--stop {
  background: var(--wf-color-danger-dark);
}
.composer__send--stop:hover {
  background: var(--wf-color-danger);
}
.composer__send--stop:active { transform: scale(0.97); }
.composer__hint {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 12px; flex-wrap: wrap;
  width: min(100%, 760px);
  font-size: 12px; line-height: 1.5; color: var(--faint);
}
.composer__hint :deep(.ai-note) {
  font-size: 12px; line-height: 1.5;
}
.composer__hint--single { justify-content: flex-end; }
.composer__hint-note { flex: 0 0 auto; } /* flex:1 会撑满整行、把 flex-end 废掉——快捷键要与 AI 声明并排贴右 */
/* 键盘提示只在有键盘的档位出现（原型 .wf-composer__hint 同款 ≥1024 才显示） */
@media (max-width: 1023px) {
  .composer__hint > .composer__hint-note { display: none; }
}

.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 20px; border-radius: var(--mk-radius-xl);
  /* 实色主按钮：蓝渐变 + 30% 蓝色发光投影一并退役 */
  background: var(--blue);
  color: var(--text-on-primary); font-size: 13.5px; font-weight: 700;
  cursor: pointer; text-decoration: none;
  transition: transform 0.16s ease, background 0.16s ease;
}
.btn-primary:not(:disabled):active { transform: scale(0.98); }
.btn-primary--off { opacity: .55; cursor: default; }
.btn-ghost {
  padding: 9px 16px; border-radius: var(--mk-radius-xl);
  border: 1px solid var(--line); background: var(--surface);
  font-size: 13.5px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}

/* ---------- 完成浮层 ---------- */
.finish {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  padding: 24px;
  /* 批次 D（2026-10-02）：backdrop-filter: blur(2px) 已删，规范材质一律平面。
     遮罩走 var(--canvas) 混色：亮色下浅纱、暗色下暗纱，随主题自动翻转
     （等价原 rgba(244,247,252,.72) / 暗色 rgba(15,22,32,.78) 双写字面量）。 */
  background: color-mix(in srgb, var(--canvas) 76%, transparent);
  z-index: 5;
}
.finish__card {
  width: min(480px, 100%);
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--wf-color-success) 30%, transparent);
  border-radius: 16px; /* 圆角阶梯：弹层 */
  box-shadow: var(--mk-shadow-modal); /* 模态档 */
  padding: 28px;
  display: grid; gap: 14px; justify-items: center; text-align: center;
}
.finish__ring {
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--wf-color-success-bg);
  color: var(--green);
  display: grid; place-items: center;
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--wf-color-success) 7%, transparent);
}
.finish__card h2 { margin: 0; font-size: 20px; }
.finish__card p { margin: 0; font-size: 13.5px; color: var(--muted); line-height: 1.7; }
.finish__stats { display: flex; gap: 18px; font-size: 12px; color: var(--muted); }
.finish__stats b { color: var(--ink); font-size: 15px; margin-right: 3px; }
.finish__actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }

/* 沉浸学习页无底部导航：v2.css 的移动端 .v2-page { padding-bottom: calc(72px + env()) }
   对本页是纯空白，901~1100 段此前漏覆盖（底部 72px 死空间），提到 ≤1100 统一清零。 */
@media (max-width: 1100px) {
  .learn { padding-bottom: 0; }
}

@media (max-width: 900px) {
  /* 锁定视口高度：整页不滚动，tutor 内部滚动、composer 吸底，消除底部空白。
     flex-grow:0 必须显式置零——.v2-page 全局 flex:1 会把 height:100dvh 拉伸到内容高度。 */
  .learn { height: calc(100dvh / var(--vp-zoom, 1)); min-height: 0; flex: 0 0 auto; padding-bottom: 0; }
  .learn__body {
    flex: 1;
    min-height: 0;
    padding: 8px 10px 10px;
    gap: 10px;
  }
  .learn__back { display: none; }
  /* 移动端 tutor 撑满可用高度：聊天区内部滚动、composer 吸底，消除滚动到底的底部空白 */
  .tutor { max-height: none; min-height: 0; flex: 1 1 auto; }
  /* overscroll-behavior:contain 隔断滚动链——消息列表滚到边缘时不再触发整页橡皮筋
     （本页 height:100dvh 不随文档滚动，iOS 上链式滚动会带动整页回弹） */
  .tutor__scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  /* iOS Safari 聚焦 <16px 的输入框会触发视口自动放大，打完字还要 pinch 收回——移动端提到 16px。 */
  .composer__textarea { font-size: 16px; padding: 6px 0; }
  /* 占位符压到 15px（2026-09-26 用户：「随时提问这几个字非常的大」）：textarea 本身必须
     留 16px 防 iOS 聚焦缩放，只能压 placeholder——与目标对话页同款口径。 */
  .composer__textarea::placeholder { font-size: 15px; }
  .composer__attach { margin-top: 4px; }
  .composer__send { width: 44px; height: 44px; } /* 触屏 hit area 44（原型桌面 42） */
  /* 触屏没有键盘快捷键提示：这行是「Enter 发送 · Shift+Enter 换行」+ AI 声明，不隐藏的话两者
     在 340px 里折成两行（hint 行 17→33px）。隐藏后只剩声明，居中与入口页 .goal__ai-note 一致。 */
  .composer__hint > .composer__hint-note { display: none; }
  .composer__hint { flex-wrap: nowrap; justify-content: center; }
  /* 移动端头部：单行紧凑 —— 返回隐藏、标题占主列可截断，右侧「学习中」+「⋯」同行，不再换行占第二行 */
  .learn__head {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto;
    gap: 0 10px;
    padding: 8px 14px;
  }
  .learn__title { grid-column: 1; grid-row: 1; min-width: 0; }
  .learn__title strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .learn__title small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .learn__head-right { grid-column: 2; grid-row: 1; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .learn__live, .learn__state-link { white-space: nowrap; flex-shrink: 0; }
  .learn__live { font-size: 12px; }
  /* 窄屏头部三件套（知识点入口 / 连接态 / ⋯）：入口与状态压到最小占位，⋯ 保持 44 触区 */
  .learn__kpbtn { padding: 4px 9px; }
  /* ⋯ 菜单（ImmersiveMenu）：弹层宽度在窄屏收敛到视口内 */
  .learn__head-right :deep(.imm-menu__pop) { width: min(250px, calc(100vw - 28px)); }
  /* 头部三行（「当前任务」标签 / 任务名 / 路径名）在手机上白占 22px——标签本身只是分类提示，
     去掉后头部 79→57px，全部还给消息区 */
  .learn__title { gap: 1px; }
  /* 消息区贴底（窄屏专属）：首个子项吃满剩余空间，短会话下最新一条与下方快捷块/检查点
     紧贴输入框——手机上的视线与拇指都不用上下跑。桌面不适用：对话要从上往下长。 */
  .tutor__scroll > :first-child { margin-top: auto; }
  /* 快捷块瘦身见文件末尾的媒体块：.replies/.reply 的基础规则在本文件靠后的 style 块里，
     同权重下写在这里会被覆盖 */
  /* 弹窗锚定在 ⋯ 按钮正下方、右对齐按钮 */
}
</style>

<style scoped>
/* logo 头像 */
.msg__avatar {
  background: var(--surface) !important;
  border: 1px solid var(--line);
  box-shadow: var(--wf-shadow-raised); /* 悬浮档 */
}
.msg__avatar img {
  width: 28px;  /* 24→28：与 goal 页同款，logo 更凸显（2026-09-27 用户反馈） */
  height: 28px;
  object-fit: contain;
}
</style>

<style scoped>
.learn__init {
  flex: 1; display: grid; place-content: center; justify-items: center; gap: 14px;
  color: var(--faint); font-size: 14px; padding: 80px 20px; text-align: center;
}
.learn__init-error { color: var(--red-ink); font-size: 14px; font-weight: 600; }
.learn__menu-group { display: grid; gap: 1px; }
.learn__menu-label {
  padding: 6px 12px 3px;
  font-size: 12px; font-weight: 800; letter-spacing: 0.06em;
  color: var(--faint);
}
.learn__menu-sep { height: 1px; background: var(--line); margin: 4px 6px; }
.learn__menu-item {
  padding: 8px 12px; border-radius: var(--mk-radius-md);
  font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; white-space: nowrap;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}
.learn__menu-item-main { display: grid; gap: 2px; }
.learn__menu-item-main strong { font-size: 13px; font-weight: 700; color: inherit; }
.learn__menu-item-main small { font-size: 12px; font-weight: 500; color: var(--faint); white-space: normal; }
.learn__menu-item:hover { background: color-mix(in srgb, var(--surface) 96%, var(--ink)); color: var(--ink); }
.learn__menu-item--primary { color: var(--blue); }
.learn__menu-item--primary:hover { background: color-mix(in srgb, var(--blue) 8%, transparent); color: var(--blue); }
.learn__menu-item--danger { color: var(--red-ink); }
.learn__menu-item--danger:hover { background: color-mix(in srgb, var(--wf-color-danger) 10%, transparent); color: var(--red-ink); }
.checkpoint__option {
  position: relative;
  display: flex; align-items: center; gap: 10px;
  min-height: 44px; padding: 10px 13px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-lg);
  font-size: 13px; color: var(--ink);
  background: var(--surface);
  cursor: pointer;
  transition: border-color .14s ease, background .14s ease, color .14s ease;
}
.checkpoint__option:hover { border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.checkpoint__option:focus-within { outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
/* 原生 radio/checkbox 保留在 DOM（a11y + 测试），视觉交给字母方块 */
.checkpoint__option input {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  margin: 0; opacity: 0; cursor: inherit;
}
.checkpoint__key {
  flex: 0 0 auto;
  display: grid; place-items: center;
  width: 22px; height: 22px;
  border-radius: 6px;
  font-size: 12px; font-weight: 800; line-height: 1;
  color: var(--purple-ink);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
}
.checkpoint__text { flex: 1; min-width: 0; line-height: 1.5; }
.checkpoint__option--on {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}
.checkpoint__option--on .checkpoint__key { background: var(--accent); border-color: transparent; color: #fff; /* on-accent 白字：紫族暂无配白令牌，登记规范缺口 */ }
/* 裁决落地：被选中的那项标绿 / 标红（原型 .is-correct / .is-wrong） */
.checkpoint__option--ok {
  border-color: var(--green);
  background: color-mix(in srgb, var(--green) 9%, var(--surface));
  color: var(--green-ink); font-weight: 700;
}
.checkpoint__option--wrong {
  border-color: var(--red);
  background: color-mix(in srgb, var(--red) 9%, var(--surface));
  color: var(--red-ink); font-weight: 700;
}
.checkpoint__option--ok .checkpoint__key,
.checkpoint__option--wrong .checkpoint__key { background: color-mix(in srgb, currentColor 16%, transparent); border-color: transparent; color: inherit; }
.checkpoint__option--lock { cursor: default; opacity: .92; }
.checkpoint__feedback {
  font-size: 13px; font-weight: 600; color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber) 10%, transparent);
  border-radius: var(--mk-radius-lg); padding: 9px 12px;
}
.checkpoint__feedback--ok { color: var(--green-ink); background: var(--wf-color-success-bg); }
.msg__retry { margin-left: 8px; color: var(--red-ink); font-weight: 800; text-decoration: underline; cursor: pointer; border: 0; background: none; padding: 0; font: inherit; }
.msg__bubble--html :deep(p) { margin: 0 0 8px; }
.msg__bubble--html :deep(p:last-child) { margin-bottom: 0; }
.msg__bubble--html :deep(ul), .msg__bubble--html :deep(ol) { margin: 4px 0; padding-left: 18px; }
.msg__bubble--html :deep(code) {
  background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-deep);
  padding: 1px 6px; border-radius: var(--mk-radius-sm); font-size: 12.5px;
}
/* ---------- 代码面板（原型 .wf-code） ----------
   恒深不随主题切换：底/字/描边与 --tok-* 逐值搬运自原型 :root（任务清单第 1 条要求与原型
   同款调色板，故这组十六进制是原型 token 的等价搬运，不改用主题 token，避免暗色下换底）。 */
.msg__bubble--html {
  --code-bg: #1c2233;
  --code-fg: #e8eefc;
  --code-head: color-mix(in srgb, #ffffff 7%, transparent);
  --tok-kw: #c792ea;
  --tok-fn: #82aaff;
  --tok-str: #c3e88d;
  --tok-num: #f78c6c;
  --tok-var: #e8eefc;
  --tok-comment: #7b8399;
}
.msg__bubble--html :deep(pre) {
  margin: 0;
  background: var(--code-bg);
  color: var(--code-fg);
  border-radius: 4px; padding: 10px 12px; /* 圆角阶梯：代码块 = 内芯档 */
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px; line-height: 1.7;
  overflow-x: auto; white-space: pre; tab-size: 2;
}
.msg__bubble--html :deep(pre code) { background: transparent; color: inherit; padding: 0; font-size: inherit; }
/* 深色下内联 code 的蓝底规则会盖过上面那条（选择器多一层属性）：面板内再钉一次 */
.msg__bubble--html :deep(.codeblock pre code) { background: transparent; color: inherit; padding: 0; font-size: inherit; }
/* 装饰壳：语言头 + 复制键（由 decorateCodeBlocks 包出来，见 <script>） */
.msg__bubble--html :deep(.codeblock) {
  margin: 10px 0 0;
  border-radius: 4px; /* 圆角阶梯：代码块 = 内芯档 */
  overflow: hidden;
  background: var(--code-bg);
  color: var(--code-fg);
  border: 1px solid color-mix(in srgb, #ffffff 8%, transparent);
}
.msg__bubble--html :deep(.codeblock pre) { margin: 0; border-radius: 0; border: 0; }
.msg__bubble--html :deep(.codeblock__head) {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 4px 6px 4px 11px;
  background: var(--code-head);
  /* font 简写：与原型 .wf-code__head 同款 600/12px 头条字（含语言名与复制键；11px 已收口到 12 下限） */
  font: 600 12px/1.4 "PingFang SC", "Microsoft YaHei", Inter, system-ui, sans-serif;
  letter-spacing: .03em;
  color: color-mix(in srgb, #ffffff 60%, transparent);
}
.msg__bubble--html :deep(.codeblock__lang) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg__bubble--html :deep(.codeblock__copy) {
  border: 0; background: none; cursor: pointer; color: inherit;
  font: 600 12px/1 "PingFang SC", "Microsoft YaHei", Inter, system-ui, sans-serif;
  padding: 5px 8px; border-radius: 6px; min-height: 26px;
  transition: background .14s ease, color .14s ease;
}
.msg__bubble--html :deep(.codeblock__copy:hover) { background: color-mix(in srgb, #ffffff 12%, transparent); color: #fff; }
/* 语法高亮 token（highlight.js 类名 → 原型 --tok-* 四色） */
.msg__bubble--html :deep(.hljs-keyword),
.msg__bubble--html :deep(.hljs-selector-tag),
.msg__bubble--html :deep(.hljs-literal),
.msg__bubble--html :deep(.hljs-type),
.msg__bubble--html :deep(.hljs-doctag),
.msg__bubble--html :deep(.hljs-name) { color: var(--tok-kw); }
.msg__bubble--html :deep(.hljs-built_in),
.msg__bubble--html :deep(.hljs-title),
.msg__bubble--html :deep(.hljs-title.class_),
.msg__bubble--html :deep(.hljs-title.function_),
.msg__bubble--html :deep(.hljs-section),
.msg__bubble--html :deep(.hljs-selector-class),
.msg__bubble--html :deep(.hljs-selector-id),
.msg__bubble--html :deep(.hljs-attr),
.msg__bubble--html :deep(.hljs-attribute),
.msg__bubble--html :deep(.hljs-property),
.msg__bubble--html :deep(.hljs-variable),
.msg__bubble--html :deep(.hljs-template-variable),
.msg__bubble--html :deep(.hljs-params) { color: var(--tok-fn); }
.msg__bubble--html :deep(.hljs-string),
.msg__bubble--html :deep(.hljs-addition),
.msg__bubble--html :deep(.hljs-regexp),
.msg__bubble--html :deep(.hljs-meta .hljs-string) { color: var(--tok-str); }
.msg__bubble--html :deep(.hljs-number),
.msg__bubble--html :deep(.hljs-symbol),
.msg__bubble--html :deep(.hljs-bullet),
.msg__bubble--html :deep(.hljs-link),
.msg__bubble--html :deep(.hljs-meta) { color: var(--tok-num); }
.msg__bubble--html :deep(.hljs-comment),
.msg__bubble--html :deep(.hljs-quote) { color: var(--tok-comment); font-style: italic; }
.msg__bubble--html :deep(.hljs-emphasis) { font-style: italic; }
.msg__bubble--html :deep(.hljs-strong) { font-weight: 700; }
/* MessageActions 定位容器 */
.msg__content--actions { position: relative; }
/* meta 行与操作条同行（左 meta / 右操作条），配合组件的 visibility 占位隐藏：
   hover 出现/消失时布局零跳动 */
.msg__content--actions {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-auto-flow: dense;
}
.msg__content--actions > .msg__bubble,
.msg__content--actions > .msg__replies { grid-column: 1 / -1; }
.msg__content--actions > .msg-actions {
  grid-column: 2;
  align-self: center;
  margin-top: 0;
}
.msg__content--actions > .msg__meta { grid-column: 1; align-self: center; }

.msg__bubble--relative { position: relative; }

.typing-fade-enter-active { transition: opacity 0.2s ease; }
.typing-fade-leave-active { transition: opacity 0.12s ease; }
.typing-fade-enter-from,
.typing-fade-leave-to { opacity: 0; }

/* ---------- 快捷回复（原型 .wf-replies：裸按钮列表，无白面板、无面板头） ---------- */
.replies {
  display: flex; flex-direction: column; gap: 8px;
  margin: 4px 14px 0;
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
}
/* 面板头（kicker/hint）已随模板降级为 .visually-hidden 的读屏文本，样式只保底 */
.replies__kicker {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--blue-deep);
}
.replies__hint { font-size: 12px; color: var(--faint); }
/* 开场引导（opening.question 收进面板）：一行可选的小字，想回答就打字，不答可直接选动作 */
.replies__question {
  margin: 0 2px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  border: 1px dashed color-mix(in srgb, var(--blue) 30%, transparent);
  border-radius: 8px; /* 圆角阶梯：控件 */
}
/* 暗色：底/字已令牌化自动翻转，原字面量覆写退役 */
.replies__row { display: flex; flex-direction: column; gap: 8px; }
.reply {
  display: flex; align-items: flex-start; gap: 9px;
  width: 100%;
  min-height: 44px;
  text-align: left;
  padding: 11px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--blue) 28%, transparent);
  background: color-mix(in srgb, var(--blue) 5%, transparent);
  color: var(--blue-deep);
  font: inherit; font-size: 14px; font-weight: 600; line-height: 1.45;
  cursor: pointer;
  transition: background .14s ease, border-color .14s ease;
}
/* 原型的蓝点前缀：纯文本按钮 + ::before 圆点，不再带序号方块与箭头 */
.reply::before {
  content: ""; flex: none;
  width: 6px; height: 6px;
  margin-top: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--blue) 55%, transparent);
}
.reply__text { flex: 1; min-width: 0; }
.reply:hover {
  background: color-mix(in srgb, var(--blue) 11%, transparent);
  border-color: color-mix(in srgb, var(--blue) 46%, transparent);
}
.reply:active { transform: none; }
.reply:disabled { cursor: default; opacity: .55; }
</style>

<style scoped>
/* 开课准备/失败：整页居中大卡片，避免窄条感 */
.learn__stage {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 40px 24px;
}
.stage-card {
  width: min(560px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px; /* 圆角阶梯：卡片 */
  box-shadow: var(--wf-shadow-raised); /* 悬浮档（原双层自写投影换档） */
  padding: 36px 32px;
  display: grid;
  justify-items: center;
  gap: 14px;
  text-align: center;
}
.stage-card h2 { margin: 0; font-size: 20px; }
.stage-card p { margin: 0; font-size: 13.5px; color: var(--muted); line-height: 1.7; max-width: 44ch; }
.stage-card__warn {
  width: 44px; height: 44px; border-radius: 50%;
  background: color-mix(in srgb, var(--amber) 14%, transparent);
  color: var(--amber-ink);
  font-size: 22px; font-weight: 800;
  display: grid; place-items: center;
  border: 1px solid color-mix(in srgb, var(--amber) 35%, transparent);
}
.stage-card__skeleton { display: grid; gap: 8px; width: 100%; margin-top: 6px; }
.stage-card__skeleton i {
  height: 12px; border-radius: var(--mk-radius-sm);
  /* mk token 双主题自动跟随（旧字面量 #edf1f8/#f7faff 在深色下是一块刺眼的亮条） */
  background: linear-gradient(90deg, var(--mk-surface-2) 25%, var(--surface) 50%, var(--mk-surface-2) 75%);
  background-size: 200% 100%;
  animation: stage-shimmer 1.4s ease infinite;
}
@keyframes stage-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.stage-card__actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
</style>

<style scoped>
/* 暗色模式适配 */
[data-theme='dark'] .msg__bubble {
  background: color-mix(in srgb, var(--surface) 72%, var(--blue) 4%);
  color: var(--ink);
}
[data-theme='dark'] .msg--ai .msg__bubble b,
[data-theme='dark'] .msg--ai .msg__bubble strong {
  color: var(--blue-deep);
}
[data-theme='dark'] .msg__bubble--html :deep(code) {
  background: color-mix(in srgb, var(--blue) 15%, transparent);
  color: var(--blue-deep);
}
/* 代码面板恒深（原型 --code-bg 不随主题切换），深色下不再单独换底：见本文件代码面板块 */
/* 暗色下头像/悬浮钮/菜单的底与描边已令牌化自动翻转；阴影走令牌暗色档，字面量影退役 */
[data-theme='dark'] .kp-bar {
  background: var(--surface);
  border-color: var(--line);
}
/* kp__bar 轨道已引 var(--bar-track)、send--off 已引 var(--mk-surface-2)、menu hover 已 color-mix：
   均随主题自动翻转，暗色字面量覆写退役 */
</style>

<style scoped>
/* 移动端收尾（必须放在文件最后：.replies / .reply 的基础规则在本文件靠后的 style 块里，
   同权重下先出现的会被覆盖）。原型快捷回复没有移动端变体，这里只收紧间距与外边距，
   不再给它套白面板（基础规则已是裸按钮列表）。 */
@media (max-width: 900px) {
  .replies { margin: 4px 14px 0; }
  .replies__question { margin-bottom: 2px; padding: 6px 9px; font-size: 12px; }
  .replies__row { gap: 6px; }
  .reply { padding: 9px 12px; }
}
</style>

<style scoped>
/* ===== 移动端密度（2026-09-24）=====
   判据：卡片内边距 12–16px、弹层 16–20px、整页留白 ≤40px、移动端规则不写 <12px。
   实测 390 下：.oscene 16×18（开场卡）、.learn__live 10.5px（桌面 11px，移动块自己压低了）。
   其余几块只在对应状态下出现（开课准备 .stage-card 36×32、完成浮层 .finish__card 28、
   初始化 .learn__init 80×20），登录态巡检量不到，按基线推导。
   放在文件末尾：同权重下后出现者胜。 */
@media (max-width: 900px) {
  .stage-card { padding: 24px 18px; border-radius: var(--mk-radius-modal); }
  /* 状态卡标题收档：占位卡/完成卡是页级标题 → 18px 档；续读卡是卡内标题 → 14px 档
     （2026-09-24 课堂移动端走查；.stage-card__warn 的「!」是装饰字形不动） */
  .stage-card h2 { font-size: 18px; }
  .finish__card h2 { font-size: 18px; }
  .oscene__title { font-size: 14px; }
  .learn__stage { padding: 28px 16px; }
  .finish { padding: 16px; }
  .finish__card { padding: 20px; border-radius: var(--mk-radius-modal); }
  .learn__init { padding: 48px 16px; }
  .tutor__scroll { padding: 14px; }
  .oscene { padding: 12px 14px; }
  .learn__live { font-size: 12px; }
  /* 续课卡三按钮收小（2026-09-26 用户「从这继续/重新开始/先看看按钮还很大」）：
     卡内选项按触诊分级取紧凑档——主 40 / 次 36（非页级主 CTA，不占 44）；
     align-items:center 防 flex stretch 把次钮拉到与主钮同高 */
  .oscene__actions { align-items: center; }
  .oscene__actions .btn-primary { padding: 8px 15px; font-size: 13px; min-height: 40px; }
  .oscene__actions .btn-ghost { padding: 5px 12px; min-height: 36px; }
}
</style>

<style scoped>
/* ===== 课堂布局重排（2026-09-28 对齐真源原型 newui/用户侧/index.html 学习屏）=====
   单列 880：.learn__body 不再是 280+1fr 双列网格 —— 原型 .wf-screen 没有侧栏，
   知识点由常驻列降级为「头部入口 + fixed 抽屉」，正文只剩进度卡 + 对话卡一列。
   1100 以下不再预留 44px kp 头部带、也不再有 absolute 下拉面板（见下）。 */
@media (max-width: 900px) {
  /* 知识点已是 fixed 抽屉（头部「知识点 N/M」开合）：对话卡不再预留 44px 头部带，
     展开态也不再需要 absolute 下拉面板 —— 抽屉自带滚动与遮罩。 */
  .lessonbar { padding: 12px 14px; }
  .composer { gap: 4px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); }
}

/* 桌面阅读宽度：>1100（全局列宽收窄不生效的区段）把消息/卡片限在 ~760px 居中，
   1440 下一行 70-80 字太宽，65-75 字符/行才可扫读（2026-09-26 布局建议批10）。
   移动端 ≤1100 由 v2.css 列宽收窄覆盖，不受影响。 */
@media (min-width: 1101px) {
  .tutor__scroll > * { max-width: 760px; width: 100%; margin-left: auto; margin-right: auto; }
  .composer__box { max-width: 760px; width: 100%; margin-left: auto; margin-right: auto; }
  /* 滚动区之外的「行动台」同属这一列内容，必须与消息同宽：它们不是 .tutor__scroll 的孩子，
     拿不到上面那条 760 上限——Chromium 实测（1920 视口 / tutor 1260px）检查点铺满
     1226px、快捷引导同样 1226px，而消息列和输入盒是 760px：同一个聊天卡里两套宽度
     （2026-09-28 用户「检查点面板超宽，是整个聊天区宽度」）。
     开场卡/续课条/快捷引导/检查点都是卡片，直接收窄居中；行动台是通栏分隔条（border-top +
     底色），条保持通栏、只用内边距把内容收进同一列（与 .composer 收 .composer__box 同法）。 */
  .tutor > .oscene,
  .tutor > .tutor__resume,
  .tutor > .replies,
  .tutor > .checkpoint {
    width: calc(100% - 28px);
    max-width: 760px;
    margin-left: auto;
    margin-right: auto;
  }
  .tutor > .kp-actions {
    padding-left: max(16px, calc((100% - 760px) / 2));
    padding-right: max(16px, calc((100% - 760px) / 2));
  }
}
</style>
