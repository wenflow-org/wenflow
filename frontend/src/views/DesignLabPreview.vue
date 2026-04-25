<template>
  <div class="preview-stage">
    <div class="preview-frame" :class="`preview-frame--${device}`">
      <div class="preview-browser">
          <div class="browser-chrome">
            <div class="chrome-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div class="address-bar">
              <span>问流</span>
              <strong>{{ scene.route }}</strong>
            </div>
            <div class="chrome-mode">{{ deviceLabel }}</div>
          </div>

        <div class="preview-canvas" :class="`preview-canvas--${theme.id}`">
          <template v-if="scene.id === 'home'">
            <div class="preview-page preview-page--landing preview-page--home-native">
              <header class="site-header">
                <div class="brand-lockup">
                  <span class="brand-mark">WF</span>
                  <div>
                    <strong>问流 WenFlow</strong>
                    <small>你的学习伙伴</small>
                  </div>
                </div>

                <nav class="site-nav">
                  <a href="#" @click.prevent>理念</a>
                  <a href="#" @click.prevent>问题意识</a>
                  <a href="#" @click.prevent>核心能力</a>
                  <a href="#" @click.prevent>GitHub</a>
                </nav>

                <div class="button-row button-row--tight">
                  <button type="button" class="solid-button">开始体验</button>
                  <button type="button" class="ghost-button">登录</button>
                </div>
              </header>

              <section class="surface-card surface-card--hero home-hero-native">
                <div class="hero-badge-native">
                  <span class="hero-badge-native__dot"></span>
                  <span>为想解决真问题的人准备</span>
                </div>

                <h1 class="home-hero-native__title">
                  <span>想学的东西很多</span>
                  <span class="home-hero-native__highlight">先把真正的问题想清楚</span>
                </h1>

                <p class="home-hero-native__subtitle">
                  <strong>问流帮你把模糊目标拆成可执行路径。</strong>
                  先想清要解决什么，再进入 AI 规划、对话学习和进度追踪，少走弯路。
                </p>

                <div class="button-row">
                  <button type="button" class="solid-button">开始体验</button>
                  <button type="button" class="ghost-button">先了解理念</button>
                </div>

                <div class="card-grid card-grid--three compact-grid home-proof-row">
                  <article v-for="item in homeProofCards" :key="item.title" class="info-tile">
                    <span class="info-tile__label">{{ item.title }}</span>
                    <p>{{ item.desc }}</p>
                  </article>
                </div>

                <div class="home-scroll-hint">往下看，先判断这是不是适合你的学习方式</div>
              </section>

              <EinsteinQuote />
              <MindVsTool />
              <ProblemCreator />
              <CapabilityList />

              <footer class="landing-footer surface-card home-footer-native">
                <div class="home-footer-native__quote">
                  <p>
                    "当 AI 在学怎么像人一样思考，<br />
                    我们在教人怎么更会思考。"
                  </p>
                  <p>当它们相遇，就是未来。</p>
                </div>
                <div class="button-row">
                  <button type="button" class="solid-button">开始体验</button>
                  <button type="button" class="ghost-button">了解平台理念</button>
                </div>
                <nav class="site-nav">
                  <a href="#" @click.prevent>理念</a>
                  <a href="#" @click.prevent>问题意识</a>
                  <a href="#" @click.prevent>核心能力</a>
                  <a href="#" @click.prevent>GitHub</a>
                </nav>
                <small>© 2026 问流 WenFlow · 你的学习伙伴</small>
              </footer>
            </div>
          </template>

          <template v-else-if="scene.id === 'dashboard'">
            <div class="preview-page preview-page--app">
              <header class="app-header">
                <div class="brand-lockup">
                  <span class="brand-mark">WF</span>
                  <div>
                    <strong>问流 WenFlow</strong>
                    <small>学习台</small>
                  </div>
                </div>

                <nav class="app-nav">
                  <button
                    v-for="item in appNavItems"
                    :key="item"
                    type="button"
                    class="app-nav__item"
                    :class="{ 'app-nav__item--active': item === '学习台' }"
                  >
                    {{ item }}
                  </button>
                </nav>

                <div class="header-actions">
                  <button type="button" class="ghost-button ghost-button--small">搜索</button>
                  <span class="user-chip">LY</span>
                </div>
              </header>

              <main class="page-body dashboard-native-body">
                <section class="surface-card dashboard-welcome-card">
                  <div class="dashboard-welcome-card__copy">
                    <h1>欢迎回来，林语！</h1>
                    <p>{{ dashboardWelcomeSubtitle }}</p>
                    <div class="button-row">
                      <button type="button" class="solid-button">开始 AI 规划</button>
                      <button type="button" class="ghost-button">继续我的学习</button>
                    </div>

                    <div class="dashboard-newbie">
                      <div class="dashboard-newbie__head">
                        <span>🎯 新手任务</span>
                        <span>2/3</span>
                      </div>
                      <div class="dashboard-newbie__list">
                        <div class="dashboard-newbie__item dashboard-newbie__item--done">告诉 AI 你想探索什么</div>
                        <div class="dashboard-newbie__item dashboard-newbie__item--done">生成第一张学习地图</div>
                        <div class="dashboard-newbie__item">完成第一个小任务</div>
                      </div>
                      <div class="progress-line">
                        <span class="progress-line__fill" style="width: 66%"></span>
                      </div>
                    </div>
                  </div>

                  <div class="dashboard-welcome-card__visual">✨</div>
                </section>

                <section class="dashboard-section">
                  <div class="section-head">
                    <div>
                      <span class="section-kicker">学习概览</span>
                      <h2>学习概览</h2>
                      <p class="section-note">你的学习数据统计</p>
                    </div>
                  </div>

                  <div class="card-grid card-grid--four">
                    <article
                      v-for="item in dashboardOverviewCards"
                      :key="item.label"
                      class="surface-card overview-card"
                      :class="`overview-card--${item.tone}`"
                    >
                      <div class="overview-card__head">
                        <span class="status-pill" :class="`status-pill--${item.tone}`">{{ item.tag }}</span>
                      </div>
                      <strong>{{ item.value }}</strong>
                      <span class="info-tile__label">{{ item.label }}</span>
                      <p>{{ item.hint }}</p>
                      <small>{{ item.footer }}</small>
                    </article>
                  </div>
                </section>

                <section class="dashboard-bottom-grid">
                  <article class="surface-card">
                    <div class="section-head section-head--compact">
                      <div>
                        <span class="section-kicker">学习日历</span>
                        <h2>学习日历</h2>
                      </div>
                    </div>

                    <div class="calendar-grid">
                      <span
                        v-for="day in dashboardCalendar"
                        :key="day.label"
                        class="calendar-cell"
                        :class="`calendar-cell--${day.tone}`"
                      >
                        {{ day.label }}
                      </span>
                    </div>
                  </article>

                  <article class="surface-card">
                    <div class="section-head section-head--compact">
                      <div>
                        <span class="section-kicker">学习状态</span>
                        <h2>学习状态</h2>
                      </div>
                    </div>

                    <ul class="line-list">
                      <li v-for="item in dashboardRhythmNotes" :key="item">{{ item }}</li>
                    </ul>

                    <div class="note-stack">
                      <article
                        v-for="item in dashboardCoachFeed"
                        :key="item.title"
                        class="note-card"
                      >
                        <strong>{{ item.title }}</strong>
                        <p>{{ item.desc }}</p>
                      </article>
                    </div>
                  </article>
                </section>
              </main>
            </div>
          </template>

          <template v-else-if="scene.id === 'requirement'">
            <div class="preview-page preview-page--app">
              <header class="app-header app-header--session">
                <div class="brand-lockup">
                  <span class="brand-mark">WF</span>
                  <div>
                    <strong>问流 WenFlow</strong>
                    <small>AI 规划</small>
                  </div>
                </div>

                <nav class="app-nav">
                  <button
                    v-for="item in appNavItems"
                    :key="item"
                    type="button"
                    class="app-nav__item"
                    :class="{ 'app-nav__item--active': item === 'AI 规划' }"
                  >
                    {{ item }}
                  </button>
                </nav>

                <div class="header-actions">
                  <span class="status-pill status-pill--success">理解度 82%</span>
                  <span class="user-chip">LY</span>
                </div>
              </header>

              <main class="page-body requirement-native-body">
                <section class="surface-card understanding-panel-preview">
                  <div class="understanding-panel-preview__head">
                    <div class="understanding-panel-preview__title">
                      <span class="message-avatar">🎯</span>
                      <div>
                        <h2>问题理解概览</h2>
                        <p>AI 已经初步理解你的目标、约束和期望周期</p>
                      </div>
                    </div>

                    <div class="planner-banner__meter">
                      <span>理解度</span>
                      <strong>82%</strong>
                      <div class="progress-line">
                        <span class="progress-line__fill" style="width: 82%"></span>
                      </div>
                    </div>
                  </div>

                  <div class="chip-row">
                    <span v-for="item in plannerSummaryChips" :key="item" class="info-pill">{{ item }}</span>
                  </div>

                  <div class="card-grid card-grid--four compact-grid">
                    <article v-for="item in plannerSignals" :key="item.label" class="info-tile info-tile--soft">
                      <span class="info-tile__label">{{ item.label }}</span>
                      <strong>{{ item.value }}</strong>
                    </article>
                  </div>

                  <div class="meta-chip-row constraints-row">
                    <span v-for="item in plannerConstraints" :key="item" class="meta-chip">{{ item }}</span>
                  </div>
                </section>

                <section class="surface-card conversation-card conversation-card--native">
                  <div class="message-thread">
                    <article
                      v-for="message in plannerMessages"
                      :key="`${message.author}-${message.time}`"
                      class="message-row"
                      :class="`message-row--${message.role}`"
                    >
                      <div class="message-avatar">{{ message.avatar }}</div>
                      <div class="message-bubble">
                        <div class="message-bubble__meta">
                          <strong>{{ message.author }}</strong>
                          <span>{{ message.time }}</span>
                        </div>
                        <p>{{ message.content }}</p>
                      </div>
                    </article>
                  </div>

                  <div class="reply-row">
                    <button v-for="reply in plannerReplies" :key="reply" type="button" class="reply-chip">
                      {{ reply }}
                    </button>
                  </div>

                  <article class="surface-card proposal-card-preview">
                    <div class="section-head section-head--compact">
                      <div>
                        <span class="section-kicker">请确认方向</span>
                        <h2>确认并生成路径</h2>
                      </div>
                    </div>

                    <div class="timeline-list">
                      <div v-for="item in plannerDraftPath" :key="item.title" class="timeline-row">
                        <span class="timeline-row__dot"></span>
                        <div>
                          <strong>{{ item.title }}</strong>
                          <p>{{ item.desc }}</p>
                        </div>
                      </div>
                    </div>

                    <div class="button-row button-row--tight">
                      <button type="button" class="solid-button solid-button--small">确认并生成路径</button>
                      <button type="button" class="ghost-button ghost-button--small">继续补充</button>
                    </div>
                  </article>

                  <div class="composer">
                    <div class="composer__field">告诉我你想学什么，或者想解决什么问题...</div>
                    <button type="button" class="solid-button solid-button--small">发送</button>
                  </div>
                </section>
              </main>
            </div>
          </template>

          <template v-else-if="scene.id === 'paths'">
            <div class="preview-page preview-page--app">
              <header class="app-header">
                <div class="brand-lockup">
                  <span class="brand-mark">WF</span>
                  <div>
                    <strong>问流 WenFlow</strong>
                    <small>学习路径</small>
                  </div>
                </div>

                <nav class="app-nav">
                  <button
                    v-for="item in appNavItems"
                    :key="item"
                    type="button"
                    class="app-nav__item"
                    :class="{ 'app-nav__item--active': item === '学习路径' }"
                  >
                    {{ item }}
                  </button>
                </nav>

                <div class="header-actions">
                  <button type="button" class="solid-button solid-button--small">创建路径</button>
                  <span class="user-chip">LY</span>
                </div>
              </header>

              <main class="page-body paths-native-body">
                <section class="surface-card alert-card-preview">
                  <strong>学习路径正在生成中，通常 1-3 分钟完成，请稍候</strong>
                </section>

                <section class="surface-card page-header-card">
                  <div>
                    <h1>学习路径</h1>
                    <p>管理和追踪你的所有学习计划</p>
                  </div>
                  <button type="button" class="solid-button">创建路径</button>
                </section>

                <section class="native-paths-grid">
                  <article
                    v-for="path in pathCards"
                    :key="path.title"
                    class="surface-card native-path-card"
                    :class="`native-path-card--${path.state}`"
                  >
                    <template v-if="path.state === 'generating'">
                      <div class="native-path-card__status native-path-card__status--centered">
                        <strong>正在生成学习路径...</strong>
                        <p>{{ path.summary }}</p>
                        <div class="progress-line">
                          <span class="progress-line__fill" style="width: 42%"></span>
                        </div>
                      </div>
                    </template>

                    <template v-else-if="path.state === 'failed'">
                      <div class="native-path-card__status native-path-card__status--centered">
                        <strong>学习路径生成失败</strong>
                        <p>{{ path.summary }}</p>
                        <div class="button-row button-row--tight">
                          <button type="button" class="solid-button solid-button--small">重试生成</button>
                          <button type="button" class="ghost-button ghost-button--small ghost-button--warning">删除路径</button>
                        </div>
                      </div>
                    </template>

                    <template v-else>
                      <div class="native-path-card__head">
                        <div>
                          <strong>{{ path.title }}</strong>
                          <p>{{ path.summary }}</p>
                        </div>
                        <span class="status-pill" :class="`status-pill--${path.tone}`">{{ path.badge }}</span>
                      </div>

                      <div class="meta-chip-row">
                        <span v-for="tag in path.meta" :key="tag" class="meta-chip">{{ tag }}</span>
                      </div>

                      <div class="native-path-card__stats">
                        <div class="info-tile info-tile--soft">
                          <span class="info-tile__label">小时</span>
                          <strong>{{ path.estimatedHours }}</strong>
                        </div>
                        <div class="info-tile info-tile--soft">
                          <span class="info-tile__label">阶段</span>
                          <strong>{{ path.totalStages }}</strong>
                        </div>
                      </div>

                      <div class="native-path-card__foot">
                        <small>{{ path.nextStep }}</small>
                        <button type="button" class="solid-button solid-button--small">查看详情</button>
                      </div>
                    </template>
                  </article>
                </section>
              </main>
            </div>
          </template>

          <template v-else-if="scene.id === 'path-detail'">
            <div class="preview-page preview-page--app">
              <header class="app-header">
                <div class="brand-lockup">
                  <span class="brand-mark">WF</span>
                  <div>
                    <strong>问流 WenFlow</strong>
                    <small>路径详情</small>
                  </div>
                </div>

                <nav class="app-nav">
                  <button
                    v-for="item in appNavItems"
                    :key="item"
                    type="button"
                    class="app-nav__item"
                    :class="{ 'app-nav__item--active': item === '学习路径' }"
                  >
                    {{ item }}
                  </button>
                </nav>

                <div class="header-actions">
                  <button type="button" class="ghost-button ghost-button--small">重调路径</button>
                  <span class="user-chip">LY</span>
                </div>
              </header>

              <main class="page-body path-detail-native-body">
                <div class="breadcrumb-bar">学习路径 / Python 自动化提效</div>

                <section class="surface-card path-info-card-preview">
                  <div class="path-info-card-preview__head">
                    <div>
                      <h1>Python 自动化提效</h1>
                      <p>从 Excel 清洗到日志与异常处理，围绕每周真实报表场景推进。</p>
                    </div>

                    <div class="progress-ring" :style="{ '--progress': `${pathDetailProgress}%` }">
                      <div class="progress-ring__inner">
                        <strong>{{ pathDetailProgress }}%</strong>
                        <span>完成度</span>
                      </div>
                    </div>
                  </div>

                  <div class="card-grid card-grid--four compact-grid">
                    <article v-for="item in pathDetailMeta" :key="item.label" class="info-tile info-tile--soft">
                      <span class="info-tile__label">{{ item.label }}</span>
                      <strong>{{ item.value }}</strong>
                    </article>
                  </div>

                  <div class="alert-card-preview path-enrichment-banner">
                    <strong>学习内容准备中</strong>
                    <span>路径已经生成，系统正在后台准备学习内容。完成前暂不能开始学习。</span>
                  </div>
                </section>

                <section class="path-weeks-section">
                  <div class="section-head">
                    <div>
                      <span class="section-kicker">学习内容</span>
                      <h2>学习内容</h2>
                    </div>
                  </div>

                  <div class="stack-column">
                    <article v-for="stage in pathStages" :key="stage.title" class="surface-card week-card-preview">
                      <div class="week-card-preview__head">
                        <div>
                          <span class="section-kicker">{{ stage.label }}</span>
                          <h2>{{ stage.title }}</h2>
                        </div>
                        <span class="status-pill" :class="`status-pill--${stage.tone}`">{{ stage.badge }}</span>
                      </div>

                      <p class="stage-card__summary">{{ stage.summary }}</p>

                      <div class="meta-chip-row">
                        <span v-for="objective in stage.objectives" :key="objective" class="meta-chip">{{ objective }}</span>
                      </div>

                      <div class="task-list task-list--compact">
                        <article v-for="task in stage.tasks" :key="task.title" class="surface-card task-detail-card-preview">
                          <div class="task-detail-card-preview__head">
                            <div>
                              <strong>{{ task.title }}</strong>
                              <p>{{ task.note }}</p>
                            </div>
                            <div class="meta-chip-row">
                              <span class="status-pill" :class="`status-pill--${task.tone}`">{{ task.badge }}</span>
                              <span class="meta-chip">{{ task.taskType }}</span>
                            </div>
                          </div>

                          <div class="task-detail-card-preview__foot">
                            <small>预计 {{ task.estimatedMinutes }} 分钟</small>
                            <button type="button" class="ghost-button ghost-button--small" :disabled="task.badge === '已完成' || task.badge === '锁定'">
                              {{ task.actionLabel }}
                            </button>
                          </div>
                        </article>
                      </div>
                    </article>
                  </div>
                </section>
              </main>
            </div>
          </template>

          <template v-else-if="scene.id === 'learning'">
            <div class="preview-page preview-page--learning">
              <header class="lesson-header">
                <div class="lesson-header__left">
                  <button type="button" class="ghost-button ghost-button--small">返回路径</button>
                  <div class="lesson-route">
                    <strong>Python 自动化提效</strong>
                    <small>阶段 2</small>
                  </div>
                </div>

                  <div class="lesson-header__center">
                    <strong>异常处理与日志记录</strong>
                  </div>

                <div class="lesson-header__right">
                  <span class="status-pill status-pill--success">授课中</span>
                  <button type="button" class="ghost-button ghost-button--small">暂停</button>
                  <button type="button" class="solid-button solid-button--small">学到这里，进入评估</button>
                </div>
              </header>

              <div class="learning-layout learning-layout--native">
                <aside class="surface-card knowledge-pane">
                  <div class="section-head section-head--compact">
                    <div>
                      <span class="section-kicker">知识点</span>
                      <h2>知识点</h2>
                    </div>
                  </div>

                  <div class="knowledge-list">
                    <article v-for="item in learningKnowledgePoints" :key="item.title" class="knowledge-item">
                      <div class="knowledge-item__head">
                        <strong>{{ item.title }}</strong>
                        <span class="status-pill" :class="`status-pill--${item.tone}`">{{ item.badge }}</span>
                      </div>
                      <p>{{ item.desc }}</p>
                    </article>
                  </div>
                </aside>

                <main class="surface-card lesson-main lesson-main--native">
                  <div class="message-thread message-thread--lesson">
                    <article
                      v-for="message in learningMessages"
                      :key="`${message.author}-${message.time}`"
                      class="message-row"
                      :class="`message-row--${message.role === 'ai' ? 'ai' : message.role}`"
                    >
                      <div class="message-avatar">{{ message.avatar }}</div>
                      <div class="message-bubble">
                        <div class="message-bubble__meta">
                          <strong>{{ message.author }}</strong>
                          <span>{{ message.time }}</span>
                        </div>
                        <p>{{ message.content }}</p>
                        <div v-if="message.tags?.length" class="meta-chip-row">
                          <span v-for="tag in message.tags" :key="tag" class="meta-chip">{{ tag }}</span>
                        </div>
                      </div>
                    </article>
                  </div>

                  <div class="completion-prompt completion-prompt--inline">
                    <div>
                      <strong>已达到课程完成条件</strong>
                      <p>你可以继续追问，也可以现在结束并生成评估总结。</p>
                    </div>
                    <div class="button-row button-row--tight">
                      <button type="button" class="ghost-button ghost-button--small">继续学习</button>
                      <button type="button" class="solid-button solid-button--small">结束并评估</button>
                    </div>
                  </div>

                  <div class="composer composer--lesson">
                    <div class="composer__field">输入你的问题或回答...（Ctrl+Enter 发送）</div>
                    <button type="button" class="solid-button solid-button--small">发送</button>
                  </div>
                </main>
              </div>

              <button type="button" class="peer-float">同行消息 2</button>
            </div>
          </template>

          <template v-else-if="scene.id === 'evaluation'">
            <div class="preview-page preview-page--evaluation">
              <div class="evaluation-underlay">
                <header class="lesson-header lesson-header--ghosted">
                  <div class="lesson-header__left">
                    <button type="button" class="ghost-button ghost-button--small">返回路径</button>
                    <div class="lesson-route">
                      <strong>Python 自动化提效</strong>
                      <small>阶段 2 / 3</small>
                    </div>
                  </div>
                  <div class="lesson-header__center">
                    <strong>授课结束</strong>
                    <small>授课结束评估</small>
                  </div>
                  <div class="lesson-header__right">
                    <span class="status-pill status-pill--success">课程完成</span>
                  </div>
                </header>
              </div>

              <div class="evaluation-overlay"></div>

              <div class="report-shell">
                <article class="report-dialog report-dialog--native">
                  <CompletionCard
                    topic="异常处理与日志记录"
                    :mastered-count="2"
                    :total-count="3"
                    duration="18 分钟"
                    :message-count="14"
                    :wrapup="evaluationWrapup"
                  />
                </article>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import CapabilityList from '@/components/home/CapabilityList.vue';
