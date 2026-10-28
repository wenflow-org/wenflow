<template>
  <div class="mk-page cp">
    <!-- ===== 顶部栏（sticky 寻路 + 刷新级必须项；身份详情在 hero，阶段轴收敛进「阶段推进」卡）。
         虚拟/黑盒会话保留：日期模拟进度、AI 调用预算护栏、自动驾驶指示只在这里有落点。
         真实会话不渲染（2026-10-11 走查「这俩是不是重叠了」）：条内会话 ID 与壳层面包屑 + hero 徽标
         三处重复（且两处截断方向不同，看着像两个 ID），只读声明与出口已迁进 hero。 ===== -->
    <header v-if="!isRealMode" class="cp-topbar">
      <div class="mk-status" :class="`mk-status--${headerHealth}`">
        <span class="mk-status__dot" aria-hidden="true"></span>
        <button type="button" class="mk-back" @click="goBack">← {{ backLabel }}</button>
        <strong class="mk-status__title">只读监控 <span class="cp-title__id mono">{{ shortId }}</span></strong>
        <!-- 自动驾驶进行中的状态指示（停止按钮在控制台） -->
        <span v-if="autopilotRunning" class="mk-status__meta cp-topbar__autopilot">▶ 自动驾驶 · {{ Number(autopilot.steps || 0) }} 步</span>
        <span class="mk-status__sep"></span>
        <!-- 双轴状态（生命周期徽章 + 阶段条）按原型收敛：生命周期 → hero 状态 pill，阶段 → 「阶段推进」stepper -->
        <span class="mk-status__meta">{{ modeText }}</span>
        <!-- 日期模拟推进进度（虚拟会话；未开启则显示"未开启"） -->
        <span
          v-if="simClock"
          class="mk-status__meta cp-simday"
          :title="simClock.enabled
            ? `日期模拟：起点 ${simClock.baseDate}。已推进 ${simClock.dayIndex}/${simClock.maxSimulatedDays} 天。课表 ${simClock.courseWeekdays.join('/')} · 每天 ${simClock.lessonsPerDay} 节${simClock.autoAdvance ? ' · 自动推进已开' : ''}`
            : '日期模拟未开启（可在「日期模拟」设置开启）'"
        >
          模拟 {{ simClock.enabled ? `第 ${simClock.dayIndex} 天` : '未开启' }}
        </span>
        <!-- 预算消耗预警条（累积 AI 调用）：成本护栏。无配置时显示「不限」，不猜默认值；
             真实会话没有这套 AI 调用预算模型，恒显「0/不限」是噪音，故隐藏 -->
        <span
          v-if="!isRealMode"
          class="cp-budget"
          :class="`is-${budgetTone}`"
          :title="budgetUsage.unlimited
            ? `本会话累计 AI 调用 ${budgetUsage.used}（含重试）。当前未设置成本上限（不限）。可在画像/故事预算中设置上限`
            : `本会话累计 AI 调用 ${budgetUsage.used}/${budgetUsage.limit}（含重试）。可在画像/故事预算中调整上限`"
        >
          <span class="cp-budget__label">AI 调用</span>
          <!-- 进度量化统一走 .mk-minibar：预算三档（默认 / warn / full）与 ok/warn/bad 语义一一对应 -->
          <span class="mk-minibar cp-budget__track">
            <i
              class="mk-minibar__fill"
              :data-tone="budgetTone === 'full' ? 'bad' : budgetTone === 'warn' ? 'warn' : 'ok'"
              :style="{ width: `${budgetPct}%` }"
            ></i>
          </span>
          <span class="cp-budget__num">{{ budgetUsage.used }}/{{ budgetUsage.unlimited ? '不限' : budgetUsage.limit }}</span>
        </span>
        <!-- 2026-10-23：刷新统一跟顶栏（本页 watch(liveRefreshSeq) → refresh），状态条不再出第二颗 -->
      </div>
    </header>

    <!-- ===== hero（原型 renderSessionDetail）：会话身份 + 状态/阶段 pills + 真实能力动作 =====
         主标题传会话主题（2026-10-04 全站评审 P2-7：截断裸会话 ID 做 24px/700 主标题不可读，
         人类可读主题此前缩在 12.5px 副行）；无主题回退 shortId。会话 ID 降为 pills 行 meta。 -->
    <MkDetailHero class="cp-hero" avatar="S" :title="heroTitle" :sub="heroSub">
      <template #pills>
        <!-- 状态 pill：生命周期合成态（与原顶栏徽章同源，原型 statusPill 位） -->
        <span class="mk-badge" :class="`mk-badge--${heroStatusTone}`" :title="statusTitle">{{ heroStatusText }}</span>
        <!-- 阶段 pill：归一后的当前阶段（原型 pill--info 位） -->
        <span class="mk-badge mk-badge--info">{{ stageLabel(currentStage) }}</span>
        <!-- 课堂类型 pill（2026-10-21）：正课/复习课/延伸课；后两者不结算任务 -->
        <span v-if="classroomMode" class="mk-badge" :class="classroomModeBadge" :title="classroomModeTitle">{{ classroomModeText }}</span>
        <!-- 只读模式声明（原顶栏 .mk-status__meta 迁入，2026-10-11 走查）：真实会话控制台只读，
             这条提示得随身份区一起在，不能随顶栏撤掉 -->
        <span v-if="isRealMode" class="mk-badge mk-badge--muted" title="真实会话控制台只读：不可推进阶段、不可改会话状态">{{ modeText }}</span>
        <!-- 回合 pill 撤（2026-10-04 全站评审 P3#13）：回合数单源=「阶段推进」卡 statstrip
             「已用回合」格，同屏双写收敛 -->
        <!-- 学习者身份（2026-10-18 用户走查）：页头此前只说「这是哪个会话」，不说是谁的会话；
             名字常显、邮箱与 id 进 title，入口按钮在动作区（唯一入口，不重复挂第二枚） -->
        <span v-if="learner" class="mk-badge mk-badge--muted cp-hero__learner" :title="learnerTitle('会话所属学习者')">
          学习者 {{ learnerText }}
        </span>
        <!-- 会话 ID meta：主标题已让位给会话主题；2026-10-23 走查把截断裸 ID 也从 pills 行撤下
             （「…4d2-7ac8d952403d」紧贴学习者徽章，读成身份的一部分）。完整 ID 在 URL、
             会话数据包与复制 JSON 里，排障取用不受影响。 -->
      </template>
      <template #actions>
        <!-- 真实会话（只读，无生命周期控制）只留确定性出口。刷新收归顶栏一颗
             （2026-10-19 用户走查「刷新重复了吧」）：hero 这颗与顶栏那颗同屏并列、动作又各刷一半
             ——顶栏刷全站 live 域，本页会话载荷走独立 console 接口不在其中，读者点了以为重复。
             现由本页 watch(liveRefreshSeq) 接住顶栏刷新（同 Orchestrator 判例），hero 不再出刷新钮。 -->
        <template v-if="isRealMode">
          <!-- 学习者详情入口（2026-10-18）：目标对话 / 学习路径 / 教学会话三处此前都没有
               去学习者详情的按钮；返回靠 subPage.from 记住本座舱页签 -->
          <button v-if="learner" type="button" class="mk-btn" :title="learnerTitle('查看学习者详情')" @click="openLearnerDetail">查看学习者</button>
          <!-- 异常会话的唯一排查出口（2026-10-26）：列表侧不摆第二颗钮（2026-10-19 决定），
               出口放在座舱里，按 sessionId 落到执行日志的 Trace 归组。 -->
          <button type="button" class="mk-btn" @click="goExecLogs">执行日志</button>
          <button type="button" class="mk-btn" :title="backTip" @click="goBack">← {{ backLabel }}</button>
        </template>
        <!-- 动作区只放真实能力（原型「导出日志」假钮不搬）：会话生命周期控制（vlab-controls 统一模型）
             从统一控制台迁入 hero 动作位；危险动作（停止/删除）用 danger 形态（原型「中断会话」位） -->
        <button
          v-for="c in lifeControlsCockpit"
          :key="c.key"
          type="button"
          class="mk-btn"
          :class="{ 'mk-btn--danger': c.tone === 'danger' }"
          :disabled="busy"
          :title="c.hint"
          @click="runCockpitAction(c)"
        >{{ c.label }}</button>
      </template>
    </MkDetailHero>

    <!-- 教学建议条（原教学会话抽屉「建议」页签的文案落点，2026-10-01 随抽屉退役迁入座舱）：
         真实会话控制台接口本就带回 advisory（priority/title/text），数据真实不硬造 -->
    <div v-if="realAdvisory" class="cp-advisory" :class="`cp-advisory--${realAdvisory.priority}`" role="note">
      <span class="mk-badge" :class="`mk-badge--${realAdvisory.priority === 'high' ? 'bad' : 'warn'}`">教学建议</span>
      <span class="cp-advisory__text"><template v-if="realAdvisory.title">{{ realAdvisory.title }}<template v-if="realAdvisory.text"> · </template></template>{{ realAdvisory.text }}</span>
      <!-- 学员处置（2026-10-21）：v0 只留痕，座舱如实展示「保留/稍后再看/预览过」 -->
      <span v-if="learnerAdvisoryResponse" class="mk-badge mk-badge--muted" :title="`学员处置记录时间：${learnerAdvisoryResponse.at || '未记录'}`">学员处置 · {{ learnerAdvisoryResponse.label }}</span>
    </div>

    <!-- 延伸学进行中（assisted 轨）：回合进度实时可见，结束后由下方「延伸学观测」接棒 -->
    <div v-if="extensionRuntime" class="cp-advisory" role="note">
      <span class="mk-badge mk-badge--info">延伸中</span>
      <span class="cp-advisory__text">已进行 {{ extensionRuntime.turns }}/{{ extensionRuntime.maxTurns }} 回合 · 正课已达标，本任务暂不结算</span>
    </div>

    <!-- 延伸学观测（#124）：延伸段轮数/负荷/学到的概念；一期只观测，不产生路径调整建议 -->
    <div v-if="extensionObservability" class="cp-advisory" role="note">
      <span class="mk-badge mk-badge--info">延伸学观测</span>
      <span class="cp-advisory__text">
        {{ extensionObservability.turnCount }} 轮<template v-if="extensionObservability.sessionLss != null"> · LSS {{ scoreText(extensionObservability.sessionLss) }}</template><template v-if="extensionObservability.sessionLf != null"> · LF {{ scoreText(extensionObservability.sessionLf) }}</template><template v-if="extensionObservability.learnedConcepts.length"> · 已掌握 {{ extensionObservability.learnedConcepts.slice(0, 4).join('、') }}{{ extensionObservability.learnedConcepts.length > 4 ? ' 等' : '' }}</template>
      </span>
    </div>

    <!-- 卡死归因（append-only）：最近一次非收敛判定的原因与回合，证据不再只活在日志里 -->
    <div v-if="stuckAttribution" class="cp-advisory" role="note" :title="stuckAttribution.at ? `记录时间：${stuckAttribution.at}` : undefined">
      <span class="mk-badge mk-badge--warn">无响应归因</span>
      <span class="cp-advisory__text">共 {{ stuckAttribution.count }} 次<template v-if="stuckAttribution.turn"> · 第 {{ stuckAttribution.turn }} 回合</template><template v-if="stuckAttribution.reason"> · {{ stuckAttribution.reason }}</template></span>
    </div>

    <!-- ===== 课时健康读数（P1#7）：单课总结读数上提首屏，不再埋 Learn 页签深处；
         口径诚实：当前查看课时单课读数，会话级聚合待后端 ===== -->
    <div v-if="healthStrip" class="cp-healthstrip" role="note" :title="healthStripTitle">
      <span class="cp-healthstrip__label">课时读数<template v-if="viewedLesson"> · {{ viewedLesson.title }}</template></span>
      <span class="cp-healthstrip__text mono">{{ healthStrip.text }}</span>
    </div>

    <!-- F27 超时读数条（2026-10-15）：失败徽章与 0/N 读数说不清「本课发生过什么」，首屏一条 note 带出
         本任务回合 + 已完成节数 + 重试语义；复用 cp-advisory 条样式（amber 底），无新 CSS -->
    <div v-if="timeoutReadout" class="cp-advisory" role="note">
      <span class="mk-badge mk-badge--warn">授课超时</span>
      <span class="cp-advisory__text">{{ timeoutReadout }}</span>
    </div>

    <!-- ===== 统一控制台：该阶段操作（原阶段 tab 导航已收敛进「阶段推进」stepper，操作能力原样保留） =====
         v-if="!isRealMode"（2026-10-11 走查）：条内每个分支都以 !isRealMode 为前提
         （① 自动驾驶 / ② 阶段操作 / ③′ 黑盒入口），真实会话下恒无内容 → 此前只剩一条
         18px 空带带 1px 下边框，像一条无来由的分隔线；无内容就不渲染。 -->
    <div v-if="!isRealMode" class="cp-console">
      <div class="cp-console__actions">
        <!-- ① 执行推进（跨阶段：自动驾驶（全流程后台）/ 停止自动驾驶；黑盒与真实会话不提供） -->
        <template v-if="!isRealMode && !isBlackbox">
          <template v-if="autopilotQueued">
            <button type="button" class="cp-btn" :disabled="busy" title="自动驾驶运行名额已满，正在排队等待，点击取消排队" @click="act('autopilotStop')">取消排队（第 {{ autopilot.queuePosition || 1 }} 位）</button>
          </template>
          <template v-else-if="!autopilotRunning">
            <button v-if="!autopilotStopping" type="button" class="cp-btn cp-btn--primary" :disabled="autopilotStartDisabled" :title="autopilotStartTitle" @click="act('autopilotStart')">自动驾驶</button>
            <button v-else type="button" class="cp-btn" disabled title="已请求停止自动驾驶：后台已停止推进，可点击「自动驾驶」重新启动" @click="act('autopilotStart')">已请求停止</button>
          </template>
          <button v-else type="button" class="cp-btn" :disabled="busy" title="停止自动驾驶：当前课推进完本轮后停止后台自动运行（学习进度与对话保留，可随时再次启动）" @click="act('autopilotStop')">停止自动驾驶</button>
          <span class="cp-console__sep"></span>
        </template>

        <!-- ② 阶段操作（随当前页签切换） -->
        <template v-if="!isRealMode && !isBlackbox && activeTab === 'goal'">
          <button type="button" class="cp-btn" :disabled="goalStepDisabled" :title="goalStepTitle" @click="act('step')">推进一步</button>
          <button type="button" class="cp-btn" :disabled="goalAutoDisabled" :title="goalAutoTitle" @click="act('auto')">自动推进目标</button>
          <button type="button" class="cp-btn" :disabled="advancePathDisabled" :title="advancePathTitle" @click="act('advancePath')">生成路径</button>
          <button v-if="goalConverged" type="button" class="cp-btn" @click="selectStageTab('path')">前往路径 →</button>
        </template>
        <template v-if="!isRealMode && !isBlackbox && activeTab === 'path'">
          <button type="button" class="cp-btn" :disabled="advancePathDisabled" :title="advancePathTitle" @click="act('advancePath')">生成路径</button>
          <button type="button" class="cp-btn cp-btn--primary" :disabled="startLearningDisabled" :title="startLearningTitle" @click="act('startLearning')">启动教学</button>
          <button type="button" class="cp-btn" :disabled="resetPathDisabled" :title="resetPathTitle" @click="act('resetPath')">重建路径</button>
        </template>
        <template v-if="!isRealMode && !isBlackbox && activeTab === 'learning'">
          <button v-if="!hasLearningProgress" type="button" class="cp-btn cp-btn--primary" :disabled="startLearningDisabled" :title="startLearningTitle" @click="act('startLearning')">启动教学</button>
          <template v-else>
            <button type="button" class="cp-btn" :disabled="learnStepDisabled" :title="learnStepTitle" @click="act('step')">推进一步</button>
            <button type="button" class="cp-btn cp-btn--primary" :disabled="learnAutoDisabled" :title="learnAutoTitle" @click="act('auto')">自动推进本课</button>
            <label class="cp-turn-cap-label" title="本屏临时值，只作用于接下来这一次推进">
              每课回合上限
              <input v-model.number="learnAutoTurnCap" type="number" min="1" max="100" class="cp-turn-cap" title="本屏临时值，超出 1–100 时按 1 或 100 处理" aria-label="每课回合上限" @change="learnAutoTurnCap = clampLearnAutoTurnCap()" />
            </label>
            <!-- 进行中重开本课（失败后的「重试」由生命周期区统一承载，不重复；失败终态也不再给） -->
            <button v-if="!isInterruptedTerminal" type="button" class="cp-btn" :disabled="resetLearningDisabled" :title="resetLearningTitle" @click="act('resetLearn')">重开本课</button>
          </template>
        </template>
        <template v-if="!isRealMode && !isBlackbox && activeTab === 'wrapup'">
          <button v-if="!hasWrapup" type="button" class="cp-btn" :disabled="wrapupDisabled" :title="wrapupTitle" @click="act('wrapup')">生成终局总结</button>
        </template>

        <!-- ③ 会话生命周期已迁至 hero 动作区（原型 hero 右侧动作位），此处不再重复 -->
        <!-- ③′ 黑盒人工入口（报告 #37，原两分支零按钮可达）：推进由黑盒执行器承担，
             人工操作只有 终止实验 / 按原输入重跑（后者仅终态，后端 409 契约同口径前置） -->
        <template v-if="!isRealMode && isBlackbox">
          <button type="button" class="cp-btn" :disabled="busy" title="终止当前黑盒实验：公开轨迹与评估保留，不可撤销" @click="act('abandon')">终止实验</button>
          <button type="button" class="cp-btn" :disabled="busy || !isTerminal" :title="blackboxRerunTitle" @click="act('rerun')">按原输入重跑</button>
          <span class="cp-console__sep"></span>
        </template>
        <!-- 黑盒模式声明（2026-10-04 全站评审 P3#13）：真实会话的「只读监控」声明已并入
             顶栏模式 chip（modeText 单源），此处不再对真实会话重复一遍 -->
        <span v-if="isBlackbox" class="cp-console__note">
          黑盒模式：不提供手动操作
        </span>
      </div>
    </div>

    <!-- ===== 阶段推进（2026-10-12 重设计：卡 = 标题 + 完成计数 + 出口按钮的头部 + 步点阵本体。
         原下方 MkStatStrip 三读数撤——「当前阶段/下一阶段」步点阵自身已表达、「已用回合」与
         Goal 步点的「学习者发言 N」近重复且历史上两次被误读（含/不含平台回复）；头部
         「回合状态机」黑话 meta 同步撤。步点即阶段页签导航。） ===== -->
    <section class="mk-card cp-stepcard">
      <div class="mk-card__head">
        <h3 class="mk-card__title">阶段推进</h3>
        <span class="cp-stepcard__spacer"></span>
        <span class="mk-card__meta">已完成 <b class="mono">{{ stageDoneCount }}</b> / {{ stageFlow.length }} 阶段</span>
        <!-- 下游直达（2026-10-11 走查）：Path / Learn 的数据本卡已摆在页签里，但下钻到它们自己的页面
             此前要回列表再点一次。两条出口的取数判据与返回记忆见 stageJumpTargets。 -->
        <span v-if="stageJumpTargets.length" class="cp-stepjumps">
          <button
            v-for="j in stageJumpTargets"
            :key="j.key"
            type="button"
            class="mk-btn mk-btn--sm"
            :title="j.title"
            @click="j.go()"
          >{{ j.label }}</button>
        </span>
      </div>
      <div class="cp-cardbody">
        <!-- 2026-10-15 用户走查重设计：原实现是「1380px 宽卡里四枚 20px 圆点各自居中」，
             水平空间几乎全空、读数缩在 12.5px 灰字里（用户原话「很不好看，利用率也低」）。
             改为四枚等宽阶段瓦片：每票一条状态色顶轨 + 状态标记 + 阶段名（正文档）+ 真实读数，
             既填满卡宽，又把「推进到哪一步、每步什么读数」一屏读完。瓦片间用 chevron 连成流水线。 -->
        <div class="cp-stepper" role="tablist" aria-label="阶段推进" @keydown="onStepKeydown">
          <template v-for="(st, i) in stageFlow" :key="st">
            <span v-if="i" class="cp-stepper__arrow" aria-hidden="true"></span>
            <button
              :id="`cp-tab-${st}`"
              type="button"
              role="tab"
              class="cp-stp"
              :class="`cp-stp--${stepState(st)}`"
              :aria-selected="activeTab === st"
              :aria-controls="`cp-tabpanel-${st}`"
              :tabindex="activeTab === st ? 0 : -1"
              :title="isBlackbox ? '黑盒模式下阶段不可手动切换' : `打开「${stageLabel(st)}」页签`"
              :disabled="isBlackbox"
              @click="selectStageTab(st)"
            >
              <span class="cp-stp__dot" aria-hidden="true">{{ stepState(st) === 'done' ? '✓' : i + 1 }}</span>
              <span class="cp-stp__body">
                <span class="cp-stp__name">{{ stageLabel(st) }}</span>
                <span class="cp-stp__meta">{{ stepMeta(st) }}</span>
              </span>
            </button>
          </template>
        </div>
      </div>
    </section>

    <!-- ===== 主体：左侧内容 + 右侧控制台 ===== -->
    <div class="cp-body">
      <!-- 主内容区 -->
      <main class="cp-main">
        <!-- 首次加载失败兜底（对齐页内 cp-degrade 模式）：否则失败仅 toast，主区永远停在骨架/「加载中…」 -->
        <section v-if="sessionLoadFailed && !session" class="mk-card">
          <p class="cp-degrade">会话数据加载失败 <button type="button" class="mk-link" @click="refresh">重试</button></p>
        </section>

        <!-- 学习路径（Path 页签 = 路径内容本体，2026-10-12 拍板）：独立路径详情页已退役，
             路径内容（阶段全展开/任务弹层/治理动作）长在座舱这一页（PathJourneyPanel）。
             页签 meta 仍按会话侧 pathStatus 给「难度 / 预计 / 里程碑数」速读。 -->
        <section v-if="!isBlackbox && activeTab === 'path'" role="tabpanel" :id="`cp-tabpanel-path`" :aria-labelledby="`cp-tab-path`" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">关联学习路径</h3>
            <!-- 右组：meta + 面板治理动作（⋯）的落点。动作逻辑留在面板里，位置收到卡头右缘，
                 不在内容区另起一行——否则只剩一颗 ⋯ 会让卡头与首个阶段之间出现整条空白。 -->
            <span class="cp-path-head-right">
              <span class="mk-card__meta">{{ pathDetailMeta || '等待路径生成' }}</span>
              <span v-if="hasPath && pathId" class="cp-path-acts" data-path-acts></span>
            </span>
          </div>
          <div class="cp-cardbody">
            <MkSkeleton v-if="!session" variant="rows" :count="2" :h="40" :radius="8" />
            <template v-else>
              <PathJourneyPanel v-if="hasPath && pathId" :path-id="pathId" @changed="loadPathStatus" />
              <p v-if="!hasPath && pathStatusFailed" class="cp-degrade">路径状态获取失败 <button type="button" class="mk-link" @click="loadPathStatus">重试</button></p>
              <p v-else-if="!hasPath && pathGenerationInProgress" class="cp-none">路径课程仍在生成，稍后自动刷新。</p>
              <p v-else-if="!hasPath" class="cp-none">{{ pathEmptyHint }}</p>
            </template>
          </div>
        </section>

        <!-- Goal 对话 -->
        <section v-if="!isBlackbox && activeTab === 'goal'" role="tabpanel" :id="`cp-tabpanel-goal`" :aria-labelledby="`cp-tab-goal`" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">目标对话</h3>
            <span class="mk-card__meta">
              {{ !session ? '' : goalConversationMessages.length ? `${goalConversationMessages.length} 条已记录` : '暂无记录' }}
              <template v-if="session && goalConverged"> · 已确认</template>
            </span>
          </div>
          <div class="cp-transcripts">
            <!-- 未加载先骨架，不把「尚未加载」当「确实为空」（2026-10-06 审核 #47） -->
            <MkSkeleton v-if="!session" variant="rows" :count="3" :h="36" :radius="8" />
            <template v-else>
              <article v-for="(message, index) in goalConversationMessages" :key="`goal-${index}`" class="cp-transcript__message" :class="message.role === 'assistant' ? 'is-teacher' : 'is-learner'">
                <span>{{ message.role === 'assistant' ? '平台目标' : isRealMode ? '学习者' : '虚拟学习者' }}</span>
                <!-- 模型输出是 markdown（代码围栏/行内代码/粗体）：按产品同一套 markdown-it + DOMPurify 渲染 -->
                <div class="cp-transcript__content" v-html="renderAiMessageHtml(message.content)"></div>
              </article>
              <MkEmptyState
                v-if="!goalConversationMessages.length"
                compact
                icon="◌"
                title="尚未产生目标对话"
                description="目标澄清尚未开始。"
              />
            </template>
          </div>
        </section>

        <!-- 回合记录（仅虚拟会话，Goal 页）：Goal + 课堂按序合并的旅程表。真实会话的阶段面板
             已各自承载转录，同屏再列一张同样的表就是重复（2026-10-11「goal 阶段对话记录会和记录
             会不会重复了」）。2026-10-12 四页拆分：会话级卡片归位到所属阶段页，不再全页签复读。 -->
        <section v-if="!isRealMode && activeTab === 'goal'" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">回合记录</h3>
            <!-- 加载中 meta 留空（骨架已在下方承担加载态；不写「暂无对话记录」假空文案） -->
            <span class="mk-card__meta" :title="turnMetaTitle || undefined">{{ turnMeta }}</span>
          </div>
          <!-- 会话未加载（首载/切换会话）先给骨架：不得把「尚未加载」渲染成「暂无对话记录」（2026-10-06 审核 #47） -->
          <div v-if="!session" class="cp-cardbody"><MkSkeleton variant="rows" :count="4" :h="12" :radius="4" /></div>
          <!-- 列序对齐原型（# / 类型 / 内容 / …）：Token/耗时/解答分接口没有，不硬造，以真实「时间」列收尾 -->
          <div v-else-if="turnRows.length" class="mk-table-scroll">
            <table class="mk-table cp-turns">
              <thead>
                <tr>
                  <th scope="col" class="cp-turns__num">#</th>
                  <th scope="col">类型</th>
                  <th scope="col" class="cp-turns__wrap">内容</th>
                  <th scope="col">时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in turnRows" :key="row.key">
                  <td class="mono cp-turns__num">{{ row.index }}</td>
                  <td><span class="mk-badge" :class="row.tone">{{ row.type }}</span></td>
                  <td class="cp-turns__wrap">{{ row.content }}</td>
                  <td class="mono cp-turns__time">{{ row.time }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="cp-none cp-turns-empty">本节课堂暂无已记录的对话回合。</p>
        </section>

        <!-- 学习者资料（Goal 页，2026-10-12 四页拆分归位）：goal 阶段把学习者**携带的资料**（上传附件）
             与**系统联网采集**的资料一起纳入上下文，path 生成复用同一份理解摘要 —— 归属 Goal 阶段页。
             后端只在目标对话控制台载荷里给（列表级字段 + brief 摘要，正文不进载荷），无资料整卡不渲染。 -->
        <section v-if="activeTab === 'goal' && realMaterials.length" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">学习者资料</h3>
            <span class="mk-card__meta">{{ materialMetaText }}</span>
          </div>
          <div class="cp-cardbody">
            <article v-for="m in realMaterials" :key="m.id" class="cp-mat">
              <header class="cp-mat__head">
                <span class="mk-badge" :class="m.origin === 'web' ? 'mk-badge--info' : 'mk-badge--muted'">{{ m.originLabel }}</span>
                <strong class="cp-mat__name" :title="m.name">{{ m.name }}</strong>
                <span class="cp-mat__meta mono">{{ m.sizeText }}</span>
                <button type="button" class="mk-link" title="读取存档全文" @click="openMaterialView(m)">查看全文</button>
              </header>
              <p v-if="m.subject" class="cp-mat__subject">{{ m.subject }}</p>
              <p v-if="m.overview" class="cp-mat__overview">{{ m.overview }}</p>
              <p v-else-if="!m.hasBrief" class="cp-mat__none">尚未生成资料理解摘要，在目标对话或路径首次用到该资料时自动生成</p>
              <div v-if="m.concepts.length" class="cp-mat__chips">
                <span v-for="c in m.concepts" :key="c" class="mk-badge mk-badge--sm mk-badge--muted">{{ c }}</span>
              </div>
              <footer class="cp-mat__foot">
                <span v-if="m.docType" class="cp-mat__fact">{{ m.docType }}</span>
                <span v-if="m.tocCount" class="cp-mat__fact">目录 {{ m.tocCount }} 条</span>
                <span v-for="d in m.divisions" :key="d" class="cp-mat__fact">{{ d }}</span>
                <a v-if="m.sourceUrl" class="cp-mat__src" :href="m.sourceUrl" target="_blank" rel="noopener noreferrer" :title="m.sourceUrl">来源 {{ m.sourceHost }}</a>
                <span class="cp-mat__time mono" :title="m.timeTitle">{{ m.timeText }}</span>
              </footer>
            </article>
          </div>
        </section>

        <!-- Learn 课堂 -->
        <section v-if="!isBlackbox && activeTab === 'learning'" role="tabpanel" :id="`cp-tabpanel-learning`" :aria-labelledby="`cp-tab-learning`" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">教学课堂</h3>
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
                  :class="{ 'is-active': viewedLesson?.taskId === l.taskId, [`is-${l.state}`]: true, 'is-readonly': isLessonReadonly(l) }"
                  :disabled="busy || isLessonReadonly(l)"
                  :title="lessonActionTitle(l)"
                  @click="onLessonClick(l)"
                >
                  <span class="cp-learn-tree__mark">{{ lessonMark(l.state) }}</span>
                  <span class="cp-learn-tree__num">第{{ lessonNumber(l.taskId) }}课</span>
                  <span class="cp-learn-tree__title">{{ l.title }}</span>
                </button>
              </div>
            </nav>
            <p v-else class="cp-none">尚未生成课程，请先生成路径并启动教学。</p>
            <!-- 右侧：对话区 -->
            <div class="cp-learn-chat">
              <div v-if="viewedLesson" class="cp-lesson-head">
                <div class="cp-lesson-head__main">
                  <span class="cp-lesson-head__state" :data-state="viewedLesson.state">{{ lessonStateLabel(viewedLesson.state) }}</span>
                  <strong>第 {{ lessonNumber(viewedLesson.taskId) }} 课 · {{ viewedLesson.title }}</strong>
                  <span class="cp-lesson-head__ms">{{ viewedLesson.milestone }}</span>
                </div>
              </div>
              <!-- 加载态用骨架，禁止纯文字（T2 硬约束；2026-10-06 审核 #47） -->
              <MkSkeleton v-if="teachingDetailLoading" variant="rows" :count="3" :h="12" :radius="4" />
              <!-- 单课总结不在此渲染（2026-10-12 二次拍板「总结就单独总结」）：总结只住总结页签，
                   本列只放课堂对话；要总结去总结页点对应课。 -->
              <template v-if="learnConversationMessages.length">
                <article v-for="(message, index) in learnConversationMessages" :key="`learn-${index}`" class="cp-transcript__message" :class="message.role === 'assistant' ? 'is-teacher' : 'is-learner'">
                  <span>{{ message.role === 'assistant' ? '教师' : isRealMode ? '学习者' : '虚拟学习者' }}</span>
                  <div class="cp-transcript__content" v-html="renderAiMessageHtml(message.content)"></div>
                </article>
              </template>
              <p v-else-if="teachingDetailFailed && !learnConversationMessages.length" class="cp-degrade">教学记录获取失败 <button type="button" class="mk-link" @click="loadTeachingDetail(selectedTeachingSessionId)">重试</button></p>
              <p v-else-if="!viewedLesson" class="cp-none">尚未选择课程。</p>
              <p v-else-if="!learnConversationMessages.length" class="cp-none">{{ learnEmptyHint }}</p>
              <!-- 检查点：题目/作答/判分（2026-10-13 走查「教学会话看不到检查点题目」）。
                   2026-10-22 用户「检查点又在下面了」：答错重答会在 history 追加同 checkpointId
                   的新行（后端用来计重答次数），逐行渲染会让同一道题看起来重复；这里按 id 归并，
                   保留最新一次裁决并标尝试次数。 -->
              <div v-if="checkpointGroups.length" class="cp-checkpoints">
                <div class="cp-checkpoints__head">
                  <span class="cp-checkpoints__title">检查点</span>
                  <span
                    class="cp-checkpoints__meta"
                  >{{ checkpointGroups.length }} 个 · {{ lessonCheckpoints.length }} 次作答</span>
                </div>
                <div v-for="(g, i) in checkpointGroups" :key="`cp-${i}`" class="cp-checkpoint">
                  <p class="cp-checkpoint__q">{{ g.cp.question || g.cp.title || '（无题干）' }}</p>
                  <div class="cp-checkpoint__meta">
                    <span class="mk-badge" :class="g.cp.passed === true ? 'mk-badge--ok' : g.cp.passed === false ? 'mk-badge--warn' : 'mk-badge--muted'">{{ g.cp.passed === true ? '通过' : g.cp.passed === false ? '未通过' : '未判分' }}</span>
                    <span v-if="g.attempts > 1" class="cp-checkpoint__tag">尝试 {{ g.attempts }} 次</span>
                    <span class="cp-checkpoint__tag">{{ checkpointTypeLabel(g.cp.type) }}</span>
                    <span v-if="g.cp.judgedBy" class="cp-checkpoint__tag">判分 {{ g.cp.judgedBy }}</span>
                    <span v-if="g.cp.understanding != null" class="cp-checkpoint__tag" title="AI 对本次作答的理解度估计">理解度 {{ Math.round(g.cp.understanding * 100) }}%</span>
                    <span v-if="g.cp.conceptName" class="cp-checkpoint__concept">{{ g.cp.conceptName }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 知识状态更新（Learn 页，2026-10-12 四页拆分归位）：课堂数据不进别的阶段页 -->
        <section v-if="activeTab === 'learning' && knowledgeRows.length" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">知识状态更新</h3>
            <span class="mk-card__meta" :title="knowledgeSourceTitle">{{ knowledgeSourceLabel }}</span>
          </div>
          <div class="cp-cardbody">
            <div class="cp-ranklist">
              <div v-for="k in knowledgeRows" :key="k.name" class="cp-ranklist__row">
                <span class="cp-ranklist__name">{{ k.name }}</span>
                <span v-if="k.statusLabel" class="cp-ranklist__state" :data-tone="k.statusTone">{{ k.statusLabel }}</span>
                <span class="cp-ranklist__val mono">{{ k.value }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 总结 -->
        <section v-if="!isBlackbox && activeTab === 'wrapup'" role="tabpanel" :id="`cp-tabpanel-wrapup`" :aria-labelledby="`cp-tab-wrapup`" class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">学习总结</h3>
            <span class="mk-card__meta">{{ wrapupHeadMeta }}</span>
            <!-- 跨页指引（2026-10-12 走查「为啥资料看不到」）：四页拆分后资料归 Goal 页，
                 本页不留正文，给一颗确定性出口——点 stepper 也能到，这里免找 -->
            <button v-if="realMaterials.length" type="button" class="mk-link" title="学习者资料在目标页" @click="selectStageTab('goal')">学习者资料在目标页 →</button>
          </div>

          <!-- 终局总结（已生成时；总在前、单课分列在后） -->
          <template v-if="hasWrapup">
            <div class="cp-wrapup-stats" v-if="pathDetailTitle || wrapupSourceBadge || sessionLoadView">
              <div class="cp-wrapup-stats__goal" v-if="pathDetailTitle">
                <span class="cp-wrapup-stats__label">学习目标</span>
                <strong>{{ pathDetailTitle }}</strong>
              </div>
              <div class="cp-wrapup-stats__badges">
                <span class="cp-wrapup-stats__item"><em>{{ pathMilestonesView.length }}</em> 个里程碑</span>
                <span class="cp-wrapup-stats__item"><em>{{ learnLessons.length }}</em> 节课</span>
                <span v-if="sessionLoadView" class="cp-wrapup-stats__item" :title="sessionLoadTitle">本轮负荷 {{ sessionLoadView }}</span>
                <span v-if="wrapupSourceBadge" class="mk-badge" :class="wrapupSourceBadge === '模型生成' ? 'mk-badge--info' : 'mk-badge--muted'">{{ wrapupSourceBadge }}</span>
                <span v-if="wrapupStatusBadge" class="mk-badge" :class="wrapupStatusBadge === 'complete' ? 'mk-badge--ok' : 'mk-badge--warn'">{{ wrapupStatusBadge === 'complete' ? '总结完整' : '降级总结' }}</span>
              </div>
            </div>
            <div class="cp-wrapup-cards" v-if="wrapupFieldCards.length">
              <div v-for="card in wrapupFieldCards" :key="card.label" class="cp-wrapup-card">
                <div class="cp-wrapup-card__icon"><component :is="wrapupCardIcon(card.label)" :size="18" aria-hidden="true" /></div>
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

          <!-- 单课总结（2026-10-12 二次拍板「总结就单独总结，不再和课程混在一起」）：课表归 Learn
               （同一棵树不在总结页重复出现），本页签只放总结——已完成且落了课堂的课就地展开，
               不再跳 Learn；终局总结生成后在其上方。手风琴单开：lessonWrapup 是单课计算值。 -->
          <div v-if="wrapupLessonRows.length" class="cp-wrapup-sums">
            <div class="cp-wrapup-sums__head">
              <span class="cp-wrapup-sums__title">单课总结</span>
              <span class="cp-wrapup-sums__meta">{{ wrapupLessonRows.length }} 节已完成</span>
            </div>
            <div v-for="l in wrapupLessonRows" :key="l.taskId" class="cp-wrapup-sum">
              <button
                type="button"
                class="cp-wrapup-sum__row"
                :class="{ 'is-open': expandedWrapupTaskId === l.taskId }"
                :aria-expanded="expandedWrapupTaskId === l.taskId"
                @click="toggleWrapupLesson(l)"
              >
                <span class="cp-wrapup-sum__mark">✓</span>
                <span class="cp-wrapup-sum__num">第{{ lessonNumber(l.taskId) }}课</span>
                <span class="cp-wrapup-sum__title">{{ l.title }}</span>
                <span class="cp-wrapup-sum__caret" aria-hidden="true">{{ expandedWrapupTaskId === l.taskId ? '▾' : '▸' }}</span>
              </button>
              <div v-if="expandedWrapupTaskId === l.taskId" class="cp-wrapup-sum__body">
                <!-- 加载态用骨架，禁止纯文字（T2 硬约束；2026-10-06 审核 #47） -->
                <MkSkeleton v-if="teachingDetailLoading" variant="rows" :count="3" :h="12" :radius="4" />
                <div v-else-if="hasLessonWrapup && lessonWrapup" class="cp-lesson-wrapup" :class="{ 'is-degraded': lessonWrapup.degraded }">
                  <div class="cp-lesson-wrapup__head">
                    <span class="cp-lesson-wrapup__badge" :class="{ 'is-degraded': lessonWrapup.degraded }">
                      {{ lessonWrapup.degraded ? '降级总结 · 本课未完整结束' : '本课总结' }}
                    </span>
                    <span class="cp-lesson-wrapup__scores">
                      <span v-if="lessonWrapup.duration" class="cp-lesson-wrapup__score">{{ lessonWrapup.duration }} 分钟</span>
                      <span v-if="lessonWrapup.turnCount" class="cp-lesson-wrapup__score">{{ lessonWrapup.turnCount }} 轮对话</span>
                      <span v-if="lessonWrapup.avgUnderstanding !== null" class="cp-lesson-wrapup__score">理解 {{ Math.round(lessonWrapup.avgUnderstanding * 100) }}%</span>
                      <span v-if="lessonWrapup.avgEngagement !== null" class="cp-lesson-wrapup__score">参与 {{ Math.round(lessonWrapup.avgEngagement * 100) }}%</span>
                      <span v-if="lessonWrapup.lss !== null" class="cp-lesson-wrapup__score cp-lesson-wrapup__score--primary">LSS {{ scoreText(lessonWrapup.lss) }}</span>
                      <span v-if="lessonWrapup.ktl !== null" class="cp-lesson-wrapup__score cp-lesson-wrapup__score--primary">KTL {{ scoreText(lessonWrapup.ktl) }}</span>
                    </span>
                  </div>
                  <div class="cp-lesson-wrapup__body">
                    <p v-if="lessonWrapup.degraded" class="cp-lesson-wrapup__notice">
                      本节课未完整结束（超时或提前中断），以下仅保留基础学习记录。完整练习建议与课堂评价未生成。
                    </p>
                    <!-- 主题摘要 / 学习评估（2026-10-12 走查）：门槛读这两个字段、卡身却从未渲染——
                         真实课堂的 wrapup 恰好只有这几项，此前卡显示「✓ 本课总结」但正文空空 -->
                    <div v-if="lessonWrapup.topicSummary" class="cp-lesson-wrapup__section">
                      <span class="cp-lesson-wrapup__section-title">主题摘要</span>
                      <p class="cp-lesson-wrapup__text">{{ lessonWrapup.topicSummary }}</p>
                    </div>
                    <div v-if="lessonWrapup.learningEvaluation" class="cp-lesson-wrapup__section">
                      <span class="cp-lesson-wrapup__section-title">学习评估</span>
                      <p class="cp-lesson-wrapup__text">{{ lessonWrapup.learningEvaluation }}</p>
                    </div>
                    <!-- 知识点掌握 -->
                    <div v-if="lessonWrapup.knowledgeItems.length" class="cp-lesson-wrapup__section">
                      <span class="cp-lesson-wrapup__section-title">知识点掌握</span>
                      <div v-for="k in lessonWrapup.knowledgeItems" :key="k.name" class="cp-lesson-wrapup__kp">
                        <span class="cp-lesson-wrapup__kp-name">{{ k.name }}</span>
                        <span class="cp-lesson-wrapup__kp-status" :class="`is-${k.status}`">{{ KNOWLEDGE_STATUS_TEXT[k.status] || k.status }}</span>
                        <!-- #134：wrapup skill 未找到回链证据时打的标记，首次有读取方（此前全库零消费） -->
                        <span v-if="k.evidenceUnverified" class="cp-lesson-wrapup__kp-unverified" title="完成时未找到该点的课内回链证据，掌握结论未经核实">证据未核实</span>
                        <!-- 单值进度条走共享原语 .mk-minibar（原 .cp-lesson-wrapup__kp-bar 是它的逐字重写：
                             同 6px / 999px / --mk-minibar-bg，只是没挂原语类） -->
                        <span class="mk-minibar"><i class="mk-minibar__fill" data-tone="ok" :style="{ width: (k.progress || 0) + '%' }"></i></span>
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
                      <!-- 情绪计数：原为四个表情前缀（对应正面/中性/受挫/困惑四档），2026-10-14 与自动驾驶
                           状态行同批撤除——同行「认知」「疲劳风险」都是纯文字，表情只重复了后面的数字
                           含义；改词表后读者不必先认表情再对号。 -->
                      <span>情绪: 正面 {{ lessonWrapup.positiveEmotions }} · 中性 {{ lessonWrapup.neutralEmotions }} · 受挫 {{ lessonWrapup.frustratedEmotions }} · 困惑 {{ lessonWrapup.confusedEmotions }}</span>
                      <span v-if="lessonWrapup.fatigueRisk">疲劳风险: {{ lessonWrapup.fatigueRisk }}</span>
                    </div>
                  </div>
                </div>
                <p v-else class="cp-none">该课暂无可显示的总结。</p>
              </div>
            </div>
          </div>

          <!-- 会话未加载先骨架；空态仅在确实加载完（session 存在）后给（2026-10-06 审核 #47） -->
          <div v-if="!session" class="cp-cardbody"><MkSkeleton variant="rows" :count="3" :h="12" :radius="4" /></div>
          <p v-else-if="!hasWrapup && !wrapupLessonRows.length" class="cp-none" style="padding: 24px 16px;">{{ wrapupEmptyHint }}</p>
        </section>

        <!-- 终局评估面板已随裁判独立面移除（2026-09-27）：报告仍在会话数据里，独立评审面为 /api/admin/session-audits -->

        <!-- 会话级卡片已按「四页拆分」归位到所属阶段页（2026-10-12 用户拍板「拆成四个页面，独立的」）：
             回合记录（虚拟）与学习者资料 → Goal 页；知识状态更新 → Learn 页。
             原共享 .cp-detail-grid（四页签底下复读同一坨 1371px 卡片）随之退役。 -->

        <!-- 会话数据包（2026-10-18 用户走查：原「原始会话数据」整包 JSON 直排偏源码开发）。
             主列只留一行「这包数据里有什么」的读数；整包载荷是排查物，收进弹层，
             日常监控看四个阶段页签即可。 -->
        <section class="cp-raw">
          <span class="cp-raw__title">会话数据包</span>
          <span class="cp-raw__facts">{{ packageFacts }}</span>
          <span class="cp-raw__acts">
            <button type="button" class="mk-link" @click="rawOpen = true">查看原始数据</button>
            <button type="button" class="mk-link" @click="copyRawJson">复制 JSON</button>
          </span>
        </section>
      </main>

      <!-- ===== 右列：阶段卡（按当前阶段） + 运维面板（折叠） ===== -->
      <aside class="cp-sidebar">
        <!-- Goal 阶段卡：预生成 Path（左对话 / 右提案 两列语义） -->
        <section v-if="!isRealMode && !isBlackbox && activeTab === 'goal'" class="mk-card">
          <div class="mk-card__head">
            <h4 class="mk-card__title">预生成路径 <span class="cp-aside-dot" :class="hasPath ? 'is-ok' : pathGenerationFailed ? 'is-bad' : goalConverged ? 'is-warn' : 'is-muted'"></span></h4>
            <span class="mk-card__meta">{{ hasPath ? `已生成 ${pathMilestonesView.length} 个里程碑` : goalConverged ? '目标已确认，待生成' : '未生成（目标未确认）' }}</span>
          </div>
          <div class="cp-aside-body">
            <template v-if="hasPath">
              <div class="cp-aside-state cp-aside-state--ok">
                <strong>路径方案已生成</strong>
                <p>包含 {{ pathMilestonesView.length }} 个里程碑 · {{ learnLessons.length || '—' }} 节课。</p>
              </div>
            </template>
            <template v-else-if="pathGenerationInProgress">
              <div class="cp-aside-state cp-aside-state--busy">
                <span class="cp-aside-state__spin" aria-hidden="true"></span>
                <strong>正在生成路径方案…</strong>
                <p>里程碑与课程树生成中，稍后自动刷新。</p>
              </div>
            </template>
            <template v-else>
              <div class="cp-aside-state" :class="goalConverged ? 'cp-aside-state--warn' : 'cp-aside-state--empty'">
                <span class="cp-aside-state__icon" aria-hidden="true">{{ goalConverged ? '◎' : '◌' }}</span>
                <strong>{{ goalConverged ? '路径尚未生成' : '目标尚未确认' }}</strong>
                <p>{{ goalConverged
                  ? '目标澄清已完成，可生成学习路径方案。'
                  : '继续「推进一步」或「自动推进目标」，澄清完成后自动进入路径生成。' }}</p>
              </div>
            </template>
          </div>
        </section>

        <!-- Path 阶段卡：Path 评审（左方案 / 右评审 两列语义） -->
        <section v-if="!isRealMode && !isBlackbox && activeTab === 'path'" class="mk-card">
          <div class="mk-card__head">
            <h4 class="mk-card__title">路径评审 <span class="cp-aside-dot" :class="pathReviewStatus ? 'is-ok' : 'is-muted'"></span></h4>
            <span class="mk-card__meta">{{ pathReviewStatus ? pathReviewDecisionLabel : '未评审' }}</span>
          </div>
          <div class="cp-aside-body">
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
            <p v-else class="cp-none">尚未评审。</p>
          </div>
        </section>

        <!-- Learn 阶段卡：运行状态（左课堂 / 右监控 两列语义） -->
        <section v-if="!isRealMode && !isBlackbox && activeTab === 'learning'" class="mk-card">
          <div class="mk-card__head">
            <h4 class="mk-card__title">运行状态 <span class="cp-aside-dot" :class="`is-${autopilotHealth}`"></span></h4>
            <span class="mk-card__meta">{{ sessionStatusLabel }}</span>
          </div>
          <div class="cp-aside-body">
            <!-- 内芯抽共享（审核 #73）：与侧栏折叠运维面板同一份 RunStatusPanel -->
            <RunStatusPanel
              v-model:friction-budget="frictionBudget"
              v-model:sim-model="simModel"
              :autopilot-result-text="autopilotResultText"
              :autopilot-running="autopilotRunning"
              :autopilot-status="autopilot.status"
              :driver="autopilotDriver"
              :stage-done="stageDone"
              :stage-active="stageActive"
              :stage-mini-status="stageMiniStatus"
              :stage-label="stageLabel"
              :is-blackbox="isBlackbox"
              :show-path-readiness="showPathReadiness"
              :path-readiness-tone="pathReadinessTone"
              :path-readiness-text="pathReadinessText"
              :available-models="liveApiConfig?.availableModels || []"
              :friction-saving="frictionSaving"
              :sim-model-saving="simModelSaving"
              v-model:experiment-arm="experimentArm"
              v-model:extension-probe="extensionProbe"
              v-model:advisory-response="advisoryResponse"
              :flags-saving="simFlagsSaving"
              @save-friction="saveFriction"
              @save-model="saveModel"
              @save-flags="saveSimFlags"
            />
          </div>
        </section>

        <!-- 总结阶段卡：总结状态（CP3：原「总结统计」正文复读左卡「N/M 课已完成 · 终局总结已生成」，
             改为行动/状态指向——计数与生成状态由左「学习总结」卡单源承载） -->
        <section v-if="!isRealMode && !isBlackbox && activeTab === 'wrapup'" class="mk-card">
          <div class="mk-card__head">
            <h4 class="mk-card__title">总结状态 <span class="cp-aside-dot" :class="hasWrapup ? 'is-ok' : 'is-muted'"></span></h4>
          </div>
          <div class="cp-aside-body">
            <div class="cp-aside-state" :class="hasWrapup ? 'cp-aside-state--ok' : 'cp-aside-state--empty'">
              <span class="cp-aside-state__icon" aria-hidden="true">{{ hasWrapup ? '✓' : '◌' }}</span>
              <strong>{{ hasWrapup ? '总结已就绪' : '尚未生成总结' }}</strong>
              <p v-if="hasWrapup">{{ WRAPUP_READY_NOTE }}</p>
              <p v-else-if="lessonTree.length">{{ WRAPUP_FINAL_NOTE }}</p>
              <p v-else>{{ WRAPUP_NOT_STARTED_NOTE }}</p>
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
            <!-- 同一份内芯（审核 #73 去重）；阶段行恒渲染——本宿主外层已排除 real 模式，
                 原第二处 stages 上的 v-if="!isRealMode" 是恒真冗余，随抽取删除 -->
            <RunStatusPanel
              v-model:friction-budget="frictionBudget"
              v-model:sim-model="simModel"
              :autopilot-result-text="autopilotResultText"
              :autopilot-running="autopilotRunning"
              :autopilot-status="autopilot.status"
              :driver="autopilotDriver"
              :stage-done="stageDone"
              :stage-active="stageActive"
              :stage-mini-status="stageMiniStatus"
              :stage-label="stageLabel"
              :is-blackbox="isBlackbox"
              :show-path-readiness="showPathReadiness"
              :path-readiness-tone="pathReadinessTone"
              :path-readiness-text="pathReadinessText"
              :available-models="liveApiConfig?.availableModels || []"
              :friction-saving="frictionSaving"
              :sim-model-saving="simModelSaving"
              v-model:experiment-arm="experimentArm"
              v-model:extension-probe="extensionProbe"
              v-model:advisory-response="advisoryResponse"
              :flags-saving="simFlagsSaving"
              @save-friction="saveFriction"
              @save-model="saveModel"
              @save-flags="saveSimFlags"
            />
          </div>
        </div>

        <!-- 会话日志 -->
        <div class="cp-sidebar__section">
          <button type="button" class="cp-sidebar__toggle" :class="{ 'is-open': sidebarOpen.logs }" title="日志为窗口视图：面板最多保留最近 60 条（超出丢弃最旧），不是全量日志" @click="sidebarOpen.logs = !sidebarOpen.logs">
            <span class="cp-sidebar__toggle-icon">{{ sidebarOpen.logs ? '▾' : '▸' }}</span>
            <span>会话日志</span>
            <!-- 窗口口径披露（2026-10-06 审核 #71）：面板只保留最近 LOG_WINDOW 条，
                 不写会被读成全量（MkSubTabs 裸数字角标冒充总数判例的反向缺失） -->
            <span class="cp-sidebar__toggle-hint">{{ isRealMode ? '只读' : isTerminal ? '已结束' : '每 5 秒刷新' }} · 最近 {{ LOG_WINDOW }} 条</span>
          </button>
          <div v-if="sidebarOpen.logs" class="cp-sidebar__body">
            <div v-if="session && logPhases.length > 1" class="cp-logs__filter">
              <button v-for="p in logPhases" :key="p" type="button" class="cp-logs__filter-chip" :class="{ 'is-active': logPhaseFilter === p }" @click="logPhaseFilter = logPhaseFilter === p ? '' : p">{{ p }}</button>
            </div>
            <!-- 跟随钮移出滚动容器（2026-10-06 审核 #52）：原先 sticky 在其网格行内位移余量为 0、
                 上翻日志暂停跟随后按钮随内容滚出视口，恰在最需要「恢复跟随」时看不见它 -->
            <div class="cp-logs-wrap">
              <button type="button" class="cp-logs__follow" :class="{ 'is-paused': !logFollowsBottom }" :title="logFollowsBottom ? '自动跟随最新日志' : '已暂停跟随'" :aria-label="logFollowsBottom ? '已跟随最新日志' : '恢复跟随最新日志'" @click="scrollToBottom">{{ logFollowsBottom ? '⏵' : '⏸' }}</button>
              <div class="cp-logs" ref="logBox" aria-label="实时日志" @scroll="onLogScroll">
                <!-- aria-live 已从容器移除：5s 轮询整表重渲染会让读屏反复播报全部日志，视觉跟随已足够 -->
                <template v-if="!session">
                  <MkSkeleton v-for="n in 4" :key="n" :h="11" :radius="4" />
                </template>
                <template v-else>
                  <div v-for="(l, i) in filteredLogs" :key="i" class="cp-log" :class="{ 'cp-log--error': l.view.isError }">
                    <span class="cp-log__time">{{ l.time }}</span>
                    <span v-if="l.view.phase" class="cp-log__phase" :class="{ 'cp-log__phase--error': l.view.isError }">{{ l.view.phase }}</span>
                    <!-- 折叠行（2026-10-22）：对话全文在左侧页签，这里只报条数并直接跳过去 -->
                    <button
                      v-if="l.jumpTab"
                      type="button"
                      class="cp-log__jump"
                      :title="`打开「${l.jumpTab === 'goal' ? '目标对话' : '课堂'}」页签查看全文`"
                      @click="selectStageTab(l.jumpTab)"
                    >{{ l.view.text }}</button>
                    <span v-else class="cp-log__text">{{ l.view.text }}</span>
                    <span v-if="l.view.durationText" class="cp-log__dur">{{ l.view.durationText }}</span>
                    <details v-if="l.view.rawJson" class="cp-log__raw"><summary>原文</summary><pre>{{ l.view.rawJson }}</pre></details>
                  </div>
                  <p v-if="logsFailed" class="cp-degrade">日志获取失败 <button type="button" class="mk-link" @click="loadLogs">重试</button></p>
                  <p v-else-if="!filteredLogs.length" class="cp-none">{{ logPhaseFilter ? '当前筛选无匹配日志' : '暂无日志' }}</p>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Trace 诊断 -->
        <div v-if="hasTraceFlows" class="cp-sidebar__section">
          <button type="button" class="cp-sidebar__toggle" :class="{ 'is-open': sidebarOpen.trace }" @click="sidebarOpen.trace = !sidebarOpen.trace">
            <span class="cp-sidebar__toggle-icon">{{ sidebarOpen.trace ? '▾' : '▸' }}</span>
            <span>诊断轨迹</span>
            <span class="cp-sidebar__toggle-hint">{{ refereeTraceCount + privateStateTraceCount }} 条</span>
          </button>
          <div v-if="sidebarOpen.trace" class="cp-sidebar__body">
            <!-- 统一时间线 -->
            <details v-if="!isRealMode && unifiedTimeline.length" class="cp-trace-panel" open>
              <summary>时间线 · {{ unifiedTimeline.length }} 条</summary>
              <ol class="cp-trace-list">
                <li v-for="(t, idx) in unifiedTimeline" :key="`tl-${idx}`">
                  <div class="cp-trace-list__head"><span class="cp-trace-list__seq">#{{ idx + 1 }}</span><time>{{ formatTime(t.time) }}</time><span class="cp-timeline__kind" :data-kind="t.kind">{{ t.kindLabel }}</span><span v-if="t.stage" class="cp-timeline__stage" :data-stage="String(t.stage).toLowerCase()">{{ stageLabel(t.stage) }}</span><strong class="cp-timeline__title">{{ t.title }}</strong></div>
                  <p v-if="t.detail" class="cp-timeline__detail">{{ t.detail }}</p>
                </li>
              </ol>
            </details>
            <!-- 裁判旁路诊断 -->
            <details v-if="refereeTrace.length" class="cp-trace-panel">
              <summary>{{ REFEREE_TRACE_LABEL }} {{ refereeTraceCount }} 条</summary>
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
              <summary>{{ PRIVATE_STATE_TRACE_LABEL }} {{ privateStateTraceCount }} 条</summary>
              <ol class="cp-trace-list">
                <li v-for="(item, idx) in privateStateTrace" :key="(item.sequence ?? idx)">
                  <div class="cp-trace-list__head"><span class="cp-trace-list__seq">#{{ item.sequence ?? (idx + 1) }}</span><span class="cp-trace-list__stage" :data-stage="item.stage">{{ stageLabel(item.stage) }}</span><code v-if="item.taskId">任务 {{ item.taskId.slice(0, 8) }}</code><time v-if="item.generatedAt">{{ formatTime(item.generatedAt) }}</time><span v-if="item.emotion" class="cp-trace-list__emotion">{{ item.emotion }}</span><span v-if="item.degraded" class="cp-trace-list__degraded">降级</span><span v-if="item.transition" class="cp-trace-list__transition">{{ item.transition }}</span></div>
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

    <!-- 资料全文弹层（2026-10-12 走查「只能看到简介吗」）：控制台列表载荷刻意不含正文
         （单份可达 10 万字），全文点开才取。外壳走共享 .mk-modal 原语，开合四件套
         （Esc/遮罩/焦点陷阱/滚动锁）同 PathJourneyPanel 任务弹层。 -->
    <Teleport to="body">
      <div v-if="materialView" ref="materialMaskRef" class="mk-modal">
        <div ref="materialPanelRef" class="mk-modal__panel cp-matview" role="dialog" aria-modal="true" aria-label="资料全文">
          <div class="mk-modal__head">
            <div class="cp-matview__head">
              <h2 class="mk-modal__title" :title="materialView.name">{{ materialView.name }}</h2>
              <span class="cp-matview__meta mono">{{ materialView.sizeText }}</span>
            </div>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeMaterialView">✕</button>
          </div>
          <div class="mk-modal__body">
            <p v-if="materialView.loading" class="cp-none">正在读取全文…</p>
            <p v-else-if="materialView.error" class="cp-degrade">
              {{ materialView.error }}
              <button type="button" class="mk-link" @click="retryMaterialView">重试</button>
            </p>
            <template v-else>
              <pre class="cp-matview__text">{{ materialView.markdown }}</pre>
              <p v-if="materialView.truncated" class="cp-matview__trunc">{{ MATERIAL_TRUNC_NOTE }}</p>
            </template>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="closeMaterialView">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 原始会话数据弹层（2026-10-18）：排查用整包载荷，开合四件套同资料全文弹层 -->
    <Teleport to="body">
      <div v-if="rawOpen" ref="rawMaskRef" class="mk-modal">
        <div ref="rawPanelRef" class="mk-modal__panel mk-modal__panel--wide cp-rawview" role="dialog" aria-modal="true" aria-label="原始会话数据">
          <div class="mk-modal__head">
            <div class="cp-rawview__head">
              <h2 class="mk-modal__title">原始会话数据</h2>
              <span class="cp-rawview__meta mono">{{ rawJsonLength.toLocaleString('zh-CN') }} 字符</span>
            </div>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeRaw">✕</button>
          </div>
          <div class="mk-modal__body">
            <p class="cp-rawview__note">接口返回的完整会话数据</p>
            <pre class="cp-rawview__pre">{{ rawJsonFull }}</pre>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="closeRaw">关闭</button>
            <button type="button" class="mk-btn mk-btn--primary" @click="copyRawJson">复制完整 JSON</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { subPage, closeSubPage, openSession, openSubPage, setSubPageLabel, asSubPageStage } from './store'
import { errMsg, liveApiConfig, liveRefreshSeq } from './live'
import { askConfirm } from './useConfirm'
import { useMaskClose, useOverlay } from './useOverlay'
import { useEscape } from './useEscape'
import {
  VS_CONTROL_DEFS,
  deriveVsLifecycleState,
  vlabControlsFor,
  type VsControlDef,
  type VsControlKey,
  type VsLifecycleState
} from './vlab-controls'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { renderAiMessageHtml } from '@/utils/sanitize'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { runHealthTone, statusText, sessionModeText, sessionModeBadgeCls, sessionModeTitle } from './statusText'
import { parseLogEntry, virtualLogPhaseZh } from './sessionLog'
// 评分助手（evalScore）原供终局评估面板使用；面板已随裁判独立面移除（2026-09-27），本组件不再引用
import { useSafePolling } from '@/composables/useSafePolling'
import {
  asRecord, normalized, firstText, boolValue, numberValue,
  conversationMessages, formatTime, stageLabel, wrapupCardIcon
} from './cockpitFormat'
import { useCockpitTraces, timelineKindLabel } from './cockpitTraces'
import { useCockpitLogs, LOG_WINDOW } from './useCockpitLogs'
import { buildLessonWrapup, useCockpitWrapup } from './cockpitWrapup'
import {
  collectPathMilestones, buildPathMilestonesView,
  buildPathDetailTitle, buildPathDetailMeta,
  pathReviewDecisionLabelOf, pathReviewStatusLabelOf
} from './cockpitPathViews'
import {
  buildLearnLessons, buildLessonTree, lessonMark, lessonStateLabel, lessonNumberOf,
  countDoneLessons, type LearnLesson
} from './cockpitLessons'
import { useCockpitStages, stageFlow, type StageKey } from './cockpitStages'
import RunStatusPanel from './session-cockpit/RunStatusPanel.vue'
import PathJourneyPanel from './PathJourneyPanel.vue'
import { useCockpitAutopilot, autopilotDriverLine } from './cockpitAutopilot'

/* ---------- 文案单源（R6 同文件复读治理）：同一句用户可见文案只在此定义一次，模板/脚本就地引用 ---------- */
const WRAPUP_READY_NOTE = ''
const WRAPUP_FINAL_NOTE = '全部课程完成后，可在控制台生成终局总结（学习目标、评估、知识掌握）。'
const WRAPUP_NOT_STARTED_NOTE = '尚未开始学习，生成路径并启动教学后这里会展示进度。'
const REFEREE_TRACE_LABEL = '裁判诊断 ·'
const PRIVATE_STATE_TRACE_LABEL = '角色内部状态 ·'
const MATERIAL_TRUNC_NOTE = '全文超长，仅展示前 20 万字。完整正文仍在服务端存档。'
const CLASSROOM_EMPTY_TEXT = '该课堂暂未记录可展示消息。'
const PATH_NOT_READY_TITLE = '路径尚未准备好启动教学'
const BLACKBOX_CONTROL_BLOCK = '黑盒模式不提供手动操作'
/** 终态下「推进」类动作的禁用原因（单步 / 自动两处共用，同文件复读由 R6 治理） */
const TERMINAL_STEP_BLOCK = '课堂已结束，不能继续推进'
const FRICTION_LABEL: Record<string, string> = { none: '无', low: '低', normal: '正常', high: '高', stress_test: '压力测试' }

const sessionId = computed(() => subPage.value?.id || '')
const shortId = computed(() => (sessionId.value.length > 20 ? `…${sessionId.value.slice(-16)}` : sessionId.value))

/* 双模式：session=虚拟会话控制台（原行为 100% 保留）；session-real=真实教学/目标会话只读控制台 */
const isRealMode = computed(() => subPage.value?.view === 'session-real')
/** 会话所属画像 id（从会话 API 的 virtual_learner_profiles 取；无 from 时用于回二级画像） */
const sessionProfileId = computed(() => {
  const p = (session.value?.virtual_learner_profiles || {}) as Record<string, unknown>
  return String(p.id || '')
})
/** 来源页（subPage.from）→ 返回钮文案：按真实返回目标命名，不再一律「画像」
    （2026-10-06 审核 #69：from.view 可为 virtual/learner/user，座舱此前忽略 view 恒显「画像」）
    无 from 的真实控制台（2026-10-12 起路径也从列表进座舱）：按当前场景命名返回目标——
    学习路径列表进来显「← 路径列表」、目标对话进来显「← 目标对话」，不再一律「会话列表」。 */
const FROM_BACK_LABEL: Record<string, string> = { virtual: '画像', learner: '学习者', user: '用户' }
const SCENE_BACK_LABEL: Record<string, string> = {
  'learning-paths': '路径列表',
  'goal-conversations': '目标对话',
  'teaching-sessions': '教学会话列表'
}
const route = useRoute()
const backLabel = computed(() => {
  const from = subPage.value?.from
  if (from) return FROM_BACK_LABEL[from.view] || from.label || '返回'
  if (sessionProfileId.value) return '画像' // 从一级进三级 → 也回该会话所属画像
  if (isRealMode.value) {
    const page = typeof route?.params?.page === 'string' ? route.params.page : ''
    return SCENE_BACK_LABEL[page] || '教学会话列表'
  }
  return '虚拟学习者'
})
/** 返回钮 tooltip：backLabel 兜底成「返回」时不能再拼一遍（否则「返回返回」） */
const backTip = computed(() => (backLabel.value === '返回' ? '返回上一页' : `返回${backLabel.value}`))
/** 返回：有来源 → 回来源页；否则回该会话所属画像（二级）；都没有 → 回一级 */
function goBack() {
  const from = subPage.value?.from
  if (from) {
    closeSubPage()
    return
  }
  const pid = sessionProfileId.value
  if (pid) {
    // from 记座舱自身（view/id/label）：画像页的返回键才能回到本座舱，否则断环掉回一级列表
    const cur = subPage.value
    openSubPage('virtual', pid, cur ? { from: { view: cur.view, id: cur.id, label: cur.label } } : undefined)
    return
  }
  closeSubPage()
}
const realKind = ref<'teaching' | 'goal'>('teaching')
/* 真实模式时间线（后端合成）与虚拟模式日志原文（统一时间线三流合并用） */
const timelineEntries = ref<Array<{ time: string; kind: string; title: string; detail: string; raw?: string }>>([])
const rawLogs = ref<Record<string, unknown>[]>([])

const session = ref<Record<string, unknown> | null>(null)
/** 首次加载失败标记：refresh 失败原本只 toast，session 恒 null 时页面会永远「加载中…」 */
const sessionLoadFailed = ref(false)
const {
  logsFailed, logBox, logFollowsBottom, logPhaseFilter,
  logPhases, filteredLogs, onLogScroll, scrollToBottom, appendLogs, resetLogs
} = useCockpitLogs()

const pathStatus = ref<Record<string, unknown> | null>(null)
const pathStatusFailed = ref(false)
const teachingDetail = ref<Record<string, unknown> | null>(null)
/* 真实单课载荷缓存（键 = 课堂会话 id；随本座舱实例存亡）：课程树来回切换不重复打接口 */
const realLessonCache = new Map<string, Record<string, unknown>>()
const teachingDetailFailed = ref(false)
const teachingDetailLoading = ref(false)
/** 当前查看课时的 wrapup 总结数据 */
const lessonWrapup = computed(() => buildLessonWrapup(teachingDetail.value))

/** 单课 wrapup 的 LSS/KTL 读数：后端为 0–10 分制（learning-state.service / PredictionCalibrationService，
    与 CompletionCard 的 toFixed(1) 同口径）。D6：原实现 ×100 当 0–1 比率，实测渲染成「600%」。 */
function scoreText(v: number | null): string {
  return v == null ? '—' : Number(v).toFixed(1)
}

/** P1#7 课时健康读数：真实模式且有总结时上提首屏（理解/参与/LSS/KTL/困惑点）。
    口径=当前查看课时单课读数（前端唯一可得），会话级聚合需后端，title 如实说明。 */
const healthStrip = computed(() => {
  const w = lessonWrapup.value
  if (!isRealMode.value || !w) return null
  const parts: string[] = []
  if (w.avgUnderstanding != null) parts.push(`理解 ${Math.round(w.avgUnderstanding * 100)}%`)
  if (w.avgEngagement != null) parts.push(`参与 ${Math.round(w.avgEngagement * 100)}%`)
  if (w.lss != null) parts.push(`LSS ${scoreText(w.lss)}`)
  if (w.ktl != null) parts.push(`KTL ${scoreText(w.ktl)}`)
  if (w.confusionPoints?.length) parts.push(`困惑点 ${w.confusionPoints.length}`)
  if (!parts.length) return null
  return { text: parts.join(' · '), degraded: !!w.degraded }
})
const healthStripTitle = computed(() => {
  const w = lessonWrapup.value
  return `当前课时的总结读数（单课，非全会话汇总）${w?.degraded ? '。本课为降级总结（未完整结束）' : ''}`
})
const hasLessonWrapup = computed(() => !!lessonWrapup.value && (!!lessonWrapup.value.topicSummary || !!lessonWrapup.value.knowledgeSummary))
const selectedTeachingSessionId = ref('')

const busy = ref(false)

const stageResults = computed(() => (session.value?.stageResults || {}) as Record<string, unknown>)
const runtime = computed(() => (session.value?.runtime || {}) as Record<string, unknown>)
const stageStatus = computed(() => (runtime.value.stageStatus || {}) as Record<string, Record<string, unknown>>)
const {
  refereeTrace, refereeTraceCount,
  privateStateTrace, privateStateTraceCount, parseBlackbox, refereeTraceViews,
  hasTraceFlows, unifiedTimeline, resetTraces
} = useCockpitTraces(stageResults, isRealMode, rawLogs)

/* ---- 预算消耗（三级页顶栏预警条）：runtimeStats.aiCalls / 后端解析的成本上限 ---- */
const budgetUsage = computed(() => {
  const rs = (stageResults.value.runtimeStats || {}) as Record<string, unknown>
  const used = Number(rs.aiCalls) || 0
  // 唯一事实来源：后端下发的 budget（故事级 > 画像级 > 不限）。前端不再自行猜测默认值。
  const serverBudget = (session.value?.budget || {}) as Record<string, unknown>
  const costCeiling = serverBudget.costCeiling
  if (serverBudget.unlimited === true || costCeiling === null || costCeiling === undefined) {
    return { used, limit: null, unlimited: true }
  }
  const limit = Number(costCeiling)
  if (!Number.isFinite(limit) || limit <= 0) {
    return { used, limit: null, unlimited: true }
  }
  return { used, limit: Math.max(1, limit), unlimited: false }
})
const budgetPct = computed(() => {
  if (budgetUsage.value.unlimited || !budgetUsage.value.limit) return 0
  return Math.min(100, Math.round((budgetUsage.value.used / budgetUsage.value.limit) * 100))
})
const budgetTone = computed(() => {
  if (budgetUsage.value.unlimited) return 'ok'
  const pct = budgetPct.value
  if (pct >= 90) return 'full'
  if (pct >= 70) return 'warn'
  return 'ok'
})

const isBlackbox = computed(() => !!(stageResults.value.blackbox || stageResults.value.experiment))
const blackboxTraceCount = computed(() => {
  const bb = (stageResults.value.blackbox || {}) as Record<string, unknown>
  const trace = bb.publicTrace
  return Array.isArray(trace) ? trace.length : 0
})
/** 模式声明单源（2026-10-04 全站评审 P3#13）：真实会话 chip 吸收控制台「只读监控」条的语义，
    同屏只此一处；黑盒/辅助口径不变（黑盒控制台内另有专项声明条） */
const modeText = computed(() => (isRealMode.value
  ? (realKind.value === 'goal' ? '真实目标对话 · 只读监控' : '真实课堂 · 只读监控')
  : isBlackbox.value ? '黑盒模式' : '辅助模式'))
/** 终态全集（#135）：与教学会话列表页同口径——timeout/finalization_failed/discarded/superseded
 *  也是终态，不能再按「进行中」轮询/给操作按钮。 */
const TERMINAL_STATUSES = ['completed', 'failed', 'abandoned', 'timeout', 'finalization_failed', 'discarded', 'superseded']
/** 中断类终态：阶段条当前阶段不能算完成（#135）；completed 不在此列 */
const INTERRUPTED_TERMINAL_STATUSES = ['failed', 'abandoned', 'timeout', 'finalization_failed', 'discarded', 'superseded']
const isTerminal = computed(() => {
  const st = normalized(session.value?.status || runtime.value.status)
  return TERMINAL_STATUSES.includes(st)
})
const terminalStatus = computed(() => normalized(session.value?.status || runtime.value.status))
const isFailedTerminal = computed(() => ['failed', 'abandoned'].includes(terminalStatus.value))
const isInterruptedTerminal = computed(() => INTERRUPTED_TERMINAL_STATUSES.includes(terminalStatus.value))
const blackboxRerunTitle = computed(() => isTerminal.value
  ? '按原输入重跑本实验：生成一个新会话，运行配置保持不变'
  : '实验结束后（完成、失败或已终止）才能按原输入重跑')
/* 手动停止（emergencyStop）后后端写 status=failed + stageResults.teaching.manualStop */
const manualStopped = computed(() =>
  learningResult.value.manualStop === true
  || stageStatus.value.learning?.manualStop === true
)
/* F27：授课超时标记在 stageResults.learning.taskRuntime（teaching-session-ops 把 teaching 态
   整包搬进 learning 分支再落 failed；teaching 分支仍是 active 态，不能读那边） */
const teachingTimedOut = computed(() =>
  normalized(asRecord(asRecord(stageResults.value.learning).taskRuntime).status) === 'timeout')
/* 暂停标志：pause API 设 stageResults.teaching.paused = true（与 VirtualProfile 的读取位置一致） */
const isPaused = computed(() =>
  learningResult.value.paused === true
  || stageStatus.value.learning?.paused === true
)

const statusTitle = computed(() =>
  !session.value
    ? '加载中…'
    : terminalStatus.value === 'created'
      ? '课堂未开始'
      : isFailedTerminal.value
        ? manualStopped.value ? '已手动停止' : teachingTimedOut.value ? '课堂失败 · 授课超时' : '课堂失败'
        : isInterruptedTerminal.value
          ? '课堂中断'
          : isTerminal.value
            ? '课堂已完成'
            : isPaused.value
              ? '已暂停 · 自动推进已冻结（可继续或终止）'
              : '课堂进行中'
)

/* 双轴状态（与一/二级页同源）：生命周期合成态 + 阶段条输入。
   派生本体在 vlab-controls（单一实现，画像页与这里共用同一套优先级）；本计算只把字段喂进去。 */
const runLifecycleState = computed(() =>
  deriveVsLifecycleState({
    status: normalized(session.value?.status),
    teachingPaused: isPaused.value,
    manualStopped: manualStopped.value,
    autopilotStatus: autopilot.value.status
  })
)
/* 阶段条输入（runStageForBar/runStageTaskProgress 已随 RunStageBar 移除；阶段展示收敛进「阶段推进」stepper） */

/**
 * 状态点健康档（R2，与 RunStateBadge 同源：runHealthTone → runStateTone）。
 * 页头：会话未加载 → muted（「暂无数据」），不猜成「需关注」。
 */
const headerHealth = computed(() => runHealthTone(session.value ? runLifecycleState.value : null))

/**
 * 「运行状态」卡状态点：自动驾驶终态优先，无自动驾驶状态时回到会话生命周期。
 * 失败 / 未完成（疑似卡死）/ 收尾失败 必须落到 bad —— 与同一张卡里
 * .cp-run__autopilot-result--bad 的判定保持一致，不再显示灰点。
 */
const {
  autopilot, autopilotRunning, autopilotStopping, autopilotQueued,
  autopilotStartDisabled, autopilotStartTitle, autopilotResultText, autopilotHealth
} = useCockpitAutopilot(stageResults, session, busy, isTerminal, isPaused, runLifecycleState)

/** 驱动器行（2026-10-19 运营走查）：排队位置与心跳年龄——「在跑」与「在跑但不动」的唯一区分证据。
    心跳年龄要读秒，所以随轮询节拍走一个时钟：refresh 成功时打点；终态不再轮询即不再打点，
    而此时驱动器行本身也不再渲染。 */
const clockTick = ref(Date.now())
const autopilotDriver = computed(() => autopilotDriverLine(autopilot.value, clockTick.value))

/* 阶段分页：阶段条即 tab，默认跟随 currentStage；控制面板与日志常驻 */
const activeTab = ref<StageKey>('goal')

/* ===== 会话所属学习者（2026-10-18 用户走查「三处都没有跳学习者详情的按钮」） =====
   真实会话载荷的 learner 块由后端从会话行 users 关系投影（缺用户为 null，不拿会话 id 冒充）。
   页头因此能回答「这是谁的会话」，并给出唯一入口「查看学习者」；返回时靠 subPage.from
   回到本座舱的同一页签（from 带 stage，2026-10-18 起）。 */
const learner = computed(() => {
  const l = (session.value as { learner?: { id?: unknown; name?: unknown; email?: unknown } } | null)?.learner
  const id = String(l?.id || '')
  if (!id) return null
  return { id, name: String(l?.name || ''), email: String(l?.email || '') }
})
const learnerText = computed(() => {
  const l = learner.value
  if (!l) return ''
  return l.name || `…${l.id.slice(-8)}`
})
function learnerTitle(prefix: string): string {
  const l = learner.value
  if (!l) return prefix
  const sub = [l.name || l.id, l.email].filter(Boolean).join(' · ')
  return `${prefix}：${sub}`
}
function openLearnerDetail() {
  const l = learner.value
  if (!l) return
  const stage = asSubPageStage(activeTab.value)
  openSubPage('learner', l.id, {
    from: {
      view: isRealMode.value ? 'session-real' : 'session',
      id: sessionId.value,
      label: '会话监控',
      ...(stage ? { stage } : {})
    }
  })
}

/** 执行日志（按 sessionId 归组）：真实会话在列表里只有只读座舱，异常排查面放在座舱里 */
function goExecLogs() {
  if (sessionId.value) openSession(sessionId.value)
}

/** 真实会话的教学建议（advisory）：接口字段为松类型，仅取有效档位渲染。
 *  既有数据是结构化对象（ui.title / ui.body），旧注释假设的扁平 title/text 从未在生产里出现过，
 *  结果建议条与「学员处置」徽章对真实会话恒不可达。两种形态都吃。 */
const realAdvisory = computed(() => {
  /* 真实控制台首屏不预载课时详情（teachingDetail 为空），建议在会话载荷的 teaching 下；
     单课详情打开后再优先用该课自己的建议。 */
  const raw = teachingDetail.value?.advisory
    ?? asRecord(session.value?.teaching).advisory
    ?? (session.value as Record<string, unknown> | null)?.advisory
  let a: Record<string, unknown> = {}
  if (typeof raw === 'string') { try { a = asRecord(JSON.parse(raw)) } catch { a = {} } } else a = asRecord(raw)
  const ui = asRecord(a.ui)
  const priority = String(a.priority || '')
  const title = String(a.title || ui.title || '')
  const text = String(a.text || ui.body || '')
  if (!priority || priority === 'none') return null
  if (!title && !text) return null
  return { priority, ...(title ? { title } : {}), ...(text ? { text } : {}) }
})
/** 课堂类型（2026-10-21）：优先当前查看的课时，其次会话当前绑定课时，最后 VL 编排态。
    复习课/延伸课不结算任务，类型与「为什么完成来源为空」必须在座舱首屏说清。 */
const classroomMode = computed(() => {
  const fromDetail = teachingDetail.value?.mode
  if (typeof fromDetail === 'string' && fromDetail) return fromDetail
  const teaching = asRecord(session.value?.teaching)
  if (typeof teaching.mode === 'string' && teaching.mode) return teaching.mode
  const t = asRecord(stageResults.value.teaching)
  return typeof t.classroomMode === 'string' ? t.classroomMode : null
})
const classroomModeText = computed(() => sessionModeText(classroomMode.value))
const classroomModeBadge = computed(() => sessionModeBadgeCls(classroomMode.value))
const classroomModeTitle = computed(() => sessionModeTitle(classroomMode.value))

/** 建议处置（v0 只留痕）：advisory.learnerResponse = 学员对建议的「保留/稍后再看/预览」 */
const learnerAdvisoryResponse = computed(() => {
  const raw = teachingDetail.value?.advisory
    ?? asRecord(session.value?.teaching).advisory
    ?? session.value?.advisory
  let obj: Record<string, unknown> = {}
  if (typeof raw === 'string') { try { obj = asRecord(JSON.parse(raw)) } catch { obj = {} } } else obj = asRecord(raw)
  const r = asRecord(obj.learnerResponse)
  const action = String(r.action || '')
  if (!action) return null
  const label: Record<string, string> = { keep: '保留原路径', later: '稍后再看', preview: '预览过调整' }
  return { action, label: label[action] || action, at: String(r.at || '') }
})

/** 延伸学观测（#124）：只观测不进重排——延伸段学到的内容与负荷在此如实呈现 */
const extensionObservability = computed(() => {
  const candidates = [teachingDetail.value?.wrapup, asRecord(session.value?.teaching).wrapup]
  for (const raw of candidates) {
    if (!raw) continue
    let obj: Record<string, unknown> = {}
    if (typeof raw === 'string') { try { obj = asRecord(JSON.parse(raw)) } catch { obj = {} } } else obj = asRecord(raw)
    const obs = asRecord(obj.extensionObservability)
    if (!obs.kind) continue
    return {
      turnCount: Number(obs.turnCount || 0),
      sessionLss: typeof obs.sessionLss === 'number' ? obs.sessionLss : null,
      sessionLf: typeof obs.sessionLf === 'number' ? obs.sessionLf : null,
      learnedConcepts: Array.isArray(obs.learnedConcepts) ? obs.learnedConcepts.map(String) : [],
    }
  }
  return null
})

/** 延伸进行中（assisted 轨）：extensionRuntime 只活在编排态，收束后才有 extensionObservability */
const extensionRuntime = computed(() => {
  const r = asRecord(asRecord(stageResults.value.teaching).extensionRuntime)
  if (r.active !== true) return null
  return { turns: Number(r.turns || 0), maxTurns: Number(r.maxTurns || 0) }
})

/** 卡死归因（append-only）：最近一次非收敛判定的证据，供运营回看而不是只留日志 */
const STUCK_REASON_ZH: Record<string, string> = {
  'non-convergence': '多轮判定未通过',
}
function stuckReasonText(raw: string): string {
  const r = String(raw || '')
  return STUCK_REASON_ZH[r] || r
}
const stuckAttribution = computed(() => {
  const list = stageResults.value.stuckAttributions
  if (!Array.isArray(list) || list.length === 0) return null
  const last = asRecord(list[list.length - 1])
  return {
    count: list.length,
    at: String(last.at || ''),
    reason: stuckReasonText(String(last.reason || last.attribution || last.verdict || '')),
    /* 归因记录字段是 turns（回合数）；早期视图误读 turn，真实数据会恒显 0。 */
    turn: Number(last.turns ?? last.turn ?? 0),
  }
})
const sidebarOpen = reactive({ run: true, logs: true, review: false, trace: false })
function selectStageTab(st: StageKey) {
  if (isBlackbox.value) return
  activeTab.value = st
}

/** stepper 键盘契约（2026-10-06 审核 #74）：role=tablist/tab 需 ←/→（+Home/End）切换
    与 roving tabindex（未选中项 tabindex=-1 已由模板承担），键盘用户不必 Tab 走过四页签。
    焦点随后移到新选中页签（tab 元素本身）。 */
function onStepKeydown(e: KeyboardEvent) {
  if (isBlackbox.value) return
  const idx = stageFlow.indexOf(activeTab.value)
  if (idx < 0) return
  let next = -1
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % stageFlow.length
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + stageFlow.length) % stageFlow.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = stageFlow.length - 1
  if (next < 0) return
  e.preventDefault()
  const target = stageFlow[next]
  selectStageTab(target)
  void nextTick(() => document.getElementById(`cp-tab-${target}`)?.focus())
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
  if (!Array.isArray(history)) return [] as Array<{ id: string; taskId: string; taskTitle: string; status: string }>
  const seen = new Set<string>()
  return history.map(asRecord).map((item) => ({
    id: firstText(item.teachingSessionId),
    taskId: firstText(item.taskId),
    taskTitle: firstText(item.taskTitle),
    // 终态随行（completed/discarded/...）：同课多会话时 buildLearnLessons 挑有总结的那条
    status: normalized(item.status)
  })).filter((item) => item.id && !seen.has(item.id) && !!seen.add(item.id))
})
const teachingDetailMessages = computed(() => conversationMessages(teachingDetail.value?.messages))
const learnConversationMessages = computed(() =>
  teachingDetailMessages.value.length ? teachingDetailMessages.value : fallbackLearnConversationMessages.value
)
/** 检查点记录（题目/判分/理解度）。检查点是结构化通道，题目不进聊天逐字稿——
 *  真实模式经 /admin/session-console 的 teaching.checkpoints，虚拟模式在 state.checkpointHistory。 */
interface CockpitCheckpoint {
  checkpointId?: string | null
  title?: string | null
  type?: string | null
  question?: string | null
  passed?: boolean | null
  judgedBy?: string | null
  understanding?: number | null
  conceptName?: string | null
  submittedAt?: string | null
}
const lessonCheckpoints = computed<CockpitCheckpoint[]>(() => {
  // 真实模式：session（/admin/session-console）随首帧加载、始终可用 → 优先；
  // 虚拟模式：teaching-detail 的 state.checkpointHistory 兜底。
  const fromSession = asRecord(asRecord(session.value).teaching).checkpoints
  if (Array.isArray(fromSession)) return fromSession as CockpitCheckpoint[]
  const direct = teachingDetail.value?.checkpoints
  if (Array.isArray(direct)) return direct as CockpitCheckpoint[]
  const hist = asRecord(teachingDetail.value?.state).checkpointHistory
  return Array.isArray(hist) ? (hist as CockpitCheckpoint[]) : []
})
/** 检查点按 checkpointId 归并（2026-10-22 用户「检查点又在下面了」）：
 *  答错重答会在 checkpointHistory 追加同 id 的新行（后端据此算重答次数），
 *  逐行渲染会让同一道题看起来出现了两次。保留最新一次裁决 + 尝试次数。 */
const checkpointGroups = computed<Array<{ cp: CockpitCheckpoint; attempts: number }>>(() => {
  const map = new Map<string, { cp: CockpitCheckpoint; attempts: number }>()
  for (const cp of lessonCheckpoints.value) {
    const key = cp.checkpointId || `${cp.title || ''}|${cp.question || ''}|${cp.type || ''}`
    const hit = map.get(key)
    if (hit) {
      hit.cp = cp
      hit.attempts += 1
    } else {
      map.set(key, { cp, attempts: 1 })
    }
  }
  return [...map.values()]
})
const CHECKPOINT_TYPE_LABEL: Record<string, string> = {
  short_answer: '简答', single_choice: '单选', multiple_choice: '多选', choice: '选择', true_false: '判断'
}
function checkpointTypeLabel(t: string | null | undefined) {
  return (t && CHECKPOINT_TYPE_LABEL[t]) || t || '检查点'
}
const displayedTeachingSessionId = computed(() => firstText(
  teachingDetail.value?.id,
  selectedTeachingSessionId.value,
  bindings.value.teachingSessionId
))
/* Path : Learn = 1 : N。课程列表以 Path 任务树为数据源，
   每节课的课堂 id 从 teachingSessionHistory / 当前绑定推导，点击切换 transcript。 */
const learnLessons = computed<LearnLesson[]>(() => buildLearnLessons(pathMilestonesView.value, teachingSessionHistory.value, {
  currentTaskId: firstText(bindings.value.currentTaskId, learningResult.value.currentTaskId),
  currentTeachingId: firstText(bindings.value.teachingSessionId),
  runtimeStatus: normalized(learningTaskRuntime.value.status)
}))
const lessonTree = computed(() => buildLessonTree(pathMilestonesView.value, learnLessons.value))
function lessonNumber(taskId: string) {
  return lessonNumberOf(learnLessons.value, taskId)
}

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
/** 真实会话行是只读的：可看（已完成的课能翻对话），但「从该课开始学习」是虚拟会话专属能力
    （后端 /virtual-learners/sessions/:id/start-learning 只认 virtual_sessions）—— 实测点未开始的课
    确认后必然「启动失败：模拟会话不存在」。按仓库既有先例（学习总结页对真实会话即渲染只读行、
    不给假入口）收口，不提供这个动作。 */
function isLessonReadonly(l: LearnLesson): boolean {
  return isRealMode.value && !l.teachingSessionId
}
function lessonActionTitle(l: LearnLesson): string {
  if (l.teachingSessionId) return '查看课堂对话'
  if (l.state === 'done') return isRealMode.value ? '该课时未关联可查看的课堂会话' : '已完成'
  if (isRealMode.value) return '真实会话不可从后台启动学习。仅在虚拟学习者会话下可从该课开始'
  return '尚未开始（跳过当前卡住的课）'
}
async function onLessonClick(l: LearnLesson) {
  if (l.teachingSessionId) {
    openLesson(l)
    return
  }
  if (isRealMode.value) return
  const id = sessionId.value
  if (!id || busy.value) return
  const ok = await askConfirm({
    title: '从该课开始学习',
    message: `将从「第 ${lessonNumber(l.taskId)} 课 · ${l.title}」开始学习（跳过当前卡住的课）。\n已完成课程进度保留，未开始课程不会受影响。确认？`,
    confirmText: '开始学习',
    danger: false
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
    return CLASSROOM_EMPTY_TEXT
  }
  if (teachingDetailFailed.value) return '教学记录获取失败，请重试。'
  if (teachingSessionHistory.value.length) return CLASSROOM_EMPTY_TEXT
  if (!hasPath.value) return '尚未启动教学。'
  if (learningBlockedReason.value) return `尚未启动教学：${learningBlockedReason.value}`
  return '尚未启动教学。'
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
const pathMilestones = computed(() => collectPathMilestones(pathStatusPath.value, pathStatus.value, stageResults.value.path))

/* Path 内容展示：标题/元信息/里程碑/任务（读 path-status 的完整结构；真实模式读 stageResults.path）。
   2026-10-12 拍板：路径不再有独立详情页，Path 页签即路径内容本体（PathJourneyPanel 自取
   getPathDetail 全量行）；本处只保留页签 meta（难度/预计/里程碑数）与 wrapup 卡引用的标题。 */
const pathDetailTitle = computed(() => buildPathDetailTitle(pathStatusPath.value, stageResults.value.path))
const pathDetailMeta = computed(() => buildPathDetailMeta(hasPath.value, pathStatusPath.value, stageResults.value.path, pathMilestones.value.length))
const pathMilestonesView = computed(() => buildPathMilestonesView(pathMilestones.value, firstText(bindings.value.currentTaskId)))
/* 面包屑名（2026-10-12）：路径统一在座舱打开后，控制台的 subPage 不再有详情页替它回写
   可读名，深链/列表进来面包屑会露裸会话 id。本处只在 pathStatus/stageResults 带真标题时
   回写（『学习路径』是 buildPathDetailTitle 的无数据兜底，泛型名与场景名撞车，不写——
   真标题由 PathJourneyPanel 的详情接口补写）。只在本座舱仍是当前二级页且尚无名时写。 */
watch(pathDetailTitle, (title) => {
  const sp = subPage.value
  if (title && title !== '学习路径' && sp && sp.id === sessionId.value && !sp.label) setSubPageLabel(title)
}, { immediate: true })

/* Path 评审展示：stageResults.path_review */
const pathReviewStatus = computed(() => normalized(pathReview.value.status))
const pathReviewDecision = computed(() => normalized(pathReview.value.decision) || 'pending')
const pathReviewDecisionLabel = computed(() => pathReviewDecisionLabelOf(pathReviewDecision.value))
const pathReviewStatusLabel = computed(() => pathReviewStatusLabelOf(pathReviewStatus.value))
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
  if (pathReviewStatus.value === 'replanning') return '正在根据评审意见重新规划路径…'
  if (pathReviewStatus.value === 'replanned') return '已根据评审意见生成新版路径，请再次评审。'
  return ''
})
/* Path 空态同样只反映状态，不写跨阶段操作引导；真实模式明示数据边界 */
const pathEmptyHint = computed(() => {
  if (isRealMode.value) return '该真实会话尚未生成路径（无关联学习路径）。'
  return goalConverged.value ? '尚无路径。' : '尚无路径：目标未确认。'
})

/** 后端原始阶段（teaching/goal/path/summary）：生命周期控件按它收窄能力，
 *  不能用下面归一后的 currentStage（那里 teaching→learning） */

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
/* 已完成课数：真实控制台载荷顶层无 completedTasks，计数由 path.completedTasks 提供
   （session-console.ts resolvePathView 返回）；虚拟会话回落 path-status / stageResults.path。
   D5：原先只读 session.completedTasks → 真实会话结构性恒 0（与同卡 done 课时行自相矛盾）。 */
const completedTaskCount = computed(() => {
  const direct = numberValue(session.value?.completedTasks)
  if (direct !== null) return direct
  const payloadPath = asRecord(session.value?.path)
  const fromPayload = numberValue(payloadPath.completedTasks)
  if (fromPayload !== null) return fromPayload
  const fromStatus = numberValue(pathStatusPath.value.completedTasks)
  if (fromStatus !== null) return fromStatus
  const fromStage = numberValue(asRecord(stageResults.value.path).completedTasks)
  return fromStage ?? 0
})
const hasCompletedTask = computed(() =>
  completedTaskCount.value > 0 || normalized(learningTaskRuntime.value.status) === 'completed'
)
/* F27 超时读数（2026-10-15）：授课超时把整条会话终局化为 failed，但徽章与 completedTasks
   都说不清「本课发生过什么」——0/14 会被读成「什么都没学」。三个读数全是现成字段、不新增后端：
   节数 = 行上 completedTasks/totalTasks（超时不改写它们，与路径实际已完成子任务逐条一致）；
   本任务回合 = stageResults.learning.taskRuntime.turns（teaching.taskRuntime 会被逐课推进
   removeStageResults:['teaching'] 重置，单用它约 1/7 读出假 0）。 */
const timeoutReadout = computed(() => {
  if (!teachingTimedOut.value) return null
  const parts = ['本课未完整结束']
  const turns = numberValue(asRecord(asRecord(stageResults.value.learning).taskRuntime).turns)
  if (turns !== null && turns > 0) parts.push(`本任务已上 ${turns} 回合`)
  const total = numberValue(session.value?.totalTasks)
  parts.push(total !== null ? `已完成 ${completedTaskCount.value} / ${total} 节` : `已完成 ${completedTaskCount.value} 节`)
  parts.push('已完成课程与路径进度保留；「重试」将重开本课，本课课堂记录不迁移')
  return parts.join(' · ')
})
/* 课数读数单源（F2-1）：stepper「课程 x/y」/ Learn 卡头 / 学习总结卡头与卡内课时行
   一律取 learnLessons（Path 任务树 × 教学历史）里的同一份 done 判定，
   不再让 summary 顶层 completedTasks 与它并排成为第二个口径。
   summary 的 completedTasks 保留在 hasCompletedTask/hasRunnablePathTask 里做存在性判据。 */
const doneLessonCount = computed(() => countDoneLessons(learnLessons.value))
/** 学习总结卡头：课数与卡内课时行同源（learnLessons）；课表未加载时不报 N/0 假读 */
const wrapupHeadMeta = computed(() => {
  /* 2026-10-18 用户走查「这类文案」：读数行只报课数进度。「终局总结已生成」是状态位
     不是读数，卡体正文与阶段状态已表达，并列在读数行会把课进度读成半句话。 */
  return learnLessons.value.length ? `${doneLessonCount.value}/${learnLessons.value.length} 课已完成` : ''
})
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
  if (isBlackbox.value) return BLACKBOX_CONTROL_BLOCK
  if (isFailedTerminal.value) return '会话已失败或终止，请保留现场记录'
  if (isTerminal.value) return '会话已完成'
  return ''
})
const stepDisabled = computed(() => !session.value || busy.value || isTerminal.value)
const stepTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isTerminal.value) return TERMINAL_STEP_BLOCK
  return isBlackbox.value ? '执行一条黑盒实验轨迹' : '推进一步：当前阶段前进一轮（目标阶段对话一轮，教学阶段课堂对话一轮），结果即时可见'
})
const autoDisabled = computed(() => !session.value || busy.value || isTerminal.value || isBlackbox.value)
const autoTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式仅支持单步推进'
  if (isTerminal.value) return TERMINAL_STEP_BLOCK
  return '自动推进当前阶段，直到完成或到达回合上限（目标阶段推进完自动转入路径，教学阶段跑完当前课）'
})

