<template>
  <div class="goal v2-page">
    <!-- 应用导航（共享组件，带真实 AI 标识） -->
    <V2Nav />

    <!-- 未登录 -->
    <main v-if="!loggedIn" class="entry">
      <div class="login-gate">
        <img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" class="login-gate__logo" />
        <h1>登录后体验真实对话</h1>
        <p>登录后，和问流聊聊你最近想解决的事。两三分钟的对话，就能收敛出你的第一版学习计划。</p>
        <a class="btn-primary btn-primary--lg" href="/login?redirect=/goal-conversation">去登录</a>
      </div>
    </main>

    <!-- 初始态 -->
    <main v-else-if="!live.started" class="entry">
      <div class="entry__hero">
        <div class="entry__hero-text">
          <h1>从一件真实的小事开始</h1>
          <p>不用整理、不用说得很准。聊 2 分钟，问流帮你收敛出目标和第一阶段安排。</p>
        </div>
        <button v-if="live.hasSession()" type="button" class="resume" @click="doResume">
          <span class="resume__dot"></span>
          <span class="resume__body">
            <strong>继续上次的规划</strong>
            <small>{{ live.failed === 'resume' ? '恢复失败，点这里重试' : '会话已保存在本地，点这里恢复' }}</small>
          </span>
          <span class="resume__go">继续 ›</span>
        </button>
      </div>

      <!-- 最近会话（D14）：此前目标规划没有任何产品内回访入口——入口页无历史列表，
           其它页面只挂裸 /goal-conversation，深链 /goal-conversation/:id 可达但无处可点。
           本地记录最近几次会话的 id + 首句摘要，给出可点的深链回访入口。 -->
      <div v-if="recentGoals.length" class="recent">
        <span class="recent__title">最近会话</span>
        <ul class="recent__list">
          <li v-for="r in recentGoals" :key="r.id">
            <a
              :href="`/goal-conversation/${r.id}`"
              class="recent__item"
              @click.prevent="openRecentGoal(r.id)"
            >
              <span class="recent__preview">{{ r.preview }}</span>
              <span class="recent__time">{{ recentTime(r.at) }}</span>
              <span class="recent__go" aria-hidden="true">›</span>
            </a>
          </li>
        </ul>
      </div>

      <!-- stopped 与 failed 并行：主动停止不是「连接失败」，用独立文案（useGoalLive.stopped） -->
      <div v-if="live.failed === 'start' && !live.stopped" class="errorbar">
        连接失败，没能开始对话。<button type="button" class="errorbar__retry" @click="doRetry">重试</button>
      </div>
      <div v-else-if="live.stopped === 'start'" class="errorbar">
        已停止生成。<button type="button" class="errorbar__retry" @click="doRetry">重试</button>
      </div>

      <div class="entry__cards">
          <div class="entry__cards-head">
            <span class="entry__cards-title">试试这些方向</span>
            <button type="button" class="cards-nav__btn" title="换一批" aria-label="换一批" :disabled="live.sending" @click="shuffleScenes">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
          </div>
        <button v-for="c in displayScenes" :key="c.title" type="button" class="scene-card" :disabled="live.sending" :title="c.desc" @click="startWith(c.seed)">
          <span class="scene-card__icon" aria-hidden="true" :style="{ background: c.bg, color: c.ink }" v-html="c.icon"></span>
          <span class="scene-card__body">
            <strong>{{ c.title }}</strong>
          </span>
          <span class="scene-card__go" aria-hidden="true">›</span>
        </button>
      </div>

      <!-- 资料附件层：回形针内置输入框，已传资料以 chips 浮在输入框上方；输入框本身是拖放目标 -->
      <div
        class="composer composer--entry"
        @dragenter.prevent="onBoxDragEnter"
        @dragover.prevent="onBoxDragOver"
        @dragleave.prevent="onBoxDragLeave"
        @drop.prevent="onBoxDrop"
      >
        <MaterialUploadArea ref="uploadRef" @change="materialCount = $event" />
        <label class="visually-hidden" for="goal-entry-input">你想解决什么</label>
        <div class="composer__box" :class="{ 'composer__box--dropping': boxDropping }">
          <button
            type="button"
            class="composer__attach"
            aria-label="添加资料"
            title="添加资料：PDF / Word / PPT / Excel / TXT / Markdown，也可以直接拖到输入框"
            @click="uploadRef?.openPicker()"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M16.5 6v11.5a4 4 0 0 1-8 0V6a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v10.5a2.5 2.5 0 0 0 5 0V6a4 4 0 0 0-8 0v11.5a5.5 5.5 0 0 0 11 0V6z"/></svg>
            <span v-if="materialCount" class="composer__attach-count">{{ materialCount }}</span>
          </button>
          <textarea
            id="goal-entry-input"
            ref="entryInputEl"
            v-model="input"
            class="composer__textarea"
            rows="1"
            :maxlength="INPUT_MAX"
            :placeholder="entryPlaceholder"
            @input="live.meta.onInput(input.length)"
            @keydown.enter.exact.prevent="doSend"
          ></textarea>
          <span v-if="boxDropping" class="composer__drop-hint">松开上传到资料</span>
          <button
            v-if="!live.sending"
            type="button"
            class="composer__send"
            :class="{ 'composer__send--off': !input.trim() }"
            :disabled="!input.trim()"
            aria-label="发送"
            @click="doSend"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
          </button>
          <button
            v-else
            type="button"
            class="composer__send composer__send--stop"
            aria-label="停止生成"
            @click="live.stop()"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
          </button>
        </div>
        <div v-if="!isNarrow" class="composer__hint">
          <span class="composer__hint-shortcut">Enter 发送 · Shift+Enter 换行</span>
        </div>
      </div>
    </main>

    <!-- 会话态：work 只在方案弹层打开时放宽到 1180（≥1500 档），会话常态恒 880 居中 -->
    <main v-else class="work" :class="{ 'work--wide': showProposal }">
      <!-- 左：信息清单（移动端默认折叠为顶栏，点击展开；桌面端恒展开） -->
      <aside class="panel" :class="{ 'panel--collapsed': !panelExpanded }">
        <button type="button" class="panel__head" :aria-expanded="panelExpanded" @click="togglePanel">
          <strong>目标信息</strong>
          <span class="panel__count"><span class="panel__count-k">已收集</span> {{ live.filledCount }} / {{ live.totalFields }}</span>
          <span class="panel__caret" aria-hidden="true">{{ panelExpanded ? '▾' : '▸' }}</span>
        </button>
        <div class="panel__body">
          <div class="panel__bar"><i :style="{ width: (live.filledCount / live.totalFields) * 100 + '%' }"></i></div>
          <div class="panel__confidence">{{ stageLabel }}</div>

          <ul class="checklist">
            <li v-for="f in live.fields" :key="f.key" class="field" :class="[`field--${f.status}`, { 'field--fresh': f.fresh }]">
              <!-- 原型 .wf-field__mark：done = 绿 18% 浅底 + 绿字勾；未完成 = 灰空圆（无虚线内芯） -->
              <span class="field__mark">
                <svg v-if="f.status === 'done'" viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
              </span>
              <div class="field__body">
                <div class="field__label">{{ f.label }}</div>
                <div v-if="f.value" class="field__value">{{ f.value }}</div>
                <div v-else class="field__value field__value--todo">待补充</div>
              </div>
              <span v-if="f.fresh" class="field__fresh">刚收录</span>
            </li>
          </ul>

          <!-- 说明属于左侧信息面板（它描述的就是这份清单的整理机制）：
               短版贴清单底部，不做整块 tip（2026-09-27 用户反馈二改） -->
          <div class="panel__tip">信息由问流从对话中自动整理，够用时就会收敛方案。</div>
        </div>
      </aside>

      <!-- 右：聊天区 -->
      <section class="chat">
        <div class="chat__head">
          <ol class="stage-nav">
            <li class="stage-nav__item" :class="stageCls(1)"><i>1</i>澄清问题</li>
            <li class="stage-nav__item" :class="stageCls(2)"><i>2</i>确认方案</li>
            <li class="stage-nav__item" :class="stageCls(3)"><i>3</i>生成路径</li>
          </ol>
          <!-- 方案被 Esc/关闭后提供重开入口，消除「关掉就找不回」的死路 -->
          <button
            v-if="proposalDismissed && live.proposal && live.stage === 'proposing'"
            type="button"
            class="chat__show-proposal"
            @click="proposalDismissed = false"
          >查看方案</button>
          <button type="button" class="chat__clear" @click="doReset">清空重聊</button>
        </div>

        <!-- 会话态内 start 失败：错误条 + 重试（初始态 errorbar 在此视图不渲染）；
             主动停止走「已停止」分支，不误报「连接失败」 -->
        <div v-if="live.failed === 'start' && !live.stopped" class="errorbar chat__errorbar">
          连接失败，没能开始对话。<button type="button" class="errorbar__retry" @click="doRetry">重试</button>
        </div>
        <div v-else-if="live.stopped === 'start'" class="errorbar chat__errorbar">
          已停止生成。<button type="button" class="errorbar__retry" @click="doRetry">重试</button>
        </div>

        <!-- 不在整条消息流上挂 aria-live：流式重渲/每条新消息都会被读屏连播（含原始 JSON delta），
             收窄到下方等待条的 aria-live（P3） -->
        <div ref="scrollEl" class="chat__scroll" :class="{ 'chat__scroll--dim': showProposal }" @scroll.passive="onScrollPin">
          <template v-for="km in keyedMessages" :key="km.key">
            <div v-if="km.msg.role === 'user'" class="msg msg--user" :class="{ 'msg--editing': editingMsgId === km.key }">
              <!-- 编辑态：textarea 替换气泡 -->
              <div v-if="editingMsgId === km.key" class="msg__edit">
                <textarea
                  v-model="editingText"
                  class="msg__edit-input"
                  rows="2"
                  :maxlength="INPUT_MAX"
                  @keydown.enter.exact.prevent="saveEdit(km.msg)"
                  @keydown.esc="cancelEdit"
                ></textarea>
                <div class="msg__edit-actions">
                  <!-- role=button 的 span 必须同时响应 Enter 与 Space（WAI-ARIA 按钮语义） -->
                  <span class="msg__edit-save" role="button" tabindex="0" @click="saveEdit(km.msg)" @keydown.enter="saveEdit(km.msg)" @keydown.space.prevent="saveEdit(km.msg)">保存</span>
                  <span class="msg__edit-cancel" role="button" tabindex="0" @click="cancelEdit" @keydown.enter="cancelEdit" @keydown.space.prevent="cancelEdit">取消</span>
                </div>
              </div>
              <template v-else>
                <!-- 快速自测作答：不是普通对话气泡（它是确认面板里的选项回传），
                     渲染成一条紧凑记录，免得把「题目 + 选项」读成自己发的问题 -->
                <div v-if="isProbeAnswer(km.msg.content)" class="msg__probe">
                  <span class="msg__probe-tag">快速自测</span>
                  <span class="msg__probe-answer">{{ probeAnswerParts(km.msg.content).answer }}</span>
                  <span v-if="probeAnswerParts(km.msg.content).question" class="msg__probe-q" :title="probeAnswerParts(km.msg.content).question">{{ probeAnswerParts(km.msg.content).question }}</span>
                </div>
                <div v-else class="msg__bubble">{{ km.msg.content }}</div>
              </template>
              <div class="msg__meta">
                你 · {{ km.msg.time }}
                <!-- 编辑入口归 meta 行（与 AI 操作条同一语言）：不再悬浮在气泡外遮字 -->
                <button
                  v-if="!isProbeAnswer(km.msg.content) && canEditMessage(km.msg)"
                  type="button"
                  class="msg__edit-btn"
                  title="编辑这条消息"
                  aria-label="编辑这条消息"
                  @click="startEdit(km.msg, km.key)"
                ><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>
              </div>
            </div>
            <div v-else class="msg msg--ai">
              <span class="msg__avatar"><img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" /></span>
              <div class="msg__content msg__content--actions"
                @mouseenter="onBubbleEnter(km.key)"
                @mouseleave="onBubbleLeave"
              >
                <div class="msg__bubble msg__bubble--html msg__bubble--relative" v-html="messageHtml(km.msg)"></div>
                <!-- P2-14：历史轮次的快捷补充随消息渲染（当前轮由下方面板承担），点选填入输入框 -->
                <div v-if="km.msg.quickReplies?.length && km.key !== lastAiKey" class="msg__replies">
                  <button
                    v-for="q in km.msg.quickReplies"
                    :key="q.text"
                    type="button"
                    class="msg__reply"
                    :class="{ 'msg__reply--on': pickedReplySet.has(q.text.trim()) }"
                    @click="toggleReply(q.text)"
                  >{{ q.text }}</button>
                </div>
                <MessageActions
                  :show="hoveredMsgId === km.key"
                  :streaming="live.sending"
                  @regenerate="regenerateMessage(km.msg)"
                  @copy="copyMessage(km.msg.content)"
                  @feedback="(up) => sendMessageFeedback(km.msg, up)"
                />
                <div class="msg__meta">
                  问流 · {{ km.msg.time }}
                  <button v-if="km.msg.failed" type="button" class="msg__retry" @click="doRetry">重试</button>
                </div>
              </div>
            </div>
          </template>

          <!-- typing：等待首个 delta 期间 -->
          <div v-if="live.sending && !live.streamingText" class="msg msg--ai">
            <span class="msg__avatar"><img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" /></span>
            <div class="msg__content">
              <div class="msg__bubble msg__bubble--typing"><i></i><i></i><i></i></div>
              <!-- 收窄后的 live region：只播报等待文案，不再让整条消息流进读屏队列 -->
              <div class="msg__meta" aria-live="polite">{{ chatWaitText }}</div>
            </div>
          </div>

          <!-- 流式渐进渲染：SSE delta 实时累积（goal skill 为 JSON 输出，展示原始模型文本；
               final 到达后由官方消息替换，避免双泡；方案浮层打开时不重复展示，浮层内已有流式进度） -->
          <div v-if="live.sending && live.streamingText && !showProposal" class="msg msg--ai">
            <span class="msg__avatar"><img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" /></span>
            <div class="msg__content msg__content--actions">
              <div class="msg__bubble msg__bubble--html msg__bubble--streaming" v-html="formatMessage(live.streamingText)"></div>
              <div class="msg__meta">问流 · {{ chatWaitText }}</div>
            </div>
          </div>

          <!-- 快捷补充选项（skill 每轮返回）：对齐原型 .wf-replies —— 去白面板与面板头，
               改整行 .wf-reply 按钮组（蓝描边 + 蓝 5% 底 + 前置 6px 蓝点，选中变 ✓）。
               勾选语义不变：点选打勾进输入框，再点取消 -->
          <div v-if="!live.sending && live.quickReplies.length && live.stageIndex < 3" class="replies">
            <span class="visually-hidden">快捷补充：点选填入输入框，可多选</span>
            <button
              v-for="q in availableReplies"
              :key="q.text"
              type="button"
              class="reply"
              :class="{ 'reply--on': pickedReplySet.has(q.text.trim()) }"
              @click="toggleReply(q.text)"
            >{{ q.text }}</button>
          </div>
        </div>
        <!-- 输入区：对话卡内的底条（2026-10-06 归位）——回形针资料入口内置输入框，
             已传资料 chips 浮在输入框上方；输入框本身是拖放目标。
             它是 .chat 的最后一个 flex 子项（flex:0 0 auto），宽度天然等于对话列：
             与上方气泡同宽同左右缘，不再需要复刻 .work 栅格的 .composer__inner 壳。
             v-if 与 main.work 同条件：初始态/未登录态各有自己的 .composer--entry
             （两者共用 uploadRef，同时挂载会撞 ref；且会出双输入条） -->
        <div
          v-if="loggedIn && live.started"
          class="composer"
          @dragenter.prevent="onBoxDragEnter"
          @dragover.prevent="onBoxDragOver"
          @dragleave.prevent="onBoxDragLeave"
          @drop.prevent="onBoxDrop"
        >
          <MaterialUploadArea ref="uploadRef" @change="materialCount = $event" />
          <label class="visually-hidden" for="goal-chat-input">回答上面的问题，或补充你的基础、时间和限制</label>
          <div class="composer__box" :class="{ 'composer__box--dropping': boxDropping }">
            <button
              type="button"
              class="composer__attach"
              aria-label="添加资料"
              title="添加资料：PDF / Word / PPT / Excel / TXT / Markdown，也可以直接拖到输入框"
              @click="uploadRef?.openPicker()"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M16.5 6v11.5a4 4 0 0 1-8 0V6a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v10.5a2.5 2.5 0 0 0 5 0V6a4 4 0 0 0-8 0v11.5a5.5 5.5 0 0 0 11 0V6z"/></svg>
              <span v-if="materialCount" class="composer__attach-count">{{ materialCount }}</span>
            </button>
            <textarea
              id="goal-chat-input"
              ref="chatInputEl"
              v-model="input"
              class="composer__textarea"
              rows="1"
              :maxlength="INPUT_MAX"
              :placeholder="chatPlaceholder"
              @keydown.enter.exact.prevent="doSend"
            ></textarea>
            <span v-if="boxDropping" class="composer__drop-hint">松开上传到资料</span>
            <!-- 发送/停止 同位置切换：生成中变停止（主流聊天交互，位置固定不占额外空间） -->
            <button
              v-if="!live.sending"
              type="button"
              class="composer__send"
              :class="{ 'composer__send--off': !input.trim() }"
              :disabled="!input.trim()"
              aria-label="发送"
              @click="doSend"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
            </button>
            <button
              v-else
              type="button"
              class="composer__send composer__send--stop"
              aria-label="停止生成"
              @click="live.stop()"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
            </button>
          </div>
          <!-- 底部提示只承载输入元数据：快捷键、字数与 AI 声明。
               「新目标」不塞进这里：它不是输入辅助信息，而是离开当前会话的导航动作；
               移动端点击底部「目标规划」会进入无参路由，route.params watcher 负责回到初始态，
               并保留「继续上次的规划」恢复入口。 -->
          <div class="composer__hint">
            <span class="composer__hint-right">
              <span class="composer__hint-shortcut">Enter 发送 · Shift+Enter 换行</span>
              <span class="composer__count">{{ input.length }} / {{ INPUT_MAX }}</span>
              <AiContentNote />
            </span>
          </div>
        </div>
      </section>
    </main>


    <!-- 方案确认浮层：dialog 语义 + 打开时移焦/关闭归还（onProposalKey/watch showProposal） -->
    <div
      v-if="showProposal"
      ref="overlayRef"
      class="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="方案确认"
      tabindex="-1"
      @click.self="onOverlayBackdrop"
    >
      <!-- 预览：对齐原型 dialog 三段 —— head（eyebrow + 标题 + 关关闭 ×）/
           body（rows + 大纲 + 自测 + 提示）/ 贴底 foot（ghost「再补充」+ primary「确认」） -->
      <div v-if="phase === 'preview' && live.proposal" class="proposal">
        <div class="proposal__head">
          <div class="proposal__head-text">
            <span class="proposal__eyebrow">路径预览 · 请确认</span>
            <h2 class="proposal__title">为你整理的学习方向</h2>
          </div>
          <button
            type="button"
            class="proposal__x"
            aria-label="关闭方案确认"
            title="关闭（Esc 可随时关闭）"
            @click="proposalDismissed = true"
          >×</button>
        </div>

        <div class="proposal__body">
        <div class="proposal__rows">
          <div v-if="live.proposal.problem" class="proposal__row">
            <span>核心问题</span>
            <p>{{ live.proposal.problem }}</p>
          </div>
          <div v-if="live.proposal.outcome" class="proposal__row">
            <span>预计产出</span>
            <p>{{ live.proposal.outcome }}</p>
          </div>
        </div>

        <div v-if="live.proposal.stages.length" class="proposal__stages">
          <span class="proposal__stages-label">路径大纲 · {{ live.proposal.stageCount }} 个阶段</span>
          <ol>
            <li v-for="(s, i) in live.proposal.stages" :key="i" class="pstep"><i>{{ i + 1 }}</i><div><strong>{{ s }}</strong></div></li>
          </ol>
        </div>

        <!-- 前置自测：帮路径更贴合基础（可选作答，作答后自动收录） -->
        <div v-if="live.proposal.probes && live.proposal.probes.length" class="proposal__probes">
          <span class="proposal__stages-label">快速自测（可选）</span>
          <div v-for="p in live.proposal.probes" :key="p.probeId" class="probe">
            <p class="probe__q">{{ p.question }}</p>
            <div class="probe__opts">
              <button
                v-for="o in p.options"
                :key="o.id"
                type="button"
                class="probe__opt"
                :class="{ 'probe__opt--on': live.probeAnswers[p.probeId] === o.id }"
                :disabled="live.sending || !!live.probeAnswers[p.probeId]"
                @click="live.answerProbe(p, o.id, o.text)"
              ><b>{{ o.id }}</b> {{ o.text }}</button>
            </div>
          </div>
        </div>

        <div v-if="confirmError" class="errorbar">
          确认失败，请重试。<button type="button" class="errorbar__retry" @click="doConfirm">重试</button>
        </div>

        <div v-if="supplementMode" class="proposal__supplement">
          <textarea
            v-model="supplementText"
            class="proposal__supplement-input"
            rows="2"
            maxlength="300"
            placeholder="比如：我只有 Windows 电脑，Excel 是 2016 版…"
          ></textarea>
        </div>

        <div class="proposal__note">
          <span v-if="materialCount">已上传的 {{ materialCount }} 份资料将作为学习主线，公开网络资料作补充；引用内容可点开看原文。</span>
          <span>确认后在本页生成，一般需要 1-2 分钟。失败可原地重试，信息不会丢。</span>
          <AiContentNote />
        </div>
        </div><!-- /.proposal__body（内容滚动区） -->

        <!-- sticky foot：贴卡片底，不随 body 滚走（原型 .wf-dialog__foot 的位置语义） -->
        <div class="proposal__foot">
          <!-- 真按钮而非 span[role=button]：Space 键触发、禁用语义免手工维护（E2E 自动化也靠 button 语义定位） -->
          <template v-if="!supplementMode">
            <button type="button" class="btn-ghost" @click="supplementMode = true">再补充点信息</button>
            <button type="button" class="btn-primary btn-primary--lg" @click="doConfirm">确认，生成我的路径</button>
          </template>
          <template v-else>
            <button type="button" class="btn-ghost" @click="supplementMode = false">取消</button>
            <button
              type="button"
              class="btn-primary"
              :class="{ 'btn-primary--off': !supplementText.trim() || live.sending }"
              :disabled="!supplementText.trim() || live.sending"
              @click="doSupplement"
            >{{ live.sending ? '提交中…' : '提交补充，更新方案' }}</button>
          </template>
        </div>
      </div>

      <!-- 生成中 -->
      <div v-else-if="phase === 'generating'" class="proposal proposal--center">
        <span class="spinner"></span>
        <h2 class="proposal__title">正在生成你的路径…</h2>
        <p class="proposal__generating-note">{{ genWaitText }} · 根据 {{ live.filledCount }} 条已确认信息拆解，一般需要 1-2 分钟。</p>
        <div class="skeleton"><i style="width: 82%"></i><i style="width: 64%"></i><i style="width: 74%"></i></div>
        <!-- 生成阶段模型输出是 JSON（对用户不可读）：delta 阶段给中性进度文案，不直出原始流（P3） -->
        <div class="proposal__stream">
          <span class="proposal__stream-label">生成进度</span>
          <p class="proposal__stream-text">正在逐项整理方案内容，完成后会自动展示。</p>
        </div>
        <div class="proposal__note">可以离开本页，生成进度会保留。</div>
        <button type="button" class="proposal__stop" @click="live.stop()">
          <svg viewBox="0 0 24 24" width="12" height="12"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
          停止生成
        </button>
      </div>

      <!-- 生成成功 -->
      <div v-else-if="phase === 'done'" class="proposal proposal--center">
        <button
          type="button"
          class="proposal__x proposal__x--corner"
          aria-label="关闭"
          title="关闭（Esc 可随时关闭）"
          @click="proposalDismissed = true"
        >×</button>
        <span class="done-ring">
          <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
        </span>
        <h2 class="proposal__title">路径已生成</h2>
        <p class="proposal__generating-note">可以进入「我的路径」查看阶段与任务的准备进度。</p>
        <div class="proposal__actions proposal__actions--center">
          <button type="button" class="btn-primary btn-primary--lg" @click="goPaths">查看我的路径</button>
          <!-- 只在方案还在（stage=proposing）时给「返回方案」：否则点了只是关浮层，无路可回 -->
          <button v-if="live.stage === 'proposing' && live.proposal" type="button" class="btn-ghost" @click="phase = 'preview'">返回方案</button>
          <!-- 留在本页：done 态此前只有 Esc 一个退出途径（触屏无 Esc），补显式次级出口 -->
          <button type="button" class="btn-ghost" @click="proposalDismissed = true">留在本页</button>
        </div>
      </div>
    </div>

    <!-- AI 生成提示：沉底。营销页脚（V2Footer）已移除——这是对话工作台，
         和 ChatGPT/Linear 一样应当满视口、零文档滚动；愿景/文档/GitHub 入口
         导航与 /docs 都有，不需要在这里再给一条（2026-09-27 用户反馈
         「窗口为什么还滚动了，页脚还得往下滑」）。 -->
    <div v-if="!live.started" class="goal__foot">
      <div class="goal__ai-note">
        <AiContentNote />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useIsDark } from '@/composables/useIsDark';