import EinsteinQuote from '@/components/home/EinsteinQuote.vue';
import MindVsTool from '@/components/home/MindVsTool.vue';
import ProblemCreator from '@/components/home/ProblemCreator.vue';
import CompletionCard from '@/components/CompletionCard.vue';
import type { DeviceId, LabScene, LabTheme } from './design-lab.data';
import {
  appNavItems,
  dashboardCalendar,
  dashboardCoachFeed,
  dashboardRhythmNotes,
  dashboardOverviewCards,
  dashboardWelcomeSubtitle,
  evaluationWrapup,
  homeProofCards,
  learningKnowledgePoints,
  learningMessages,
  pathCards,
  pathDetailMeta,
  pathDetailProgress,
  pathStages,
  plannerConstraints,
  plannerDraftPath,
  plannerMessages,
  plannerReplies,
  plannerSignals,
  plannerSummaryChips
} from './design-lab.data';

defineProps<{
  theme: LabTheme;
  scene: LabScene;
  device: DeviceId;
  deviceLabel: string;
}>();
</script>

<style scoped>
.preview-stage {
  min-height: 0;
}

.preview-frame {
  width: 100%;
  margin: 0 auto;
}

.preview-frame--desktop {
  max-width: 100%;
}

.preview-frame--mobile {
  max-width: 430px;
  padding: 10px 0 20px;
}