/* 分页内的阶段操作：除通用禁用外，还要求后端 currentStage 匹配，防止在错误阶段误推 */
function stageMismatchTitle(stage: StageKey, action: string) {
  return currentStage.value !== stage
    ? `当前阶段是「${stageLabel(currentStage.value)}」，请先进入对应分页再${action}`
    : ''
}
const goalStepDisabled = computed(() => stepDisabled.value || currentStage.value !== 'goal')
const goalStepTitle = computed(() => stageMismatchTitle('goal', '推进目标') || stepTitle.value)
const goalAutoDisabled = computed(() => autoDisabled.value || currentStage.value !== 'goal')
const goalAutoTitle = computed(() => stageMismatchTitle('goal', '自动推进目标') || autoTitle.value)
const learnStepDisabled = computed(() => stepDisabled.value || currentStage.value !== 'learning')
const learnStepTitle = computed(() => stageMismatchTitle('learning', '推进教学') || stepTitle.value)
const learnAutoDisabled = computed(() => autoDisabled.value || currentStage.value !== 'learning')
const learnAutoTitle = computed(() => stageMismatchTitle('learning', '自动推进对话直至本课完成') || autoTitle.value)
const advancePathDisabled = computed(() =>
  !!assistedControlBlockReason.value || !goalConverged.value || hasPath.value
)
const advancePathTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (!goalConverged.value) return '目标对话尚未确认，不能生成路径'
  if (hasPath.value) return '已有路径，不能重复生成'
  return '根据已确认的目标生成路径'
})
const reviewPathDisabled = computed(() =>
  !!assistedControlBlockReason.value || !pathGeneratedOrReady.value || pathReviewAccepted.value || reviewAwaitingDecision.value
)
const reviewPathTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (pathReviewAccepted.value) return '当前路径已通过评审'
  if (reviewAwaitingDecision.value) return '已有评审结论待处理：接受或按意见重规划'
  if (pathGenerationFailed.value) return '路径生成失败，请重新生成路径'
  if (pathGenerationInProgress.value) return '路径正在生成或补全课程'
  if (!pathGeneratedOrReady.value) return '请先生成并等待路径就绪'
  return '以虚拟学习者视角评审当前路径'
})