const isDark = useIsDark();
import { useRoute, useRouter } from 'vue-router';
import { useGoalLive, type LiveMessage } from './useGoalLive';
import { forgetRecentGoalForUser, loadRecentGoalsForUser, rememberRecentGoalForUser, type RecentGoalEntry } from '@/utils/recentGoals';
import { isProbeAnswer, probeAnswerParts } from './probeAnswer';
import V2Nav from './V2Nav.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import MessageActions from '@/components/chat/MessageActions.vue';
import MaterialUploadArea from '@/components/learning/MaterialUploadArea.vue';
import { hasUserSession } from '@/utils/api';
import { useUserStore } from '@/stores/user';
import { currentUserId, dropLegacyRecentGoalsStorage } from '@/utils/sessionCleanup';
import { cachedMessageHtml, plainMessageHtml } from '@/utils/messageMarkdown';
import { toast } from '@/utils/toast';
import { feedbackApi } from '@/api/feedback';
import { askConfirm } from '@/views/admin-redesign/useConfirm';

const route = useRoute();
const router = useRouter();
const live = useGoalLive();
const userStore = useUserStore();
const loggedIn = hasUserSession();
const recentGoalsUserId = computed(() => userStore.user?.id || currentUserId());
let recentGoalsLoadGeneration = 0;

/* 移动端信息清单折叠：桌面（>900px）恒展开，窄屏默认折叠，点击顶栏展开/收起 */
const narrowMq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 1100px)') : null;
const isNarrow = ref(narrowMq?.matches ?? false);
const panelOpen = ref(false);
const panelExpanded = computed(() => !isNarrow.value || panelOpen.value);
/** 输入上限：后端 GOAL_INPUT_MAX_CHARS 是 4096，前端再收紧只会把「贴一段背景」截断，对齐后端 */
const INPUT_MAX = 4096;
/* 移动端输入框 placeholder 缩短（长文案换行后被裁，占两行以上无法完整显示） */
const entryPlaceholder = computed(() => isNarrow.value ? '先说说你想解决什么…' : '先说说你最近想解决什么，或现在卡在哪里…');
const chatPlaceholder = computed(() => isNarrow.value ? '回答问题，或补充基础、时间…' : '回答上面的问题，或补充你的基础、时间和限制…');
function togglePanel() {
  if (!isNarrow.value) return;
  panelOpen.value = !panelOpen.value;
}
function onNarrowChange(e: MediaQueryListEvent) {
  isNarrow.value = e.matches;
}

/* ---------- 键盘快捷键 ---------- */
/* Escape 已在 onProposalKey 中处理方案浮层关闭；
   此处预留扩展位：后续 live 支持 cancel() 时可加 Escape 中止生成 */

