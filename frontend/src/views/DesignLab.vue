<template>
  <section class="design-lab" :style="themeVars">
    <div class="design-lab__backdrop" aria-hidden="true">
      <div class="orb orb--one"></div>
      <div class="orb orb--two"></div>
    </div>

    <div class="design-lab__shell">
      <header class="panel hero-panel">
        <div class="hero-copy">
          <div class="hero-eyebrow">
            <span>WenFlow Design Lab</span>
            <span class="tiny-pill">独立实验页</span>
            <span class="tiny-pill">移动端优先</span>
          </div>
          <h1>教学与学习平台 UI 方案实验室</h1>
          <p>
            基于 `awesome-design-md` 的设计语言做二次筛选，抽出更适合问流的 4 套方向，
            单独展示学习端与管理端高频组件，不直接改动现有业务页面。
          </p>
          <div class="hero-links">
            <router-link to="/" class="solid-button">返回首页</router-link>
            <span class="hero-note">当前方案重点：{{ activeTheme.samplePage }}</span>
          </div>
        </div>

        <div class="hero-meta">
          <article class="mini-card">
            <span class="mini-card__label">研究基底</span>
            <strong>{{ activeTheme.source }}</strong>
            <p>{{ activeTheme.summary }}</p>
          </article>
          <article class="mini-card">
            <span class="mini-card__label">设计关键词</span>
            <div class="pill-grid">
              <span v-for="keyword in activeTheme.visualKeywords" :key="keyword" class="info-pill">
                {{ keyword }}
              </span>
            </div>
          </article>
        </div>
      </header>

      <section class="theme-tabs" aria-label="主题切换">
        <button
          v-for="theme in themes"
          :key="theme.id"
          type="button"
          class="theme-tab"
          :class="{ 'theme-tab--active': theme.id === activeThemeId }"
          :aria-pressed="theme.id === activeThemeId"
          @click="activeThemeId = theme.id"
        >
          <span class="theme-tab__badge">{{ theme.shortName }}</span>
          <strong>{{ theme.name }}</strong>
          <small>{{ theme.source }}</small>
        </button>
      </section>

      <section class="panel overview-panel">
        <div class="section-head">
          <div>
            <span class="section-kicker">Design Direction</span>
            <h2>{{ activeTheme.name }}</h2>
          </div>
          <span class="section-note">{{ activeTheme.samplePage }}</span>
        </div>

        <div class="overview-grid">
          <article class="detail-card">
            <h3>设计气质</h3>
            <p>{{ activeTheme.description }}</p>
            <div class="swatch-grid">
              <div v-for="swatch in activeTheme.swatches" :key="swatch.label" class="swatch-card">
                <span class="swatch-card__dot" :style="{ background: swatch.value }"></span>
                <div>
                  <strong>{{ swatch.label }}</strong>
                  <code>{{ swatch.value }}</code>
                </div>
              </div>
            </div>
          </article>

          <article class="detail-card">
            <h3>最适合的页面</h3>
            <div class="pill-grid pill-grid--tight">
              <span v-for="item in activeTheme.useCases" :key="item" class="info-pill">{{ item }}</span>
            </div>
            <h3>建议优先升级</h3>
            <ul class="simple-list">
              <li v-for="item in activeTheme.upgradeTargets" :key="item">{{ item }}</li>
            </ul>
          </article>

          <article class="detail-card">
            <h3>匹配度</h3>
            <div v-for="metric in ratingMetrics" :key="metric.key" class="rating-row">
              <div class="rating-row__meta">
                <span>{{ metric.label }}</span>
                <strong>{{ activeTheme.ratings[metric.key] }}/5</strong>
              </div>
              <div class="rating-row__track">
                <div class="rating-row__fill" :style="ratingStyle(activeTheme.ratings[metric.key])"></div>
              </div>
            </div>
            <h3>需要克制的点</h3>
            <ul class="simple-list simple-list--compact">
              <li v-for="item in activeTheme.avoid" :key="item">{{ item }}</li>
            </ul>
          </article>
        </div>
      </section>

      <section class="panel journey-panel">
        <div class="section-head section-head--compact">
          <div>
            <span class="section-kicker">Journey Sandbox</span>
            <h2>完整业务体验链</h2>
          </div>
          <span class="section-note">首页 -> 面板 -> 需求测 -> 路径测 -> 授课测 -> 评估测</span>
        </div>

        <div class="journey-nav">
          <a v-for="stage in flowStages" :key="stage.id" :href="`#${stage.id}`" class="journey-card">
            <span class="journey-card__index">{{ stage.index }}</span>
            <strong>{{ stage.title }}</strong>
            <p>{{ stage.desc }}</p>
          </a>
        </div>
      </section>

      <div class="business-flow-stack">
        <section id="flow-home" class="panel flow-stage" :class="`flow-stage--${activeTheme.id}`">
          <div class="flow-stage__header">
            <div>
              <span class="section-kicker">Home</span>
              <h2>首页体验</h2>
            </div>
            <span class="flow-stage__note">对应 `Home.vue`</span>
          </div>

          <div class="home-stage-layout">
            <article class="flow-primary-surface">
              <span class="hero-badge">学习入口重构</span>
              <h3>先让用户判断“这是不是适合我的学习方式”</h3>
              <p>
                首屏不只放品牌和 CTA，而是直接解释平台如何把真实问题拆成学习路径，
                让首页承担筛选与引导，而不是纯营销落地页。
              </p>
              <div class="pill-grid pill-grid--tight">
                <span v-for="item in homeMessages" :key="item" class="info-pill">{{ item }}</span>
              </div>
              <div class="button-row">
                <button type="button" class="solid-button">开始目标规划</button>
                <button type="button" class="ghost-button">先看路径样例</button>
              </div>
            </article>

            <div class="home-stage-side">
              <article v-for="item in homeFeatureCards" :key="item.title" class="flow-info-card">
                <span class="flow-info-card__eyebrow">{{ item.kicker }}</span>
                <strong>{{ item.title }}</strong>
                <p>{{ item.desc }}</p>
              </article>
            </div>
          </div>
        </section>

        <section id="flow-dashboard" class="panel flow-stage" :class="`flow-stage--${activeTheme.id}`">
          <div class="flow-stage__header">
            <div>
              <span class="section-kicker">Dashboard</span>
              <h2>面板体验</h2>
            </div>
            <span class="flow-stage__note">对应 `Dashboard.vue` / `LearningState.vue`</span>
          </div>

          <div class="dashboard-stage-layout">
            <div class="dashboard-stage-main">
              <div class="flow-stat-grid">
                <article v-for="item in dashboardStats" :key="item.label" class="flow-stat-card" :class="`flow-stat-card--${item.tone}`">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                  <small>{{ item.hint }}</small>
                </article>
              </div>

              <article class="flow-board">
                <div class="flow-board__head">
                  <div>
                    <span class="flow-info-card__eyebrow">Next Actions</span>
                    <h3>今天最值得推进的 3 件事</h3>
                  </div>
                  <span class="status-pill status-pill--primary">以行动优先</span>
                </div>
                <div class="flow-task-list">
                  <div v-for="task in dashboardTasks" :key="task.title" class="flow-task-row">
                    <div>
                      <strong>{{ task.title }}</strong>
                      <span>{{ task.desc }}</span>
                    </div>
                    <span class="status-pill" :class="`status-pill--${task.tone}`">{{ task.badge }}</span>
                  </div>
                </div>
              </article>
            </div>

            <div class="dashboard-stage-side">
              <article class="flow-info-card">
                <span class="flow-info-card__eyebrow">Learning Rhythm</span>
                <strong>当前节奏可继续，但建议保持 30-40 分钟的小步推进</strong>
                <p>面板右侧不只显示统计，而是给出节奏解释和动作建议，减少用户看完数据不知道怎么办的情况。</p>
              </article>
              <article class="flow-info-card flow-info-card--calendar">
                <span class="flow-info-card__eyebrow">Load Calendar</span>
                <div class="calendar-mini-grid">
                  <span v-for="day in dashboardCalendar" :key="day.label" :class="['calendar-dot', `calendar-dot--${day.tone}`]">{{ day.label }}</span>
                </div>
                <p>移动端这里会折成一行热力点，不强塞完整大日历。</p>
              </article>
            </div>
          </div>
        </section>

        <section id="flow-requirement" class="panel flow-stage" :class="`flow-stage--${activeTheme.id}`">
          <div class="flow-stage__header">
            <div>
              <span class="section-kicker">Requirement</span>
              <h2>需求测体验</h2>
            </div>
            <span class="flow-stage__note">对应 `GoalConversation.vue`</span>
          </div>

          <div class="requirement-stage-layout">
            <article class="flow-chat-card">
              <div class="flow-board__head">
                <div>
                  <span class="flow-info-card__eyebrow">Understanding Dialogue</span>
                  <h3>先对准真实问题，而不是泛泛而谈想学什么</h3>
                </div>
                <span class="status-pill status-pill--success">理解度 82%</span>
              </div>
              <div class="chat-stack">
                <article v-for="message in requirementMessages" :key="`${message.author}-${message.meta}`" class="message-row" :class="`message-row--${message.role}`">
                  <div class="message-avatar">{{ message.avatar }}</div>
                  <div class="message-bubble">
                    <div class="message-bubble__meta">
                      <strong>{{ message.author }}</strong>
                      <span>{{ message.meta }}</span>
                    </div>
                    <p>{{ message.content }}</p>
                  </div>
                </article>
              </div>
              <div class="mentor-reply-grid">
                <button v-for="item in requirementReplies" :key="item" type="button" class="reply-chip">{{ item }}</button>
              </div>
            </article>

            <aside class="flow-info-card flow-info-card--summary">
              <span class="flow-info-card__eyebrow">Requirement Snapshot</span>
              <div class="requirement-snapshot-grid">
                <div v-for="item in requirementSignals" :key="item.label" class="snapshot-item">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>
              <div class="pill-grid pill-grid--tight">
                <span v-for="tag in requirementConstraints" :key="tag" class="info-pill info-pill--ghost">{{ tag }}</span>
              </div>
              <div class="button-row">
                <button type="button" class="solid-button solid-button--small">确认方向</button>
                <button type="button" class="ghost-button ghost-button--small">再补充细节</button>
              </div>
            </aside>
          </div>
        </section>

        <section id="flow-path" class="panel flow-stage" :class="`flow-stage--${activeTheme.id}`">
          <div class="flow-stage__header">
            <div>
              <span class="section-kicker">Path</span>
              <h2>路径测体验</h2>
            </div>
            <span class="flow-stage__note">对应 `LearningPaths.vue` / `LearningPathDetail.vue`</span>
          </div>

          <div class="path-stage-layout">
            <article class="flow-primary-surface">
              <div class="flow-board__head">
                <div>
                  <span class="flow-info-card__eyebrow">Generated Learning Path</span>
                  <h3>把目标拆成阶段、任务和顺序依赖</h3>
                </div>
                <span class="status-pill status-pill--primary">已生成</span>
              </div>
              <div class="phase-grid">
                <article v-for="phase in pathPhases" :key="phase.title" class="phase-card">
                  <div class="phase-card__head">
                    <strong>{{ phase.title }}</strong>
                    <span class="status-pill" :class="`status-pill--${phase.tone}`">{{ phase.badge }}</span>
                  </div>
                  <p>{{ phase.desc }}</p>
                  <ul class="simple-list simple-list--compact">
                    <li v-for="task in phase.tasks" :key="task">{{ task }}</li>
                  </ul>
                </article>
              </div>
            </article>

            <div class="path-stage-side">
              <article class="flow-info-card">
                <span class="flow-info-card__eyebrow">生成状态</span>
                <div class="flow-task-list">
                  <div v-for="item in pathGenerationStates" :key="item.label" class="flow-task-row flow-task-row--compact">
                    <div>
                      <strong>{{ item.label }}</strong>
                      <span>{{ item.desc }}</span>
                    </div>
                    <span class="status-pill" :class="`status-pill--${item.tone}`">{{ item.status }}</span>
                  </div>
                </div>
              </article>
              <article class="flow-info-card">
                <span class="flow-info-card__eyebrow">路径建议</span>
                <ul class="simple-list">
                  <li v-for="item in pathRisks" :key="item">{{ item }}</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section id="flow-teaching" class="panel flow-stage" :class="`flow-stage--${activeTheme.id}`">
          <div class="flow-stage__header">
            <div>
              <span class="section-kicker">Teaching</span>
              <h2>授课测体验</h2>
            </div>
            <span class="flow-stage__note">对应 `LearningPage.vue`</span>
          </div>

          <div class="teaching-stage-layout">
            <aside class="teaching-knowledge-panel">
              <div class="flow-board__head">
                <div>
                  <span class="flow-info-card__eyebrow">Knowledge Progress</span>
                  <h3>知识点侧栏</h3>
                </div>
                <span class="status-pill status-pill--success">授课中</span>
              </div>
              <div class="teaching-kp-list">
                <div v-for="item in teachingKnowledgePoints" :key="item.title" class="teaching-kp-item">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.desc }}</span>
                </div>
              </div>
            </aside>

            <div class="teaching-chat-panel">
              <div class="teaching-session-bar">
                <strong>任务：异常处理与日志记录</strong>
                <div class="pill-grid pill-grid--tight">
                  <span class="status-pill status-pill--warning">阶段 2</span>
                  <span class="status-pill status-pill--accent">用时 18 分钟</span>
                </div>
              </div>

              <div class="chat-stack teaching-chat-stack">
                <article v-for="message in teachingMessages" :key="`${message.author}-${message.meta}`" class="message-row" :class="`message-row--${message.role}`">
                  <div class="message-avatar">{{ message.avatar }}</div>
                  <div class="message-bubble">
                    <div class="message-bubble__meta">
                      <strong>{{ message.author }}</strong>
                      <span>{{ message.meta }}</span>
                    </div>
                    <p>{{ message.content }}</p>
                  </div>
                </article>
              </div>

              <article class="teaching-check-card">
                <div class="flow-board__head">
                  <div>
                    <span class="flow-info-card__eyebrow">Understanding Check</span>
                    <h3>课堂检核题</h3>
                  </div>
                  <span class="status-pill status-pill--primary">单选题</span>
                </div>
                <div class="option-list">
                  <label v-for="option in teachingOptions" :key="option.label" class="option-item" :class="{ 'option-item--selected': option.selected }">
                    <span class="option-item__bullet">{{ option.label }}</span>
                    <span>{{ option.text }}</span>
                  </label>
                </div>
                <div class="button-row">
                  <button type="button" class="solid-button solid-button--small">提交回答</button>
                  <button type="button" class="ghost-button ghost-button--small">再听一遍解释</button>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section id="flow-evaluation" class="panel flow-stage" :class="`flow-stage--${activeTheme.id}`">
          <div class="flow-stage__header">
            <div>
              <span class="section-kicker">Evaluation</span>
              <h2>评估测体验</h2>
            </div>
            <span class="flow-stage__note">对应 `CompletionCard.vue` / 评估弹窗</span>
          </div>

          <div class="evaluation-stage-layout">
            <article class="flow-primary-surface">
              <div class="flow-board__head">
                <div>
                  <span class="flow-info-card__eyebrow">Learning Evaluation</span>
                  <h3>不是只告诉你结束了，而是解释你这节课学成了什么</h3>
                </div>
                <span class="status-pill status-pill--success">课程完成</span>
              </div>
              <div class="flow-stat-grid flow-stat-grid--evaluation">
                <article v-for="item in evaluationMetrics" :key="item.label" class="flow-stat-card" :class="`flow-stat-card--${item.tone}`">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                  <small>{{ item.hint }}</small>
                </article>
              </div>
              <article class="flow-board flow-board--dense">
                <div class="flow-board__head">
                  <div>
                    <span class="flow-info-card__eyebrow">Highlights</span>
                    <h3>本节亮点与改进</h3>
                  </div>
                </div>
                <div class="evaluation-two-col">
                  <div>
                    <strong>亮点</strong>
                    <ul class="simple-list simple-list--compact">
                      <li v-for="item in evaluationHighlights" :key="item">{{ item }}</li>
                    </ul>
                  </div>
                  <div>
                    <strong>下一步</strong>
                    <ul class="simple-list simple-list--compact">
                      <li v-for="item in evaluationPlan" :key="item">{{ item }}</li>
                    </ul>
                  </div>
                </div>
              </article>
            </article>

            <aside class="flow-info-card flow-info-card--summary">
              <span class="flow-info-card__eyebrow">Knowledge Evidence</span>
              <div class="evaluation-knowledge-list">
                <div v-for="item in evaluationKnowledge" :key="item.title" class="evaluation-knowledge-item">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.evidence }}</span>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>

      <section class="showcase-grid">
        <article class="panel preview-panel">
          <div class="section-head section-head--compact">
            <div>
              <span class="section-kicker">Learning Surface</span>
              <h2>重设计后的首页 / 学习台组件</h2>
            </div>
            <div class="pill-grid pill-grid--compact">
              <span v-for="target in previewTargets" :key="target" class="info-pill info-pill--ghost">{{ target }}</span>
            </div>
          </div>

          <template v-if="activeTheme.id === 'warm-mentor'">
            <div class="prototype-shell mentor-shell">
              <div class="prototype-intro">
                <span class="hero-badge">从横幅改成学习委托单</span>
                <h3>首页首屏不再只是 CTA，而是一张导师式问题澄清卡</h3>
                <p>重点从“点哪里”改成“你这次到底要解决什么”，更适合教学平台的启动语气。</p>
              </div>
              <div class="mentor-grid">
                <article class="mentor-note-card">
                  <div class="mentor-note-card__head">
                    <span class="status-pill status-pill--primary">导师摘要</span>
                    <span>今日学习委托</span>
                  </div>
                  <h3>把 Excel 周报自动化成一个可重复脚本</h3>
                  <p>不是从语法开始，而是先明确输入、输出、异常和真实使用频率。</p>
                  <div class="mentor-quote">
                    <strong>当前重点</strong>
                    <p>先带一份真实报表，让 AI 围绕它来拆解学习路径。</p>
                  </div>
                </article>

                <article class="mentor-checklist-card">
                  <h3>今天就做这 3 步</h3>
                  <ol class="ordered-list">
                    <li v-for="item in mentorSteps" :key="item">{{ item }}</li>
                  </ol>
                </article>

                <article class="mentor-focus-card">
                  <h3>最近阻塞点</h3>
                  <div class="focus-rows">
                    <div v-for="item in mentorFocus" :key="item.title" class="focus-row">
                      <strong>{{ item.title }}</strong>
                      <span>{{ item.desc }}</span>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </template>

          <template v-else-if="activeTheme.id === 'reading-focus'">
            <div class="prototype-shell reader-shell">
              <div class="prototype-intro">
                <span class="hero-badge">从卡片堆改成学习手册</span>
                <h3>路径详情更像一本课程手册，而不是碎片卡片列表</h3>
                <p>长内容用章节结构、旁注和行动区承载，适合长时间学习和复盘。</p>
              </div>
              <div class="reader-layout">
                <article class="reader-manuscript">
                  <div class="reader-manuscript__head">
                    <span class="status-pill status-pill--success">Learning Brief</span>
                    <span>45 分钟课程</span>
                  </div>
                  <h3>异常处理为什么是自动化脚本的分水岭</h3>
                  <p>会跑起来只是起点，真正可长期使用的脚本，一定要能解释失败并可追溯。</p>
                  <div class="reader-callout">
                    <strong>旁注</strong>
                    <p>这一页把背景、方法和迁移任务放进同一个阅读上下文，减少来回切换组件。</p>
                  </div>
                </article>
                <aside class="reader-rail">
                  <div class="reader-outline">
                    <div v-for="item in readerSections" :key="item.title" class="reader-outline__item">
                      <strong>{{ item.title }}</strong>
                      <span>{{ item.note }}</span>
                    </div>
                  </div>
                  <div class="reader-progress-card">
                    <span>当前推进</span>
                    <strong>第 2 / 4 节</strong>
                    <div class="progress-bar"><div class="progress-bar__fill" style="width: 52%"></div></div>
                  </div>
                </aside>
              </div>
            </div>
          </template>

          <template v-else-if="activeTheme.id === 'friendly-companion'">
            <div class="prototype-shell companion-shell">
              <div class="prototype-intro">
                <span class="hero-badge">从控制台改成陪练面板</span>
                <h3>学习台变成一个更有陪伴感的任务板，而不是冷冰冰的数据面板</h3>
                <p>把“继续学习”“今天任务”“即时反馈”放到同一视觉层，让新手更容易开始。</p>
              </div>
              <div class="companion-banner">
                <div>
                  <span class="status-pill status-pill--accent">今日小目标</span>
                  <h3>先完成一个 20 分钟任务，累积小胜利</h3>
                </div>
                <strong>连胜 6 天</strong>
              </div>
              <div class="companion-grid">
                <article v-for="item in companionCards" :key="item.title" class="companion-card">
                  <span class="companion-card__emoji">{{ item.emoji }}</span>
                  <div>
                    <strong>{{ item.title }}</strong>
                    <p>{{ item.desc }}</p>
                  </div>
                </article>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="prototype-shell ops-shell">
              <div class="prototype-intro">
                <span class="hero-badge">从学习台改成教研驾驶舱</span>
                <h3>信息密集页优先展示分诊、风险和推进，而不是通用欢迎区</h3>
                <p>适合后台、学习状态和运营面板，先告诉你哪里需要处理，再给操作入口。</p>
              </div>
              <div class="ops-strip">
                <article v-for="item in opsSignals" :key="item.label" class="ops-strip__card">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                  <small>{{ item.meta }}</small>
                </article>
              </div>
              <div class="ops-grid">
                <article class="ops-panel">
                  <h3>待分诊学习者</h3>
                  <div class="ops-list">
                    <div v-for="item in opsQueue" :key="item.name" class="ops-list__row">
                      <strong>{{ item.name }}</strong>
                      <span>{{ item.reason }}</span>
                    </div>
                  </div>
                </article>
                <article class="ops-panel">
                  <h3>当前路径健康度</h3>
                  <div class="ops-health-board">
                    <div v-for="item in opsHealth" :key="item.title" class="ops-health-board__cell">
                      <span>{{ item.title }}</span>
                      <strong>{{ item.value }}</strong>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </template>
        </article>

        <article class="panel preview-panel">
          <div class="section-head section-head--compact">
            <div>
              <span class="section-kicker">Conversation</span>
              <h2>重设计后的对话与学习交互</h2>
            </div>
            <span class="section-note">GoalConversation / LearningPage</span>
          </div>

          <template v-if="activeTheme.id === 'warm-mentor'">
            <div class="conversation-lab mentor-chat-lab">
              <div class="chat-stack">
                <article v-for="message in messages" :key="`${message.author}-${message.meta}`" class="message-row" :class="`message-row--${message.role}`">
                  <div class="message-avatar">{{ message.avatar }}</div>
                  <div class="message-bubble">
                    <div class="message-bubble__meta">
                      <strong>{{ message.author }}</strong>
                      <span>{{ message.meta }}</span>
                    </div>
                    <p>{{ message.content }}</p>
                  </div>
                </article>
              </div>
              <div class="mentor-reply-grid">
                <button v-for="item in mentorReplies" :key="item" type="button" class="reply-chip">{{ item }}</button>
              </div>
              <article class="reflection-card">
                <span class="status-pill status-pill--warning">课后反思入口</span>
                <p>你在这一步最大的困惑是什么？系统会把它记入下一次授课的开场问题。</p>
              </article>
            </div>
          </template>

          <template v-else-if="activeTheme.id === 'reading-focus'">
            <div class="conversation-lab reader-chat-lab">
              <article class="reader-lesson-card">
                <div class="reader-lesson-card__head">
                  <span class="status-pill status-pill--success">本节讲义</span>
                  <span>Lesson Note</span>
                </div>
                <h3>错误不是异常的对立面，而是异常处理的输入</h3>
                <p>解释块、例子块、迁移块直接并排组织，让用户边读边回答，而不是在消息流里来回找重点。</p>
              </article>
              <div class="reader-check-grid">
                <article v-for="item in readerChecks" :key="item.title" class="lesson-check-card">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.desc }}</span>
                </article>
              </div>
            </div>
          </template>

          <template v-else-if="activeTheme.id === 'friendly-companion'">
            <div class="conversation-lab companion-chat-lab">
              <div class="chat-stack">
                <article v-for="message in messages" :key="`${message.author}-${message.meta}`" class="message-row" :class="`message-row--${message.role}`">
                  <div class="message-avatar">{{ message.avatar }}</div>
                  <div class="message-bubble">
                    <div class="message-bubble__meta">
                      <strong>{{ message.author }}</strong>
                      <span>{{ message.meta }}</span>
                    </div>
                    <p>{{ message.content }}</p>
                  </div>
                </article>
              </div>
              <div class="quest-grid">
                <article v-for="item in companionQuests" :key="item.title" class="quest-card">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.desc }}</span>
                </article>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="conversation-lab ops-chat-lab">
              <div class="ops-context-grid">
                <article class="ops-context-card">
                  <span class="status-pill status-pill--primary">教学提示</span>
                  <div class="ops-list">
                    <div v-for="item in opsTeachingHints" :key="item" class="ops-list__row">
                      <strong>{{ item }}</strong>
                    </div>
                  </div>
                </article>
                <article class="ops-context-card">
                  <span class="status-pill status-pill--accent">事件时间线</span>
                  <div class="timeline-list">
                    <div v-for="item in opsTimeline" :key="item.time" class="timeline-list__row">
                      <strong>{{ item.time }}</strong>
                      <span>{{ item.desc }}</span>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </template>
        </article>
      </section>

      <section class="showcase-grid showcase-grid--second">
        <article class="panel preview-panel">
          <div class="section-head section-head--compact">
            <div>
              <span class="section-kicker">Completion</span>
              <h2>课程完成总结</h2>
            </div>
            <span class="status-pill status-pill--success">完成评估</span>
          </div>

          <div class="summary-grid">
            <div v-for="item in completionStats" :key="item.label" class="summary-chip-card">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>

          <div class="completion-layout">
            <article class="completion-block">
              <h3>关键收获</h3>
              <ol class="ordered-list">
                <li v-for="item in completionTakeaways" :key="item">{{ item }}</li>
              </ol>
            </article>
            <article class="completion-block">
              <h3>下一步行动</h3>
              <ul class="simple-list">
                <li v-for="item in completionActions" :key="item">{{ item }}</li>
              </ul>
            </article>
          </div>
        </article>

        <article class="panel preview-panel">
          <div class="section-head section-head--compact">
            <div>
              <span class="section-kicker">Admin / Ops</span>
              <h2>后台表格与移动端卡片</h2>
            </div>
            <span class="section-note">Users / Overview / Agent 配置</span>
          </div>

          <div class="toolbar-preview">
            <div class="toolbar-input">搜索用户 / 路径 / Agent</div>
            <div class="button-row button-row--end">
              <button type="button" class="ghost-button ghost-button--small">筛选条件</button>
              <button type="button" class="solid-button solid-button--small">新建配置</button>
            </div>
          </div>

          <div class="table-shell table-shell--desktop">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>学习路径</th>
                  <th>状态</th>
                  <th>最近活跃</th>
                  <th>风险</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in adminRows" :key="row.name">
                  <td>
                    <div class="table-user">
                      <span class="table-user__avatar">{{ row.avatar }}</span>
                      <div>
                        <strong>{{ row.name }}</strong>
                        <span>{{ row.email }}</span>
                      </div>
                    </div>
                  </td>
                  <td>{{ row.track }}</td>
                  <td><span class="status-pill" :class="`status-pill--${row.stateTone}`">{{ row.state }}</span></td>
                  <td>{{ row.lastSeen }}</td>
                  <td><span class="status-pill" :class="`status-pill--${row.riskTone}`">{{ row.risk }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="table-shell table-shell--mobile">
            <article v-for="row in adminRows" :key="`${row.name}-mobile`" class="mobile-admin-card">
              <div class="mobile-admin-card__head">
                <div class="table-user">
                  <span class="table-user__avatar">{{ row.avatar }}</span>
                  <div>
                    <strong>{{ row.name }}</strong>
                    <span>{{ row.email }}</span>
                  </div>
                </div>
                <span class="status-pill" :class="`status-pill--${row.stateTone}`">{{ row.state }}</span>
              </div>
              <div class="mobile-admin-card__grid">
                <div>
                  <span>学习路径</span>
                  <strong>{{ row.track }}</strong>
                </div>
                <div>
                  <span>最近活跃</span>
                  <strong>{{ row.lastSeen }}</strong>
                </div>
                <div>
                  <span>风险</span>
                  <strong>{{ row.risk }}</strong>
                </div>
              </div>
            </article>
          </div>
        </article>
      </section>

      <section class="showcase-grid showcase-grid--mobile">
        <article class="panel preview-panel">
          <div class="section-head section-head--compact">
            <div>
              <span class="section-kicker">Mobile First</span>
              <h2>移动端样例</h2>
            </div>
            <span class="section-note">360px / 390px / 768px 优先</span>
          </div>

          <div class="phone-frame">
            <div class="phone-screen">
              <div class="phone-topbar">
                <span>问流</span>
                <span>{{ activeTheme.shortName }}</span>
              </div>
              <div class="phone-hero">
                <span class="hero-badge">继续学习</span>
                <h3>今天先完成一个 20 分钟小任务</h3>
                <p>移动端第一屏优先展示“下一步该做什么”，而不是大统计面板。</p>
              </div>
              <div class="phone-card-list">
                <article class="phone-card">
                  <span>当前路径</span>
                  <strong>Python 自动化提效</strong>
                  <small>下一步：异常处理与日志记录</small>
                </article>
                <article class="phone-card phone-card--chat">
                  <div class="phone-chat-bubble">先告诉我你要自动化的真实流程，我来帮你拆任务。</div>
                  <div class="phone-chat-bubble phone-chat-bubble--user">我每周都要整理 Excel 报表。</div>
                </article>
              </div>
              <button type="button" class="solid-button solid-button--wide">继续学习</button>
            </div>
          </div>
        </article>

        <article class="panel preview-panel">
          <div class="section-head section-head--compact">
            <div>
              <span class="section-kicker">Mobile Strategy</span>
              <h2>适配原则</h2>
            </div>
          </div>

          <div class="completion-layout">
            <article class="completion-block">
              <h3>建议保留</h3>
              <div class="pill-grid pill-grid--tight">
                <span v-for="item in activeTheme.keepOnMobile" :key="item" class="info-pill">{{ item }}</span>
              </div>
            </article>
            <article class="completion-block">
              <h3>建议收起</h3>
              <div class="pill-grid pill-grid--tight">
                <span v-for="item in activeTheme.collapseOnMobile" :key="item" class="info-pill info-pill--ghost">{{ item }}</span>
              </div>
            </article>
          </div>

          <article class="completion-block completion-block--full">
            <h3>当前方案的移动端原则</h3>
            <ul class="simple-list">
              <li v-for="item in activeTheme.mobileStrategies" :key="item">{{ item }}</li>
            </ul>
          </article>
        </article>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type RatingKey = 'conversation' | 'reading' | 'onboarding' | 'ops' | 'mobile';
type Tone = 'primary' | 'success' | 'warning' | 'accent' | 'danger';

interface ThemeSwatch {
  label: string;
  value: string;
}

interface ThemeColors {
  canvas: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  chipBg: string;
  navBg: string;
  panelTint: string;
  userBubble: string;
  aiBubble: string;
  track: string;
}

interface LabTheme {
  id: string;
  name: string;
  shortName: string;
  source: string;
  summary: string;
  description: string;
  samplePage: string;
  visualKeywords: string[];
  useCases: string[];
  upgradeTargets: string[];
  avoid: string[];
  mobileStrategies: string[];
  keepOnMobile: string[];
  collapseOnMobile: string[];
  ratings: Record<RatingKey, number>;
  swatches: ThemeSwatch[];
  colors: ThemeColors;
  fonts: {
    display: string;
    body: string;
  };
  radii: {
    card: string;
    pill: string;
  };
  heroGradient: string;
  shadow: string;
}

const themes: LabTheme[] = [
  {
    id: 'warm-mentor',
    name: '温润导师风',
    shortName: 'Mentor',
    source: 'Claude + Notion',
    summary: '更适合问题澄清、AI 规划和陪伴式学习对话。',
    description:
      '用暖米色、陶土强调和柔和的编辑感排版，削弱工具面板的生硬感，强化被理解和被陪伴的学习体验。',
    samplePage: 'GoalConversation / LearningPage',
    visualKeywords: ['陪伴感', '低压', '编辑感', '反思导向'],
    useCases: ['AI 规划页', '学习对话页', '课程完成总结', '新手引导'],
    upgradeTargets: ['聊天气泡层级', '完成总结模块', '首页文案节奏', '知识点卡动作区'],
    avoid: ['后台表格不要过度柔化', '信息密集页不要堆太多暖色块', '不要让按钮像营销页 CTA'],
    mobileStrategies: ['对话页优先保留消息流和底部输入区', '知识点面板折叠为抽屉或可展开卡片', '首页首屏只保留一个主行动按钮'],
    keepOnMobile: ['下一步任务', '主 CTA', '当前知识点', '输入区'],
    collapseOnMobile: ['大型统计面板', '次要筛选器', '多列路径信息'],
    ratings: { conversation: 5, reading: 4, onboarding: 4, ops: 3, mobile: 5 },
    swatches: [
      { label: 'Canvas', value: '#f6f0e7' },
      { label: 'Primary', value: '#b76547' },
      { label: 'Accent', value: '#e1a75a' },
      { label: 'Surface', value: '#fffaf3' }
    ],
    colors: {
      canvas: '#f6f0e7',
      surface: '#fffaf3',
      surfaceAlt: '#efe3d2',
      border: '#dbc8b3',
      text: '#34261d',
      muted: '#7d6654',
      primary: '#b76547',
      secondary: '#8d7059',
      accent: '#e1a75a',
      success: '#4f8f6a',
      warning: '#cb8a2b',
      danger: '#c15a52',
      chipBg: 'rgba(183, 101, 71, 0.14)',
      navBg: 'rgba(255, 250, 243, 0.88)',
      panelTint: 'rgba(255, 245, 235, 0.92)',
      userBubble: '#483129',
      aiBubble: '#f2e6d6',
      track: '#ead9c7'
    },
    fonts: {
      display: '"Source Serif 4", "Noto Serif SC", serif',
      body: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
    },
    radii: { card: '28px', pill: '999px' },
    heroGradient: 'linear-gradient(135deg, rgba(183, 101, 71, 0.22), rgba(225, 167, 90, 0.12))',
    shadow: '0 28px 80px rgba(103, 66, 40, 0.14)'
  },
  {
    id: 'reading-focus',
    name: '阅读专注风',
    shortName: 'Reader',
    source: 'Mintlify + Apple',
    summary: '更适合课程阅读、路径详情和长时间学习内容承载。',
    description:
      '通过更干净的留白、稳态绿色强调和更克制的阴影，把长内容阅读压力降下来，让学习页更接近一份可持续阅读的学习手册。',
    samplePage: 'LearningPathDetail / CompletionCard',
    visualKeywords: ['阅读优化', '安静', '清爽', '耐看'],
    useCases: ['学习路径详情', '课程内容页', '完成总结', '学习状态总览'],
    upgradeTargets: ['路径详情标题区', '长内容排版', '状态卡信息层级', '完成报告阅读体验'],
    avoid: ['不要把首页做得太冷', '不要让 AI 对话页像纯文档', '过多浅色块会削弱重点层次'],
    mobileStrategies: ['学习内容保持单列阅读，避免左右分栏', '章节导航做横向滑动 chips', '统计卡优先展示结论，再展示细指标'],
    keepOnMobile: ['当前学习任务', '阅读正文', '进度反馈', '行动建议'],
    collapseOnMobile: ['装饰性插图', '大面积数据矩阵', '复杂二级操作栏'],
    ratings: { conversation: 4, reading: 5, onboarding: 4, ops: 4, mobile: 5 },
    swatches: [
      { label: 'Canvas', value: '#f5f8f6' },
      { label: 'Primary', value: '#237a57' },
      { label: 'Accent', value: '#87a7db' },
      { label: 'Surface', value: '#ffffff' }
    ],
    colors: {
      canvas: '#f5f8f6',
      surface: '#ffffff',
      surfaceAlt: '#edf5f0',
      border: '#d8e6dc',
      text: '#132016',
      muted: '#607066',
      primary: '#237a57',
      secondary: '#2d9178',
      accent: '#87a7db',
      success: '#1f8a60',
      warning: '#c27b2f',
      danger: '#bc5c4d',
      chipBg: 'rgba(35, 122, 87, 0.12)',
      navBg: 'rgba(255, 255, 255, 0.84)',
      panelTint: 'rgba(249, 252, 250, 0.92)',
      userBubble: '#1f3d2f',
      aiBubble: '#eef5f0',
      track: '#deebe3'
    },
    fonts: {
      display: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
      body: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
    },
    radii: { card: '24px', pill: '999px' },
    heroGradient: 'linear-gradient(135deg, rgba(35, 122, 87, 0.18), rgba(135, 167, 219, 0.10))',
    shadow: '0 24px 64px rgba(34, 73, 51, 0.10)'
  },
  {
    id: 'friendly-companion',
    name: '友好陪伴风',
    shortName: 'Companion',
    source: 'Intercom + Airtable',
    summary: '更适合新手引导、Dashboard、任务卡和成就反馈。',
    description:
      '用更友好的蓝色系统、彩色状态标签和更圆润的卡片，降低平台的专业门槛感，让新用户更愿意迈出第一步。',
    samplePage: 'Home / Dashboard / Achievements',
    visualKeywords: ['亲和', '轻快', '任务感', '彩色状态'],
    useCases: ['首页首屏', 'Dashboard 欢迎区', '成就页', '新手任务条'],
    upgradeTargets: ['欢迎区 CTA', '任务卡层级', '成就与反馈提示', '移动端首屏入口'],
    avoid: ['不要让严肃学习页过度玩具化', '表格区不要颜色过多', '成就色和彩色标签要节制'],
    mobileStrategies: ['把欢迎区、下一步任务、最近学习排列成可滑动卡片', '按钮与标签使用更大触控面积', '任务与提醒统一堆叠在首屏'],
    keepOnMobile: ['今日任务', '继续学习按钮', '成就反馈', '路径概览'],
    collapseOnMobile: ['次要营销文案', '过宽横向表格', '二级入口群'],
    ratings: { conversation: 5, reading: 3, onboarding: 5, ops: 4, mobile: 5 },
    swatches: [
      { label: 'Canvas', value: '#eef5ff' },
      { label: 'Primary', value: '#2668ff' },
      { label: 'Accent', value: '#7c5cff' },
      { label: 'Surface', value: '#ffffff' }
    ],
    colors: {
      canvas: '#eef5ff',
      surface: '#ffffff',
      surfaceAlt: '#e5efff',
      border: '#cad8ef',
      text: '#19304d',
      muted: '#617796',
      primary: '#2668ff',
      secondary: '#22a4d8',
      accent: '#7c5cff',
      success: '#28a965',
      warning: '#ef9f38',
      danger: '#ee6b6e',
      chipBg: 'rgba(38, 104, 255, 0.12)',
      navBg: 'rgba(255, 255, 255, 0.88)',
      panelTint: 'rgba(247, 250, 255, 0.94)',
      userBubble: '#2668ff',
      aiBubble: '#edf4ff',
      track: '#dae5fa'
    },
    fonts: {
      display: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
      body: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
    },
    radii: { card: '30px', pill: '999px' },
    heroGradient: 'linear-gradient(135deg, rgba(38, 104, 255, 0.22), rgba(124, 92, 255, 0.10))',
    shadow: '0 30px 84px rgba(40, 90, 186, 0.14)'
  },
  {
    id: 'structured-ops',
    name: '结构教研风',
    shortName: 'Ops',
    source: 'IBM + Linear',
    summary: '更适合学习状态、数据面板、后台运维与配置页面。',
    description:
      '采用更明确的网格、蓝灰基底和克制的紫色强调，让复杂信息更规整，适合系统配置、指标对比和表格密集型界面。',
    samplePage: 'Admin Overview / Users / LearningState',
    visualKeywords: ['结构化', '理性', '专业', '低噪音'],
    useCases: ['管理后台', '学习状态页', 'Agent 配置页', '系统日志与表格'],
    upgradeTargets: ['后台导航', '表格行状态', '过滤器工具栏', '状态指标卡'],
    avoid: ['首页不要直接套成后台', '学习对话页不要过于冷硬', '品牌感不能被数据感完全吞掉'],
    mobileStrategies: ['后台表格改为信息卡片列表', '多筛选器折叠到抽屉', '数据卡片先显示结论与异常，再显示详细指标'],
    keepOnMobile: ['异常提醒', '关键指标', '主要筛选', '主操作按钮'],
    collapseOnMobile: ['完整表格列', '横向二级导航', '低价值解释文案'],
    ratings: { conversation: 3, reading: 4, onboarding: 3, ops: 5, mobile: 4 },
    swatches: [
      { label: 'Canvas', value: '#0f1624' },
      { label: 'Primary', value: '#79a6ff' },
      { label: 'Accent', value: '#9b7bff' },
      { label: 'Surface', value: '#131d31' }
    ],
    colors: {
      canvas: '#0f1624',
      surface: '#131d31',
      surfaceAlt: '#18243b',
      border: '#25324b',
      text: '#e8eefc',
      muted: '#93a4c4',
      primary: '#79a6ff',
      secondary: '#5cc8ff',
      accent: '#9b7bff',
      success: '#42c58f',
      warning: '#f2b25b',
      danger: '#f07a8a',
      chipBg: 'rgba(121, 166, 255, 0.14)',
      navBg: 'rgba(19, 29, 49, 0.88)',
      panelTint: 'rgba(19, 29, 49, 0.94)',
      userBubble: '#2a3d63',
      aiBubble: '#18243b',
      track: '#2a3551'
    },
    fonts: {
      display: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
      body: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
    },
    radii: { card: '22px', pill: '999px' },
    heroGradient: 'linear-gradient(135deg, rgba(121, 166, 255, 0.18), rgba(155, 123, 255, 0.12))',
    shadow: '0 28px 80px rgba(2, 8, 20, 0.42)'
  }
];

const activeThemeId = ref(themes[0].id);
const activeTheme = computed(() => themes.find((theme) => theme.id === activeThemeId.value) ?? themes[0]);

const ratingMetrics: Array<{ key: RatingKey; label: string }> = [
  { key: 'conversation', label: '对话陪伴' },
  { key: 'reading', label: '长文阅读' },
  { key: 'onboarding', label: '新手引导' },
  { key: 'ops', label: '后台结构' },
  { key: 'mobile', label: '移动适配' }
];

const previewTargets = ['导航', '欢迎卡', '路径卡', '聊天气泡', '题目卡', '知识点卡'];

const flowStages = [
  { id: 'flow-home', index: '01', title: '首页', desc: '解释平台方法论与进入方式' },
  { id: 'flow-dashboard', index: '02', title: '面板', desc: '展示今日推进、状态和下一步' },
  { id: 'flow-requirement', index: '03', title: '需求测', desc: '用对话澄清真实问题和约束' },
  { id: 'flow-path', index: '04', title: '路径测', desc: '生成阶段、任务、依赖与风险' },
  { id: 'flow-teaching', index: '05', title: '授课测', desc: '课堂、知识点、检核题与互动' },
  { id: 'flow-evaluation', index: '06', title: '评估测', desc: '解释掌握情况、亮点和下步计划' }
];

const homeMessages = ['问题先行', 'AI 规划', '对话学习', '状态追踪'];

const homeFeatureCards = [
  { kicker: 'Why WenFlow', title: '先想清要解决什么', desc: '首页第一屏直接告诉用户平台如何从真实问题切入。' },
  { kicker: 'Entry Choice', title: '不是所有人都要立刻注册', desc: '允许先浏览学习路径样例，再决定是否开始规划。' },
  { kicker: 'Education Tone', title: '像导师，不像工具商店', desc: '减少入口堆叠，避免首页变成功能导航集合。' }
];

const dashboardStats = [
  { label: '今日任务', value: '3 项', hint: '按优先级排序', tone: 'primary' as Tone },
  { label: '连续学习', value: '6 天', hint: '建议保持轻节奏', tone: 'success' as Tone },
  { label: '当前路径', value: '2 条', hint: '一主一辅更合理', tone: 'accent' as Tone },
  { label: '学习状态', value: 'LSB +2.1', hint: '尚可继续推进', tone: 'warning' as Tone }
];

const dashboardTasks = [
  { title: '继续异常处理任务', desc: '完成日志输出与错误捕获最小闭环', badge: '高优先', tone: 'primary' as Tone },
  { title: '复盘上一节困惑', desc: '把没懂的地方整理成下一次开场问题', badge: '复盘', tone: 'accent' as Tone },
  { title: '做 1 道检核题', desc: '确认是否真的理解而不是看懂了', badge: '检核', tone: 'success' as Tone }
];

const dashboardCalendar = [
  { label: '一', tone: 'success' },
  { label: '二', tone: 'success' },
  { label: '三', tone: 'warning' },
  { label: '四', tone: 'primary' },
  { label: '五', tone: 'accent' },
  { label: '六', tone: 'danger' },
  { label: '日', tone: 'primary' }
];

const requirementMessages = [
  { role: 'ai' as const, avatar: 'AI', author: 'AI 规划师', meta: '刚刚', content: '你不是单纯想学 Python，而是想解决每周手工整理报表的重复劳动，对吗？' },
  { role: 'user' as const, avatar: '你', author: '你', meta: '刚刚', content: '对，我真正想解决的是这件事，不是泛泛地学编程。' },
  { role: 'ai' as const, avatar: 'AI', author: 'AI 规划师', meta: '现在', content: '那我会围绕输入文件、清洗逻辑、异常场景和输出格式来拆目标。' }
];

const requirementReplies = ['对，这就是核心问题', '我还有时间限制', '我担心自己坚持不下去'];

const requirementSignals = [
  { label: '真实问题', value: '周报自动化' },
  { label: '当前水平', value: '零散入门' },
  { label: '期望周期', value: '3 周见效' },
  { label: '阻碍', value: '时间碎片化' }
];

const requirementConstraints = ['每周只有 3 次学习窗口', '希望围绕真实 Excel 文件', '不想先学太多抽象语法'];

const pathPhases = [
  {
    title: '阶段 1：看懂输入与输出',
    badge: '起步',
    tone: 'primary' as Tone,
    desc: '先把真实文件结构、目标结果和基本处理路径对齐。',
    tasks: ['读取 Excel/CSV', '识别关键字段', '定义输出格式']
  },
  {
    title: '阶段 2：让脚本稳定运行',
    badge: '核心',
    tone: 'success' as Tone,
    desc: '开始加入异常处理和日志，让它不只是能跑一次。',
    tasks: ['异常处理', '日志记录', '失败回溯']
  },
  {
    title: '阶段 3：嵌入真实流程',
    badge: '迁移',
    tone: 'accent' as Tone,
    desc: '让脚本进入你的每周工作流，而不是停留在练习环境。',
    tasks: ['批量处理', '输出归档', '流程复盘']
  }
];

const pathGenerationStates = [
  { label: '问题理解', desc: '已稳定收敛到真实业务问题', status: '完成', tone: 'success' as Tone },
  { label: '路径生成', desc: '阶段拆解与依赖关系已建立', status: '完成', tone: 'success' as Tone },
  { label: '风险标注', desc: '识别出时间碎片化与复盘缺失', status: '提醒', tone: 'warning' as Tone }
];

const pathRisks = [
  '如果任务粒度太大，用户会再次回到“想学很多但推进不了”。',
  '路径页需要明确主路径与次路径，避免同时推进过多方向。',
  '移动端里阶段卡必须可折叠，否则会太长。'
];

const teachingKnowledgePoints = [
  { title: 'try / except', desc: '知道错误被捕获后要做什么' },
  { title: '日志输出', desc: '让失败具备可解释性与可回看性' },
  { title: '场景迁移', desc: '把课堂知识放回真实报表流程中' }
];

const teachingMessages = [
  { role: 'ai' as const, avatar: '教', author: 'AI 讲解助手', meta: '授课中', content: '如果脚本遇到空值直接报错，你希望它停止，还是继续处理并记录问题？' },
  { role: 'user' as const, avatar: '你', author: '你', meta: '刚刚', content: '我更希望它继续，但要把出错行记下来。' },
  { role: 'ai' as const, avatar: '教', author: 'AI 讲解助手', meta: '现在', content: '这就是为什么日志和异常处理要一起讲，因为你要的是可继续执行的流程。' }
];

const teachingOptions = [
  { label: 'A', text: '遇到异常时让程序静默跳过，不做记录', selected: false },
  { label: 'B', text: '遇到异常时记录日志，并继续处理后续数据', selected: true },
  { label: 'C', text: '删除异常数据，避免影响脚本运行', selected: false }
];

const evaluationMetrics = [
  { label: '本节掌握增量', value: '+6.8', hint: '理解提升明显', tone: 'success' as Tone },
  { label: '学习压力', value: '3.2', hint: '仍在可接受范围', tone: 'warning' as Tone },
  { label: '疲劳变化', value: '2.1', hint: '建议保持轻量', tone: 'accent' as Tone },
  { label: '长期收益', value: 'KTL 61', hint: '已形成稳定积累', tone: 'primary' as Tone }
];

const evaluationHighlights = [
  '已经能把“想学技术”收敛成具体工作任务。',
  '对异常处理的理解不再停留在语法，而是能说出使用目的。',
  '愿意围绕真实数据继续练，迁移概率更高。'
];

const evaluationPlan = [
  '下一节直接围绕真实 Excel 文件做一次完整演练。',
  '先保持小任务节奏，不要一次扩到太多自动化功能。',
  '继续记录失败原因，建立自己的日志模板。'
];

const evaluationKnowledge = [
  { title: '异常处理', evidence: '能够说明为什么不能只让程序报错退出。' },
  { title: '日志记录', evidence: '知道日志是为了回溯失败，而不是装饰输出。' },
  { title: '迁移意识', evidence: '主动把课堂内容映射回每周真实报表流程。' }
];

const learningStats: Array<{ label: string; value: string; hint: string; tone: Tone }> = [
  { label: '学习路径', value: '3 条', hint: '目标已拆成可执行路径', tone: 'primary' },
  { label: '本周推进', value: '12 项', hint: '含 4 个关键任务', tone: 'success' },
  { label: '累计投入', value: '6.5h', hint: '真实学习时长', tone: 'accent' },
  { label: '当前状态', value: 'LSB +2.1', hint: '节奏尚可，适合继续', tone: 'warning' }
];

const learningPaths: Array<{
  title: string;
  description: string;
  tag: string;
  tone: Tone;
  progress: string;
  progressValue: number;
  nextStep: string;
}> = [
  {
    title: 'Python 自动化提效',
    description: '从 Excel 清洗到日志与异常处理，围绕每周真实报表场景推进。',
    tag: '推进中',
    tone: 'primary',
    progress: '62%',
    progressValue: 62,
    nextStep: '下一步：异常处理与日志记录'
  },
  {
    title: '概率论错题修复',
    description: '以错题为中心回推薄弱概念，减少会做题但说不清原理的情况。',
    tag: '本周重点',
    tone: 'success',
    progress: '48%',
    progressValue: 48,
    nextStep: '下一步：条件概率与贝叶斯直觉'
  },
  {
    title: '英语复述表达训练',
    description: '通过句式拆解、复述和反馈循环，提升口头表达的连续性。',
    tag: '轻任务',
    tone: 'accent',
    progress: '34%',
    progressValue: 34,
    nextStep: '下一步：围绕一段新闻做 90 秒复述'
  }
];

const messages: Array<{ role: 'ai' | 'user'; avatar: string; author: string; meta: string; content: string }> = [
  {
    role: 'ai',
    avatar: 'AI',
    author: 'AI 规划师',
    meta: '刚刚',
    content: '先别急着学工具。你真正想解决的，是每周重复整理报表这件事，对吗？'
  },
  {
    role: 'user',
    avatar: '你',
    author: '你',
    meta: '1 分钟前',
    content: '对，我不是想学一堆语法，我是想把这条重复流程自动化。'
  },
  {
    role: 'ai',
    avatar: 'AI',
    author: 'AI 讲解助手',
    meta: '现在',
    content: '那这条路径就应先学文件读取、数据清洗、异常处理，再把脚本嵌进你的真实工作流。'
  }
];

const questionOptions: Array<{ label: string; text: string; selected: boolean }> = [
  { label: 'A', text: '自动清洗 Excel 和 CSV 数据', selected: true },
  { label: 'B', text: '自动发送汇总邮件与周报', selected: false },
  { label: 'C', text: '批量生成图表并存档', selected: false }
];

const mentorSteps = [
  '带一份真实 Excel 报表进来，而不是从空白示例开始。',
  '先定义输出结果，再确定需要哪些字段清洗。',
  '把失败场景写出来，学习时直接对准异常处理。'
];

const mentorFocus = [
  { title: '问题定义太大', desc: '把“学 Python”收敛成“自动化周报流程”。' },
  { title: '练习脱离场景', desc: '不要只刷语法题，要围绕真实文件结构练。' },
  { title: '缺少复盘闭环', desc: '每节课结束后记录一个困惑，作为下一次开场。' }
];

const mentorReplies = ['这就是我现在的真实任务', '我卡在异常处理', '想先看一个完整例子'];

const readerSections = [
  { title: '为什么脚本会脆弱', note: '先理解失败来源' },
  { title: '最小异常处理模式', note: '先跑通再扩展' },
  { title: '日志与回溯', note: '让失败变得可解释' }
];

const readerChecks = [
  { title: '概念检核', desc: '你能区分报错、异常和日志分别承担什么作用吗？' },
  { title: '迁移任务', desc: '把这一节的方法迁移到你自己的数据清洗脚本中。' }
];

const companionCards = [
  { emoji: '🎯', title: '今日任务', desc: '完成异常处理第一步，预计 20 分钟。' },
  { emoji: '🔥', title: '学习连胜', desc: '已经连续学习 6 天，建议保持轻量节奏。' },
  { emoji: '✨', title: '即时反馈', desc: '你已经能把真实问题拆成可执行步骤了。' }
];

const companionQuests = [
  { title: '继续追问', desc: '把当前困惑直接抛给 AI，保持学习流动。' },
  { title: '解锁小测', desc: '用 1 道题确认你是否真的理解了异常处理。' },
  { title: '记录收获', desc: '写下今天最有用的一条方法，便于复盘。' }
];

const opsSignals = [
  { label: '待跟进用户', value: '8', meta: '24h 内需回访' },
  { label: '高风险路径', value: '3', meta: '疲劳与掉队上升' },
  { label: '活跃课程', value: '12', meta: '当前仍在推进' }
];

const opsQueue = [
  { name: '陈沐阳', reason: '连续两次暂停在同一知识点' },
  { name: '周可欣', reason: '学习间隔拉长，掉队风险升高' },
  { name: '林子涵', reason: '路径推进正常，但需要升级任务难度' }
];

const opsHealth = [
  { title: '平均推进', value: '57%' },
  { title: '风险敞口', value: '中' },
  { title: '可继续学习', value: '89%' },
  { title: '异常超时', value: '2' }
];

const opsTeachingHints = ['先给例子再讲抽象规则', '复述失败点，不要直接给答案', '优先围绕真实任务演示'];

const opsTimeline = [
  { time: '09:10', desc: '用户在 GoalConversation 完成问题确认' },
  { time: '09:38', desc: '首次学习页暂停，原因是异常处理理解不足' },
  { time: '10:05', desc: '课程总结生成，建议下节进入日志追踪' }
];

const completionStats: Array<{ label: string; value: string }> = [
  { label: '主题', value: 'Python 自动化入门' },
  { label: '知识点', value: '7 / 9 已掌握' },
  { label: '用时', value: '43 分钟' },
  { label: '互动', value: '29 条消息' }
];

const completionTakeaways = [
  '你已经能把真实工作任务拆成脚本目标，而不是只停留在抽象学习。',
  '对异常处理和日志的理解开始成型，适合进入更完整的流程练习。',
  '复盘环节要保留，因为你的理解提升明显依赖于讲解后的追问。'
];

const completionActions = [
  '本周再完成一次围绕真实文件结构的清洗练习。',
  '把当前脚本加上失败日志输出，形成可回溯的版本。',
  '下次学习时直接带一份真实报表数据，继续沿场景推进。'
];

const adminRows: Array<{
  avatar: string;
  name: string;
  email: string;
  track: string;
  state: string;
  stateTone: Tone;
  lastSeen: string;
  risk: string;
  riskTone: Tone;
}> = [
  {
    avatar: '林',
    name: '林子涵',
    email: 'zihan@example.com',
    track: 'Python 自动化提效',
    state: '正常推进',
    stateTone: 'success',
    lastSeen: '今天 09:40',
    risk: '低风险',
    riskTone: 'success'
  },
  {
    avatar: '陈',
    name: '陈沐阳',
    email: 'muyang@example.com',
    track: '概率论错题修复',
    state: '需跟进',
    stateTone: 'warning',
    lastSeen: '昨天 22:10',
    risk: '疲劳升高',
    riskTone: 'warning'
  },
  {
    avatar: '周',
    name: '周可欣',
    email: 'kexin@example.com',
    track: '英语复述训练',
    state: '等待回访',
    stateTone: 'primary',
    lastSeen: '2 天前',
    risk: '掉队风险',
    riskTone: 'danger'
  }
];

const themeVars = computed<Record<string, string>>(() => ({
  '--lab-canvas': activeTheme.value.colors.canvas,
  '--lab-surface': activeTheme.value.colors.surface,
  '--lab-surface-alt': activeTheme.value.colors.surfaceAlt,
  '--lab-border': activeTheme.value.colors.border,
  '--lab-text': activeTheme.value.colors.text,
  '--lab-muted': activeTheme.value.colors.muted,
  '--lab-primary': activeTheme.value.colors.primary,
  '--lab-secondary': activeTheme.value.colors.secondary,
  '--lab-accent': activeTheme.value.colors.accent,
  '--lab-success': activeTheme.value.colors.success,
  '--lab-warning': activeTheme.value.colors.warning,
  '--lab-danger': activeTheme.value.colors.danger,
  '--lab-chip-bg': activeTheme.value.colors.chipBg,
  '--lab-nav-bg': activeTheme.value.colors.navBg,
  '--lab-panel-tint': activeTheme.value.colors.panelTint,
  '--lab-user-bubble': activeTheme.value.colors.userBubble,
  '--lab-ai-bubble': activeTheme.value.colors.aiBubble,
  '--lab-track': activeTheme.value.colors.track,
  '--lab-display-font': activeTheme.value.fonts.display,
  '--lab-body-font': activeTheme.value.fonts.body,
  '--lab-radius-card': activeTheme.value.radii.card,
  '--lab-radius-pill': activeTheme.value.radii.pill,
  '--lab-hero-gradient': activeTheme.value.heroGradient,
  '--lab-shadow': activeTheme.value.shadow
}));

const ratingStyle = (value: number) => ({ width: `${(value / 5) * 100}%` });
</script>

<style scoped>
.design-lab {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  background: var(--lab-canvas);
  color: var(--lab-text);
  font-family: var(--lab-body-font);
}

.design-lab__backdrop {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(120px);
  opacity: 0.45;
}

.orb--one {
  width: 420px;
  height: 420px;
  top: -120px;
  right: -100px;
  background: color-mix(in srgb, var(--lab-primary) 55%, transparent);
}

.orb--two {
  width: 360px;
  height: 360px;
  bottom: -100px;
  left: -80px;
  background: color-mix(in srgb, var(--lab-accent) 42%, transparent);
}

.design-lab__shell {
  position: relative;
  z-index: 1;
  max-width: 1480px;
  margin: 0 auto;
  padding: 32px 20px 72px;
  display: grid;
  gap: 24px;
}

.panel {
  background: var(--lab-panel-tint);
  border: 1px solid var(--lab-border);
  border-radius: var(--lab-radius-card);
  box-shadow: var(--lab-shadow);
  backdrop-filter: blur(18px);
}

.hero-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(300px, 0.9fr);
  gap: 24px;
  padding: 28px;
}