/* 评审后的两个人工动作：接受（仅 decision=accept）或按意见重规划（decision=modify/reject） */
const reviewMatchesCurrentPath = computed(() =>
  !!pathId.value && firstText(pathReview.value.reviewedPathId) === pathId.value
)
const reviewAwaitingDecision = computed(() => pathReviewStatus.value === 'pending' && reviewMatchesCurrentPath.value)
/* 评审是独立质量旁路，不得成为 Learn 闸门：
   decision=accept → 确认接受；decision=modify/reject → 仍提供「强制接受当前 Path」逃生口，
   避免评审把下一步学习堵死（也可点「按意见重规划」继续修正）。 */
const acceptPathVisible = computed(() => reviewAwaitingDecision.value)
const acceptPathDisabled = computed(() => !!assistedControlBlockReason.value)
const acceptPathTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  return pathReviewDecision.value === 'accept'
    ? '确认接受评审结论。之后仍需手动启动教学'
    : '强制接受当前路径（评审不通过也可启动教学）。之后仍需手动启动教学'
})
const replanPathVisible = computed(() =>
  reviewAwaitingDecision.value && ['modify', 'reject'].includes(pathReviewDecision.value)
)
const replanPathDisabled = computed(() => !!assistedControlBlockReason.value)
const replanPathTitle = computed(() =>
  assistedControlBlockReason.value || '根据评审意见重新生成路径方案，完成后需再次评审'
)
const startLearningDisabled = computed(() =>
  !!assistedControlBlockReason.value || !pathStartable.value || learningActive.value
)
const startLearningTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (learningActive.value) return '教学已在进行中'
  if (!pathStartable.value) return learningBlockedReason.value || PATH_NOT_READY_TITLE
  return '启动教学：从第一个可运行课程开始（评审不是前置条件，可直接启动）'
})
const wrapupDisabled = computed(() => {
  if (!session.value || busy.value || isBlackbox.value || isFailedTerminal.value) return true
  return !wrapupAvailable.value
})
const wrapupTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return BLACKBOX_CONTROL_BLOCK
  if (isFailedTerminal.value) return '会话已失败或终止，不能生成学习总结'
  if (hasWrapup.value) return '学习总结已生成'
  if (!wrapupAvailable.value && !wrapupTaskSettled.value && learningActive.value) return '课堂总结在当前课程完成后才会生成'
  if (!wrapupAvailable.value) return '请先启动教学并产生消息或学习进度'
  return '根据当前教学记录生成总结'
})
const resetPathDisabled = computed(() =>
  !!assistedControlBlockReason.value || !hasPath.value || hasLearnHistoryOrProgress.value
)
const resetPathTitle = computed(() => {
  if (hasLearnHistoryOrProgress.value) return '已有教学历史或进度，为保留历史不能重建路径'
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (!hasPath.value) return '尚无路径可重建'
  return '删除当前路径并重新生成'
})
const resetLearningBlockReason = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return BLACKBOX_CONTROL_BLOCK
  if (isTerminal.value && !isFailedTerminal.value) return '会话已结束，不能重启教学'
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
  if (!pathStartable.value && !canRestartFromFailedLearn.value) return learningBlockedReason.value || PATH_NOT_READY_TITLE
  if (!hasRunnablePathTask.value) return '路径中没有可重启的学习任务'
  return isFailedTerminal.value ? '从当前可运行任务恢复失败的教学' : '从可运行的任务重新启动教学，无需等待评审'
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
  if (pathStatusFailed.value) return '路径状态获取失败，请重试。'
  if (!hasPath.value) return goalConverged.value ? '目标已确认，等待生成路径。' : '等待目标对话确认后生成路径。'
  if (pathGenerationFailed.value) return learningBlockedReason.value || '路径生成失败，请重新生成。'
  if (pathGenerationInProgress.value) return learningBlockedReason.value || '路径正在生成或补全课程，请稍候。'
  if (pathStartable.value) return pathReviewAccepted.value
    ? '路径已就绪，可启动或重启教学。'
    : '路径已就绪，可直接启动教学，无需等待评审。'
  return learningBlockedReason.value || '路径已生成，正在确认教学启动条件。'
})

