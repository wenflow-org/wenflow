<template>
  <div class="goal v2-page">
    <!-- 应用导航（共享组件，带真实 AI 标识） -->
    <V2Nav />

    <!-- 未登录 -->
    <main v-if="!loggedIn" class="entry">
      <div class="login-gate">
        <img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" class="login-gate__logo" />
        <h1>登录后体验真实对话</h1>
        <p>登录后，和问流聊聊你最近想解决的事。两三分钟的对话，就能梳理出你的第一版学习计划。</p>
        <a class="btn-primary btn-primary--lg" href="/login?redirect=/goal-conversation">去登录</a>
      </div>
    </main>

    <!-- 初始态 -->
    <main v-else-if="!live.started" class="entry">
      <div class="entry__hero">
        <div class="entry__hero-text">
          <h1>从一件真实的小事开始</h1>
          <p>聊几句话，问流会梳理出目标和第一阶段安排。</p>
        </div>
        <button v-if="live.hasSession()" type="button" class="resume" @click="doResume">
          <span class="resume__dot"></span>
          <span class="resume__body">
            <strong>继续上次的规划</strong>
            <small>{{ live.failed === 'resume' ? '上次恢复失败' : '会话已保存在本地' }}</small>
          </span>
          <span class="resume__go">继续 ›</span>
        </button>
      </div>

      <!-- 最近会话（D14）：此前目标规划没有任何产品内回访入口——入口页无历史列表，
           其它页面只挂裸 /goal-conversation，深链 /goal-conversation/:id 可达但无处可点。
           本地记录最近几次会话的 id + 首句摘要，给出可点的深链回访入口。
           恢复卡正在显示的那条要从这里剔除：两块入口指向同一会话会让用户以为有两个规划。 -->
      <div v-if="visibleRecentGoals().length" class="recent">
        <span class="recent__title">最近会话</span>
        <ul class="recent__list">
          <li v-for="r in visibleRecentGoals()" :key="r.id">
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
        {{ CONNECT_FAIL_MSG }}<button type="button" class="errorbar__retry" @click="doRetry">重试</button>
      </div>
      <div v-else-if="live.stopped === 'start'" class="errorbar">
        已停止生成。<button type="button" class="errorbar__retry" @click="doRetry">重试</button>
      </div>

      <!-- 生成跟踪 pill 的入口态位置（P22 缺陷2 跨刷新常驻）：确认后刷新/重进目标页
           （本地无会话缓存）时，凭持久化的 pathId 恢复「正在生成」pill 与轮询——
           生成要在后端跑约 7 分钟，只挂在会话态里会随刷新消失。点击回路径列表。 -->
      <button
        v-if="genPill"
        type="button"
        class="gen-pill gen-pill--entry"
        :class="[`gen-pill--${genPill.tone}`]"
        @click="onGenPillClick"
      >
        <span class="gen-pill__dot" aria-hidden="true"></span>{{ genPill.text }}
      </button>

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
            :title="ATTACH_HINT"
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
            :title="STOP_WAIT_HINT"
            @click="live.stop()"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
          </button>
        </div>
        <div v-if="!isNarrow" class="composer__hint">
          <span class="composer__hint-shortcut">{{ SEND_SHORTCUT_HINT }}</span>
        </div>
      </div>
    </main>

    <!-- 会话态：work 只在方案弹层打开时放宽到 1180（≥1500 档），会话常态恒 880 居中 -->
    <main v-else class="work" :class="{ 'work--wide': showProposal }">
      <!-- 左：信息清单（移动端默认折叠为顶栏，点击展开；桌面端恒展开） -->
      <aside class="panel" :class="{ 'panel--collapsed': !panelExpanded }">
        <button type="button" class="panel__head" :aria-expanded="panelExpanded" @click="togglePanel">
          <!-- 「学情」+可折叠「画像」（2026-11-05 用户裁定）：这 7 项是给规划用的背景信息
               （想解决的问题 / 动机 / 经验 / 卡点 / 周期 / 时间 / 成功标准），不是 7 个学习目标；
               旧文案「目标 6/7」会让用户读成「我有 7 个目标」。
               2026-11-06 审计 §4：窄屏那行只留「画像」二字（桌面仍是「学情画像」）——
               右上角读作「画像 6/7」，与审计要求的措辞一致；字数不变，不挤占
               与阶段导航共享的那一行。 -->
          <strong><span class="panel__head-lead">学情</span><span class="panel__head-ext">画像</span></strong>
          <span class="panel__count"><span class="panel__count-k">已收集</span> {{ live.filledCount }} / {{ live.totalFields }}</span>
          <span class="panel__caret" aria-hidden="true">{{ panelExpanded ? '▾' : '▸' }}</span>
        </button>
        <!-- 面板背后的遮罩（2026-11-05 用户裁定）：窄屏面板是悬浮层，直接浮在聊天字上，
             右边还露出半截气泡的边角；压暗一层让面板成为唯一焦点，点遮罩即收起 -->
        <div v-if="panelOpen" class="panel__mask" aria-hidden="true" @click="togglePanel"></div>
        <div class="panel__body">
          <!-- 内容整体包进 .panel__scroll（2026-11-05）：窄屏面板内部滚动时半颗「清空重聊」
               被滚动视口硬切在底边。滚动发生在内层，底缘渐隐 mask 才能只作用于内容、
               不把面板自己的描边/圆角/投影一起淡掉（sticky 伪元素钉不进 padding 区，已试无效） -->
          <div class="panel__scroll">
          <div class="panel__bar"><i :style="{ width: (live.filledCount / live.totalFields) * 100 + '%' }"></i></div>
          <div class="panel__confidence">{{ stageLabel }}</div>

          <!-- 按状态分组（2026-11-06 走查「斑马纹」）：已收集的排上面、各成独立圆角浅灰块；
               待补充的收拢到底部，2 列紧凑小标签（不再每项占两行高） -->
          <ul class="checklist">
            <li
              v-for="f in doneFields"
              :key="f.key"
              class="field field--done"
              :class="{ 'field--fresh': f.fresh }"
            >
              <!-- 原型 .wf-field__mark：done = 绿 18% 浅底 + 绿字勾 -->
              <span class="field__mark">
                <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
              </span>
              <div class="field__body">
                <div class="field__label">{{ f.label }}</div>
                <div v-if="f.value" class="field__value">{{ f.value }}</div>
              </div>
            </li>
          </ul>
          <div v-if="todoFields.length" class="todo">
            <div class="todo__head">待补充维度（{{ todoFields.length }}）</div>
            <ul class="todo__tags">
              <li v-for="f in todoFields" :key="f.key" class="todo__tag"><span class="todo__o">○</span>{{ f.label }}</li>
            </ul>
          </div>
          </div>
          <!-- 移动端清空重聊入口（2026-11-05 UX 审计）：唯一入口 .chat__clear 在 ≤1100px
               被 display:none 后移动端无任何替代入口。窄屏头部一行已被阶段导航+学情画像
               药丸占满，这里收进悬浮面板底部（点「学情 6/7」两步可达）；
               桌面端仍走头部按钮，不重复。
               2026-11-05 二次调整：从滚动层里挪出来钉在面板底部——之前它在滚动层末尾，
               静止时整颗溶进底缘渐隐带里，用户以为按钮没了（本次反馈）；钉死后永远可见，
               滚动层里只剩清单本身，配合渐隐带也不会再出现半颗按钮 -->
          <button type="button" class="panel__clear" @click="doReset">清空重聊</button>
        </div>
      </aside>

      <!-- 右：聊天区 -->
      <section class="chat">
        <div class="chat__head">
          <ol class="stage-nav">
            <!-- 第 1 步与左栏 7 项清单的对应关系：澄清期在此直接给出「已收集 N/7」，
                 否则步骤条只说「澄清问题」、面板只说「继续澄清中」，读不出两者是同一步
                 （2026-10-08 用户侧走查）。窄屏该行与右上「目标」按钮共处一行、余量紧张，
                 ≤1100 隐藏（见文件末样式块），移动端计数由面板角标承担。 -->
            <!-- 极简面包屑（2026-11-05 屏效比）：胶囊叠胶囊退役——步标 i 由 stageMark
                 给出（已完成=✓ / 进行中=呼吸蓝点 / 未开始=序号），步骤间 CSS「›」连接 -->
            <!-- 随行「已收集 N/7」已撤（2026-11-06 走查）：PC 左栏画像卡常驻同一读数，
                 同屏两处计数是重复；移动端计数由面板角标承担（2026-10-08 判例随之退役） -->
            <li class="stage-nav__item" :class="stageCls(1)"><i>{{ stageMark(1) }}</i>澄清问题</li>
            <li class="stage-nav__item" :class="stageCls(2)"><i>{{ stageMark(2) }}</i>确认方案</li>
            <li class="stage-nav__item" :class="stageCls(3)"><i>{{ stageMark(3) }}</i>生成路径</li>
          </ol>
          <!-- 方案被 Esc/关闭后提供重开入口，消除「关掉就找不回」的死路
              （2026-10-31 起与输入区上方的协商入口条同一处理器） -->
          <button
            v-if="proposalDismissed && live.proposal && live.stage === 'proposing'"
            type="button"
            class="chat__show-proposal"
            @click="openProposalReview"
          >查看方案</button>
          <button type="button" class="chat__clear" @click="doReset">清空重聊</button>
        </div>

        <!-- 会话态内 start 失败：错误条 + 重试（初始态 errorbar 在此视图不渲染）；
             主动停止走「已停止」分支，不误报「连接失败」 -->
        <div v-if="live.failed === 'start' && !live.stopped" class="errorbar chat__errorbar">
          {{ CONNECT_FAIL_MSG }}<button type="button" class="errorbar__retry" @click="doRetry">重试</button>
        </div>
        <div v-else-if="live.stopped === 'start'" class="errorbar chat__errorbar">
          已停止生成。<button type="button" class="errorbar__retry" @click="doRetry">重试</button>
        </div>

        <!-- 不在整条消息流上挂 aria-live：流式重渲/每条新消息都会被读屏连播（含原始 JSON delta），
             收窄到下方等待条的 aria-live（P3） -->
        <div ref="scrollEl" class="chat__scroll" :class="{ 'chat__scroll--dim': showProposal, 'chat__scroll--pill': genPillVisibleInChat, 'chat__scroll--invite': proposalInviteVisible }" @scroll.passive="onScrollPin">
          <!-- AI 生成声明（移动端）：贴对话流顶部随滚（窄屏输入区下方被 tab 栏接管，放不下）；
               PC 档隐藏——声明已挪到输入框正下方与快捷键合并单行（2026-11-06 走查：
               免责行顶在第一条消息头上像报错提示） -->
          <div class="chat__ai-note"><AiContentNote /></div>
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
              <!-- 屏效比改造（2026-11-05）：「你 · 时间」戳撤除——功能性连续对话里单条时间无读者，
                   meta 行只在确有可操作项时渲染（只剩编辑铅笔；编辑入口归 meta 行的既有语义不变） -->
              <div v-if="!isProbeAnswer(km.msg.content) && canEditMessage(km.msg)" class="msg__meta">
                <button
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
                <!-- 历史轮次的快捷补充不再内联渲染（2026-11-05 屏效比「旧选项销毁」）：
                     胶囊完成点选使命后滞留历史既占空间又与用户已发出的回答重复，
                     唯一的活快选由下方 .replies 常驻面板承担（只挂最新 AI 轮） -->
                <!-- streaming 复用为「不可重生成」口径（同 V2LearningPage）：失败气泡的
                     恢复动作只留内联「重试」——它对 start/confirm/supplement/reply 四种
                     失败都能正确重放，而悬浮「重新生成」遇到无前驱用户消息的失败
                     （如 start 失败）只会 toast「找不到对应的问题」死路 -->
                <MessageActions
                  :show="hoveredMsgId === km.key"
                  :streaming="live.sending || km.msg.failed"
                  :copy-handler="() => copyMessage(km.msg.content)"
                  @regenerate="regenerateMessage(km.msg)"
                  @feedback="(up) => sendMessageFeedback(km.msg, up)"
                />
                <!-- 屏效比改造（2026-11-05）：「问流 · 时间」戳撤除；meta 行只在失败时渲染（只剩内联重试） -->
                <div v-if="km.msg.failed" class="msg__meta">
                  <button type="button" class="msg__retry" @click="doRetry">重试</button>
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
              <div class="msg__meta" aria-live="polite">{{ chatWaitMeta }}</div>
            </div>
          </div>

          <!-- 流式渐进渲染：SSE delta 实时累积（goal skill 为 JSON 输出，展示原始模型文本；
               final 到达后由官方消息替换，避免双泡；方案浮层打开时不重复展示，浮层内已有流式进度） -->
          <div v-if="live.sending && live.streamingText && !showProposal" class="msg msg--ai">
            <span class="msg__avatar"><img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" alt="问流" /></span>
            <div class="msg__content msg__content--actions">
              <div class="msg__bubble msg__bubble--html msg__bubble--streaming" v-html="formatMessage(live.streamingText)"></div>
              <div class="msg__meta">{{ chatWaitMeta }}</div>
            </div>
          </div>

          <!-- 快捷补充选项（skill 每轮返回）：对齐原型 .wf-replies —— 去白面板与面板头，
               改整行 .wf-reply 按钮组（蓝描边 + 蓝 5% 底 + 前置 6px 蓝点，选中变 ✓）。
               勾选语义不变：点选打勾进输入框，再点取消 -->
          <div v-if="!live.sending && repliesActive && live.quickReplies.length && live.stageIndex < 3" class="replies">
            <!-- 可见标签已移除（2026-11-03 用户反馈「直接不要这个提示」）：快选用法说明只保留给读屏器 -->
            <span class="visually-hidden">快捷补充：点选填入输入框，可多选</span>
            <button
              v-for="q in availableReplies"
              :key="q.text"
              type="button"
              class="reply"
              :class="{ 'reply--on': pickedReplySet.has(q.text.trim()) }"
              @click="pickReply(q.text)"
              @keydown.enter.prevent="keyboardReply(q.text)"
              @keydown.space.prevent="keyboardReply(q.text)"
            >{{ q.text }}</button>
          </div>
        </div>
        <!-- 生成状态 pill（走查 2026-11-01 P22 / 2026-11-02 P22 复验）：确认生成后选「留在本页」关掉浮层，
             页面上除步条第 3 步高亮外没有任何持续状态，用户不知道生成还在不在走。
             2026-11-02 起跟真实状态：拿到 pathId 后轮询 generation-status（复用 /learning-paths
             的接口与节奏），文案与终态由 genPillCopy 统一映射——生成未确认完成前不给平静终态。
             浮层出现期间让位（genPill 返回 null）——浮层内已有同等进度，双份状态互相抢焦点。
             放在消息区与输入区之间：桌面/移动同位，不与移动端「目标信息」锚点带抢位置。 -->
        <button
          v-if="genPill"
          type="button"
          class="gen-pill"
          :class="[`gen-pill--${genPill.tone}`]"
          @click="onGenPillClick"
        >
          <span class="gen-pill__dot" aria-hidden="true"></span>{{ genPill.text }}
        </button>
        <!-- 方案协商入口（2026-10-31 一锤定音修复）：proposing 不再自动盖 modal，
             方案先在对话流里完整呈现、可直接回复继续调整（一轮二轮都行）；
             这颗按钮是显式确认入口——点开方案卡审阅，确认动作仍只发生在卡内 -->
        <!-- 方案预览微卡片（2026-11-05 用户裁定方案 A）：左侧填方案摘要（此前 70% 空黑读作渲染 Bug），
             副行优先承接 entryCopy.hint（导师追问/自测未答的语境），就绪态给阶段摘要 -->
        <div v-if="loggedIn && live.started && !live.sending && live.stage === 'proposing' && live.proposal && !showProposal" class="proposal-invite">
          <span class="proposal-invite__doc" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5L14 3.5zM8 12h8v1.5H8V12zm0 4h8v1.5H8V16z"/></svg></span>
          <div class="proposal-invite__text">
            <strong class="proposal-invite__title">学习方案 · 待确认</strong>
            <span v-if="entryCopy.hint" class="proposal-invite__sub">{{ entryCopy.hint }}</span>
            <span v-else-if="live.proposal?.stages?.length" class="proposal-invite__sub">共 {{ live.proposal.stages.length }} 个阶段 · {{ live.proposal?.outcome || '可直接确认生成路径' }}</span>
          </div>
          <button type="button" class="btn-primary proposal-invite__btn" @click="openProposalReview">{{ entryCopy.button }}</button>
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
          :class="{ 'composer--locked': showProposal }"
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
              :title="ATTACH_HINT"
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
              :disabled="startFailed || showProposal"
              @keydown.enter.exact.prevent="doSend"
            ></textarea>
            <span v-if="boxDropping" class="composer__drop-hint">松开上传到资料</span>
            <!-- 发送/停止 同位置切换：生成中变停止（主流聊天交互，位置固定不占额外空间）；
                 方案浮层打开期间两者一并锁定（P21）：遮罩物理挡住它们，此前保持可点外观、
                 点了没反应——禁用 + 哑火（.composer--locked）让「不能发」可见可预期 -->
            <button
              v-if="!live.sending"
              type="button"
              class="composer__send"
              :class="{ 'composer__send--off': startFailed || showProposal || !input.trim() }"
              :disabled="startFailed || showProposal || !input.trim()"
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
              :title="STOP_WAIT_HINT"
              :disabled="showProposal"
              @click="live.stop()"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
            </button>
          </div>
        </div>
        <!-- 输入框正下方的合并元数据行（2026-11-06 走查）：AI 声明 + 快捷键同一行居中浅灰小字；
             字数计数 3500 起在此浮现（2026-11-05 判例沿用）。PC 档专属——移动端该位置被
             底部导航接管，声明仍走对话流顶部的 .chat__ai-note -->
        <div v-if="loggedIn && live.started" class="chat__under-hint">
          <AiContentNote />
          <span class="chat__under-hint-sep">·</span>
          <span class="chat__under-hint-shortcut">{{ SEND_SHORTCUT_HINT }}</span>
          <span v-if="input.length >= 3500" class="composer__count">{{ input.length }} / {{ INPUT_MAX }}</span>
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
           body（rows + 大纲 + 自测 + 提示）/ 贴底 foot（ghost「再补充」+ primary「确认」）。
           readOnlyReview：generating/done 期的只读回看（方案已消费，foot 只给「返回」） -->
      <div v-if="reviewVisible" class="proposal">
        <div class="proposal__head">
          <div class="proposal__head-text">
            <span class="proposal__eyebrow">{{ readOnlyReview ? '路径预览 · 已确认' : '路径预览 · 请确认' }}</span>
            <h2 class="proposal__title">为你整理的学习方向</h2>
          </div>
          <button
            type="button"
            class="proposal__x"
            aria-label="关闭方案确认"
            :title="CLOSE_ESC_HINT"
            @click="dismissProposalX"
          >×</button>
        </div>

        <div class="proposal__body">
        <div class="proposal__rows">
          <div v-if="reviewProposal?.problem" class="proposal__row">
            <span>核心问题</span>
            <p>{{ reviewProposal.problem }}</p>
          </div>
          <div v-if="reviewProposal?.outcome" class="proposal__row">
            <span>预计产出</span>
            <p>{{ reviewProposal.outcome }}</p>
          </div>
        </div>

        <div v-if="reviewProposal?.stages.length" class="proposal__stages">
          <span class="proposal__stages-label">路径大纲 · {{ reviewProposal.stageCount }} 个阶段</span>
          <ol>
            <li v-for="(s, i) in reviewProposal.stages" :key="i" class="pstep"><i>{{ i + 1 }}</i><div><strong>{{ stageHead(s) }}</strong>{{ stageTail(s) }}</div></li>
          </ol>
        </div>

        <!-- 前置自测：帮路径更贴合基础。2026-11-02 口径重做——作答是本地表单动作，
             不再每答一题发一个对话回合（两题场景会把面板锁死 30-90s 且题目随重渲染漂移）；
             作答随「确认，生成我的路径」一次性提交，可随时改选。 -->
        <div v-if="reviewProposal?.probes && reviewProposal.probes.length" class="proposal__probes">
          <span class="proposal__stages-label">快速自测（可选）</span>
          <div v-for="p in reviewProposal.probes" :key="p.probeId" class="probe">
            <p class="probe__q">{{ p.question }}</p>
            <div class="probe__opts">
              <button
                v-for="o in p.options"
                :key="o.id"
                type="button"
                class="probe__opt"
                :class="{ 'probe__opt--on': live.probeAnswers[p.probeId] === o.id }"
                :disabled="live.sending || readOnlyReview"
                @click="pickProbe(p, o.id)"
              ><b>{{ o.id }}</b> {{ o.text }}</button>
            </div>
          </div>
          <p v-if="probeReceipt" class="probe__receipt">{{ probeReceipt }}</p>
          <!-- 换题保护：方案重渲染换了题/少一道时，已作答按题号失配会静默失效（回执从 2/2 掉回去），
               这里明说「失效了几题、请重答」，不让作答无声蒸发（2026-11-02 业务口径） -->
          <p v-if="live.droppedProbeAnswers" class="probe__receipt probe__receipt--warn">
            方案更新后题目变了，之前答过的 {{ live.droppedProbeAnswers }} 道已失效，请重新作答。
          </p>
        </div>

        <div v-if="confirmError && !readOnlyReview" class="errorbar">
          确认失败，请重试。<button type="button" class="errorbar__retry" @click="doConfirm">重试</button>
        </div>

        <div class="proposal__note">
          <span v-if="materialCount">已上传 {{ materialCount }} 份资料，生成路径时按目标相关性选用，其余保留在资料库。</span>
          <AiContentNote />
        </div>
        </div><!-- /.proposal__body（内容滚动区） -->

        <!-- sticky foot：贴卡片底，不随 body 滚走（原型 .wf-dialog__foot 的位置语义） -->
        <div class="proposal__foot">
          <!-- 真按钮而非 span[role=button]：Space 键触发、禁用语义免手工维护（E2E 自动化也靠 button 语义定位） -->
          <!-- 只读回看（2026-11-05 UX 审计）：generating/done 期回看已确认方案，不给确认/补充动作（方案已消费） -->
          <template v-if="readOnlyReview">
            <button type="button" class="btn-primary" @click="closeReadOnlyReview">返回</button>
          </template>
          <template v-else>
            <!-- 「再补充点信息」改道聊天流（2026-11-05 用户裁定）：补充不开浮层内表单——
                 退回聊天界面像发普通消息一样补充，AI 更新方案后从「查看方案」再回来确认 -->
            <button type="button" class="btn-ghost" @click="supplementViaChat">再补充点信息</button>
            <button type="button" class="btn-primary btn-primary--lg" @click="doConfirm">确认，生成我的路径</button>
          </template>
        </div>
      </div>

      <!-- 生成中 -->
      <div v-else-if="phase === 'generating'" class="proposal proposal--center">
        <span class="spinner"></span>
        <h2 class="proposal__title">正在生成你的路径…</h2>
        <!-- 等待态只讲两件事：还要多久、完成后去哪看。「可以离开」由下方的
             proposal__note 单独承担，同一屏不再说两遍（2026-10-29 全站副文审计） -->
        <p class="proposal__generating-note">{{ genWaitText }} · 根据 {{ live.filledCount }} 条已确认信息拆解。完成后会出现在路径列表。</p>
        <div class="skeleton"><i style="width: 82%"></i><i style="width: 64%"></i><i style="width: 74%"></i></div>
        <!-- 生成阶段模型输出是 JSON（对用户不可读）：delta 阶段给中性进度文案，不直出原始流（P3） -->
        <div class="proposal__stream">
          <span class="proposal__stream-label">生成进度</span>
          <p class="proposal__stream-text">正在逐项整理方案内容，完成后会自动展示。</p>
        </div>
        <div class="proposal__note">可以离开本页，生成进度会保留。</div>
        <!-- 回看方案（2026-11-05 UX 审计）：确认后提案浮层即被生成面板取代，原两个重开入口
             都以 stage=proposing 为门槛——生成期再无入口可复查刚确认过的方案。这里给只读回看。 -->
        <button v-if="proposalSnapshot" type="button" class="proposal__stop" @click="openReadOnlyReview">回看已确认的方案</button>
        <button type="button" class="proposal__stop" @click="live.stop()">
          <svg viewBox="0 0 24 24" width="12" height="12"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
          停止生成
        </button>
      </div>

      <!-- 生成结束（两态）：正常 = 路径已创建；分诊硬阻断 = 不生成路径，给阻断说明与补充重判退路
           （2026-11-05 UX 审计 P0：此前硬阻断信封也弹「路径已创建 · 生成中」假成功）
           合并取舍：采用 develop 的「同一张 done 卡片内分两态」结构（本分支此前是在卡片外另开
           一个 v-else-if 面板，两处并行会同时渲染出两张卡）。本分支的 #213 资产不丢——
           服务端落库的拒绝原文仍在阻断态里展示，见下方 hardBlocked 分支。 -->
      <div v-else-if="phase === 'done'" class="proposal proposal--center">
        <button
          type="button"
          class="proposal__x proposal__x--corner"
          aria-label="关闭"
          :title="CLOSE_ESC_HINT"
          @click="proposalDismissed = true"
        >×</button>
        <!-- 阻断态判据：优先服务端结构化 hardBlocked；老信封没有该字段时，
             回落到本分支 #213 的拒绝原文（completionNote 非空即硬阻断），两条都成立才判定态。 -->
        <template v-if="live.hardBlocked || live.completionNote">
          <!-- 阻断态：中性图标 + 事实标题，动作只有「留在本页」（补充说明在对话输入框发送，服务端会重判） -->
          <span class="done-ring done-ring--blocked" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-8h-2v5h2V8z"/></svg>
          </span>
          <h2 class="proposal__title">这一目标暂不会生成学习路径</h2>
          <!-- 有服务端落库的拒绝原文就直接展示（用户要知道「为什么」）；没有才回落到通用说明。 -->
          <p class="proposal__generating-note">{{ live.completionNote || '完整说明已在对话里给出。情况有变化时，回复补充说明，问流会结合补充重新判断。' }}</p>
          <div class="proposal__actions proposal__actions--center">
            <button type="button" class="btn-primary btn-primary--lg" @click="proposalDismissed = true; proposalReviewRequested = false">回到对话</button>
          </div>
        </template>
        <template v-else>
        <span class="done-ring">
          <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
        </span>
        <!-- 2026-10-10 走查 W7：此处原写「路径已生成」，与「我的路径」页紧接的
             「主结构生成中，一般 1-2 分钟内完成…」并置矛盾（实为主结构已创建、生成刚启动）。
             改为与事实一致的「已创建 + 正在生成」两段式。 -->
        <h2 class="proposal__title">路径已创建</h2>
        <!-- 只保留「还在生成」这一条会改变预期的事实；去哪看进度由正下方的
             「查看我的路径」按钮表达，不再在句子指一次路（2026-10-29 全站副文审计）。
             P22 缺陷3：句子跟随 generation-status 真实状态——生成完成后不再说
             「还在生成中」，换成完成/失败的事实（见 doneGenNote）。 -->
        <p class="proposal__generating-note">{{ doneGenNote }}</p>
        <div class="proposal__actions proposal__actions--center">
          <button type="button" class="btn-primary btn-primary--lg" @click="goPaths">查看我的路径</button>
          <!-- 只在方案还在（stage=proposing）时给「返回方案」：否则点了只是关浮层，无路可回 -->
          <button v-if="live.stage === 'proposing' && live.proposal" type="button" class="btn-ghost" @click="phase = 'preview'; proposalReviewRequested = false">返回方案</button>
          <!-- 留在本页：done 态此前只有 Esc 一个退出途径（触屏无 Esc），补显式次级出口 -->
          <button type="button" class="btn-ghost" @click="proposalDismissed = true; proposalReviewRequested = false">留在本页</button>
        </div>
        </template>
        <!-- 回看方案（同生成中态）：done 态方案数据已被确认消费，用页面快照承接只读回看 -->
        <button v-if="!live.hardBlocked && proposalSnapshot" type="button" class="proposal__stop" @click="openReadOnlyReview">回看已确认的方案</button>
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
import { forgetRecentGoalForUser, loadRecentGoalsForUser, rememberRecentGoalForUser, withoutResumedEntry, type RecentGoalEntry } from '@/utils/recentGoals';
import { isProbeAnswer, probeAnswerParts } from './probeAnswer';
import V2Nav from './V2Nav.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import MessageActions from '@/components/chat/MessageActions.vue';
import MaterialUploadArea from '@/components/learning/MaterialUploadArea.vue';
import { hasUserSession } from '@/utils/api';
import { useUserStore } from '@/stores/user';
import { currentUserId, dropLegacyRecentGoalsStorage, getGoalConversationCid, clearGoalGenTracking, getGoalGenTracking, setGoalGenTracking } from '@/utils/sessionCleanup';
import { cachedMessageHtml, plainMessageHtml } from '@/utils/messageMarkdown';
import { toast } from '@/utils/toast';
import { copyText } from '@/utils/clipboard';
import { feedbackApi } from '@/api/feedback';
import { askConfirm } from '@/views/admin-redesign/useConfirm';
import { isAwaitingAnswer, proposalEntryCopy } from './goalStageCopy';
import { learningAPI, type GenerationLifecycleDTO } from '@/api/learning';
import { genPillCopy, genStageLabel, isGenerationSettled } from './learningPathProgress';

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
/* 短字段双列（2026-11-05 用户裁定）：期望周期 / 可用时间通常只有「30 天」「25 分钟」几个字，
   各占一整行把面板撑到要滚动；这两项改半宽小卡并排，面板一屏更装得下 */
