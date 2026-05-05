<template>
  <section class="demo-site" :style="themeVars">
    <header v-if="!isAppScene" class="demo-site__header">
      <div class="site-nav-shell">
        <div class="site-nav__brand">
          <router-link to="/ui-lab" class="site-brand">
            <img src="/ui-lab-logo.png" alt="问流 WenFlow" class="site-brand__logo" />
          </router-link>
        </div>

        <nav class="site-nav" aria-label="页面导航">
          <router-link v-for="item in demoNav" :key="item.to" :to="item.to" class="site-nav__item" :class="{ 'site-nav__item--active': item.sceneId === activeNavSceneId }">
            {{ item.label }}
          </router-link>
          <a href="https://github.com/wenflow-org/wenflow" class="site-nav__item site-nav__item--external" target="_blank" rel="noreferrer">GitHub</a>
        </nav>

        <div class="site-nav__actions">
          <router-link :to="navSecondaryPath" class="site-cta site-cta--ghost">{{ navSecondaryLabel }}</router-link>
          <router-link :to="navPrimaryPath" class="site-cta site-cta--primary">开始体验</router-link>
        </div>
      </div>
    </header>

    <header v-else class="app-site__header">
      <div class="app-nav-shell">
        <router-link to="/ui-lab/dashboard" class="app-brand">
          <img src="/ui-lab-logo.png" alt="问流 WenFlow" class="app-brand__logo" />
          <div class="app-brand__copy">
            <strong>学习台</strong>
            <span>{{ appHeaderSubtitle }}</span>
          </div>
        </router-link>

        <nav class="app-nav" aria-label="应用导航">
          <router-link v-for="item in dashboardAppNav" :key="item.to" :to="item.to" class="app-nav__item" :class="{ 'app-nav__item--active': item.sceneId === activeAppNavSceneId }">
            {{ item.label }}
          </router-link>
        </nav>

        <div class="app-header__actions">
          <router-link to="/ui-lab/planning" class="app-header__cta">开始新规划</router-link>
          <div class="app-user-chip">
            <span>{{ appUserHint }}</span>
            <strong>{{ appUserName }}</strong>
          </div>
        </div>
      </div>
    </header>

    <main class="demo-site__main" :class="{ 'demo-site__main--app': isAppScene }">
      <div v-if="sceneId === 'home'" class="demo-home">
        <div class="home-bg-layer">
          <div class="home-bg-orb home-bg-orb--1"></div>
          <div class="home-bg-orb home-bg-orb--2"></div>
          <div class="home-bg-grid"></div>
        </div>

        <section class="home-hero">
          <div class="home-hero__glow"></div>

          <div class="home-hero__copy">
            <span class="home-hero__tag">WenFlow — 问流</span>
            <h1>
              <span>不是先找课，</span>
              <span>而是先找到<span class="home-hero__accent">真正的问题</span>。</span>
            </h1>
            <p class="home-hero__sub">普通 AI 给你答案。问流从你的真实困扰出发，先澄清目标，再生成路径，通过对话、输出和反馈持续推进。</p>
            <div class="home-hero__cta">
              <router-link to="/ui-lab/login" class="btn btn--primary btn--lg">开始体验</router-link>
              <router-link to="/ui-lab/vision" class="btn btn--ghost">了解愿景</router-link>
            </div>
          </div>

          <div class="home-hero__scene">
            <div class="scene-conversation">
              <article v-for="(step, idx) in heroFlowSteps" :key="step.label" class="scene-turn" :class="[`scene-turn--${step.role}`, `scene-turn--${idx}`]">
                <span class="scene-turn__role">{{ step.role === 'system' ? '系统' : '你' }}</span>
                <p>{{ step.text }}</p>
              </article>
            </div>
            <div class="scene-outcome">
              <span class="scene-outcome__label">真实问题已浮现</span>
              <strong>设计一个 AI 学习产品</strong>
              <span class="scene-outcome__next">→ 生成学习路径</span>
            </div>
          </div>
        </section>

        <section ref="homeWhyRef" class="home-why" :class="{ 'is-in-view': homeWhyInView }">
          <div class="home-why__header home-why__reveal home-why__reveal--header">
            <p class="home-why__lead">你问 AI 怎么学，它给你一份书单。<br />你问课程怎么选，它给你一个路径。<br />但很少有人先问你：<strong>你真正想解决的是什么？</strong></p>
          </div>

          <div class="home-why__grid">
            <div class="why-panel why-panel--old home-why__reveal home-why__reveal--old">
              <span class="why-panel__badge">普通 AI / 普通课程</span>
              <ul>
                <li v-for="item in whyOld" :key="item">{{ item }}</li>
              </ul>
            </div>

            <div class="why-panel why-panel--vs home-why__reveal home-why__reveal--vs">
              <span>VS</span>
            </div>

            <div class="why-panel why-panel--new home-why__reveal home-why__reveal--new">
              <span class="why-panel__badge">WenFlow</span>
              <ul>
                <li v-for="item in whyNew" :key="item">{{ item }}</li>
              </ul>
            </div>
          </div>

          <div class="home-why__insight home-why__reveal home-why__reveal--insight">
            <p>WenFlow 从这个问题开始。</p>
          </div>
        </section>

        <section ref="homeHowRef" class="home-how" :class="{ 'is-in-view': homeHowInView }">
          <div class="home-how__header home-how__reveal home-how__reveal--header">
            <h2>从模糊目标到持续反馈</h2>
            <p>一条流动的学习路径，不是一次性排课。</p>
          </div>

          <div class="how-flow">
            <svg class="how-flow__svg home-how__path" viewBox="0 0 1200 200" fill="none" preserveAspectRatio="xMidYMid meet">
              <path class="how-flow__path" d="M 60 100 C 200 40, 340 160, 480 100 C 620 40, 760 160, 900 100 C 1040 40, 1100 100, 1140 100" stroke="url(#how-gradient)" stroke-width="2" stroke-linecap="round" />
              <defs>
                <linearGradient id="how-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="rgba(52, 120, 246, 0.08)" />
                  <stop offset="50%" stop-color="rgba(52, 120, 246, 0.25)" />
                  <stop offset="100%" stop-color="rgba(52, 120, 246, 0.08)" />
                </linearGradient>
              </defs>
            </svg>

            <div class="how-flow__nodes">
              <article v-for="(step, idx) in howSteps" :key="step.title" class="how-node home-how__reveal" :class="`home-how__reveal--${idx}`">
                <div class="how-node__dot">
                  <span>{{ idx + 1 }}</span>
                </div>
                <div class="how-node__content">
                  <strong>{{ step.title }}</strong>
                  <p>{{ step.desc }}</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section class="home-preview">
          <div class="home-preview__header">
            <h2>不是纯理念，而是真的有产品在跑。</h2>
          </div>

          <div class="preview-panels">
            <article v-for="(card, idx) in previewCards" :key="card.title" class="preview-panel" :class="`preview-panel--${idx}`">
              <span class="preview-panel__label">{{ card.tab }}</span>
              <strong>{{ card.title }}</strong>
              <p>{{ card.desc }}</p>
              <div class="preview-panel__data">
                <span v-for="line in card.lines" :key="line">{{ line }}</span>
              </div>
            </article>
          </div>
        </section>

        <section class="home-capabilities">
          <div class="home-capabilities__center">
            <h2>学习不只是获得答案，<br />而是形成能留下来的能力。</h2>
          </div>

          <div class="cap-light-list">
            <span v-for="item in capabilityLight" :key="item" class="cap-light-tag">{{ item }}</span>
          </div>
        </section>

        <section class="home-final-cta">
          <div class="home-final-cta__glow"></div>
          <div class="home-final-cta__inner">
            <h2>先体验一次完整学习闭环。</h2>
            <p>从一个模糊目标开始，看看 WenFlow 如何帮你澄清、规划，并进入真正的学习过程。</p>
            <div class="home-final-cta__actions">
              <router-link to="/ui-lab/login" class="btn btn--primary btn--lg">开始体验</router-link>
              <router-link to="/ui-lab/vision" class="btn btn--ghost btn--ghost-light">查看愿景</router-link>
            </div>
          </div>
        </section>
      </div>

      <div v-else-if="sceneId === 'vision'" class="vision-page">
        <div class="vision-bg-layer">
          <div class="vision-bg-orb vision-bg-orb--1"></div>
          <div class="vision-bg-orb vision-bg-orb--2"></div>
        </div>

        <section class="vision-hero">
          <div class="vision-hero__glow"></div>
          <div class="vision-hero__inner">
            <div class="vision-hero__copy">
              <span class="vision-hero__tagline">AI 驱动的学习路径与能力成长平台</span>
              <h1>旧的学习方式，<br />越来越难回应新的问题。</h1>
              <p>AI 改变了知识获取的方式，也逼着我们重新回答一个更底层的问题：教育，到底该培养什么？</p>
            </div>

            <div class="vision-hero__band">
              <div class="vision-hero__timeline">
                <span class="vision-timeline__from">1946</span>
                <div class="vision-timeline__line"></div>
                <span class="vision-timeline__to">2026</span>
              </div>
              <p class="vision-hero__signal">技术变了，真正该升级的是人的思维方式。</p>
            </div>
          </div>
        </section>

        <section class="vision-era">
          <div class="vision-era__header">
            <h2>一封被遗忘的电报</h2>
            <p class="vision-era__date">1946.5.25，爱因斯坦等科学家致联合国</p>
          </div>

          <div class="vision-era__inner">
            <article class="vision-era__quote-side">
              <blockquote class="vision-quote">
                "原子释放出的力量改变了一切，<br />除了我们的思维方式。"
              </blockquote>
              <p class="vision-era__source">—— 爱因斯坦等科学家，1946 年</p>
            </article>

            <article class="vision-era__context-side">
              <p class="vision-era__eyebrow">80 年后</p>
              <div class="vision-era__response">
                <p>AI 的力量同样巨大。</p>
                <p>真正值得反思的，不只是工具，</p>
                <p>更是我们仍在沿用的提问、训练与评价方式。</p>
              </div>
              <div class="vision-era__divider"></div>
              <h3>历史，正在重演。</h3>
            </article>
          </div>
        </section>

        <section class="vision-beliefs">
          <div class="vision-beliefs__header">
            <h2>我们选择另一条路。</h2>
            <p>不是让 AI 帮你更快完成旧式学习，而是用 AI 帮助人建立新的学习能力。</p>
          </div>

          <div class="vision-beliefs__grid">
            <article class="belief-panel belief-panel--old">
              <h3>旧学习逻辑</h3>
              <ul>
                <li v-for="item in beliefOld" :key="item">{{ item }}</li>
              </ul>
            </article>

            <article class="belief-panel belief-panel--new">
              <h3>WenFlow 的学习观</h3>
              <ul>
                <li v-for="item in beliefNew" :key="item">{{ item }}</li>
              </ul>
            </article>
          </div>

          <p class="vision-beliefs__closing">普通 AI 提升旧学习效率，WenFlow 改变学习入口。</p>
        </section>

        <section class="vision-mindset">
          <div class="vision-mindset__header">
            <h2>真正可迁移的是思维，<br />不是某个工具的熟练度。</h2>
          </div>

          <div class="vision-mindset__grid">
            <article class="vision-col vision-col--strong">
              <h3>思维 / 道</h3>
              <ul>
                <li v-for="item in mindsetItems" :key="item.title">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.desc }}</span>
                </li>
              </ul>
            </article>

            <div class="vision-col__arrow">→</div>

            <article class="vision-col vision-col--weak">
              <h3>工具 / 技</h3>
              <ul>
                <li v-for="item in toolItems" :key="item.title">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.desc }}</span>
                </li>
              </ul>
            </article>
          </div>

          <p class="vision-mindset__note">有了思维，你自然会用好任何工具。</p>
        </section>

        <section ref="visionProblemsRef" class="vision-problems" :class="{ 'is-in-view': visionProblemsInView }">
          <div class="vision-problems__inner">
            <h2>真正困难的问题，<br />往往是自己给自己出的题。</h2>
            <p>学校与考试提供标准题；探索、研究与创造面对的是开放问题。真正有价值的成长，往往发生在没有标准答案的地方。</p>

            <div class="vision-problem-compare">
              <article class="vision-problem vision-problem--given vision-problems__reveal vision-problems__reveal--given">
                <h3 class="vision-problem__title">别人给的问题</h3>
                <ul>
                  <li v-for="item in givenProblems" :key="item">{{ item }}</li>
                </ul>
              </article>

              <article class="vision-problem vision-problem--created vision-problems__reveal vision-problems__reveal--created">
                <h3 class="vision-problem__title">你创建的问题</h3>
                <ul>
                  <li v-for="item in createdProblems" :key="item">{{ item }}</li>
                </ul>
              </article>
            </div>

            <p class="vision-problems__closing vision-problems__reveal vision-problems__reveal--closing">WenFlow 关注的是右边。</p>
          </div>
        </section>

        <section class="vision-capabilities">
          <div class="vision-capabilities__header">
            <h2>AI 时代真正稀缺的，不是更多知识，<br />而是这 5 种能力。</h2>
          </div>

          <div class="vision-cap-grid">
            <article v-for="(item, idx) in futureCapabilities" :key="item.index" class="vision-cap-step" :class="`vision-cap-step--${idx}`">
              <div class="vision-cap-step__left">
                <span class="vision-cap-step__index">{{ item.index }}</span>
                <span class="vision-cap-step__icon" v-html="capabilityIconSvgs[item.icon]"></span>
              </div>
              <div class="vision-cap-step__body">
                <strong>{{ item.title }}</strong>
                <p>{{ item.desc }}</p>
                <small>而非：{{ item.traditional }}</small>
              </div>
            </article>
          </div>
        </section>

        <section class="vision-why-wf">
          <div class="vision-why-wf__inner">
            <div class="vision-why-wf__intro">
              <span class="vision-why-wf__label">WHY WENFLOW</span>
              <h2>WenFlow 不是一个终点，<br />而是一条路。</h2>
              <p class="vision-why-wf__positioning">WenFlow 是一个 AI 驱动的学习路径与能力成长平台，也是一次关于未来学习方式的开源探索。</p>
            </div>

            <div class="vision-why-wf__body">
              <div class="vision-why-wf__block">
                <span class="vision-why-wf__block-tag">为什么需要 WenFlow</span>
                <p>在 AI 已经能够回答大量标准问题的时代，真正重要的，不再只是更快获得答案，而是更清楚地提出问题，更准确地理解目标，并在持续输出与反馈中形成自己的判断。</p>
              </div>
              <div class="vision-why-wf__block vision-why-wf__block--accent">
                <span class="vision-why-wf__block-tag">WenFlow 想提供什么</span>
                <p>我们相信，学习不应只是内容消费，也不应只是完成既定路径。它更应该是一种不断澄清、不断修正、不断成长的过程。</p>
              </div>
            </div>

            <div class="vision-why-wf__manifesto">
              <p>WenFlow 不试图提供一套标准答案，<br />而是希望留下一块可以继续探索、修改、拆解与重建的基础。</p>
              <p class="vision-why-wf__closing">如果它能帮助某个个体重新理解学习，<br />帮助某个团队重新设计路径，<br />或者帮助某个未来的教育产品少走一点弯路，<br />那它就已经有意义。</p>
            </div>
          </div>
        </section>

        <section class="vision-cta">
          <div class="vision-cta__glow"></div>
          <div class="vision-cta__inner">
            <h2>如果你认同这套学习观，<br />下一步就是亲自试一次。</h2>
            <p>从一个模糊目标开始，看看 WenFlow 如何帮你澄清、规划，并进入真正的学习过程。</p>
            <div class="vision-cta__actions">
              <router-link to="/ui-lab/login" class="btn btn--primary btn--lg">开始体验</router-link>
              <router-link to="/ui-lab/paths" class="btn btn--ghost btn--ghost-light">查看学习路径</router-link>
            </div>
          </div>
        </section>
      </div>

      <div v-else-if="sceneId === 'dashboard'" class="dashboard-page">
        <div class="dashboard-bg-layer">
          <div class="dashboard-bg-orb dashboard-bg-orb--1"></div>
          <div class="dashboard-bg-orb dashboard-bg-orb--2"></div>
          <div class="dashboard-bg-grid"></div>
        </div>

        <section class="dashboard-shell">
          <section class="dashboard-hero surface-card">
            <div class="dashboard-hero__copy">
              <span class="pill">学习台</span>
              <h1>{{ dashboardHeadline }}</h1>
              <p>{{ dashboardHeroSubtitle }}</p>

              <div class="dashboard-hero__actions">
                <router-link :to="dashboardPrimaryAction.to" class="btn btn--primary btn--lg">{{ dashboardPrimaryAction.label }}</router-link>
                <router-link to="/ui-lab/paths" class="btn btn--ghost">查看学习路径</router-link>
              </div>

              <div class="dashboard-starter">
                <div class="dashboard-starter__head">
                  <span>今天建议</span>
                  <strong>先做最容易开始的一步</strong>
                </div>

                <div class="dashboard-starter__list">
                  <article v-for="item in dashboardActionItems" :key="item.title" class="dashboard-starter__item dashboard-starter__item--current">
                    <span class="dashboard-starter__dot"></span>
                    <div>
                      <strong>{{ item.title }}</strong>
                      <p>{{ item.desc }}</p>
                    </div>
                    <router-link :to="item.to" class="dashboard-inline-link">前往</router-link>
                  </article>
                </div>
              </div>
            </div>

            <aside class="dashboard-focus-card">
              <div class="dashboard-focus-card__head">
                <span class="section-kicker">最近学习摘要</span>
                <span class="dashboard-focus-card__badge">{{ dashboardPrimaryPathCard.badge }}</span>
              </div>

              <h2>{{ dashboardPrimaryPathCard.title }}</h2>
              <p>{{ dashboardPrimaryPathCard.summary }}</p>

              <div class="dashboard-focus-card__stack">
                <article class="dashboard-focus-item">
                  <span>预计投入</span>
                  <strong>{{ dashboardPrimaryPathCard.estimatedHours }}</strong>
                  <p>{{ dashboardPrimaryPathCard.deadline }}</p>
                </article>
                <article class="dashboard-focus-item">
                  <span>当前进度</span>
                  <strong>{{ dashboardPrimaryPathCard.milestones }}</strong>
                  <p>{{ dashboardPrimaryPathCard.updatedAt }}</p>
                </article>
                <article class="dashboard-focus-item">
                  <span>下一步</span>
                  <strong>继续上次学习</strong>
                  <p>{{ dashboardPrimaryPathCard.nextStep }}</p>
                </article>
              </div>

              <div class="dashboard-focus-card__actions">
                <router-link to="/ui-lab/paths/1" class="btn btn--primary">查看路径详情</router-link>
              </div>
            </aside>
          </section>

          <section class="dashboard-section">
            <div class="dashboard-section__head">
              <div>
                <span class="section-kicker">学习状态摘要</span>
                <h2>先看状态，再决定今天适不适合继续</h2>
              </div>
              <router-link to="/ui-lab/state" class="dashboard-inline-link">查看完整状态分析</router-link>
            </div>

            <div class="dashboard-overview-grid">
              <article v-for="item in dashboardOverviewCards" :key="item.label" class="dashboard-overview-card" :class="`dashboard-overview-card--${item.tone}`">
                <div class="dashboard-overview-card__head">
                  <span class="dashboard-overview-card__tag">{{ item.tag }}</span>
                </div>
                <strong>{{ item.value }}</strong>
                <span class="dashboard-overview-card__label">{{ item.label }}</span>
                <p>{{ item.hint }}</p>
                <small>{{ item.footer }}</small>
              </article>
            </div>
          </section>

          <section class="dashboard-flow-grid">
            <article class="surface-card dashboard-panel">
              <div class="dashboard-panel__head">
                <div>
                  <span class="section-kicker">流程摩擦与建议</span>
                  <h2>今天最需要留意的地方</h2>
                </div>
                <router-link to="/ui-lab/state" class="dashboard-inline-link">查看状态详情</router-link>
              </div>

              <div class="dashboard-friction-list">
                <article v-for="item in dashboardFrictionSignals" :key="item.title" class="dashboard-friction-card" :class="`dashboard-friction-card--${item.tone}`">
                  <div class="dashboard-friction-card__head">
                    <strong>{{ item.title }}</strong>
                    <span>{{ item.value }}</span>
                  </div>
                  <p>{{ item.desc }}</p>
                </article>
              </div>

              <div class="dashboard-coach-feed">
                <article v-for="item in dashboardCoachFeed" :key="item.title" class="dashboard-coach-card">
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.desc }}</p>
                </article>
              </div>
            </article>

            <article class="surface-card dashboard-panel">
              <div class="dashboard-panel__head">
                <div>
                  <span class="section-kicker">成就激励</span>
                  <h2>最近成就与下一步</h2>
                </div>
                <router-link to="/ui-lab/achievements" class="dashboard-inline-link">查看全部成就</router-link>
              </div>

              <div class="dashboard-achievement-summary">
                <article class="dashboard-achievement-card dashboard-achievement-card--recent">
                  <span class="section-kicker">最近成就</span>
                  <strong>{{ dashboardAchievementSnapshot.recent.title }}</strong>
                  <p>{{ dashboardAchievementSnapshot.recent.desc }}</p>
                  <small>{{ dashboardAchievementSnapshot.recent.xp }}</small>
                </article>

                <article class="dashboard-achievement-card dashboard-achievement-card--next">
                  <span class="section-kicker">下一个成就</span>
                  <strong>{{ dashboardAchievementSnapshot.next.title }}</strong>
                  <p>{{ dashboardAchievementSnapshot.next.desc }}</p>
                  <small>{{ dashboardAchievementSnapshot.next.progress }}</small>
                </article>

                <div class="dashboard-achievement-stats">
                  <article class="dashboard-achievement-stat">
                    <span>累计 XP</span>
                    <strong>{{ dashboardAchievementSnapshot.summary.xp }}</strong>
                  </article>
                  <article class="dashboard-achievement-stat">
                    <span>完成率</span>
                    <strong>{{ dashboardAchievementSnapshot.summary.rate }}</strong>
                  </article>
                  <article class="dashboard-achievement-stat">
                    <span>已解锁</span>
                    <strong>{{ dashboardAchievementSnapshot.summary.unlocked }}</strong>
                  </article>
                </div>
              </div>
            </article>
          </section>
        </section>
      </div>

      <div v-else-if="sceneId === 'login' || sceneId === 'register'" class="auth-page">
        <div class="auth-bg-layer">
          <div class="auth-bg-orb auth-bg-orb--1"></div>
          <div class="auth-bg-orb auth-bg-orb--2"></div>
          <div class="auth-bg-grid"></div>
        </div>

        <section class="auth-shell">
          <aside class="auth-brand">
            <div class="auth-brand__content">
              <span class="auth-brand__eyebrow">问流 WenFlow</span>
              <h1>{{ sceneId === 'login' ? '问流 WenFlow' : '开始你的第一次目标规划' }}</h1>
              <p>{{ sceneId === 'login' ? '不是先找课，而是先找到真正的问题。' : '从一个模糊目标开始，进入真正的学习过程。' }}</p>

              <div class="auth-brand__points">
                <article v-for="item in (sceneId === 'login' ? authLoginPoints : authRegisterPoints)" :key="item.title" class="auth-point">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.desc }}</span>
                </article>
              </div>
            </div>
          </aside>

          <div class="auth-panel">
            <div class="auth-card">
              <div class="auth-card__header">
                <span class="auth-card__pill">{{ sceneId === 'login' ? '登录' : '注册' }}</span>
                <h2>{{ sceneId === 'login' ? '欢迎回来' : '创建账号' }}</h2>
                <p>{{ sceneId === 'login' ? '登录账号，继续你的学习过程' : '创建账号，开始你的第一次目标规划' }}</p>
              </div>

              <form class="auth-form" @submit.prevent>
                <label class="auth-field">
                  <span>用户名</span>
                  <input type="text" :value="sceneId === 'login' ? authLoginForm.name : authRegisterForm.name" placeholder="请输入用户名" />
                </label>

                <label class="auth-field">
                  <span>密码</span>
                  <input type="password" placeholder="请输入密码" />
                </label>

                <label v-if="sceneId === 'register'" class="auth-field">
                  <span>确认密码</span>
                  <input type="password" placeholder="请再次输入密码" />
                </label>

                <div v-if="sceneId === 'login'" class="auth-meta">
                  <label class="auth-checkbox">
                    <input type="checkbox" :checked="authLoginForm.remember" />
                    <span>记住我</span>
                  </label>
                </div>

                <div v-if="sceneId === 'register'" class="auth-hint">密码至少 8 位，建议同时包含字母和数字。</div>

                <div class="auth-actions">
                  <router-link to="/ui-lab/dashboard" class="btn btn--primary btn--lg auth-submit" @click="setAuthPreviewState('registered')">{{ sceneId === 'login' ? '登录并继续' : '注册并开始' }}</router-link>
                </div>

                <div class="auth-switch">
                  <span>{{ sceneId === 'login' ? '还没有账号？' : '已有账号？' }}</span>
                  <router-link :to="sceneId === 'login' ? '/ui-lab/register' : '/ui-lab/login'">{{ sceneId === 'login' ? '立即注册' : '立即登录' }}</router-link>
                </div>
              </form>
            </div>
          </div>
        </section>
      </div>

      <div v-else-if="sceneId === 'evaluation'" class="feedback-page">
        <div class="feedback-bg-layer">
          <div class="feedback-bg-orb feedback-bg-orb--1"></div>
        </div>

        <section class="workbench-scene-shell">
          <section class="feedback-wrapup-hero surface-card">
            <div class="app-page-head__top">
              <span class="pill">{{ workbenchSceneMeta.pill }}</span>
              <div class="app-page-head__actions">
                <router-link :to="workbenchSceneMeta.primaryAction.to" class="btn btn--primary">{{ workbenchSceneMeta.primaryAction.label }}</router-link>
                <router-link :to="workbenchSceneMeta.secondaryAction.to" class="btn btn--ghost">{{ workbenchSceneMeta.secondaryAction.label }}</router-link>
              </div>
            </div>

            <div class="app-page-head__intro">
              <h1>这一节已经完成，下面是本次学习的总结与下一步建议。</h1>
              <p>你刚刚结束的是一次围绕“异常处理与日志记录”的学习会话。这里不是长期画像，而是这节课刚结束后的课后总结页。</p>
            </div>

            <div class="app-page-head__summary">
              <article v-for="item in evaluationSummaryCards" :key="item.label" class="app-page-head__summary-card">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </article>
            </div>
          </section>
        </section>

        <section class="feedback-metrics-row">
          <article v-for="item in evaluationSessionMetrics" :key="item.label" class="feedback-metric-card">
            <span class="feedback-metric-card__label">{{ item.label }}</span>
            <strong class="feedback-metric-card__value">{{ item.value }}</strong>
            <p>{{ item.desc }}</p>
          </article>
        </section>

        <section class="feedback-profile">
          <div class="feedback-profile__inner">
            <h2>主题总结</h2>
            <div class="feedback-profile__items">
              <article class="feedback-profile__item">
                <p>{{ evaluationWrapup.summary.topicSummary }}</p>
              </article>
            </div>
          </div>
        </section>

        <section class="feedback-risks">
          <div class="feedback-risks__inner">
            <h2>本节进展</h2>
            <div class="feedback-risks__items">
              <article v-for="item in evaluationWrapup.progress.newlyMastered" :key="item" class="feedback-risk-item feedback-risk-item--success">
                <strong>本节新收获</strong>
                <p>{{ item }}</p>
              </article>
              <article v-for="item in evaluationWrapup.progress.stillLearning" :key="item" class="feedback-risk-item">
                <strong>仍在推进中</strong>
                <p>{{ item }}</p>
              </article>
            </div>
          </div>
        </section>

        <section class="feedback-metrics-row feedback-metrics-row--longterm">
          <article v-for="item in evaluationLongTermMetrics" :key="item.label" class="feedback-metric-card feedback-metric-card--subtle">
            <span class="feedback-metric-card__label">{{ item.label }}</span>
            <strong class="feedback-metric-card__value">{{ item.value }}</strong>
            <p>{{ item.desc }}</p>
          </article>
        </section>

        <section class="feedback-profile">
          <div class="feedback-profile__inner">
            <h2>知识点掌握</h2>
            <div class="feedback-profile__items">
              <article v-for="item in evaluationKnowledge" :key="item.title" class="feedback-profile__item">
                <strong>{{ item.title }} · {{ item.badge }}</strong>
                <p>{{ item.evidence }}</p>
              </article>
            </div>
          </div>
        </section>

        <section class="feedback-risks">
          <div class="feedback-risks__inner">
            <h2>关键收获</h2>
            <div class="feedback-risks__items">
              <article v-for="item in evaluationTakeaways" :key="item" class="feedback-risk-item">
                <p>{{ item }}</p>
              </article>
            </div>
          </div>
        </section>

        <section class="feedback-next">
          <div class="feedback-next__inner">
            <h2>本周行动</h2>
            <div class="feedback-next__timeline">
              <article v-for="(item, idx) in evaluationActions" :key="item" class="feedback-next-step" :class="`feedback-next-step--${idx}`">
                <div class="feedback-next-step__node">
                  <span>{{ idx + 1 }}</span>
                </div>
                <div class="feedback-next-step__body">
                  <strong>下一步 {{ idx + 1 }}</strong>
                  <p>{{ item }}</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section class="feedback-profile feedback-profile--notes">
          <div class="feedback-profile__inner">
            <h2>学习评价</h2>
            <div class="feedback-profile__items">
              <article v-for="item in evaluationNotes" :key="item.title" class="feedback-profile__item">
                <strong>{{ item.title }}</strong>
                <p>{{ item.desc }}</p>
              </article>
            </div>
          </div>
        </section>
      </div>

      <div v-else-if="sceneId === 'requirement'" class="planning-page">
        <div class="planning-bg-layer">
          <div class="planning-bg-orb planning-bg-orb--1"></div>
        </div>

        <section class="workbench-scene-shell planning-page-shell">
          <section class="planning-topbar planning-topbar--final surface-card">
            <div class="planning-topbar__main planning-topbar__main--final">
              <span class="pill">{{ workbenchSceneMeta.pill }}</span>
              <div>
                <h1>目标规划</h1>
                <p>先把问题说清楚，再决定第一步怎么开始。</p>
              </div>
            </div>
            <div class="planning-topbar__actions planning-topbar__actions--final">
              <span class="planning-stage-pill" :class="`planning-stage-pill--${planningStage.tone}`">{{ planningStage.label }}</span>
              <router-link :to="workbenchSceneMeta.secondaryAction.to" class="btn btn--ghost">{{ workbenchSceneMeta.secondaryAction.label }}</router-link>
              <router-link :to="workbenchSceneMeta.primaryAction.to" class="btn btn--primary">{{ workbenchSceneMeta.primaryAction.label }}</router-link>
            </div>
          </section>

          <section class="planning-layout planning-layout--final">
          <aside class="planning-panel planning-panel--status surface-card">
            <div class="planning-panel__head">
              <span class="section-kicker">收敛进度</span>
              <h2>已确认信息</h2>
            </div>

            <div class="planning-status-stack">
              <span class="planning-status-item planning-status-item--current">{{ planningStage.title }}</span>
              <span class="planning-status-item">{{ planningStage.label }}</span>
              <span class="planning-status-item planning-status-item--ghost">可生成路径</span>
            </div>

            <div class="planning-understand__meter">
              <span>理解度</span>
              <div class="planning-meter-bar">
                <div class="planning-meter-bar__fill" :style="{ width: `${planningConfidence}%` }"></div>
              </div>
              <strong>{{ planningConfidence }}%</strong>
            </div>

            <div class="planning-confirmed-block">
              <span class="planning-block-label">已确认信息</span>
              <div class="planning-understand__signals">
                <article v-for="sig in planningSignals" :key="sig.label" class="planning-signal">
                  <span>{{ sig.label }}</span>
                  <strong>{{ sig.value }}</strong>
                </article>
              </div>
            </div>

            <div class="planning-understand__constraints">
              <span v-for="c in planningConstraints" :key="c" class="planning-constraint">{{ c }}</span>
            </div>

            <div class="planning-confirmed-block">
              <span class="planning-block-label">待确认信息</span>
              <div class="planning-pending__list">
                <article v-for="item in planningPendingDetails" :key="item.title" class="planning-pending-card planning-pending-card--compact">
                  <strong>{{ item.title }}</strong>
                </article>
              </div>
            </div>
          </aside>

          <div class="planning-conversation planning-conversation--final surface-card">
            <div class="planning-conversation__head planning-conversation__head--final">
              <div>
                <span class="section-kicker">对话工作区</span>
                <h2>围绕一个真实问题继续追问，直到它足够具体地变成路径。</h2>
              </div>
              <div class="planning-conversation__meta">
                <span class="planning-stage-pill" :class="`planning-stage-pill--${planningStage.tone}`">问题澄清</span>
                <span class="planning-conversation__hint">当前要确认：第一次要交付的结果是什么？</span>
              </div>
            </div>

            <div class="planning-start-card">
              <div class="planning-start-card__copy">
                <span class="planning-start-card__role">AI 规划师</span>
                <strong>先告诉我，你现在最想解决的是什么问题。</strong>
                <p>不需要一开始就说得很准确。可以先描述你眼前最真实的麻烦、想达成的结果，或者你现在卡住的地方。</p>
              </div>
              <div class="planning-start-card__examples">
                <span v-for="item in planningEntryPrompts" :key="item" class="planning-start-card__example">{{ item }}</span>
              </div>
            </div>

            <div class="planning-composer planning-composer--final planning-composer--entry">
              <div class="planning-composer__suggestions">
                <span v-for="item in planningExamplePrompts" :key="item" class="planning-composer__suggestion">{{ item }}</span>
              </div>
              <div class="planning-composer__box planning-composer__box--final">
                <textarea rows="3" readonly>我现在真正要解决的是每周 Excel 周报太耗时间，希望先自动化一段最常用流程。</textarea>
                <button class="btn btn--primary">发送</button>
              </div>
            </div>

            <div class="planning-messages">
              <article v-for="msg in planningMessages" :key="msg.text" class="planning-msg" :class="`planning-msg--${msg.role}`">
                <div class="planning-msg__meta">
                  <span class="planning-msg__role">{{ msg.role === 'ai' ? 'AI 规划师' : '你' }}</span>
                  <small>{{ msg.time }}</small>
                </div>
                <p>{{ msg.text }}</p>
                <div v-if="msg.role === 'ai' && msg.quickReplies?.length" class="planning-replies">
                  <span v-for="r in msg.quickReplies" :key="r" class="planning-reply-chip">{{ r }}</span>
                </div>
              </article>
            </div>

            <div class="planning-selected-strip">
              <span class="planning-selected-strip__label">已选补充</span>
              <div class="planning-selected-strip__items">
                <span v-for="item in planningSelectedReplies" :key="item" class="planning-selected-reply">{{ item }}</span>
              </div>
            </div>

            <div class="planning-proposal planning-proposal--pending">
              <div class="planning-proposal__head">
                <strong>阶段成果：初步学习方向</strong>
                <span>核心问题：{{ planningProposal.problem }}</span>
              </div>
              <p class="planning-proposal__transition">已经确认目标、约束、基础和时间窗口，现在可以生成第一版学习路径。</p>
              <div class="planning-proposal__stages">
                <article v-for="stage in planningStages" :key="stage.title" class="planning-proposal__stage">
                  <strong>{{ stage.title }}</strong>
                  <p>{{ stage.desc }}</p>
                </article>
              </div>
              <div class="planning-proposal__actions">
                <button class="btn btn--primary">确认并生成路径</button>
                <button class="btn btn--ghost">继续补充</button>
              </div>
            </div>

          </div>

          <aside class="planning-panel planning-panel--mirror surface-card">
            <div class="planning-panel__head">
              <span class="section-kicker">还需确认</span>
              <h2>AI 还需要确认什么</h2>
            </div>

            <div class="planning-pending">
              <div class="planning-pending__list">
                <article v-for="item in planningPendingDetails" :key="item.title" class="planning-pending-card">
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.desc }}</p>
                </article>
              </div>
            </div>

            <div class="planning-risk-list">
              <article v-for="item in planningRiskNotes" :key="item.title" class="planning-risk-card">
                <strong>{{ item.title }}</strong>
                <p>{{ item.desc }}</p>
              </article>
            </div>
          </aside>
          </section>
        </section>
      </div>

      <div v-else-if="sceneId === 'paths'" class="paths-page">
        <div class="paths-bg-layer">
          <div class="paths-bg-orb paths-bg-orb--1"></div>
        </div>

        <section class="workbench-scene-shell">
          <section class="paths-hero surface-card">
            <div class="paths-hero__copy">
              <span class="pill">路径总览</span>
              <h1>看见每一条路径的状态，<br />学习才不会中断。</h1>
              <p>推进中的继续走，生成中的等待完成，失败的及时重试，优先从最近在学的那条继续。</p>
            </div>
            <div class="paths-hero__actions">
              <router-link to="/ui-lab/paths/1" class="btn btn--primary">继续上次学习</router-link>
              <router-link to="/ui-lab/planning" class="btn btn--ghost">开始新规划</router-link>
            </div>
          </section>
        </section>

        <section class="paths-filter-row">
          <button
            v-for="item in pathFilterChips"
            :key="item.label"
            type="button"
            class="paths-filter-chip"
            :class="{ 'paths-filter-chip--active': activePathFilter === item.key }"
            @click="activePathFilter = item.key"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.count }}</strong>
          </button>
        </section>

        <section class="paths-grid">
          <article v-for="path in visiblePathCards" :key="path.name" class="path-card" :class="[`path-card--${path.state}`, { 'path-card--primary': path.isPrimary }]">
            <div v-if="path.state === 'generating'" class="path-card__generating">
              <div class="path-card__status-row">
                <span class="path-card__state-pill path-card__state-pill--generating">生成中</span>
              </div>
              <strong>{{ path.name }}</strong>
              <p>AI 正在生成学习路径</p>
              <div class="path-card__progress-bar">
                <div class="path-card__progress-fill"></div>
              </div>
              <div class="path-card__actions-row">
                <button class="btn btn--ghost">查看进度</button>
                <button class="btn btn--ghost">取消</button>
              </div>
            </div>

            <div v-else-if="path.state === 'failed'" class="path-card__failed">
              <div class="path-card__status-row">
                <span class="path-card__state-pill path-card__state-pill--failed">待重试</span>
              </div>
              <strong>{{ path.name }}</strong>
              <p>{{ path.error }}</p>
              <div class="path-card__actions-row">
                <button class="btn btn--ghost">重试</button>
                <router-link to="/ui-lab/planning" class="btn btn--ghost">回到规划</router-link>
              </div>
            </div>

            <div v-else class="path-card__active">
              <div class="path-card__status-row">
                <span v-if="path.isPrimary" class="path-card__state-pill path-card__state-pill--primary">最近在学</span>
                <span class="path-card__state-pill path-card__state-pill--active">进行中</span>
              </div>
              <div class="path-card__head">
                <strong>{{ path.name }}</strong>
              </div>
              <p>{{ path.summary }}</p>
              <div class="path-card__stats">
                <span>当前阶段：{{ path.currentStage }} / {{ path.stages }}</span>
                <span>预计投入：{{ path.hours }} 小时</span>
              </div>
              <div class="path-card__progress-block">
                <div class="path-card__progress-top">
                  <strong>{{ path.progress }}%</strong>
                  <span>进度</span>
                </div>
                <div class="path-card__progress-bar">
                  <div class="path-card__progress-fill" :style="{ width: `${path.progress}%` }"></div>
                </div>
              </div>
              <div class="path-card__actions-row">
                <router-link to="/ui-lab/paths/1" class="btn btn--primary">继续推进</router-link>
                <router-link to="/ui-lab/paths/1" class="btn btn--ghost">查看详情</router-link>
              </div>
            </div>
          </article>
        </section>
      </div>

      <div v-else-if="sceneId === 'path-detail'" class="path-detail-page">
        <div class="path-detail-bg-layer">
          <div class="path-detail-bg-orb path-detail-bg-orb--1"></div>
        </div>

        <section class="workbench-scene-shell">
          <section class="path-detail-hero surface-card">
            <div class="path-detail-hero__copy">
              <div class="path-detail-hero__tags">
                <span class="pill">最近在学</span>
                <span class="path-detail-hero__tag">进行中</span>
                <span class="path-detail-hero__tag">自动化提效</span>
              </div>
              <h1>Python 自动化提效</h1>
              <p>从 Excel 清洗到日志与异常处理，围绕每周真实报表场景推进，让每周重复劳动真正被替换掉。</p>
              <div class="path-detail-overview-grid">
                <article v-for="item in pathDetailMeta" :key="item.label" class="path-detail-overview-card">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                </article>
              </div>
            </div>

            <div class="path-detail-hero__progress">
              <div class="path-detail-progress__ring">
                <svg viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(52,120,246,0.08)" stroke-width="8" />
                  <circle cx="60" cy="60" r="52" fill="none" stroke="url(#path-ring)" stroke-width="8" stroke-linecap="round" stroke-dasharray="327" :stroke-dashoffset="327 * (1 - pathDetailProgress / 100)" transform="rotate(-90 60 60)" />
                  <defs>
                    <linearGradient id="path-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#3478f6" />
                      <stop offset="100%" stop-color="#8d6bff" />
                    </linearGradient>
                  </defs>
                </svg>
                <div class="path-detail-progress__ring-label">
                  <strong>{{ pathDetailProgress }}%</strong>
                  <span>总进度</span>
                </div>
              </div>
              <router-link to="/ui-lab/learn/task-1" class="btn btn--primary btn--lg">继续学习</router-link>
            </div>
          </section>
        </section>

        <section class="path-detail-main-grid">
          <div class="path-detail-stages">
            <article v-for="stage in pathStages" :key="stage.title" class="surface-card path-stage-card">
              <div class="path-stage-card__head">
                <div>
                  <span class="section-kicker">{{ stage.label }}</span>
                  <h2>{{ stage.title }}</h2>
                </div>
                <span class="path-stage-card__badge" :class="`path-stage-card__badge--${stage.tone}`">{{ stage.badge }}</span>
              </div>

              <p class="path-stage-card__summary">{{ stage.summary }}</p>

              <div class="path-stage-card__tasks">
                <article v-for="task in stage.tasks" :key="task.title" class="path-stage-task">
                  <div class="path-stage-task__head">
                    <div>
                      <strong>{{ task.title }}</strong>
                      <p>{{ task.note }}</p>
                    </div>
                    <span class="path-stage-task__badge" :class="`path-stage-task__badge--${task.tone}`">{{ task.badge }}</span>
                  </div>

                  <div class="path-stage-task__meta">
                    <span>{{ task.taskType }}</span>
                    <span>预计 {{ task.estimatedMinutes }} 分钟</span>
                    <span>{{ task.ability }}</span>
                  </div>

                  <div class="path-stage-task__foot">
                    <span class="path-stage-task__status">{{ task.statusLabel }}</span>
                    <router-link v-if="task.actionTo" :to="task.actionTo" class="btn btn--ghost">{{ task.actionLabel }}</router-link>
                    <button v-else class="btn btn--ghost" :disabled="task.badge === '锁定'">{{ task.actionLabel }}</button>
                  </div>
                </article>
              </div>
            </article>
          </div>

          <aside class="path-detail-sidebar">
            <article class="surface-card path-detail-side-card">
              <div class="path-detail-side-card__head">
                <span class="section-kicker">本周先这样走</span>
                <h2>本周先这样走</h2>
              </div>
              <div class="path-detail-side-card__time">预计总投入：65 分钟</div>
              <ul class="path-detail-note-list">
                <li v-for="item in pathDetailNotes" :key="item">{{ item }}</li>
              </ul>
            </article>

            <article class="surface-card path-detail-side-card">
              <div class="path-detail-side-card__head">
                <span class="section-kicker">下一步</span>
                <h2>当前最值得先完成的任务</h2>
              </div>
              <div class="path-detail-plan-list">
                <article v-for="item in pathDetailPlan" :key="item.title" class="path-detail-plan-item">
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.desc }}</p>
                </article>
              </div>
              <router-link to="/ui-lab/learn/task-1" class="btn btn--primary btn--full">开始学习</router-link>
            </article>

            <article class="surface-card path-detail-side-card path-detail-side-card--light">
              <div class="path-detail-side-card__head">
                <span class="section-kicker">节奏提示</span>
                <h2>当前建议学习节奏</h2>
              </div>
              <div class="path-detail-plan-list">
                <article class="path-detail-plan-item">
                  <strong>单次 20-25 分钟</strong>
                  <p>优先把一个任务完整收口，再继续下一个步骤。</p>
                </article>
                <article class="path-detail-plan-item">
                  <strong>当前阶段先别扩新功能</strong>
                  <p>先把异常处理和日志做稳，再进入第三阶段。</p>
                </article>
              </div>
            </article>
          </aside>
        </section>
      </div>

      <div v-else-if="sceneId === 'state'" class="state-page">
        <section class="workbench-scene-shell state-page-shell">
          <section class="app-page-head surface-card state-hero">
            <div class="app-page-head__top">
              <span class="pill">学习状态</span>
              <div class="app-page-head__actions">
                <router-link to="/ui-lab/learn/task-1" class="btn btn--primary">继续当前任务</router-link>
                <router-link to="/ui-lab/dashboard" class="btn btn--ghost">回到学习台</router-link>
              </div>
            </div>

            <div class="app-page-head__intro">
              <h1>看见最近的学习状态，再决定下一步怎么学。</h1>
              <p>这里会汇总你的学习节奏、掌握情况和疲劳变化，帮助你判断要继续推进，还是先放慢一点。</p>
            </div>
          </section>
        </section>

        <section class="state-metrics-grid">
          <article v-for="item in stateDetailMetrics" :key="item.label" class="state-metric-card" :class="`state-metric-card--${item.tone}`">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <p>{{ item.note }}</p>
          </article>
        </section>

        <section class="state-layout">
          <article class="surface-card state-trend-panel">
            <div class="state-panel__head">
              <span class="section-kicker">趋势图</span>
              <h2>最近状态变化</h2>
            </div>
            <div class="state-trend-chart">
              <article v-for="item in stateTrendSeries" :key="item.time" class="state-trend-chart__col">
                <span>{{ item.time }}</span>
                <div class="state-trend-chart__bars">
                  <i class="state-trend-chart__bar state-trend-chart__bar--lsb" :style="{ height: `${40 + Number(item.lsb.replace('+', '')) * 10}px` }"></i>
                  <i class="state-trend-chart__bar state-trend-chart__bar--lss" :style="{ height: `${Number(item.lss) * 12}px` }"></i>
                  <i class="state-trend-chart__bar state-trend-chart__bar--ktl" :style="{ height: `${Number(item.ktl) * 10}px` }"></i>
                  <i class="state-trend-chart__bar state-trend-chart__bar--lf" :style="{ height: `${Number(item.lf) * 12}px` }"></i>
                </div>
                <small>{{ item.lsb }}</small>
              </article>
            </div>
          </article>

          <aside class="state-side-panels">
            <article v-for="item in stateInsightCards" :key="item.title" class="surface-card state-insight-card" :class="`state-insight-card--${item.tone}`">
              <div class="state-panel__head">
                <span class="section-kicker">{{ item.title }}</span>
              </div>
              <p>{{ item.desc }}</p>
            </article>
          </aside>
        </section>
      </div>

      <div v-else-if="sceneId === 'achievements'" class="achievements-page-new">
        <section class="workbench-scene-shell achievements-page-shell">
          <section class="app-page-head surface-card achievements-hero">
            <div class="app-page-head__top">
              <span class="pill">成就</span>
              <div class="app-page-head__actions">
                <router-link to="/ui-lab/dashboard" class="btn btn--primary">回到学习台</router-link>
                <router-link to="/ui-lab/paths" class="btn btn--ghost">查看学习路径</router-link>
              </div>
            </div>

            <div class="app-page-head__intro">
              <h1>把学习过程变成看得见的里程碑。</h1>
              <p>这里记录你已经完成的任务、路径、复盘和持续学习，不用只靠感觉判断自己有没有前进。</p>
            </div>
          </section>
        </section>

        <section class="achievement-overview-grid">
          <article v-for="item in achievementOverviewCards" :key="item.label" class="achievement-overview-card" :class="`achievement-overview-card--${item.tone}`">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <p>{{ item.note }}</p>
          </article>
        </section>

        <section class="achievement-filter-row">
          <div class="achievement-filter-tabs">
            <button class="achievement-filter-chip achievement-filter-chip--active">全部</button>
            <button class="achievement-filter-chip">已解锁</button>
            <button class="achievement-filter-chip">接近解锁</button>
            <button class="achievement-filter-chip">未开始</button>
          </div>
          <div class="achievement-filter-tags">
            <button v-for="item in achievementCategories" :key="item" class="achievement-filter-chip achievement-filter-chip--tag">{{ item }}</button>
          </div>
        </section>

        <section class="achievement-spotlight-grid">
          <article class="achievement-spotlight-card achievement-spotlight-card--recent surface-card">
            <span class="section-kicker">{{ achievementSpotlight.recent.title }}</span>
            <strong>{{ achievementSpotlight.recent.name }}</strong>
            <p>{{ achievementSpotlight.recent.desc }}</p>
            <div class="achievement-spotlight-card__foot">
              <span>{{ achievementSpotlight.recent.xp }}</span>
              <small>{{ achievementSpotlight.recent.earnedAt }}</small>
            </div>
          </article>

          <article class="achievement-spotlight-card achievement-spotlight-card--next surface-card">
            <span class="section-kicker">{{ achievementSpotlight.next.title }}</span>
            <strong>{{ achievementSpotlight.next.name }}</strong>
            <p>{{ achievementSpotlight.next.desc }}</p>
            <div class="achievement-spotlight-card__foot">
              <span>{{ achievementSpotlight.next.progress }}</span>
              <router-link :to="achievementSpotlight.next.actionTo" class="btn btn--ghost">{{ achievementSpotlight.next.actionLabel }}</router-link>
            </div>
          </article>
        </section>

        <section class="achievement-stack">
          <div class="achievement-stack__head">
            <span class="section-kicker">已解锁</span>
            <h2>这些成就已经被你拿下</h2>
          </div>
          <section class="achievement-card-grid achievement-card-grid--unlocked">
            <article v-for="item in unlockedAchievementCards" :key="item.title" class="achievement-card-new achievement-card-new--unlocked surface-card">
              <div class="achievement-card-new__icon">{{ item.icon }}</div>
              <div class="achievement-card-new__head">
                <strong>{{ item.title }}</strong>
                <span>{{ item.xp }}</span>
              </div>
              <p>{{ item.desc }}</p>
              <div class="achievement-card-new__foot">
                <small>{{ item.category }}</small>
                <small>{{ item.earnedAt }}</small>
              </div>
            </article>
          </section>
        </section>

        <section class="achievement-stack">
          <div class="achievement-stack__head">
            <span class="section-kicker">接近解锁与未开始</span>
            <h2>下一批最值得继续追的成就</h2>
          </div>
          <section class="achievement-card-grid">
            <article v-for="item in pendingAchievementCards" :key="item.title" class="achievement-card-new" :class="`achievement-card-new--${item.status}`">
              <div class="achievement-card-new__icon">{{ item.icon }}</div>
              <div class="achievement-card-new__head">
                <strong>{{ item.title }}</strong>
                <span>{{ item.xp }}</span>
              </div>
              <p>{{ item.desc }}</p>
              <div class="achievement-card-new__progress" v-if="item.progressDetail">
                <div class="achievement-card-new__progress-top">
                  <span>进度</span>
                  <strong>{{ item.progressDetail.percentage }}%</strong>
                </div>
                <div class="achievement-card-new__progress-bar">
                  <div class="achievement-card-new__progress-fill" :style="{ width: `${item.progressDetail.percentage}%` }"></div>
                </div>
                <small>{{ item.progressDetail.current }} / {{ item.progressDetail.total }}</small>
              </div>
              <div class="achievement-card-new__foot">
                <small>{{ item.category }}</small>
                <small>{{ item.progress }}</small>
              </div>
              <router-link :to="item.actionTo" class="btn btn--ghost achievement-card-new__action">{{ item.actionLabel }}</router-link>
            </article>
          </section>
        </section>
      </div>

      <div v-else-if="sceneId === 'learning'" class="learning-page">
        <section class="learning-shell">
          <section class="learning-hero surface-card">
            <div class="learning-hero__top">
              <div class="learning-hero__title">
                <span class="pill">当前任务</span>
                <h1>异常处理与日志记录</h1>
              </div>
              <div class="learning-hero__actions">
                <router-link to="/ui-lab/feedback" class="btn btn--primary">结束后查看反馈</router-link>
                <router-link to="/ui-lab/paths/1" class="btn btn--ghost">返回路径详情</router-link>
              </div>
            </div>

            <div class="learning-hero__summary">
              <p>这一页只围绕当前任务推进。目标不是泛泛理解语法，而是把异常处理和日志记录真正接回你的真实工作场景。</p>
              <div class="learning-hero__meta">
                <span>阶段 2 / 3</span>
                <span>授课中</span>
                <span>预计 18 分钟</span>
              </div>
            </div>
          </section>

          <section class="learning-topbar learning-topbar--independent">
            <div class="learning-topbar__left">
              <span class="learning-topbar__route">Python 自动化提效 / 当前任务</span>
            </div>
            <div class="learning-topbar__center">
              <strong>先完成这一节，再进入下一步</strong>
            </div>
            <div class="learning-topbar__right">
              <span class="learning-topbar__status">学习执行中</span>
            </div>
          </section>
        </section>

        <section class="learning-layout">
          <aside class="learning-sidebar">
            <div class="learning-sidebar__progress surface-card">
              <div class="learning-sidebar__head">
                <strong>本节学习进度</strong>
              </div>
              <div class="learning-sidebar__progress-bar">
                <div class="learning-sidebar__progress-fill" style="width: 40%"></div>
              </div>
              <div class="learning-sidebar__progress-meta">
                <span>2 / 5 知识点推进中</span>
                <strong>当前焦点：日志记录</strong>
              </div>
            </div>

            <div class="learning-sidebar__nav">
              <article v-for="kp in learningKnowledgePointsData" :key="kp.id" class="learning-kp" :class="[`learning-kp--${kp.status}`, { 'learning-kp--current': kp.current }]">
                <div class="learning-kp__head">
                  <span class="learning-kp__order">{{ kp.order }}</span>
                  <div class="learning-kp__title-group">
                    <strong>{{ kp.title }}</strong>
                    <small>{{ kp.name }}</small>
                  </div>
                  <span class="learning-kp__state">{{ kp.badge }}</span>
                </div>
                <div class="learning-kp__bar">
                  <div class="learning-kp__fill" :style="{ width: kp.progress + '%' }"></div>
                </div>
                <p class="learning-kp__desc">{{ kp.desc }}</p>
                <div v-if="kp.children?.length" class="learning-kp__children">
                  <article v-for="child in kp.children" :key="child.id" class="learning-kp__child" :class="`learning-kp__child--${child.status}`">
                    <span class="learning-kp__child-dot"></span>
                    <span>{{ child.title }}</span>
                  </article>
                </div>
              </article>
            </div>

            <div class="learning-sidebar__tip surface-card">
              <span class="section-kicker">下一步</span>
              <p>先完成“应该记录哪些字段”，再进入小检核。</p>
            </div>
          </aside>

          <div class="learning-main">
            <div class="learning-messages">
              <article v-for="msg in learningConversationMessages" :key="msg.content" class="learning-msg" :class="`learning-msg--${msg.role}`">
                <span class="learning-msg__role">{{ msg.author }}</span>
                <p>{{ msg.content }}</p>
                <div v-if="msg.tags?.length" class="learning-msg__tags">
                  <span v-for="tag in msg.tags" :key="tag">{{ tag }}</span>
                </div>
              </article>
            </div>

            <div class="learning-quiz-card">
              <div class="learning-quiz-card__head">
                <span class="section-kicker">小检核</span>
                <strong>如果脚本遇到异常，最合理的处理方式是什么？</strong>
              </div>
              <div class="learning-quiz-card__options">
                <label v-for="option in learningQuizOptions" :key="option.label" class="learning-quiz-option" :class="{ 'learning-quiz-option--selected': option.selected }">
                  <span class="learning-quiz-option__label">{{ option.label }}</span>
                  <span>{{ option.text }}</span>
                </label>
              </div>
            </div>

            <div class="learning-completion">
              <span>✅ 已达到课程完成条件</span>
              <div class="learning-completion__actions">
                <router-link to="/ui-lab/feedback" class="btn btn--primary">结束并评估</router-link>
                <button class="btn btn--ghost">继续学习</button>
              </div>
            </div>

            <div class="learning-composer">
              <input type="text" placeholder="输入你的想法…" disabled="disabled" />
              <button class="btn btn--primary" disabled="disabled">发送</button>
            </div>
          </div>
        </section>
      </div>

      <DesignLabPreview v-else :theme="theme" :scene="previewScene" :device="device" :device-label="deviceLabel" standalone />
    </main>

    <div class="ui-lab-float" :class="{ 'ui-lab-float--open': labPanelOpen }">
      <button type="button" class="ui-lab-float__trigger" @click="toggleLabPanel" :aria-expanded="labPanelOpen">
        预览模式
      </button>

      <div v-if="labPanelOpen" class="ui-lab-float__panel">
        <div class="ui-lab-float__head">
          <strong>实验控件</strong>
          <small>{{ deviceLabel }} · {{ authPreviewState === 'registered' ? '已注册' : '未注册' }}</small>
        </div>

        <button type="button" class="ui-lab-float__action" @click="toggleDevice">
          {{ device === 'mobile' ? '退出移动版预览' : '移动版预览' }}
        </button>

        <div class="ui-lab-float__group">
          <span class="ui-lab-float__label">身份状态</span>
          <div class="ui-lab-float__switches">
            <button type="button" class="ui-lab-float__chip" :class="{ 'ui-lab-float__chip--active': authPreviewState === 'guest' }" @click="setAuthPreviewState('guest')">
              未注册
            </button>
            <button type="button" class="ui-lab-float__chip" :class="{ 'ui-lab-float__chip--active': authPreviewState === 'registered' }" @click="setAuthPreviewState('registered')">
              已注册
            </button>
          </div>
        </div>

      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import DesignLabPreview from './DesignLabPreview.vue';