const {
  hasWrapup, wrapupSections, wrapupFieldCards,
  wrapupSourceBadge, wrapupStatusBadge, wrapupEmptyHint
} = useCockpitWrapup(stageResults, stageStatus, isRealMode)

const {
  effectiveStageIndex, stageDone, stageActive,
  stageProgress, stageMiniStatus, learnProgressText
} = useCockpitStages({
  currentStage, bindings, stageStatus, stageResults,
  isTerminal, isFailedTerminal, isInterruptedTerminal, hasWrapup,
  goalConversationMessages, pathStatusPath, pathMilestonesView, learnLessons
})

/* ===== 原型 renderSessionDetail 骨架数据：hero / 教学闭环 / 阶段推进 / 回合记录 / 知识状态更新 =====
   原则是真数据灌块：后端没有的字段（learner 名、Token、耗时、解答分、阶段回合数）宁缺勿造。 */

/* hero 副文（原型「学习者 · skill · 开始于时间」对齐真实字段，缺源的段不渲染）：
   学习者名 = 虚拟会话 profile.userName；skill = 真实会话 teaching.subject；开始于 = startTime / createdAt */
const heroSub = computed(() => {
  const segments: string[] = []
  const learnerName = firstText(String(asRecord(session.value?.profile).userName || ''))
  if (learnerName) segments.push(`学习者 ${learnerName}`)
  const subject = firstText(String(asRecord(session.value?.teaching).subject || ''))
  if (subject) segments.push(subject)
  const startedRaw = firstText(
    String(asRecord(session.value?.teaching).startTime || ''),
    String(session.value?.createdAt || '')
  )
  const started = startedRaw ? formatTime(startedRaw) : ''
  if (started) segments.push(`开始于 ${started}`)
  return segments.join(' · ')
})