/* 双视图（初始态/会话态）各自渲染一份的错误条与输入提示，文案收成单源避免改一处漏一处 */
const CONNECT_FAIL_MSG = '连接失败，没能开始对话。';
const ATTACH_HINT = '添加资料：PDF / Word / PPT / Excel / TXT / Markdown，也可以直接拖到输入框';
const SEND_SHORTCUT_HINT = 'Enter 发送 · Shift+Enter 换行';
/** 生成中发送键变成停止方块：补一句 hover 说明，纯图标按钮不靠自己猜 */
const STOP_WAIT_HINT = '停止等待回复';
const CLOSE_ESC_HINT = '关闭（Esc）';
/* 首轮 start 失败且尚无任何 AI 回复：底部输入框不能继续「假装能问」，否则用户会再次失败 */
const startFailed = computed(() => live.failed === 'start' && !live.stopped);
/* 移动端输入框 placeholder 缩短（长文案换行后被裁，占两行以上无法完整显示） */
const entryPlaceholder = computed(() => isNarrow.value ? '先说说你想解决什么…' : '先说说你最近想解决什么，或现在卡在哪里…');
const chatPlaceholder = computed(() => {
  // 浮层打开期间输入区随遮罩锁定（P21 走查）：占位符改为交代「为什么发不了、出路在哪」。
  // 三个分支各说各的事实：Esc 只在审阅/完成态能关浮层，generating 态只能等或停止；
  // 不写「上方/下面」这类方位指路（文案门禁 R2）
  if (showProposal.value) {
    if (phase.value === 'generating') return '正在生成路径，进度见弹窗';
    if (phase.value === 'done') {
      // 合并取舍：develop 的硬阻断分支 + 本分支「done 但确实没有路径」的兜底。
      // 只取 develop 会把「非硬阻断的异常无路径态」说成「路径已创建」（假成功正是它的反面）。
      if (live.hardBlocked) return '这一目标不会生成路径，可回对话补充说明';
      return live.learningPath
        ? '路径已创建，先在弹窗里选择下一步'
        : '本次没有生成学习路径，原因见弹窗';
    }
    return '先处理方案确认弹窗，Esc 可回到对话';
  }
  // 不写「上方」：输入框与重试按钮同屏，点哪儿由位置自明（文案门禁 R2）
  if (startFailed.value) return '首轮对话失败，请先重试';
  return isNarrow.value ? '回答问题，或补充基础、时间…' : '回答导师的问题，或补充你的基础、时间和限制…';
});
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