import {
  achievementCards,
  achievementCategories,
  achievementOverviewCards,
  achievementSpotlight,
  dashboardAchievementSnapshot,
  dashboardActionItems,
  dashboardCoachFeed,
  dashboardFrictionSignals,
  dashboardMomentumTimeline,
  dashboardOverviewCards,
  dashboardPathRadar,
  dashboardSessionFeed,
  dashboardStatePulse,
  dashboardStateSummary,
  dashboardWelcomeSubtitle,
  evaluationActions,
  evaluationKnowledge,
  evaluationLongTermMetrics,
  evaluationNotes,
  evaluationSessionMetrics,
  evaluationSummaryCards,
  evaluationTakeaways,
  evaluationWrapup,
  learningKnowledgePoints as learningKnowledgePointsData,
  learningMessages as learningConversationMessages,
  learningQuizOptions,
  learningSessionStats,
  pathDetailMeta,
  pathDetailNotes,
  pathDetailPlan,
  pathDetailProgress,
  pathStages,
  scenes,
  stateDetailMetrics,
  stateInsightCards,
  stateTrendSeries,
  themes,
  type DeviceId,
  type SceneId
} from './design-lab.data';

type UILabSceneId = SceneId | 'vision' | 'login' | 'register' | 'state' | 'achievements';