// 稳定 key 渲染消息列表（失败气泡移除/追加时避免 DOM 复用错乱）
const keyedMessages = computed(() =>
  live.messages.map((m, i) => ({ key: m.id ?? `i_${i}`, msg: m }))
);
/** P2-14：最后一条 AI 消息的 key——其快捷补充由下方的常驻面板承担，历史轮次才内联渲染 chip */
const lastAiKey = computed(() => {
  for (let i = live.messages.length - 1; i >= 0; i -= 1) {
    if (live.messages[i].role === 'ai') return live.messages[i].id ?? `i_${i}`;
  }
  return '';
});

onMounted(() => {
  window.addEventListener('keydown', onProposalKey);
  window.addEventListener('resize', onViewportResize);
  // iOS 键盘不改布局视口高度、只改 visualViewport，需单独监听（Android 的
  // viewport meta 带 interactive-widget=resizes-content，走上面的 resize）
  window.visualViewport?.addEventListener('resize', onViewportResize);
  narrowMq?.addEventListener('change', onNarrowChange);
  // 每次进入页面随机展示一批场景
  shuffleScenes();
  const cid = typeof route.params.conversationId === 'string' ? route.params.conversationId : '';
  // P2-10：首页预设方向带入（?seed=…）→ 作为首条消息直接开始澄清，不丢失用户点击的意图
  const seeded = typeof route.query.seed === 'string' ? route.query.seed.trim() : '';
  if (seeded) {
    resetToEntry();
    // 不在此处手动清 query：会话开始后 conversationId watcher 会用 params 覆盖 URL（自然去掉 seed），
    // 手动 replace 会与 route.params 的 reset watcher 竞争，导致刚推入的消息被清回初始态。
    void startWith(seeded);
    return;
  }
  if (cid && cid !== live.conversationId) {
    resumeFromRoute(cid);
  } else if (!cid && live.started) {
    // SPA 内从旧会话切回无参路由（点底部「目标规划」tab、路径页「新目标」、知识图谱
    // 「开始学习」都会走到这里）：清掉模块级残留的上一轮对话回到初始态；
    // localStorage 保留，仍可「继续上次的规划」恢复。这也是移动端会话态唯一的
    // 「开始另一个目标」出口——页面内不再单设「新目标」按钮（见 .composer__hint 注释）。
    resetToEntry();
  }
  // 草稿回填：刷新后长草稿不丢，并聚焦到输入框（EG14）
  if (restoreDraft()) {
    void nextTick(() => (chatInputEl.value ?? entryInputEl.value)?.focus());
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onProposalKey);
  window.removeEventListener('resize', onViewportResize);
  window.visualViewport?.removeEventListener('resize', onViewportResize);
  narrowMq?.removeEventListener('change', onNarrowChange);
  // 离页/刷新前把在途草稿落盘（防抖窗口内未落的那一版）
  window.clearTimeout(draftTimer);
  saveDraft();
});

/** 清回初始态（内存 + 组件局部状态；live.resetView 保留 localStorage 恢复入口） */
function resetToEntry() {
  live.resetView();
  phase.value = 'preview';
  supplementMode.value = false;
  supplementText.value = '';
  input.value = '';
}

/** 路由 cid 恢复入口：失败且本地无会话可回退时明示——否则坏 cid 链接打开
    只见全新初始页，用户以为内容丢了（P2）；本地有会话时初始页已有
    「恢复失败，点这里重试」按钮承接，不重复弹 */
function resumeFromRoute(cid: string) {
  void live.resumeById(cid).then((ok) => {
    if (!ok && !live.hasSession()) toast.error('原会话未能恢复，已为你开启新对话');
  });
}

// 会话 ID 变化时同步视图状态（分享链接 / 恢复旧会话）
watch(
  () => route.params.conversationId,
  (cid) => {
    const next = typeof cid === 'string' ? cid : '';
    if (next && next !== live.conversationId) {
      resumeFromRoute(next);
      // 切到某会话的深链时回填该会话草稿（EG14）
      if (restoreDraft()) void nextTick(() => chatInputEl.value?.focus());
    } else if (!next && live.started) {
      // 导航到无参路由（如「规划新目标」）时组件被复用、onMounted 不重跑：
      // 这里清掉模块级残留的上一轮对话回到初始态；localStorage 保留，仍可恢复
      resetToEntry();
    }
  }
);

/* 会话开始后同步 URL（可刷新恢复、可分享） */
watch(
  () => live.conversationId,
  (cid) => {
    if (cid) rememberGoal(cid);
    const cur = typeof route.params.conversationId === 'string' ? route.params.conversationId : '';
    if (cid && cid !== cur) {
      router.replace({ name: 'V2GoalConversation', params: { conversationId: cid } });
    }
  }
);

function goPaths() {
  router.push(`/learning-paths?from=goal&conversationId=${live.conversationId}`);
}

const input = ref('');
/* 两个输入框（初始态/会话态互斥渲染）的 DOM 引用：autogrow 用 */
const entryInputEl = ref<HTMLTextAreaElement | null>(null);
const chatInputEl = ref<HTMLTextAreaElement | null>(null);
/** 自增高（移植 ChatInput.vue autogrow）：rows=1 固定单行时 max-height:120px 是死样式，
    多行输入被裁。内容变化后按 scrollHeight 重设高度，上限 120 */
function autogrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
// 走 watch 而非 @input：点选快选/发送后清空是程序改值，不触发 input 事件
watch(input, () => {
  void nextTick(() => { autogrow(chatInputEl.value); autogrow(entryInputEl.value); });
});

/* 草稿持久化（EG14）：长草稿刷新即丢。按会话键写 localStorage，防抖保存、发送后清除、
   刷新回填并聚焦。无会话时用 'entry' 键承接初始态草稿。 */
const DRAFT_PREFIX = 'wf_goal_draft:';
function draftKey(): string {
  const cid = live.conversationId
    || (typeof route.params.conversationId === 'string' ? route.params.conversationId : '')
    || 'entry';
  return DRAFT_PREFIX + cid;
}
function saveDraft() {
  try {
    if (input.value.trim()) localStorage.setItem(draftKey(), input.value);
    else localStorage.removeItem(draftKey());
  } catch { /* 隐私模式忽略 */ }
}
function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch { /* 忽略 */ }
}
/** 回填草稿；命中时返回 true（决定是否聚焦） */
function restoreDraft(): boolean {
  try {
    const v = localStorage.getItem(draftKey());
    if (!v) return false;
    input.value = v;
    return true;
  } catch { return false; }
}
let draftTimer = 0;
watch(input, () => {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(saveDraft, 400);
});

/* 最近会话：本地留存当前账号最近 5 次会话的 id 与首句摘要；旧共享键不迁移。 */
const recentGoals = ref<RecentGoalEntry[]>([]);
function rememberGoal(id: string) {
  const ownerId = recentGoalsUserId.value;
  if (!id || !ownerId) return;
  const first = live.messages.find((m) => m.role === 'user' && m.content)?.content?.replace(/\s+/g, ' ').trim() || '';
  const preview = (first || '未命名规划').slice(0, 40);
  recentGoals.value = rememberRecentGoalForUser(ownerId, { id, preview, at: Date.now() });
}
function forgetRecentGoal(userId: string, id: string) {
  const next = forgetRecentGoalForUser(userId, id);
  if (recentGoalsUserId.value === userId) recentGoals.value = next;
}

watch(recentGoalsUserId, (nextId, previousId) => {
  recentGoalsLoadGeneration += 1;
  dropLegacyRecentGoalsStorage();
  recentGoals.value = loadRecentGoalsForUser(nextId);
  if (previousId && previousId !== nextId) {
    if (live.started) resetToEntry();
    if (typeof route.params.conversationId === 'string') {
      void router.replace({ name: 'V2GoalConversation' });
    }
  }
}, { immediate: true });

async function openRecentGoal(id: string) {
  const ownerId = recentGoalsUserId.value;
  if (!ownerId) return;
  const generationAtStart = recentGoalsLoadGeneration;
  const ok = await live.resumeById(id);
  if (recentGoalsUserId.value !== ownerId || generationAtStart !== recentGoalsLoadGeneration) return;
  if (!ok) {
    if (live.resumeErrorStatus === 404) {
      forgetRecentGoal(ownerId, id);
      toast.info('这条会话已不可用，已从最近会话中移除');
    }
    return;
  }
  await router.push({ name: 'V2GoalConversation', params: { conversationId: id } });
}

function recentTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const dayDiff = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (dayDiff <= 0) return '今天';
  if (dayDiff === 1) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
/** 当前展示轮的快捷补充入口（快选为勾选语义：全部常驻，点选打勾，再点取消） */
const currentQuickReplies = ref<Array<{ text: string; icon?: string }>>([]);

/* ---------- 资料附件层（回形针内置输入框 + 输入框即拖放目标） ---------- */
const uploadRef = ref<{ openPicker: () => void; addFiles: (files: File[]) => void } | null>(null);
const materialCount = ref(0);
const boxDropping = ref(false);
let boxDragDepth = 0;
function onBoxDragEnter() { boxDragDepth++; boxDropping.value = true; }
function onBoxDragOver(e: DragEvent) { e.preventDefault(); }
function onBoxDragLeave() {
  boxDragDepth = Math.max(0, boxDragDepth - 1);
  if (!boxDragDepth) boxDropping.value = false;
}
function onBoxDrop(e: DragEvent) {
  boxDragDepth = 0;
  boxDropping.value = false;
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) uploadRef.value?.addFiles(files);
}
/** 从 input 中把某行追加/取消；为保持展示层薄，纯组件内实现 */
function toggleReply(text: string) {
  const t = text.trim();
  const cur = input.value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (cur.includes(t)) {
    input.value = cur.filter((x) => x !== t).join('\n');
  } else {
    cur.push(t);
    input.value = cur.join('\n');
  }
}
/** 面板选项 = 当前轮全部快选，常驻展示（不随选中隐藏，保证再点可取消） */
const availableReplies = computed(() => currentQuickReplies.value);
/** 已选中的快选文本集合（驱动勾选态样式） */
const pickedReplySet = computed(() => new Set(input.value.split('\n').map((s) => s.trim()).filter(Boolean)));
const scrollEl = ref<HTMLElement | null>(null);
const phase = ref<'preview' | 'generating' | 'done'>('preview');
/* P2-12：等待态加阶段文案（比三点动画更能留住人）。每秒 tick，按已等待秒数切换文案。 */
const waitTick = ref(0);
let waitTimer: ReturnType<typeof setInterval> | undefined;
function stopWaitTimer() { if (waitTimer) { clearInterval(waitTimer); waitTimer = undefined; } }
function startWaitTimer() { stopWaitTimer(); waitTick.value = 0; waitTimer = setInterval(() => { waitTick.value += 1; }, 1000); }
const waiting = computed(() => live.sending || phase.value === 'generating');
watch(waiting, (on) => { if (on) startWaitTimer(); else stopWaitTimer(); });
onBeforeUnmount(stopWaitTimer);
const CHAT_WAIT_STAGES: Array<[number, string]> = [
  [4, '正在理解你的输入…'],
  [12, '正在梳理关键信息…'],
  [30, '正在组织回复…'],
  [Infinity, '内容较多，仍在生成，请稍候…'],
];
const GEN_WAIT_STAGES: Array<[number, string]> = [
  [8, '正在梳理你的目标…'],
  [25, '正在拆解阶段…'],
  [60, '正在排布任务…'],
  [Infinity, '正在收尾，马上就好…'],
];
function stageText(stages: Array<[number, string]>) {
  for (const [until, text] of stages) if (waitTick.value < until) return text;
  return stages[stages.length - 1][1];
}
const chatWaitText = computed(() => stageText(CHAT_WAIT_STAGES));
const genWaitText = computed(() => stageText(GEN_WAIT_STAGES));
const supplementMode = ref(false);
const supplementText = ref('');
/* 用户消息内联编辑（仅最后一条用户消息可编辑） */
const editingMsgId = ref<string | null>(null);
const editingText = ref('');
const confirmError = ref(false);

/* ---------- 消息操作 ---------- */
const hoveredMsgId = ref<string | null>(null);
function onBubbleEnter(id: string) { hoveredMsgId.value = id; }
function onBubbleLeave() { hoveredMsgId.value = null; }

async function copyMessage(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('已复制到剪贴板');
  } catch { toast.error('复制失败'); }
}

/** 消息级点赞/点踩上报：内容去重（后端按内容哈希 key），失败静默不打扰 */
async function sendMessageFeedback(msg: LiveMessage, thumbsUp: boolean) {
  if (!live.conversationId || !msg.content) return;
  try {
    await feedbackApi.submitMessage({
      sessionId: live.conversationId,
      messageText: msg.content,
      thumbsUp
    });
  } catch {
    /* 反馈失败不影响对话，静默 */
  }
}

/* ---------- 用户消息内联编辑（仅最后一条用户消息可编辑） ---------- */
function canEditMessage(msg: LiveMessage): boolean {
  if (live.sending || editingMsgId.value) return false;
  const lastUserIdx = live.messages.map((x) => x.role).lastIndexOf('user');
  return lastUserIdx >= 0 && live.messages[lastUserIdx] === msg;
}

function startEdit(msg: LiveMessage, key: string) {
  editingMsgId.value = key;
  editingText.value = msg.content;
}

function cancelEdit() {
  editingMsgId.value = null;
  editingText.value = '';
}

/** 保存编辑：替换文本 → 裁掉其后所有消息 → 重新发送 */
async function saveEdit(msg: LiveMessage) {
  const t = editingText.value.trim();
  if (!t || t === msg.content) { cancelEdit(); return; }
  const idx = live.messages.indexOf(msg);
  if (idx < 0) { cancelEdit(); return; }
  live.messages.splice(idx, live.messages.length - idx, { ...msg, content: t });
  editingMsgId.value = null;
  editingText.value = '';
  try {
    await live.send(t, true);
  } catch { /* handled by live.failed */ }
}

async function regenerateMessage(msg: LiveMessage) {
  if (live.sending) return;
  // Find the user message preceding this AI message
  const idx = live.messages.indexOf(msg);
  let lastUser = '';
  for (let i = idx - 1; i >= 0; i--) {
    if (live.messages[i].role === 'user') { lastUser = live.messages[i].content; break; }
  }
  if (!lastUser) { toast.info('找不到对应的问题'); return; }
  // Remove the current AI message and re-send（不重复 push 用户消息）
  live.messages.splice(idx, 1);
  try {
    await live.send(lastUser, true);
  } catch { /* handled by live.failed */ }
}