.hero-copy h1,
.section-head h2,
.detail-card h3,
.utility-card h3,
.completion-block h3,
.hero-surface h3,
.phone-hero h3 {
  font-family: var(--lab-display-font);
}

.hero-copy h1 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3.4rem);
  line-height: 1.06;
  letter-spacing: -0.04em;
}

.hero-copy p,
.detail-card p,
.utility-card p,
.completion-block p,
.hero-surface p,
.insight-card p,
.phone-hero p {
  margin: 0;
  color: var(--lab-muted);
  line-height: 1.65;
}

.hero-eyebrow,
.hero-links,
.button-row,
.pill-grid,
.hero-meta,
.metric-grid,
.path-grid,
.conversation-extras,
.summary-grid,
.completion-layout,
.showcase-grid,
.showcase-grid--second,
.showcase-grid--mobile,
.overview-grid {
  display: grid;
  gap: 16px;
}

.prototype-shell,
.conversation-lab {
  display: grid;
  gap: 18px;
}

.prototype-intro {
  display: grid;
  gap: 10px;
  padding: 18px 20px;
  border-radius: calc(var(--lab-radius-card) - 8px);
  background: var(--lab-hero-gradient);
}

.prototype-intro h3 {
  margin: 0;
  font-size: 1.35rem;
}