const route = useRoute();
const theme = themes[0];
const device = ref<DeviceId>('desktop');
const authPreviewState = ref<'guest' | 'registered'>('guest');
const labPanelOpen = ref(false);
const homeWhyRef = ref<HTMLElement | null>(null);
const homeHowRef = ref<HTMLElement | null>(null);
const visionProblemsRef = ref<HTMLElement | null>(null);
const homeWhyInView = ref(false);
const homeHowInView = ref(false);
const visionProblemsInView = ref(false);
let homeWhyObserver: IntersectionObserver | null = null;
let homeHowObserver: IntersectionObserver | null = null;
let visionProblemsObserver: IntersectionObserver | null = null;

const demoNav: Array<{ to: string; label: string; sceneId: UILabSceneId }> = [
  { to: '/ui-lab', label: '首页', sceneId: 'home' },
  { to: '/ui-lab/vision', label: '愿景', sceneId: 'vision' }
];

const sceneId = computed<UILabSceneId>(() => (route.meta.uiLabSceneId as UILabSceneId | undefined) ?? 'home');
const previewScene = computed(() => {
  const fallbackId: SceneId = sceneId.value === 'vision' || sceneId.value === 'login' || sceneId.value === 'register' ? 'home' : sceneId.value;
  return scenes.find((item) => item.id === fallbackId) ?? scenes[0];
});
const activeNavSceneId = computed<UILabSceneId>(() => {
  if (sceneId.value === 'path-detail') {
    return 'paths';
  }
  return sceneId.value;
});
const activeWorkbenchNavSceneId = computed<UILabSceneId>(() => {
  if (sceneId.value === 'path-detail') {
    return 'paths';
  }
  return sceneId.value;
});
const appScenes: UILabSceneId[] = ['dashboard', 'requirement', 'paths', 'path-detail', 'state', 'achievements', 'learning', 'evaluation'];
const isAppScene = computed(() => appScenes.includes(sceneId.value));
const activeAppNavSceneId = computed<UILabSceneId>(() => {
  if (sceneId.value === 'path-detail') {
    return 'paths';
  }
  return sceneId.value;
});
const deviceLabel = computed(() => (device.value === 'mobile' ? '移动版预览' : '桌面版预览'));
const navPrimaryPath = computed(() => (authPreviewState.value === 'registered' ? '/ui-lab/planning' : '/ui-lab/register'));
const navSecondaryPath = computed(() => (authPreviewState.value === 'registered' ? '/ui-lab/dashboard' : '/ui-lab/login'));
const navSecondaryLabel = computed(() => (authPreviewState.value === 'registered' ? '学习台预览' : '登录'));
const isRegisteredPreview = computed(() => authPreviewState.value === 'registered');
const dashboardAppNav = [
  { to: '/ui-lab/dashboard', label: '学习台', sceneId: 'dashboard' as const },
  { to: '/ui-lab/planning', label: '目标规划', sceneId: 'requirement' as const },
  { to: '/ui-lab/paths', label: '学习路径', sceneId: 'paths' as const },
  { to: '/ui-lab/state', label: '学习状态', sceneId: 'state' as const },
  { to: '/ui-lab/achievements', label: '成就', sceneId: 'achievements' as const },
  { to: '/ui-lab/feedback', label: '学习反馈', sceneId: 'evaluation' as const }
];
const appHeaderSubtitle = computed(() => {
  if (sceneId.value === 'dashboard') return '当前重点';
  if (sceneId.value === 'requirement') return '问题澄清';
  if (sceneId.value === 'paths') return '路径管理';
  if (sceneId.value === 'path-detail') return '路径详情';
  if (sceneId.value === 'state') return '状态分析';
  if (sceneId.value === 'achievements') return '长期激励';
  if (sceneId.value === 'learning') return '对话学习';
  return '学习反馈';
});
const appUserName = computed(() => (isRegisteredPreview.value ? '林语' : '访客'));
const appUserHint = computed(() => (isRegisteredPreview.value ? '当前身份' : '预览身份'));
const dashboardStatusLabel = computed(() => (isRegisteredPreview.value ? '学习台' : '开始前看看学习台会怎么工作'));
const dashboardHeadline = computed(() => (isRegisteredPreview.value ? '欢迎回来，林语！' : '注册后，你会先从当前重点开始，而不是被一堆内容淹没。'));
const dashboardHeroSubtitle = computed(() => (
  isRegisteredPreview.value
    ? dashboardWelcomeSubtitle
    : '先看清真正值得推进的一步，再慢慢把学习接回整体进度。'
));
const dashboardPrimaryAction = computed(() => (
  isRegisteredPreview.value
    ? { to: '/ui-lab/learn/task-1', label: '继续当前任务' }
    : { to: '/ui-lab/register', label: '注册并进入学习台' }
));
const dashboardSecondaryAction = computed(() => (
  isRegisteredPreview.value
    ? { to: '/ui-lab/planning', label: '开始目标规划' }
    : { to: '/ui-lab/login', label: '已有账号，先登录' }
));
const dashboardStarterProgress = computed(() => (isRegisteredPreview.value ? 1 : 0));
const dashboardStarterSteps = computed(() => [
  {
    label: '先把当前最重要的一条路径定下来',
    note: '先把注意力放在最近在学的那条上，开始会更稳。',
    done: isRegisteredPreview.value,
    current: !isRegisteredPreview.value
  },
  {
    label: '先完成一次完整学习',
    note: '如果最近总是学到一半停下，先把一次学习完整做完。',
    done: false,
    current: isRegisteredPreview.value
  },
  {
    label: '再把这次学习接回整体进度',
    note: '当一次学习真正收口，进度就会更稳定地往前走。',
    done: false,
    current: false
  }
]);
const dashboardPrimaryPathCard = dashboardPathRadar[0];
const unlockedAchievementCards = computed(() => achievementCards.filter((item) => item.unlocked));
const pendingAchievementCards = computed(() => achievementCards.filter((item) => !item.unlocked));

const heroFlowSteps = [
  { role: 'user', text: '"我想学 AI 教育"' },
  { role: 'system', text: '你是想做产品、写文章，还是系统学习？' },
  { role: 'user', text: '我想做一个 AI 学习产品……' },
  { role: 'system', text: '真实目标已识别：设计一个 AI 学习产品' }
];

const whyOld = [
  '更快给你答案和课程列表',
  '按固定路径推送知识点',
  '只关心你记住了多少',
  '聊完就结束'
];

const whyNew = [
  '先帮你定义真正的问题',
  '按目标和约束生成路径',
  '围绕输出和反馈推进学习',
  '持续追踪节奏、掌握度和下一步'
];

const capabilityLight = ['问题定义', '系统思维', '判断力', 'AI 协作', '创造力'];

const howSteps = [
  { title: '提出问题', desc: '说出你想学什么，不要求一开始就准确。' },
  { title: '澄清目标', desc: 'AI 追问你的场景、约束和真实需求。' },
  { title: '生成路径', desc: '把目标拆成阶段、任务和学习节奏。' },
  { title: '对话学习', desc: '围绕真实问题推进，通过输出巩固理解。' },
  { title: '持续反馈', desc: '根据掌握情况调整节奏，决定下一步。' }
];

const previewCards = [
  {
    type: 'goal',
    tab: '目标澄清',
    title: '从模糊到清晰',
    desc: 'AI 追问你的真实场景和约束，把"我想学"翻译成可执行目标。',
    lines: ['已识别目标：设计 AI 学习产品', '约束：每天 1 小时，零基础', '下一步：生成学习路径']
  },
  {
    type: 'path',
    tab: '学习路径',
    title: '阶段化推进',
    desc: '目标拆成阶段和任务，按你的节奏展开，不是一次性排课。',
    lines: ['阶段 1：概念建立（3 天）', '阶段 2：原型设计（5 天）', '阶段 3：迭代验证（7 天）']
  },
  {
    type: 'feedback',
    tab: '学习反馈',
    title: '看得见进步',
    desc: '掌握度、节奏、风险和下一步动作，一页看清。',
    lines: ['本周掌握度：81%', '连续学习：12 天', '建议：补足复盘环节']
  }
];

const authLoginForm = {
  name: 'chenming',
  remember: true
};

const authRegisterForm = {
  name: ''
};

const authLoginPoints = [
  { title: '澄清目标', desc: '先说出你真正想解决的问题，而不是直接找课。' },
  { title: '生成路径', desc: '把模糊目标拆成阶段、任务与学习节奏。' },
  { title: '持续反馈', desc: '在学习中不断修正，看到掌握度与下一步。' }
];

const authRegisterPoints = [
  { title: '定义问题', desc: '从一句模糊想法开始，逐步明确学习目标。' },
  { title: '拆成路径', desc: '让 AI 帮你识别约束，生成可执行的学习路径。' },
  { title: '边学边修正', desc: '在输出与反馈中推进学习，而不是一次性排课。' }
];

const capabilityIconSvgs: Record<string, string> = {
  question: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9.8 9.4a2.4 2.4 0 0 1 4.4 1.2c0 1.6-1.5 2.1-2.2 2.8-.4.4-.5.8-.5 1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1" fill="currentColor"/></svg>',
  system: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2" fill="currentColor"/><circle cx="18" cy="6" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/><path d="M7.7 7.4 10.3 10.6M13.7 10.6 16.3 7.4M10.3 13.4 7.7 16.6M13.7 13.4 16.3 16.6M8 6h8M8 18h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  judgment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M8 8h8M6.5 8 4 13h5l-2.5-5ZM17.5 8 15 13h5l-2.5-5ZM9 20h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  collaboration: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="7" width="6.5" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="7" width="6.5" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 12h2M8 10.5h0M8 13.5h0M16 10.5h0M16 13.5h0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  creativity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5a5.5 5.5 0 0 0-3.4 9.8c.7.6 1.2 1.3 1.5 2.2h3.8c.3-.9.8-1.6 1.5-2.2A5.5 5.5 0 0 0 12 4.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 19h4M10.7 21h2.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
};