/* hero 主标题 = 会话主题（2026-10-04 全站评审 P2-7：人类可读主题升 24px/700 主位，
   截断裸 ID 退位）——真实教学会话取 teaching.topic；无主题（虚拟会话/goal 会话）回退 shortId */
const heroTitle = computed(() => {
  const topic = firstText(String(asRecord(session.value?.teaching).topic || ''))
  return topic || shortId.value
})

/* 状态 pill：生命周期合成态（与原顶栏徽章同源）→ mk-badge 档位。
   真实会话载荷没有顶层 status（只有 runtime.status），为不再误报「已创建」，先取顶层 status，缺源回退 runtime。
   暂停优先（2026-10-06 审核 #48）：pause API / 自动驾驶停止后原始 status 仍是 running，
   若被顶层 status 抢先生效，hero pill 与卡 meta 会显示「进行中」，与顶栏琥珀「需关注」矛盾。 */
const heroLifecycleState = computed(() => {
  if (!session.value) return ''
  if (isPaused.value) return 'paused'
  return normalized(session.value?.status) || terminalStatus.value || runLifecycleState.value
})
const heroStatusText = computed(() => {
  if (!session.value) return '加载中'
  return statusText(heroLifecycleState.value) || statusText(runLifecycleState.value) || '—'
})
const heroStatusTone = computed(() => {
  if (!session.value) return 'muted'
  switch (heroLifecycleState.value) {
    case 'completed': return 'ok'
    case 'failed': return 'bad'
    case 'abandoned': return 'muted'
    case 'paused':
    case 'created': return 'warn'
    default: return 'info'
  }
})

/* 阶段推进 stepper 三态（done/active/idle 由真实阶段状态机推导）与 meta 文案 */
function stepState(st: StageKey): 'done' | 'active' | 'idle' {
  if (stageDone(st)) return 'done'
  if (stageActive(st)) return 'active'
  return 'idle'
}
function stepMeta(st: StageKey) {
  if (stageDone(st)) return stageProgress(st) || '已完成'
  // D8（2026-10-22 拍板 A）：终态会话的当前阶段不能继续写「进行中」——
  // 已放弃/失败的会话停在 Path 时读起来像还在跑；勾与色不变，只改副标。
  if (stageActive(st)) return isTerminal.value ? '中断' : '进行中'
  return '待进入'
}
const stageDoneCount = computed(() => stageFlow.reduce((n, st) => n + (stageDone(st as StageKey) ? 1 : 0), 0))

/** 阶段推进卡的下游直达入口（2026-10-11 走查；2026-10-12 收敛）：
 *  Path 出口已撤——Path 页签自本拍板起就是路径内容本体（阶段全展开/任务弹层/治理动作），
 *  stepper 的「Path」步点即唯一入口，再给一枚「查看学习路径」按钮是同目标双入口。
 *  只保留课堂会话出口：只在「真实 + 目标对话」给——这页的对象是 Goal 对话，课堂是另一个
 *  对象；课堂会话控制台上再给这条就是自指，虚拟会话的课堂本来就在本页。
 *  返回记忆：目标页带上本页 from，其返回钮回到这里，不会掉回一级列表。 */
const stageJumpTargets = computed<Array<{ key: string; label: string; title: string; go: () => void }>>(() => {
  const here = subPage.value
  // 目标页的返回钮按 from.label 命名（FROM_BACK_LABEL 只认 virtual/learner/user）——真实控制台不设
  // subPage.label，不兜底就会退化成「← 返回」
  const from = here ? { view: here.view, id: here.id, label: here.label || '会话监控' } : undefined
  const jumps: Array<{ key: string; label: string; title: string; go: () => void }> = []
  const linkedTeaching = firstText(
    (stageStatus.value.learning as Record<string, unknown> | undefined)?.teachingSessionId,
    bindings.value.teachingSessionId
  )
  if (isRealMode.value && realKind.value === 'goal' && linkedTeaching) {
    jumps.push({
      key: 'learn',
      label: '查看课堂会话',
      title: '打开本条路径最近一节课堂的会话监控（只读）',
      go: () => openSubPage('session-real', linkedTeaching, from ? { from } : undefined)
    })
  }
  return jumps
})

/* 回合记录行：Goal → 课堂按序合并的真实消息（conversationMessages 只留 role/content，这里连带时间一起取） */
interface TurnRow { key: string; index: number; type: string; tone: string; content: string; time: string }
const turnRows = computed<TurnRow[]>(() => {
  const rows: TurnRow[] = []
  const read = (value: unknown): Array<Record<string, unknown>> =>
    Array.isArray(value)
      ? value.map(asRecord).filter((m) => firstText(m.content, m.text, m.message))
      : []
  const push = (list: Array<Record<string, unknown>>, phase: 'goal' | 'learn') => {
    list.forEach((m, i) => {
      const role = ['assistant', 'teacher', 'ai'].includes(normalized(m.role)) ? 'assistant' : 'user'
      const time = firstText(m.time, m.timestamp, m.createdAt)
      rows.push({
        key: `${phase}-${i}`,
        index: rows.length + 1,
        type: role === 'assistant' ? (phase === 'goal' ? '平台目标' : '教师') : (isRealMode.value ? '学习者' : '虚拟学习者'),
        tone: role === 'assistant' ? 'mk-badge--info' : 'mk-badge--muted',
        content: firstText(m.content, m.text, m.message),
        time: time ? formatTime(time) : '—'
      })
    })
  }
  // 通道选择（2026-10-11 走查）：真实会话页只放**本会话**的转录 —— kind=teaching 是课堂会话，
  // 它的 Goal 段是后端按 learningPathId 反查到的「该学习者最近一次目标对话」（另一个对象，
  // 同页 Goal 页签已在展示），拼进来会让课堂页上半屏讲这节课、下半屏复述几天前的目标对话。
  // 虚拟会话一个会话就是完整旅程（Goal→Path→Learn→Wrapup），保持 Goal + 课堂按序合并。
  if (!isRealMode.value || realKind.value === 'goal') push(read(asRecord(conversations.value.goal).messages), 'goal')
  if (!isRealMode.value || realKind.value === 'teaching') push(read(asRecord(conversations.value.learning).messages), 'learn')
  return rows
})

/** 回合记录卡头：按模式给不同口径（合并规则只在虚拟会话成立，不能当本会话构成的说明）。
    2026-10-18 用户走查「这类文案」：读数行不再写「目标 + 课堂按序合并」这句装配自述——
    保留「两段」这个范围事实（N 数的是两段的总和），怎么合并在卡头 title 里说。 */
const turnMeta = computed(() => {
  if (!session.value) return ''
  if (!turnRows.value.length) return '暂无对话记录'
  if (!isRealMode.value) return `${turnRows.value.length} 条对话 · 目标与课堂两段`
  return realKind.value === 'goal'
    ? `${turnRows.value.length} 条对话 · 本目标对话`
    : `${turnRows.value.length} 条对话 · 本课课堂转录`
})
/** 虚拟会话的回合构成（只挂在卡头 title）：本会话一个会话即完整旅程 */
const turnMetaTitle = computed(() => '')

/* 知识状态更新（真实掌握度）：真实会话 = teaching.knowledgeState（后端 knowledgePointStates）；
   虚拟会话 = 当前课课时总结 knowledgeItems。无数据整卡不渲染，不硬造 ±Δ（后端无增量字段） */
const realTeachingBlock = computed(() => asRecord(isRealMode.value ? session.value?.teaching : null))

/* 本节课负荷聚合：后端 commitSessionLoadMetric 写 learning_metrics(session_load)，
   session-console API 回填 teaching.sessionLoad。此前该指标无任何读取方（死仓），
   这里给它第一个面向人的消费点——总结页的本轮负荷一行。 */
const sessionLoadBlock = computed(() => asRecord(realTeachingBlock.value.sessionLoad))
const sessionLoadView = computed(() => {
  const mean = sessionLoadBlock.value.mean
  if (typeof mean !== 'number' || !Number.isFinite(mean)) return ''
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const parts = [`均值 ${pct(mean)}`]
  if (typeof sessionLoadBlock.value.max === 'number') parts.push(`峰值 ${pct(sessionLoadBlock.value.max as number)}`)
  if (typeof sessionLoadBlock.value.perTurnCount === 'number') parts.push(`${sessionLoadBlock.value.perTurnCount} 轮`)
  return parts.join(' · ')
})
const sessionLoadTitle = computed(() => {
  const dist = asRecord(sessionLoadBlock.value.basisDist)
  const basis = Object.entries(dist)
    .filter(([, n]) => typeof n === 'number')
    .map(([key, n]) => `${key} ${n}`)
    .join(' / ')
  return basis ? `负荷判定依据分布：${basis}` : 'AI 对每轮作答的认知负荷估计（0-1）'
})
const KNOWLEDGE_STATUS_TEXT: Record<string, string> = { mastered: '已掌握', learning: '学习中', review: '待复习', pending: '未开始' }
const knowledgeRows = computed<Array<{ name: string; value: string; statusLabel: string; statusTone: string }>>(() => {
  const raw = isRealMode.value ? realTeachingBlock.value.knowledgeState : lessonWrapup.value?.knowledgeItems
  if (!Array.isArray(raw)) return []
  return raw.map(asRecord).map((item) => {
    const name = firstText(item.name)
    if (!name) return null
    // progress 缺失（null/undefined）不得经 Number(null)=0 误读为 0%，回退到状态词
    const progress = typeof item.progress === 'number' && Number.isFinite(item.progress) ? item.progress : null
    const status = normalized(item.status)
    const statusLabel = KNOWLEDGE_STATUS_TEXT[status] || ''
    // 2026-10-11 走查：进度与状态是两维。原先「有 progress 就只显示百分比」，于是 100% + status=learning
    // 的知识点在页面上读成「已掌握」（本条会话 6 条全 100%，其中 2 条平台仍标学习中）。两维都要给。
    const value = progress !== null ? `${Math.round(progress)}%` : (statusLabel || '—')
    return {
      name,
      value,
      statusLabel: progress !== null ? statusLabel : '',
      statusTone: status === 'mastered' ? 'ok' : status === 'learning' ? 'info' : status === 'review' ? 'warn' : 'muted'
    }
  }).filter((row): row is { name: string; value: string; statusLabel: string; statusTone: string } => !!row)
})
/* ===== 学习者资料（上传附件 + 联网采集入库，2026-10-11 走查）=====
   数据只在真实目标对话控制台载荷里（后端 materialSummaries 投影：列表级字段 + brief 理解摘要，正文不进载荷）。
   brief = Document Summary Index 的每资料摘要节点（docType/subject/audience/overview/coreConcepts/naturalDivisions/toc），
   goal 对话与 path 生成复用同一份 —— 这里呈现的就是那份「结果」。 */
interface RealMaterial {
  id: string
  name: string
  origin: 'upload' | 'web'
  originLabel: string
  sizeText: string
  subject: string
  overview: string
  concepts: string[]
  divisions: string[]
  docType: string
  tocCount: number
  hasBrief: boolean
  sourceUrl: string
  sourceHost: string
  timeText: string
  timeTitle: string
}
const realMaterials = computed<RealMaterial[]>(() => {
  if (!isRealMode.value) return []
  const raw = (session.value as Record<string, unknown> | null)?.materials
  if (!Array.isArray(raw)) return []
  return raw
    .map(asRecord)
    .map((m) => {
      const brief = asRecord(m.brief)
      const origin = normalized(m.origin) === 'web' ? ('web' as const) : ('upload' as const)
      const sourceUrl = firstText(m.sourceUrl)
      let sourceHost = ''
      if (sourceUrl) {
        try { sourceHost = new URL(sourceUrl).host } catch { sourceHost = sourceUrl.slice(0, 32) }
      }
      const chars = Number(m.charCount) || 0
      const stamp = origin === 'web' ? firstText(m.fetchedAt, m.createdAt) : firstText(m.createdAt)
      const concepts = Array.isArray(brief.coreConcepts) ? brief.coreConcepts.map((c) => String(c)).filter(Boolean).slice(0, 6) : []
      const divisions = Array.isArray(brief.naturalDivisions) ? brief.naturalDivisions.map((c) => String(c)).filter(Boolean).slice(0, 1) : []
      return {
        id: firstText(m.id) || firstText(m.name),
        name: firstText(m.name) || '未命名资料',
        origin,
        originLabel: origin === 'web' ? '联网采集' : '学习者上传',
        sizeText: `${chars.toLocaleString('zh-CN')} 字`,
        subject: firstText(brief.subject),
        overview: firstText(brief.overview),
        concepts,
        divisions,
        docType: firstText(brief.docType),
        tocCount: Number(brief.tocCount) || 0,
        hasBrief: !!Object.keys(brief).length,
        sourceUrl,
        sourceHost,
        timeText: stamp ? formatTime(stamp) : '—',
        timeTitle: origin === 'web' ? '联网采集入库时间' : '上传时间'
      }
    })
    .filter((m) => !!m.name)
})
const materialMetaText = computed(() => {
  const list = realMaterials.value
  if (!list.length) return ''
  const withBrief = list.filter((m) => m.hasBrief).length
  /* 2026-10-18 用户走查「这类文案」：只报「几份 · 几份有摘要」。
     上传 / 联网的拆分是来源构成（每条资料行首徽章已标），此前四个计数并排把主读数挤没。 */
  return withBrief === list.length ? `${list.length} 份` : `${list.length} 份资料 · ${withBrief} 份有理解摘要`
})

/* ===== 资料全文弹层（2026-10-12 走查「只能看到简介吗」）：控制台列表载荷刻意不含正文
   （单份可达 10 万字），全文点开才取。last-wins 守卫：点开另一份后旧响应不回填。 ===== */
const materialView = ref<{
  id: string
  name: string
  sizeText: string
  loading: boolean
  error: string
  markdown: string
  truncated: boolean
} | null>(null)
const materialMaskRef = ref<HTMLElement | null>(null)
const materialPanelRef = ref<HTMLElement | null>(null)
function closeMaterialView() {
  materialView.value = null
}
async function openMaterialView(m: RealMaterial) {
  const sid = sessionId.value
  if (!sid) return
  materialView.value = { id: m.id, name: m.name, sizeText: m.sizeText, loading: true, error: '', markdown: '', truncated: false }
  try {
    const res = await adminVirtualLearnersApi.getRealSessionMaterial(sid, m.id)
    if (materialView.value?.id !== m.id) return
    const payload = asRecord((res.data as Record<string, unknown>)?.data)
    materialView.value.markdown = typeof payload.markdown === 'string' ? payload.markdown : ''
    materialView.value.truncated = payload.truncated === true
    materialView.value.loading = false
  } catch {
    if (materialView.value?.id !== m.id) return
    materialView.value.loading = false
    materialView.value.error = '资料全文读取失败'
  }
}
function retryMaterialView() {
  const view = materialView.value
  const m = view ? realMaterials.value.find((x) => x.id === view.id) : null
  if (m) void openMaterialView(m)
}
/* 开合行为四件套：Esc/遮罩/焦点陷阱/滚动锁（同 PathJourneyPanel 任务弹层） */
useOverlay(computed(() => !!materialView.value), materialPanelRef)
useMaskClose(materialMaskRef, closeMaterialView)
useEscape(() => !!materialView.value, closeMaterialView)

/* 知识状态更新卡已归位 Learn 页（2026-10-12 四页拆分）；来源点名判据保留在 knowledgeSourceLabel */

/** 卡头来源名（2026-10-11 走查）：原写「会话知识状态」里的"会话"指课堂会话，摆在目标对话控制台上
    极易被读成"这条目标对话的知识状态"。点名它实际来自哪一节课。 */
const knowledgeSourceLabel = computed(() => {
  if (!isRealMode.value) return '知识点掌握度 · 当前课课时总结'
  const topic = firstText(realTeachingBlock.value.topic)
  return topic ? `最近一节课堂 · ${topic}` : '知识点掌握度 · 会话知识状态'
})
const knowledgeSourceTitle = computed(() => '')


/** 总结页单课总结行（2026-10-12 二次拍板「总结就单独总结，不再和课程混在一起」）：
    课表是 Learn 的（同一棵树不在总结页重复），这里只列**有总结可看**的课——已完成且落了
    课堂会话，按课序。 */
const wrapupLessonRows = computed(() =>
  learnLessons.value.filter((l) => l.state === 'done' && !!l.teachingSessionId)
)

/** 总结页就地展开单课总结：复用 Learn 的取数链（openLesson → teachingDetail → lessonWrapup），
    不切页签。手风琴单开是硬约束：lessonWrapup 是「当前加载课」的单课计算值，多开双行
    会渲染同一份数据张冠李戴。 */
const expandedWrapupTaskId = ref<string | null>(null)
function toggleWrapupLesson(lesson: LearnLesson) {
  if (expandedWrapupTaskId.value === lesson.taskId) {
    expandedWrapupTaskId.value = null
    return
  }
  expandedWrapupTaskId.value = lesson.taskId
  openLesson(lesson)
}

/** 会话状态简短标签（顶栏点 / hero pill / 卡 meta 同源；2026-10-06 审核 #48：
 *  暂停时三处都必须读到「已暂停」，不得只让顶栏点转琥珀而文字仍写「进行中」） */
const sessionStatusLabel = computed(() => {
  if (isRealMode.value) return '只读'
  if (isPaused.value) return '已暂停 · 自动推进已冻结'
  if (autopilotRunning.value) return '自动驾驶'
  // 状态词一律走全局字典（单源）：running → 进行中，不再在页内另写一套同义词
  return statusText(String(session.value?.status ?? ''))
})
/* 数据加载 */
/** 日期模拟时钟（只读）：虚拟会话顶部显示"第 N 天"推进进度 */
const simClock = ref<{
  enabled: boolean
  baseDate: string
  dayIndex: number
  maxSimulatedDays: number
  autoAdvance: boolean
  courseWeekdays: number[]
  lessonsPerDay: number
} | null>(null)

async function loadSimClock(id: string) {
  try {
    const res = await adminVirtualLearnersApi.getVirtualSessionSimulationClock(id)
    if (sessionId.value !== id) return
    simClock.value = res.data?.data ?? res.data ?? null
  } catch {
    if (sessionId.value === id) simClock.value = null
  }
}