.preview-browser {
  overflow: hidden;
  border: 1px solid var(--lab-border);
  border-radius: 28px;
  background: color-mix(in srgb, var(--lab-surface) 88%, white);
  box-shadow: var(--lab-shadow);
}

.preview-frame--desktop .preview-browser {
  border-radius: 32px;
}

.preview-frame--mobile .preview-browser {
  border-radius: 34px;
  box-shadow:
    0 0 0 10px rgba(255, 255, 255, 0.72),
    0 34px 90px rgba(36, 54, 94, 0.24);
}

.browser-chrome {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--lab-border);
  background: color-mix(in srgb, var(--lab-nav-bg) 82%, white);
  backdrop-filter: blur(18px);
}

.chrome-dots {
  display: flex;
  gap: 6px;
}

.chrome-dots span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--lab-primary) 22%, white);
}

.chrome-dots span:nth-child(2) {
  background: color-mix(in srgb, var(--lab-warning) 40%, white);
}

.chrome-dots span:nth-child(3) {
  background: color-mix(in srgb, var(--lab-success) 42%, white);
}

.address-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid var(--lab-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--lab-surface-alt) 80%, white);
  color: var(--lab-muted);
}

.address-bar strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lab-text);
}

.chrome-mode {
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--lab-chip);
  color: var(--lab-primary);
  font-size: 12px;
  font-weight: 700;
}