const beliefOld = [
  '用 AI 提高传统学习效率',
  '让学生更快记住更多知识',
  '按既定路径完成学习任务',
  '把 AI 当成答案生成器'
];

const beliefNew = [
  '先定义真正的问题',
  '用 AI 澄清目标和约束',
  '在输出和反馈中推进学习',
  '把 AI 当成思维伙伴'
];

const mindsetItems = [
  { title: '看到联系', desc: '识别模式、关联与结构。' },
  { title: '逻辑结构', desc: '把模糊信息组织成系统框架。' },
  { title: '工具选择', desc: '根据场景做判断，而不是死记答案。' },
  { title: '问题定义', desc: '从混乱里提炼真正值得学的问题。' }
];

const toolItems = [
  { title: '语法与步骤', desc: '例如某个循环怎么写。' },
  { title: '标准答案', desc: '例如一道题该怎么答。' },
  { title: '局部技巧', desc: '例如某个工具的快捷方法。' },
  { title: '短期记忆', desc: '例如考试前临时掌握的知识点。' }
];

const givenProblems = [
  '再难也有既定解法',
  '有人知道标准答案',
  '路径与材料已经准备好',
  '最终会被判对或判错'
];

const createdProblems = [
  '没有标准答案，需要自己定义什么是好',
  '边界会不断变化和扩展',
  '没有现成路径，必须自己摸索',
  '没有终点，只有更深的理解'
];

const futureCapabilities = [
  { index: '01', icon: 'question', title: '问题定义能力', desc: '从模糊困惑中提炼出清晰、可探索的问题。', traditional: '知识记忆' },
  { index: '02', icon: 'system', title: '系统思维能力', desc: '看到事物之间的联系和整体结构。', traditional: '单点解题' },
  { index: '03', icon: 'judgment', title: '判断力', desc: '在信息过载中辨别真伪、权衡取舍。', traditional: '标准答案' },
  { index: '04', icon: 'collaboration', title: 'AI 协作力', desc: '与 AI 有效对话，让它成为思维伙伴。', traditional: '独立蛮干' },
  { index: '05', icon: 'creativity', title: '创造力', desc: '跨越边界，产生新的连接和可能性。', traditional: '重复练习' }
];

const feedbackMetrics = [
  { label: '学习连续天数', value: '12 天', note: '节奏稳定，周内波动小。' },
  { label: '任务完成率', value: '86%', note: '3 个任务按时完成，1 个延后。' },
  { label: '概念掌握度', value: '79%', note: '核心概念已掌握，细节需回看。' },
  { label: '迁移应用度', value: '74%', note: '能复述思路，实战应用在上升。' }
];

const weeklyProfile = [
  '你在“先思考后动手”的策略上执行得更稳定，任务启动更快。',
  '对关键概念可以讲清主线，但在边界条件判断上仍会犹豫。',
  '学习时长分布健康，周二与周四是你最有效率的学习窗口。'
];

const riskPoints = [
  '新概念吸收快，但复盘环节偏弱，导致一周后细节遗忘。',
  '遇到复杂题时容易直接查答案，建议先写出 3 分钟思路草稿。',
  '实践任务里“验证假设”的步骤不完整，影响迁移效果。'
];

const nextActions = [
  { title: '回看最近一次实战任务', desc: '只看你的解题过程，补齐“假设 - 验证 - 结论”三段。' },
  { title: '完成 1 次限时口述复盘', desc: '用 5 分钟讲清一个概念给 AI，确认是否真的理解。' },
  { title: '进入下一任务前写下风险点', desc: '提前标注你最可能卡住的地方，降低中途放弃概率。' }
];

const planningChips = ['真实问题', '当前水平', '期望周期', '主要阻碍'];

const planningConfidence = 78;

const planningStages = [
  { title: '阶段 1：看懂输入与输出', desc: '先围绕周报最常见字段，理解脚本到底接什么、产出什么。' },
  { title: '阶段 2：让脚本稳定运行', desc: '补上异常处理、日志和最小验证，避免只能偶尔跑通。' },
  { title: '阶段 3：嵌入真实工作流', desc: '把脚本接进你的周报流程，形成每周可复用的闭环。' }
];

const planningStage = {
  title: '识别问题中',
  label: '理解中',
  note: '核心问题已经比较清楚，但还需要确认场景边界，避免把目标做大。',
  tone: 'primary'
};

const planningRiskNotes = [
  { title: '目标边界还偏大', desc: '如果同时塞进自动化办公和数据分析，两周窗口会明显过紧。' },
  { title: '起步难度需要再压低', desc: '零基础时，先做最常用的一段流程，比一次做完整系统更容易成功。' }
];

const planningSelectedReplies = ['每天只有 1 小时', '零编程基础', '两周内要用'];

const planningExamplePrompts = ['补充真实场景', '说明当前基础', '告诉 AI 时间窗口'];

const planningEntryPrompts = [
  '我想用 Python 自动化 Excel 周报',
  '我想做一个能减轻重复劳动的小工具',
  '我不知道该先学什么，但两周内就要开始用'
];

const planningMirrorSections = [
  { title: '核心问题', value: '每周手动做 Excel 周报', note: '学习路径需要围绕真实工作流，而不是泛泛学 Python。' },
  { title: '学习动机', value: '减少重复劳动，尽快上手', note: '用户更在意立刻可用，而不是系统性学完整个领域。' },
  { title: '当前水平', value: '零编程基础', note: '前两阶段需要明显降低抽象度，优先保证可开始。' },
  { title: '时间预算', value: '每天 1 小时', note: '任务颗粒度要能在 20-30 分钟内收口。' },
  { title: '关键阻碍', value: '不知道先学什么，怕太难', note: '页面需要持续给出下一步，而不是展示很多概念。' },
  { title: '阶段草案', value: '3 个阶段，先闭环再扩展', note: '先做最小闭环，再考虑后续扩路径。' }
];

const planningPendingDetails = [
  { title: '第一次要交付什么', desc: '先确认第一次最小结果是自动化一段周报流程，还是做出完整周报脚本。' },
  { title: '是否马上回到真实工作', desc: '如果本周就要使用，第一阶段就不能同时塞入数据分析内容。' },
  { title: '需要保留哪些人工步骤', desc: '有些校验步骤可能先不自动化，这会影响第一阶段范围。' }
];

const planningProposal = {
  title: '先确认这个方向是否对',
  problem: 'Python 自动化办公',
  note: '如果你确认这是当前最重要的问题，就进入路径生成；如果不是，就继续补充边界。'
};

const planningCurrentTask = {
  title: '继续补齐生成前最后三项信息',
  desc: '现在重点不是再扩展目标，而是确认第一阶段边界、首次可接受结果和真实使用时点。'
};

const planningQuickActions = [
  { label: '补充真实场景', note: '说明周报里最耗时间的一段流程。' },
  { label: '确认起步范围', note: '只做自动化周报，不把数据分析一起塞进来。' },
  { label: '进入路径生成', note: '如果方向已对，就不用继续追问。' }
];

const planningCompletion = {
  title: '规划已完成，可以进入学习路径',
  desc: '系统会基于当前对话生成 3 阶段学习路径，并把本周第一步压缩成可以立刻开始的小任务。',
  problem: '目标：自动化每周 Excel 周报',
  duration: '预计 2-3 周形成稳定闭环'
};

const planningSignals = [
  { label: '真实问题', value: '每周手动做 Excel 周报', note: '这是路径拆解的真正起点。' },
  { label: '当前水平', value: '零编程基础', note: '起步难度需要明显压低。' },
  { label: '期望周期', value: '2 周内上手', note: '每一步都要尽量短、尽量稳。' }
];

const planningConstraints = ['每天只有 1 小时', '零编程基础', '2 周内要用'];

const planningMessages = [
  { role: 'ai', time: '09:41', text: '你是想学 Python 做数据分析，还是先解决现在每周手动做周报的问题？', quickReplies: ['先解决周报', '也想学数据分析', '两个都想做'] },
  { role: 'user', time: '09:42', text: '我想先用 Python 自动化 Excel 周报，每周这件事太耗时间。' },
  { role: 'ai', time: '09:43', text: '明白了。你真正想解决的是重复劳动，而不是先系统学完整门编程。接下来我会围绕时间窗口、当前基础和第一步结果继续确认。', quickReplies: ['每天只有 1 小时', '完全零基础', '两周内要用'] }
];

type PathFilterKey = 'all' | 'active' | 'generating' | 'failed' | 'completed';

const activePathFilter = ref<PathFilterKey>('all');

const pathCards = [
  { name: 'Python 自动化提效', state: 'active', isPrimary: true, summary: '围绕每周 Excel 周报，先搭起可复用的自动化最小闭环。', currentStage: 1, stages: 4, hours: 12, progress: 62 },
  { name: '概率论错题修复', state: 'active', isPrimary: false, summary: '针对概率论薄弱环节，继续围绕错题复盘和专项练习推进。', currentStage: 1, stages: 3, hours: 8, progress: 35 },
  { name: '英语复述表达训练', state: 'generating', isPrimary: false, summary: '', currentStage: 0, stages: 0, hours: 0, progress: 18 },
  { name: '数据看板自动汇总', state: 'failed', isPrimary: false, summary: '', currentStage: 0, stages: 0, hours: 0, progress: 0, error: '生成超时，可能是模型响应失败' }
];

const pathFilterChips = computed(() => [
  { key: 'all' as const, label: '全部', count: pathCards.length },
  { key: 'active' as const, label: '推进中', count: pathCards.filter((item) => item.state === 'active').length },
  { key: 'generating' as const, label: '生成中', count: pathCards.filter((item) => item.state === 'generating').length },
  { key: 'failed' as const, label: '待处理', count: pathCards.filter((item) => item.state === 'failed').length },
  { key: 'completed' as const, label: '已完成', count: pathCards.filter((item) => item.state === 'completed').length }
]);

const visiblePathCards = computed(() => {
  if (activePathFilter.value === 'all') return pathCards;
  return pathCards.filter((item) => item.state === activePathFilter.value);
});

type WorkbenchSummaryItem = {
  label: string;
  value: string;
  note: string;
};

type WorkbenchSceneMeta = {
  appbarKicker: string;
  appbarNote: string;
  pill: string;
  title: string;
  desc: string;
  primaryAction: { to: string; label: string };
  secondaryAction: { to: string; label: string };
  summaryTitle: string;
  summaryDesc: string;
  summaryItems: WorkbenchSummaryItem[];
};

const workbenchSceneMeta = computed<WorkbenchSceneMeta>(() => {
  if (sceneId.value === 'path-detail') {
    return {
      appbarKicker: '路径详情',
      appbarNote: '把注意力锁在当前阶段，不要一次同时推进整条路径。',
      pill: '最近学习详情',
      title: '真正有用的路径，不是排满课程，而是每一步都能落回真实任务。',
      desc: '这条路径围绕每周 Excel 周报自动化展开。你现在需要的不是再开一条新路线，而是把当前阶段的异常处理和日志闭环做稳。',
      primaryAction: { to: '/ui-lab/learn/task-1', label: '进入当前任务' },
      secondaryAction: { to: '/ui-lab/paths', label: '回到路径列表' },
      summaryTitle: '当前路径状态',
      summaryDesc: '先看当前阶段、投入估计和完成比例，再决定本周学习窗口怎么排。',
      summaryItems: [
        { label: '当前阶段', value: '阶段 2 / 3', note: '重点在异常处理与日志记录，不扩新功能。' },
        { label: '完成度', value: `${pathDetailProgress}%`, note: '已经过半，接下来更重要的是稳定性。' },
        { label: pathDetailMeta[1].label, value: pathDetailMeta[1].value, note: '按每次 20-30 分钟的小任务推进更合适。' }
      ]
    };
  }

  if (sceneId.value === 'learning') {
    return {
      appbarKicker: '对话学习',
      appbarNote: '这不是聊天记录，而是一节围绕真实任务推进的课。',
      pill: '授课进行中',
      title: '围绕一个具体任务，边学边问，直到它能迁移回真实场景。',
      desc: '当前主题是异常处理与日志记录。目标不是记住语法，而是知道为什么要这样设计，以及出了问题时如何回溯。',
      primaryAction: { to: '/ui-lab/feedback', label: '结束后查看反馈' },
      secondaryAction: { to: '/ui-lab/paths/1', label: '回到路径详情' },
      summaryTitle: '课堂状态',
      summaryDesc: '关注当前知识点进度、课堂节奏和是否已经达到收口条件。',
      summaryItems: learningSessionStats.slice(0, 3).map((item) => ({
        label: item.label,
        value: item.value,
        note: item.label === '知识点进度' ? '先把这一节的核心概念讲清楚。' : '状态信息会影响你是继续追问还是先收口。'
      }))
    };
  }

  if (sceneId.value === 'requirement') {
    return {
      appbarKicker: '目标规划',
      appbarNote: '路径不是先生成出来再看，而是在追问里慢慢收敛出来。',
      pill: '规划中',
      title: '先把问题收敛清楚，再生成真正能开始的学习路径。',
      desc: 'AI 规划师会围绕真实场景、当前基础和时间窗口持续追问，让路径拆解贴近你真正要解决的事。',
      primaryAction: { to: '/ui-lab/paths', label: '查看生成路径' },
      secondaryAction: { to: '/ui-lab/dashboard', label: '回到学习台' },
      summaryTitle: '当前理解摘要',
      summaryDesc: '这些信号会直接影响路径阶段、任务轻重和学习节奏。',
      summaryItems: [
        { label: planningSignals[0].label, value: planningSignals[0].value, note: '围绕真实场景，而不是泛泛说想学编程。' },
        { label: planningSignals[1].label, value: planningSignals[1].value, note: '起步难度要先压低，保证能够开始。' },
        { label: planningSignals[2].label, value: planningSignals[2].value, note: '影响阶段切分和每步的收口方式。' }
      ]
    };
  }

  if (sceneId.value === 'paths') {
    const activePathCount = pathCards.filter((item) => item.state === 'active').length;
    const generatingPathCount = pathCards.filter((item) => item.state === 'generating').length;
    const failedPathCount = pathCards.filter((item) => item.state === 'failed').length;

    return {
      appbarKicker: '学习路径',
      appbarNote: '把推进中、生成中和待重试的路径都留在桌面上。',
      pill: '路径总览',
      title: '不同状态的路径都应该被看见，这样学习流程才不会断。',
      desc: '列表页不只是用来展示成功生成的结果，它也要承载生成中、失败重试和主次路径取舍，让你知道现在最该推进哪一条。',
      primaryAction: { to: '/ui-lab/paths/1', label: '继续上次学习' },
      secondaryAction: { to: '/ui-lab/planning', label: '开始新规划' },
      summaryTitle: '当前路径分布',
      summaryDesc: '优先从最近在学的位置继续，其余保持轻量推进，注意力才不会被切碎。',
      summaryItems: [
        { label: '推进中路径', value: `${activePathCount} 条`, note: '优先只保留 1 条最近在学的路径。' },
        { label: '生成中路径', value: `${generatingPathCount} 条`, note: '生成完成后会自动进入列表继续推进。' },
        { label: '待重试路径', value: `${failedPathCount} 条`, note: '失败不是消失，而是补条件后继续。' }
      ]
    };
  }

  return {
    appbarKicker: '学习反馈',
    appbarNote: '一节课结束后，最重要的是把收获、盲点和下一步收口清楚。',
    pill: '课后总结',
    title: '本次学习已经结束，接下来该把总结接回下一步行动。',
    desc: '这里展示的是这节课刚结束后的总结：你学到了什么、哪些点还不稳、下一节最值得继续什么。',
    primaryAction: { to: '/ui-lab/learn/task-1', label: '继续当前任务' },
    secondaryAction: { to: '/ui-lab/dashboard', label: '回到学习台' },
    summaryTitle: '本节摘要',
    summaryDesc: '先看主题、知识点、用时和消息数，再进入本节总结。',
    summaryItems: evaluationSummaryCards.slice(0, 3).map((item) => ({
      label: item.label,
      value: item.value,
      note: item.label === '主题' ? '这节课围绕一个明确主题推进。' : '这是本节学习会话的即时摘要。'
    }))
  };
});

const themeVars = computed(() => ({
  '--lab-canvas': theme.tokens.canvas,
  '--lab-surface': theme.tokens.surface,
  '--lab-surface-alt': theme.tokens.surfaceAlt,
  '--lab-border': theme.tokens.border,
  '--lab-border-strong': theme.tokens.borderStrong,
  '--lab-text': theme.tokens.text,
  '--lab-muted': theme.tokens.muted,
  '--lab-primary': theme.tokens.primary,
  '--lab-secondary': theme.tokens.secondary,
  '--lab-accent': theme.tokens.accent,
  '--lab-success': theme.tokens.success,
  '--lab-warning': theme.tokens.warning,
  '--lab-danger': theme.tokens.danger,
  '--lab-nav-bg': theme.tokens.navBg,
  '--lab-chip': theme.tokens.chip,
  '--lab-shadow': theme.tokens.shadow,
  '--lab-hero-gradient': theme.tokens.heroGradient,
  '--lab-user-bubble': theme.tokens.userBubble,
  '--lab-ai-bubble': theme.tokens.aiBubble,
  '--lab-track': theme.tokens.track,
  '--lab-card-radius': theme.tokens.cardRadius,
  '--lab-pill-radius': theme.tokens.pillRadius,
  '--lab-display-font': theme.tokens.displayFont,
  '--lab-body-font': theme.tokens.bodyFont,

  '--text-primary': theme.tokens.text,
  '--text-secondary': theme.tokens.muted,
  '--text-muted': theme.tokens.muted,
  '--bg-surface': theme.tokens.surface,
  '--bg-muted': theme.tokens.surfaceAlt,
  '--border-default': theme.tokens.border,
  '--border-light': theme.tokens.border,
  '--color-primary': theme.tokens.primary,
  '--color-primary-light': 'color-mix(in srgb, var(--lab-primary) 16%, white)',
  '--gradient-primary': 'linear-gradient(135deg, var(--lab-primary), color-mix(in srgb, var(--lab-accent) 55%, var(--lab-primary)))',
  '--radius-2xl': '24px',
  '--radius-full': '999px'
}));

const toggleDevice = () => {
  device.value = device.value === 'mobile' ? 'desktop' : 'mobile';
};

const toggleLabPanel = () => {
  labPanelOpen.value = !labPanelOpen.value;
};

const setupHomeSectionObservers = () => {
  homeWhyObserver?.disconnect();
  homeHowObserver?.disconnect();

  if (homeWhyRef.value) {
    homeWhyObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          homeWhyInView.value = true;
          homeWhyObserver?.unobserve(entry.target);
        }
      },
      {
        threshold: 0.25
      }
    );

    homeWhyObserver.observe(homeWhyRef.value);
  }

  if (homeHowRef.value) {
    homeHowObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          homeHowInView.value = true;
          homeHowObserver?.unobserve(entry.target);
        }
      },
      {
        threshold: 0.2
      }
    );

    homeHowObserver.observe(homeHowRef.value);
  }
};

const setupVisionSectionObservers = () => {
  visionProblemsObserver?.disconnect();

  if (visionProblemsRef.value) {
    visionProblemsObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          visionProblemsInView.value = true;
          visionProblemsObserver?.unobserve(entry.target);
        }
      },
      {
        threshold: 0.22
      }
    );

    visionProblemsObserver.observe(visionProblemsRef.value);
  }
};

const setAuthPreviewState = (state: 'guest' | 'registered') => {
  authPreviewState.value = state;
};

onMounted(() => {
  setupHomeSectionObservers();
  setupVisionSectionObservers();
});

watch(sceneId, async (value) => {
  if (value === 'home') {
    await nextTick();
    setupHomeSectionObservers();
  }

  if (value === 'vision') {
    await nextTick();
    setupVisionSectionObservers();
  }
});

onUnmounted(() => {
  homeWhyObserver?.disconnect();
  homeHowObserver?.disconnect();
  visionProblemsObserver?.disconnect();
});
</script>

<style scoped>
.demo-site {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: linear-gradient(180deg, var(--lab-canvas), color-mix(in srgb, var(--lab-canvas) 88%, white));
  color: var(--lab-text);
  font-family: var(--lab-body-font);
}

.demo-site__header {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 12px 18px 0;
  border-bottom: 1px solid var(--lab-border);
  background: color-mix(in srgb, var(--lab-nav-bg) 86%, white);
  backdrop-filter: blur(18px);
}

.site-nav-shell {
  max-width: 1360px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 24px;
  align-items: center;
  padding: 0 18px 12px;
}

.site-nav__brand {
  display: flex;
  align-items: center;
}

.site-brand {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.site-brand__logo {
  width: 168px;
  height: auto;
}

.site-nav {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.site-nav__item {
  flex: 0 0 auto;
  padding: 9px 14px;
  border-radius: 999px;
  background: transparent;
  color: var(--lab-muted);
  text-decoration: none;
  font-size: 13px;
  font-weight: 700;
  transition: color 0.2s ease, background 0.2s ease;
}

.site-nav__item:hover {
  color: var(--lab-primary);
  background: color-mix(in srgb, var(--lab-primary) 5%, white);
}

.site-nav__item--external:hover {
  background: transparent;
}

.site-nav__item--active {
  color: var(--lab-primary);
  background: color-mix(in srgb, var(--lab-primary) 10%, white);
}

.site-nav__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.site-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--lab-border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--lab-surface-alt) 86%, white);
  color: var(--lab-text);
  text-decoration: none;
  font-size: 13px;
  font-weight: 700;
}

.site-cta--primary {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, var(--lab-primary), color-mix(in srgb, var(--lab-primary) 72%, var(--lab-secondary)));
}

.site-cta--ghost {
  background: color-mix(in srgb, var(--lab-surface-alt) 86%, white);
}

.app-site__header {
  position: sticky;
  top: 0;
  z-index: 18;
  padding: 12px 18px 0;
  border-bottom: 1px solid rgba(37, 99, 235, 0.08);
  background: color-mix(in srgb, var(--lab-nav-bg) 92%, white);
  backdrop-filter: blur(22px);
}

.app-nav-shell {
  max-width: 1360px;
  margin: 0 auto;
  padding: 0 18px 12px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 20px;
  align-items: center;
}

.app-brand {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
  color: var(--lab-text);
}

.app-brand__logo {
  width: 118px;
  height: auto;
}

.app-brand__copy {
  display: grid;
  gap: 2px;
}

.app-brand__copy strong {
  font-size: 14px;
  font-weight: 700;
}

.app-brand__copy span {
  font-size: 12px;
  color: var(--lab-muted);
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.app-nav__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 15px;
  border-radius: 999px;
  text-decoration: none;
  color: var(--lab-muted);
  font-size: 13px;
  font-weight: 700;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
  border: 1px solid transparent;
}

.app-nav__item:hover,
.app-nav__item--active {
  color: var(--accent-deep);
  background: color-mix(in srgb, var(--accent) 10%, white);
  border-color: rgba(52, 120, 246, 0.12);
}

.app-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.app-header__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 12px;
  text-decoration: none;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  box-shadow: 0 10px 24px rgba(52, 120, 246, 0.18);
}