/** 稳定 key 渲染消息列表（失败气泡移除/追加时避免 DOM 复用错乱） */
const keyedMessages = computed(() =>
  live.messages.map((m, i) => ({ key: m.id ?? `i_${i}`, msg: m }))
);
/** 快捷补充挂载门控（2026-11-05 屏效比「旧选项销毁」）：只在最新一条消息是 AI 时挂载——
    用户一旦回复（点胶囊或手动打字），上一轮胶囊立刻消失；AI 新回合到位时换装本轮新选项 */
const repliesActive = computed(
  () => live.messages.length > 0 && live.messages[live.messages.length - 1]?.role === 'ai'
);
/* 本轮导师是否还在提问（2026-10-31 用户走查）：proposing 轮的提问会让「方案已就绪」与
   「我还有个问题」同时成立——用户不知道该回答还是该确认。判据见 goalStageCopy.ts。 */
const awaitingAnswer = computed(() => {
  for (let i = live.messages.length - 1; i >= 0; i -= 1) {
    if (live.messages[i].role === 'ai') return isAwaitingAnswer(live.stage, String(live.messages[i].content || ''));
  }
  return false;
});
/** 未作答的自测题数（0 = 没有题或已答完）：入口条据此把「有题可答」挑明 */
const unansweredProbes = computed(() => {
  const { answered, total } = live.probeProgress();
  return Math.max(0, total - answered);
});
const entryCopy = computed(() => proposalEntryCopy(awaitingAnswer.value, unansweredProbes.value));
/* 快选行不再显示可见标签（2026-11-03 用户反馈「直接不要这个提示」）：
   「也可以直接选（点选填入输入框，可多选）」及按阶段变体、只教一次的逻辑一并移除，
   用法说明只保留给读屏器。 */

/* 自测作答回执：作答是本地表单（不逐题发回合），要让用户看见「记下了、确认时一起提交」，
   否则点完没有任何反馈，和「点了没反应」分不开。 */
const probeReceipt = computed(() => {
  const { answered, total } = live.probeProgress();
  if (!answered || !total) return '';
  return answered >= total ? `已答 ${total} 题，会随确认一起提交` : `已答 ${answered} / ${total} 题`;
});

onMounted(() => {
  window.addEventListener('keydown', onProposalKey);
  window.addEventListener('resize', onViewportResize);
  window.addEventListener('resize', syncOverlayTop);
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
  // 生成跟踪恢复（P22 缺陷2）：本地记着 pathId 且仍在生成 → 重显 pill 并续轮询。
  // 放 onMounted（而非 immediate watcher）：genTrack 声明在下方，避免引用未初始化绑定。
  void restoreGenTracking();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onProposalKey);
  window.removeEventListener('resize', onViewportResize);
  window.removeEventListener('resize', syncOverlayTop);
  window.visualViewport?.removeEventListener('resize', onViewportResize);
  narrowMq?.removeEventListener('change', onNarrowChange);
  // 离页/刷新前把在途草稿落盘（防抖窗口内未落的那一版）
  window.clearTimeout(draftTimer);
  saveDraft();
  // 生成状态轮询只属于本页存活期：离页即停，不留后台常驻请求（P22 缺陷4 修法要求）
  stopGenPolling();
});

/** 清回初始态（内存 + 组件局部状态；live.resetView 保留 localStorage 恢复入口） */
function resetToEntry() {
  live.resetView();
  phase.value = 'preview';
  input.value = '';
}

/** 路由 cid 恢复入口：失败且本地无会话可回退时明示——否则坏 cid 链接打开
    只见全新初始页，用户以为内容丢了（P2）；本地有会话时初始页已有
    「恢复失败，点这里重试」按钮承接，不重复弹 */