.preview-canvas {
  height: clamp(700px, calc(100vh - 255px), 960px);
  overflow: auto;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.88), transparent 26%),
    radial-gradient(circle at top right, color-mix(in srgb, var(--lab-accent) 10%, white), transparent 22%),
    linear-gradient(180deg, color-mix(in srgb, var(--lab-canvas) 92%, white) 0%, var(--lab-canvas) 100%);
}

.preview-frame--desktop .preview-canvas {
  height: clamp(760px, calc(100vh - 250px), 1100px);
}

.preview-frame--mobile .preview-canvas {
  height: clamp(700px, calc(100vh - 300px), 860px);
}

.preview-page {
  min-height: 100%;
  padding: 18px;
  color: var(--lab-text);
}

.preview-page--landing {
  display: grid;
  gap: 18px;
}

.preview-page--home-native {
  padding-bottom: 28px;
}

.preview-page--app,
.preview-page--learning {
  display: grid;
  gap: 18px;
}

.preview-page--evaluation {
  position: relative;
  min-height: 100%;
  padding: 0;
}

.surface-card,
.spotlight-card,
.stack-card,
.note-card,
.mini-stat-card,
.quiz-card,
.report-dialog {
  border: 1px solid var(--lab-border);
  border-radius: var(--lab-card-radius);
  background: color-mix(in srgb, var(--lab-surface) 92%, white);
  box-shadow: 0 18px 46px rgba(20, 32, 50, 0.07);
}