.mentor-grid,
.ops-grid,
.ops-context-grid,
.reader-layout,
.companion-grid,
.quest-grid,
.mentor-reply-grid,
.focus-rows,
.reader-check-grid,
.ops-strip,
.ops-health-board,
.timeline-list {
  display: grid;
  gap: 14px;
}

.mentor-grid,
.companion-grid,
.ops-strip,
.quest-grid,
.reader-check-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.reader-layout,
.ops-grid,
.ops-context-grid {
  grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.85fr);
}

.mentor-note-card,
.mentor-checklist-card,
.mentor-focus-card,
.reader-manuscript,
.reader-rail,
.reader-progress-card,
.reader-outline,
.companion-banner,
.companion-card,
.quest-card,
.ops-panel,
.ops-strip__card,
.ops-context-card,
.reader-lesson-card,
.lesson-check-card,
.reflection-card {
  border: 1px solid color-mix(in srgb, var(--lab-border) 78%, transparent);
  background: var(--lab-surface);
  border-radius: calc(var(--lab-radius-card) - 8px);
}

.mentor-note-card,
.mentor-checklist-card,
.mentor-focus-card,
.reader-manuscript,
.reader-progress-card,
.reader-outline,
.companion-banner,
.companion-card,
.quest-card,
.ops-panel,
.ops-strip__card,
.ops-context-card,
.reader-lesson-card,
.lesson-check-card,
.reflection-card {
  padding: 18px;
}