async function refresh() {
  const id = sessionId.value
  if (!id) return
  try {
    if (isRealMode.value) {
      const res = await adminVirtualLearnersApi.getRealSessionConsole(id)
      if (sessionId.value !== id) return
      session.value = res.data?.data ?? res.data ?? {}
      sessionLoadFailed.value = false
      clockTick.value = Date.now()
      const kind = String((session.value as Record<string, unknown>)?.kind || '')
      realKind.value = kind === 'goal' ? 'goal' : 'teaching'
      /* 面包屑对象名（2026-10-24）：深链进来此前只有裸会话 id，看不出是课堂还是目标对话 */
      if (!subPage.value?.label) setSubPageLabel(kind === 'goal' ? '目标对话' : '真实课堂')
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
    sessionLoadFailed.value = false
    clockTick.value = Date.now()
    const sr = (session.value?.stageResults || {}) as Record<string, unknown>
    const simCfg = (sr.simulationConfig || {}) as Record<string, unknown>
    const fb = String(simCfg.frictionBudget || '')
    if (['none', 'low', 'normal', 'high', 'stress_test'].includes(fb)) {
      frictionBudget.value = fb as typeof frictionBudget.value
    }
    // 实验/采样开关（2026-10-21）：与驱动脚本写的是同一组 simulationConfig 字段
    const arm = String(simCfg.experimentArm || '').toUpperCase()
    experimentArm.value = arm === 'A' || arm === 'B' ? arm : ''
    extensionProbe.value = simCfg.extensionProbe === true
    const adv = String(simCfg.advisoryResponse || '')
    advisoryResponse.value = ['keep', 'later', 'preview'].includes(adv) ? adv as typeof advisoryResponse.value : ''
    // 每课回合上限初始值：画像运行偏好（会话创建时写入 simulationConfig），驾驶舱可临时调
    const turnCap = Number(simCfg.turnCapPerLesson)
    if (Number.isFinite(turnCap) && turnCap >= 1 && turnCap <= 100) {
      learnAutoTurnCap.value = Math.round(turnCap)
    }
    const m = String(simCfg.model || '')
    simModel.value = m
    parseBlackbox()
    await Promise.all([
      loadLogs(),
      loadSimClock(id),
      isBlackbox.value ? Promise.resolve() : loadPathStatus(),
      isBlackbox.value ? Promise.resolve() : loadTeachingDetail()
    ])
  } catch (e) {
    if (sessionId.value !== id) return
    // 只有「从未加载成功」才算首载失败（session 已有旧数据时失败仅 toast，避免误盖错误条）
    if (!session.value) sessionLoadFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  }
}

/** 证据类型词表（后端 learner_evidence.evidenceType 原文 → 中文；2026-10-06 审核 #51）。
 *  未命中映射的回落原文（不猜词），原枚举始终可在该行「原文」JSON 里查。 */
const EVIDENCE_TITLE_ZH: Record<string, string> = {
  'checkpoint:result': '检查点结果',
  'lesson:completed': '课时完成',
  'task:completed': '任务完成',
  'goal:understanding:updated': '目标理解更新',
  'review:completed': '复习完成',
  'review:warmup': '课内温故',
  'concept:merge:applied': '概念归并已执行',
  'learner:confusion:detected': '检测到困惑',
  /* 路径家族（2026-10-18）：此前缺这四条，日志主视觉位直接露 path:created 这种事件码。
     措辞按日志行（事件句）调，与后端人读 detail 配对读作「学习路径已创建 · 路径「X」」 */
  'path:created': '学习路径已创建',
  'path:generated': '路径生成完成',
  'path:adjusted': '路径已调整',
  'path:completed': '路径已完成',
  /* 其余生产真值（2026-10-18 按 learner_evidence 实际 evidenceType 计数补全）：
     不补这六条，日志主视觉位会继续露 session:outcome / checkpoint:attempt 这种事件码 */
  'session:outcome': '学习结果',
  'checkpoint:attempt': '检查点作答',
  'task:difficulty:adjustment': '难度调整',
  'session-knowledge-distilled': '知识点提炼',
  'dialogue-concepts-extracted': '对话概念抽取',
  'anchor:result': '锚点结果',
  'churn:risk': '流失风险'
}

async function loadLogs() {
  const id = sessionId.value
  if (!id) return
  try {
    if (isRealMode.value) {
      /* 2026-10-22 用户「日志和左侧会不会重复」：目标对话/课堂的逐条消息在左侧页签有全文，
         日志逐条再截断复读一遍没有增量信息。这里把「聊天消息」折叠成每阶段一条读数行，
         点按跳到对应页签；路径/证据与课堂里程碑类事件（总结已生成、课堂开始等）仍逐条列。
         判据用标题前缀而不是 kind：teaching 里既有聊天行也有「会话总结已生成」这种事件。 */
      const isChatMessage = (t: { kind?: string; title?: string }) =>
        (t.kind === 'goal' || t.kind === 'teaching') && /^(学习者|教师|平台目标|Goal)/.test(String(t.title || ''))
      const chatTabOf = (kind?: string): 'goal' | 'learning' => (kind === 'goal' ? 'goal' : 'learning')
      const collapsed = new Set<'goal' | 'learning'>()
      // 稳定 id：下标 id 在时间线窗口滑动后错位（appendLogs 按 id 去重，旧 id 抢占新内容 → 丢行/串行），
      // 改用 时间+类型+标题/详情前缀 组合，内容不变则 id 稳定
      const items: Array<Record<string, unknown>> = []
      for (const t of timelineEntries.value) {
        if (isChatMessage(t)) {
          const tab = chatTabOf(t.kind)
          if (collapsed.has(tab)) continue
          collapsed.add(tab)
          /* 不给条数：日志数的是时间线里的消息片段，左侧页签数的是会话消息（且课堂只显示选中课），
             两个数字同屏会互相打架——这里只留「去哪看全文」。 */
          items.push({
            id: `chat-group|${tab}|${t.time || ''}`,
            createdAt: t.time || '',
            timestamp: t.time || '',
            phase: t.kind,
            message: '查看全文',
            jumpTab: tab
          })
          continue
        }
        /* 证据条目标题是后端 evidenceType 原文（如 checkpoint:result）：先过中文词表再展示，
           原枚举留在「原文」JSON 里（R5：主视觉位不直出内部标识；2026-10-06 审核 #51）。
           detail（后端正文摘要）此前只塞进 details.text 而 summaryText 优先吃顶层 message，
           合成行只剩标题——这里显式拼回正文，日志行才可读。 */
        const title = EVIDENCE_TITLE_ZH[String(t.title || '')] || String(t.title || '')
        const detail = String(t.detail || '').trim()
        /* 证据事件整包 payload（2026-10-18）：主行只读人读 detail，payload 放进「原文」，
           排查时展开仍能看到真实字段；无 payload 就不挂空的 details */
        let payload: unknown = null
        if (typeof t.raw === 'string' && t.raw) {
          try { payload = JSON.parse(t.raw) } catch { payload = t.raw }
        }
        items.push({
          id: `${t.time || ''}|${t.kind || ''}|${String(t.title || '').slice(0, 60)}|${String(t.detail || '').slice(0, 40)}`,
          createdAt: t.time || '',
          timestamp: t.time || '',
          phase: t.kind,
          message: detail ? `${title} · ${detail}` : title,
          details: detail || payload ? { ...(detail ? { text: detail } : {}), ...(payload ? { payload } : {}) } : undefined
        })
      }
      /* 真实模式的日志由 timeline 整体推导，不是增量流：先清空再落位，
         否则折叠行的条数变化（11 → 12 条）会和新 id 一起被追加成两行。 */
      resetLogs()
      appendLogs(items.slice(-LOG_WINDOW).map((l: Record<string, unknown>) => {
        const view = parseLogEntry(l)
        return {
          id: String(l.id ?? ''),
          // 虚拟会话日志字段是 timestamp（非 createdAt）；兼容两者
          time: l.timestamp || l.createdAt ? new Date(String(l.timestamp || l.createdAt)).toLocaleTimeString('zh-CN', { hour12: false }) : '',
          text: view.text || view.phase,
          // 折叠行没有可排查的载荷：别挂一个只有合成字段的「原文」
          view: { ...view, phase: timelineKindLabel(String(l.phase)), ...(l.jumpTab ? { rawJson: '' } : {}) },
          jumpTab: l.jumpTab as 'goal' | 'learning' | undefined
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
      /* 阶段徽章中文化（2026-10-18）：虚拟日志 phase 是后端枚举（virtual-reply / goal-response…），
         此前主视觉位直接露英文；筛选项同源取自这里，所以筛选也一并变中文 */
      const phase = virtualLogPhaseZh(view.phase)
      return {
        id: String(l.id ?? l.messageId ?? ''),
        time: l.timestamp || l.createdAt ? new Date(String(l.timestamp || l.createdAt)).toLocaleTimeString('zh-CN', { hour12: false }) : '',
        text: view.text || phase,
        view: { ...view, phase }
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
  if (!id || isBlackbox.value) {
    teachingDetail.value = null
    return
  }

  const currentTeachingSessionId = firstText(bindings.value.teachingSessionId)
  const target = teachingSessionId || currentTeachingSessionId
  if (!target) {
    teachingDetail.value = null
    return
  }

  // 轮询走静默刷新：不闪「正在读取」占位，避免页面高度变化导致滚动跳动。
  if (!options.silent) teachingDetailLoading.value = true
  try {
    if (isRealMode.value) {
      /* 真实单课数据走会话控制台端点（教学控制台本体就是它，天然按课堂会话服务），
         归一成 teachingDetail 形状（id / messages / wrapup）供同一套消费方渲染。
         旧判例「teaching-detail 端点仅服务虚拟会话，真实单课总结结构性不可达」（FN4）
         自真实控制台端点上线后已过时——真实课堂的就地切换与单课总结由此解锁（2026-10-12 走查）。
         缓存只喂归档课：当前课的转录还在长（轮询每拍静默刷新），缓存会把它冻住。 */
      const isCurrentLesson = target === firstText(bindings.value.teachingSessionId)
      const cached = isCurrentLesson ? undefined : realLessonCache.get(target)
      if (cached) {
        teachingDetail.value = cached
        teachingDetailFailed.value = false
        return
      }
      const res = await adminVirtualLearnersApi.getRealSessionConsole(target)
      if (sessionId.value !== id) return
      const payload = asRecord(res.data?.data ?? res.data)
      const teaching = asRecord(payload.teaching)
      const normalized: Record<string, unknown> = {
        id: firstText(payload.sessionId, teaching.teachingSessionId, target),
        messages: teaching.messages ?? asRecord(payload.conversations).learning,
        wrapup: teaching.wrapup ?? null,
        // 课堂类型（2026-10-21）：复习/延伸课与正课在座舱里此前只差上下文，类型必须显式可见
        mode: teaching.mode ?? null,
        advisory: teaching.advisory ?? payload.advisory ?? null,
        checkpoints: Array.isArray(teaching.checkpoints) ? teaching.checkpoints : []
      }
      if (!isCurrentLesson) realLessonCache.set(target, normalized)
      teachingDetail.value = normalized
    } else {
      const res = await adminVirtualLearnersApi.getVirtualSessionTeachingDetail(id, teachingSessionId || undefined)
      if (sessionId.value !== id) return
      teachingDetail.value = asRecord(res.data?.data ?? res.data)
    }
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

const frictionBudget = ref<'none' | 'low' | 'normal' | 'high' | 'stress_test'>('normal')
const frictionSaving = ref(false)
// 会话级模型覆盖（#12）：空 = 用 api-config 默认路由；可选值来自 liveApiConfig.availableModels
const simModel = ref('')
const simModelSaving = ref(false)
/* 实验/采样开关（2026-10-21）：与 frictionBudget/model 同属 simulationConfig，合并成一次保存 */
const experimentArm = ref<'' | 'A' | 'B'>('')
const extensionProbe = ref(false)
const advisoryResponse = ref<'' | 'keep' | 'later' | 'preview'>('')
const simFlagsSaving = ref(false)
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
    toast.success(`难度等级已更新：${FRICTION_LABEL[frictionBudget.value] || frictionBudget.value}`)
  } catch (e) {
    frictionBudget.value = previous
    toast.error(`更新失败：${errMsg(e)}`)
  } finally {
    frictionSaving.value = false
  }
}

async function saveModel() {
  if (!sessionId.value || isBlackbox.value || busy.value || simModelSaving.value) return
  simModelSaving.value = true
  const previous = simModel.value
  try {
    await adminVirtualLearnersApi.updateSessionSimulationConfig(sessionId.value, {
      model: simModel.value || null
    })
    toast.success(simModel.value ? `模型已更新：${simModel.value}` : '已恢复默认模型')
  } catch (e) {
    simModel.value = previous
    toast.error(`更新失败：${errMsg(e)}`)
  } finally {
    simModelSaving.value = false
  }
}

/* 实验/采样开关一次保存（2026-10-21）：臂标签只做对照、探针每会话一次、处置只留痕，都不改默认行为 */
async function saveSimFlags() {
  if (!sessionId.value || isBlackbox.value || busy.value || simFlagsSaving.value) return
  simFlagsSaving.value = true
  const previous = {
    arm: experimentArm.value,
    probe: extensionProbe.value,
    advisory: advisoryResponse.value,
  }
  try {
    await adminVirtualLearnersApi.updateSessionSimulationConfig(sessionId.value, {
      experimentArm: experimentArm.value || null,
      extensionProbe: extensionProbe.value,
      advisoryResponse: advisoryResponse.value || null,
    })
    toast.success(`实验设置已保存：臂 ${experimentArm.value || '默认'} · 延伸探针 ${extensionProbe.value ? '开' : '关'} · 建议处置 ${advisoryResponse.value || '不记录'}`)
  } catch (e) {
    experimentArm.value = previous.arm
    extensionProbe.value = previous.probe
    advisoryResponse.value = previous.advisory
    toast.error(`更新失败：${errMsg(e)}`)
  } finally {
    simFlagsSaving.value = false
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

/* ===== 生命周期控制（统一模型 vlab-controls）：顶栏操作按钮由状态机派生 =====
   2026-10-19 运营走查：本计算原先自己写了一份（只看 status + isPaused），比下面
   runLifecycleState 少两个分支——紧急停止的会话顶栏仍给「暂停」，自动驾驶已停的会话顶栏
   仍给「停止自动驾驶」，与同屏状态徽章/运行状态卡打架。改为消费同一派生（vlab-controls 单源）。
   未加载时不给动作（原行为）：不猜状态。 */
const lifeStateCockpit = computed<VsLifecycleState>(() => {
  if (!session.value) return 'idle'
  return runLifecycleState.value
})
const lifeHandlersCockpit: Partial<Record<VsControlKey, () => void>> = {
  pause: pauseSession,
  resume: resumeSession,
  stop: stopLearning,
  retry: restartLearning,
  delete: () => { void removeSession() }
}
const lifeControlsCockpit = computed(() =>
  vlabControlsFor(lifeStateCockpit.value, {
    stage: typeof session.value?.currentStage === 'string' ? session.value.currentStage : undefined
  }).filter((c) => lifeHandlersCockpit[c.key])
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
    /* 按原输入重跑：会新建一个会话并重新消耗 AI 调用（2026-10-19 运营走查：全页唯一
       「重复创建 + 烧调用」却没有确认的破坏性动作，其余同类动作都有确认） */
    if (kind === 'rerun') {
      const ok = await askConfirm({
        title: '按原输入重跑',
        message: '将用原输入新建一个会话并重跑一遍，会消耗新的 AI 调用。\n当前会话与它的记录保留，不会被覆盖。确认重跑？',
        confirmText: '重跑'
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
        message: '将删除当前路径方案并重新生成（目标上下文保留）。\n已有教学历史或进度时会拒绝执行。确认？',
        confirmText: '重建路径',
        danger: false
      })
      if (!ok) return
    }
    if (kind === 'replanPath') {
      const ok = await askConfirm({
        title: '按评审意见重规划',
        message: '将按当前评审意见重新规划路径方案，替换现有方案（目标上下文保留）。\n确认？',
        confirmText: '重新规划',
        danger: false
      })
      if (!ok) return
    }
    /* D9（2026-10-22 拍板 A）：自动驾驶会一直跑到路径完成或触发成本护栏，
       单会话可能持续消耗大量 AI 调用；启动前先把终点、回合上限与预算口径说清。 */
    if (kind === 'autopilotStart') {
      const ok = await askConfirm({
        title: '启动自动驾驶',
        message: `将以「路径全部完成」为终点持续运行，不会逐课停下等你确认。\n每课回合上限 ${clampLearnAutoTurnCap()}。会话配置了成本护栏时达到上限会自动停止，未配置则可能持续产生较多 AI 调用。\n运行期间可随时停止，学习进度与对话保留。`,
        confirmText: '启动自动驾驶',
        danger: false
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
      case 'autopilotStart': {
        const resp = await adminVirtualLearnersApi.autopilotStart(id, { maxTurns: clampLearnAutoTurnCap() })
        const payload = (resp as { data?: { data?: { queued?: boolean; position?: number } } })?.data?.data
        if (payload?.queued) {
          toast.info(`自动驾驶运行名额已满，已排队（第 ${payload.position ?? 1} 位），有空位会自动启动`)
        } else {
          toast.info('全自动模式已启动：将以最终目标（路径全部完成）为终点持续运行，每课推进轮数按「每课回合上限」设置')
        }
        break
      }
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
        await adminVirtualLearnersApi.acceptVirtualSessionPath(id, {
          force: pathReviewDecision.value !== 'accept',
        })
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
      // 评审动作已随裁判独立面移除（2026-09-27）：/api/admin/session-audits
      case 'rerun': {
        const res = await adminVirtualLearnersApi.rerunBlackboxVirtualSession(id)
        const d = res.data?.data ?? res.data ?? {}
        const newId = String(d.id || d.sessionId || '')
        if (!newId) {
          toast.info('已按原输入重跑，但未返回新会话 ID。已刷新当前会话')
          await refresh()
          return
        }
        toast.info('已按原输入重跑，正在打开新会话')
        openSubPage('session', newId, subPage.value?.from ? { from: subPage.value.from } : undefined)
        return
      }
    }
    // autopilotStart/Stop 分支已弹过专属 toast（排队/启动/停止语义），
    // 再统一弹「指令已执行」会一次点击两条（rerun 走 early return 不经过这里）
    if (kind !== 'autopilotStart' && kind !== 'autopilotStop') toast.success('指令已执行')
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
    // 首拍不立即执行:三个 startPolling 调用点(watch/resumeLearning/restartLearning)
    // 前后都已有 refresh() 立即拉数据,轮询立即再拍 = 首帧秒内双打 ~9 请求
    immediate: false,
  }
)

/* 顶栏「刷新真实数据」的广播接住点：loadLiveData(true) 只重拉 live 域，本页会话载荷取自
   独立的 console / virtual-session 接口，不在其中；不接这一手，撤掉 hero 刷新钮后终端会话
   （轮询已停）就没有任何重新读取的入口了。Orchestrator 的页头刷新钮同样由这条广播接住。 */
watch(liveRefreshSeq, () => { void refresh() })

watch(
  sessionId,
  async (id) => {
    if (!id) return
    stopPolling()
    session.value = null
    sessionLoadFailed.value = false
    resetLogs()
    pathStatus.value = null
    pathStatusFailed.value = false
    teachingDetail.value = null
    teachingDetailFailed.value = false
    selectedTeachingSessionId.value = ''
    resetTraces()
    frictionBudget.value = 'normal'
    timelineEntries.value = []
    rawLogs.value = []
    await refresh()
    if (sessionId.value !== id) return
    // 页签默认落点：① 显式 stage 提示优先（2026-10-12 拍板：从学习路径列表进来 = 落 Path 页签，
    //   深链 ?stage=path 同样生效）；② 目标对话控制台落 goal——本页对象是那条 Goal 对话（2026-10-11
    //   走查）；③ 其余跟随 currentStage。后端 currentStage 报的是**学习路径流水线**位置（session-console.ts
    //   buildGoalConsole），课堂会话页面对象就是那一课，课结束落总结合理。
    const hint = subPage.value?.stage
    const stage = hint && (stageFlow as readonly string[]).includes(hint)
      ? hint
      : isRealMode.value && realKind.value === 'goal' ? 'goal' : currentStage.value
    activeTab.value = (stageFlow as readonly string[]).includes(stage) ? stage as StageKey : 'goal'
    startPolling()
  },
  { immediate: true }
)

/* ===== 会话数据包（2026-10-18 用户走查：原「原始会话数据」整包 JSON 直排偏源码开发） =====
   主列只回答「这包数据里有什么」：类型 + 消息数 + 路径规模 + 时间线/日志条数。整包 JSON 收进弹层。
   rawJsonFull 仍是惰性计算（session 每 5s 轮询全量更新，常驻 stringify 会每拍序列化一次大载荷），
   仅弹层打开时序列化；复制按需现取。 */
const rawOpen = ref(false)
const rawMaskRef = ref<HTMLElement | null>(null)
const rawPanelRef = ref<HTMLElement | null>(null)
function closeRaw() { rawOpen.value = false }
useOverlay(computed(() => rawOpen.value), rawPanelRef)
useMaskClose(rawMaskRef, () => closeRaw())
useEscape(() => rawOpen.value, () => closeRaw())

const rawJsonFull = computed(() => (rawOpen.value ? JSON.stringify(session.value, null, 2) : '') || '')
const rawJsonLength = computed(() => rawJsonFull.value.length)

/** 数据包读数：只报「只有这里能读到」的事实。
 *  消息数 / 阶段数 / 任务数在页签卡头与阶段瓦片已有，同屏复述等于读两遍
 *  （2026-10-22 用户「还有数据包」；卡头不复述判例）。 */
const packageFacts = computed(() => {
  const s = session.value as { timeline?: unknown[] } | null
  if (!s) return '加载中…'
  return Array.isArray(s.timeline) ? `${s.timeline.length} 条时间线` : '完整会话数据'
})

async function copyRawJson() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(session.value, null, 2))
    toast.success('完整会话数据已复制')
  } catch {
    // 非安全上下文或浏览器未授予剪贴板权限：不假装成功
    toast.error('复制失败，浏览器未授予剪贴板权限')
  }
}
</script>

<style scoped>
/* ===== Top bar ===== */
/* 页面级：会话对话区的高度口径（单一来源，三处消费——Goal 转录 / 课堂课程树 / 课堂对话列）。
   口径与来历见下方「Learn 双栏」注释。 */
.cp {
  gap: 0;
  --cp-class-h: clamp(560px, calc(100dvh - 140px), 1100px);
}
.cp-topbar {
  /* 状态条外观（表面/描边/间距/内容协议）由 .mk-status 提供，本类只负责"粘性放置" */
  background: var(--mk-bg);
  position: sticky;
  top: 0;
  z-index: 10;
  margin: -8px -8px 0;
  padding: 8px 8px 0;
}
.cp-topbar__autopilot {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-amber);
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--mk-amber-bg);
  white-space: nowrap;
}
/* 顶栏标题内的会话 ID（2026-10-06 审核 #67）：模板引用了 .cp-title__id 但全仓零定义，
   此前 ID 继承父级 .mk-status__title 的 15px/700 与标题同档抢眼；hero 里同一 ID 按
   micro/muted/400 弱化处理，两处对齐 */
.cp-title__id { font-size: var(--mk-fs-micro); font-weight: 400; color: var(--mk-muted); }

/* 预算消耗预警条（顶栏：累积 AI 调用 used/limit，分档变色） */
/* 预算消耗预警条（顶栏：累积 AI 调用 used/limit，分档变色）
   进度量化走 .mk-minibar（track/fill 形状与三段 tone 由原语提供），本类只保留胶囊外观与分档底色 */
.cp-budget {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--mk-line);
  background: var(--mk-card-foot-bg);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
  cursor: help;
}
.cp-budget__label { font-weight: 700; color: var(--mk-muted); }
.cp-budget__track { width: 56px; }
.cp-budget__num { font-weight: 800; color: var(--mk-ink); font-variant-numeric: tabular-nums; }
.cp-budget.is-warn { border-color: rgba(245, 158, 11, 0.45); background: var(--mk-amber-bg); }
.cp-budget.is-full { border-color: rgba(239, 68, 68, 0.5); background: var(--mk-red-bg); }
.cp-budget.is-full .cp-budget__num { color: var(--mk-red); }

/* ===== 统一控制台（阶段 tab + 该阶段操作，置顶汇聚） ===== */
/* 教学建议条（原型 .note--warn 词表：琥珀软底 + amber 字，micro 级）；位于 hero 之下、控制台之上 */
.cp-advisory {
  display: flex; align-items: baseline; gap: 8px;
  margin: 12px 0 0; padding: 10px 12px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-amber-bg); color: var(--mk-amber);
  font-size: var(--mk-fs-micro); line-height: 1.65;
}
.cp-advisory__text { min-width: 0; }
/* 课时健康读数条（P1#7）：发丝线分隔、label faint、读数 mono 等宽 */
.cp-healthstrip { display: flex; align-items: baseline; gap: 10px; padding: 8px 16px; border-bottom: 1px solid var(--mk-line); background: var(--mk-surface); }
.cp-healthstrip__label { flex: none; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.cp-healthstrip__text { min-width: 0; color: var(--mk-ink); font-size: var(--mk-fs-micro); }
.cp-advisory .mk-badge { flex: none; }

.cp-console {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-sm);
  margin-top: 12px;
}
.cp-console__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cp-console__sep { width: 1px; height: 18px; background: var(--mk-line); flex-shrink: 0; }

.cp-console__note { font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* ===== 原型 renderSessionDetail 骨架：hero / 教学闭环 .loop / 阶段推进 .stepper / 双栏 ===== */
.cp-hero { margin: 12px 2px 0; }
/* 会话 ID meta（pills 行内 mono 小字，2026-10-04 P2-7）：主标题已让位给会话主题，
   ID 不再以 24px/700 出现；meta 弱化为 muted 微字号，全量 ID 走 title */
.cp-hero__id { font-size: var(--mk-fs-micro); font-weight: 400; color: var(--mk-muted); }
/* 卡体（mk-card 头下内容衬距；mk 原语无 .mk-card__body，用本页局部类） */
.cp-cardbody { padding: 12px 14px 16px; }
/* 路径卡头右组：meta 与面板治理动作同排；面板 Teleport 进来的 ⋯ 就落在这里 */
.cp-path-head-right { display: inline-flex; align-items: center; gap: 8px; }
.cp-path-acts { display: inline-flex; align-items: center; }

/* .cp-loop 一族 2026-10-19 随「教学闭环定位」卡下线（用户走查「这不重复吗」→ 拍板删卡）：
   它前四环读的是本卡下方 stepper 的同一对 stageDone/stageActive，只换了套更长的阶段名
   （目标对话/路径规划/教学回合/课后评估 ↔ stageLabel 的目标/路径/学习/总结），第五环
   「记忆复习」会话里没有对应阶段、恒「未进入」，即整卡不含 stepper 之外的任何会话状态。
   五环闭环该在的地方是有真实读数与下钻的平台总览、以及带每阶段累计会话数的画像详情。 */

/* 阶段推进（2026-10-15 重设计：四枚等宽阶段瓦片，每票一条状态色顶轨 + 标记 + 阶段名 + 真实读数，
   填满卡宽并把「推进到哪一步/每步读数」一屏读完；瓦片间 chevron 连成流水线。步点即阶段页签。） */
.cp-stepcard { margin-top: 14px; }
.cp-stepcard__spacer { flex: 1 1 auto; }
/* 下游直达入口（阶段推进卡头右侧）：两枚小动作钮，卡头不再只有读数 */
.cp-stepjumps { display: inline-flex; align-items: center; gap: 6px; margin-left: 10px; }
.cp-stepper { display: flex; align-items: stretch; gap: 8px; }
.cp-stepper__arrow { flex: none; align-self: center; width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 5px solid var(--mk-faint); opacity: 0.55; }
.cp-stp {
  position: relative; flex: 1 1 0; min-width: 0;
  display: flex; align-items: center; gap: 10px; text-align: left;
  padding: 12px 14px 12px 12px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-md);
  background: var(--mk-surface); font: inherit; cursor: pointer; overflow: hidden;
}
/* 顶轨：状态色单源（done 绿 / active 蓝 / idle 灰），瓦片顶部一条 3px 实心线 */
.cp-stp::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--mk-line); }
.cp-stp--done::before { background: var(--mk-green); }
.cp-stp--active::before { background: var(--mk-blue); }
.cp-stp:disabled { cursor: default; }
.cp-stp:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 2px; }
.cp-stp:not(:disabled):hover { border-color: var(--mk-blue); }
.cp-stp--active { background: var(--mk-blue-bg); border-color: var(--mk-blue); }
.cp-stp__dot {
  flex: none; box-sizing: border-box; width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center; background: var(--mk-surface); border: 2px solid var(--mk-faint);
  color: var(--mk-faint); font-size: var(--mk-fs-micro); font-weight: 700; font-variant-numeric: tabular-nums;
}
.cp-stp--done .cp-stp__dot { background: var(--mk-green-fill); border-color: var(--mk-green-fill); color: var(--mk-on-fill); }
.cp-stp--active .cp-stp__dot { background: var(--mk-blue-fill); border-color: var(--mk-blue-fill); color: var(--mk-on-fill); }
.cp-stp__body { flex: 1 1 auto; min-width: 0; display: grid; gap: 2px; }
.cp-stp__name { font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); overflow-wrap: anywhere; }
.cp-stp--idle .cp-stp__name { color: var(--mk-muted); }
.cp-stp__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); overflow-wrap: anywhere; }
.cp-stp--done .cp-stp__meta { color: var(--mk-green); font-weight: 600; }
.cp-stp--active .cp-stp__meta { color: var(--mk-accent-deep); font-weight: 700; }