const formatMessage = (text: string) => plainMessageHtml(text);
/* 历史消息 HTML 走 WeakMap 缓存（键=消息对象，对象稳定不重建）：响应式重渲不再每条
   重跑 markdown-it+DOMPurify（P2）。cachedMessageHtml 按 {text} 盒取缓存，这里给每条
   消息配一个稳定内容盒；流式文本是字符串字面量，保持 plainMessageHtml 直渲染 */
const htmlBoxCache = new WeakMap<object, { text: string }>();
function messageHtml(m: LiveMessage): string {
  let box = htmlBoxCache.get(m);
  if (!box) {
    box = { text: m.content };
    htmlBoxCache.set(m, box);
  } else if (box.text !== m.content) {
    box.text = m.content;
  }
  return cachedMessageHtml(box);
}

const stageLabel = computed(() => {
  if (live.stageIndex === 3) return '可生成路径';
  if (live.stageIndex === 2) return '方案确认中';
  return '继续澄清中';
});

/** Escape 关闭方案浮层（状态保留，对话可继续）；新提案到达时重新显示。
    注意：声明必须早于 showProposal computed——watch(showProposal, …) 在 setup 期
    立即求值该 computed，晚于声明会撞 TDZ 导致整个路由白屏（P0 回归）。 */
const proposalDismissed = ref(false);

const showProposal = computed(
  () => !proposalDismissed.value && ((live.stage === 'proposing' && !!live.proposal) || phase.value === 'generating' || phase.value === 'done')
);
/* 焦点管理（P2）：浮层打开把焦点移入对话框（读屏按 dialog 播报、Esc 立即可用），
   关闭时归还原焦点，键盘用户不至于被「丢」在页面里 */
const overlayRef = ref<HTMLElement | null>(null);
let preOverlayFocus: HTMLElement | null = null;
watch(showProposal, (open) => {
  if (open) {
    preOverlayFocus = document.activeElement as HTMLElement | null;
    void nextTick(() => overlayRef.value?.focus());
  } else {
    preOverlayFocus?.focus();
    preOverlayFocus = null;
  }
});
/** 键鼠交互：Escape 关闭方案浮层 */
function onProposalKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && showProposal.value && !live.sending) {
    proposalDismissed.value = true;
  }
}
/** 点遮罩关闭：仅 done 态（preview 需用户显式选「确认/再补充」，generating 需等/停止） */
function onOverlayBackdrop() {
  if (phase.value === 'done') proposalDismissed.value = true;
}
watch(() => live.proposal, () => { proposalDismissed.value = false; });

function stageCls(i: number) {
  return {
    'stage-nav__item--current': live.stageIndex === i,
    'stage-nav__item--done': live.stageIndex > i
  };
}

async function scrollToBottom() {
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
}

watch(() => live.messages.length, scrollToBottom);
watch(() => live.sending, scrollToBottom);
// 是否跟随贴底：由滚动位置持续记账。手机键盘弹起时视口瞬间收缩，收缩后再量「离底多远」
// 永远为真（键盘高度本身就超过阈值），所以必须用收缩前的状态判断，否则上翻阅读会被强行拽到底。
let pinToBottom = true;
function onScrollPin() {
  const el = scrollEl.value;
  if (!el) return;
  pinToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}
/** 视口尺寸变化（键盘弹起/收起、横竖屏切换）后重新贴底，避免最新消息被挤到可视区外 */
function onViewportResize() {
  if (!pinToBottom) return;
  // resize 到达时新尺寸可能尚未重排，补一次延时兜底（重复设 scrollTop 无副作用）
  requestAnimationFrame(() => { void scrollToBottom(); });
  window.setTimeout(() => { void scrollToBottom(); }, 150);
}
// 流式渐进渲染：delta 累积时持续贴底（仅近底时跟随，避免打断上翻阅读）
watch(() => live.streamingText, () => {
  if (!live.sending || !scrollEl.value) return;
  const el = scrollEl.value;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  if (nearBottom) void scrollToBottom();
});

// 快捷补充：新快选到达时刷新（数组换新视为新一轮）
watch(
  () => live.quickReplies,
  (replies) => {
    currentQuickReplies.value = [...replies];
  },
  { deep: true }
);

async function doSend(e?: unknown) {
  // IME 组合期守卫：中文拼音选词按回车（isComposing/keyCode 229）不应触发发送；
  // 点击调用无事件载荷，自然跳过守卫
  const ke = e as KeyboardEvent | undefined;
  if (ke && (ke.isComposing || ke.keyCode === 229)) return;
  const t = input.value.trim();
  if (!t || live.sending) return;
  input.value = '';
  clearDraft();
  try {
    await live.send(t);
  } catch {
    /* 失败态由 live.failed 呈现 */
  }
}

// 相位对齐（2026-09-27 绕圈修复的前端半边）：文本确认走普通 reply 通道、不经 doConfirm，
// 恢复/重试/URL 直进也可能「打开时已是 completed」——phase 停在 preview 会出现
// 「后端已完成、页面静默」（completed 信封按设计不落 AI 气泡，收尾语由 done 面板承载）。
// 统一在会话终态出现时对齐到 done 面板。
watch(
  () => [live.stage, live.isCompleted, live.learningPath?.id] as const,
  () => {
    if (!live.started && !live.conversationId) return;
    if (live.isCompleted || live.stage === 'completed' || live.stage === 'ready' || live.learningPath) {
      phase.value = 'done';
    }
  },
  { immediate: true }
);

async function startWith(seed: string) {
  if (live.sending) return;
  try {
    await live.send(seed);
  } catch {
    /* ignore */
  }
}

async function doConfirm() {
  if (live.sending) return;
  confirmError.value = false;
  phase.value = 'generating';
  try {
    await live.confirm();
    phase.value = live.isCompleted || live.stage === 'completed' || live.stage === 'ready' ? 'done' : 'preview';
  } catch {
    confirmError.value = true;
    phase.value = 'preview';
  }
}

async function doSupplement() {
  const t = supplementText.value.trim();
  if (!t || live.sending) return;
  confirmError.value = false;
  try {
    await live.supplement(t);
    supplementText.value = '';
    supplementMode.value = false;
    // 补充说明 = 一次普通回合：后端只更新方案（understanding / confirmedProposal）、
    // **不生成路径**（生成须用户显式确认，README:113）。因此通常停在 preview 继续让用户确认；
    // 仅当会话本身已完成（learningPath / isCompleted）时才进 done。
    if (live.learningPath || live.isCompleted || live.stage === 'completed' || live.stage === 'ready') {
      phase.value = 'done';
    } else {
      phase.value = 'preview';
    }
  } catch {
    // 补充失败：保留已输入内容（不丢用户劳动），留在补充态，展示错误提示
    toast.error('补充失败，请重试。输入的内容已保留。');
  }
}

async function doRetry() {
  try {
    await live.retry();
  } catch {
    /* ignore */
  }
}

async function doResume() {
  await live.resume();
}

async function doReset() {
  const ok = await askConfirm({
    title: '清空重聊',
    message: '清空后本机保存的对话记录将被删除，此操作不可恢复。',
    confirmText: '清空',
    danger: true,
  });
  if (!ok) return;
  live.reset();
  resetToEntry();
  // 清掉 URL 中残留的 conversationId，避免刷新后 resumeById 恢复旧会话
  if (typeof route.params.conversationId === 'string') {
    router.replace({ name: 'V2GoalConversation' });
  }
}

const SCENE_BATCH_SIZE = 3;
const scenePool = [
  {
    title: '用 Python 自动化 Excel 报表',
    desc: '每天省下的复制粘贴时间，一周就能看到',
    seed: '我想用 Python 自动化处理 Excel 报表，每天能节省时间',
    bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>'
  },
  {
    title: '提升职场沟通表达',
    desc: '从下一次周会发言开始练，场景化拆解',
    seed: '我想学会沟通技巧，提高职场表达和人际交往能力',
    bg: 'color-mix(in srgb, var(--accent) 13%, transparent)', ink: 'var(--purple-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm6 5H7v-2h6v2zm4-6H7V6h10v2z"/></svg>'
  },
  {
    title: '用 AI 做自媒体副业',
    desc: '围绕你的账号定位，搭一条内容生产流程',
    seed: '我想做自媒体副业，用 AI 工具提高内容创作效率',
    bg: 'color-mix(in srgb, var(--cyan) 14%, transparent)', ink: 'var(--wf-color-secondary-dark)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h4a2 2 0 0 1 2 2v1.28c.6.35 1 .98 1 1.72a2 2 0 0 1-1 1.73V17a2 2 0 0 1-2 2h-4v1.27c.6.34 1 .99 1 1.73a2 2 0 1 1-4 0c0-.74.4-1.39 1-1.73V19H7a2 2 0 0 1-2-2v-3.27A2 2 0 0 1 4 12c0-.74.4-1.38 1-1.72V9a2 2 0 0 1 2-2h4V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>'
  },
  {
    title: '零基础学前端开发',
    desc: '从第一个网页到能独立做一个小项目',
    seed: '我想从零开始学前端开发，能独立做出网页',
    bg: 'rgba(240,101,149,.12)', ink: '#d1456f',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14.6 16.6 19.2 12l-4.6-4.6 1.4-1.4L22 12l-5.9 5.9-1.5-1.3zm-5.2 0L7.8 18l-5.8-6 5.8-6 1.6 1.4L4.8 12l4.6 4.6z"/></svg>'
  },
  {
    title: '用 SQL 做数据分析',
    desc: '能从数据库里查数、会看数、会讲数',
    seed: '我想学会 SQL 数据分析，能自己从数据库里查数据',
    bg: 'color-mix(in srgb, var(--cyan) 14%, transparent)', ink: 'var(--wf-color-secondary-dark)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2C7.6 2 4 3.8 4 6v12c0 2.2 3.6 4 8 4s8-1.8 8-4V6c0-2.2-3.6-4-8-4zm0 2c3.9 0 6 1.5 6 2s-2.1 2-6 2-6-1.5-6-2 2.1-2 6-2zm6 14c0 .5-2.1 2-6 2s-6-1.5-6-2v-3.2C7.7 17.5 9.8 18 12 18s4.3-.5 6-1.2V18zm0-5.5c0 .5-2.1 2-6 2s-6-1.5-6-2V9.3C7.7 10.5 9.8 11 12 11s4.3-.5 6-1.2V12.5z"/></svg>'
  },
  {
    title: '掌握 Git 版本控制',
    desc: '提交、分支、回滚，代码管理不再手忙脚乱',
    seed: '我想掌握 Git 版本控制，工作中代码管理不再混乱',
    bg: 'color-mix(in srgb, var(--amber) 14%, transparent)', ink: 'var(--amber-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 2a3 3 0 0 0-1 5.83v8.34A3.001 3.001 0 1 0 9 16.17V12h4a3 3 0 0 0 3-3V7.83A3 3 0 1 0 14 8v1a1 1 0 0 1-1 1H8V7.83A3 3 0 0 0 7 2zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm10 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7 16a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>'
  },
  {
    title: '学会写工作总结汇报',
    desc: '把做的事说清楚，让成果被看见',
    seed: '我想学会写工作总结和汇报，让领导看到我的成果',
    bg: 'rgba(49,177,111,.12)' /* 场景卡专用绿基色：等价 var(--wf-color-success-bg) 家族 */, ink: 'var(--green-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm9 1.5V8h4.5L15 3.5zM8 13h8v-1.5H8V13zm0 4h8v-1.5H8V17z"/></svg>'
  },
  {
    title: '搭建个人知识库',
    desc: '学过的内容沉淀下来，能真正用起来',
    seed: '我想搭建自己的知识管理系统，学过的内容能真正用起来',
    bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 4h7v7H4V4zm2 2v3h3V6H6zm7-2h7v7h-7V4zm2 2v3h3V6h-3zM4 13h7v7H4v-7zm2 2v3h3v-3H6zm7-2h7v7h-7v-7zm2 2v3h3v-3h-3z"/></svg>'
  },
  {
    title: '掌握 Linux 命令行',
    desc: '文件、权限、进程，命令行操作行云流水',
    seed: '我想掌握 Linux 命令行操作，能熟练处理文件和权限管理',
    bg: 'rgba(49,177,111,.12)' /* 场景卡专用绿基色：等价 var(--wf-color-success-bg) 家族 */, ink: 'var(--green-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM7.8 15.6 6.4 14.2 9.6 11l-3.2-3.2 1.4-1.4L12.4 11l-4.6 4.6zM12 17h6v-2h-6v2z"/></svg>'
  },
  {
    title: '学习时间管理',
    desc: '一天的事排得明明白白，告别忙乱',
    seed: '我想学习时间管理，把每天的工作安排得有条不紊',
    bg: 'color-mix(in srgb, var(--cyan) 14%, transparent)', ink: 'var(--wf-color-secondary-dark)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm1-12h-2v6l5 3 1-1.6-4-2.4V8z"/></svg>'
  },
  {
    title: '学会基础理财规划',
    desc: '工资存得住、钱能生钱，从记账开始',
    seed: '我想学会基础理财规划，工资能存得住、钱能生钱',
    bg: 'color-mix(in srgb, var(--amber) 14%, transparent)', ink: 'var(--amber-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 7H6a1 1 0 0 1 0-2h13V3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h15a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zm-6 7.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>'
  },
  {
    title: '学会写技术文档',
    desc: '结构、示例、可读性，让文档真正有人读',
    seed: '我想学会写技术文档，把知识表达清楚让别人能看懂',
    bg: 'color-mix(in srgb, var(--accent) 13%, transparent)', ink: 'var(--purple-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 4H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zM7 6h12v2H7V6zm0 5h12v2H7v-2zm0 5h8v2H7v-2z"/></svg>'
  }
];

/** 场景展示：默认展示前 3 个，点「换一批」从全部场景中随机抽 3 个不重复 */
const shuffledScenes = ref<typeof scenePool | null>(null);
const displayScenes = computed(() => shuffledScenes.value ?? scenePool.slice(0, SCENE_BATCH_SIZE));