.mentor-note-card {
  grid-column: span 2;
  display: grid;
  gap: 12px;
}

.mentor-note-card__head,
.reader-manuscript__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  color: var(--lab-muted);
  font-size: 0.9rem;
}

.mentor-note-card h3,
.reader-manuscript h3,
.companion-banner h3,
.ops-panel h3,
.reader-lesson-card h3 {
  margin: 0;
  font-size: 1.2rem;
}

.mentor-quote,
.reader-callout {
  padding: 14px 16px;
  border-left: 3px solid var(--lab-primary);
  background: color-mix(in srgb, var(--lab-primary) 8%, var(--lab-surface));
  border-radius: 0 16px 16px 0;
}

.mentor-quote strong,
.reader-callout strong {
  display: block;
  margin-bottom: 6px;
}

.focus-row,
.reader-outline__item,
.ops-list__row,
.timeline-list__row {
  display: grid;
  gap: 4px;
  padding: 12px 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--lab-border) 70%, transparent);
}

.focus-row:last-child,
.reader-outline__item:last-child,
.ops-list__row:last-child,
.timeline-list__row:last-child {
  border-bottom: 0;
}

.reader-manuscript {
  display: grid;
  gap: 12px;
}

.reader-rail {
  display: grid;
  gap: 14px;
}