/* 会话级卡片已归位各阶段页（2026-10-12 四页拆分），原 .cp-detail-grid 双栏栅格退役 */
.cp-turns td { vertical-align: top; }
.cp-turns__num { width: 48px; white-space: nowrap; }
.cp-turns__wrap { white-space: pre-wrap; min-width: 220px; word-break: break-word; }
.cp-turns__time { white-space: nowrap; color: var(--mk-faint); }
.cp-turns-empty { padding: 14px 16px; }

/* 知识状态更新 ranklist（原型 .rankrow 词表：名称 + mono 数值） */
.cp-ranklist { display: grid; gap: 2px; }
.cp-ranklist__row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--mk-line); }
.cp-ranklist__row:last-child { border-bottom: 0; }
.cp-ranklist__name { flex: 1 1 auto; min-width: 0; font-size: var(--mk-fs-micro); color: var(--mk-ink); overflow-wrap: anywhere; text-align: left; }
.cp-ranklist__val { font-variant-numeric: tabular-nums; font-weight: 600; font-size: var(--mk-fs-micro); color: var(--mk-muted); flex: none; }
/* 知识点状态词（与进度并列）：进度是「推了多远」，状态是「平台认不认已掌握」，两维并列防 100% 误读 */
.cp-ranklist__state { flex: none; display: inline-flex; align-items: center; gap: 5px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.cp-ranklist__state::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--mk-faint); }
.cp-ranklist__state[data-tone='ok']::before { background: var(--mk-green); }
.cp-ranklist__state[data-tone='info']::before { background: var(--mk-blue); }
.cp-ranklist__state[data-tone='warn']::before { background: var(--mk-amber); }

/* ===== 学习者资料（上传 / 联网采集）：一行一资料，理解摘要为主体 ===== */
.cp-mat { display: grid; gap: 6px; padding: 12px 0; border-bottom: 1px solid var(--mk-line); }
.cp-mat:first-child { padding-top: 0; }
.cp-mat:last-child { padding-bottom: 0; border-bottom: 0; }
.cp-mat__head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cp-mat__name { flex: 1 1 auto; min-width: 0; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-mat__meta { flex: none; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.cp-mat__subject { margin: 0; font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); line-height: 1.6; overflow-wrap: anywhere; }
/* 摘要正文：两行封顶（brief.overview ≤200 字，全量展开会压掉下一份资料） */
.cp-mat__overview {
  margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.7; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.cp-mat__none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.cp-mat__chips { display: flex; flex-wrap: wrap; gap: 4px 6px; }
.cp-mat__foot { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.cp-mat__fact { overflow-wrap: anywhere; }
.cp-mat__src { color: var(--mk-blue); text-decoration: none; }
.cp-mat__src:hover { text-decoration: underline; }
.cp-mat__time { margin-left: auto; flex: none; }

/* ===== 资料全文弹层：宽面板读长文（共享 .mk-modal 外壳，只调宽度变量与正文排版） ===== */
.cp-matview { --mk-modal-w: min(880px, 94vw); }
.cp-matview__head { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.cp-matview__head .mk-modal__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-matview__meta { flex: none; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.cp-matview__text {
  margin: 0; font-size: var(--mk-fs-micro); line-height: 1.8; color: var(--mk-ink);
  font-family: var(--mk-mono); white-space: pre-wrap; overflow-wrap: anywhere;
}
.cp-matview__trunc { margin: 10px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

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
.cp-aside-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-faint); flex-shrink: 0; }
.cp-aside-dot.is-ok { background: var(--mk-green); }
.cp-aside-dot.is-warn { background: var(--mk-amber); }
.cp-aside-dot.is-bad { background: var(--mk-red); }
.cp-aside-dot.is-muted { background: var(--mk-faint); }
.cp-aside-body { padding: 12px 14px; }

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
.cp-aside-state strong { font-size: var(--mk-fs-body); font-weight: 800; }
.cp-aside-state p { margin: 0; font-size: var(--mk-fs-micro); line-height: 1.6; color: var(--mk-muted); }
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
  border-radius: var(--mk-radius-xl);
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
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-ink);
  cursor: pointer;
  transition: background 0.1s ease;
  text-align: left;
}
.cp-sidebar__toggle:hover { background: rgba(0,0,0,0.02); }
.cp-sidebar__toggle.is-open { border-bottom: 1px solid var(--mk-line); }
.cp-sidebar__toggle-icon { font-size: var(--mk-fs-micro); color: var(--mk-faint); width: 14px; flex-shrink: 0; }
.cp-sidebar__toggle-hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 400; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
.cp-sidebar__body { padding: 10px 14px 14px; display: grid; gap: 8px; }

/* ----- Run in sidebar：.cp-run* 内芯样式已随审核 #73 抽取迁至
   session-cockpit/RunStatusPanel.vue（Learn 卡与折叠面板两宿主共用），此处不再保留副本。 */



/* ----- Logs in sidebar ----- */
/* 跟随钮的定位容器（滚动容器之外）：按钮 absolute 常驻右上，上翻日志也始终可见（#52） */
.cp-logs-wrap { position: relative; }
.cp-logs {
  max-height: 360px;
  overflow-y: auto;
  /* 嵌套滚动隔离（2026-10-06 审核 #72）：同一屏叠了页面/侧栏/日志/课程树多个纵向滚动容器，
     内层滚到底时不再把滚动链传给外层（否则滚轮滚谁取决于指针落点） */
  overscroll-behavior: contain;
  display: grid;
  gap: 4px;
}
.cp-logs__follow {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  width: fit-content;
  border: none;
  font: inherit;
  font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-green); cursor: pointer;
  padding: 2px 9px; border-radius: 999px; background: var(--mk-green-bg);
}
.cp-logs__follow:hover { background: rgba(16, 185, 129, 0.15); }
.cp-logs__follow.is-paused { color: var(--mk-amber); background: rgba(217, 119, 6, 0.08); }
.cp-logs__filter { display: flex; gap: 4px; flex-wrap: wrap; padding-bottom: 6px; border-bottom: 1px solid var(--mk-line); margin-bottom: 4px; }
.cp-logs__filter-chip {
  padding: 2px 8px; border-radius: 999px; border: 1px solid var(--mk-line);
  background: var(--mk-surface); font: inherit; font-size: var(--mk-fs-micro); font-weight: 600;
  color: var(--mk-muted); cursor: pointer; transition: all 0.12s ease;
}
.cp-logs__filter-chip:hover { border-color: var(--mk-blue); color: var(--mk-blue); }
/* 选中态（原型 .chip[aria-pressed="true"] 词汇：brand-bg 底 + brand 字，非实心填充） */
.cp-logs__filter-chip.is-active { background: var(--mk-blue-bg); border-color: var(--mk-blue); color: var(--mk-blue); }

/* ----- Review in sidebar ----- */
.cp-review-panel__actions { display: flex; flex-wrap: wrap; gap: 5px; }

/* ===== Shared components ===== */
.cp-btn {
  padding: 7px 14px;
  border-radius: var(--mk-radius-sm);
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  cursor: pointer;
  transition: all 0.12s ease;
}
.cp-btn--sm { padding: 5px 10px; font-size: var(--mk-fs-micro); border-radius: 6px; }
.cp-btn:hover:not(:disabled) { border-color: rgba(47, 106, 224, 0.4); color: var(--mk-blue); }
.cp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cp-btn--primary { background: var(--mk-blue); border-color: var(--mk-blue); color: var(--mk-on-fill); }
.cp-btn--primary:hover:not(:disabled) { color: var(--mk-on-fill); opacity: 0.9; }
/* 危险动作按钮改用 mk 原语 .mk-btn--danger（hero 动作区）；原 .cp-danger-btn 已删 */
.cp-turn-cap {
  width: 56px; padding: 5px 6px; border-radius: 6px; border: 1px solid var(--mk-line);
  background: var(--mk-surface); color: var(--mk-ink); font: inherit; font-size: var(--mk-fs-micro);
}
.cp-turn-cap-label { display: inline-flex; align-items: center; gap: 5px; font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.cp-none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
/* 原 .cp-empty-state 私有空态（44px 圆盘 + 三行）已收敛共享 MkEmptyState compact
   （2026-10-06 审核 #70）：空态语言全站唯一，T2 硬约束「空态用 MkEmptyState」落位 */

/* Log line */
.cp-log { display: flex; align-items: baseline; gap: 6px; font-size: var(--mk-fs-micro); flex-wrap: wrap; }
.cp-log--error { padding: 4px 8px; border-radius: 6px; background: var(--mk-red-bg); }
.cp-log__time { color: var(--mk-faint); font-family: var(--mk-mono); font-size: var(--mk-fs-micro); white-space: nowrap; padding-top: 1px; }
.cp-log__phase {
  padding: 0 5px; border-radius: var(--mk-radius-pill); font-size: var(--mk-fs-micro); font-weight: 700;
  background: var(--mk-blue-bg); color: var(--mk-accent-deep); white-space: nowrap;
}
.cp-log__phase--error { background: var(--mk-red-fill, var(--mk-red)); color: var(--mk-on-fill); }
.cp-log__text { color: var(--mk-muted); word-break: break-all; min-width: 0; flex: 1 1 auto; }
.cp-log--error .cp-log__text { color: var(--mk-red); font-weight: 600; }
/* 折叠行：同一行文字位置的可点读数（跳左侧页签），与正文同字号，下划线表明可点 */
.cp-log__jump {
  min-width: 0; flex: 1 1 auto; padding: 0; border: 0; background: none;
  font: inherit; color: var(--mk-accent-deep); text-align: left; cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
}
.cp-log__jump:hover { color: var(--mk-blue); }
.cp-log__jump:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 2px; border-radius: var(--mk-radius-xs); }
.cp-log__dur { color: var(--mk-faint); font-family: var(--mk-mono); font-size: var(--mk-fs-micro); white-space: nowrap; font-variant-numeric: tabular-nums; }
.cp-log__raw { font-size: var(--mk-fs-micro); flex-basis: 100%; }
.cp-log__raw summary { cursor: pointer; color: var(--mk-faint); font-weight: 600; user-select: none; list-style: none; }
/* 系统三角退役：与全站 details 同用自绘 ▸（2026-10-27 收口） */
.cp-log__raw summary::-webkit-details-marker { display: none; }
.cp-log__raw summary::before { content: '▸'; display: inline-block; margin-right: 5px; transition: transform 0.12s ease; }
.cp-log__raw[open] summary::before { transform: rotate(90deg); }
.cp-log__raw pre {
  margin: 4px 0 0; padding: 6px 8px; border-radius: 6px; background: var(--mk-code-bg);
  color: var(--mk-code-fg); font: var(--mk-fs-micro)/1.5 var(--mk-mono); white-space: pre-wrap;
  word-break: break-all; max-height: 120px; overflow: auto;
}
/* 骨架形状走 MkSkeleton（shimmer/暗色/reduced-motion 均由 .mk-skeleton 统一提供） */

/* Degrade */
.cp-degrade {
  margin: 0; display: flex; align-items: center; gap: 8px; font-size: var(--mk-fs-micro);
  font-weight: 600; color: var(--mk-red); padding: 7px 10px; border-radius: var(--mk-radius-sm); background: var(--mk-red-bg);
}
.cp-degrade .mk-link { font-size: var(--mk-fs-micro); }

/* Transcripts */
/* 内滚动上限（2026-10-12 走查）：Goal 转录与课堂对话都随内容长到两千 px 把整页拉长、
   控制台侧栏滚出视口——收进视口内自滚。上限走页面级 --cp-class-h（原为
   max(420px, calc(100dvh - 510px))，2026-10-19 用户「课堂区域高度高一些」时与课堂两列一起
   换口径，别再退回写死值）。
   嵌套滚动隔离（#72）：滚到底不把滚动链传给外层侧栏/页面 */
.cp-transcripts {
  display: grid; gap: 10px; padding: 12px 16px 16px;
  overflow-y: auto;
  max-height: var(--cp-class-h);
  overscroll-behavior: contain;
}
.cp-transcript {
  display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl);
}
.cp-transcript summary { cursor: pointer; font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-muted); }
.cp-transcript__message {
  display: grid; gap: 3px; padding: 8px 10px; border-left: 3px solid var(--mk-line); border-radius: var(--mk-radius-sm); background: var(--mk-surface-2);
}
.cp-transcript__message.is-teacher { border-left-color: var(--mk-blue); background: var(--mk-blue-bg); }
.cp-transcript__message.is-learner { border-left-color: var(--mk-teal); background: rgba(45, 212, 191, 0.1); }
.cp-transcript__message span { font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-faint); }
/* 消息正文按 markdown 渲染（2026-10-22 用户「md没渲染」）：产品同一套 markdown-it + DOMPurify，
   这里只补紧凑排版（控制台字号小、气泡内高度有限），不引入产品端的 16px github 版式。 */
.cp-transcript__content { font-size: var(--mk-fs-micro); line-height: 1.6; color: inherit; word-break: break-word; min-width: 0; }
.cp-transcript__content :deep(p) { margin: 0 0 6px; }
.cp-transcript__content :deep(p:last-child) { margin-bottom: 0; }
.cp-transcript__content :deep(pre) {
  margin: 6px 0; padding: 8px 10px; overflow-x: auto;
  background: var(--mk-surface); border: 1px solid var(--mk-line); border-radius: var(--mk-radius-sm);
}
.cp-transcript__content :deep(pre code) { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); white-space: pre; }
.cp-transcript__content :deep(code) { font-family: var(--mk-mono); font-size: 0.95em; }
.cp-transcript__content :deep(:not(pre) > code) {
  padding: 1px 4px; border-radius: var(--mk-radius-xs);
  background: color-mix(in srgb, var(--mk-ink) 8%, transparent);
}
.cp-transcript__content :deep(strong) { font-weight: 700; }
.cp-transcript__content :deep(ul), .cp-transcript__content :deep(ol) { margin: 4px 0; padding-left: 18px; }
.cp-transcript__content :deep(a) { color: var(--mk-blue); text-decoration: underline; }

/* 检查点（题目不走聊天逐字稿，单独渲染；2026-10-13 走查 lesson 13） */
.cp-checkpoints {
  display: grid; gap: 8px; margin-top: 10px; padding: 10px 12px;
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-sm); background: var(--mk-surface-2);
}
.cp-checkpoints__head { display: flex; align-items: baseline; gap: 8px; }
.cp-checkpoints__title { font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-ink); }
.cp-checkpoints__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.cp-checkpoint { display: grid; gap: 5px; padding-top: 8px; border-top: 1px solid var(--mk-line); }
.cp-checkpoint:first-of-type { padding-top: 0; border-top: none; }
.cp-checkpoint__q { margin: 0; font-size: var(--mk-fs-micro); line-height: 1.6; color: var(--mk-ink); word-break: break-word; }
.cp-checkpoint__meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cp-checkpoint__tag { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.cp-checkpoint__concept { font-size: var(--mk-fs-micro); color: var(--mk-accent-deep); }

/* Review */
.cp-review { display: grid; gap: 8px; padding: 8px 10px; border-radius: var(--mk-radius-sm); background: var(--mk-surface-2); }
.cp-review__badges { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.cp-review__badge { padding: 2px 9px; border-radius: 999px; font-size: var(--mk-fs-micro); font-weight: 800; background: var(--mk-surface-2); color: var(--mk-muted); }
.cp-review__badge[data-decision='accept'] { background: var(--mk-green-bg); color: var(--mk-green); }
.cp-review__badge[data-decision='modify'] { background: var(--mk-amber-bg); color: var(--mk-amber); }
.cp-review__badge[data-decision='reject'] { background: var(--mk-red-bg); color: var(--mk-red); }
.cp-review__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.cp-review__reaction { margin: 0; font-size: var(--mk-fs-micro); line-height: 1.6; white-space: pre-wrap; }
.cp-review__concern { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-amber-fill); }
.cp-review__changes { margin: 0; padding-left: 18px; display: grid; gap: 3px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.cp-review__replan { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-blue); }

/* ===== Learn 双栏：课程树 + 对话 =====
   课堂区高度（2026-10-19 用户「重新设计，课堂区域高度高一些」）：原两根 max-height 都是
   max(420px, calc(100dvh - 510px))——510 是照「从页面顶部往下还剩多少」估的，可课堂区在页面
   最下方，用户是滚到它才开始用：900/1000 高的视口里 100dvh-510 只有 390/490，被 420 下限吃掉，
   两列恒 420（实测 1440×900：grid 420 / 卡 472），而滚到那儿实际还有约 760 可用，下面空一大片。
   改按「滚到课堂区后还剩多少视口」这把尺子（对照：右侧 .cp-sidebar sticky top 84 +
   max-height calc(100vh - 100px) 是同一把）：下限 560 保证矮屏上仍是一块可用工作区，
   上限 1100 防 4K/超高的屏把整页撑成一张卡。两列同高（只给一处口径，避免再各写一半）——
   口径变量定义在页根 .cp，这里只消费。 */
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
  max-height: var(--cp-class-h);
  /* 嵌套滚动隔离（#72）：滚到底不把滚动链传给外层侧栏/页面 */
  overscroll-behavior: contain;
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
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  color: var(--mk-ink);
  background: var(--mk-surface-2);
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
  font-size: var(--mk-fs-micro);
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
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease, color 0.1s ease;
  border-left: 3px solid transparent;
}
.cp-learn-tree__lesson:hover:not(:disabled) { background: rgba(0,0,0,0.02); color: var(--mk-ink); }
.cp-learn-tree__lesson:disabled { opacity: 0.45; cursor: default; }
.cp-learn-tree__lesson.is-active { background: var(--mk-blue-bg); color: var(--mk-blue); border-left-color: var(--mk-blue); font-weight: 700; }
.cp-learn-tree__lesson.is-done { color: var(--mk-green); }
.cp-learn-tree__lesson.is-active.is-done { color: var(--mk-blue); }
/* pending（未开始）也可点击：悬停时提示可从此课开始 */
.cp-learn-tree__lesson.is-pending:hover { background: var(--mk-amber-bg); color: var(--mk-amber); }
.cp-learn-tree__mark { font-size: var(--mk-fs-micro); width: 14px; text-align: center; flex-shrink: 0; }
.cp-learn-tree__lesson.is-done .cp-learn-tree__mark { color: var(--mk-green); }
.cp-learn-tree__lesson.is-active .cp-learn-tree__mark { color: var(--mk-blue); }
.cp-learn-tree__num { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; flex-shrink: 0; }
.cp-learn-tree__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-learn-chat {
  padding: 12px 16px 16px;
  overflow-y: auto;
  /* 内滚动上限与左邻课树同一条口径（--cp-class-h，定义在页根 .cp）；
     无上限时对话列会长到 2000px+ 撑长整页（2026-10-12 走查）；嵌套滚动隔离（#72） */
  max-height: var(--cp-class-h);
  overscroll-behavior: contain;
  display: grid;
  /* 行轨显式 max-content：auto 轨按最小贡献定尺，课时总结卡（overflow:hidden 项的自动
     最小尺寸为 0）整行被压到 2px——「查看总结」后只见对话不见总结（2026-10-12 真机实测：
     默认 2px ↔ max-content 679px；判例同编排图 578aaff1 一族） */
  grid-auto-rows: max-content;
  gap: 10px;
  align-content: start;
}
@media (max-width: 900px) {
  .cp-learn-grid { grid-template-columns: 1fr; }
  .cp-learn-tree { border-right: none; border-bottom: 1px solid var(--mk-line); max-height: 200px; }
  .cp-learn-chat { max-height: 560px; }
  /* 阶段瓦片窄屏折行：4 枚并排会压字，改两行两列；chevron 是横向流水线语义，折行后撤掉 */
  .cp-stepper { flex-wrap: wrap; }
  .cp-stepper__arrow { display: none; }
  .cp-stp { flex: 1 1 calc(50% - 4px); }
}

/* Lesson head */
.cp-lesson-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 10px 12px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl); background: var(--mk-surface-2);
  margin-bottom: 10px;
}