function shuffleScenes() {
  shuffledScenes.value = [...scenePool].sort(() => Math.random() - 0.5).slice(0, SCENE_BATCH_SIZE);
}
</script>

<style scoped>
/* ---------- 初始态 / 登录门 ---------- */
.entry {
  flex: 1; width: 100%;
  max-width: 1080px; margin: 0 auto;
  /* 初始态是完整叙事块：垂直居中落在视口中部，消除底部大片空白 */
  padding: 40px 28px;
  display: flex; flex-direction: column; gap: 18px;
  /* safe center：内容比视口高时降级为顶对齐 + 内部滚动，居中布局的经典陷阱是
     overflow 后顶部被裁掉且滚不回去；输入框在内容末尾，必须永远可达
     （2026-09-27 用户反馈「到了 goal 阶段，输入框都在屏幕外了」） */
  justify-content: safe center;
  min-height: 0;
  overflow: auto;
}
/* 统一内容列：hero 文字 / 场景卡 / 输入框（含资料 chips 层）共用 640 一条列，
   不再 hero 通栏左对齐、卡片居中的混搭（比例失调的根源） */
.entry__hero { max-width: 640px; width: 100%; margin: 0 auto; }
.entry .composer--entry {
  max-width: 640px; width: 100%; margin: 0 auto;
  /* 原 46 补白为卡片间距服务；现在资料区在两者之间，由 gap 接管 */
  margin-top: 2px;
}

.goal__foot { margin-top: auto; }
.goal__ai-note {
  display: flex; justify-content: center;
  padding: 10px 28px 4px;
}
.goal__ai-note :deep(.ai-note) { font-size: 12px; opacity: 0.75; }
.login-gate {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px; /* 圆角阶梯：卡片 */
  padding: 48px 32px;
  display: grid; gap: 14px; justify-items: center; text-align: center;
}
.login-gate h1 { margin: 0; font-size: 20px; }
.login-gate p { margin: 0; font-size: 14px; color: var(--muted); max-width: 52ch; line-height: 1.7; }

.resume {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 11px 16px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--blue) 7%, transparent), color-mix(in srgb, var(--accent) 5%, transparent));
  border: 1px solid color-mix(in srgb, var(--blue) 25%, transparent);
  border-radius: 16px; /* 圆角阶梯：卡片 */
  font: inherit; text-align: left; cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
/* 原 hover 的 0 8px 20px 蓝色 12% 发光改为 raised 档：染色光晕下线，
   抬升层级改由中性阴影承担（border-color 变化仍是允许的 hover 反馈）。 */
.resume:hover { border-color: color-mix(in srgb, var(--blue) 50%, transparent); box-shadow: var(--wf-shadow-raised); }
.resume__dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--blue);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--blue) 18%, transparent);
  flex: 0 0 auto;
  animation: pulse 1.6s ease-in-out infinite;
}
.resume__body { display: grid; gap: 1px; }
.resume__body strong { font-size: 13.5px; }
.resume__body small { font-size: 12px; color: var(--muted); }
.resume__go { font-size: 13px; font-weight: 800; color: var(--blue-deep); }

/* 最近会话列表（D14）：入口页回访入口；与 hero 同栏限宽，条目 ≥44px 触控带 */
.recent { width: 100%; max-width: 640px; margin: 4px auto 0; }
.recent__title { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.04em; color: var(--faint); }
/* minmax(0, 1fr) 不能省成隐式 auto 轨（2026-10-07 实测 390 视口）：
   grid 的 auto 轨按**内容最小宽**撑开，而 .recent__preview 是 nowrap —— 标题整句的
   min-content 有 525px，轨道于是被撑到 525px，比 358px 的容器宽出 167px：
   行尾的「昨天/10月5日」与「›」被推到 x≈529（视口 390，完全在屏外不可点），
   标题也在行右缘被切掉半字。li 上没写 min-width:0，行内那套
   `flex:1 + min-width:0 + ellipsis` 因此全程没生效（它只作用于行内，管不住轨宽）。
   显式声明 minmax(0,1fr) 后轨道跟随容器，行内省略号才真正起作用。 */
.recent__list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.recent__item {
  display: flex; align-items: center; gap: 10px;
  min-height: 44px; padding: 9px 12px;
  border: 1px solid var(--line); border-radius: var(--mk-radius-lg);
  background: var(--surface); color: var(--ink); text-decoration: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.recent__item:hover { border-color: color-mix(in srgb, var(--blue) 45%, transparent); background: color-mix(in srgb, var(--blue) 5%, transparent); }
.recent__preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.recent__time { flex: none; font-size: 12px; color: var(--faint); }
.recent__go { flex: none; color: var(--faint); font-weight: 700; }

.entry__hero {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 20px; flex-wrap: wrap;
}
.entry__hero-text { display: grid; gap: 10px; }
.entry__hero h1 { margin: 0; /* 桌面档 goal 页登记上限 20（check-mobile-spec）：原 clamp(22,3.6vw,30) 越阈 */ font-size: clamp(18px, 2vw, 20px); font-weight: 800; letter-spacing: -0.012em; }
.entry__hero p { margin: 0; font-size: 13.5px; color: var(--muted); max-width: 52ch; line-height: 1.7; }

.errorbar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  border-radius: var(--mk-radius-xl);
  background: color-mix(in srgb, var(--red) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
  color: var(--red-ink);
  font-size: 13px; font-weight: 600;
}
.errorbar__retry { text-decoration: underline; cursor: pointer; font-weight: 800; }
.chat__errorbar { margin: 8px 4px 0; }

.entry__cards {
  display: grid; grid-template-columns: 1fr; gap: 12px;
  max-width: 640px; width: 100%; margin: 0 auto;
}
.entry__cards-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.entry__cards-title { font-size: 12px; font-weight: 700; color: var(--faint); }
.cards-nav__btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; padding: 0; /* 30→36：lt36 门禁口径（任何可点元素 ≥36px） */
  border: 0; border-radius: var(--mk-radius-md);
  background: transparent; color: var(--faint);
  font: inherit; cursor: pointer;
  transition: color .15s ease, background .15s ease;
}
.cards-nav__btn:hover:not(:disabled) {
  color: var(--muted); background: color-mix(in srgb, var(--ink) 5%, transparent);
}
.cards-nav__btn:disabled { opacity: .4; cursor: default; }
.scene-card {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px; /* 圆角阶梯：卡片 */
  font: inherit; text-align: left; cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}
/* hover 不再抬升（原 translateY(-1px) 已删），淡蓝发光换成中性 raised 档 */
.scene-card:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--blue) 45%, transparent);
  box-shadow: var(--wf-shadow-raised);
}
.scene-card:disabled { opacity: .55; cursor: default; }
.scene-card__icon { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; flex: 0 0 auto; }
.scene-card__body { flex: 1; min-width: 0; }
.scene-card__body strong {
  display: block; font-size: 14px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.scene-card__go {
  font-size: 18px; line-height: 1;
  color: var(--faint); flex: 0 0 auto;
  transition: color 0.16s ease, transform 0.16s ease;
}
.scene-card:hover:not(:disabled) .scene-card__go { color: var(--blue-deep); transform: translateX(2px); }

/* ---------- 输入区 ---------- */
.composer { display: grid; gap: 7px; }
.composer__box {
  position: relative;
  display: flex; align-items: flex-end; gap: 10px;
  /* .composer 是单列 grid，盒是 grid item，min-width:auto 时它的最小贡献=min-content，
     会把那一列撑到 ≈295px 的硬下限（≤355 视口下顶出列宽，320 实测右缘越过视口 1.3px）。
     归零后轨道跟随容器，内部 textarea 的 min-width:0 才真正起作用。 */
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  padding: 8px 8px 8px 16px;
  min-height: 54px;
  box-shadow: var(--wf-shadow-raised); /* 悬浮档 */
}
/* 聚焦：柔和提示 —— 细蓝边 + 全站唯一一圈（原型 .wf-composer__box:focus-within，
   取代原「有内容才高亮」：空输入框聚焦时同样是当前操作焦点） */
.composer__box:focus-within {
  border-color: color-mix(in srgb, var(--blue) 55%, transparent);
  box-shadow: var(--mk-focus-ring);
}
/* 资料附件：输入框左下回形针入口（主流附件模式），角标显示已传份数。
   与右侧首行文字中线对齐：首行中心 = textarea 上内边距 10 + 行高一半 10.5 = 20.5，
   按钮 32 高、中线偏 16，故 margin-top: 4.5px 顶到行首。autogrow 只改高度，首行位置恒定。 */
.composer__attach {
  position: relative;
  align-self: flex-start;
  margin-top: 4.5px;
  flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px;
  border: 0; border-radius: 8px; /* 圆角阶梯：控件 */
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.composer__attach:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
.composer__attach-count {
  position: absolute; top: -1px; right: -3px;
  min-width: 14px; height: 14px; padding: 0 3px;
  border-radius: 999px;
  background: var(--blue); color: var(--text-on-primary);
  font-size: 12px; font-weight: 800; line-height: 14px;
  pointer-events: none;
}
/* 拖文件到输入框：整盒高亮 + 居中提示 */
.composer__box--dropping {
  border-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 6%, var(--surface));
}
.composer__drop-hint {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: var(--blue-deep);
  pointer-events: none;
  z-index: 2;
}
.composer__textarea {
  flex: 1;
  /* 无 cols 属性 → 浏览器按 cols=20 给 textarea 一个内在最小宽（16px 字号下 ≈160px），
     flex 项默认 min-width:auto 不许收缩到它以下，整个输入盒因此有 ≈295px 的硬下限：
     ≤355 视口下输入盒会顶出 composer 的列宽（320 实测右缘 321.3 > composer 右缘 310，
     并越过 320 视口 1.3px）。这一条允许它缩到列宽内。 */
  min-width: 0;
  border: 0; outline: none; resize: none;
  font: inherit; font-size: 15px; line-height: 1.5;
  color: var(--ink);
  background: transparent;
  padding: 10px 0;
  max-height: 120px;
  align-self: center;
}
/* 44→42：原型 .wf-composer__send 42px 方键（移动端媒体查询仍保留 44 的触控档） */
.composer__send {
  width: 42px; height: 42px; border-radius: var(--mk-radius-xl);
  display: grid; place-items: center;
  /* 实色 --blue（蓝渐变 + 30% 发光一并退役）；按压反馈 scale(.98) */
  background: var(--blue);
  color: var(--text-on-primary); cursor: pointer;
  flex: 0 0 auto;
  border: 0;
  transition: background 0.15s ease, transform 0.15s ease;
}
.composer__send:active { transform: scale(0.98); }
.composer__send--off { background: color-mix(in srgb, var(--line) 60%, transparent); color: var(--faint); cursor: default; }
/* 生成中：同一按钮切换为红色停止态（主流聊天交互）。
   批次 D：红色发光、hover 抬升、以及 135deg 渐变底一并退役 → 纯色危险档。
   语义色取值用 --wf-color-danger（#ef7578），它是规范里的柔和红；
   白字对比度 3.2:1 不足 AA，故停止态改用深一档的 --wf-color-danger-dark
   （#d95054，白字 4.6:1 达 AA）——停止键必须比普通主键更醒目，
   靠「更深」而不是「更亮」。 */
.composer__send--stop {
  background: var(--wf-color-danger-dark);
}
/* hover 档：规范只允许「变背景/边框/文字」，危险色没有更深一档的令牌，
   故 hover 改为轻微提亮到 --wf-color-danger（#ef7578）。注意这在暗色下
   是变亮、在亮色下也变亮——语义一致：按下即「危险色更显眼」。 */
.composer__send--stop:hover {
  background: var(--wf-color-danger);
}
.composer__send--stop:active { transform: scale(0.97); }
.composer__hint {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 12px;
  font-size: 12px; color: var(--faint); padding-left: 6px;
}
.composer__hint-right { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; }
.panel__tip {
  font-size: 12px; color: var(--faint); border-top: 1px solid var(--line); padding-top: 10px;
  margin-top: auto;
}
.composer__count { font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 「新目标」不属于 composer 元数据条：移动端由底部「目标规划」导航回到无参路由，
   route.params watcher 负责 resetToEntry，并保留「继续上次的规划」恢复入口。 */

/* ---------- 工作台布局 ---------- */
.work {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  /* 原型 .wf-screen ≥1024：会话态整体 880px 居中（原 1000） */
  max-width: 880px;
  margin: 0 auto;
  padding: 12px 20px 16px;
  display: grid;
  grid-template-columns: 284px minmax(0, 1fr);  /* 原型 .wf-chatbody 左栏 284px */
  grid-template-rows: minmax(0, 1fr);
  gap: 16px;
  align-content: stretch;
  align-items: stretch;
  box-sizing: border-box;
}

/* 宽屏（≥1500px）的 1180 放宽档只留给方案弹层态（.work--wide）：
   会话常态恒 880，原型里更宽的屏也只在方案确认那一步需要横向舒展 */
@media (min-width: 1500px) {
  .work.work--wide { max-width: 1180px; gap: 20px; }
}

/* ---------- 左：信息清单（移动端默认折叠为头部横条，点击展开；桌面恒展开） ----------
   原型 .wf-goalinfo 自身是白面 + 发丝线 + radius-modal + shadow-sm 的卡片；
   卡壳（包住阶段导航/线程的那层白底）已按原型去掉，此卡保留 */
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--shadow-sm);
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 12px;
  min-height: 0;
  overflow: auto;
}
.panel__head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  border: 0; background: transparent; padding: 0; margin: 0;
  font: inherit; color: inherit; text-align: left;
  cursor: default;
}
.panel__head strong { font-size: 14px; }
.panel__count { font-size: 12px; font-weight: 800; color: var(--blue-deep); }
/* 折叠指示箭头：仅移动端显示 */
.panel__caret { display: none; font-size: 12px; color: var(--faint); flex-shrink: 0; }
.panel__body { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.panel__bar { height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--line) 55%, transparent); overflow: hidden; }
.panel__bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width .4s ease; }
.panel__confidence { font-size: 12px; color: var(--faint); }

/* 目标信息字段行：原型 .wf-field —— 发丝线平铺行（去圆角悬浮底），
   done = 绿 18% 浅底 + 绿字勾，未完成 = 灰空圆 */