.surface-card {
  padding: 20px;
}

.home-hero-native,
.dashboard-welcome-card,
.understanding-panel-preview,
.page-header-card,
.path-info-card-preview,
.alert-card-preview,
.proposal-card-preview,
.native-path-card,
.week-card-preview,
.task-detail-card-preview {
  display: grid;
  gap: 14px;
}

.surface-card--hero {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--lab-surface) 86%, transparent), color-mix(in srgb, var(--lab-surface-alt) 72%, transparent)),
    var(--lab-hero-gradient);
}

.home-hero-native__title,
.path-info-card-preview h1,
.dashboard-welcome-card h1,
.page-header-card h1 {
  margin: 0;
  font-family: var(--lab-display-font);
  color: var(--lab-text);
}

.home-hero-native__title {
  display: grid;
  gap: 8px;
  font-size: clamp(34px, 4vw, 54px);
  line-height: 1.08;
}

.home-hero-native__highlight {
  color: var(--lab-primary);
}

.home-hero-native__subtitle,
.home-footer-native__quote p,
.page-header-card p,
.path-info-card-preview p,
.alert-card-preview span,
.dashboard-welcome-card p {
  margin: 0;
  color: var(--lab-muted);
  line-height: 1.7;
}

.hero-badge-native {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  padding: 8px 14px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--lab-primary) 8%, white);
  color: var(--lab-primary);
  font-size: 13px;
  font-weight: 700;
}

.hero-badge-native__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--lab-primary);
}

.home-scroll-hint {
  color: var(--lab-muted);
  font-size: 13px;
}

.home-proof-row {
  align-items: stretch;
}

.home-footer-native {
  justify-items: center;
  text-align: center;
}

.home-footer-native__quote {
  display: grid;
  gap: 8px;
}

.dashboard-native-body,
.requirement-native-body,
.paths-native-body,
.path-detail-native-body {
  display: grid;
  gap: 18px;
}

.dashboard-welcome-card {
  grid-template-columns: minmax(0, 1.2fr) 140px;
  align-items: center;
}

.dashboard-welcome-card__copy {
  display: grid;
  gap: 14px;
}

.dashboard-welcome-card__visual {
  display: grid;
  place-items: center;
  min-height: 160px;
  border-radius: 28px;
  background: color-mix(in srgb, var(--lab-chip) 80%, white);
  font-size: 56px;
}

.dashboard-newbie {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--lab-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--lab-surface-alt) 72%, white);
}

.dashboard-newbie__head,
.overview-card__head,
.understanding-panel-preview__head,
.native-path-card__head,
.native-path-card__foot,
.path-info-card-preview__head,
.week-card-preview__head,
.task-detail-card-preview__head,
.task-detail-card-preview__foot,
.page-header-card {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-newbie__item {
  padding: 10px 12px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--lab-surface) 86%, white);
  color: var(--lab-text);
}

.dashboard-newbie__item--done {
  color: var(--lab-success);
}

.dashboard-section,
.dashboard-bottom-grid,
.native-paths-grid,
.path-weeks-section {
  display: grid;
  gap: 18px;
}

.dashboard-bottom-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.overview-card {
  gap: 10px;
}

.overview-card strong {
  font-size: 30px;
}

.overview-card small {
  color: var(--lab-muted);
}

.overview-card--primary,
.overview-card--success,
.overview-card--warning,
.overview-card--accent {
  background: color-mix(in srgb, var(--lab-surface-alt) 76%, white);
}

.understanding-panel-preview__head {
  align-items: center;
}

.understanding-panel-preview__title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.understanding-panel-preview__title h2,
.proposal-card-preview h2,
.week-card-preview h2,
.section-head h2 {
  margin: 0;
}

.constraints-row {
  flex-wrap: wrap;
}

.conversation-card--native {
  gap: 18px;
}

.alert-card-preview {
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--lab-primary) 26%, var(--lab-border));
  border-radius: 22px;
  background: color-mix(in srgb, var(--lab-primary) 8%, white);
}

.alert-card-preview strong {
  color: var(--lab-text);
}

.native-paths-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.native-path-card--generating,
.native-path-card--failed {
  border-style: dashed;
}

.native-path-card__status--centered {
  min-height: 220px;
  align-content: center;
  justify-items: center;
  text-align: center;
}

.native-path-card__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.page-header-card {
  align-items: center;
}

.path-info-card-preview__head {
  align-items: center;
}

.path-enrichment-banner {
  margin-top: 4px;
}

.week-card-preview {
  gap: 16px;
}

.task-detail-card-preview__head,
.task-detail-card-preview__foot {
  align-items: center;
}

.task-detail-card-preview__head p,
.task-detail-card-preview__foot small {
  margin: 0;
  color: var(--lab-muted);
}