.app-user-chip {
  display: grid;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.8);
  text-align: right;
}

.app-user-chip span {
  font-size: 11px;
  color: var(--lab-muted);
}

.app-user-chip strong {
  font-size: 13px;
  font-weight: 700;
}

.ui-lab-float {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 30;
  display: grid;
  justify-items: end;
  gap: 10px;
}

.ui-lab-float__trigger {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid rgba(37, 99, 235, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  color: var(--lab-text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
}

.ui-lab-float__panel {
  width: 220px;
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(37, 99, 235, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(18px);
}

.ui-lab-float__head {
  display: grid;
  gap: 4px;
}

.ui-lab-float__head strong {
  font-size: 14px;
}

.ui-lab-float__head small {
  color: var(--lab-muted);
  font-size: 12px;
}

.ui-lab-float__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--lab-border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--lab-surface-alt) 84%, white);
  color: var(--lab-text);
  text-decoration: none;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}

.ui-lab-float__group {
  display: grid;
  gap: 8px;
}

.ui-lab-float__label {
  font-size: 11px;
  font-weight: 700;
  color: var(--lab-muted);
  letter-spacing: 0.04em;
}

.ui-lab-float__switches {
  display: flex;
  gap: 8px;
}

.ui-lab-float__chip {
  flex: 1;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.84);
  color: var(--lab-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.ui-lab-float__chip--active {
  border-color: rgba(52, 120, 246, 0.18);
  background: color-mix(in srgb, var(--lab-primary) 10%, white);
  color: var(--lab-primary);
}

.ui-lab-float__stack {
  display: grid;
  gap: 8px;
}

.ui-lab-float__link {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(255, 255, 255, 0.84);
  color: var(--lab-text);
  text-decoration: none;
  transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.ui-lab-float__link strong {
  font-size: 12px;
}

.ui-lab-float__link span {
  font-size: 11px;
  line-height: 1.45;
  color: var(--lab-muted);
}

.ui-lab-float__link--active {
  border-color: rgba(52, 120, 246, 0.2);
  background: color-mix(in srgb, var(--lab-primary) 10%, white);
}

.ui-lab-float__action--link {
  cursor: pointer;
}

.demo-site__main {
  min-height: 0;
}

.demo-site__main--app {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--lab-canvas) 96%, white), color-mix(in srgb, var(--lab-canvas) 88%, white));
}

.demo-home {
  --ink: #172033;
  --paper: #f4f7fc;
  --panel: #ffffff;
  --line: #d8e0ef;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --display: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  --body: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  display: grid;
  gap: 0;
  max-width: 100%;
  margin: 0 auto;
  color: var(--ink);
  font-family: var(--body);
  position: relative;
  overflow: hidden;
}

.dashboard-page {
  --ink: #172033;
  --paper: #f4f7fc;
  --panel: rgba(255, 255, 255, 0.9);
  --line: #d8e0ef;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --display: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  --body: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  position: relative;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--body);
}

.dashboard-bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.dashboard-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.3;
}

.dashboard-bg-orb--1 {
  top: -180px;
  right: -120px;
  width: 460px;
  height: 460px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.22), transparent 70%);
  animation: orb-drift 26s ease-in-out infinite;
}

.dashboard-bg-orb--2 {
  left: -100px;
  bottom: 120px;
  width: 380px;
  height: 380px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.16), transparent 70%);
  animation: orb-drift 30s ease-in-out infinite reverse;
}

.dashboard-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(52, 120, 246, 0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(52, 120, 246, 0.02) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: radial-gradient(circle at 50% 22%, black 20%, transparent 76%);
}

.dashboard-shell {
  position: relative;
  z-index: 1;
  max-width: 1360px;
  margin: 0 auto;
  padding: 36px 36px 72px;
  display: grid;
  gap: 18px;
}

.workbench-scene-shell {
  position: relative;
  z-index: 1;
  max-width: 1360px;
  margin: 0 auto;
  padding: 18px 36px 12px;
  display: grid;
  gap: 10px;
}

.app-page-head {
  display: grid;
  gap: 12px;
  padding: 18px 20px;
  border-radius: 18px;
}

.app-page-head__top,
.app-page-head__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.app-page-head__intro {
  display: grid;
  gap: 8px;
}

.app-page-head__intro h1,
.app-page-head__summary-card strong {
  margin: 0;
  font-family: var(--display);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.app-page-head__intro h1 {
  font-size: clamp(22px, 2.8vw, 30px);
  line-height: 1.18;
  max-width: 22ch;
}

.app-page-head__intro p,
.app-page-head__summary-card p {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.62;
  font-size: 14px;
}

.app-page-head__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.app-page-head__summary-card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.8);
}

.app-page-head__summary-card span {
  font-size: 12px;
  color: var(--lab-muted);
}

.app-page-head__summary-card strong {
  font-size: 18px;
  line-height: 1.1;
}

.workbench-scene-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.76fr);
  gap: 14px;
  align-items: stretch;
  padding: 0;
  border-radius: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}

.workbench-scene-hero__copy {
  display: grid;
  gap: 10px;
  padding: 12px 0 4px;
}

.workbench-scene-hero__copy h1,
.workbench-scene-glance__card strong {
  margin: 0;
  font-family: var(--display);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.workbench-scene-hero__copy h1 {
  font-size: clamp(22px, 2.8vw, 30px);
  line-height: 1.18;
  max-width: 20ch;
}

.workbench-scene-hero__copy p,
.workbench-scene-glance__head p,
.workbench-scene-glance__card p {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.72;
}

.workbench-scene-hero__copy p {
  max-width: 44rem;
  font-size: 14px;
  line-height: 1.62;
}

.workbench-scene-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}

.workbench-scene-glance {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background:
    radial-gradient(circle at top right, rgba(52, 120, 246, 0.08), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92));
}

.workbench-scene-glance__head {
  display: grid;
  gap: 8px;
}

.workbench-scene-glance__grid {
  display: grid;
  gap: 10px;
}

.workbench-scene-glance__card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.8);
}

.workbench-scene-glance__card span {
  font-size: 12px;
  color: var(--lab-muted);
}

.workbench-scene-glance__card strong {
  font-size: 18px;
  line-height: 1.1;
}

.dashboard-appbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  align-items: center;
}

.dashboard-appbar__meta {
  display: grid;
  gap: 6px;
}

.dashboard-appbar__kicker {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.dashboard-appbar__meta p {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 68%, #fff);
  line-height: 1.6;
}

.dashboard-appnav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.dashboard-appnav__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.74);
  color: var(--lab-muted);
  text-decoration: none;
  font-size: 13px;
  font-weight: 700;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
}

.dashboard-appnav__item:hover,
.dashboard-appnav__item--active {
  border-color: rgba(52, 120, 246, 0.18);
  background: color-mix(in srgb, var(--accent) 10%, white);
  color: var(--accent-deep);
}

.dashboard-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.88fr);
  gap: 18px;
  align-items: stretch;
}

.dashboard-hero__copy {
  display: grid;
  gap: 24px;
}

.dashboard-hero__copy h1,
.dashboard-section__head h2,
.dashboard-panel__head h2,
.dashboard-focus-card h2 {
  margin: 0;
  font-family: var(--display);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.08;
}

.dashboard-hero__copy h1 {
  max-width: 12ch;
  font-size: clamp(34px, 4.6vw, 58px);
}

.dashboard-hero__copy p {
  margin: 0;
  max-width: 42rem;
  color: color-mix(in srgb, var(--ink) 70%, #fff);
  line-height: 1.8;
  font-size: 17px;
}

.dashboard-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.dashboard-starter {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(244, 247, 252, 0.92), rgba(255, 255, 255, 0.86));
}

.dashboard-starter__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-starter__head span {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-deep);
}

.dashboard-starter__head strong {
  font-size: 16px;
}

.dashboard-starter__list {
  display: grid;
  gap: 10px;
}

.dashboard-starter__item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(216, 224, 239, 0.9);
}

.dashboard-starter__dot {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border-radius: 50%;
  border: 2px solid rgba(148, 163, 184, 0.4);
  background: rgba(255, 255, 255, 0.9);
}

.dashboard-starter__item strong,
.dashboard-focus-item strong,
.dashboard-track-card__head strong,
.dashboard-session-card__head strong,
.dashboard-coach-card strong,
.dashboard-friction-card__head strong,
.dashboard-momentum-item strong,
.dashboard-state-pulse__summary strong {
  display: block;
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
}

.dashboard-starter__item p,
.dashboard-focus-item p,
.dashboard-track-card p,
.dashboard-coach-card p,
.dashboard-section__head p,
.dashboard-session-card p,
.dashboard-state-pulse__summary p,
.dashboard-friction-card p,
.dashboard-momentum-item p {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.65;
}

.dashboard-starter__item--done {
  border-color: rgba(49, 177, 111, 0.18);
  background: color-mix(in srgb, #31b16f 8%, white);
}

.dashboard-starter__item--done .dashboard-starter__dot {
  border-color: rgba(49, 177, 111, 0.2);
  background: #31b16f;
}

.dashboard-starter__item--current {
  border-color: rgba(52, 120, 246, 0.14);
  background: color-mix(in srgb, var(--accent) 8%, white);
}

.dashboard-starter__item--current .dashboard-starter__dot {
  border-color: rgba(52, 120, 246, 0.16);
  background: #3478f6;
}

.dashboard-starter__meter {
  height: 6px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  overflow: hidden;
}

.dashboard-starter__meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 65%, var(--lab-accent)));
}

.dashboard-focus-card {
  display: grid;
  gap: 18px;
  padding: 24px;
  border-radius: 24px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background:
    radial-gradient(circle at top right, rgba(52, 120, 246, 0.12), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92));
}

.dashboard-focus-card__head,
.dashboard-panel__head,
.dashboard-overview-card__head,
.dashboard-track-card__head,
.dashboard-track-card__progress-meta,
.dashboard-session-card__head,
.dashboard-friction-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-focus-card__badge,
.dashboard-track-card__head span,
.dashboard-overview-card__tag,
.dashboard-session-card__head span,
.dashboard-friction-card__head span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 10%, white);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 700;
}

.dashboard-focus-card h2 {
  font-size: clamp(24px, 3vw, 34px);
}

.dashboard-focus-card p {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.72;
}

.dashboard-focus-card__actions {
  display: flex;
  justify-content: flex-start;
}

.dashboard-focus-card__stack,
.dashboard-coach-feed,
.dashboard-friction-list,
.dashboard-state-pulse__grid,
.dashboard-achievement-summary,
.dashboard-achievement-stats {
  display: grid;
  gap: 12px;
}

.dashboard-focus-item,
.dashboard-coach-card,
.dashboard-state-card,
.dashboard-friction-card,
.dashboard-achievement-card,
.dashboard-achievement-stat,
.state-metric-card,
.state-insight-card,
.achievement-overview-card,
.achievement-card-new {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.76);
}

.dashboard-focus-item span,
.dashboard-overview-card__label,
.dashboard-state-card span,
.dashboard-state-card__meta small,
.achievement-card-new__foot small,
.achievement-overview-card span,
.state-metric-card span,
.dashboard-achievement-stat span {
  font-size: 12px;
  color: var(--lab-muted);
}

.dashboard-section,
.dashboard-panel {
  display: grid;
  gap: 18px;
}

.dashboard-section__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
}

.dashboard-section__head h2,
.dashboard-panel__head h2 {
  font-size: clamp(24px, 3vw, 34px);
}

.dashboard-section__head p {
  max-width: 34rem;
  font-size: 15px;
}

.dashboard-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-overview-card {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.84);
}

.dashboard-overview-card strong {
  font-family: var(--display);
  font-size: 40px;
  line-height: 1;
  letter-spacing: -0.04em;
}

.dashboard-overview-card p,
.dashboard-overview-card small {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 70%, #fff);
  line-height: 1.6;
}

.dashboard-overview-card--success {
  background: linear-gradient(180deg, rgba(49, 177, 111, 0.06), rgba(255, 255, 255, 0.88));
}

.dashboard-overview-card--warning {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0.88));
}

.dashboard-overview-card--accent {
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.08), rgba(255, 255, 255, 0.88));
}

.dashboard-flow-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.dashboard-inline-link {
  color: var(--accent-deep);
  text-decoration: none;
  font-size: 13px;
  font-weight: 700;
}

.dashboard-achievement-card strong,
.dashboard-achievement-stat strong,
.state-metric-card strong,
.achievement-overview-card strong {
  font-family: var(--display);
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.dashboard-achievement-card p,
.dashboard-achievement-stat p,
.state-metric-card p,
.state-insight-card p,
.achievement-overview-card p,
.achievement-card-new p,
.achievement-card-new__foot {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.65;
}

.dashboard-achievement-card small,
.achievement-card-new__head span {
  color: var(--accent-deep);
  font-size: 13px;
  font-weight: 700;
}

.dashboard-achievement-stats {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.dashboard-achievement-card--recent {
  background: linear-gradient(180deg, rgba(49, 177, 111, 0.06), rgba(255, 255, 255, 0.84));
}

.dashboard-achievement-card--next {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.06), rgba(255, 255, 255, 0.84));
}

.dashboard-friction-card--warning {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0.86));
}

.dashboard-friction-card--primary {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.06), rgba(255, 255, 255, 0.86));
}

.dashboard-friction-card--accent {
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.08), rgba(255, 255, 255, 0.86));
}

.state-page,
.achievements-page-new {
  --ink: #172033;
  --paper: #f4f7fc;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --line: #d8e0ef;
  color: var(--ink);
}

.state-metrics-grid,
.achievement-overview-grid {
  max-width: 1360px;
  margin: 0 auto;
  width: calc(100% - 72px);
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding-bottom: 18px;
}

.state-layout {
  max-width: 1360px;
  width: calc(100% - 72px);
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 18px;
  padding-bottom: 72px;
}

.state-panel__head,
.achievement-card-new__head,
.achievement-card-new__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.state-trend-panel,
.state-side-panels,
.state-insight-card,
.achievement-card-grid {
  display: grid;
  gap: 16px;
}

.state-trend-chart {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  align-items: end;
}

.state-trend-chart__col {
  display: grid;
  gap: 10px;
  justify-items: center;
}

.state-trend-chart__bars {
  min-height: 140px;
  width: 100%;
  display: flex;
  align-items: end;
  justify-content: center;
  gap: 6px;
}

.state-trend-chart__bar {
  width: 14px;
  border-radius: 999px 999px 4px 4px;
  background: rgba(148, 163, 184, 0.24);
}

.state-trend-chart__bar--lsb { background: #3478f6; }
.state-trend-chart__bar--lss { background: #f59e0b; }
.state-trend-chart__bar--ktl { background: #31b16f; }
.state-trend-chart__bar--lf { background: #8d6bff; }

.achievement-filter-row,
.achievement-card-grid,
.achievement-spotlight-grid,
.achievement-stack {
  max-width: 1360px;
  width: calc(100% - 72px);
  margin: 0 auto;
}

.achievement-filter-row {
  display: grid;
  gap: 12px;
  padding-bottom: 18px;
}

.achievement-filter-tabs,
.achievement-filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.achievement-filter-chip {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: rgba(255, 255, 255, 0.8);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}

.achievement-filter-chip--active {
  background: color-mix(in srgb, var(--lab-primary) 10%, white);
  border-color: rgba(52, 120, 246, 0.18);
}

.achievement-filter-chip--tag {
  color: var(--lab-muted);
}

.achievement-spotlight-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding-bottom: 18px;
}

.achievement-spotlight-card {
  display: grid;
  gap: 12px;
  padding: 22px;
}

.achievement-spotlight-card strong {
  font-size: 24px;
  line-height: 1.2;
}

.achievement-spotlight-card p {
  margin: 0;
  line-height: 1.7;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
}

.achievement-spotlight-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.achievement-spotlight-card__foot span {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-deep);
}

.achievement-stack {
  display: grid;
  gap: 16px;
  padding-bottom: 26px;
}

.achievement-stack__head {
  display: grid;
  gap: 8px;
}

.achievement-stack__head h2 {
  margin: 0;
  font-size: 28px;
  line-height: 1.14;
  letter-spacing: -0.03em;
}

.achievement-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.achievement-card-grid--unlocked {
  padding-bottom: 6px;
}

.achievement-card-new--unlocked {
  background: linear-gradient(180deg, rgba(49, 177, 111, 0.06), rgba(255, 255, 255, 0.86));
}

.achievement-card-new--next {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.06), rgba(255, 255, 255, 0.86));
}

.achievement-card-new {
  display: grid;
  gap: 14px;
  padding: 22px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.achievement-card-new__icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(243, 246, 251, 0.92);
  font-size: 20px;
}

.achievement-card-new__progress {
  display: grid;
  gap: 8px;
}

.achievement-card-new__progress-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.achievement-card-new__progress-top span {
  font-size: 12px;
  color: var(--lab-muted);
}

.achievement-card-new__progress-top strong {
  font-size: 13px;
  color: var(--accent-deep);
}

.achievement-card-new__progress-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  overflow: hidden;
}

.achievement-card-new__progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-deep));
}

.achievement-card-new__action {
  width: fit-content;
}

.achievement-card-new--locked {
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.06), rgba(255, 255, 255, 0.86));
}

.demo-feedback {
  --ink: #172033;
  --paper: #f4f7fc;
  --panel: #ffffff;
  --line: #d8e0ef;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --display: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  --body: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  display: grid;
  gap: 18px;
  padding: 0 36px 36px;
  max-width: 1360px;
  margin: 0 auto;
  color: var(--ink);
  font-family: var(--body);
}

.home-hero,
.final-callout,
.feedback-hero,
.feedback-metrics,
.feedback-grid,
.feedback-actions {
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
}



.feedback-hero {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(0, 1.1fr) minmax(260px, 0.72fr);
  align-items: stretch;
  border: 1px solid var(--line);
  border-radius: 26px;
  padding: 26px;
  background:
    radial-gradient(circle at top left, rgba(52, 120, 246, 0.08), transparent 34%),
    var(--paper);
}

.feedback-hero__copy {
  display: grid;
  gap: 14px;
}

.feedback-hero__copy h1 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(32px, 4vw, 52px);
  line-height: 1.08;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.feedback-hero__copy p {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.6;
}

.feedback-score {
  display: grid;
  gap: 10px;
  align-content: start;
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 20px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.06), #fff 44%);
}

.feedback-score span {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.07em;
}

.feedback-score strong {
  font-family: var(--display);
  font-size: 64px;
  line-height: 1;
  font-weight: 700;
}

.feedback-score small,
.feedback-score p {
  margin: 0;
  color: var(--lab-muted);
}

.feedback-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.feedback-metric {
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 14px;
  background: var(--panel);
  display: grid;
  gap: 8px;
}

.feedback-metric span {
  font-size: 12px;
  color: var(--lab-muted);
}

.feedback-metric strong {
  font-family: var(--display);
  font-size: 28px;
  line-height: 1;
  font-weight: 700;
}

.feedback-metric p,
.feedback-panel li,
.feedback-actions p {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 75%, #fff);
  line-height: 1.6;
}

.feedback-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.feedback-panel {
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 16px;
  background: color-mix(in srgb, var(--paper) 85%, #fff);
  display: grid;
  gap: 10px;
}

.feedback-panel h2,
.feedback-actions h2 {
  margin: 0;
  font-family: var(--display);
  font-size: 28px;
  line-height: 1.15;
  font-weight: 700;
}

.feedback-panel ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
}

.feedback-actions {
  display: grid;
  gap: 14px;
}

.feedback-actions ol {
  margin: 0;
  padding-left: 22px;
  display: grid;
  gap: 10px;
}

.feedback-actions li {
  padding: 8px 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--line) 80%, white);
}

.feedback-actions li:last-child {
  border-bottom: none;
}

.feedback-actions strong {
  display: block;
  margin-bottom: 4px;
  font-size: 16px;
}

.surface-card {
  border: 1px solid rgba(37, 99, 235, 0.08);
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.56), rgba(244, 247, 252, 0.72));
  padding: 24px;
  box-shadow: 0 16px 44px rgba(15, 23, 42, 0.04);
}

/* === Background Layer === */

.home-bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.home-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.3;
}

.home-bg-orb--1 {
  width: 600px;
  height: 600px;
  top: -200px;
  left: -150px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.25), transparent 70%);
  animation: orb-drift 25s ease-in-out infinite;
}

.home-bg-orb--2 {
  width: 500px;
  height: 500px;
  top: 400px;
  right: -100px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
  animation: orb-drift 30s ease-in-out infinite reverse;
}

.home-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(52, 120, 246, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(52, 120, 246, 0.025) 1px, transparent 1px);
  background-size: 80px 80px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, black 20%, transparent 70%);
}

@keyframes orb-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.05); }
  66% { transform: translate(-20px, 30px) scale(0.95); }
}

/* === Hero — Immersive === */

.home-hero {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 48px;
  grid-template-columns: minmax(0, 1fr) minmax(380px, 0.9fr);
  align-items: center;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
  padding: 80px 60px 72px;
  min-height: 70vh;
}

.home-hero__glow {
  position: absolute;
  top: 50%;
  left: 30%;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.08), transparent 60%);
  transform: translate(-50%, -50%);
  pointer-events: none;
  animation: hero-breathe 8s ease-in-out infinite;
}

@keyframes hero-breathe {
  0%, 100% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
}

.home-hero__copy {
  display: grid;
  gap: 28px;
  position: relative;
  z-index: 2;
}

.home-hero__tag {
  font-size: 12px;
  font-weight: 700;
  color: var(--lab-muted);
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.home-hero__copy h1 {
  margin: 0;
  font-family: var(--display);
  display: grid;
  gap: 2px;
  font-size: clamp(48px, 5vw, 72px);
  line-height: 0.98;
  letter-spacing: -0.04em;
  max-width: 12ch;
  font-weight: 700;
}

.home-hero__accent {
  color: var(--accent-deep);
}

.home-hero__sub {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 58%, #fff);
  line-height: 1.8;
  font-size: 18px;
  max-width: 38ch;
}

.home-hero__cta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.btn--lg {
  min-height: 52px;
  padding: 0 28px;
  font-size: 16px;
  border-radius: 14px;
}

/* Hero scene — conversation */

.home-hero__scene {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 20px;
}

.scene-conversation {
  display: grid;
  gap: 14px;
}

.scene-turn {
  display: grid;
  gap: 6px;
  padding: 16px 20px;
  border-radius: 16px;
  max-width: 85%;
  opacity: 0;
  animation: turn-appear 0.6s ease forwards;
}

.scene-turn--0 { animation-delay: 0.2s; }
.scene-turn--1 { animation-delay: 0.8s; }
.scene-turn--2 { animation-delay: 1.4s; }
.scene-turn--3 { animation-delay: 2.0s; }

@keyframes turn-appear {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.scene-turn--user {
  justify-self: end;
  text-align: right;
  background: color-mix(in srgb, var(--accent) 8%, white);
}

.scene-turn--system {
  justify-self: start;
  text-align: left;
  background: rgba(244, 247, 252, 0.9);
}

.scene-turn__role {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.04em;
}

.scene-turn p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink);
}