.reader-outline__item span,
.focus-row span,
.lesson-check-card span,
.ops-list__row span,
.timeline-list__row span,
.companion-card p,
.quest-card span,
.reader-lesson-card p,
.reflection-card p,
.ops-strip__card small {
  color: var(--lab-muted);
  line-height: 1.55;
}

.companion-banner {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  background: var(--lab-hero-gradient);
}

.companion-banner strong {
  font-size: 1.35rem;
}

.companion-card,
.quest-card,
.ops-strip__card,
.lesson-check-card {
  display: grid;
  gap: 10px;
}

.companion-card {
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: start;
}

.companion-card__emoji {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--lab-primary) 10%, transparent);
  font-size: 1.4rem;
}

.companion-card strong,
.quest-card strong,
.ops-strip__card strong,
.ops-panel strong,
.lesson-check-card strong,
.reader-outline__item strong,
.focus-row strong,
.timeline-list__row strong {
  color: var(--lab-text);
}

.ops-strip__card span,
.ops-strip__card small {
  display: block;
}

.ops-strip__card strong {
  font-size: 1.6rem;
}

.ops-panel {
  display: grid;
  gap: 14px;
}

.ops-list,
.reader-outline {
  display: grid;
}

.ops-health-board {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.ops-health-board__cell {
  padding: 14px;
  border-radius: 18px;
  background: var(--lab-surface-alt);
  display: grid;
  gap: 6px;
}

.ops-health-board__cell span {
  color: var(--lab-muted);
}

.reader-lesson-card {
  display: grid;
  gap: 12px;
}

.reader-lesson-card__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--lab-muted);
}