.learning-layout--native {
  grid-template-columns: minmax(250px, 0.8fr) minmax(0, 1.4fr);
}

.lesson-main--native {
  gap: 18px;
}

.report-dialog--native {
  width: min(760px, 100%);
}

.report-dialog--native :deep(.completion-card) {
  margin-top: 0;
}

.site-header,
.app-header,
.lesson-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid var(--lab-border);
  border-radius: calc(var(--lab-card-radius) - 4px);
  background: var(--lab-nav-bg);
  backdrop-filter: blur(20px);
}

.site-nav,
.app-nav,
.button-row,
.meta-chip-row,
.chip-row,
.reply-row,
.dialog-actions,
.header-actions,
.toolbar-actions,
.completion-prompt,
.lesson-header__left,
.lesson-header__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.button-row {
  flex-wrap: wrap;
}

.button-row--tight {
  gap: 8px;
}

.site-nav {
  flex-wrap: wrap;
}

.site-nav a,
.app-nav__item,
.meta-chip,
.info-pill,
.reply-chip,
.ghost-button,
.solid-button,
.user-chip,
.option-card,
.scene-link {
  font: inherit;
}

.site-nav a {
  color: var(--lab-muted);
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-lockup strong,
.lesson-header__center strong,
.section-head h2,
.landing-hero h1,
.hero-strip h1,
.planner-banner h1,
.detail-hero h1,
.report-dialog h1 {
  font-family: var(--lab-display-font);
}

.brand-mark,
.message-avatar,
.user-chip,
.option-card__badge,
.stack-step__index,
.progress-ring__inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.brand-mark {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--lab-primary), color-mix(in srgb, var(--lab-primary) 65%, var(--lab-secondary)));
  color: #fff;
  font-size: 14px;
  font-weight: 800;
}

.brand-lockup small,
.lesson-route small,
.section-note,
.hero-copy p,
.hero-strip p,
.planner-banner p,
.detail-hero p,
.note-card p,
.message-bubble p,
.task-row p,
.track-row p,
.knowledge-item p,
.metric-card p,
.timeline-row p,
.line-list,
.ordered-list,
.path-showcase-card p,
.path-overview-card p,
.path-overview-card small,
.track-row small,
.stack-step p,
.info-tile p,
.report-dialog > .section-head p,
.completion-prompt p,
.composer__field,
.card-grid small,
.mini-stat-card small {
  color: var(--lab-muted);
}

.ghost-button,
.solid-button,
.reply-chip,
.app-nav__item {
  border-radius: 16px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: 180ms ease;
}

.solid-button,
.ghost-button,
.reply-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  font-weight: 700;
}

.solid-button {
  background: linear-gradient(135deg, var(--lab-primary), color-mix(in srgb, var(--lab-primary) 62%, var(--lab-secondary)));
  color: #fff;
  box-shadow: 0 14px 28px color-mix(in srgb, var(--lab-primary) 24%, transparent);
}

.ghost-button {
  border-color: var(--lab-border);
  background: color-mix(in srgb, var(--lab-surface-alt) 80%, white);
  color: var(--lab-text);
}

.ghost-button--small,
.solid-button--small {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 14px;
  font-size: 14px;
}

.ghost-button--warning {
  border-color: color-mix(in srgb, var(--lab-danger) 40%, var(--lab-border));
  color: var(--lab-danger);
}

.app-nav {
  flex-wrap: wrap;
}

.app-nav__item {
  padding: 10px 14px;
  border-color: var(--lab-border);
  background: transparent;
  color: var(--lab-muted);
  font-weight: 700;
}

.app-nav__item--active {
  background: var(--lab-chip);
  color: var(--lab-primary);
  border-color: color-mix(in srgb, var(--lab-primary) 34%, var(--lab-border));
}

.user-chip,
.message-avatar,
.option-card__badge,
.stack-step__index {
  border-radius: 999px;
  background: var(--lab-chip);
  color: var(--lab-primary);
  font-weight: 800;
}

.user-chip {
  width: 38px;
  height: 38px;
}

.landing-hero,
.hero-strip,
.detail-hero,
.planner-banner {
  display: grid;
  gap: 18px;
}

.landing-hero,
.detail-hero {
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.8fr);
}

.hero-strip {
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.85fr);
}

.hero-strip--compact {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.hero-copy,
.hero-strip__copy,
.detail-hero__copy,
.planner-banner > div:first-child {
  display: grid;
  gap: 12px;
}

.hero-copy h1,
.hero-strip h1,
.planner-banner h1,
.detail-hero h1,
.report-dialog h1 {
  margin: 0;
  font-size: clamp(28px, 3vw, 44px);
  line-height: 1.1;
}

.hero-chip,
.section-kicker,
.meta-chip,
.status-pill,
.info-pill,
.reply-chip,
.preview-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.hero-chip,
.section-kicker,
.meta-chip,
.info-pill,
.reply-chip {
  background: var(--lab-chip);
  color: var(--lab-primary);
}

.reply-chip {
  border-color: var(--lab-border);
}

.status-pill {
  background: color-mix(in srgb, var(--lab-surface-alt) 70%, white);
  color: var(--lab-muted);
}

.status-pill--primary,
.stat-card--primary,
.metric-card--primary {
  background: color-mix(in srgb, var(--lab-primary) 14%, white);
  color: var(--lab-primary);
}

.status-pill--success,
.stat-card--success,
.metric-card--success,
.calendar-cell--success {
  background: color-mix(in srgb, var(--lab-success) 14%, white);
  color: var(--lab-success);
}

.status-pill--warning,
.stat-card--warning,
.metric-card--warning,
.calendar-cell--warning {
  background: color-mix(in srgb, var(--lab-warning) 16%, white);
  color: color-mix(in srgb, var(--lab-warning) 82%, black);
}

.status-pill--accent,
.stat-card--accent,
.metric-card--accent,
.calendar-cell--accent {
  background: color-mix(in srgb, var(--lab-accent) 14%, white);
  color: var(--lab-accent);
}

.status-pill--danger,
.metric-card--danger,
.calendar-cell--danger {
  background: color-mix(in srgb, var(--lab-danger) 16%, white);
  color: var(--lab-danger);
}

.hero-side,
.hero-strip__stats,
.stack-column,
.note-stack,
.knowledge-list,
.task-list,
.track-list,
.timeline-list,
.report-grid,
.report-shell,
.lesson-main,
.conversation-card {
  display: grid;
  gap: 14px;
}

.stack-card,
.spotlight-card,
.note-card,
.mini-stat-card {
  padding: 16px;
}

.stack-step,
.timeline-row,
.task-row,
.track-row,
.knowledge-item__head,
.path-showcase-card__head,
.path-overview-card__head,
.path-overview-card__foot,
.stage-card__head,
.section-head,
.section-head--compact,
.metric-card,
.planner-banner__meter,
.progress-ring,
.lesson-banner,
.browser-chrome,
.detail-hero,
.hero-strip {
  align-items: start;
}

.stack-step,
.timeline-row,
.task-row,
.track-row,
.knowledge-item__head,
.path-showcase-card__head,
.path-overview-card__head,
.path-overview-card__foot,
.stage-card__head,
.section-head,
.lesson-banner {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.stack-step__index,
.option-card__badge {
  min-width: 36px;
  height: 36px;
}

.page-section,
.page-body {
  display: grid;
  gap: 18px;
}

.page-grid {
  display: grid;
  gap: 18px;
}

.page-grid--dashboard,
.page-grid--planner,
.page-grid--paths,
.page-grid--detail {
  grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.8fr);
}

.card-grid {
  display: grid;
  gap: 14px;
}

.card-grid--one {
  grid-template-columns: 1fr;
}

.card-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.card-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.card-grid--four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.compact-grid article {
  min-height: 0;
}

.info-tile,
.metric-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--lab-border);
  border-radius: calc(var(--lab-card-radius) - 8px);
  background: color-mix(in srgb, var(--lab-surface-alt) 68%, white);
}