.checklist { list-style: none; margin: 0; padding: 0; display: grid; }
.field {
  position: relative;
  display: grid; grid-template-columns: 16px 1fr; gap: 9px;
  padding: 9px 0;
  border-top: 1px solid var(--line);
}
.field:first-child { border-top: 0; }
.field--done:hover { background: transparent; }
.field__mark {
  width: 16px; height: 16px; border-radius: 50%;
  margin-top: 2px;
  display: grid; place-items: center;
  background: color-mix(in srgb, var(--ink) 8%, transparent);
  color: transparent;
}
.field__mark svg { width: 10px; height: 10px; }
.field--done .field__mark { background: color-mix(in srgb, var(--green) 18%, transparent); color: var(--green-ink); }
.field__label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--faint); }
.field__value { margin-top: 3px; font-size: 13px; font-weight: 600; line-height: 1.5; color: var(--ink); }
.field__value--todo { color: var(--faint); font-size: 13px; font-weight: 500; }
/* 「刚收录」徽章：对齐原型 .wf-field__fresh —— 蓝色（原先绿底白勾同源的绿系） */
.field--fresh { background: color-mix(in srgb, var(--blue) 6%, transparent); }
/* 刚收录闪显：值写入时一次蓝色高亮脉冲（reduced-motion 下被全局规则压掉） */
@media (prefers-reduced-motion: no-preference) {
  .field--fresh { animation: field-flash 1.4s ease-out 1; }
  .field--fresh .field__value { animation: field-value-flash 1.4s ease-out 1; }
  .field__fresh { animation: field-badge-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
}
@keyframes field-flash {
  0% { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--blue) 14%, transparent); }
  100% { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--blue) 6%, transparent); }
}
@keyframes field-value-flash {
  0%, 30% { color: var(--blue-deep); }
  100% { color: var(--ink); }
}
@keyframes field-badge-pop {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}
.field__fresh {
  position: absolute; top: 9px; right: 0;
  font-size: 12px; font-weight: 800; color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  padding: 2px 6px; border-radius: var(--mk-radius-pill);
}
/* 徽章绝对定位在行尾：给同排的正文让位，长值不会钻到徽章底下 */
.field--fresh .field__body { padding-right: 52px; }
</style>

<style scoped>
/* ---------- 右：聊天区 ----------
   原型 .wf-goal--chat 是画布直铺：阶段导航 / 目标信息 / 线程直接落在 canvas 上，
   这里去掉原先的白卡壳（白底 + 1px 边框 + 圆角），改用留白与发丝线分区 */
.chat {
  position: relative;
  display: flex; flex-direction: column;
  /* overflow hidden：锁高之后内容若比视口高，只允许在 chat 内部滚，不许把文档撑出滚动条
     （这不是卡壳——卡壳指白底/1px 边框/圆角，已按原型去掉） */
  overflow: hidden;
  min-height: 0;
  height: 100%;
}
/* 桌面（>1100px）：与移动端同一套锁高方案——.goal 锁 100dvh、main.work flex:1、
   .chat height:100%。此前用 max-height 上限法，chat 比工作区矮 ~74px，
   对话区域底部悬空不贴底（手动流程问题测试 2026-09-26）。锁高后消息区内部滚动，
   头部/输入框恒在屏内，chat 底沿与视口底部对齐。 */
@media (min-width: 1101px) {
  /* overflow:hidden：锁高之后内容若比视口高，只允许在 entry/chat 内部滚，
     不许把文档撑出滚动条 */
  .goal { height: calc(100dvh / var(--vp-zoom, 1)); min-height: 0; flex: 0 0 auto; overflow: hidden; }
}
/* 原型 .wf-chathead：直接坐在画布上，无分隔线、无底色（分区靠留白）。
   内边距 10/16 保留：移动端 .panel 的零占位锚点带高 47px，正是按这条头部带对齐的 */
.chat__head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px;
}
.stage-nav { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; }
.chat__show-proposal {
  margin-left: auto;
  border: 1px solid color-mix(in srgb, var(--blue) 35%, transparent);
  background: color-mix(in srgb, var(--blue) 10%, var(--surface)); color: var(--blue-deep);
  border-radius: var(--mk-radius-pill); padding: 4px 12px;
  font-size: 12px; font-weight: 700; cursor: pointer;
}
.chat__show-proposal:hover { background: color-mix(in srgb, var(--blue) 18%, var(--surface)); }
.stage-nav__item {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12px; font-weight: 700; color: var(--faint);
  padding: 5px 10px; border-radius: var(--mk-radius-pill);
}
.stage-nav__item i {
  width: 17px; height: 17px; border-radius: 50%;
  background: color-mix(in srgb, var(--line) 60%, transparent); color: var(--faint);
  font-size: 12px; font-weight: 800; font-style: normal;
  display: grid; place-items: center;
}
.stage-nav__item--current { color: var(--blue-deep); background: color-mix(in srgb, var(--blue) 10%, transparent); }
.stage-nav__item--current i { background: var(--blue); color: var(--text-on-primary); }
/* done 态：原型 .wf-stagenav__item.is-done —— 浅绿字 + 浅绿底圆（非实绿底白字） */
.stage-nav__item--done { color: var(--green-ink); }
.stage-nav__item--done i { background: color-mix(in srgb, var(--green) 16%, transparent); color: var(--green-ink); }
.chat__clear { font-size: 12px; font-weight: 600; color: var(--faint); cursor: pointer; }
.chat__clear:hover { color: var(--red-ink); }

.chat__scroll {
  flex: 1;
  overflow-y: auto;
  /* 画布直铺：不再有白卡内边距，左右与 .chat__head 的 16px 对齐 */
  padding: 16px 16px 20px;
  display: flex; flex-direction: column; gap: 18px;
  transition: filter .2s ease, opacity .2s ease;
}
/* 消息从上方开始、向下生长：桌面**刻意不做贴底**。
   2026-10-05 曾把窄屏那条贴底规则提到基础档（当时理由是「短会话消息与下方快捷块之间空一截」），
   结果桌面整段对话吊在底部：1440×1250 实测首条消息距对话区顶部 141px，看起来像对话从下往上长。
   2026-10-06 用户否掉（「消息不应该是从上面往下面走吗」），回退为窄屏专属（见 ≤1100 档）。 */

.chat__scroll--dim { filter: blur(2px); opacity: .45; pointer-events: none; }

.msg { display: flex; flex-direction: column; gap: 5px; max-width: 78%; } /* 82→78：随两栏同步收窄后的读感档（2026-09-27 三改） */
/* 三改：聊天列本身已收窄，气泡 74% 配合 work 1000px 总宽即可 */
/* 消息入场：新气泡浮出 */
@media (prefers-reduced-motion: no-preference) {
  .msg { animation: msg-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both; }
}
@keyframes msg-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.msg--user { align-self: flex-end; align-items: flex-end; position: relative; }
/* 快速自测作答：紧凑记录卡（左侧蓝色标签 + 答案 + 题目弱化两行） */
.msg--user .msg__probe {
  display: grid; gap: 3px;
  padding: 9px 13px;
  max-width: 100%;
  border-radius: 16px 16px 4px 16px; /* 圆角阶梯：卡片/弹层 + 内芯尾角 */
  background: color-mix(in srgb, var(--surface) 88%, var(--blue) 12%);
  border: 1px solid color-mix(in srgb, var(--blue) 26%, transparent);
  color: var(--ink);
}
.msg__probe-tag { font-size: 12px; font-weight: 800; letter-spacing: .04em; color: var(--blue-deep); }
.msg__probe-answer { font-size: 13px; font-weight: 600; line-height: 1.5; }
.msg__probe-q {
  font-size: 12px; line-height: 1.5; color: var(--muted);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.msg--user .msg__bubble {
  /* 原型 .wf-msg--me p：右上 4px 圆角 + 实色蓝底（蓝渐变与 24% 蓝色投影已退役） */
  background: var(--blue);
  color: var(--text-on-primary);
  border-radius: 16px 16px 4px 16px;
  white-space: pre-wrap;
}
/* 用户消息编辑按钮（hover 显示；触屏常显） */
/* 编辑入口收进 meta 行：你 · 时间（左）… 铅笔（右），hover 消息显现；
   原绝对定位悬浮在气泡外侧空白处，位置语义不明且会盖到别的内容 */
.msg--user .msg__meta { display: inline-flex; align-items: center; gap: 7px; }
.msg--user .msg__edit-btn {
  position: relative;
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
    /* EG20：触屏触控地板 40（与 AI 操作条同口径），图标居中——本体达标后不再依赖 ::before 扩热区 */
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
  /* 实色主按钮（原蓝渐变退役）；按压 scale(.98) 补回交互反馈 */
  background: var(--blue);
}
.msg__edit-save:not(:disabled):active { transform: scale(0.98); }
.msg__edit-cancel {
  color: var(--muted);
  border: 1px solid var(--line);
  background: var(--surface);
}
.msg__bubble {
  /* 原型 .wf-msg p：11/13 内边距、13.5px / 1.6 行高、16px 圆角基线 */
  padding: 11px 13px;
  font-size: 13.5px; line-height: 1.6;
  border-radius: 16px; /* 圆角阶梯：卡片/弹层 */
  background: var(--surface); color: var(--ink);
}
/* AI 气泡（原型 .wf-msg--ai p）：白面 + 发丝线 + 左上 5px + shadow-sm，
   替换原 #f2f6fc 灰蓝无边气泡 */
.msg--ai .msg__bubble {
  background: var(--surface);
  border: 1px solid var(--line);
  border-top-left-radius: 4px; /* 圆角阶梯：内芯尾角 */
  box-shadow: var(--shadow-sm);
}
.msg--ai { flex-direction: row; align-items: flex-start; gap: 10px; max-width: 92%; }
.msg--ai .msg__content { display: grid; gap: 5px; min-width: 0; }
.msg--ai .msg__bubble b, .msg--ai .msg__bubble strong { color: var(--blue-deep); }
.msg__bubble--html :deep(p) { margin: 0 0 8px; }
.msg__bubble--html :deep(p:last-child) { margin-bottom: 0; }
.msg__bubble--html :deep(ul), .msg__bubble--html :deep(ol) { margin: 4px 0; padding-left: 18px; }
.msg__bubble--html :deep(li) { margin: 2px 0; }
.msg__bubble--html :deep(code) {
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  color: var(--blue-deep);
  padding: 1px 6px; border-radius: var(--mk-radius-sm);
  font-size: 12.5px;
}
/* 流式渐进渲染气泡：末尾光标提示仍在生成 */
.msg__bubble--streaming::after {
  content: '';
  display: inline-block;
  width: 2px; height: 1em;
  margin-left: 3px;
  vertical-align: -0.15em;
  background: var(--blue-deep);
  animation: goal-stream-caret 0.9s steps(2, start) infinite;
}
@keyframes goal-stream-caret {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
/* MessageActions 定位容器 */
.msg__bubble--relative { position: relative; }
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

.msg__bubble--typing { display: inline-flex; gap: 5px; align-items: center; padding: 14px 16px; }
.msg__bubble--typing i {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--faint);
  animation: typing 1.2s ease-in-out infinite;
}
.msg__bubble--typing i:nth-child(2) { animation-delay: .15s; }
.msg__bubble--typing i:nth-child(3) { animation-delay: .3s; }
@keyframes typing { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
.msg__avatar {
  /* 原型 wf-msg__avatar：蓝 12% 扁平圆 + blue-deep 字（去蓝→紫渐变方块，2026-09-30 视觉收敛） */
  width: 30px; height: 30px; border-radius: 50%;
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  color: var(--blue-deep); font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
  flex: 0 0 auto; margin-top: 2px;
}
.msg__meta { font-size: 12px; color: var(--faint); }
.msg__retry {
  margin-left: 8px;
  color: var(--red-ink); font-weight: 800;
  text-decoration: underline; cursor: pointer;
}

/* ---------- 快捷补充（skill 每轮返回）：原型 .wf-replies / .wf-reply ----------
   去白面板与面板头（replies-panel__head），整行蓝调按钮组：
   1px 蓝 28% 描边 + 蓝 5% 底 + blue-deep 文字 + 前置 6px 蓝点；选中变 ✓ */
.replies {
  display: flex; flex-direction: column; gap: 8px;
  margin-left: 40px;
}
.reply {
  display: flex; align-items: flex-start; gap: 9px; width: 100%;
  min-height: 44px; padding: 11px 14px; border-radius: 12px;
  text-align: left;
  border: 1px solid color-mix(in srgb, var(--blue) 28%, transparent);
  background: color-mix(in srgb, var(--blue) 5%, transparent);
  color: var(--blue-deep);
  font: inherit; font-size: 14px; font-weight: 600; line-height: 1.45;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
}
.reply::before {
  content: ""; flex: none;
  width: 6px; height: 6px; margin-top: 7px; border-radius: 50%;
  background: color-mix(in srgb, var(--blue) 55%, transparent);
}
.reply:hover {
  background: color-mix(in srgb, var(--blue) 11%, transparent);
  border-color: color-mix(in srgb, var(--blue) 46%, transparent);
}
.reply:disabled { cursor: default; opacity: .55; }
/* 选中：边蓝 72% / 底蓝 15% / 内描边 1px 蓝 34%，前缀圆点变 ✓ */
.reply--on {
  border-color: color-mix(in srgb, var(--blue) 72%, transparent);
  background: color-mix(in srgb, var(--blue) 15%, var(--surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--blue) 34%, transparent);
}
.reply--on::before {
  content: "✓";
  width: auto; height: auto; margin-top: 0; border-radius: 0; background: none;
  color: var(--blue); font-size: 13px; font-weight: 800; line-height: 1.45;
}
/* P2-14：历史轮次的快捷补充（随消息渲染，点选填入输入框；选中态跟随输入草稿）。
   对齐原型 .wf-chip：蓝调胶囊 */
.msg__replies { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.msg__reply {
  min-height: 38px; padding: 8px 14px;
  border-radius: var(--mk-radius-pill);
  border: 1px solid color-mix(in srgb, var(--blue) 32%, transparent);
  background: color-mix(in srgb, var(--blue) 6%, transparent);
  color: var(--blue-deep);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.msg__reply:hover { background: color-mix(in srgb, var(--blue) 12%, transparent); color: var(--blue-deep); }
.msg__reply--on {
  border-color: color-mix(in srgb, var(--blue) 72%, transparent);
  background: color-mix(in srgb, var(--blue) 15%, var(--surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--blue) 34%, transparent);
}
@media (prefers-reduced-motion: no-preference) {
  .replies { animation: replies-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both; }
}
@keyframes replies-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

/* ---------- 输入区：对话卡内的底条（2026-10-06 归位） ----------
   它是 .chat（对话卡）的最后一个 flex 子项：宽度 = 对话列，与上方气泡同列同左右缘。
   历史教训：2026-10-02 曾把输入区拆成「页级通栏底条 + 复刻 .work 栅格的 .composer__inner」，
   靠 284px 空列把内容凑到对话列下面——一旦 .work 在宽屏放宽（≥1680 的 1180 档）或 zoom
   档生效，两套宽度立刻错开：1080P 实测气泡 821px、输入框 583px，输入区与对话割裂。
   宽度只有一处来源（= 对话列）才不会漂。 */
.chat > .composer {
  flex: 0 0 auto;
  /* 左右 16 = .chat__scroll 的左右内边距：输入框左右缘与上方气泡严格同一条竖线
     （宽屏两者都吃 760 上限，窄屏两者都等于「对话列 − 32」）。 */
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 96%, transparent);
  /* 自带 safe-area：无底部导航的设备上输入条不压 home 指示条
     （移动端媒体查询里会改掉，因为那档有底部 tab 栏接管该区域） */
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
}
/* ---------- 方案确认浮层 ---------- */
/* 页面级模态（原型 .wf-modal / .wf-dialog）：fixed 铺满视口，
   遮罩盖住页级 composer 与导航（原先 absolute 只盖住 .chat 一块） */
.overlay {
  position: fixed; inset: 0;
  display: grid; place-items: center;
  padding: 24px;
  /* 遮罩跟随主题：原先写死浅色 rgba(244,247,252,.55)，深色下是一层白纱（2026-09-24 反馈） */
  background: color-mix(in srgb, var(--canvas) 62%, transparent);
  /* 批次 D（2026-10-02）：backdrop-filter: blur(1px) 已删。
     1px 模糊在任何设备上都读不出来，只是白白多一次全屏合成；
     遮罩靠 62% 的 canvas 混色表达「压暗隔断」，足够。 */
  z-index: 60;
}
/* dialog 三段：head（可关） / body（滚动） / foot（贴底不随内容滚） */
.proposal {
  width: min(620px, 100%);
  max-height: 100%;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--blue) 22%, transparent);
  border-radius: 16px; /* 圆角阶梯：弹层 */
  box-shadow: var(--mk-shadow-pop); /* 弹层档 */
  display: flex; flex-direction: column;
}
.proposal__head {
  flex: none;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 24px 28px 0;
}
.proposal__head-text { display: grid; gap: 6px; min-width: 0; }
/* 关闭 ×（原型 .wf-dialog__x）：36px 而非原型 32px —— 本仓触屏门禁「任何可点元素 ≥36px」 */
.proposal__x {
  flex: none; width: 36px; height: 36px;
  border: 0; border-radius: 8px; /* 圆角阶梯：控件 */
  background: color-mix(in srgb, var(--ink) 8%, var(--surface));
  color: var(--muted);
  font: inherit; font-size: 17px; line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.proposal__x:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 12%, var(--surface)); }