/* ===== 课时总结卡片 ===== */
.cp-lesson-wrapup {
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface-2);
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
  background: var(--mk-green-bg);
  border-bottom: 1px solid var(--mk-line);
}
.cp-lesson-wrapup__badge {
  font-size: var(--mk-fs-body);
  font-weight: 800;
  color: var(--mk-green);
}
.cp-lesson-wrapup__badge.is-degraded { color: var(--mk-amber); }
.cp-lesson-wrapup.is-degraded .cp-lesson-wrapup__head {
  background: var(--mk-amber-bg);
  border-bottom-color: var(--mk-amber-bg);
}
.cp-lesson-wrapup__notice {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  color: var(--mk-amber);
  background: var(--mk-amber-bg);
}
.cp-lesson-wrapup__scores {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.cp-lesson-wrapup__score {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
  background: var(--mk-surface);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--mk-line);
}
.cp-lesson-wrapup__score--primary {
  color: var(--mk-blue);
  border-color: rgba(47, 106, 224, 0.3);
  background: var(--mk-blue-bg);
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
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  color: var(--mk-faint);
  letter-spacing: 0.04em;
  }
.cp-lesson-wrapup__text {
  margin: 0;
  font-size: var(--mk-fs-micro);
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
  font-size: var(--mk-fs-micro);
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
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  font-weight: 600;
}
.cp-lesson-wrapup__kp-status {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 999px;
}
.cp-lesson-wrapup__kp-status.is-mastered { background: var(--mk-green-bg); color: var(--mk-green); }
.cp-lesson-wrapup__kp-status.is-learning { background: var(--mk-blue-bg); color: var(--mk-blue); }
.cp-lesson-wrapup__kp-status.is-review { background: var(--mk-amber-bg); color: var(--mk-amber); }
.cp-lesson-wrapup__kp-unverified {
  font-size: var(--mk-fs-micro);
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--mk-surface-2);
  color: var(--mk-faint);
}
/* 进度条本体已走 .mk-minibar（尺寸/轨道/填充/暗色都在原语里），此处不再重写 */

/* 评估 */
.cp-lesson-wrapup__eval-item {
  display: grid;
  grid-template-columns: 50px 1fr;
  gap: 8px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  line-height: 1.5;
  align-items: start;
}
.cp-lesson-wrapup__eval-label {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 999px;
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
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  padding-top: 4px;
  border-top: 1px solid var(--mk-line);
}
.cp-lesson-head__main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.cp-lesson-head__main strong { font-size: var(--mk-fs-body); }
.cp-lesson-head__ms { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.cp-lesson-head__state { padding: 2px 9px; border-radius: 999px; font-size: var(--mk-fs-micro); font-weight: 800; background: var(--mk-surface-2); color: var(--mk-muted); }
.cp-lesson-head__state[data-state='done'] { background: var(--mk-green-bg); color: var(--mk-green); }
.cp-lesson-head__state[data-state='active'] { background: var(--mk-blue-bg); color: var(--mk-blue); }
.cp-lesson-head__state[data-state='failed'] { background: var(--mk-red-bg); color: var(--mk-red); }






/* ===== 总结页：单课总结手风琴（2026-10-12 二次拍板「总结就单独总结」；原课时进度树退役，
   课表归 Learn，本页只放总结） ===== */
.cp-wrapup-sums { display: grid; }
.cp-wrapup-sums__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 20px 6px;
  background: var(--mk-surface-2);
  border-bottom: 1px solid var(--mk-line);
}
.cp-wrapup-sums__title { font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-ink); }
.cp-wrapup-sums__meta { font-size: var(--mk-fs-micro); color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.cp-wrapup-sum + .cp-wrapup-sum { border-top: 1px solid var(--mk-line); }
.cp-wrapup-sum__row {
  /* 行即 button（键盘可达）：重置 button 默认外观 */
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 9px 20px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: var(--mk-fs-micro);
  text-align: left;
  color: var(--mk-muted);
  cursor: pointer;
  transition: background 0.1s ease;
}
.cp-wrapup-sum__row:hover { background: var(--mk-surface-2); }
.cp-wrapup-sum__row.is-open { color: var(--mk-ink); font-weight: 700; background: var(--mk-surface-2); }
.cp-wrapup-sum__mark { color: var(--mk-green); width: 14px; text-align: center; flex-shrink: 0; }
.cp-wrapup-sum__num { color: var(--mk-faint); font-weight: 600; flex-shrink: 0; }
.cp-wrapup-sum__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-wrapup-sum__caret { color: var(--mk-faint); flex-shrink: 0; }
.cp-wrapup-sum__body { padding: 12px 20px 14px; border-top: 1px dashed var(--mk-line); }
.cp-wrapup-sum__body .cp-lesson-wrapup { margin-bottom: 0; }
/* Learn 课表的只读行（真实会话）：不给"可点=可操作"的视觉暗示 */
.cp-learn-tree__lesson.is-readonly,
.cp-learn-tree__lesson.is-readonly:hover { cursor: default; background: transparent; }
.cp-wrapup-stats {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 16px 20px;
  background: var(--mk-surface-2);
  border-bottom: 1px solid var(--mk-line);
}
.cp-wrapup-stats__goal { display: grid; gap: 4px; min-width: 0; flex: 1 1 300px; }
.cp-wrapup-stats__label { font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em; }
.cp-wrapup-stats__goal strong { font-size: var(--mk-fs-body); color: var(--mk-ink); line-height: 1.4; }
.cp-wrapup-stats__badges { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cp-wrapup-stats__item { display: inline-flex; align-items: baseline; gap: 4px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.cp-wrapup-stats__item em { font-style: normal; font-weight: 800; font-size: var(--mk-fs-emphasis); color: var(--mk-blue); font-variant-numeric: tabular-nums; }

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
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface-2);
  transition: border-color 0.12s ease;
}
.cp-wrapup-card:hover { border-color: rgba(47, 106, 224, 0.25); }
.cp-wrapup-card__icon {
  /* 图标从 emoji 字（font-size 20px）改为 lucide 线性图标：色块尺寸不变，
     字色改蓝档（--mk-blue 压 --mk-blue-bg 实测 4.4:1，非文本图形需 3:1） */
  color: var(--mk-blue);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-blue-bg);
  flex-shrink: 0;
}
.cp-wrapup-card__body { display: grid; gap: 4px; min-width: 0; }
.cp-wrapup-card__label { font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em; }
.cp-wrapup-card__text { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-ink); line-height: 1.7; white-space: pre-wrap; word-break: break-word; }

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
  border-radius: var(--mk-radius-xl);
  background: var(--mk-table-head-bg);
}
.cp-wrapup-section__label { font-size: var(--mk-fs-micro); font-weight: 800; color: var(--mk-faint); letter-spacing: 0.04em; }
.cp-wrapup-section__text { margin: 0; font-size: var(--mk-fs-micro); line-height: 1.7; white-space: pre-wrap; color: var(--mk-ink); }
.cp-wrapup__json { margin: 0; font-size: var(--mk-fs-micro); line-height: 1.6; white-space: pre-wrap; word-break: break-word; font-family: var(--mk-mono); color: var(--mk-muted); max-height: 240px; overflow: auto; }

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
/* 会话数据包读数行（2026-10-18）：主列只放「这包数据里有什么」，JSON 进弹层 */
.cp-raw {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 12px; padding: 10px 14px;
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  font-size: var(--mk-fs-micro);
}
.cp-raw__title { color: var(--mk-ink); font-weight: 600; }
.cp-raw__facts { flex: 1; min-width: 200px; color: var(--mk-muted); }
.cp-raw__acts { display: flex; align-items: center; gap: 12px; }
.cp-rawview__head { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.cp-rawview__meta { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.cp-rawview__note { margin: 0 0 10px; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.cp-rawview__pre {
  margin: 0; padding: 12px; border-radius: var(--mk-radius-sm); background: var(--mk-code-bg); color: var(--mk-code-fg);
  font: 10.5px/1.6 var(--mk-mono); max-height: 56vh; overflow: auto; white-space: pre-wrap; word-break: break-all;
}

/* 终局评估样式已随裁判独立面移除（2026-09-27） */

/* ===== Trace panels ===== */
.cp-trace-panel {
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-sm); background: var(--mk-surface-2);
}
.cp-trace-panel > summary {
  list-style: none; cursor: pointer; padding: 8px 12px; display: flex; align-items: center;
  justify-content: space-between; gap: 8px; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); user-select: none;
}
.cp-trace-panel > summary::-webkit-details-marker { display: none; }
.cp-trace-panel > summary::before { content: '▸'; font-size: var(--mk-fs-micro); color: var(--mk-faint); margin-right: 4px; }
.cp-trace-panel[open] > summary::before { content: '▾'; }
.cp-trace-panel > summary code { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.cp-trace-list { list-style: none; margin: 0; padding: 0 12px 12px; max-height: 360px; overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 6px; }
.cp-trace-list > li { padding: 7px 10px; border: 1px solid var(--mk-line); border-radius: 6px; background: var(--mk-surface); display: grid; gap: 4px; }
.cp-trace-list__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); }
.cp-trace-list__seq { font-variant-numeric: tabular-nums; color: var(--mk-faint); font-weight: 700; }
.cp-trace-list__head time { color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.cp-trace-list__id { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.cp-trace-list__stage { padding: 1px 6px; border-radius: 999px; font-size: var(--mk-fs-micro); font-weight: 700; background: var(--mk-blue-bg); color: var(--mk-accent-deep); }
.cp-trace-list__stage[data-stage='learning'] { background: var(--mk-green-bg); color: #0a8551; }
.cp-trace-list__emotion, .cp-trace-list__transition { padding: 1px 7px; border-radius: 999px; font-size: var(--mk-fs-micro); background: var(--mk-surface-2); color: var(--mk-muted); }
.cp-trace-list__degraded { padding: 1px 7px; border-radius: 999px; font-size: var(--mk-fs-micro); background: var(--mk-red-bg); color: var(--mk-red); }
.cp-trace-list__focus, .cp-trace-list__reason { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.cp-trace-list__signal { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-style: italic; }
.cp-trace-list__metrics { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-trace-list__metrics > span { display: inline-flex; align-items: baseline; gap: 3px; padding: 1px 7px; background: var(--mk-surface-2); border-radius: 999px; font-size: var(--mk-fs-micro); }
.cp-trace-list__metrics code { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.cp-trace-list__metrics strong { font-variant-numeric: tabular-nums; color: var(--mk-ink); }
.cp-trace-list__kv { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-trace-list__kv > span { display: inline-flex; align-items: baseline; gap: 4px; padding: 1px 8px; border-radius: 999px; background: var(--mk-surface-2); font-size: var(--mk-fs-micro); max-width: 100%; }
.cp-trace-list__kv code { flex: 0 0 auto; color: var(--mk-faint); }
.cp-trace-list__kv strong { color: var(--mk-ink); font-weight: 600; word-break: break-all; }
.cp-trace-list__raw { font-size: var(--mk-fs-micro); }
.cp-trace-list__raw summary { cursor: pointer; color: var(--mk-faint); font-weight: 600; user-select: none; }
.cp-trace-list__raw .cp-trace-list__body { margin-top: 4px; }
.cp-trace-list__flags { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-trace-list__flags > span { padding: 1px 7px; border-radius: 999px; font-size: var(--mk-fs-micro); background: var(--mk-surface-2); color: var(--mk-faint); border: 1px solid transparent; }
.cp-trace-list__flags > span.active { background: var(--mk-blue-bg); color: #0958d9; border-color: #91caff; }
.cp-trace-list__blockers { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.cp-trace-list__blocker { padding: 1px 7px; background: var(--mk-amber-bg); color: var(--mk-amber); border-radius: 999px; }
.cp-trace-list__body { margin: 4px 0 0; padding: 6px 8px; background: var(--mk-surface-2); border-radius: 4px; font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow-y: auto; }

/* Timeline */
.cp-timeline__kind {
  padding: 1px 6px; border-radius: 999px; font-size: var(--mk-fs-micro); font-weight: 700; background: var(--mk-surface-2); color: var(--mk-muted); white-space: nowrap;
}
.cp-timeline__kind[data-kind='referee'] { background: var(--mk-red-bg); color: var(--mk-red-strong); }
.cp-timeline__kind[data-kind='private'] { background: #f5f3ff; color: #6d28d9; }
.cp-timeline__kind[data-kind='log'] { background: var(--mk-blue-bg); color: var(--mk-accent-deep); }
.cp-timeline__kind[data-kind='goal'] { background: #faf5ff; color: #7c3aed; }
.cp-timeline__kind[data-kind='path'] { background: var(--mk-amber-bg); color: #c2410c; }
.cp-timeline__kind[data-kind='teaching'] { background: var(--mk-green-bg); color: #0a8551; }
.cp-timeline__kind[data-kind='evidence'] { background: #ecfeff; color: #0e7490; }
.cp-timeline__stage { padding: 1px 6px; border-radius: 999px; font-size: var(--mk-fs-micro); font-weight: 700; background: var(--mk-blue-bg); color: var(--mk-accent-deep); white-space: nowrap; }
.cp-timeline__stage[data-stage='learning'], .cp-timeline__stage[data-stage='teaching'] { background: var(--mk-green-bg); color: #0a8551; }
.cp-timeline__stage[data-stage='goal'] { background: #faf5ff; color: #7c3aed; }
.cp-timeline__stage[data-stage='path'] { background: var(--mk-amber-bg); color: #c2410c; }
.cp-timeline__title { color: var(--mk-ink); font-weight: 600; word-break: break-word; }
.cp-timeline__detail { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; word-break: break-word; }

/* ===== Responsive ===== */
@media (max-width: 1100px) {
  .cp-body { grid-template-columns: 1fr; }
  .cp-sidebar { position: static; max-height: none; }
}
@media (min-width: 2000px) {
  .cp-body { grid-template-columns: minmax(0, 1fr) 380px; }

  .cp-stp__name { font-size: var(--mk-fs-body); }
  .cp-stp__meta { font-size: var(--mk-fs-micro); }
  .cp-btn { font-size: var(--mk-fs-body); padding: 9px 16px; }
  .cp-btn--sm { font-size: var(--mk-fs-micro); padding: 6px 12px; }
  .cp-none { font-size: var(--mk-fs-body); }
  .cp-sidebar__toggle { font-size: var(--mk-fs-body); }


  .cp-timeline__kind { font-size: var(--mk-fs-micro); }
  .cp-timeline__stage { font-size: var(--mk-fs-micro); }
  .cp-timeline__title { font-size: var(--mk-fs-micro); }
  .cp-timeline__detail { font-size: var(--mk-fs-micro); }
  .cp-log { font-size: var(--mk-fs-micro); }
  .cp-log__time { font-size: var(--mk-fs-micro); }
  .cp-log__phase { font-size: var(--mk-fs-micro); }
  .cp-log__dur { font-size: var(--mk-fs-micro); }
  .cp-transcript summary { font-size: var(--mk-fs-micro); }
  .cp-transcript__message span { font-size: var(--mk-fs-micro); }
  .cp-transcript__content { font-size: var(--mk-fs-micro); }
  .cp-review__badge { font-size: var(--mk-fs-micro); }
  .cp-review__meta { font-size: var(--mk-fs-micro); }
  .cp-review__reaction { font-size: var(--mk-fs-micro); }
  .cp-review__concern { font-size: var(--mk-fs-micro); }
  .cp-review__changes { font-size: var(--mk-fs-micro); }
  .cp-review__replan { font-size: var(--mk-fs-micro); }
  .cp-wrapup-card__label { font-size: var(--mk-fs-micro); }
  .cp-wrapup-card__text { font-size: var(--mk-fs-body); }
  .cp-wrapup-section__label { font-size: var(--mk-fs-micro); }
  .cp-wrapup-section__text { font-size: var(--mk-fs-body); }
  .cp-wrapup__json { font-size: var(--mk-fs-micro); }
  .cp-raw { font-size: var(--mk-fs-micro); }
  .cp-rawview__pre { font-size: var(--mk-fs-micro); }
  .cp-trace-panel > summary { font-size: var(--mk-fs-micro); }
  .cp-trace-panel > summary code { font-size: var(--mk-fs-micro); }
  .cp-trace-list__head { font-size: var(--mk-fs-micro); }
  .cp-trace-list__id { font-size: var(--mk-fs-micro); }
  .cp-trace-list__stage { font-size: var(--mk-fs-micro); }
  .cp-trace-list__emotion, .cp-trace-list__transition { font-size: var(--mk-fs-micro); }
  .cp-trace-list__degraded { font-size: var(--mk-fs-micro); }
  .cp-trace-list__focus, .cp-trace-list__reason { font-size: var(--mk-fs-micro); }
  .cp-trace-list__signal { font-size: var(--mk-fs-micro); }
  .cp-trace-list__metrics > span { font-size: var(--mk-fs-micro); }
  .cp-trace-list__metrics code { font-size: var(--mk-fs-micro); }
  .cp-trace-list__flags > span { font-size: var(--mk-fs-micro); }
  .cp-trace-list__blockers { font-size: var(--mk-fs-micro); }
  .cp-trace-list__body { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .cp-body { grid-template-columns: minmax(0, 1fr) 440px; }

  .cp-stp__name { font-size: var(--mk-fs-body); }
  .cp-stp__meta { font-size: var(--mk-fs-micro); }
  .cp-btn { font-size: var(--mk-fs-body); padding: 11px 20px; }
  .cp-btn--sm { font-size: var(--mk-fs-micro); padding: 7px 14px; }
  .cp-none { font-size: var(--mk-fs-body); }
  .cp-sidebar__toggle { font-size: var(--mk-fs-body); }


  .cp-timeline__kind { font-size: var(--mk-fs-micro); }
  .cp-timeline__stage { font-size: var(--mk-fs-micro); }
  .cp-timeline__title { font-size: var(--mk-fs-micro); }
  .cp-timeline__detail { font-size: var(--mk-fs-micro); }
  .cp-log { font-size: var(--mk-fs-micro); }
  .cp-log__time { font-size: var(--mk-fs-micro); }
  .cp-log__phase { font-size: var(--mk-fs-micro); }
  .cp-log__dur { font-size: var(--mk-fs-micro); }
  .cp-transcript summary { font-size: var(--mk-fs-micro); }
  .cp-transcript__message span { font-size: var(--mk-fs-micro); }
  .cp-transcript__content { font-size: var(--mk-fs-micro); }
  .cp-review__badge { font-size: var(--mk-fs-micro); }
  .cp-review__meta { font-size: var(--mk-fs-micro); }
  .cp-review__reaction { font-size: var(--mk-fs-micro); }
  .cp-review__concern { font-size: var(--mk-fs-micro); }
  .cp-review__changes { font-size: var(--mk-fs-micro); }
  .cp-review__replan { font-size: var(--mk-fs-micro); }
  .cp-wrapup-card__label { font-size: var(--mk-fs-micro); }
  .cp-wrapup-card__text { font-size: var(--mk-fs-body); }
  .cp-wrapup-section__label { font-size: var(--mk-fs-micro); }
  .cp-wrapup-section__text { font-size: var(--mk-fs-body); }
  .cp-wrapup__json { font-size: var(--mk-fs-micro); }
  .cp-raw { font-size: var(--mk-fs-micro); }
  .cp-rawview__pre { font-size: var(--mk-fs-micro); }
  .cp-trace-panel > summary { font-size: var(--mk-fs-micro); }
  .cp-trace-panel > summary code { font-size: var(--mk-fs-micro); }
  .cp-trace-list__head { font-size: var(--mk-fs-micro); }
  .cp-trace-list__id { font-size: var(--mk-fs-micro); }
  .cp-trace-list__stage { font-size: var(--mk-fs-micro); }
  .cp-trace-list__emotion, .cp-trace-list__transition { font-size: var(--mk-fs-micro); }
  .cp-trace-list__degraded { font-size: var(--mk-fs-micro); }
  .cp-trace-list__focus, .cp-trace-list__reason { font-size: var(--mk-fs-micro); }
  .cp-trace-list__signal { font-size: var(--mk-fs-micro); }
  .cp-trace-list__metrics > span { font-size: var(--mk-fs-micro); }
  .cp-trace-list__metrics code { font-size: var(--mk-fs-micro); }
  .cp-trace-list__flags > span { font-size: var(--mk-fs-micro); }
  .cp-trace-list__blockers { font-size: var(--mk-fs-micro); }
  .cp-trace-list__body { font-size: var(--mk-fs-micro); }
}

/* ================= 暗色模式（D1 补完）：会话座舱 ================= */
html[data-theme='dark'] {
  /* hover 补漏：rgba(0,0,0,0.02) 叠在暗色底上不可见，用与阶段步点同档的实色 */
  .cp-sidebar__toggle:hover { background: #252627; }
  .cp-learn-tree__lesson:hover:not(:disabled) { background: #252627; }
  /* 原型骨架补漏：stepper 瓦片在暗色下的底色（active 顶轨与实心步点走 --mk-*-fill，两主题通用）。
     同行原有的 .cp-loop__step--active 覆写随「教学闭环定位」卡一起下线（2026-10-19）。 */
  .cp-stp--active { background: color-mix(in srgb, var(--wf-color-primary) 14%, transparent); }
  .cp-stp--idle .cp-stp__dot { background: #19191a; }
  .cp-transcript__message { background: #19191a; border-left-color: #313235; }
  .cp-transcript__message.is-teacher { background: color-mix(in srgb, var(--wf-color-primary) 12%, transparent); border-left-color: var(--mk-blue); }
  .cp-transcript__message.is-learner { background: rgba(45, 212, 191, 0.1); border-left-color: var(--mk-teal); }
  .cp-review { background: #19191a; }
  .cp-review__badge, .cp-lesson-head__state { background: var(--mk-close-bg); }
  .cp-lesson-head__state[data-state='active'] { background: color-mix(in srgb, var(--wf-color-primary) 18%, transparent); color: var(--mk-accent-deep); }
  .cp-learn-tree__lesson.is-active { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--mk-accent-deep); border-left-color: var(--mk-blue); }
  .cp-learn-tree__lesson.is-pending:hover { background: rgba(251, 191, 36, 0.12); color: #fcd34d; }
  .cp-lesson-wrapup__kp-status.is-learning { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--mk-accent-deep); }





  .cp-log__phase { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--wf-color-primary-light); }
  /* 补漏：wrapup 分数/卡片/小节/trace 面板/时间线标签 */
  .cp-lesson-wrapup__score { background: #232325; color: var(--mk-muted); }
  .cp-lesson-wrapup__score--primary { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--mk-ghost-fg); }
  .cp-wrapup-card,
  .cp-wrapup-section,
  .cp-trace-panel { background: #19191a; border-color: var(--wf-border-light); }
  .cp-trace-list__body { background: #202122; }
  .cp-wrapup-sum__row.is-open { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--mk-ghost-fg); }
  .cp-wrapup-sum__row:hover { background: rgba(74, 222, 128, 0.1); }
  .cp-timeline__kind[data-kind='referee'] { background: color-mix(in srgb, var(--wf-color-danger) 14%, transparent); color: var(--wf-color-danger); }
  .cp-timeline__kind[data-kind='private'] { background: color-mix(in srgb, var(--mk-purple) 16%, transparent); color: var(--wf-color-accent-light); }
  .cp-timeline__kind[data-kind='log'] { background: rgba(129, 140, 248, 0.14); color: #a5b4fc; }
  .cp-timeline__kind[data-kind='goal'] { background: color-mix(in srgb, var(--mk-purple) 16%, transparent); color: var(--wf-color-accent-light); }
  .cp-timeline__kind[data-kind='path'] { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
  .cp-timeline__kind[data-kind='teaching'] { background: rgba(74, 222, 128, 0.14); color: var(--mk-btn-ok-fg); }
  .cp-timeline__kind[data-kind='evidence'] { background: color-mix(in srgb, var(--mk-teal) 14%, transparent); color: var(--mk-teal); }
  .cp-timeline__stage[data-stage='goal'] { background: color-mix(in srgb, var(--mk-purple) 16%, transparent); color: var(--wf-color-accent-light); }
  .cp-timeline__stage[data-stage='path'] { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }

  .cp-learn-tree__ms { background: #19191a; }
  .cp-lesson-head { background: #19191a; }
  .cp-wrapup-sums__head { background: #19191a; }
  .cp-wrapup-card__icon { background: #252627; }
  /* 补漏 2：课时总结渐变底/stats/骨架屏/eval/trace 徽章/预算条文字 */
  .cp-trace-list > li { background: #19191a; }
  .cp-timeline__kind { background: var(--mk-close-bg); }
  .cp-timeline__stage { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--mk-ghost-fg); }
  .cp-timeline__stage[data-stage='learning'],
  .cp-timeline__stage[data-stage='teaching'] { background: rgba(74, 222, 128, 0.14); color: var(--mk-btn-ok-fg); }
  .cp-trace-list__stage { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--mk-ghost-fg); }
  .cp-trace-list__stage[data-stage='learning'] { background: rgba(74, 222, 128, 0.14); color: var(--mk-btn-ok-fg); }
  .cp-trace-list__emotion,
  .cp-trace-list__transition { background: var(--mk-close-bg); color: var(--mk-ghost-fg); }
  .cp-trace-list__metrics > span,
  .cp-trace-list__kv > span { background: #232325; }
  .cp-trace-list__flags > span { background: var(--mk-close-bg); }
  .cp-trace-list__flags > span.active { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--mk-ghost-fg); border-color: color-mix(in srgb, var(--wf-color-primary) 45%, transparent); }
}
</style>