.info-tile__label,
.mini-stat-card span,
.metric-card span,
.toolbar-copy small {
  font-size: 12px;
  color: var(--lab-muted);
}

.info-tile strong,
.mini-stat-card strong,
.metric-card strong,
.task-row strong,
.track-row strong,
.knowledge-item strong,
.spotlight-card strong,
.stack-step strong,
.note-card strong,
.path-showcase-card strong,
.path-overview-card strong,
.detail-hero strong,
.report-dialog strong,
.section-head h2,
.timeline-row strong {
  color: var(--lab-text);
}

.path-showcase-card,
.path-overview-card,
.stage-card,
.conversation-card,
.report-section,
.quiz-card {
  display: grid;
  gap: 14px;
}

.path-overview-card {
  padding: 18px;
}

.path-overview-card--generating {
  border-style: dashed;
}

.path-overview-card--failed {
  border-color: color-mix(in srgb, var(--lab-danger) 40%, var(--lab-border));
}

.path-overview-card--active {
  background: color-mix(in srgb, var(--lab-surface) 88%, white);
}

.path-overview-card__foot {
  align-items: center;
}

.progress-line {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: var(--lab-track);
}

.progress-line__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(135deg, var(--lab-primary), color-mix(in srgb, var(--lab-primary) 72%, var(--lab-secondary)));
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 10px;
}

.calendar-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--lab-surface-alt) 72%, white);
  color: var(--lab-muted);
  font-weight: 700;
}

.planner-banner__meter {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--lab-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--lab-surface-alt) 74%, white);
}

.message-thread {
  display: grid;
  gap: 14px;
}

.message-thread--lesson {
  padding-right: 6px;
}

.message-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.message-row--user {
  justify-content: flex-end;
}

.message-row--user .message-avatar {
  order: 2;
}

.message-row--user .message-bubble {
  background: var(--lab-user-bubble);
  color: #fff;
}

.message-row--user .message-bubble p,
.message-row--user .message-bubble__meta,
.message-row--user .meta-chip {
  color: rgba(255, 255, 255, 0.92);
}

.message-row--user .meta-chip {
  background: rgba(255, 255, 255, 0.18);
}

.message-row--ai .message-bubble {
  background: var(--lab-ai-bubble);
}

.message-avatar {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
}

.message-bubble {
  max-width: min(760px, 100%);
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--lab-border) 72%, transparent);
}

.message-bubble__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--lab-muted);
}

.composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--lab-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--lab-surface-alt) 76%, white);
}

.composer__field {
  min-height: 54px;
  display: flex;
  align-items: center;
  padding: 0 4px;
}

.track-row__copy,
.track-row__meta,
.lesson-route,
.planner-banner__meter,
.mini-stat-card,
.metric-card,
.report-section,
.knowledge-item,
.path-showcase-card,
.path-overview-card,
.note-card,
.stage-card,
.hero-side,
.hero-strip__stats,
.lesson-main,
.quiz-card,
.knowledge-pane {
  min-width: 0;
}

.track-row__meta {
  width: min(210px, 100%);
  display: grid;
  gap: 8px;
  justify-items: end;
}

.breadcrumb-bar {
  color: var(--lab-muted);
  font-size: 14px;
}

.progress-ring {
  --progress: 0%;
  width: 164px;
  height: 164px;
  padding: 12px;
  border-radius: 50%;
  background: conic-gradient(var(--lab-primary) var(--progress), color-mix(in srgb, var(--lab-track) 80%, white) 0%);
}

.progress-ring__inner {
  width: 100%;
  height: 100%;
  flex-direction: column;
  gap: 6px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--lab-surface) 90%, white);
}

.progress-ring__inner strong {
  font-size: 28px;
}

.progress-ring__inner span {
  font-size: 13px;
  color: var(--lab-muted);
}

.lesson-header {
  position: sticky;
  top: 18px;
  z-index: 3;
}

.lesson-header__center,
.lesson-route,
.lesson-banner,
.completion-prompt--inline {
  display: grid;
  gap: 4px;
}

.lesson-header__center {
  justify-items: center;
  text-align: center;
}

.learning-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(0, 1.4fr);
  gap: 18px;
}

.knowledge-pane,
.lesson-main {
  padding: 18px;
}

.lesson-main {
  gap: 16px;
}

.lesson-banner {
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 14px 16px;
  border: 1px solid var(--lab-border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--lab-surface-alt) 76%, white);
}

.option-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--lab-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--lab-surface-alt) 72%, white);
}

.option-card--selected {
  border-color: color-mix(in srgb, var(--lab-primary) 42%, var(--lab-border));
  background: color-mix(in srgb, var(--lab-primary) 10%, white);
}