/* done/generating 态无 head 段：× 钉在卡片右上角，给触屏一个显式关闭出口（此前仅 Esc） */
.proposal__x--corner { position: absolute; top: 12px; right: 12px; }
.proposal__body {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto;
  padding: 18px 28px 4px;
  display: grid; gap: 16px; align-content: start;
}
.proposal__foot {
  flex: none;
  position: sticky; bottom: 0; z-index: 1;
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 14px 28px 20px;
  background: var(--surface);
  border-top: 1px solid var(--line);
}
.proposal--center { position: relative; display: grid; justify-items: center; text-align: center; gap: 12px; padding: 34px 28px; overflow-y: auto; }
.proposal__stream {
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  border-radius: var(--mk-radius-xl);
  background: color-mix(in srgb, var(--surface) 92%, var(--blue) 8%);
  border: 1px solid color-mix(in srgb, var(--blue) 20%, transparent);
  display: grid; gap: 6px;
}
.proposal__stream-label { font-size: 12px; font-weight: 800; color: var(--blue-deep); letter-spacing: .04em; }
.proposal__stream-text {
  margin: 0;
  font-size: 12.5px; line-height: 1.7;
  color: var(--muted);
  max-height: 120px; overflow-y: auto;
  white-space: pre-wrap;
}
.proposal__stop {
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: 12px; font-weight: 700;
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--blue) 35%, transparent);
  border-radius: var(--mk-radius-pill);
  padding: 6px 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.proposal__stop:hover { background: color-mix(in srgb, var(--blue) 14%, transparent); }