.scene-outcome {
  padding: 18px 22px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.06), rgba(141, 107, 255, 0.04));
  border: 1px solid rgba(52, 120, 246, 0.1);
  display: grid;
  gap: 6px;
  opacity: 0;
  animation: turn-appear 0.6s ease forwards;
  animation-delay: 2.6s;
}

.scene-outcome__label {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.05em;
}

.scene-outcome strong {
  color: var(--ink);
  font-size: 16px;
}

.scene-outcome__next {
  font-size: 13px;
  color: var(--lab-muted);
}

/* === Why — Product Comparison === */

.home-why {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: 100px 36px;
}

.home-why__header {
  text-align: center;
  max-width: 640px;
  margin: 0 auto 48px;
}

.home-why__lead {
  margin: 0;
  font-size: clamp(20px, 2.4vw, 28px);
  line-height: 1.7;
  color: color-mix(in srgb, var(--ink) 70%, #fff);
  font-weight: 400;
}

.home-why__lead strong {
  color: var(--ink);
  font-weight: 700;
}

.home-why__grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 20px;
  align-items: start;
}

.home-why__reveal {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.56s ease, transform 0.56s ease;
}

.home-why.is-in-view .home-why__reveal {
  opacity: 1;
  transform: translateY(0);
}

.home-why__reveal--header { transition-delay: 0s; }
.home-why__reveal--old { transition-delay: 0.12s; }
.home-why__reveal--vs { transition-delay: 0.24s; }
.home-why__reveal--new { transition-delay: 0.36s; }
.home-why__reveal--insight { transition-delay: 0.48s; }

.why-panel {
  border-radius: 20px;
  padding: 28px;
  display: grid;
  gap: 16px;
  text-align: left;
  justify-items: start;
  align-content: start;
}

.why-panel--old {
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.why-panel--new {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.06), rgba(255, 255, 255, 0.8));
  border: 1px solid rgba(52, 120, 246, 0.12);
  box-shadow: 0 12px 40px rgba(52, 120, 246, 0.06);
}

.why-panel--vs {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0 8px;
  text-align: center;
}

.why-panel--vs span {
  font-family: var(--display);
  font-size: 14px;
  font-weight: 700;
  color: var(--lab-muted);
  letter-spacing: 0.05em;
}

.why-panel__badge {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
  padding: 5px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 10%, white);
  width: fit-content;
  justify-self: start;
}

.why-panel ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 10px;
  width: 100%;
  justify-items: start;
}

.why-panel li {
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.6;
  font-size: 15px;
}

.home-why__insight {
  max-width: 540px;
  margin: 36px auto 0;
  text-align: center;
  padding: 18px 24px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.06), rgba(141, 107, 255, 0.04));
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.home-why__insight p {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--accent-deep);
}

/* === How — Flowing Path === */

.home-how {
  position: relative;
  z-index: 1;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
  padding: 100px 60px;
}

.home-how__header {
  text-align: center;
  max-width: 600px;
  margin: 0 auto 64px;
  display: grid;
  gap: 12px;
  justify-items: center;
}

.home-how__reveal,
.home-how__path {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.56s ease, transform 0.56s ease;
}

.home-how.is-in-view .home-how__reveal,
.home-how.is-in-view .home-how__path {
  opacity: 1;
  transform: translateY(0);
}

.home-how__reveal--header { transition-delay: 0s; }
.home-how__path { transition-delay: 0.08s; }
.home-how__reveal--0 { transition-delay: 0.16s; }
.home-how__reveal--1 { transition-delay: 0.3s; }
.home-how__reveal--2 { transition-delay: 0.44s; }
.home-how__reveal--3 { transition-delay: 0.58s; }
.home-how__reveal--4 { transition-delay: 0.72s; }

.home-how__header h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(28px, 3.2vw, 42px);
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.home-how__header p {
  margin: 0;
  color: var(--lab-muted);
  font-size: 16px;
}

.how-flow {
  position: relative;
  max-width: 1100px;
  margin: 0 auto;
}

.how-flow__svg {
  width: 100%;
  height: auto;
  display: block;
}

.how-flow__path {
  stroke-dasharray: 2000;
  stroke-dashoffset: 2000;
  transition: stroke-dashoffset 1.8s ease 0.12s;
}

.home-how.is-in-view .how-flow__path {
  stroke-dashoffset: 0;
}

@keyframes path-draw {
  to { stroke-dashoffset: 0; }
}

.how-flow__nodes {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  margin-top: -40px;
  position: relative;
  z-index: 2;
}

.how-node {
  display: grid;
  gap: 14px;
  justify-items: center;
  text-align: center;
  padding: 0 8px;
}

.how-node__dot {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 8px 28px rgba(52, 120, 246, 0.22);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.how-node:hover .how-node__dot {
  transform: scale(1.12);
  box-shadow: 0 12px 36px rgba(52, 120, 246, 0.32);
}

.how-node__content strong {
  display: block;
  margin-bottom: 4px;
  font-size: 15px;
  color: var(--ink);
}

.how-node__content p {
  margin: 0;
  font-size: 13px;
  color: var(--lab-muted);
  line-height: 1.5;
}

/* === Product Preview — Abstract Panels === */

.home-preview {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: 100px 36px;
}

.home-preview__header {
  text-align: center;
  max-width: 600px;
  margin: 0 auto 56px;
  display: grid;
  gap: 12px;
  justify-items: center;
}

.home-preview__header h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(26px, 3vw, 38px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.preview-panels {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  align-items: start;
}

.preview-panel {
  padding: 32px 28px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(37, 99, 235, 0.06);
  display: grid;
  gap: 14px;
  transition: transform 0.4s ease, box-shadow 0.4s ease, background 0.4s ease;
  position: relative;
  overflow: hidden;
}

.preview-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent), var(--accent-deep));
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.4s ease;
}

.preview-panel:hover::before {
  transform: scaleX(1);
}

.preview-panel:hover {
  transform: translateY(-6px);
  box-shadow: 0 20px 56px rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.8);
}

.preview-panel--1 {
  transform: translateY(-12px);
}

.preview-panel--1:hover {
  transform: translateY(-18px);
}

.preview-panel__label {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.preview-panel strong {
  color: var(--ink);
  font-size: 19px;
  font-weight: 700;
}

.preview-panel p {
  margin: 0;
  color: var(--lab-muted);
  font-size: 14px;
  line-height: 1.6;
}

.preview-panel__data {
  display: grid;
  gap: 6px;
  margin-top: 4px;
}

.preview-panel__data span {
  font-size: 13px;
  color: color-mix(in srgb, var(--ink) 55%, #fff);
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(244, 247, 252, 0.7);
  display: block;
}

/* === Capabilities — Lightweight === */

.home-capabilities {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: 100px 36px;
}

.home-capabilities__center {
  text-align: center;
  max-width: 600px;
  margin: 0 auto 48px;
}

.home-capabilities__center h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(26px, 3vw, 38px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.cap-light-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  max-width: 700px;
  margin: 0 auto;
}

.cap-light-tag {
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-deep);
  padding: 12px 24px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(52, 120, 246, 0.1);
  transition: transform 0.2s ease, background 0.2s ease;
}

.cap-light-tag:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.8);
}

/* === Final CTA — Dark Closure === */

.home-final-cta {
  position: relative;
  z-index: 1;
  width: 100%;
  margin: 0 auto;
  padding: 0;
  background: linear-gradient(180deg, var(--ink), #0f172a);
  overflow: hidden;
}

.home-final-cta__glow {
  position: absolute;
  top: 0;
  left: 50%;
  width: 800px;
  height: 400px;
  transform: translateX(-50%);
  background: radial-gradient(ellipse, rgba(52, 120, 246, 0.15), transparent 60%);
  pointer-events: none;
}

.home-final-cta__inner {
  position: relative;
  z-index: 1;
  max-width: 720px;
  margin: 0 auto;
  padding: 100px 36px 120px;
  text-align: center;
  display: grid;
  gap: 20px;
  justify-items: center;
}

.home-final-cta__inner h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(28px, 3.5vw, 46px);
  line-height: 1.1;
  letter-spacing: -0.03em;
  font-weight: 700;
  color: #fff;
}

.home-final-cta__inner p {
  margin: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 17px;
  line-height: 1.7;
  max-width: 42ch;
}

.home-final-cta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 8px;
}

.btn--ghost-light {
  color: rgba(255, 255, 255, 0.8);
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
}

.btn--ghost-light:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 12px;
  border: 1px solid var(--line);
  text-decoration: none;
  font-weight: 600;
  cursor: pointer;
  font: inherit;
}

.btn--primary {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  box-shadow: 0 10px 24px rgba(52, 120, 246, 0.28);
}

.btn--ghost {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.76);
}

.pill {
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--line));
  background: color-mix(in srgb, var(--accent) 12%, white);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 10%, white);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 700;
}

/* === VISION PAGE === */

.vision-page {
  --ink: #172033;
  --paper: #f4f7fc;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --line: #d8e0ef;
  --vision-copy-width: 1040px;
  --vision-grid-width: 1040px;
  --vision-step-width: 960px;
  --vision-cta-width: 920px;
  display: grid;
  gap: 0;
  max-width: 100%;
  color: var(--ink);
  font-family: var(--body);
  position: relative;
  overflow: hidden;
}

.vision-bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.vision-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.25;
}

.vision-bg-orb--1 {
  width: 500px;
  height: 500px;
  top: -100px;
  right: -80px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.3), transparent 70%);
  animation: orb-drift 28s ease-in-out infinite;
}

.vision-bg-orb--2 {
  width: 400px;
  height: 400px;
  bottom: 400px;
  left: -60px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.2), transparent 70%);
  animation: orb-drift 32s ease-in-out infinite reverse;
}

.vision-hero {
  position: relative;
  z-index: 1;
  min-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 100px 36px;
  background: linear-gradient(180deg, #0f172a, #1e293b);
  text-align: center;
  overflow: hidden;
}

.vision-hero__glow {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.12), transparent 60%);
  transform: translate(-50%, -50%);
  animation: hero-breathe 8s ease-in-out infinite;
}

.vision-hero__inner {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 48px;
  max-width: var(--vision-copy-width);
  width: 100%;
}

.vision-hero__copy {
  display: grid;
  gap: 28px;
  justify-items: center;
}

.vision-hero__copy p {
  margin: 0;
  color: rgba(203, 213, 225, 0.72);
  font-size: 18px;
  line-height: 1.8;
  max-width: 760px;
}

.vision-hero__inner h1 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(40px, 4.5vw, 60px);
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-weight: 700;
  color: #fff;
}

.vision-hero__band {
  width: 100%;
  max-width: 900px;
  display: grid;
  gap: 16px;
  justify-items: center;
  margin: 0 auto;
  padding: 20px 28px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

.vision-hero__timeline {
  display: flex;
  align-items: center;
  gap: 20px;
  justify-content: center;
}

.vision-timeline__from,
.vision-timeline__to {
  font-family: var(--display);
  font-size: 28px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.3);
}

.vision-timeline__to {
  color: rgba(255, 255, 255, 0.8);
}

.vision-timeline__line {
  width: 80px;
  height: 2px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.4));
  border-radius: 1px;
}

.vision-hero__signal {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 0.02em;
  text-align: center;
}

.vision-era {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 120px 36px;
}

.vision-era__header {
  max-width: 780px;
  margin: 0 auto 56px;
  display: grid;
  gap: 14px;
  text-align: center;
}

.vision-era__header h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(28px, 3.2vw, 42px);
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.vision-era__source {
  margin: 0;
  font-size: 15px;
  color: color-mix(in srgb, var(--ink) 68%, #fff);
}

.vision-era__inner {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
  gap: 32px;
  align-items: stretch;
  max-width: var(--vision-copy-width);
  margin: 0 auto;
}

.vision-era__quote-side,
.vision-era__context-side {
  display: grid;
  gap: 24px;
  align-content: start;
  padding: 32px;
  border-radius: 24px;
}

.vision-era__quote-side {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(244, 247, 252, 0.82));
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.vision-era__context-side {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.92));
  border: 1px solid rgba(52, 120, 246, 0.12);
  box-shadow: 0 18px 48px rgba(52, 120, 246, 0.08);
  justify-content: center;
}

.vision-quote {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(24px, 2.8vw, 36px);
  line-height: 1.5;
  font-weight: 600;
  color: var(--ink);
  font-style: italic;
  padding: 12px 0 12px 24px;
  border-left: 3px solid var(--accent);
  text-align: left;
}

.vision-era__eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.vision-era__context {
  margin: 0;
  font-size: 16px;
  line-height: 1.7;
  color: var(--lab-muted);
}

.vision-era__response {
  display: grid;
  gap: 8px;
}

.vision-era__response p {
  margin: 0;
  font-size: clamp(20px, 2.2vw, 28px);
  line-height: 1.45;
  color: color-mix(in srgb, var(--ink) 86%, #fff);
}

.vision-era__divider {
  width: 48px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  border-radius: 1px;
}

.vision-era__context-side h3 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(26px, 3vw, 38px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.vision-era__date {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Vision Beliefs Section */

.vision-beliefs {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 100px 36px;
}

.vision-beliefs__header {
  text-align: center;
  max-width: 720px;
  margin: 0 auto 56px;
}

.vision-beliefs__header h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(26px, 3vw, 38px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.vision-beliefs__header p {
  margin: 0;
  font-size: 17px;
  line-height: 1.7;
  color: var(--lab-muted);
}

.vision-beliefs__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
  max-width: var(--vision-grid-width);
  margin: 0 auto;
}

.belief-panel {
  min-height: 100%;
  padding: 32px;
  border-radius: 24px;
  display: grid;
  gap: 18px;
  align-content: start;
}

.belief-panel h3 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(22px, 2.4vw, 30px);
  line-height: 1.18;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.belief-panel--old {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.9));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.04);
}

.belief-panel--new {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.12), rgba(255, 255, 255, 0.92));
  border: 1px solid rgba(52, 120, 246, 0.16);
  box-shadow: 0 18px 48px rgba(52, 120, 246, 0.1);
}

.belief-panel ul {
  margin: 0;
  padding-left: 22px;
  display: grid;
  gap: 12px;
}

.belief-panel li {
  font-size: 15px;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.7;
}

.vision-beliefs__closing {
  margin: 32px auto 0;
  max-width: 780px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-deep);
}

.vision-mindset {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 100px 36px;
}

.vision-mindset__header {
  text-align: center;
  max-width: 640px;
  margin: 0 auto 56px;
}

.vision-mindset__header h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(26px, 3vw, 38px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.vision-mindset__grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 24px;
  align-items: start;
}

.vision-col {
  padding: 32px;
  border-radius: 20px;
  display: grid;
  gap: 16px;
}

.vision-col--strong {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.06), rgba(255, 255, 255, 0.8));
  border: 1px solid rgba(52, 120, 246, 0.12);
  box-shadow: 0 12px 40px rgba(52, 120, 246, 0.06);
}

.vision-col--weak {
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.15);
  opacity: 0.82;
}

.vision-col h3 {
  margin: 0;
  font-family: var(--display);
  font-size: 22px;
  font-weight: 700;
}

.vision-col ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 12px;
}

.vision-col li {
  display: grid;
  gap: 2px;
}

.vision-col li strong {
  font-size: 15px;
  color: var(--ink);
}

.vision-col li span {
  font-size: 14px;
  color: var(--lab-muted);
}

.vision-col__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: var(--lab-muted);
  padding-top: 60px;
}

.vision-mindset__note {
  text-align: center;
  margin: 40px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-deep);
}

.vision-problems {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 120px 36px;
}

.vision-problems__inner {
  display: grid;
  gap: 28px;
  max-width: var(--vision-copy-width);
  margin: 0 auto;
}

.vision-problems__inner h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(26px, 3vw, 38px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
  text-align: center;
}

.vision-problems__inner > p {
  margin: 0;
  text-align: center;
  color: var(--lab-muted);
  font-size: 16px;
  line-height: 1.7;
  max-width: 58ch;
  justify-self: center;
}

.vision-problem-compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  margin-top: 12px;
  align-items: stretch;
}

.vision-problems__reveal {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 0.56s ease, transform 0.56s ease;
}

.vision-problems.is-in-view .vision-problems__reveal {
  opacity: 1;
  transform: translateY(0);
}

.vision-problems__reveal--given { transition-delay: 0.08s; }
.vision-problems__reveal--created { transition-delay: 0.22s; }
.vision-problems__reveal--closing { transition-delay: 0.36s; }

.vision-problem {
  min-height: 100%;
  padding: 32px;
  border-radius: 24px;
  display: grid;
  gap: 18px;
  align-content: start;
}

.vision-problem__title {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(22px, 2.4vw, 30px);
  line-height: 1.18;
  letter-spacing: -0.02em;
  font-weight: 700;
  color: var(--ink);
}

.vision-problem--given {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(244, 247, 252, 0.9));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.04);
}

.vision-problem--created {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.12), rgba(255, 255, 255, 0.9));
  border: 1px solid rgba(52, 120, 246, 0.16);
  box-shadow: 0 18px 48px rgba(52, 120, 246, 0.1);
}

.vision-problem ul {
  margin: 0;
  padding-left: 22px;
  display: grid;
  gap: 12px;
}

.vision-problem li {
  font-size: 15px;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.7;
}

.vision-problems__closing {
  margin: 8px 0 0;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-deep);
}

.vision-capabilities {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 100px 36px;
}

.vision-capabilities__header {
  text-align: center;
  max-width: 780px;
  margin: 0 auto 56px;
}

.vision-capabilities__header h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(26px, 3vw, 38px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.vision-cap-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 20px;
  max-width: 1120px;
  margin: 0 auto;
}

.vision-cap-step {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  padding: 28px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(37, 99, 235, 0.08);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  min-height: 100%;
}

.vision-cap-step:hover {
  transform: translateY(-4px);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
}

.vision-cap-step--0,
.vision-cap-step--1 {
  grid-column: span 3;
}

.vision-cap-step--2,
.vision-cap-step--3,
.vision-cap-step--4 {
  grid-column: span 2;
}

.vision-cap-step--1 {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.08), rgba(255, 255, 255, 0.88));
}

.vision-cap-step--3 {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.12), rgba(255, 255, 255, 0.92));
  border-color: rgba(52, 120, 246, 0.14);
}

.vision-cap-step__left {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.vision-cap-step__index {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.05em;
}

.vision-cap-step__icon {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 10%, white);
  color: var(--accent-deep);
}

.vision-cap-step__icon :deep(svg) {
  width: 18px;
  height: 18px;
}

.vision-cap-step__body strong {
  display: block;
  margin-bottom: 4px;
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
}

.vision-cap-step__body p {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--lab-muted);
  line-height: 1.6;
}

.vision-cap-step__body small {
  font-size: 13px;
  color: color-mix(in srgb, var(--lab-muted) 60%, #fff);
}

/* Why WenFlow section */

.vision-why-wf {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 120px 36px;
  background: linear-gradient(180deg, rgba(244, 247, 252, 0.72), rgba(255, 255, 255, 0.96));
  border-radius: 24px;
}

.vision-why-wf__inner {
  max-width: var(--vision-copy-width);
  margin: 0 auto;
  display: grid;
  gap: 36px;
}

.vision-why-wf__intro {
  display: grid;
  gap: 20px;
  justify-items: center;
  text-align: center;
}

.vision-why-wf__label {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 6px 14px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 8%, white);
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.vision-why-wf__inner h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(28px, 3.2vw, 42px);
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 700;
  color: var(--ink);
}

.vision-why-wf__positioning {
  margin: 0;
  font-size: 18px;
  line-height: 1.7;
  color: var(--accent-deep);
  font-weight: 600;
  max-width: 680px;
  text-align: center;
}

.vision-why-wf__body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}

.vision-why-wf__block {
  display: grid;
  gap: 16px;
  padding: 28px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.14);
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.04);
}

.vision-why-wf__block--accent {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(255, 255, 255, 0.88));
  border-color: rgba(52, 120, 246, 0.14);
}

.vision-why-wf__block-tag {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.vision-why-wf__body p {
  margin: 0;
  font-size: 17px;
  line-height: 1.8;
  color: color-mix(in srgb, var(--ink) 68%, #fff);
  text-align: left;
}

.vision-why-wf__body strong {
  color: var(--ink);
  font-weight: 600;
}

.vision-why-wf__manifesto {
  display: grid;
  gap: 24px;
  max-width: 100%;
  padding: 36px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(23, 32, 51, 0.98), rgba(15, 23, 42, 0.98));
  color: rgba(255, 255, 255, 0.78);
  text-align: center;
  justify-items: center;
}

.vision-why-wf__manifesto p {
  margin: 0;
  font-size: 16px;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.68);
  max-width: 62ch;
}

.vision-why-wf__closing {
  font-size: 18px !important;
  line-height: 1.85 !important;
  color: #fff !important;
  font-weight: 500;
}

.vision-hero__tagline {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.vision-cta {
  position: relative;
  z-index: 1;
  width: 100%;
  background: linear-gradient(180deg, var(--ink), #0f172a);
  overflow: hidden;
}

.vision-cta__glow {
  position: absolute;
  top: 0;
  left: 50%;
  width: 700px;
  height: 350px;
  transform: translateX(-50%);
  background: radial-gradient(ellipse, rgba(52, 120, 246, 0.12), transparent 60%);
  pointer-events: none;
}

.vision-cta__inner {
  position: relative;
  z-index: 1;
  max-width: var(--vision-cta-width);
  margin: 0 auto;
  padding: 100px 36px 120px;
  text-align: center;
  display: grid;
  gap: 24px;
  justify-items: center;
}

.vision-cta__inner h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(28px, 3.2vw, 42px);
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 700;
  color: #fff;
}

.vision-cta__inner p {
  margin: 0;
  color: rgba(255, 255, 255, 0.5);
  font-size: 17px;
  line-height: 1.7;
  max-width: 50ch;
}

.vision-cta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 8px;
}

/* === AUTH PAGES === */

.auth-page {
  --ink: #172033;
  --paper: #f4f7fc;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --line: #d8e0ef;
  position: relative;
  min-height: calc(100vh - 86px);
  color: var(--ink);
  font-family: var(--body);
  overflow: hidden;
}

.auth-bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.auth-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.24;
}

.auth-bg-orb--1 {
  width: 520px;
  height: 520px;
  top: -120px;
  left: -120px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.22), transparent 70%);
  animation: orb-drift 28s ease-in-out infinite;
}

.auth-bg-orb--2 {
  width: 420px;
  height: 420px;
  right: -80px;
  bottom: -80px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.18), transparent 70%);
  animation: orb-drift 34s ease-in-out infinite reverse;
}

.auth-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(15, 23, 42, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15, 23, 42, 0.03) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: radial-gradient(circle at center, black 48%, transparent 88%);
}

.auth-shell {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  min-height: calc(100vh - 86px);
  padding: 48px 36px 72px;
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(420px, 0.98fr);
  gap: 28px;
  align-items: center;
}

.auth-brand {
  min-height: 620px;
  border-radius: 28px;
  padding: 44px;
  background: linear-gradient(180deg, #16233c, #0f172a);
  color: #fff;
  position: relative;
  overflow: hidden;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.24);
}

.auth-brand::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 18% 18%, rgba(52, 120, 246, 0.18), transparent 36%),
    radial-gradient(circle at 82% 78%, rgba(141, 107, 255, 0.14), transparent 38%);
  pointer-events: none;
}