.reply-chip {
  min-height: 42px;
  padding: 0 14px;
  border-radius: var(--lab-radius-pill);
  border: 1px solid var(--lab-border);
  background: var(--lab-surface);
  color: var(--lab-text);
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.reply-chip:hover {
  border-color: color-mix(in srgb, var(--lab-primary) 52%, var(--lab-border));
}

.reflection-card {
  background: color-mix(in srgb, var(--lab-warning) 8%, var(--lab-surface));
}

.hero-eyebrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  font-size: 0.85rem;
  color: var(--lab-muted);
}

.tiny-pill,
.info-pill,
.status-pill,
.theme-tab__badge,
.hero-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: var(--lab-radius-pill);
  border: 1px solid color-mix(in srgb, var(--lab-border) 65%, transparent);
  background: var(--lab-chip-bg);
  color: var(--lab-text);
  font-size: 0.82rem;
  line-height: 1;
}

.hero-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
}

.hero-note,
.mini-card__label,
.section-kicker,
.section-note,
.mock-brand span,
.metric-card small,
.utility-card__head span,
.path-card__foot span,
.table-user span,
.phone-card span,
.phone-card small,
.rating-row__meta span,
.summary-chip-card span {
  color: var(--lab-muted);
}

.solid-button,
.ghost-button,
.text-button,
.theme-tab {
  border: 0;
  cursor: pointer;
  font: inherit;
  text-decoration: none;
  transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease, color 180ms ease;
}