.completion-prompt {
  justify-content: space-between;
  padding: 14px 16px;
  border: 1px solid var(--lab-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--lab-success) 8%, white);
}

.peer-float {
  position: fixed;
  right: 34px;
  bottom: 34px;
  border: 0;
  padding: 14px 18px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--lab-success), color-mix(in srgb, var(--lab-success) 62%, var(--lab-secondary)));
  color: #fff;
  font: inherit;
  font-weight: 700;
  box-shadow: 0 18px 32px rgba(15, 35, 32, 0.18);
}

.evaluation-underlay {
  padding: 18px;
  min-height: 100%;
  background: linear-gradient(180deg, color-mix(in srgb, var(--lab-canvas) 96%, white), var(--lab-canvas));
}

.lesson-header--ghosted {
  opacity: 0.5;
}

.evaluation-overlay {
  position: absolute;
  inset: 0;
  background: rgba(24, 34, 48, 0.32);
  backdrop-filter: blur(6px);
}

.report-shell {
  position: absolute;
  inset: 18px;
  z-index: 2;
  place-items: center;
}

.report-dialog {
  width: min(1080px, 100%);
  max-height: calc(100% - 8px);
  overflow: auto;
  padding: 22px;
  display: grid;
  gap: 18px;
}

.report-section {
  padding: 18px;
  border: 1px solid var(--lab-border);
  border-radius: calc(var(--lab-card-radius) - 8px);
  background: color-mix(in srgb, var(--lab-surface-alt) 58%, white);
}

.report-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.ordered-list,
.line-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.8;
}

.dialog-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.preview-canvas--friendly-companion .surface-card,
.preview-canvas--friendly-companion .spotlight-card,
.preview-canvas--friendly-companion .stack-card,
.preview-canvas--friendly-companion .note-card,
.preview-canvas--friendly-companion .mini-stat-card,
.preview-canvas--friendly-companion .quiz-card,
.preview-canvas--friendly-companion .report-dialog {
  border-radius: 32px;
  background: color-mix(in srgb, var(--lab-surface) 94%, white);
  box-shadow: 0 18px 42px rgba(51, 84, 161, 0.11);
}

.preview-canvas--friendly-companion .brand-mark {
  box-shadow: 0 12px 28px rgba(38, 104, 255, 0.22);
}

.preview-canvas--friendly-companion .site-header,
.preview-canvas--friendly-companion .app-header,
.preview-canvas--friendly-companion .lesson-header {
  border-color: color-mix(in srgb, var(--lab-accent) 18%, var(--lab-border));
}

.preview-canvas--friendly-companion .hero-chip,
.preview-canvas--friendly-companion .section-kicker,
.preview-canvas--friendly-companion .meta-chip,
.preview-canvas--friendly-companion .info-pill,
.preview-canvas--friendly-companion .reply-chip {
  background: color-mix(in srgb, var(--lab-accent) 10%, white);
  color: var(--lab-accent);
}

.preview-canvas--friendly-companion .solid-button {
  background: linear-gradient(135deg, var(--lab-primary), color-mix(in srgb, var(--lab-accent) 52%, var(--lab-primary)));
}

.preview-canvas--friendly-companion .ghost-button,
.preview-canvas--friendly-companion .reply-chip,
.preview-canvas--friendly-companion .app-nav__item,
.preview-canvas--friendly-companion .option-card,
.preview-canvas--friendly-companion .info-tile,
.preview-canvas--friendly-companion .metric-card,
.preview-canvas--friendly-companion .planner-banner__meter,
.preview-canvas--friendly-companion .composer,
.preview-canvas--friendly-companion .report-section {
  background: color-mix(in srgb, var(--lab-surface-alt) 88%, white);
}

.preview-canvas--friendly-companion .message-row--ai .message-bubble {
  background: linear-gradient(135deg, color-mix(in srgb, var(--lab-ai-bubble) 92%, white), color-mix(in srgb, var(--lab-accent) 4%, white));
}

.preview-canvas--friendly-companion .completion-prompt {
  background: linear-gradient(135deg, color-mix(in srgb, var(--lab-success) 10%, white), color-mix(in srgb, var(--lab-accent) 7%, white));
}

.preview-canvas--friendly-companion .surface-card--hero {
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.82)),
    var(--lab-hero-gradient);
}

@media (max-width: 1180px) {
  .landing-hero,
  .hero-strip,
  .page-grid--dashboard,
  .page-grid--planner,
  .page-grid--paths,
  .page-grid--detail,
  .learning-layout {
    grid-template-columns: 1fr;
  }

  .card-grid--four {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .card-grid--three {
    grid-template-columns: 1fr;
  }

  .report-grid {
    grid-template-columns: 1fr;
  }

  .site-header,
  .app-header,
  .lesson-header,
  .hero-strip--compact {
    flex-wrap: wrap;
  }
}

@media (max-width: 820px) {
  .preview-canvas {
    height: 78vh;
  }

  .preview-page {
    padding: 12px;
  }

  .browser-chrome {
    grid-template-columns: 1fr;
  }

  .chrome-mode {
    justify-self: start;
  }

  .card-grid--two,
  .card-grid--four {
    grid-template-columns: 1fr;
  }

  .site-header,
  .app-header,
  .lesson-header,
  .section-head,
  .task-row,
  .track-row,
  .stage-card__head,
  .path-overview-card__head,
  .path-overview-card__foot,
  .lesson-banner,
  .completion-prompt,
  .dialog-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .track-row__meta,
  .planner-banner__meter,
  .hero-strip__stats {
    width: 100%;
  }

  .message-bubble {
    max-width: 100%;
  }

  .composer {
    grid-template-columns: 1fr;
  }

  .report-shell {
    inset: 12px;
  }

  .report-dialog {
    padding: 16px;
  }
}

@media (max-width: 520px) {
  .preview-frame--mobile {
    max-width: 100%;
    padding: 0;
  }

  .surface-card,
  .spotlight-card,
  .stack-card,
  .note-card,
  .mini-stat-card,
  .quiz-card,
  .report-dialog,
  .planner-banner__meter,
  .composer,
  .report-section {
    border-radius: 22px;
  }

  .brand-mark,
  .user-chip,
  .message-avatar {
    width: 34px;
    height: 34px;
  }

  .progress-ring {
    width: 132px;
    height: 132px;
  }

  .peer-float {
    right: 18px;
    bottom: 18px;
  }
}
</style>