.proposal__eyebrow { display: block; font-size: 12px; font-weight: 800; letter-spacing: .07em; color: var(--blue-deep); }
.proposal__title { margin: 0; font-size: 18px; letter-spacing: -0.01em; }
.proposal__generating-note { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.7; max-width: 44ch; }
.proposal__rows { display: grid; gap: 10px; width: 100%; }
.proposal__row {
  display: grid; gap: 4px;
  padding: 12px 14px;
  border-radius: 12px;
  /* 原型 .wf-proposal__row：软底无边（去掉原硬编码 #e8eefb 边框） */
  background: color-mix(in srgb, var(--surface) 92%, var(--ink));
  text-align: left;
}
.proposal__row span { font-size: 12px; color: var(--faint); }
.proposal__row p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--ink); }
.proposal__stages { display: grid; gap: 10px; width: 100%; text-align: left; }
.proposal__stages-label { font-size: 12px; font-weight: 800; color: var(--muted); }
/* 路径大纲：原型 .wf-pstages —— 纵向列表行（24px 序号 + 标题），非四列网格 */
.proposal__stages ol {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 8px;
}
.pstep {
  display: grid; grid-template-columns: 24px 1fr; gap: 10px; align-items: start;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 12px; /* 圆角阶梯：面板 */
  background: var(--surface);
}
.pstep i {
  width: 24px; height: 24px; border-radius: 8px;
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  color: var(--blue-deep);
  font-size: 12px; font-weight: 800; font-style: normal;
  display: grid; place-items: center;
}
.pstep strong { display: block; font-size: 13.5px; line-height: 1.5; }
.proposal__probes {
  display: grid; gap: 10px; width: 100%; text-align: left;
}
.probe {
  display: grid; gap: 10px;
  padding: 13px 14px;
  border: 1px solid var(--line);
  border-radius: 12px; /* 圆角阶梯：面板 */
  background: var(--surface);
}
.probe__q { margin: 0; font-size: 13px; font-weight: 700; color: var(--ink); line-height: 1.55; }
/* 快速自测选项：原型 .wf-probe__opts —— 整行堆叠按钮（A/B 前缀方块 + 文案），非内联 chip 换行 */
.probe__opts { display: grid; gap: 8px; }
.probe__opt {
  display: flex; align-items: center; gap: 9px;
  text-align: left; padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px; /* 圆角阶梯：控件 */
  background: var(--surface);
  font: inherit; font-size: 13px; color: var(--ink);
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.probe__opt b {
  flex: none; width: 18px; height: 18px; border-radius: 6px;
  display: grid; place-items: center;
  font-size: 12px;
  background: color-mix(in srgb, var(--ink) 8%, transparent);
  color: var(--muted);
}
.probe__opt:hover:not(:disabled) { border-color: color-mix(in srgb, var(--blue) 40%, var(--line)); }
.probe__opt--on { border-color: var(--blue); background: color-mix(in srgb, var(--blue) 7%, var(--surface)); }
.probe__opt--on b { background: var(--blue); color: var(--text-on-primary); }
.probe__opt:disabled { cursor: default; opacity: .92; }
.proposal__actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.proposal__actions--center { justify-content: center; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: var(--mk-radius-xl);
  /* 实色主按钮：蓝渐变 + 30% 蓝色发光投影一并退役 */
  background: var(--blue);
  color: var(--text-on-primary); font-size: 14px; font-weight: 700;
  cursor: pointer; text-decoration: none;
  transition: transform 0.18s ease, background 0.18s ease;
}
.btn-primary:not(:disabled):active { transform: scale(0.98); }
.btn-primary--lg { padding: 13px 26px; font-size: 15px; }
.btn-primary--off { opacity: .55; cursor: default; }
.btn-ghost {
  padding: 11px 18px; border-radius: var(--mk-radius-xl);
  border: 1px solid var(--line); background: var(--surface);
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}
/* 原型 .wf-proposal__note：竖排四号字说明，不是「两端对齐的一行」 */
.proposal__note {
  display: grid; gap: 4px;
  font-size: 12px; line-height: 1.6; color: var(--faint);
}
.proposal__note :deep(.ai-note) {
  font-size: 12px; line-height: 1.5;
}
.proposal__supplement { display: grid; gap: 12px; width: 100%; }
.proposal__supplement-input {
  border: 1px solid color-mix(in srgb, var(--amber) 45%, transparent);
  background: color-mix(in srgb, var(--amber) 7%, transparent);
  border-radius: var(--mk-radius-xl);
  padding: 12px 14px;
  font: inherit; font-size: 13px; color: var(--ink);
  resize: none; outline: none;
  min-height: 56px;
}

/* 生成中 */
.spinner {
  width: 44px; height: 44px; border-radius: 50%;
  border: 4px solid color-mix(in srgb, var(--blue) 15%, transparent);
  border-top-color: var(--blue);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.skeleton { display: grid; gap: 8px; width: 100%; }
.skeleton i {
  height: 12px; border-radius: var(--mk-radius-sm);
  /* 骨架 shimmer：规范的豁免渐变（加载动效）；底色走令牌派生 */
  background: linear-gradient(90deg, var(--mk-surface-2) 25%, var(--surface) 50%, var(--mk-surface-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease infinite;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* 成功 */
.done-ring {
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--wf-color-success-bg);
  color: var(--green);
  display: grid; place-items: center;
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--wf-color-success) 7%, transparent);
}

/* ---------- 响应式 ---------- */
@media (max-width: 1100px) {
  /* 移动端保留顶部导航：与其余页面一致的 logo+铃铛+头像（CTA 已在 V2Nav ≤900 隐藏），
     底部 tabs 同时保留。本页 .goal 锁 100dvh，头部 56px 入流后由 main flex:1 自动让位。 */
  /* 锁定视口高度：会话态整页不滚动，chat 内部滚动、composer 吸底在底部导航之上。
     flex-grow:0 显式置零（.v2-page 全局 flex:1 会把 height:100dvh 拉伸到内容高度）。
     v2.css 全局 .v2-page { padding-bottom:72px } 为底部导航让位，此处保留。 */
  .goal { height: calc(100dvh / var(--vp-zoom, 1)); min-height: 0; flex: 0 0 auto; overflow: hidden; }
  .work {
    grid-template-columns: 1fr;
    /* 信息面板在移动端改绝对定位（零占位锚点），chat 独占整行撑满 */
    grid-template-rows: minmax(0, 1fr);
    padding: 8px 10px;
    gap: 8px;
    overflow: hidden;
    min-height: 0;
  }
  /* 目标信息：不再占一整行（原 43px 横条 + 8px gap），触发按钮挪到 chat 头部行的右上角
     （该行移动端只剩阶段导航，右侧是空的）。aside 绝对定位成「零占位锚点」：
     盒子与 .chat__head 同一水平带（等高即中线重合，高度随 .panel__head 的 min-height 走，
     不写死），悬浮层从它的下沿展开。
     空白区 pointer-events:none，否则会盖住下面阶段导航的点击。
     展开态原先是流内限高 45dvh，380px 面板把 chat 压到 311px、消息区只剩 160px。 */
  .panel {
    position: absolute;
    /* 与 chat 同框：top/left/right 就是 .work 的内边距（8/10/10）。
       头部带高度**不能写死**：.chat__head = 上下 padding 10 + .stage-nav__item
       min-height 40 = 60px。此前写死 47（早于「阶段导航抬到 40px 触控下限」那次改动），
       两条带各自 align-items:center → 药丸中心实测 96.2、阶段导航中心 102.7，
       药丸比它该在的那一行高 6.5px，看起来是「浮」在阶段导航上方的孤立小卡。
       改成与 .chat__head 同一条上下 padding（10），两条带的中线自动重合。 */
    top: 8px; left: 10px; right: 10px;
    height: auto;
    display: flex; flex-direction: row; align-items: center; justify-content: flex-end;
    /* 与 .chat__head 同一条上下 padding（10）。配合下方 .panel__head 的 min-height 40
       （= .stage-nav__item 的 min-height），两条带的高度都是 10+40+10=60，
       align-items:center 后药丸中心与阶段导航中心严格重合。 */
    padding: 10px 0;
    border: 0;
    background: none;
    /* 桌面档给 .panel 上了 shadow-sm（对齐原型 .wf-goalinfo）：移动端这里是零占位锚点带，
       不能带投影，否则透明带上浮出一块方影 */
    box-shadow: none;
    max-height: none;
    overflow: visible;
    z-index: 25;
    pointer-events: none;
  }
  /* 小按钮：触发入口就是这一颗药丸，空带不挡事件（下方阶段导航要能点） */
  .panel__head {
    position: relative;
    pointer-events: auto;
    display: inline-flex; align-items: center; gap: 5px;
    margin-right: 16px;
    padding: 7px 8px;
    /* EG20（2026-10-05 复测）：触屏下该药丸实测 81×34，低于 36px 触控下限 → 抬到 38。
       2026-10-07：再抬到 40，与 .stage-nav__item 的 min-height 严格同高 —— 两条头部带
       （.chat__head / .panel 锚点带）都由 10+40+10=60 组成，药丸中线才与阶段导航重合。 */
    min-height: 40px;
    border: 1px solid var(--line);
    border-radius: var(--mk-radius-pill);
    background: var(--surface);
    color: var(--muted);
    font-size: 12px;
    box-shadow: var(--wf-shadow-raised); /* 悬浮档 */
  }
  .panel__head strong { font-size: 12px; }
  /* 展开箭头是 9px 的字形「▸」，12px 字号下渲染成一个几乎认不出的小点
     （2026-10-07 放大核对：它和「息」字之间还隔着 5px，读起来像个孤立标点）。
     抬到 13px，让「目标信息 ▸」读成一个整体。 */
  .panel__caret { display: inline; font-size: 13px; }
  /* 计数角标：绝对定位不吃宽度（右上角那一条带要和阶段导航挤在同一行），
     「已收集」三字省掉只留「3 / 7」。
     2026-10-07 收形：原来是实心蓝底白字（--blue + --text-on-primary），在 40px 白药丸的
     右上角读作一块「压上去的蓝色补丁」——它和药丸描边互相切角，比药丸本身还抢眼，
     而它承载的只是一个次要计数。改成柔和的蓝底蓝字，并加一圈 surface 描边（用
     box-shadow 而非 border，不占布局尺寸），让角标与药丸之间有一道干净的呼吸缝。 */
  .panel__count-k { display: none; }
  .panel__count {
    position: absolute; top: -6px; right: -5px;
    min-width: 17px; padding: 0 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--blue) 14%, var(--surface));
    color: var(--blue-deep);
    /* 字号必须留 12：mobile:spec 的 fonts 口径统计 <12px 的文本，goal 页预算为 0
       （见 frontend/scripts/check-mobile-spec.mjs）。收形只动底色与描边，不动字号。 */
    font-size: 12px; font-weight: 800; line-height: 16px;
    text-align: center;
    box-shadow: 0 0 0 2px var(--surface);
  }
  .panel--collapsed .panel__body { display: none; }
  .panel:not(.panel--collapsed) .panel__body {
    position: absolute;
    top: calc(100% + 6px);
    left: 16px; right: 16px;
    z-index: 26;
    /* 高度上限取「不超过 60% 视口」与「给 composer 留位」的较小值：
       悬浮层顶边在头部带下方 ≈118px，下方要留 composer(103) + 底部导航(62) ≈ 300px，
       短屏（320×568）下 60dvh 会盖住输入框，靠这一项兜住。内容仍超高时面板内部滚动。 */
    max-height: min(calc(60dvh / var(--vp-zoom, 1)), calc((100dvh - 320px) / var(--vp-zoom, 1)));
    overflow: auto;
    padding: 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--mk-radius-modal);
    box-shadow: var(--mk-shadow-modal); /* 模态档 */
  }
  /* 面板紧凑化（.field 已是原型 .wf-field 平铺发丝线行）：行内边距 9→7、gap 9→8、
     值 13→12.5；标记/徽章尺寸随桌面档（16px），只把绝对定位徽章对齐到新的行内边距；
     「待补充」行只有一行内容，标签与值并排（原先占两行纯属浪费，5 行白吃 ~110px）。 */
  .field { padding: 7px 0; grid-template-columns: 16px 1fr; gap: 8px; }
  .field__value { margin-top: 2px; font-size: 12.5px; }
  .field__value--todo { font-size: 12px; }
  .field--todo .field__body { display: flex; align-items: baseline; gap: 6px; }
  .field--todo .field__value { margin-top: 0; min-width: 0; }
  .field__fresh { top: 7px; right: 0; }
  .panel__bar { height: 5px; }
  /* 移动端信息清单默认折叠：头部横条可点，收起时隐藏进度条/清单/提示 */
  .panel__head { cursor: pointer; }
  .panel__caret { display: inline; }
  .panel--collapsed .panel__body { display: none; }
  /* chat 撑满第二行：内部滚动、composer 吸底 */
  .chat { min-height: 0; height: 100%; }
  /* overscroll-behavior:contain 隔断滚动链——列表滚到边缘时不再触发整页橡皮筋
     （本页 height:100dvh 不随文档滚动，iOS 上链式滚动会把底部导航一起拽动） */
  .chat__scroll { min-height: 0; overscroll-behavior: contain; }
  /* 消息少时贴底：首个子项吃满剩余空间（等价 justify-content:flex-end，但溢出时不会把顶部
     推出可达范围——auto 外边距在无剩余空间时按 0 处理）。短会话下最新一条与快捷补充紧贴输入框，
     视线与拇指都不用上下跑。窄屏专属：桌面要从上往下长（见基础档注释）。 */
  .chat__scroll > :first-child { margin-top: auto; }
  .msg { max-width: 96%; }
  /* 快捷补充面板占满整宽：基础样式的 margin-left 40（对齐气泡正文）在手机上白丢 40px 宽度，
     而这是整屏最常点的区域 */
  .replies { margin-left: 0; }
  /* 编辑按钮触屏即 40×40 本体（EG20 复验收口，见 (hover: none) 块），不再用 ::before 扩热区 */
  /* 移动端 hint 行整体脱离文档流（0 高，原占 17px + gap 7px），内容挂到输入框与底部导航
     之间那道缝里。触屏没有键盘快捷键提示，隐藏之。 */
  .composer { position: relative; }
  /* 本档 .v2-page 已有 padding-bottom:72px 让位底部 tab 栏，不再叠 safe-area（会留出空缝）。
     下内边距 46→30：那 46 是给「新目标」按钮（36px）预留的可点空间（LY10），
     该按钮已移除，只剩 hint 行（hint 文本 19.2px + 距底 5px = 24.2px）要落在这段内边距里。
     30 而非 22：22 时 hint 顶边（757.8）会压过输入框底边（760）2.2px（390 实测）。 */
  .chat > .composer { padding: 10px 16px 30px; }
  .composer__hint {
    position: absolute;
    /* left/right 取 .composer 的左右内边距（16），不是 0：绝对定位的包含块是 composer 的
       padding box，写 0 会让 hint 比输入框右缘多探出 16px（390 实测 380 vs 364），
       AI 声明于是贴到屏幕边上。对齐到输入框同一条列宽。 */
    left: 16px; right: 16px; bottom: 5px;
    height: 0;
    /* 底部对齐：hint 行（0 高）里的内容向上生长，落进 composer 预留的下内边距里，
       不向下溢进底部导航。 */
    align-items: flex-end;
    justify-content: flex-end;
    flex-wrap: nowrap;
    padding: 0;
  }
  .composer__hint-shortcut { display: none; }
  /* 计数与 AI 声明同处一条基线、整体靠右（与输入框右缘对齐）。
     此前用 display:contents 把两者拉到缝的两端，是为了给左侧的「新目标」让位；
     按钮移除后两端分布只会把一条元数据拉散成两截，改回一个右对齐的簇。 */
  .composer__hint-right { display: inline-flex; align-items: baseline; gap: 10px; }
  /* iOS Safari 聚焦 <16px 的输入框会触发视口自动放大，打完字还要 pinch 收回——
     textarea 必须留 16px；想让空态看着轻一点只能压 placeholder（占位符字号不影响聚焦判定）。
     盒内继续收紧：外内边距左 12→8、gap 10→8、textarea 上下 10→8、发送键 40→36，盒高 62→54。
     回形针与首行文字中线对齐：上内边距 8 + 半行高 12 = 20，按钮 32 高 → margin-top 4。
     左右内边距都收到 6：回形针/发送键的图标视觉内缩 ≈14.5 / 16.5px，两侧基本对称且贴边。 */
  .composer__box { padding: 6px; gap: 8px; }
  .composer__textarea { font-size: 16px; padding: 8px 0; }
  .composer__textarea::placeholder { font-size: 15px; }
  .composer__attach { margin-top: 4px; }
  .composer__attach svg { width: 14px; height: 14px; }
  .composer__send { width: 44px; height: 44px; }
  .composer__send:not(.composer__send--stop) svg { width: 15px; height: 15px; }
  /* 方案确认卡（三段 head/body/foot，body 内部滚动、foot 已贴底固定）：
     窄屏收紧三段内边距（24/28 在 320 下只剩 250px 内容宽）。
     旧的 `.proposal { padding }` + `.proposal__actions { position:sticky }` 补丁已废——
     内边距归各段自己持有，「确认，生成我的路径」由 foot 常驻贴底，不再会沉到可视区外。 */
  .overlay { padding: 12px; }
  .proposal__head { padding: 18px 16px 0; }
  .proposal__body { padding: 14px 16px 0; }
  .proposal__foot { padding: 12px 16px 16px; }
  .entry__hero { align-items: stretch; flex-direction: column; }
  .resume { width: 100%; justify-content: flex-start; }
  /* 整行铺满后「继续 ›」原本紧跟两行正文、悬在正文中线高度上，读起来像个孤立标签；
     推到行尾后成为标准的「列表行 + 行尾动作」。 */
  .resume__go { margin-left: auto; }
  .entry__cards { grid-template-columns: 1fr; }
  /* 初始态移动端：基线 justify-content:center 会留下上下两块对称死白（composer 与 AI 声明之间 135px）。
     改为整页均布：hero / 方向卡 / composer 等间距铺满视口，底部收敛为
     composer → 声明 → 底部导航 的稳定叠层；登录门只有单子元素，均布对其仍是居中。 */
  .entry { padding: 28px 16px; justify-content: space-evenly; }
  /* 阶段导航在窄屏收紧，给右上角的目标信息按钮腾位置（390 下两者刚好共处一行，
     合计 ~325px ≤ 头部带内容宽 336px） */
  .stage-nav { gap: 3px; }
  .stage-nav__item { padding: 4px 5px; font-size: 12px; gap: 4px; min-height: 40px; }
  .stage-nav__item i { width: 14px; height: 14px; font-size: 12px; }
  /* ≤360：非当前阶段只留序号（那三个字的宽度换 4 字标签+计数角标的位置） */
  @media (max-width: 360px) {
    .stage-nav__item:not(.stage-nav__item--current) { font-size: 0; gap: 0; padding: 4px 3px; }
    .stage-nav__item i { font-size: 12px; }
    /* AI 声明（226px）已占满对齐后的列宽（390 实测 hint 内容 283.5px），
       ≤335 时「计数 + 声明」放不进输入框那条列宽，会向左溢出压到 composer 内边距上。
       字号不能再降（mobile:spec 的 fonts 门禁），故此处让位的是计数——
       textarea 有 maxlength 强约束，超限本身不可能发生，计数只是提示。 */
    .composer__count { display: none; }
  }
  .chat__clear { display: none; }

  /* ===== 移动端密度（2026-09-24，2026-09-30 随原型对齐更新）=====
     判据：页面主容器左右 14px、卡片内边距 12–16、hero/h1 22px、区块标题 15–17px。
     实测 390 下：.chat__scroll 左右各 14px（同页 .work 已收到 8/10px）、登录门 48×32 +
     h1 26px；hero h1 与方案标题随桌面档（clamp 下限 22 / 18px），不再单独压字号。
     这几块只在对应状态下出现（登录门＝未登录、会话面板＝会话中），
     登录态巡检量不到，按基线推导。
     刻意不动的：.stage-nav__item(11.5px) 与 .panel__caret(9px)——前者与右上角目标信息
     按钮共享一行、注释里记着 390 下只有 11px 余量，后者是纯装饰字形。
     （2026-09-27 死 CSS 清理：.nav 及 .nav__ 系列、.live-badge、.proposal__skip、
     .peerdock 暗色档均已移除——模板早已不渲染这些类。.replies 当时被误列入：
     2026-09-30 快捷补充面板改名 .replies 后重新启用，移动端 margin-left 归零规则仍在。） */
  .chat__scroll { padding: 14px; }
  .login-gate { padding: 28px 20px; border-radius: var(--mk-radius-modal); }
  .login-gate h1 { font-size: 18px; }
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
  width: 28px;  /* 24→28：34px 框内留 3px 呼吸边即可，logo 更凸显（2026-09-27 用户反馈） */
  height: 28px;
  object-fit: contain;
}
</style>

<style scoped>
.login-gate__logo {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--mk-shadow-pop); /* 弹层档 */
}
</style>

<style scoped>
/* 暗色模式适配（scoped 确保优先级与组件样式一致） */
/* AI 气泡：暗色档用 --bubble-ai-bg（半透明深底）。只限 .msg--ai ——
   用户气泡已是 var(--blue)→var(--blue-deep) 渐变（令牌暗色自适配），
   整类覆写会把蓝渐变压回灰底（2026-09-30 对齐原型时改为白/蓝双态气泡）。 */
[data-theme='dark'] .msg--ai .msg__bubble {
  background: var(--bubble-ai-bg);
  color: var(--ink);
}
[data-theme='dark'] .msg--ai .msg__bubble b,
[data-theme='dark'] .msg--ai .msg__bubble strong {
  color: var(--blue-deep);
}
/* .proposal__row / .pstep 暗色档（2026-09-30）：底色已改令牌派生
   （surface 92%+ink、var(--surface)），--mk-surface/--mk-ink 暗色自动翻转，
   原「白 3% 覆写」与逐主题字面量已冗余，随死 CSS 一并移除。 */
[data-theme='dark'] .btn-ghost {
  background: var(--surface);
  border-color: var(--line);
  color: var(--muted);
}
/* 暗色适配（scoped 确保优先级与组件样式一致）
   底色/描边/阴影已全部令牌化（--surface/--line/--bubble-ai-bg/--mk-shadow-* 与
   color-mix(--ink/--amber/--blue) 派生），随 [data-theme='dark'] 自动翻转——
   原逐条暗色字面量覆写（rgba 纯黑/纯白影、琥珀底、shimmer 白纱）整块退役。 */

/* 桌面阅读宽度：>1100 对话内容限 ~760px 居中（同课堂页批10） */
@media (min-width: 1101px) {
  .chat__scroll > * { max-width: 760px; width: 100%; margin-left: auto; margin-right: auto; }
  .composer__box { max-width: 760px; width: 100%; margin-left: auto; margin-right: auto; }
  /* 提示行跟输入框同一列：输入框收在 760 而 hint 仍通栏时，hint 右侧内容（计数/AI 声明）
     会比输入框右缘多出 (列宽−760)/2 —— 1920 实测 26px，看起来像多伸出来一截。
     width:100% + 同款左右 auto 让两端都与输入框对齐（与课堂页 .composer__hint 同法）。 */
  .composer__hint { max-width: 760px; width: 100%; margin-left: auto; margin-right: auto; }
}
</style>