.solid-button,
.ghost-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 18px;
  border-radius: var(--lab-radius-pill);
  font-weight: 600;
}

.solid-button {
  background: var(--lab-primary);
  color: #ffffff;
  box-shadow: 0 14px 30px color-mix(in srgb, var(--lab-primary) 24%, transparent);
}

.ghost-button {
  background: transparent;
  color: var(--lab-text);
  border: 1px solid var(--lab-border);
}

.text-button {
  padding: 0;
  background: transparent;
  color: var(--lab-primary);
  font-weight: 600;
}

.solid-button--small,
.ghost-button--small {
  min-height: 38px;
  padding: 0 14px;
  font-size: 0.92rem;
}

.solid-button--wide {
  width: 100%;
}

.solid-button:hover,
.ghost-button:hover,
.theme-tab:hover {
  transform: translateY(-1px);
}

.solid-button:focus-visible,
.ghost-button:focus-visible,
.theme-tab:focus-visible,
.text-button:focus-visible {
  outline: 2px solid var(--lab-accent);
  outline-offset: 3px;
}

.hero-meta {
  display: grid;
  align-content: start;
}

.mini-card,
.detail-card,
.utility-card,
.completion-block,
.summary-chip-card,
.mobile-admin-card,
.phone-card,
.swatch-card,
.insight-card,
.metric-card,
.path-card {
  border: 1px solid color-mix(in srgb, var(--lab-border) 82%, transparent);
  background: var(--lab-surface);
  border-radius: calc(var(--lab-radius-card) - 8px);
}

.mini-card,
.detail-card,
.utility-card,
.completion-block,
.summary-chip-card,
.mobile-admin-card,
.swatch-card,
.insight-card,
.metric-card,
.path-card {
  padding: 18px;
}

.mini-card strong,
.detail-card h3,
.utility-card h3,
.completion-block h3,
.section-head h2,
.hero-surface h3,
.path-card h3,
.phone-card strong,
.table-user strong,
.message-bubble strong,
.summary-chip-card strong {
  color: var(--lab-text);
}

.mini-card p {
  margin-top: 8px;
}

.theme-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.theme-tab {
  padding: 16px;
  display: grid;
  gap: 8px;
  text-align: left;
  background: var(--lab-surface);
  border: 1px solid var(--lab-border);
  border-radius: calc(var(--lab-radius-card) - 10px);
  color: var(--lab-text);
}

.theme-tab small {
  color: var(--lab-muted);
}

.theme-tab--active {
  background: var(--lab-hero-gradient);
  border-color: color-mix(in srgb, var(--lab-primary) 55%, var(--lab-border));
}

.theme-tab__badge {
  justify-self: start;
  background: color-mix(in srgb, var(--lab-primary) 16%, transparent);
}