.auth-brand__content {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 28px;
  align-content: space-between;
  min-height: 100%;
}

.auth-brand__eyebrow {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: rgba(203, 213, 225, 0.7);
  text-transform: uppercase;
}

.auth-brand h1 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(34px, 4vw, 54px);
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-weight: 700;
  max-width: 11ch;
}

.auth-brand p {
  margin: 0;
  font-size: 18px;
  line-height: 1.8;
  color: rgba(203, 213, 225, 0.72);
  max-width: 34ch;
}

.auth-brand__points {
  display: grid;
  gap: 14px;
}

.auth-point {
  display: grid;
  gap: 4px;
  padding: 18px 20px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

.auth-point strong {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.auth-point span {
  font-size: 14px;
  line-height: 1.65;
  color: rgba(203, 213, 225, 0.72);
}

.auth-panel {
  display: flex;
  justify-content: center;
}

.auth-card {
  width: min(100%, 520px);
  padding: 36px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(37, 99, 235, 0.08);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
  display: grid;
  gap: 28px;
}

.auth-card__header {
  display: grid;
  gap: 12px;
}

.auth-card__pill {
  width: fit-content;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.08em;
  background: color-mix(in srgb, var(--accent) 10%, white);
}

.auth-card__header h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(28px, 3vw, 40px);
  line-height: 1.12;
  letter-spacing: -0.03em;
  font-weight: 700;
}

.auth-card__header p {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  color: var(--lab-muted);
}

.auth-form {
  display: grid;
  gap: 18px;
}

.auth-field {
  display: grid;
  gap: 8px;
}

.auth-field span {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}

.auth-field input {
  width: 100%;
  min-height: 52px;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(255, 255, 255, 0.92);
  font: inherit;
  font-size: 15px;
  color: var(--ink);
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.auth-field input:focus {
  border-color: rgba(52, 120, 246, 0.4);
  box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.12);
  background: #fff;
}

.auth-field input::placeholder {
  color: color-mix(in srgb, var(--lab-muted) 70%, white);
}

.auth-meta {
  display: flex;
  justify-content: flex-start;
}

.auth-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--lab-muted);
}

.auth-checkbox input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}

.auth-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--lab-muted);
  margin-top: -6px;
}

.auth-actions {
  display: grid;
}

.auth-submit {
  width: 100%;
}

.auth-switch {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--lab-muted);
}

.auth-switch a {
  color: var(--accent-deep);
  font-weight: 700;
  text-decoration: none;
}

.auth-switch a:hover {
  text-decoration: underline;
}

/* === FEEDBACK PAGE === */

.feedback-page {
  --ink: #172033;
  --paper: #f4f7fc;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --line: #d8e0ef;
  display: grid;
  gap: 0;
  max-width: 100%;
  color: var(--ink);
  font-family: var(--body);
  position: relative;
  overflow: hidden;
}

.feedback-bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.feedback-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.2;
}

.feedback-bg-orb--1 {
  width: 500px;
  height: 500px;
  top: -100px;
  left: 30%;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.25), transparent 70%);
  animation: orb-drift 25s ease-in-out infinite;
}

.feedback-wrapup-hero {
  position: relative;
  z-index: 1;
  margin-bottom: 24px;
}

.feedback-metrics-row {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 36px 60px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.feedback-metrics-row--longterm {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.feedback-metric-card {
  padding: 24px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(37, 99, 235, 0.06);
  display: grid;
  gap: 8px;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.feedback-metric-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.06);
}

.feedback-metric-card__label {
  font-size: 12px;
  font-weight: 700;
  color: var(--lab-muted);
  letter-spacing: 0.04em;
}

.feedback-metric-card__value {
  font-family: var(--display);
  font-size: 32px;
  font-weight: 700;
  color: var(--ink);
  line-height: 1;
}

.feedback-metric-card p {
  margin: 0;
  font-size: 13px;
  color: var(--lab-muted);
  line-height: 1.5;
}

.feedback-profile {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 36px 60px;
}

.feedback-profile__inner {
  display: grid;
  gap: 28px;
}

.feedback-profile__inner h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(24px, 2.8vw, 34px);
  line-height: 1.2;
  font-weight: 700;
}

.feedback-profile__items {
  display: grid;
  gap: 16px;
}

.feedback-profile__item {
  padding: 20px 24px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(37, 99, 235, 0.06);
  border-left: 3px solid var(--accent);
  display: grid;
  gap: 8px;
}

.feedback-profile__item strong,
.feedback-risk-item strong {
  font-size: 14px;
  color: var(--accent-deep);
}

.feedback-profile__item p {
  margin: 0;
  font-size: 15px;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.6;
}

.feedback-risks {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 36px 60px;
}

.feedback-risks__inner {
  display: grid;
  gap: 24px;
}

.feedback-risks__inner h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(24px, 2.8vw, 34px);
  line-height: 1.2;
  font-weight: 700;
}

.feedback-risks__items {
  display: grid;
  gap: 12px;
}

.feedback-risk-item {
  padding: 18px 22px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(239, 117, 120, 0.12);
  border-left: 3px solid rgba(239, 117, 120, 0.4);
  display: grid;
  gap: 8px;
}

.feedback-risk-item--success {
  border-color: rgba(49, 177, 111, 0.12);
  border-left-color: rgba(49, 177, 111, 0.4);
  background: rgba(255, 255, 255, 0.52);
}

.feedback-risk-item p {
  margin: 0;
  font-size: 15px;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.6;
}

.feedback-next {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 36px 80px;
}

.feedback-next__inner {
  display: grid;
  gap: 32px;
}

.feedback-next__inner h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(24px, 2.8vw, 34px);
  line-height: 1.2;
  font-weight: 700;
}

.feedback-next__timeline {
  display: grid;
  gap: 0;
}

.feedback-next-step {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  padding: 20px 0;
  border-left: 2px solid rgba(52, 120, 246, 0.1);
  padding-left: 24px;
  position: relative;
}

.feedback-next-step__node {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  position: absolute;
  left: -18px;
}

.feedback-next-step__body strong {
  display: block;
  margin-bottom: 4px;
  font-size: 15px;
  color: var(--ink);
}

.feedback-next-step__body p {
  margin: 0;
  font-size: 14px;
  color: var(--lab-muted);
  line-height: 1.5;
}

.feedback-cta {
  position: relative;
  z-index: 1;
  padding: 0 36px 100px;
  text-align: center;
}

.feedback-cta__inner {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
}

/* === PLANNING PAGE === */

.planning-page {
  --ink: #172033;
  --paper: #f3f6fb;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --line: #d8e0ef;
  display: grid;
  gap: 0;
  max-width: 100%;
  color: var(--ink);
  font-family: var(--body);
  position: relative;
  overflow: hidden;
}

.planning-bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.planning-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.2;
}

.planning-bg-orb--1 {
  width: 520px;
  height: 520px;
  top: 140px;
  right: -110px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.18), transparent 70%);
  animation: orb-drift 28s ease-in-out infinite;
}

.planning-page-shell {
  position: relative;
  z-index: 1;
}

.planning-page-head {
  position: relative;
}

.planning-page-head--workbench {
  margin-bottom: 10px;
}

.planning-topbar {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  padding: 20px 24px;
  margin-bottom: 12px;
}

.planning-topbar__main {
  display: grid;
  gap: 8px;
  max-width: 720px;
}

.planning-topbar__main--formal {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  align-items: start;
  max-width: 780px;
}

.planning-topbar__title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.planning-topbar h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.1;
  letter-spacing: -0.04em;
}

.planning-topbar p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--lab-muted);
}

.planning-topbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.planning-topbar__actions--formal {
  align-self: stretch;
}

.planning-variant-page__head p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--lab-muted);
}

.planning-variant-page {
  display: grid;
  gap: 0;
  margin: 0 auto;
  max-width: 1360px;
  padding: 0 36px;
}

.planning-variant-page + .planning-variant-page {
  margin-top: 0;
}

.planning-variant-page__head {
  padding: 0;
  display: grid;
  gap: 6px;
}

.planning-variant-page__head h2 {
  margin: 0;
  font-size: 30px;
  line-height: 1.14;
  letter-spacing: -0.04em;
}

.planning-layout {
  position: relative;
  z-index: 1;
  max-width: 100%;
  margin: 0;
  padding: 0 0 10px;
}

.planning-layout--workbench {
  display: grid;
  grid-template-columns: 286px minmax(0, 1fr) 320px;
  gap: 22px;
  align-items: start;
}

.planning-layout--final {
  display: grid;
  grid-template-columns: 272px minmax(0, 1fr) 292px;
  gap: 24px;
  align-items: start;
}

.planning-layout--immersive,
.planning-layout--formal {
  display: block;
}

.planning-panel,
.planning-conversation,
.planning-immersive,
.planning-formal {
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.planning-panel {
  display: grid;
  gap: 18px;
  padding: 24px;
}

.planning-panel--status,
.planning-panel--mirror {
  position: sticky;
  top: 102px;
}

.planning-panel__head {
  display: grid;
  gap: 6px;
}

.planning-panel__head h2,
.planning-conversation__head h2,
.planning-immersive__hero h2,
.planning-formal__overview h2,
.planning-formal__conversation h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.18;
  letter-spacing: -0.03em;
}

.planning-understand__meter {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: start;
}

.planning-understand__meter span {
  font-size: 12px;
  color: var(--lab-muted);
}

.planning-understand__meter strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent-deep);
}

.planning-meter-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  overflow: hidden;
}

.planning-meter-bar__fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-deep));
}

.planning-stage-banner {
  padding: 16px 18px;
  border-radius: 16px;
  display: grid;
  gap: 6px;
}

.planning-stage-banner strong {
  font-size: 15px;
}

.planning-stage-banner p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.planning-stage-banner--primary {
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.1), rgba(255, 255, 255, 0.7));
  border: 1px solid rgba(52, 120, 246, 0.16);
}

.planning-stage-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(52, 120, 246, 0.1);
  color: var(--accent-deep);
  border: 1px solid rgba(52, 120, 246, 0.14);
}

.planning-understand__chips,
.planning-formal__chips,
.planning-composer__suggestions,
.planning-selected-strip__items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-chip {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-deep);
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  border: 1px solid rgba(52, 120, 246, 0.1);
}

.planning-current-task,
.planning-formal__current,
.planning-immersive__focus {
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.88);
  border: 1px solid rgba(23, 32, 51, 0.06);
  display: grid;
  gap: 6px;
}

.planning-status-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-status-item {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  border: 1px solid rgba(52, 120, 246, 0.12);
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
}

.planning-status-item--current {
  background: color-mix(in srgb, var(--lab-primary) 14%, white);
}

.planning-status-item--ghost {
  background: rgba(243, 246, 251, 0.92);
  border-color: rgba(148, 163, 184, 0.14);
  color: var(--lab-muted);
}

.planning-confirmed-block {
  display: grid;
  gap: 12px;
}

.planning-block-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--lab-muted);
  letter-spacing: 0.04em;
}

.planning-current-task strong,
.planning-formal__current strong,
.planning-immersive__focus strong,
.planning-quick-action-card strong,
.planning-formal__next-item strong {
  font-size: 14px;
  color: var(--ink);
}

.planning-current-task p,
.planning-formal__current p,
.planning-immersive__focus p,
.planning-quick-action-card p,
.planning-formal__next-item p,
.planning-immersive__floating-pending p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--lab-muted);
}

.planning-understand__signals {
  display: grid;
  gap: 12px;
}

.planning-signal {
  display: grid;
  gap: 4px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(23, 32, 51, 0.06);
}

.planning-signal span {
  font-size: 11px;
  color: var(--lab-muted);
  font-weight: 600;
}

.planning-signal strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}

.planning-signal p,
.planning-risk-card p,
.planning-mirror-card p,
.planning-formal__summary-card p,
.planning-completion-card p,
.planning-immersive__proposal-head p,
.planning-proposal__stage p {
  margin: 0;
  font-size: 13px;
  color: var(--lab-muted);
  line-height: 1.6;
}

.planning-understand__constraints {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-constraint {
  font-size: 12px;
  color: color-mix(in srgb, var(--ink) 74%, white);
  padding: 7px 10px;
  border-radius: 12px;
  background: rgba(243, 246, 251, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.planning-risk-list,
.planning-quick-action-list,
.planning-mirror-sections,
.planning-pending ul,
.planning-immersive__proposal-stages,
.planning-formal__summary-grid,
.planning-formal__next-list,
.planning-formal__messages {
  display: grid;
  gap: 12px;
}

.planning-risk-card,
.planning-quick-action-card,
.planning-mirror-card,
.planning-formal__summary-card,
.planning-formal__message,
.planning-completion-card,
.planning-immersive__proposal,
.planning-immersive__floating {
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.planning-risk-card strong,
.planning-mirror-card strong,
.planning-formal__summary-card strong,
.planning-completion-card h3 {
  font-size: 15px;
  color: var(--ink);
}

.planning-risk-card strong,
.planning-mirror-card span,
.planning-formal__summary-card span,
.planning-formal__message-role,
.planning-completion-card .section-kicker,
.planning-pending .section-kicker,
.planning-immersive__floating-grid span {
  display: block;
  margin-bottom: 6px;
}

.planning-conversation {
  padding: 24px;
  display: grid;
  gap: 18px;
}

.planning-conversation--final {
  gap: 20px;
}

.planning-conversation__head--final {
  align-items: end;
}

.planning-conversation__hint {
  font-size: 12px;
  font-weight: 700;
  color: var(--lab-muted);
}

.planning-conversation__meta {
  display: grid;
  justify-items: end;
  gap: 8px;
}

.planning-start-card {
  display: grid;
  gap: 14px;
  padding: 22px;
  border-radius: 24px;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.05), rgba(255, 255, 255, 0.96));
}

.planning-start-card__copy {
  display: grid;
  gap: 8px;
}

.planning-start-card__role {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.04em;
}

.planning-start-card__copy strong {
  font-size: 22px;
  line-height: 1.3;
}

.planning-start-card__copy p {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--lab-muted);
}

.planning-start-card__examples {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.planning-start-card__example {
  display: inline-flex;
  align-items: center;
  padding: 9px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(23, 32, 51, 0.06);
  font-size: 12px;
  color: color-mix(in srgb, var(--ink) 72%, white);
}

.planning-conversation__head,
.planning-conversation__head--formal {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: start;
}

.planning-messages {
  display: grid;
  gap: 16px;
}

.planning-msg {
  max-width: 88%;
  padding: 18px 20px;
  border-radius: 22px;
  display: grid;
  gap: 10px;
  border: 1px solid rgba(23, 32, 51, 0.06);
}

.planning-msg--ai {
  justify-self: start;
  background: rgba(243, 246, 251, 0.94);
}

.planning-msg--user {
  justify-self: end;
  background: color-mix(in srgb, var(--accent) 9%, white);
}

.planning-msg__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.planning-msg__meta small {
  font-size: 11px;
  color: var(--lab-muted);
}

.planning-msg__role {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  letter-spacing: 0.04em;
}

.planning-msg p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink);
}

.planning-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
}

.planning-reply-chip {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-deep);
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(52, 120, 246, 0.12);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.planning-selected-strip {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(243, 246, 251, 0.76);
  border: 1px dashed rgba(52, 120, 246, 0.18);
}

.planning-selected-strip__label {
  font-size: 12px;
  font-weight: 700;
  color: var(--lab-muted);
}

.planning-selected-reply,
.planning-composer__suggestion,
.planning-formal__chips span,
.planning-immersive__quick span,
.planning-completion-card__meta span {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(23, 32, 51, 0.06);
  color: color-mix(in srgb, var(--ink) 74%, white);
}

.planning-proposal {
  padding: 24px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.05), rgba(255, 255, 255, 0.92));
  border: 1px solid rgba(52, 120, 246, 0.12);
  display: grid;
  gap: 16px;
}

.planning-proposal--pending {
  margin-top: 4px;
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.03), rgba(255, 255, 255, 0.94));
}

.planning-proposal__head {
  display: grid;
  gap: 4px;
}

.planning-proposal__head strong {
  font-size: 18px;
  font-weight: 700;
}

.planning-proposal__head span {
  font-size: 13px;
  color: var(--lab-muted);
}

.planning-proposal__transition {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--accent-deep);
  font-weight: 600;
}

.planning-proposal__stages {
  display: grid;
  gap: 10px;
}

.planning-proposal__stage {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(243, 246, 251, 0.84);
  display: grid;
  gap: 4px;
}

.planning-proposal__stage strong,
.planning-immersive__proposal-stages strong {
  font-size: 14px;
}

.planning-proposal__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.planning-composer {
  display: grid;
  gap: 16px;
}

.planning-composer--entry {
  margin-top: -2px;
}

.planning-composer__box {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  padding: 14px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(23, 32, 51, 0.08);
}

.planning-composer__box textarea {
  width: 100%;
  border: none;
  resize: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font: inherit;
  line-height: 1.6;
}

.planning-mirror-sections {
  gap: 10px;
}

.planning-pending__list {
  display: grid;
  gap: 10px;
}

.planning-pending-card {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(243, 246, 251, 0.7);
  border: 1px dashed rgba(52, 120, 246, 0.16);
  display: grid;
  gap: 4px;
}

.planning-pending-card strong {
  font-size: 14px;
  color: var(--ink);
}

.planning-pending-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--lab-muted);
}

.planning-pending-card--compact p {
  display: none;
}

.planning-immersive {
  position: relative;
  padding: 28px;
  display: grid;
  gap: 22px;
}

.planning-immersive__hero {
  max-width: 780px;
  display: grid;
  gap: 10px;
}

.planning-immersive__focus {
  max-width: 640px;
}

.planning-immersive__hero p {
  margin: 0;
  color: var(--lab-muted);
  font-size: 14px;
  line-height: 1.7;
}

.planning-immersive__flow {
  max-width: 860px;
  display: grid;
  gap: 18px;
}

.planning-immersive__message {
  max-width: 700px;
  padding: 20px 22px;
  border-radius: 28px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(255, 255, 255, 0.86);
  display: grid;
  gap: 10px;
}

.planning-immersive__message--user {
  justify-self: end;
  background: color-mix(in srgb, var(--accent) 8%, white);
}

.planning-immersive__message span,
.planning-immersive__proposal-head strong,
.planning-immersive__floating-grid strong {
  font-size: 13px;
  font-weight: 700;
}

.planning-immersive__message p {
  margin: 0;
  font-size: 15px;
  line-height: 1.75;
}

.planning-immersive__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-immersive__proposal {
  display: grid;
  gap: 16px;
}

.planning-immersive__proposal-head {
  display: grid;
  gap: 6px;
}

.planning-immersive__proposal-stages article {
  display: grid;
  gap: 4px;
}

.planning-immersive__proposal-stages span {
  font-size: 13px;
  color: var(--lab-muted);
}

.planning-completion-card {
  display: grid;
  gap: 10px;
}

.planning-completion-card h3 {
  margin: 0;
}

.planning-completion-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.planning-immersive__floating {
  position: absolute;
  top: 34px;
  right: 28px;
  width: 320px;
  display: grid;
  gap: 14px;
}

.planning-immersive__floating-pending {
  display: grid;
  gap: 6px;
  padding-top: 2px;
}

.planning-immersive__floating-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.planning-immersive__floating-grid article {
  display: grid;
  gap: 4px;
}

.planning-composer--immersive {
  max-width: 860px;
}

.planning-composer__box--immersive {
  border-radius: 28px;
  box-shadow: 0 20px 48px rgba(23, 32, 51, 0.06);
}

.planning-formal {
  padding: 24px;
  display: grid;
  grid-template-columns: 420px minmax(0, 1fr);
  gap: 22px;
}

.planning-formal__overview,
.planning-formal__conversation {
  display: grid;
  gap: 18px;
}

.planning-formal__summary-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.planning-formal__stage {
  padding: 18px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  display: grid;
  gap: 14px;
}

.planning-formal__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.planning-formal__next-item {
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(23, 32, 51, 0.06);
  background: rgba(243, 246, 251, 0.72);
  display: grid;
  gap: 4px;
}

.planning-formal__message {
  gap: 8px;
}

.planning-formal__message p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
}

.planning-formal__message-role {
  font-size: 11px;
  font-weight: 700;
  color: var(--lab-muted);
  letter-spacing: 0.06em;
}

.planning-proposal--formal {
  background: rgba(250, 251, 253, 0.92);
}

.planning-proposal__stages--formal {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.planning-composer--formal {
  margin-top: auto;
}

.planning-composer__box--formal {
  border-radius: 16px;
}

/* === PATHS PAGE === */

.paths-page {
  --ink: #172033;
  --paper: #f4f7fc;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --line: #d8e0ef;
  display: grid;
  gap: 0;
  max-width: 100%;
  color: var(--ink);
  font-family: var(--body);
  position: relative;
  overflow: hidden;
}

.paths-bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.paths-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.2;
}

.paths-bg-orb--1 {
  width: 400px;
  height: 400px;
  top: 100px;
  left: -80px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.2), transparent 70%);
  animation: orb-drift 30s ease-in-out infinite;
}

.paths-hero {
  position: relative;
  z-index: 1;
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 32px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: end;
}

.paths-hero__copy {
  display: grid;
  gap: 12px;
  max-width: 760px;
}

.paths-hero__copy h1 {
  margin: 0;
  font-size: clamp(34px, 4vw, 50px);
  line-height: 1.08;
  letter-spacing: -0.04em;
}

.paths-hero__copy p {
  margin: 0;
  font-size: 15px;
  line-height: 1.75;
  color: var(--lab-muted);
}

.paths-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: flex-end;
}

.paths-filter-row {
  position: relative;
  z-index: 1;
  max-width: 1180px;
  margin: 18px auto 0;
  padding: 0 36px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.paths-filter-chip {
  min-height: 42px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(255, 255, 255, 0.84);
  color: var(--lab-text);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}

.paths-filter-chip strong {
  color: var(--accent-deep);
}

.paths-filter-chip--active {
  background: color-mix(in srgb, var(--lab-primary) 10%, white);
  border-color: rgba(52, 120, 246, 0.2);
}

.paths-grid {
  position: relative;
  z-index: 1;
  max-width: 1180px;
  margin: 0 auto;
  padding: 18px 36px 80px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}

.path-card {
  padding: 26px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(23, 32, 51, 0.06);
  display: grid;
  gap: 16px;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.path-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 44px rgba(15, 23, 42, 0.06);
}

.path-card--generating {
  border-style: dashed;
  border-color: rgba(52, 120, 246, 0.15);
  background: rgba(255, 255, 255, 0.64);
}

.path-card--failed {
  border-style: dashed;
  border-color: rgba(244, 170, 70, 0.2);
  background: rgba(255, 250, 245, 0.74);
}

.path-card--primary {
  box-shadow: 0 18px 44px rgba(52, 120, 246, 0.08);
  border-color: rgba(52, 120, 246, 0.12);
}

.path-card__generating {
  display: grid;
  gap: 12px;
  min-height: 220px;
  align-content: start;
}

.path-card__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(52, 120, 246, 0.15);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.path-card__status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.path-card__state-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.path-card__state-pill--primary {
  background: rgba(52, 120, 246, 0.1);
  color: var(--accent-deep);
}

.path-card__state-pill--active {
  background: rgba(49, 177, 111, 0.08);
  color: #238a58;
}

.path-card__state-pill--generating {
  background: rgba(52, 120, 246, 0.08);
  color: var(--accent-deep);
}

.path-card__state-pill--failed {
  background: rgba(244, 170, 70, 0.14);
  color: #a6680f;
}

.path-card__generating strong,
.path-card__failed strong {
  font-size: 16px;
  font-weight: 700;
}

.path-card__generating p,
.path-card__failed p {
  margin: 0;
  font-size: 14px;
  color: var(--lab-muted);
  line-height: 1.7;
}

.path-card__progress-bar {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  overflow: hidden;
}

.path-card__progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-deep));
  animation: progress-pulse 2s ease-in-out infinite;
}