function resumeFromRoute(cid: string) {
  void live.resumeById(cid).then((ok) => {
    if (!ok && !live.hasSession()) toast.error('原会话未能恢复，请从最近会话重试或开始新规划');
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
/** 最近列表剔除恢复卡指向的那条（同一条会话不出现两个入口）。与 live.hasSession() 一样
    在渲染时现取本地会话 id：它随会话开始/重置变化，不挂在响应式源上，函数调用才是最新值。 */
function visibleRecentGoals(): RecentGoalEntry[] {
  return withoutResumedEntry(recentGoals.value, getGoalConversationCid());
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
    // 切号：上一账号的生成跟踪作废，改读新账号的持久键（键按 userId 作用域）
    stopGenPolling();
    genTrack.value = null;
    void restoreGenTracking();
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
/** 快捷 chip 的激活路径（走查 2026-11-01 P24）：chips 是多选勾选语义——点击 = 填入、
    再点 = 取消。原生 button 的 Enter/Space 等价一次点击：点选后焦点仍留在 chip 上，
    用户按 Enter 想发送，实际触发的是「取消」——刚填入的选项被反选、输入框静默清空、
    无任何请求。两条修法（多选勾选语义保持不变）：
    1) 任何激活（点击/键盘）后把焦点交还输入框——下一次 Enter 落在 textarea 上就是发送；
    2) 键盘 Enter/Space 只做「填入」半边：已勾选的 chip 再按只还焦点、不反选，
       杜绝键盘路径上的静默丢字（取消仍可点 chip，或聚焦后直接编辑输入框文本）。 */
function focusComposerInput() {
  void nextTick(() => (chatInputEl.value ?? entryInputEl.value)?.focus());
}
function pickReply(text: string) {
  toggleReply(text);
  focusComposerInput();
}
/** 作答自测题：本地记下答案，并收起「题目已更新」提示（用户已知悉换题） */
function pickProbe(probe: { probeId: string }, optionId: string) {
  live.answerProbe(probe, optionId);
  live.acknowledgeProbeChange();
}
function keyboardReply(text: string) {
  if (pickedReplySet.value.has(text.trim())) {
    focusComposerInput();
    return;
  }
  pickReply(text);
}
/** 面板选项 = 当前轮全部快选，常驻展示（不随选中隐藏，保证再点可取消） */
const availableReplies = computed(() => currentQuickReplies.value);
/** 已选中的快选文本集合（驱动勾选态样式） */
const pickedReplySet = computed(() => new Set(input.value.split('\n').map((s) => s.trim()).filter(Boolean)));
const scrollEl = ref<HTMLElement | null>(null);
const phase = ref<'preview' | 'generating' | 'done'>('preview');
/* 只读回看（2026-11-05 UX 审计）：确认进入生成期后，方案卡的两个重开入口都以
   stage=proposing 为门槛，用户再无入口复查自己刚确认过的方案。方案数据在确认响应
   落地后随信封清空（completed ext 不带 confirmedProposal），这里在页面留存最后一份
   快照供只读回看；foot 只给「返回」，不给确认/补充动作（方案已消费）。 */
const proposalSnapshot = ref<NonNullable<ReturnType<typeof useGoalLive>['proposal']> | null>(null);
watch(() => live.proposal, (p) => { if (p) proposalSnapshot.value = p; }, { immediate: true });
const readOnlyReview = ref(false);
const reviewReturnPhase = ref<'generating' | 'done'>('done');
/** 预览卡的展示条件：正常确认流（phase=preview + 实时方案）或只读回看（快照）。
    回看期间 phase 保持 generating/done 不变——生成计时与 phase 对齐 watch 都不被打断。 */
const reviewVisible = computed(() =>
  readOnlyReview.value
    ? !!proposalSnapshot.value
    : phase.value === 'preview' && !!live.proposal
);
/** 预览卡渲染的方案数据：回看用快照，正常流用实时方案 */
const reviewProposal = computed(() => (readOnlyReview.value ? proposalSnapshot.value : live.proposal));
function openReadOnlyReview() {
  if (!proposalSnapshot.value) return;
  reviewReturnPhase.value = phase.value === 'generating' ? 'generating' : 'done';
  readOnlyReview.value = true;
  confirmError.value = false;
  proposalDismissed.value = false;
  proposalReviewRequested.value = false;
}
function closeReadOnlyReview() {
  readOnlyReview.value = false;
}
/** 预览卡 ×：回看态返回原相位；正常确认流关闭浮层（可从「查看方案」重开） */
function dismissProposalX() {
  if (readOnlyReview.value) { closeReadOnlyReview(); return; }
  proposalDismissed.value = true;
  proposalReviewRequested.value = false;
}
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
  [Infinity, '正在收尾…'],
];
function stageText(stages: Array<[number, string]>) {
  for (const [until, text] of stages) if (waitTick.value < until) return text;
  return stages[stages.length - 1][1];
}
const chatWaitText = computed(() => stageText(CHAT_WAIT_STAGES));
const genWaitText = computed(() => stageText(GEN_WAIT_STAGES));
/** 等待 5 秒后才显示已等待秒数：短回合不闪数字，长回合用户能看到确实在走 */
const chatWaitMeta = computed(() =>
  waitTick.value >= 5 ? `${chatWaitText.value} · 已等待 ${waitTick.value}s` : chatWaitText.value
);
/* 用户消息内联编辑（仅最后一条用户消息可编辑） */
const editingMsgId = ref<string | null>(null);
const editingText = ref('');
const confirmError = ref(false);

/* ---------- 消息操作 ---------- */
const hoveredMsgId = ref<string | null>(null);
function onBubbleEnter(id: string) { hoveredMsgId.value = id; }
function onBubbleLeave() { hoveredMsgId.value = null; }

/** 复制消息正文（与课堂侧同口径：局域网 http 下 Clipboard API 不可用，回退 execCommand） */
async function copyMessage(text: string): Promise<boolean> {
  const ok = await copyText(text);
  if (ok) toast.success('已复制到剪贴板');
  else toast.error('复制失败：浏览器未授予剪贴板权限，请手动选中文字复制');
  return ok;
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

/* 学情画像按状态分组（2026-11-06 走查「斑马纹」）：已收集在上、待补充收拢底部 */
const doneFields = computed(() => live.fields.filter((f) => f.status === 'done'));
const todoFields = computed(() => live.fields.filter((f) => f.status !== 'done'));
const stageLabel = computed(() => {
  /* generating 与 stageIndex 无关：stageIndex 只在 stage 落库时翻转（proposing→ready），
     而「确认，生成我的路径」按下时 stageIndex 仍是 3 —— 此时面板顶还写「可生成路径」，
     与屏幕上正在转的生成浮层互相矛盾，读起来像还停在「等你点确认」。 */
  if (phase.value === 'generating') return '生成中…';
  if (live.stageIndex === 3) return '可生成路径';
  if (live.stageIndex === 2) return '方案确认中';
  /* 澄清期状态字由 7 项清单**推导**，不再恒为「继续澄清中」：
     1/7、4/7、5/7 三屏原先同字，用户读不出「还差什么、什么时候进下一步」。
     还差 N 项直接对得上左栏计数器与进度条，收满即说明该轮到「确认方案」。 */
  const remain = Math.max(0, live.totalFields - live.filledCount);
  return remain > 0 ? `还差 ${remain} 项关键信息` : '关键信息已收齐';
});

/* ---------- 真实生成进度跟踪（走查 2026-11-02 P22） ----------
   确认约 1.5s 后端就落路径记录、会话 isCompleted，但阶段/课时生成还在后端跑（实测约 7 分钟）。
   会话 phase 只能证明「任务受理」，不能证明「生成完成」——pill 与完成弹层注一律以
   generation-status（复用 /learning-paths 的接口与 5s 节奏）为准。 */
const genTrack = ref<{ pathId: string; lc: GenerationLifecycleDTO | null } | null>(null);
let genPollTimer = 0;
let genPollFails = 0;
/** 轮询间隔与列表页 schedulePolling 同节奏 */
const GEN_POLL_MS = 5000;
function stopGenPolling() {
  if (genPollTimer) { window.clearTimeout(genPollTimer); genPollTimer = 0; }
}
function scheduleGenPolling() {
  stopGenPolling();
  if (!genTrack.value) return;
  genPollTimer = window.setTimeout(() => { void pollGenStatus(); }, GEN_POLL_MS);
}
async function pollGenStatus() {
  const track = genTrack.value;
  if (!track) return;
  try {
    const lc = await learningAPI.getPathGenerationStatus(track.pathId);
    // 跟踪目标已被替换（重新确认出了新路径）：过期响应丢弃
    if (genTrack.value?.pathId !== track.pathId) return;
    genPollFails = 0;
    genTrack.value = { pathId: track.pathId, lc };
    if (isGenerationSettled(lc)) {
      // 终态已确认：清持久键（下次挂载不再回查），pill 保留终态直至离页
      clearGoalGenTracking(recentGoalsUserId.value);
      stopGenPolling();
      return;
    }
    scheduleGenPolling();
  } catch {
    if (genTrack.value?.pathId !== track.pathId) return;
    // 单次失败静默续轮询；连续多次失败停表（状态接口不可用时不空转，与列表页断路口径一致）
    genPollFails += 1;
    if (genPollFails < 6) scheduleGenPolling();
  }
}
/** 会话内拿到 pathId（确认信封 / 恢复信封）即开始跟踪并持久化（跨刷新恢复用） */
function trackPathGeneration(pathId: string) {
  if (genTrack.value?.pathId === pathId) return;
  stopGenPolling();
  genPollFails = 0;
  genTrack.value = { pathId, lc: null };
  setGoalGenTracking(recentGoalsUserId.value, pathId);
  scheduleGenPolling();
}
/** 挂载/切号恢复（P22 缺陷2）：本地记着 pathId 且其仍在生成 → 重显 pill 并续轮询。
    终态则清键；状态接口暂不可得则本次不显示（下次挂载再试），不凭空造进行态。 */
let genRestoreSeq = 0;
async function restoreGenTracking() {
  const seq = ++genRestoreSeq;
  const saved = getGoalGenTracking(recentGoalsUserId.value);
  if (!saved?.pathId || genTrack.value?.pathId === saved.pathId) return;
  try {
    const lc = await learningAPI.getPathGenerationStatus(saved.pathId);
    if (seq !== genRestoreSeq || genTrack.value?.pathId === saved.pathId) return;
    if (isGenerationSettled(lc)) {
      clearGoalGenTracking(recentGoalsUserId.value);
      return;
    }
    genPollFails = 0;
    genTrack.value = { pathId: saved.pathId, lc };
    scheduleGenPolling();
  } catch {
    /* 状态不可得：不显示、不轮询，等下次挂载 */
  }
}
watch(
  () => live.learningPath?.id,
  (pathId) => {
    if (pathId) trackPathGeneration(pathId);
  },
  { immediate: true }
);

/* 生成状态 pill（走查 2026-11-01 P22 / 2026-11-02 复验）：只在浮层被关掉（「留在本页」/Esc）后承担持续指示。
   确认在途按等待时长给阶段字（刻度同 GEN_WAIT_STAGES）；pathId 在手后一切以 generation-status
   为准（genPillCopy 统一映射）：生成中带真实阶段、完成给 done 终态（点击去路径详情）、失败给
   fail（点击去路径列表的重试入口）。跟踪未建立的短暂窗口给进行态过渡——生成未确认完成前
   不得给平静终态（P22 缺陷1）。浮层打开期间返回 null 让位。 */
const genPill = computed(() => {
  if (!live.started && !genTrack.value) return null;
  // 分诊硬阻断终局：不会生成路径，「路径已创建 · 生成中」类状态条一律不显示（P0 假成功）
  if (live.hardBlocked) return null;
  if (showProposal.value) return null;
  if (phase.value === 'generating') {
    const stage = waitTick.value < 8 ? '梳理目标' : waitTick.value < 25 ? '拆解阶段' : waitTick.value < 60 ? '排布任务' : '即将完成';
    return { tone: 'run' as const, text: `正在生成路径 · ${stage}` };
  }
  if (genTrack.value) {
    return genPillCopy(genTrack.value.lc);
  }
  if (phase.value === 'done') {
    // #213：无路径即硬阻断终局——不谎称「路径已创建」，也不跟踪一个不存在的生成任务。
    return live.learningPath ? { tone: 'run' as const, text: '路径已创建 · 生成中' } : null;
  }
  if (confirmError.value) {
    return live.stopped === 'confirm'
      ? { tone: 'fail' as const, text: '已停止生成' }
      : { tone: 'fail' as const, text: '确认失败' };
  }
  return null;
});

/** pill 点击：done 去路径详情；fail 去路径列表（失败卡上有重试）；
    进行态回浮层面板（会话态）或去路径列表（入口态无浮层可回） */
function onGenPillClick() {
  const pill = genPill.value;
  if (!pill) return;
  if (pill.tone === 'done' && genTrack.value?.pathId) {
    router.push(`/learning-path/${genTrack.value.pathId}`);
    return;
  }
  if (pill.tone === 'fail' || !live.started) {
    router.push('/learning-paths?from=goal');
    return;
  }
  openProposalReview();
}

/** 完成弹层的副文（P22 缺陷3）：跟随真实状态——生成完成后不再说「还在生成中」。
    跟踪未建立（旧信封无 learningPath 等）回退原句，不做无凭据的宣称。
    分诊硬阻断终局不走本句：阻断卡有自己的说明（见模板 hardBlocked 分支）。 */
const doneGenNote = computed(() => {
  if (live.hardBlocked) return '';
  const lc = genTrack.value?.lc;
  if (!lc) return '阶段与任务还在生成中。';
  if (lc.status === 'failed' || lc.status === 'stale') return '生成没有完成，可在学习路径里重试。';
  if (lc.phase === 'ready') return '生成完成，可去学习路径查看。';
  return `阶段与任务还在生成中 · ${genStageLabel(lc)}。`;
});

/** 会话态生成 pill 出现且不在浮层下（浮层打开时 pill 本身隐藏，无需让位）。
    滚动区据此在底部留出 pill 高度的让位空间——实测（小米 441×952 截图） pill 会
    压在贴底消息的最后一行上，让位后末行文字不再被胶囊遮住。 */
const genPillVisibleInChat = computed(() => live.started && !!genPill.value);

/** Escape 关闭方案浮层（状态保留，对话可继续）。
    【2026-10-31 一锤定音修复】proposing 阶段不再自动弹浮层：方案先在对话流里完整落地
    （AI 本来就以「你看要不要调整？」收尾，后端非确认回复会再出新方案——多轮协商本就存在），
    浮层只在用户点「查看方案并确认」显式进入时出现；generating/done 两个阶段仍自动出现
    （那是生成进度与结果面板，不是方案本身）。 */
const proposalDismissed = ref(false);
/** 用户显式请求查看方案卡（对话流内的确认入口按钮） */
const proposalReviewRequested = ref(false);

const showProposal = computed(
  () => !proposalDismissed.value && (proposalReviewRequested.value || phase.value === 'generating' || phase.value === 'done')
);
/** 底部「学习方案 · 待确认」条可见（判据与模板 v-if 同源）。
 *  该条已排在 .chat 的 Flex 底流里（flex:0 0 auto，不是浮层），但出现的那一刻滚动视口
 *  会被顶矮约一条的高度：贴底的最后一行因此被挤出可视区，读起来像「被悬浮条截断」。
 *  滚动区据此动态补出条高的底衬（.chat__scroll--invite），并在它出现时重新贴底
 *  （2026-11-06 审计 §4 底部悬浮栏遮挡修复）。 */
const proposalInviteVisible = computed(
  () => loggedIn && live.started && !live.sending && live.stage === 'proposing' && !!live.proposal && !showProposal.value
);
/* 焦点管理（P2）：浮层打开把焦点移入对话框（读屏按 dialog 播报、Esc 立即可用），
   关闭时归还原焦点，键盘用户不至于被「丢」在页面里 */
const overlayRef = ref<HTMLElement | null>(null);
let preOverlayFocus: HTMLElement | null = null;
/** 方案浮层让位吸顶公告横幅（2026-11-05 UX 审计，沿用 V2NotifCenter.syncPanelTop 同款量法）：
    横幅底边 + 顶栏高写入 --gc-overlay-top；无横幅清掉、CSS 回落 0。 */
function syncOverlayTop() {
  const banner = document.querySelector('.anb');
  const navH = Math.round(document.querySelector('.v2nav-bar')?.getBoundingClientRect().height ?? 0);
  const top = banner ? Math.round(banner.getBoundingClientRect().bottom) + (navH || 64) : 0;
  if (top > 0) document.documentElement.style.setProperty('--gc-overlay-top', `${top}px`);
  else document.documentElement.style.removeProperty('--gc-overlay-top');
}
watch(showProposal, (open) => {
  if (open) {
    // 打开时机量测最准：横幅可能随公告轮换/dismiss 出现或消失
    syncOverlayTop();
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
    proposalReviewRequested.value = false;
  }
}
/** 点遮罩关闭：仅 done 态（preview 需用户显式选「确认 / 再补充（回聊天）」，generating 需等/停止） */
function onOverlayBackdrop() {
  if (phase.value === 'done') {
    proposalDismissed.value = true;
    proposalReviewRequested.value = false;
  }
}
/** 对话流内的显式确认入口：打开方案卡审阅（替代旧的 stage 翻转即弹 modal） */
function openProposalReview() {
  proposalDismissed.value = false;
  proposalReviewRequested.value = true;
  // 从只读回看/生成态切回正常确认流：清残留的回看状态，foot 恢复确认动作
  readOnlyReview.value = false;
}

/** 面包屑步标（2026-11-05 极简进度条）：已完成=✓（文字压暗不抢焦点）、
    进行中=空串（CSS 渲染呼吸蓝点）、未开始=序号（暗灰不催促） */
function stageMark(i: number) {
  if (live.stageIndex > i) return '✓';
  if (live.stageIndex === i) return '';
  return String(i);
}

/** 阶段标题拆两档（2026-11-05 用户裁定「全篇粗体显笨重」）：
    「拆题：把题目场景翻译成…」里冒号前是短标签（重）、冒号后是描述（常规）。
    没有冒号时整句按描述走，不再整句加粗。 */
function stageHead(s: string): string {
  const text = String(s ?? '');
  const i = text.search(/[：:]/);
  return i > 0 ? text.slice(0, i + 1) : '';
}
function stageTail(s: string): string {
  const text = String(s ?? '');
  const i = text.search(/[：:]/);
  return i > 0 ? text.slice(i + 1) : text;
}

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
/* 底部「学习方案 · 待确认」条出现/消失时，滚动视口高度随之变化：若用户本就在贴底阅读，
   重新贴底让最新一条 AI 消息的末尾保持在可视区内（2026-11-06 审计 §4 遮挡修复）。 */
watch(proposalInviteVisible, () => {
  if (pinToBottom) void scrollToBottom();
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
  if (startFailed.value) return;
  const t = input.value.trim();
  if (!t || live.sending) return;
  input.value = '';
  clearDraft();
  /* 历史回合的快捷胶囊随用户回复立即退场（2026-11-06 审计 §4）：本轮快选的使命是「点选填入」，
     用户既然已经发出回复，上一轮选项就与用户自己的话重复、只占空间。这里同步清空面板数据，
     不等下一轮 AI 回合的快选到达——避免同一份选项在后端回同样的值时被 deep watch 漏掉而不刷新。 */
  currentQuickReplies.value = [];
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
  // 生成/完成面板取代审阅卡（浮层从审阅态切到进度态，不被 dismissed 拦住）
  proposalDismissed.value = false;
  proposalReviewRequested.value = false;
  phase.value = 'generating';
  try {
    await live.confirm();
    phase.value = live.isCompleted || live.stage === 'completed' || live.stage === 'ready' ? 'done' : 'preview';
  } catch {
    confirmError.value = true;
    phase.value = 'preview';
  }
}

/** 「再补充点信息」→ 退回聊天界面（2026-11-05 用户裁定）：方案本就活在对话流里，
    补充 = 发一条普通消息让 AI 更新方案；关浮层并聚焦聊天输入框，之后可从「查看方案」重开确认 */
function supplementViaChat() {
  proposalDismissed.value = true;
  proposalReviewRequested.value = false;
  void nextTick(() => chatInputEl.value?.focus());
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
/**
 * 场景池：默认展示前 3 个，覆盖应试 / 职业转型 / 学业 / 兴趣 / 资料驱动五类起点。
 * seed 自带「现状 + 约束 + 想要的结果」，让目标澄清从具体场景开始，而不是先被反问四五轮。
 */
const scenePool = [
  {
    title: '考公面试开口卡壳',
    desc: '30 天，练到能完整答完结构化面试',
    seed: '我笔试过了，但面试一开口就卡壳，还有 30 天，想练到能完整答完结构化面试',
    bg: 'color-mix(in srgb, var(--accent) 13%, transparent)', ink: 'var(--purple-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm6 5H7v-2h6v2zm4-6H7V6h10v2z"/></svg>'
  },
  {
    title: '会计转数据分析',
    desc: '3 个月补齐 SQL 与 Python，做出作品',
    seed: '我做会计 5 年，想 3 个月内转到数据分析岗，SQL 和 Python 都是零基础',
    bg: 'color-mix(in srgb, var(--cyan) 14%, transparent)', ink: 'var(--wf-color-secondary-dark)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2C7.6 2 4 3.8 4 6v12c0 2.2 3.6 4 8 4s8-1.8 8-4V6c0-2.2-3.6-4-8-4zm0 2c3.9 0 6 1.5 6 2s-2.1 2-6 2-6-1.5-6-2 2.1-2 6-2zm6 14c0 .5-2.1 2-6 2s-6-1.5-6-2v-3.2C7.7 17.5 9.8 18 12 18s4.3-.5 6-1.2V18zm0-5.5c0 .5-2.1 2-6 2s-6-1.5-6-2V9.3C7.7 10.5 9.8 11 12 11s4.3-.5 6-1.2V12.5z"/></svg>'
  },
  {
    title: '系统了解心理学',
    desc: '不考试，读懂主要流派和经典实验',
    seed: '我对心理学一直有兴趣，想系统了解主要流派和经典实验，不为了考试',
    bg: 'color-mix(in srgb, var(--amber) 14%, transparent)', ink: 'var(--amber-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2zM8 19h8v2H8v-2z"/></svg>'
  },
  {
    title: '考研数学卡在 90 分',
    desc: '12 月考试，每天 2 小时补薄弱章节',
    seed: '我是二战考研，数学二卡在 90 分上不去，12 月底考试，每天能学 2 小时',
    bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>'
  },
  {
    title: '在职考电工中级证',
    desc: '每晚 1 小时，理论题不再靠死记',
    seed: '我在职考电工中级证，每晚只有 1 小时，理论题总是记不住',
    bg: 'rgba(49,177,111,.12)' /* 场景卡专用绿基色：等价 var(--wf-color-success-bg) 家族 */, ink: 'var(--green-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm9 1.5V8h4.5L15 3.5zM8 13h8v-1.5H8V13zm0 4h8v-1.5H8V17z"/></svg>'
  },
  {
    title: '初二几何证明没思路',
    desc: '月考 70 分，想把证明题提到 90',
    seed: '我上初二，几何证明题总是没思路，月考 70 分左右，想提到 90 分',
    bg: 'rgba(240,101,149,.12)', ink: '#d1456f',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 4h7v7H4V4zm2 2v3h3V6H6zm7-2h7v7h-7V4zm2 2v3h3V6h-3zM4 13h7v7H4v-7zm2 2v3h3v-3H6zm7-2h7v7h-7v-7zm2 2v3h3v-3h-3z"/></svg>'
  },
  {
    title: '后端进阶分布式',
    desc: '做了 3 年 CRUD，想真正搞懂一致性',
    seed: '我做了 3 年 CRUD，想系统搞懂分布式一致性，也能应对大厂面试',
    bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', ink: 'var(--blue-deep)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14.6 16.6 19.2 12l-4.6-4.6 1.4-1.4L22 12l-5.9 5.9-1.5-1.3zm-5.2 0L7.8 18l-5.8-6 5.8-6 1.6 1.4L4.8 12l4.6 4.6z"/></svg>'
  },
  {
    title: '英语开会开不了口',
    desc: '看得懂文档，要能讲清项目进展',
    seed: '工作要用英语开会，文档看得懂但开不了口，想练到能讲清项目进展',
    bg: 'rgba(49,177,111,.12)' /* 场景卡专用绿基色：等价 var(--wf-color-success-bg) 家族 */, ink: 'var(--green-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm6 5H7v-2h6v2zm4-6H7V6h10v2z"/></svg>'
  },
  {
    title: '公文写作总被退回',
    desc: '通知、总结、请示，按机关格式写',
    seed: '我刚转岗做行政，写通知和总结总被退回，想掌握机关公文的格式和写法',
    bg: 'color-mix(in srgb, var(--amber) 14%, transparent)', ink: 'var(--amber-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 4H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zM7 6h12v2H7V6zm0 5h12v2H7v-2zm0 5h8v2H7v-2z"/></svg>'
  },
  {
    title: '把手里的资料学成课',
    desc: '上传资料，按章节拆成能上的课',
    seed: '公司发了一本 200 页的合规手册，只有两周，想抓住重点，资料可以上传',
    bg: 'color-mix(in srgb, var(--accent) 13%, transparent)', ink: 'var(--purple-ink)',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>'
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
/* 副标题与同列的卡片/输入框共用 640 这条列宽（.entry__cards / .entry .composer--entry 同值）。
   原 52ch ≈412px @13.5px，比卡片窄 228px：整句被挤成两行，第二行只剩「段安排。」4 字，
   还把「第一阶段安排」拆到两行（2026-10-08 用户侧走查实测）。 */
.entry__hero p { margin: 0; font-size: 13.5px; color: var(--muted); max-width: 640px; line-height: 1.7; }

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
/* 底部渐隐（2026-11-05 用户裁定）：消息滚到底边是被滚动视口「硬切」一行——
   切边正好贴着方案卡/输入框顶边，读起来像「被卡片盖住」。在底部固定区上方铺一层
   透明→画布的 26px 渐变，让滑过的文字自己化开；配套 .chat__scroll 的 40px 底衬，
   滚到底时最后一行停在渐变之上，不会被长期压淡。
   .proposal-invite 抬 z-index：它是不透明卡，压在 composer 的渐变之上，两处渐变同色不叠印。 */
.composer,
.proposal-invite { position: relative; }
.proposal-invite { z-index: 1; }
.composer::before,
.proposal-invite::before {
  content: ''; position: absolute; left: 0; right: 0; bottom: 100%;
  height: 26px; pointer-events: none;
  background: linear-gradient(180deg, transparent, var(--canvas));
}
.composer__box {
  position: relative;
  display: flex; align-items: flex-end; gap: 10px;
  /* .composer 是单列 grid，盒是 grid item，min-width:auto 时它的最小贡献=min-content，
     会把那一列撑到 ≈295px 的硬下限（≤355 视口下顶出列宽，320 实测右缘越过视口 1.3px）。
     归零后轨道跟随容器，内部 textarea 的 min-width:0 才真正起作用。 */
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  /* 16 → 12（2026-11-05 去肥胖化）：现代 AI 工具（Claude/Cursor）的输入框是 12px
     圆角矩形而非全圆胶囊；与上方方案卡同档圆角，底部两块不再「圆角打架」 */
  border-radius: 12px;
  /* 四边等距：原为 8px 8px 8px 16px（左 16 是给回形针单独留的），桌面档实测左右不对称
     ——回形针一侧比发送键一侧多缩进 8px，整条控件视觉重心偏左（2026-10-08 用户侧视觉检查）。
     移动档早就是四边 6px，这里对齐同一取法。 */
  padding: 8px;
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
   与首行文字中线对齐：按钮 44 高是盒内最高子项，flex-start 顶到内容上缘后其中心 22
   恰好等于首行中心（textarea 居中于同一内容区 → 0.75 + 上内边距 10 + 半行高 11.25 = 22）。
   原先靠 margin-top: 4.5px 硬顶，那是按「按钮 32 高」算的陈旧偏移；按钮早已 44，
   这 4.5px 反而把回形针压低 2px，还把输入盒从 57 撑到 61。autogrow 只改高度，首行位置恒定。 */
.composer__attach {
  position: relative;
  align-self: flex-start;
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
/* 「聊到的内容会自动整理成这份清单。」tip 已删（2026-11-05 用户裁定）：
   面板里 7 项清单本身就是整理结果，这句机制说明是重复信息 */
/* 清空重聊：桌面档隐藏（头部 .chat__clear 承担），≤1100 由面板底部的本按钮承担 */
.panel__clear { display: none; }
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
.panel__body { display: flex; flex-direction: column; min-height: 0; }
/* 面板内容滚动层（2026-11-05）：面板壳（描边/圆角/投影）与内容滚动分离——
   底缘渐隐 mask 只作用于内容层，不会把壳一起淡掉。桌面不滚动，mask 不生效 */
.panel__scroll { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.panel__bar { height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--line) 55%, transparent); overflow: hidden; }
.panel__bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width .4s ease; }
.panel__confidence { font-size: 12px; color: var(--faint); }

/* 目标信息字段：独立圆角浅灰块（2026-11-06 走查「斑马纹」改造）——
   已收集项各成 8px 圆角小卡（墨 4% 浅底），块间距 8px，不再直角色块上下连排；
   待补充项收拢到底部 todo__tags 两列小标签。发丝线平铺行判例（2026-11-05）随之退役 */
.checklist { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.field {
  position: relative;
  display: grid; grid-template-columns: 16px 1fr; gap: 9px;
  padding: 10px 12px;
  border-radius: var(--mk-radius-md);
  background: color-mix(in srgb, var(--ink) 4%, var(--surface));
}
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
/* 正文常规字重（2026-11-05 用户裁定）：大段描述全用 600/700 会糊成一团、显得笨重；
   只留短标签/短数值的重音，正文回到 400 + 柔和浅色 + 1.5 行高 */
.field__value { margin-top: 3px; font-size: 13px; font-weight: 400; line-height: 1.5; color: color-mix(in srgb, var(--ink) 84%, transparent); }
/* 待补充组：标题 + 两列紧凑小标签（○ 维度名），不再每项占两行高 */
.todo__head { font-size: 12px; font-weight: 600; color: var(--faint); margin-bottom: 8px; }
.todo__tags { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.todo__tag {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-md);
  font-size: 12px; color: var(--faint);
}
.todo__o { flex: none; font-size: 12px; line-height: 1; opacity: .8; }
/* 「刚收录」行内高亮（2026-11-06 审计 §1）：唯一的新增标记就靠这一条行级脉冲——
   左侧绿勾 + 行底色/文字短促变蓝，已经说清「这一项刚被收录」；
   原先标签旁的 6px 蓝点与其同义重复，已移除（.field__fresh 规则随之退役） */
.field--fresh { background: color-mix(in srgb, var(--blue) 6%, transparent); }
/* 刚收录闪显：值写入时一次蓝色高亮脉冲（reduced-motion 下被全局规则压掉） */
@media (prefers-reduced-motion: no-preference) {
  .field--fresh { animation: field-flash 1.4s ease-out 1; }
  .field--fresh .field__value { animation: field-value-flash 1.4s ease-out 1; }
}
@keyframes field-flash {
  0% { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--blue) 14%, transparent); }
  100% { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--blue) 6%, transparent); }
}
@keyframes field-value-flash {
  0%, 30% { color: var(--blue-deep); }
  100% { color: var(--ink); }
}
</style>

<style scoped>
/* ---------- 右：聊天区 ----------
   画布直铺判例（原型 .wf-goal--chat 去卡壳）在 PC 档退役（2026-11-06 走查「灰底上贴
   上下两块直角白膏药」）：头部白条 + 输入区白补丁 + 中间漏灰底，三截右缘还不齐。
   方案 A——PC ≥1101 整体包回与左栏同族的白卡（等高顶底对齐由 .work 的 stretch 保证）；
   ≤1100 维持画布直铺（移动端 composer 脱壳/贴 Canvas 判例不动） */
.chat {
  position: relative;
  display: flex; flex-direction: column;
  /* overflow hidden：锁高之后内容若比视口高，只允许在 chat 内部滚，不许把文档撑出滚动条 */
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
  /* 方案 A（2026-11-06 走查）：右侧整体包进一张白卡——头部/输入区的两块白底从此
     同属一张卡，中间聊天流不再漏画布灰；与左栏画像卡同圆角/描边/投影同族等高 */
  .chat {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--mk-radius-modal);
    box-shadow: var(--shadow-sm);
  }
  /* 输入区底色交给卡底（96% 混色是移动端画布直铺时代的残影）；发丝线保留为卡内分区 */
  .chat > .composer { background: var(--surface); }
  /* AI 声明已挪输入框正下方（.chat__under-hint），对话流顶部的免责行 PC 不再重复 */
  .chat__ai-note { display: none; }
  /* 输入框正下方的合并元数据行：AI 声明 + 快捷键（+ ≥3500 字数计数）居中一行浅灰小字 */
  .chat__under-hint {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    flex: 0 0 auto;
    padding: 0 16px 10px;
    font-size: 12px; color: var(--faint);
  }
  .chat__under-hint-sep { opacity: .6; }
}
/* 原型 .wf-chathead：直接坐在画布上，无分隔线、无底色（分区靠留白）。
   内边距 10/16 保留：移动端 .panel 的零占位锚点带高 47px，正是按这条头部带对齐的 */
.chat__head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  /* 上下 10→6（2026-11-05 屏效比）：步条带 60→52；移动端「目标信息」药丸锚点带
     （.panel 的 padding）与本值保持同一条上下 padding，两条带中线才重合（pill-align 门禁） */
  padding: 6px 16px;
  /* 实色底 + 抬层（2026-11-05 穿模修复）：聊天流滚动时气泡文字从本条下缘的
     半透明缝里透上来（截图实证第一行字穿进步骤条下方）；surface 实色不透明 +
     z-index 高于滚动区，滚过的内容在条下干净裁断 */
  background: var(--surface);
  position: relative;
  z-index: 6;
}
.stage-nav { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; }
/* 「查看方案」是步条带里的次级动作（2026-11-06 审计 §1 去肥胖化）：
   原全圆胶囊 + 4/12 内衬在 25px 高度上读作一颗胖药丸；改 8px 控件圆角 + 30px 定高。
   高度与同一行的 .stage-nav__item 严格相等（桌面都 30、窄屏都 36，见 ≤1100 块）：
   此前写成 36 而基础档导航只有 ~24，按钮一出现就把 .chat__head 撑高约 12px、
   对话区跟着上下跳——等高的两件东西才不会改变头部带的高度（2026-11-06 复核）。 */
.chat__show-proposal {
  margin-left: auto;
  display: inline-flex; align-items: center;
  min-height: 30px; padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
  background: color-mix(in srgb, var(--blue) 8%, var(--surface)); color: var(--blue-deep);
  border-radius: var(--mk-radius-md);
  font-size: 12px; font-weight: 700; cursor: pointer;
}
.chat__show-proposal:hover { background: color-mix(in srgb, var(--blue) 18%, var(--surface)); }
/* 极简面包屑（2026-11-05 屏效比）：胶囊叠胶囊退役——已完成=青绿 ✓ + 文字压暗（翻篇不抢焦点）、
   进行中=亮白粗体 + 前置呼吸蓝点 + 正下方 2px 指示条、未开始=暗灰序号，步骤间「›」极细连接 */
.stage-nav__item {
  display: inline-flex; align-items: center; gap: 5px;
  position: relative;
  /* min-height 基线（2026-11-06 复核）：与 .chat__show-proposal 同档 30，
     两者任一出现/消失都不改变 .chat__head 的高度；窄屏档统一抬到 36（触控下沿） */
  min-height: 30px;
  font-size: 12px; font-weight: 600; color: var(--faint);
  padding: 5px 2px;
}
.stage-nav__item + .stage-nav__item::before {
  content: '›';
  margin-right: 7px;
  color: var(--faint);
  opacity: .7;
  font-weight: 400;
}
.stage-nav__item i {
  width: auto; height: auto; border-radius: 0; background: none;
  font-size: 12px; font-weight: 700; font-style: normal;
  display: inline; place-items: initial;
}
.stage-nav__item--done { color: var(--muted); }
.stage-nav__item--done i { color: var(--green-ink); }
.stage-nav__item--current { color: var(--ink); font-weight: 800; }
.stage-nav__item--current i {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--blue);
  animation: stage-dot-breathe 1.6s ease-in-out infinite;
}
/* 底部 2px 蓝下划线已撤（2026-11-05 用户裁定）：它与步条带的灰分割线平行且悬空 5px，
   读作「两条线打架」，而左侧还会探到「›」分隔符下方。当前步态由三样东西已经说清——
   ✓/●/序号 步标 + 白色 800 粗体 + 呼吸蓝点，再画一根线纯属重复。 */
@keyframes stage-dot-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}
.chat__clear { font-size: 12px; font-weight: 600; color: var(--faint); cursor: pointer; }
.chat__clear:hover { color: var(--red-ink); }

.chat__scroll {
  flex: 1;
  overflow-y: auto;
  /* 画布直铺：不再有白卡内边距，左右与 .chat__head 的 16px 对齐 */
  /* 底衬 20→32（2026-11-05）：给滚动边缘的 26px 渐隐让位，滚到底时最后一行不吃渐变 */
  padding: 16px 16px 32px;
  display: flex; flex-direction: column; gap: 18px;
  transition: filter .2s ease, opacity .2s ease;
  /* 原生滚动条隐藏（2026-11-05 屏效比）：桌面 Windows 的经典粗滚动条在移动视口仿真里
     出戏且挤占右缘；触屏滚动手势/滚轮不受影响，内容可达性不变 */
  scrollbar-width: none;
}
.chat__scroll::-webkit-scrollbar { display: none; }
/* AI 生成声明（2026-11-05 屏效比改造自输入区元数据条迁来）：对话流顶部居中一行，
   随内容滚动；消息少时由移动端「贴底」规则带着一起贴在最新消息上方 */
.chat__ai-note { display: flex; justify-content: center; }
/* 消息从上方开始、向下生长：桌面**刻意不做贴底**。
   2026-10-05 曾把窄屏那条贴底规则提到基础档（当时理由是「短会话消息与下方快捷块之间空一截」），
   结果桌面整段对话吊在底部：1440×1250 实测首条消息距对话区顶部 141px，看起来像对话从下往上长。
   2026-10-06 用户否掉（「消息不应该是从上面往下面走吗」），回退为窄屏专属（见 ≤1100 档）。 */

.chat__scroll--dim { filter: blur(2px); opacity: .45; pointer-events: none; }
/* 生成 pill 让位（2026-11-05 UX 审计）：pill 出现时（浮层关闭态）在滚动区底部留出
   一条 pill 高度的呼吸带，贴底的最后一行消息不再被胶囊压住（小米 441×952 实测截图）。
   pill 隐藏（浮层打开/无 pill）时回落 20px 原值，不占空。
   2026-11-06：选择器改成复合类（.chat__scroll.chat__scroll--pill）——基础档的单类规则
   会被 ≤1100 块里位置更靠后的 `.chat__scroll { padding: … }` 按同权重盖掉，pill 让位在
   手机上其实一直没生效；复合类权重更高，两档都真的留出底衬。 */
.chat__scroll.chat__scroll--pill { padding-bottom: 60px; }
/* 「学习方案 · 待确认」条让位（2026-11-06 审计 §4）：条虽在底流里（非浮层），出现时仍会
   顶矮滚动视口，贴底的 AI 消息末行被挤出可视区。底衬 = 条高(~54) + 条间距(8) + 底缘渐隐(26)。 */
.chat__scroll.chat__scroll--invite { padding-bottom: 88px; }

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
/* 「快速自测」是状态标签（2026-11-06 审计 §1）：紧凑小方签——20px 高 / 1px 6px 内衬 /
   4px 圆角 / 柔和半透明蓝底、无描边；不再用 800 粗字直接压在卡面上（那既像正文又抢焦点） */
.msg__probe-tag {
  justify-self: start;
  display: inline-flex; align-items: center;
  height: 20px; padding: 1px 6px;
  border-radius: var(--mk-radius-xs);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  font-size: 12px; font-weight: 700; letter-spacing: .02em; color: var(--blue-deep);
}
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
  /* 热区（2026-11-05 UX 审计）：桌面档原 20×20 低于本仓 36px 口径（审计在 iPhone UA
     量到 20×20 即此档）；抬 36 后负 margin 抵消占位，meta 行高度不变。触屏档 40 不变。 */
  width: 36px; height: 36px;
  margin: -8px;
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
    margin: -10px;
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
  display: inline-flex; align-items: center;
  min-height: 30px; padding: 0 12px;
  font-size: 12px; font-weight: 700;
  /* 8px 控件圆角（2026-11-06 审计 §1）：编辑动作是紧凑内嵌按钮，不是全圆胶囊 */
  border-radius: var(--mk-radius-md);
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
  /* 原型 .wf-msg p：11/13 内边距、13.5px 行高、16px 圆角基线；
     2026-11-05 屏效比微调：12/14 + 行高 1.55——卡片更紧凑、易读性不降档 */
  padding: 12px 14px;
  font-size: 13.5px; line-height: 1.55;
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
.msg__content--actions > .msg__bubble { grid-column: 1 / -1; }
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
  /* 时间戳撤除后重试就是 meta 行首个子项，不再吃 8px 左偏移（2026-11-05 屏效比） */
  color: var(--red-ink); font-weight: 800;
  text-decoration: underline; cursor: pointer;
}

/* ---------- 快捷补充（skill 每轮返回）：原型 .wf-replies / .wf-reply ----------
   胶囊按钮组：1px 蓝 28% 描边 + 蓝 5% 底 + blue-deep 文字；选中加 ✓（前置蓝点已撤） */
.replies {
  display: flex; flex-wrap: wrap; gap: 8px;
  margin-left: 40px;
}
/* 2026-11-02 用户反馈「快选太宽」：整行大按钮改成自动宽度的胶囊，
   多个选项并排换行，不再一条占满一整行。（历史轮次 .msg__reply 已随「旧选项销毁」退役） */
.reply {
  display: inline-flex; align-items: center; gap: 7px;
  width: auto; max-width: 100%;
  min-height: 38px; padding: 8px 14px;
  border-radius: var(--mk-radius-pill);
  text-align: left;
  border: 1px solid color-mix(in srgb, var(--blue) 28%, transparent);
  background: color-mix(in srgb, var(--blue) 5%, transparent);
  color: var(--blue-deep);
  font: inherit; font-size: 13.5px; font-weight: 600; line-height: 1.45;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
}
/* 前置 6px 蓝点已撤（2026-11-06 走查）：胶囊本体就是可点项，再挂一颗点只是噪声；
   选中态的 ✓ 仍走 ::before（见 .reply--on）。左缘对齐：.replies 的 margin-left 40
   = AI 头像 30 + 列间距 10，与上方 AI 气泡左缘同一条竖线 */
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
/* 历史轮次快捷补充（.msg__replies/.msg__reply）已随「旧选项销毁」改造退役（2026-11-05）：
   活快选由下方 .replies 常驻面板承担，样式同语言见 .reply */
@media (prefers-reduced-motion: no-preference) {
  .replies { animation: replies-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both; }
}
@keyframes replies-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

/* ---------- 方案协商入口条（2026-10-31 一锤定音修复） ----------
   proposing 不再自动盖 modal 后，这里是「确认动作」在对话流里的常驻入口：
   左提示（回复可继续调整）+ 右按钮（打开方案卡审阅）。宽度同对话列，贴输入区上方。 */
.proposal-invite {
  flex: 0 0 auto;
  margin: 0 16px 8px;
  padding: 6px 10px 6px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--blue) 34%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--blue) 8%, var(--surface));
}
/* 方案预览微卡片（2026-11-05 用户裁定方案 A）：左 65% 方案摘要两行（文档图标 + 主标/副标），
   右侧「查看并确认」——总高 ≈54px，比旧 hint 单行条更薄且信息量更高 */