.overview-panel,
.preview-panel {
  padding: 24px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.section-head--compact {
  margin-bottom: 16px;
}

.section-kicker {
  display: inline-block;
  margin-bottom: 8px;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.section-head h2 {
  margin: 0;
  font-size: clamp(1.35rem, 2vw, 1.9rem);
  letter-spacing: -0.03em;
}

.overview-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.detail-card {
  display: grid;
  align-content: start;
  gap: 12px;
}

.detail-card h3 {
  margin: 0;
  font-size: 1rem;
}

.simple-list,
.ordered-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
  color: var(--lab-muted);
}

.simple-list--compact {
  gap: 6px;
}

.swatch-grid {
  display: grid;
  gap: 12px;
}

.swatch-card {
  display: flex;
  align-items: center;
  gap: 12px;
}

.swatch-card code {
  color: var(--lab-muted);
  background: transparent;
  padding: 0;
}

.swatch-card__dot {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  flex: 0 0 18px;
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.rating-row {
  display: grid;
  gap: 8px;
}

.rating-row__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.rating-row__track,
.progress-bar {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--lab-track);
}

.rating-row__fill,
.progress-bar__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--lab-primary), var(--lab-accent));
}

.showcase-grid,
.showcase-grid--second,
.showcase-grid--mobile {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mock-shell {
  display: grid;
  gap: 18px;
}

.mock-nav {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-radius: calc(var(--lab-radius-card) - 10px);
  background: var(--lab-nav-bg);
  border: 1px solid color-mix(in srgb, var(--lab-border) 76%, transparent);
}

.mock-brand,
.table-user,
.utility-card__head,
.path-card__head,
.path-card__foot,
.message-bubble__meta,
.mobile-admin-card__head,
.phone-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mock-brand {
  justify-content: flex-start;
}

.mock-brand__icon,
.message-avatar,
.table-user__avatar {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-weight: 700;
  background: color-mix(in srgb, var(--lab-primary) 18%, transparent);
  color: var(--lab-text);
  flex: 0 0 40px;
}

.mock-brand div,
.table-user div {
  display: grid;
  gap: 4px;
}

.mock-links {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mock-link {
  padding: 10px 14px;
  border-radius: var(--lab-radius-pill);
  color: var(--lab-muted);
}

.mock-link--active {
  background: color-mix(in srgb, var(--lab-primary) 16%, transparent);
  color: var(--lab-text);
}

.hero-surface {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr);
  gap: 16px;
  padding: 22px;
  border-radius: calc(var(--lab-radius-card) - 4px);
  background: var(--lab-hero-gradient);
}

.hero-surface h3,
.path-card h3,
.utility-card h3,
.phone-hero h3 {
  margin: 0 0 10px;
  font-size: 1.35rem;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.button-row--end {
  justify-content: flex-end;
}

.insight-card {
  display: grid;
  align-content: start;
  gap: 10px;
}

.insight-card__label {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--lab-muted);
}

.metric-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.metric-card {
  display: grid;
  gap: 8px;
}

.metric-card strong {
  font-size: 1.55rem;
}

.metric-card--primary {
  border-color: color-mix(in srgb, var(--lab-primary) 28%, var(--lab-border));
}

.metric-card--success {
  border-color: color-mix(in srgb, var(--lab-success) 28%, var(--lab-border));
}

.metric-card--warning {
  border-color: color-mix(in srgb, var(--lab-warning) 30%, var(--lab-border));
}

.metric-card--accent {
  border-color: color-mix(in srgb, var(--lab-accent) 28%, var(--lab-border));
}

.path-grid,
.conversation-extras,
.completion-layout {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.path-card,
.utility-card {
  display: grid;
  gap: 12px;
}

.path-card h3,
.utility-card h3,
.completion-block h3 {
  font-size: 1.05rem;
}

.path-card__head,
.path-card__foot,
.utility-card__head {
  font-size: 0.9rem;
}

.status-pill {
  min-height: 28px;
  padding: 0 10px;
  font-size: 0.78rem;
}

.status-pill--primary {
  background: color-mix(in srgb, var(--lab-primary) 16%, transparent);
}

.status-pill--success {
  background: color-mix(in srgb, var(--lab-success) 16%, transparent);
}

.status-pill--warning {
  background: color-mix(in srgb, var(--lab-warning) 18%, transparent);
}

.status-pill--accent {
  background: color-mix(in srgb, var(--lab-accent) 18%, transparent);
}

.status-pill--danger {
  background: color-mix(in srgb, var(--lab-danger) 18%, transparent);
}

.chat-stack {
  display: grid;
  gap: 14px;
  margin-bottom: 18px;
}

.message-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.message-row--user {
  grid-template-columns: minmax(0, 1fr) 40px;
}

.message-row--user .message-avatar {
  order: 2;
}

.message-row--user .message-bubble {
  order: 1;
  background: var(--lab-user-bubble);
  color: #ffffff;
}

.message-row--user .message-bubble__meta,
.message-row--user .message-bubble p {
  color: #ffffff;
}

.message-bubble {
  padding: 14px 16px;
  border-radius: calc(var(--lab-radius-card) - 10px);
  background: var(--lab-ai-bubble);
  border: 1px solid color-mix(in srgb, var(--lab-border) 78%, transparent);
}

.message-bubble__meta {
  margin-bottom: 8px;
  font-size: 0.85rem;
}

.message-bubble p {
  margin: 0;
  line-height: 1.65;
}

.option-list {
  display: grid;
  gap: 10px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid var(--lab-border);
  background: var(--lab-surface-alt);
}

.option-item--selected {
  border-color: color-mix(in srgb, var(--lab-primary) 52%, var(--lab-border));
  background: color-mix(in srgb, var(--lab-primary) 10%, var(--lab-surface));
}

.option-item__bullet {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--lab-chip-bg);
  font-weight: 700;
}

.summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.summary-chip-card {
  display: grid;
  gap: 8px;
}

.summary-chip-card strong {
  font-size: 1rem;
  overflow-wrap: anywhere;
}

.completion-block--full {
  grid-column: 1 / -1;
}

.toolbar-preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  margin-bottom: 18px;
}

.toolbar-input {
  min-height: 46px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid var(--lab-border);
  background: var(--lab-surface);
  color: var(--lab-muted);
}

.table-shell {
  border: 1px solid color-mix(in srgb, var(--lab-border) 78%, transparent);
  border-radius: calc(var(--lab-radius-card) - 10px);
  overflow: hidden;
  background: var(--lab-surface);
}

.table-shell table {
  width: 100%;
  border-collapse: collapse;
}

.table-shell th,
.table-shell td {
  padding: 14px 16px;
  text-align: left;
  border-bottom: 1px solid color-mix(in srgb, var(--lab-border) 72%, transparent);
}

.table-shell th {
  background: var(--lab-surface-alt);
  color: var(--lab-muted);
  font-size: 0.86rem;
  font-weight: 600;
}

.table-shell tbody tr:last-child td {
  border-bottom: 0;
}

.table-user {
  justify-content: flex-start;
}

.table-shell--mobile {
  display: none;
}

.mobile-admin-card {
  display: grid;
  gap: 14px;
}

.mobile-admin-card__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.mobile-admin-card__grid span {
  display: block;
  margin-bottom: 4px;
  color: var(--lab-muted);
  font-size: 0.84rem;
}

.phone-frame {
  max-width: 360px;
  margin: 0 auto;
  padding: 12px;
  border-radius: 34px;
  background: #101218;
  box-shadow: 0 26px 60px rgba(0, 0, 0, 0.28);
}

.phone-screen {
  min-height: 640px;
  border-radius: 26px;
  background: var(--lab-surface);
  padding: 18px;
  display: grid;
  gap: 16px;
}

.phone-topbar {
  font-size: 0.85rem;
  color: var(--lab-muted);
}

.phone-hero {
  padding: 18px;
  border-radius: 22px;
  background: var(--lab-hero-gradient);
}

.phone-card-list {
  display: grid;
  gap: 12px;
}

.phone-card {
  display: grid;
  gap: 8px;
  padding: 16px;
}

.phone-card--chat {
  gap: 10px;
}

.phone-chat-bubble {
  padding: 12px 14px;
  border-radius: 18px;
  background: var(--lab-ai-bubble);
  line-height: 1.55;
}

.phone-chat-bubble--user {
  background: var(--lab-user-bubble);
  color: #ffffff;
}

.pill-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pill-grid--tight,
.pill-grid--compact {
  gap: 8px;
}

.info-pill--ghost {
  background: transparent;
}

@media (max-width: 1200px) {
  .hero-panel,
  .showcase-grid,
  .showcase-grid--second,
  .showcase-grid--mobile,
  .hero-surface,
  .overview-grid,
  .reader-layout,
  .ops-grid,
  .ops-context-grid {
    grid-template-columns: 1fr;
  }

  .metric-grid,
  .summary-grid,
  .mentor-grid,
  .companion-grid,
  .quest-grid,
  .reader-check-grid,
  .ops-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .theme-tabs,
  .path-grid,
  .conversation-extras,
  .completion-layout,
  .mentor-grid,
  .companion-grid,
  .quest-grid,
  .reader-check-grid,
  .ops-strip,
  .ops-health-board,
  .mentor-reply-grid {
    grid-template-columns: 1fr;
  }

  .mock-nav,
  .toolbar-preview,
  .companion-banner {
    grid-template-columns: 1fr;
  }

  .mock-links {
    justify-content: flex-start;
  }

  .table-shell--desktop {
    display: none;
  }

  .table-shell--mobile {
    display: grid;
    gap: 12px;
    background: transparent;
    border: 0;
  }

  .mobile-admin-card__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .design-lab__shell {
    padding: 18px 14px 48px;
  }

  .hero-panel,
  .overview-panel,
  .preview-panel {
    padding: 18px;
  }

  .theme-tabs {
    display: flex;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .theme-tab {
    min-width: 220px;
    flex: 0 0 auto;
  }

  .section-head,
  .hero-links,
  .button-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .metric-grid,
  .summary-grid,
  .companion-grid,
  .quest-grid {
    grid-template-columns: 1fr;
  }

  .message-row,
  .message-row--user {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .message-row--user .message-avatar {
    order: 0;
  }

  .message-row--user .message-bubble {
    order: 0;
  }

  .phone-frame {
    max-width: none;
  }
}
</style>