@keyframes progress-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.path-card__failed {
  display: grid;
  gap: 12px;
  min-height: 220px;
  align-content: start;
}

.path-card__active {
  display: grid;
  gap: 16px;
}

.path-card__head {
  display: grid;
  gap: 6px;
}

.path-card__head strong {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
}

.path-card__active > p {
  margin: 0;
  font-size: 14px;
  color: var(--lab-muted);
  line-height: 1.6;
}

.path-card__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.path-card__stats span {
  font-size: 13px;
  color: var(--lab-muted);
  line-height: 1.5;
}

.path-card__progress-block {
  display: grid;
  gap: 10px;
}

.path-card__progress-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.path-card__progress-top strong {
  font-size: 20px;
  color: var(--accent-deep);
}

.path-card__progress-top span {
  font-size: 12px;
  color: var(--lab-muted);
}

.path-card__actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.paths-cta {
  position: relative;
  z-index: 1;
  max-width: 780px;
  margin: 0 auto;
  padding: 0 36px 100px;
  text-align: center;
}

.paths-cta__inner {
  display: grid;
  gap: 16px;
  justify-items: center;
}

.paths-cta__inner h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(24px, 2.8vw, 34px);
  font-weight: 700;
}

.paths-cta__inner p {
  margin: 0;
  color: var(--lab-muted);
  font-size: 16px;
}

/* === PATH DETAIL PAGE === */

.path-detail-page {
  --ink: #172033;
  --paper: #f4f7fc;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --line: #d8e0ef;
  display: grid;
  gap: 0;
  max-width: 100%;
  color: var(--ink);
  font-family: var(--body);
  position: relative;
  overflow: hidden;
}

.path-detail-bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.path-detail-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.18;
}

.path-detail-bg-orb--1 {
  width: 460px;
  height: 460px;
  top: 120px;
  right: -80px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.2), transparent 70%);
  animation: orb-drift 28s ease-in-out infinite;
}

.path-detail-hero,
.path-detail-main-grid {
  position: relative;
  z-index: 1;
  max-width: 1240px;
  width: calc(100% - 72px);
  margin: 0 auto;
}

.path-detail-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 28px;
  align-items: start;
  padding: 28px;
}

.path-detail-hero__copy {
  display: grid;
  gap: 18px;
}

.path-detail-hero__copy h1,
.path-stage-card__head h2,
.path-detail-side-card__head h2,
.learning-quiz-card__head strong {
  margin: 0;
  font-family: var(--display);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.path-detail-hero__copy h1 {
  font-size: clamp(34px, 4vw, 52px);
  line-height: 1.08;
}

.path-detail-hero__copy p,
.path-stage-card__summary,
.path-stage-task p,
.path-detail-plan-item p,
.path-detail-note-list li,
.learning-kp__desc,
.learning-quiz-option span:last-child {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.7;
}

.path-detail-hero__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.path-detail-hero__tag {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(243, 246, 251, 0.9);
  border: 1px solid rgba(23, 32, 51, 0.06);
  font-size: 11px;
  font-weight: 700;
  color: var(--lab-muted);
}

.path-detail-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.path-detail-overview-card {
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(52, 120, 246, 0.08);
  display: grid;
  gap: 6px;
}

.path-detail-overview-card span {
  font-size: 12px;
  color: var(--lab-muted);
}

.path-detail-overview-card strong {
  font-size: 24px;
  line-height: 1.05;
}

.path-detail-hero__progress {
  display: grid;
  gap: 16px;
  justify-items: center;
}

.path-detail-progress__ring {
  position: relative;
  width: 148px;
  height: 148px;
}

.path-detail-progress__ring svg {
  width: 100%;
  height: 100%;
}

.path-detail-progress__ring-label {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
}

.path-detail-progress__ring-label strong {
  font-family: var(--display);
  font-size: 28px;
  line-height: 1;
}

.path-detail-progress__ring-label span {
  font-size: 12px;
  color: var(--lab-muted);
}

.path-detail-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 336px;
  gap: 24px;
  padding: 0 0 72px;
}

.path-detail-stages,
.path-detail-sidebar,
.path-stage-card,
.path-detail-side-card,
.path-detail-plan-list {
  display: grid;
  gap: 16px;
}

.path-stage-card__head,
.path-stage-task__head,
.path-stage-task__foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.path-stage-card__head h2,
.path-detail-side-card__head h2 {
  font-size: 24px;
  line-height: 1.14;
}

.path-stage-card__badge,
.path-stage-task__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.path-stage-card__badge {
  background: color-mix(in srgb, var(--accent) 10%, white);
  color: var(--accent-deep);
}

.path-stage-card__badge--success {
  background: rgba(49, 177, 111, 0.1);
  color: #238a58;
}

.path-stage-card__badge--primary {
  background: rgba(52, 120, 246, 0.1);
  color: var(--accent-deep);
}

.path-stage-card__badge--accent {
  background: rgba(141, 107, 255, 0.12);
  color: #6f52d9;
}

.path-stage-task__meta span {
  font-size: 12px;
  color: var(--lab-muted);
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(244, 247, 252, 0.86);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.path-stage-card__tasks {
  display: grid;
  gap: 12px;
}

.path-stage-task,
.path-detail-plan-item {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(52, 120, 246, 0.08);
}

.path-stage-task__head strong,
.path-detail-plan-item strong {
  display: block;
  font-size: 15px;
}

.path-stage-task__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.path-stage-task__status {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
}

.path-stage-task__badge--success {
  color: #1f8c58;
  background: rgba(49, 177, 111, 0.1);
}

.path-stage-task__badge--primary {
  color: var(--accent-deep);
  background: rgba(52, 120, 246, 0.1);
}

.path-stage-task__badge--warning {
  color: #b26b00;
  background: rgba(245, 158, 11, 0.12);
}

.path-stage-task__badge--accent {
  color: #6f52d9;
  background: rgba(141, 107, 255, 0.12);
}

.path-detail-note-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 10px;
}

.path-detail-side-card__time {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-deep);
}

.path-detail-side-card--light {
  background: rgba(255, 255, 255, 0.68);
}

.btn--full {
  width: 100%;
}

/* === LEARNING PAGE === */

.learning-shell {
  position: relative;
  z-index: 1;
  max-width: 1280px;
  width: calc(100% - 72px);
  margin: 0 auto;
  display: grid;
  gap: 14px;
  padding-bottom: 18px;
}

.learning-page {
  --ink: #172033;
  --paper: #f4f7fc;
  --accent: #3478f6;
  --accent-deep: #1f57cc;
  --line: #d8e0ef;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 100vh;
  max-width: 100%;
  color: var(--ink);
  font-family: var(--body);
}

.learning-hero {
  display: grid;
  gap: 16px;
  padding: 24px 28px;
}

.learning-hero__top {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: start;
}

.learning-hero__title {
  display: grid;
  gap: 10px;
}

.learning-hero__title h1 {
  margin: 0;
  font-size: clamp(30px, 3.6vw, 44px);
  line-height: 1.08;
  letter-spacing: -0.04em;
}

.learning-hero__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.learning-hero__summary {
  display: grid;
  gap: 12px;
}

.learning-hero__summary p {
  margin: 0;
  max-width: 820px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--lab-muted);
}

.learning-hero__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.learning-hero__meta span {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(243, 246, 251, 0.9);
  border: 1px solid rgba(23, 32, 51, 0.06);
  font-size: 12px;
  color: var(--lab-muted);
  font-weight: 700;
}

.learning-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.learning-topbar--independent {
  position: static;
  border-radius: 18px;
  padding: 14px 18px;
}

.learning-topbar__left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.learning-topbar__back {
  font-size: 13px;
  color: var(--accent-deep);
  text-decoration: none;
  font-weight: 600;
}

.learning-topbar__route {
  font-size: 12px;
  color: var(--lab-muted);
}

.learning-topbar__center strong {
  font-size: 16px;
  font-weight: 700;
}

.learning-topbar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.learning-topbar__status {
  font-size: 12px;
  font-weight: 700;
  color: #31b16f;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(49, 177, 111, 0.08);
}

.learning-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
}

.learning-sidebar {
  border-right: 1px solid var(--line);
  padding: 20px;
  display: grid;
  gap: 14px;
  align-content: start;
  background: rgba(255, 255, 255, 0.5);
}

.learning-sidebar__progress,
.learning-sidebar__tip {
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(23, 32, 51, 0.06);
  display: grid;
  gap: 12px;
}

.learning-sidebar__head strong {
  font-size: 14px;
  font-weight: 700;
  color: var(--lab-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.learning-sidebar__progress-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.1);
  overflow: hidden;
}

.learning-sidebar__progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-deep));
}

.learning-sidebar__progress-meta {
  display: grid;
  gap: 4px;
}

.learning-sidebar__progress-meta span {
  font-size: 12px;
  color: var(--lab-muted);
}

.learning-sidebar__progress-meta strong {
  font-size: 14px;
  color: var(--ink);
}

.learning-sidebar__nav {
  display: grid;
  gap: 10px;
}

.learning-kp {
  padding: 14px 14px 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(23, 32, 51, 0.06);
  display: grid;
  gap: 10px;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
}

.learning-kp--mastered {
  border-color: rgba(49, 177, 111, 0.15);
}

.learning-kp--current {
  background: color-mix(in srgb, var(--accent) 8%, white);
  border-color: rgba(52, 120, 246, 0.16);
  box-shadow: inset 3px 0 0 var(--accent);
}

.learning-kp__head {
  display: flex;
  align-items: start;
  gap: 10px;
}

.learning-kp__order {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(243, 246, 251, 0.94);
  border: 1px solid rgba(23, 32, 51, 0.08);
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
  flex-shrink: 0;
}

.learning-kp__title-group {
  display: grid;
  gap: 3px;
  flex: 1;
}

.learning-kp__head strong {
  font-size: 13px;
  font-weight: 700;
}

.learning-kp__title-group small {
  font-size: 11px;
  color: var(--lab-muted);
}

.learning-kp__state {
  font-size: 11px;
  font-weight: 700;
  color: var(--lab-muted);
  white-space: nowrap;
}

.learning-kp__desc {
  font-size: 12px;
}

.learning-kp__bar {
  height: 4px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  overflow: hidden;
}

.learning-kp__fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-deep));
  transition: width 0.4s ease;
}

.learning-kp--mastered .learning-kp__fill {
  background: #31b16f;
}

.learning-kp__children {
  display: grid;
  gap: 8px;
  padding-left: 38px;
}

.learning-kp__child {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  font-size: 12px;
  color: var(--lab-muted);
}

.learning-kp__child-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.5);
}

.learning-kp__child--completed .learning-kp__child-dot {
  background: #31b16f;
}

.learning-kp__child--current .learning-kp__child-dot {
  background: var(--accent);
}

.learning-kp__child--current {
  color: var(--ink);
  font-weight: 600;
}

.learning-main {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto;
  padding: 24px;
  gap: 20px;
  min-height: 0;
}

.learning-messages {
  display: grid;
  gap: 14px;
  align-content: start;
  overflow-y: auto;
  padding-right: 8px;
}

.learning-msg {
  max-width: 85%;
  padding: 16px 20px;
  border-radius: 16px;
  display: grid;
  gap: 6px;
}

.learning-msg--ai {
  justify-self: start;
  background: rgba(244, 247, 252, 0.9);
}

.learning-msg--user {
  justify-self: end;
  background: color-mix(in srgb, var(--accent) 8%, white);
}

.learning-msg__role {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-deep);
}

.learning-msg p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink);
}

.learning-msg__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.learning-msg__tags span {
  font-size: 11px;
  color: var(--accent-deep);
  padding: 4px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 8%, white);
}

.learning-quiz-card {
  display: grid;
  gap: 14px;
  padding: 20px;
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: linear-gradient(180deg, rgba(52, 120, 246, 0.04), rgba(255, 255, 255, 0.84));
}

.learning-quiz-card__head {
  display: grid;
  gap: 10px;
}

.learning-quiz-card__head strong {
  font-size: 22px;
  line-height: 1.25;
}

.learning-quiz-card__options {
  display: grid;
  gap: 10px;
}

.learning-quiz-option {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(255, 255, 255, 0.8);
}

.learning-quiz-option--selected {
  border-color: rgba(49, 177, 111, 0.18);
  background: color-mix(in srgb, #31b16f 7%, white);
}

.learning-quiz-option__label {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-deep);
  background: color-mix(in srgb, var(--accent) 10%, white);
}

.learning-completion {
  padding: 16px 20px;
  border-radius: 14px;
  background: rgba(49, 177, 111, 0.06);
  border: 1px solid rgba(49, 177, 111, 0.12);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.learning-completion span {
  font-size: 14px;
  font-weight: 600;
  color: #31b16f;
}

.learning-completion__actions {
  display: flex;
  gap: 10px;
}

.learning-composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.6);
}

.learning-composer input {
  border: none;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: var(--ink);
  outline: none;
}

.learning-composer input::placeholder {
  color: var(--lab-muted);
}

.home-section__heading h2 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(26px, 3vw, 36px);
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.home-section__heading p {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 72%, #fff);
  line-height: 1.7;
  font-size: 17px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 12px;
  border: 1px solid var(--line);
  text-decoration: none;
  font-weight: 600;
}

.btn--primary {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  box-shadow: 0 10px 24px rgba(52, 120, 246, 0.28);
}

.btn--ghost {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.76);
}

.pill {
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--line));
  background: color-mix(in srgb, var(--accent) 12%, white);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 10%, white);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 700;
}

.quote-card {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.88);
}

.quote-card h2 {
  font-family: var(--display);
  font-size: 26px;
  line-height: 1.2;
  font-weight: 700;
}

.quote-card blockquote {
  margin: 0;
  padding: 18px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--paper) 50%, white);
  color: var(--ink);
  font-size: 22px;
  line-height: 1.5;
  font-weight: 600;
}






@media (max-width: 1024px) {
  .demo-site__header {
    padding: 12px 12px 0;
  }

  .site-nav-shell {
    grid-template-columns: 1fr;
    align-items: stretch;
    padding: 0 8px 12px;
  }

  .site-nav {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .site-nav__actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .dashboard-shell {
    padding: 24px 24px 60px;
  }

  .workbench-scene-shell {
    padding: 18px 18px 16px;
  }

  .dashboard-appbar,
  .dashboard-hero,
  .workbench-scene-hero,
  .dashboard-section__head,
  .dashboard-flow-grid,
  .state-layout,
  .achievement-card-grid {
    grid-template-columns: 1fr;
  }

  .app-site__header {
    padding: 12px 12px 0;
  }

  .app-nav-shell {
    grid-template-columns: 1fr;
    align-items: stretch;
    padding: 0 8px 12px;
  }

  .app-nav {
    overflow-x: auto;
  }

  .app-header__actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .app-page-head__summary {
    grid-template-columns: 1fr;
  }

  .dashboard-appnav {
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .dashboard-hero__copy h1 {
    max-width: none;
  }

  .workbench-scene-hero__copy h1 {
    max-width: none;
  }

  .workbench-scene-hero {
    padding: 18px;
  }

  .workbench-scene-glance {
    padding: 14px;
  }

  .dashboard-overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-achievement-stats,
  .state-metrics-grid,
  .achievement-overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .state-layout,
  .state-metrics-grid,
  .achievement-overview-grid,
  .achievement-filter-row,
  .achievement-card-grid {
    width: calc(100% - 48px);
  }

  .state-trend-chart {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .demo-home {
    gap: 0;
  }

  .home-hero {
    grid-template-columns: 1fr;
    padding: 48px 24px 40px;
    gap: 36px;
    min-height: auto;
  }

  .home-hero__copy h1 {
    font-size: clamp(36px, 7vw, 52px);
    max-width: none;
  }

  .home-hero__glow {
    width: 350px;
    height: 350px;
  }

  .scene-turn {
    max-width: 95%;
  }

  .home-why {
    padding: 80px 24px;
  }

  .home-how {
    padding: 80px 24px;
  }

  .how-flow__nodes {
    grid-template-columns: 1fr;
    gap: 20px;
    margin-top: 0;
  }

  .how-node {
    justify-items: start;
    text-align: left;
    grid-template-columns: 48px minmax(0, 1fr);
    gap: 16px;
  }

  .how-flow__svg {
    display: none;
  }

  .home-preview {
    padding: 80px 24px;
  }

  .preview-panels {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .preview-panel--1 {
    transform: none;
  }

  .preview-panel--1:hover {
    transform: translateY(-4px);
  }

  .home-capabilities {
    padding: 80px 24px;
  }

  .home-why {
    padding: 80px 24px;
  }

  .home-why__grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .why-panel--vs {
    padding: 8px 0;
  }

  .home-final-cta__inner {
    padding: 80px 24px 100px;
  }

  .home-bg-orb--1 {
    width: 300px;
    height: 300px;
  }

  .home-bg-orb--2 {
    width: 250px;
    height: 250px;
  }

  /* Vision responsive */
  .auth-shell {
    grid-template-columns: 1fr;
    min-height: auto;
    padding: 32px 24px 56px;
  }

  .auth-brand {
    min-height: auto;
    padding: 28px 24px;
  }

  .auth-brand__content {
    gap: 20px;
  }

  .auth-brand h1 {
    max-width: none;
    font-size: clamp(30px, 8vw, 42px);
  }

  .auth-brand p {
    max-width: none;
    font-size: 16px;
  }

  .auth-card {
    width: 100%;
    padding: 28px 24px;
  }

  .vision-hero {
    padding: 60px 24px;
    min-height: auto;
  }

  .vision-hero__inner {
    gap: 28px;
  }

  .vision-hero__inner h1 {
    font-size: clamp(32px, 6vw, 48px);
  }

  .vision-hero__band {
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 18px 20px;
  }

  .vision-hero__timeline {
    justify-content: center;
  }

  .vision-hero__signal {
    text-align: center;
  }

  .vision-era {
    padding: 80px 24px;
  }

  .vision-era__header {
    margin-bottom: 32px;
  }

  .vision-era__inner {
    grid-template-columns: 1fr;
  }

  .vision-era__quote-side,
  .vision-era__context-side {
    padding: 24px;
  }

  .vision-era__response p {
    font-size: 18px;
  }

  .vision-mindset {
    padding: 80px 24px;
  }

  .vision-mindset__grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .vision-col__arrow {
    padding-top: 0;
    transform: rotate(90deg);
  }

  .vision-problems {
    padding: 80px 24px;
  }

  .vision-problem-compare {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .vision-problem {
    padding: 24px;
  }

  .vision-capabilities {
    padding: 80px 24px;
  }

  .vision-cap-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .vision-cap-step--0,
  .vision-cap-step--1,
  .vision-cap-step--2,
  .vision-cap-step--3,
  .vision-cap-step--4 {
    grid-column: auto;
  }

  .vision-cap-step {
    padding: 24px;
  }

  .vision-cta__inner {
    padding: 80px 24px 100px;
  }

  .vision-why-wf {
    padding: 80px 24px;
  }

  .vision-why-wf__body {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .vision-why-wf__block,
  .vision-why-wf__manifesto {
    padding: 24px;
  }

  .vision-beliefs {
    padding: 80px 24px;
  }

  .vision-beliefs__grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .belief-panel {
    padding: 24px;
  }

  .vision-beliefs__closing {
    margin-top: 24px;
  }

  /* Feedback responsive */
  .feedback-wrapup-hero {
    margin-bottom: 18px;
  }

  .feedback-metrics-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 0 24px 40px;
  }

  .feedback-profile {
    padding: 60px 24px;
  }

  .feedback-risks {
    padding: 0 24px 60px;
  }

  .feedback-next {
    padding: 0 24px 60px;
  }

  /* Planning responsive */
  .planning-layout {
    padding: 0 0 10px;
  }

  .planning-topbar,
  .planning-topbar__main--formal,
  .planning-topbar__actions {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: flex-start;
  }

  .planning-variant-page,
  .planning-layout--final,
  .planning-layout--workbench,
  .planning-formal,
  .planning-proposal__stages--formal,
  .planning-formal__summary-grid,
  .planning-immersive__floating-grid {
    grid-template-columns: 1fr;
  }

  .planning-variant-page {
    padding: 0 24px;
  }

  .planning-panel--status,
  .planning-panel--mirror,
  .planning-immersive__floating {
    position: static;
  }

  .planning-immersive__floating {
    width: auto;
  }

  .planning-conversation__head,
  .planning-conversation__head--formal,
  .planning-composer__box {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .planning-immersive,
  .planning-formal,
  .planning-conversation,
  .planning-panel {
    padding: 20px;
  }

  .planning-msg,
  .planning-immersive__message {
    max-width: 100%;
  }

  .planning-start-card,
  .planning-composer--entry,
  .planning-proposal--pending {
    order: initial;
  }

  /* Paths responsive */
  .paths-hero {
    grid-template-columns: 1fr;
    padding: 24px;
  }

  .paths-hero__actions {
    justify-content: flex-start;
  }

  .paths-filter-row {
    padding: 0 24px;
  }

  .paths-grid {
    grid-template-columns: 1fr;
    padding: 0 24px 60px;
  }

  .path-card__stats {
    grid-template-columns: 1fr;
  }

  /* Path detail responsive */
  .path-detail-hero,
  .path-detail-main-grid {
    grid-template-columns: 1fr;
  }

  .path-detail-hero,
  .path-detail-main-grid {
    width: calc(100% - 48px);
  }

  .path-detail-overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  /* Learning responsive */
  .learning-layout {
    grid-template-columns: 1fr;
  }

  .learning-shell,
  .learning-hero__top,
  .learning-hero__actions {
    width: calc(100% - 48px);
    flex-direction: column;
    align-items: flex-start;
  }

  .learning-sidebar {
    border-right: none;
    border-bottom: 1px solid var(--line);
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 16px;
  }

  .learning-sidebar__head {
    grid-column: auto;
  }

  .learning-kp__children {
    padding-left: 20px;
  }

  .learning-topbar {
    flex-wrap: wrap;
    gap: 8px;
  }

  .ui-lab-float {
    right: 16px;
    bottom: 16px;
  }

  .belief-grid,
  .compare-split,
  .problem-grid,
  .capability-grid,
  .dashboard-overview-grid,
  .achievement-spotlight-grid,
  .feedback-hero,
  .feedback-grid,
  .feedback-metrics {
    grid-template-columns: 1fr;
  }

  .achievement-card-grid {
    grid-template-columns: 1fr;
  }
}
</style>