.proposal-invite__doc {
  flex: none;
  display: grid; place-items: center;
  width: 32px; height: 32px;
  /* 同心圆角：外卡 12 内芯 8（2026-11-05 去肥胖化） */
  border-radius: 8px;
  background: color-mix(in srgb, var(--blue) 14%, transparent);
  color: var(--blue-deep);
}
.proposal-invite__text { flex: 1; min-width: 0; display: grid; gap: 1px; }
.proposal-invite__title {
  font-size: 14px; line-height: 1.35; font-weight: 800; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.proposal-invite__sub {
  font-size: 12px; line-height: 1.35; color: var(--mk-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 内嵌按钮（2026-11-05 去肥胖化）：外卡 12px 圆角里塞全圆胶囊产生圆角冲突——
   改 8px 同心圆角；高度保 36（mobile:spec lt36:0 硬门槛，不再压到 32），
   从描边/圆角/内边距去体重而不是压矮触控目标。
   .v2-page 前缀：压过 v2.css 的 `.v2-page .btn-primary`（0,2,0）对 border-radius 的设定 */
.v2-page .proposal-invite__btn {
  flex: 0 0 auto;
  min-height: 36px; height: 36px; padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
}

/* ---------- 生成状态 pill（走查 2026-11-01 P22） ----------
   三档语言：run=蓝描边脉点（与 .proposal__stop 同族的进行态）、done=平静绿档
   （同 done-ring 的成功语言）、fail=红档（同 .errorbar）。min-height 36：触屏下沿。 */
.gen-pill {
  flex: 0 0 auto;
  align-self: flex-start;
  margin: 0 16px 8px;
  display: inline-flex; align-items: center; gap: 7px;
  min-height: 36px; padding: 0 12px;
  /* 8px 控件圆角（2026-11-06 审计 §1 去肥胖化）：状态条不再用全圆胶囊；
     36 是仓库「可点元素 ≥36px」硬下沿，高度不动 */
  border-radius: var(--mk-radius-md);
  font: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;
}
.gen-pill--run {
  border: 1px solid color-mix(in srgb, var(--blue) 35%, transparent);
  background: color-mix(in srgb, var(--blue) 8%, var(--surface));
  color: var(--blue-deep);
}
.gen-pill--run:hover { background: color-mix(in srgb, var(--blue) 14%, var(--surface)); }
.gen-pill--done {
  border: 1px solid color-mix(in srgb, var(--green) 30%, transparent);
  background: color-mix(in srgb, var(--green) 10%, var(--surface));
  color: var(--green-ink);
}
.gen-pill--fail {
  border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
  background: color-mix(in srgb, var(--red) 8%, transparent);
  color: var(--red-ink);
}
.gen-pill__dot {
  flex: 0 0 auto;
  width: 7px; height: 7px; border-radius: 50%;
  background: currentColor;
}
/* 入口态位置：.entry 是 28px 内缩的 flex 列（会话态是 16px 内缩的 chat 列），对齐各自列缘 */
.gen-pill--entry { margin: 0; }
@media (prefers-reduced-motion: no-preference) {
  .gen-pill--run .gen-pill__dot { animation: gen-pill-pulse 1.6s ease-in-out infinite; }
}
@keyframes gen-pill-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
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
/* 方案浮层打开期间（P21 走查）：遮罩本就物理挡住输入区，此前它却保持高亮可点的样子——
   点发送无请求、焦点落 overlay，看起来像坏了。与消息流（.chat__scroll--dim）同款哑火档，
   控件再配真实 disabled（读屏也不给假象）；不追加 blur：草稿隔着遮罩仍要能认出来 */
/* 输入框正下方的合并元数据行（2026-11-06 走查）：AI 声明 + 快捷键（+ 字数计数）居中
   一行浅灰小字；基础档隐藏（移动端位置被底部导航接管，声明走对话流顶部），PC 档显示 */
/* PC 档显示规则在文件前段第一个 ≥1101 媒体块（与右侧白卡同块，见 .goal 处） */
.chat__under-hint { display: none; }
.composer--locked { opacity: .45; pointer-events: none; }
/* ---------- 方案确认浮层 ---------- */
/* 页面级模态（原型 .wf-modal / .wf-dialog）：fixed 铺满视口，
   遮罩盖住页级 composer 与导航（原先 absolute 只盖住 .chat 一块） */
.overlay {
  position: fixed; inset: 0;
  /* 让位吸顶公告横幅（2026-11-05 UX 审计，同 V2NotifCenter 的 --nc-panel-top 先例）：
     .anb sticky z-index:200 > 本浮层 z-index:60，横幅展示期会盖住浮层头部与关闭键
     （移动端横幅实测高 107px）。top 由 syncOverlayTop 按横幅实测底边写入；无横幅回落 0。 */
  top: var(--gc-overlay-top, 0);
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
/* 底部双钮收形（2026-11-05 用户裁定）：15px 字 + 13px 竖内衬 + 16px 圆角在 40px 高度上
   读作两颗胖胶囊。改成 40px 定高 + 8px 同心圆角 + 左 1 : 右 2（次按钮「再补充点信息」是
   退路、主按钮「确认，生成我的路径」是终局，宽度比例应写进版式而不是靠字数自然形成）。
   加 .v2-page 前缀：与 v2.css 的 `.v2-page .btn-primary`（0,2,0）同权重时只靠加载顺序，
   那是上一版「页面副本赢全局」的同一类坑——这里提到 (0,3,0)，谁后加载都不影响结果。 */
.v2-page .proposal__foot .btn-ghost,
.v2-page .proposal__foot .btn-primary {
  flex: 1 1 0; min-height: 40px; padding: 0 12px;
  justify-content: center;
  border-radius: var(--mk-radius-md);
  font-size: 14px;
}
/* 主按钮吃左 1 : 右 2（终局动作比退路宽），次按钮只按内容宽 */
.v2-page .proposal__foot .btn-primary { flex: 2 1 0; }
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
/* 卡片内嵌按钮（2026-11-06 审计 §1 同心圆角）：外卡 16/12 圆角里不再塞全圆胶囊，
   改 8px 控件圆角；高度保 34（审计档 30~34 的上限）——它落在 .proposal--center
   卡片里、窄屏生成态也可见，不去碰 36 触控档（本钮不出现在移动端门禁量测的入口态） */
.proposal__stop {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 34px; padding: 0 14px;
  font: inherit; font-size: 12px; font-weight: 700;
  color: var(--blue-deep);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
  border-radius: var(--mk-radius-md);
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
/* 阶段行两档字重（2026-11-05 用户裁定）：整句 700 的长描述读起来糊且笨重，
   改成「短标签重 + 描述常规」——strong 是冒号前的标签，其余是描述 */
.pstep > div { font-size: 13.5px; line-height: 1.5; color: color-mix(in srgb, var(--ink) 84%, transparent); }
.pstep strong { font-weight: 700; color: var(--ink); }
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
/* 自测作答回执（2026-11-02）：作答改为本地表单、不逐题发回合，点完必须有可见回执，
   否则和「点了没反应」分不开 */
.probe__receipt {
  margin: 0;
  font-size: 12.5px;
  color: var(--mk-muted);
}
/* 换题导致作答失效：要做成提醒而不是普通回执，颜色取已定义的 amber 令牌（明暗自动翻转） */
.probe__receipt--warn { color: var(--mk-amber); }
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
/* 完成态动作行：主按钮吃剩余宽（flex-basis auto），次按钮按内容宽——原等分
   （flex:1 1 0）把「查看我的路径」压到 99px 折成「查看我的路/径」两行（双机实测），
   主 CTA 折词是可避免副作用。nowrap 保证 6 字标签永不折行；空间不足时 flex-wrap
   让次按钮落到第二行，不裁字。 */
.v2-page .proposal__actions--center .btn-primary {
  flex: 1 1 auto; justify-content: center;
  min-width: fit-content;
  white-space: nowrap;
}
.v2-page .proposal__actions--center .btn-ghost { flex: 0 0 auto; justify-content: center; }
/* 主/次按钮基座不再在本页复制（2026-11-06 UI 排查 §1）：v2.css 的
   .v2-page .btn-primary / .btn-ghost 已是单源（32px / 0 14px / --mk-radius-md / 13px）。
   本页只留「大幅 CTA」这一档——--lg 不吃紧凑档，全局给它 height:auto + 16px 圆角，
   竖内衬与字号由这里给；加 .v2-page 前缀是为了稳定压过全局同名规则，而不是靠加载顺序。 */
.v2-page .btn-primary--lg { padding: 13px 26px; font-size: 15px; }
/* 原型 .wf-proposal__note：竖排四号字说明，不是「两端对齐的一行」 */
.proposal__note {
  display: grid; gap: 4px;
  font-size: 12px; line-height: 1.6; color: var(--faint);
}
.proposal__note :deep(.ai-note) {
  font-size: 12px; line-height: 1.5;
}
/* 浮层内补充表单已退役（2026-11-05 用户裁定：补充改道聊天界面） */

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
/* 硬阻断终局：非失败也非成功，中性琥珀提示（令牌派生，随主题翻转） */
.done-ring--blocked {
  background: color-mix(in srgb, var(--amber) 12%, transparent);
  color: var(--amber);
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--amber) 6%, transparent);
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
    /* 上内边距 8→4（2026-11-05 屏效比）：导航栏与步骤条带之间不再多留一道缝 */
    padding: 4px 10px;
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
    /* 与 chat 同框：top/left/right 就是 .work 的内边距（4/10/10）。
       头部带高度**不能写死**：.chat__head = 上下 padding 6 + .stage-nav__item
       min-height 40 = 52px。此前写死 47（早于「阶段导航抬到 40px 触控下限」那次改动），
       两条带各自 align-items:center → 药丸中心实测 96.2、阶段导航中心 102.7，
       药丸比它该在的那一行高 6.5px，看起来是「浮」在阶段导航上方的孤立小卡。
       改成与 .chat__head 同一条上下 padding（6），两条带的中线自动重合。 */
    top: 4px; left: 10px; right: 10px;
    height: auto;
    display: flex; flex-direction: row; align-items: center; justify-content: flex-end;
    /* 与 .chat__head 同一条上下 padding（6）。配合下方 .panel__head 的 min-height 40
       （= .stage-nav__item 的 min-height），两条带的高度都是 6+40+6=52，
       align-items:center 后药丸中心与阶段导航中心严格重合。 */
    padding: 6px 0;
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
    padding: 7px 10px;
    /* EG20（2026-10-05 复测）：触屏下该药丸实测 81×34，低于 36px 触控下限 → 抬到 38。
       2026-10-07：再抬到 40，与 .stage-nav__item 的 min-height 严格同高 —— 两条头部带
       （.chat__head / .panel 锚点带）同 padding + 同子高，药丸中线才与阶段导航重合。
       2026-11-05 去肥胖化：触控下限 36 是硬门槛（mobile:spec lt36:0），高度不能再压，
       改从「体重」下手——全圆胶囊 → 8px 小圆角、描边撤销只留 6% 底色，视觉不再比文字壮。 */
    min-height: 36px;
    border: 0;
    border-radius: var(--mk-radius-md);
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    color: var(--muted);
    font-size: 12px;
  }
  .panel__head strong { font-size: 12px; }
  /* 展开箭头是 9px 的字形「▸」，12px 字号下渲染成一个几乎认不出的小点
     （2026-10-07 放大核对：它和「息」字之间还隔着 5px，读起来像个孤立标点）。
     抬到 13px，让「目标 ▸」读成一个整体（2026-11-05 窄屏标签已收「目标信息」→「目标」）。 */
  .panel__caret { display: inline; font-size: 13px; }
  /* 计数角标：绝对定位不吃宽度（右上角那一条带要和阶段导航挤在同一行），
     「已收集」三字省掉只留「3 / 7」。
     2026-10-07 收形：原来是实心蓝底白字（--blue + --text-on-primary），在 40px 白药丸的
     右上角读作一块「压上去的蓝色补丁」——它和药丸描边互相切角，比药丸本身还抢眼，
     而它承载的只是一个次要计数。改成柔和的蓝底蓝字，并加一圈 surface 描边（用
     box-shadow 而非 border，不占布局尺寸），让角标与药丸之间有一道干净的呼吸缝。 */
  .panel__count-k { display: none; }
  /* 「画像 6/7 ▸」（2026-11-05 极简进度条 / 2026-11-06 审计 §4）：6/7 从右上角悬浮角标
     收进胶囊内部——角标读作「未读消息」且把顶部撑出一截鼓包；内联后省 ~20px 宽、消掉鼓包。
     窄屏只留「画像」二字（与「目标 6/7」划清界线），桌面仍是完整的「学情画像」；
     两字与「学情」等宽，不改变与阶段导航共享那一行的余量。 */
  .panel__head-lead { display: none; }
  .panel__count {
    position: static;
    min-width: 0; padding: 0;
    background: none; box-shadow: none;
    border-radius: 0;
    color: var(--muted);
    font-size: 12px; font-weight: 700; line-height: 16px;
    text-align: left;
  }
  .panel--collapsed .panel__body { display: none; }
  .panel:not(.panel--collapsed) .panel__body {
    position: absolute;
    top: calc(100% + 6px);
    left: 16px; right: 16px;
    z-index: 26;
    /* 高度上限：60% → 70% 视口（2026-11-05 用户裁定「一屏装下」），下沿改成
       「留出 composer + 底部导航 ≈ 240px」的硬约束——短屏（320×568）靠这一项兜住，
       长屏则真的能把 7 项清单一次排完。内容仍超高时由内层 .panel__scroll 滚动 */
    max-height: min(calc(70dvh / var(--vp-zoom, 1)), calc((100dvh - 240px) / var(--vp-zoom, 1)));
    /* 壳层只裁不滚（overflow hidden）：滚动在内层 .panel__scroll，底缘渐隐才有作用对象 */
    overflow: hidden;
    display: flex; flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--mk-radius-modal);
    box-shadow: var(--mk-shadow-modal); /* 模态档 */
  }
  .panel:not(.panel--collapsed) .panel__scroll {
    /* 底衬 28（2026-11-05）：滚到底时最后一行完整停在渐隐带上方 */
    padding: 12px 12px 28px;
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
    /* 底缘渐隐（2026-11-05 用户指出「下边没有了」）：内容被滚动视口硬切在底边读作破版。
       mask 只罩内容层（.panel__scroll），壳的描边/圆角/投影不动；
       与 MkGraphExplorer 轨条两端渐隐同一写法 */
    mask-image: linear-gradient(to bottom, black calc(100% - 26px), transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 26px), transparent 100%);
  }
  .panel:not(.panel--collapsed) .panel__scroll::-webkit-scrollbar { display: none; }
  /* 清空重聊钉在面板底部（滚动层之外，2026-11-05 二次反馈）：之前它在滚动层末尾，
     静止时整颗溶进底缘渐隐带里，用户以为按钮没了。钉死后永远完整可见，
     滚动层里只剩清单，配合渐隐带也不会再出现半颗按钮 */
  .panel__clear {
    display: block;
    flex: none;
    width: 100%;
    min-height: 36px;
    padding: 6px 12px 10px;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
  }
  .panel__clear:hover { color: var(--red-ink); }
  /* 面板遮罩（2026-11-05 用户裁定 / 2026-11-06 审计 §4）：浮层直接盖在聊天字上、右缘还露
     半截气泡，压暗一层后面板才是唯一焦点；z-index 取 21（> 步条带 6 / 消息流，< 面板 26），
     点击即收起（悬浮层点外部关闭是默认心智，不需要再找 ▾）。
     pointer-events:auto 不能省：.panel 锚点带整体是 pointer-events:none（否则空带会挡住
     下方阶段导航），子元素不单独声明就收不到点击——此前的「点遮罩收起」实际是哑的。
     底色走 --wf-overlay（tokens.css 定义的模态压暗档，亮 rgba(15,23,42,.45) / 暗
     rgba(3,7,14,.62)），与 .mk-drawer__mask / .sheet-mask / 同页 .overlay 同一族：
     原先取 --ink 混色，而 --ink 在暗色档是近白（--wf-text-primary #efeff0），
     深色下把整个视口刷成 58% 白纱，与「压暗一层」的注释正好相反（2026-11-06 复核）。 */
  .panel__mask {
    position: fixed; inset: 0; z-index: 21;
    pointer-events: auto;
    background: var(--wf-overlay);
    animation: panel-mask-in 0.16s ease-out both;
  }
  @keyframes panel-mask-in { from { opacity: 0; } to { opacity: 1; } }
  /* 面板紧凑化（.field 已是圆角浅灰块）：块内边距 10→7、gap 9→8、值 13→12.5；
     待补充已收拢为底部两列小标签（todo__tags），行内并排判例随之退役 */
  .field { padding: 7px 10px; grid-template-columns: 16px 1fr; gap: 8px; }
  .field__value { margin-top: 2px; font-size: 12.5px; }
  .todo__tags { gap: 6px; }
  .todo__tag { padding: 6px 8px; }
  .panel__bar { height: 5px; }
  /* 移动端信息清单默认折叠：头部横条可点，收起时隐藏进度条/清单/提示 */
  .panel__head { cursor: pointer; }
  .panel__caret { display: inline; }
  .panel--collapsed .panel__body { display: none; }
  /* chat 撑满第二行：内部滚动、composer 吸底 */
  .chat { min-height: 0; height: 100%; }
  /* overscroll-behavior:contain 隔断滚动链——列表滚到边缘时不再触发整页橡皮筋
     （本页 height:100dvh 不随文档滚动，iOS 上链式滚动会把底部导航一起拽动）。
     padding 16/20→10/16、消息间距 18→16（2026-11-05 屏效比）：对话区首屏多装半轮问答 */
  .chat__scroll { min-height: 0; overscroll-behavior: contain; padding: 10px 16px 40px; gap: 16px; }
  /* AI 头像左列撤除（2026-11-05 屏效比）：30px 圆 + 10px gap 把整段回复推开 40px 宽，
     同样字数多折 2~3 行；品牌已由顶栏承载，气泡不再需要逐条自报家门 */
  .msg__avatar { display: none; }
  .msg--ai { max-width: 100%; }
  /* AI 回复占满对话列宽（2026-11-05 屏效比第 2 刀）：内容自然宽会在右侧留出空白带，
     flex:1 让卡片与步条带/输入框同缘（≈屏宽 92%），长文再省 1~2 行 */
  .msg--ai .msg__content { flex: 1; }
  /* 快捷补充改单行横滑（2026-11-05 屏效比）：3 个胶囊折两行吃 84px，单行省 ~46px；
     右侧自然露出半颗胶囊表达「可横滑」，滚动条隐藏降噪 */
  .replies { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .replies::-webkit-scrollbar { display: none; }
  .reply { flex: 0 0 auto; }
  /* 操作条（👍👎🔄📋）收紧（2026-11-05 屏效比）：左对齐贴气泡下缘（不再偏右悬浮）、
     上下空隙收半——负边距只收视觉空隙，36×36 触控盒不缩（EG20 口径） */
  .chat .msg__content--actions > .msg-actions {
    grid-column: 1;
    justify-content: flex-start;
    margin: -7px 0 -5px;
  }
  /* 消息少时贴底：首个子项吃满剩余空间（等价 justify-content:flex-end，但溢出时不会把顶部
     推出可达范围——auto 外边距在无剩余空间时按 0 处理）。短会话下最新一条与快捷补充紧贴输入框，
     视线与拇指都不用上下跑。窄屏专属：桌面要从上往下长（见基础档注释）。 */
  .chat__scroll > :first-child { margin-top: auto; }
  .msg { max-width: 96%; }
  /* 快捷补充面板占满整宽：基础样式的 margin-left 40（对齐气泡正文）在手机上白丢 40px 宽度，
     而这是整屏最常点的区域 */
  .replies { margin-left: 0; }
  /* 编辑按钮触屏即 40×40 本体（EG20 复验收口，见 (hover: none) 块），不再用 ::before 扩热区 */
  /* 旧「hint 行 dock 缝」整套退役（2026-11-06）：主输入区的元数据行已并入 PC 档
     .chat__under-hint；触屏无快捷键提示，≥3500 的字数计数在手机上属极端边缘，
     不再为其保留绝对定位缝。脱壳判例保留：胶囊直接浮在画布上 */
  /* 脱壳（2026-11-05 屏效比第 4 刀）：基础档的 border-top + 96% surface 背景在移动端
     是输入框外多套的一层矩形（暗色下色差尤其明显）——撤掉，胶囊直接浮在画布上；
     上下内边距收到 4/8（基础档的 safe-area padding-bottom 被本简写整体覆盖，
     移动端底部有 tab 栏接管该区域，不留双份空缝） */
  .chat > .composer {
    padding: 4px 16px 8px;
    border-top: 0;
    background: transparent;
  }
  /* iOS Safari 聚焦 <16px 的输入框会触发视口自动放大，打完字还要 pinch 收回——
     textarea 必须留 16px；想让空态看着轻一点只能压 placeholder（占位符字号不影响聚焦判定）。
     盒内继续收紧：外内边距左 12→8、gap 10→8、textarea 上下 10→8、发送键 40→36，盒高 62→54。
     左右内边距都收到 6：回形针/发送键的图标视觉内缩 ≈14.5 / 16.5px，两侧基本对称且贴边。
     回形针不再写 margin-top：按钮与内容区等高时 flex-start 的中心本就落在首行中线上。 */
  .composer__box { padding: 6px; gap: 8px; }
  .composer__textarea { font-size: 16px; padding: 8px 0; }
  .composer__textarea::placeholder { font-size: 15px; }
  .composer__attach svg { width: 14px; height: 14px; }
  .composer__send { width: 44px; height: 44px; }
  .composer__send:not(.composer__send--stop) svg { width: 15px; height: 15px; }
  /* 会话态底条比入口态更紧凑：入口态是首屏 hero 输入，保留 44 触控档（它也是 mobile:spec
     的量测态，改动会动到门禁口径）；会话态是常驻底条，控件收到 36 后输入盒由 61 收到 ≈49，
     盒子贴着单行文字，不再被回形针撑出一圈死白，红色停止键也不再是整条最重的一块。 */
  .chat > .composer .composer__box { min-height: 48px; }
  .chat > .composer .composer__attach { width: 36px; height: 36px; }
  .chat > .composer .composer__send { width: 36px; height: 36px; }
  .chat > .composer .composer__textarea { padding: 6px 0; }
  /* 图标随按钮同档放大到 16：14px 图标落在 36 的键里会显得更小、与发送键不同权重 */
  .chat > .composer .composer__attach svg,
  .chat > .composer .composer__send:not(.composer__send--stop) svg { width: 16px; height: 16px; }
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
  .stage-nav { gap: 2px; }
  /* 40→36（2026-11-05 去肥胖化）：36 是 mobile:spec 的硬触控下沿，顶栏得以收 4px；
     与 .panel__head 同高（pill-align 门禁等式）；左右 padding 去掉（无胶囊底） */
  .stage-nav__item { padding: 4px 2px; font-size: 12px; gap: 4px; min-height: 36px; }
  /* 窄屏「查看方案」与阶段导航同抬到 36（触控下沿 + 头部带等高，2026-11-06 复核）：
     基础档两者都是 30，这里必须同步改，否则按钮一出现仍会把这一条顶高 6px */
  .chat__show-proposal { min-height: 36px; }
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
  /* 清空重聊移动端入口的样式在上方 .panel:not(--collapsed) 区块（钉在面板底部，
     2026-11-05 从滚动层挪出）；此处不再重复声明 */

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
  /* 底衬 14 → 40（2026-11-05）：本条整条覆盖上面的 padding，底部必须显式带上渐变让位值 */
  .chat__scroll { padding: 14px 14px 40px; }
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
  /* 完成态浮层只有「查看我的路径」一个下一步：动作行撑满卡片宽、主按钮独占余宽。
     原先动作行按内容宽（247px）居中在 620px 卡片里，主钮 142、次钮 93，左右各空 ~187px，
     下一步在视觉上没有重心（2026-10-08 用户侧走查 1440 实测）。桌面专属——窄屏浮层本就窄。 */
  .proposal__actions--center { width: 100%; }
  .v2-page .proposal__actions--center .btn-primary { flex: 1; justify-content: center; }
}

/* 4K zoom 档（≥2000，zoom 1.15/1.3）动作行收回对话框比例：flex:1 撑满 620 卡
   再叠 zoom，主钮渲染出 650px+ 的色块（2026-10-09 用户反馈「按钮太大了」）。
   行宽封顶 460 设计 px（随 zoom 等比、与卡片保持同倍率），主钮在行内仍 flex:1 保重心。 */
@media (min-width: 2000px) {
  .proposal__actions--center { max-width: 460px; margin-inline: auto; }
}

@media (max-width: 1100px) {
  /* 窄屏阶段导航一行放不下「澄清问题 + 已收集 5/7」（390 实测该行只有 ~11px 余量，
     与右上「目标信息」按钮共享）。移动端计数已由面板角标承担，这里隐藏随行计数。 */
}

/* 沉浸式顶栏（2026-11-05 屏效比第 5 刀·大胆档）：goal tab ≤768 撤品牌栏——
   dock 已高亮「目标规划」表达位置，步骤条带吸顶承担阶段语境，顶部再省 65px；
   铃铛/头像菜单（含主题切换）在「学习台」tab 与设置页仍可达，本页为纯沉浸对话。
   平板竖屏 769-1100 保留导航（该档是移动布局但已接近桌面导航尺寸）。 */
@media (max-width: 768px) {
  .goal :deep(.v2nav-bar) { display: none; }
  /* 步条带成为吸顶：不透明画布底 + 发丝线下缘，气泡从下方穿过时边界不生硬 */
  .chat__head {
    background: var(--canvas);
    border-bottom: 1px solid var(--line);
  }
}

/* 内部滚动层统一隐去原生滚动槽（2026-11-05 去肥胖化补 / 2026-11-06 审计 §6）：
   目标面板浮层 / 方案预览浮层 / 生成进度文本 / 入口叙事块都自带 overflow，Windows Chromium
   会在内容右缘画一条 15px 经典滚动槽（灰杠 + 上下箭头）——它把行内文字挤窄一截，还会和
   面板自己的渐隐遮罩叠成「双边框」，读起来像内容没对齐。与 .chat__scroll 同一口径
   （审计允许「隐藏或极简化」，这里取更干净的隐藏：内容外缘不被滚动槽再切一刀，
   滚轮 / 触控 / 键盘滚动、焦点滚入视野均不变）。 */
.panel,
.panel__body,
.proposal__body,
.proposal--center,
.proposal__stream-text,
.entry { scrollbar-width: none; }
.panel::-webkit-scrollbar,
.panel__body::-webkit-scrollbar,
.proposal__body::-webkit-scrollbar,
.proposal--center::-webkit-scrollbar,
.proposal__stream-text::-webkit-scrollbar,
.entry::-webkit-scrollbar { width: 0; height: 0; }
</style>
