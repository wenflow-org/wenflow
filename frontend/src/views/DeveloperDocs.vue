<template>
  <div class="docs v2-page">
    <!-- 顶栏 -->
    <header class="docs-nav">
      <div class="docs-nav__inner">
        <router-link to="/" class="docs-brand">
          <img src="/logo.png" alt="问流" class="docs-brand__logo" />
          <span class="docs-brand__name">问流</span>
          <span class="docs-brand__tag">开发者</span>
        </router-link>
        <nav class="docs-nav__links">
          <a href="#quickstart">快速开始</a>
          <a href="#architecture">架构</a>
          <a href="#skill-dev">Skill 开发</a>
          <a href="#console">控制台</a>
          <a href="#api">API</a>
        </nav>
        <router-link to="/" class="docs-nav__back">返回首页</router-link>
      </div>
    </header>

    <!-- 标题区 -->
    <section class="docs-hero">
      <span class="kicker">WENFLOW DEVELOPER DOCS</span>
      <h1>开发者文档</h1>
      <p>本地运行、架构与 Skill 体系、Prompt 工程、控制台与 API。</p>
      <div class="docs-hero__chips">
        <span class="hero-chip">Node.js ≥ 18</span>
        <span class="hero-chip">后端 3001 · 前端 5173</span>
        <span class="hero-chip">Prompt = File-as-Truth</span>
      </div>
    </section>

    <div class="docs-body">
      <!-- 侧边栏 -->
      <aside class="docs-side">
        <div class="docs-side__group">
          <span class="docs-side__title">入门</span>
          <a href="#quickstart" :class="{ on: active === 'quickstart' }">快速开始</a>
          <a href="#architecture" :class="{ on: active === 'architecture' }">架构总览</a>
          <a href="#env" :class="{ on: active === 'env' }">环境变量</a>
        </div>
        <div class="docs-side__group">
          <span class="docs-side__title">核心</span>
          <a href="#skills" :class="{ on: active === 'skills' }">Skill 体系</a>
          <a href="#prompts" :class="{ on: active === 'prompts' }">Prompt 工程</a>
          <a href="#skill-dev" :class="{ on: active === 'skill-dev' }">开发一个 Skill</a>
        </div>
        <div class="docs-side__group">
          <span class="docs-side__title">工具</span>
          <a href="#console" :class="{ on: active === 'console' }">控制台</a>
          <a href="#api" :class="{ on: active === 'api' }">API 参考</a>
          <a href="#testing" :class="{ on: active === 'testing' }">测试与质量</a>
        </div>
      </aside>

      <!-- 内容 -->
      <main class="docs-main">
        <!-- ================= 快速开始 ================= -->
        <section id="quickstart" class="docs-sec">
          <h2>快速开始</h2>
          <p class="docs-lead">Windows + PowerShell 是一等开发环境；Node.js ≥ 18。全部命令在项目根目录执行。</p>

          <div class="code">
            <div class="code__head"><span>终端</span><button @click="copy($event)">复制</button></div>
            <pre><code>git clone https://github.com/wenflow-org/wenflow.git
cd wenflow

# 安装依赖（根目录脚本会处理后端的 prisma generate）
npm install

# 交互式生成 backend/.env（JWT 密钥 / 数据库 / AI 服务）
npm run env:setup

# 启动后端 3001 + 前端 5173
npm run dev</code></pre>
          </div>

          <div class="callout">
            <strong>启动即崩？</strong> 后端启动时校验 <code>JWT_SECRET</code>，缺失或弱于 32 字符会直接退出——先跑 <code>npm run env:setup</code>。
          </div>

          <div class="mini-grid">
            <div class="mini">
              <span class="mini__k mono">5173</span>
              <strong>前端 Vite</strong>
              <p>开发服务器，<code>/api</code> 代理到后端，免 CORS 配置。</p>
            </div>
            <div class="mini">
              <span class="mini__k mono">3001</span>
              <strong>后端 Express</strong>
              <p>ts-node-dev 热重启，<code>/readyz</code> 提供健康检查。</p>
            </div>
            <div class="mini">
              <span class="mini__k mono">SQLite</span>
              <strong>数据库</strong>
              <p>首次运行由 Prisma 自动建库；<code>npm run prisma:studio</code> 可视浏览。</p>
            </div>
          </div>
        </section>

        <!-- ================= 架构总览 ================= -->
        <section id="architecture" class="docs-sec">
          <h2>架构总览</h2>
          <p class="docs-lead">一次 LLM 调用的真实链路：</p>

          <div class="flow">
            <div class="flow__node">routes</div>
            <span class="flow__arrow">→</span>
            <div class="flow__node">services / orchestrators</div>
            <span class="flow__arrow">→</span>
            <div class="flow__node flow__node--hot">skills.executeSkill</div>
            <span class="flow__arrow">→</span>
            <div class="flow__node">LLM（DeepSeek 兼容）</div>
          </div>

          <div class="mini-grid">
            <div class="mini">
              <span class="mini__k">前端</span>
              <strong>Vue 3 + TS + Vite 5</strong>
              <p>Element Plus + Pinia；学习者前台（v2）与 Admin 控制台（admin-redesign）两套界面。</p>
            </div>
            <div class="mini">
              <span class="mini__k">后端</span>
              <strong>Express + Prisma</strong>
              <p>TypeScript；业务库 + 系统库双 SQLite；strict 模式关闭，注意可空性。</p>
            </div>
            <div class="mini">
              <span class="mini__k">网关</span>
              <strong>EduClaw Gateway</strong>
              <p><code>executeSkill(definition, input)</code> 统一入口：日志、统计、上下文包装、可靠性预算。</p>
            </div>
            <div class="mini">
              <span class="mini__k">AI</span>
              <strong>OpenAI SDK</strong>
              <p>指向 DeepSeek 兼容 API；模型与密钥走后台「连接与安全」，不入库源码。</p>
            </div>
          </div>

          <div class="callout callout--warn">
            <strong>「Agent」已是历史概念。</strong> 现在的 LLM 能力单元是 <strong>Skill</strong>，全部位于 <code>backend/src/skills/</code>；<code>agents/</code> 仅余事件驱动的 <code>learner-model-agent</code>、仿真编排与 plugins 等遗留目录。文档与旧代码中的 Agent 字样大多指 Skill。
          </div>
        </section>

        <!-- ================= 环境变量 ================= -->
        <section id="env" class="docs-sec">
          <h2>环境变量</h2>
          <p class="docs-lead">后端 <code>backend/.env</code> 最小集（<code>npm run env:setup</code> 交互生成）：</p>

          <div class="table">
            <div class="table__row table__row--head">
              <span>变量</span><span>说明</span>
            </div>
            <div class="table__row"><code class="mono">JWT_SECRET</code><span>≥ 32 字符，启动校验，缺失即崩</span></div>
            <div class="table__row"><code class="mono">DATABASE_URL</code><span>开发默认 <code>file:./dev.db</code></span></div>
            <div class="table__row"><code class="mono">AI_API_URL / AI_API_KEY / AI_MODEL</code><span>DeepSeek 兼容服务；也可在控制台「连接与安全」页在线改</span></div>
            <div class="table__row"><code class="mono">INIT_ADMIN_PASSWORD</code><span>首次启动播种管理员（≥12 位强密码）</span></div>
          </div>
        </section>

        <!-- ================= Skill 体系 ================= -->
        <section id="skills" class="docs-sec">
          <h2>Skill 体系</h2>
          <p class="docs-lead">Skill 是平台唯一的 LLM 能力单元：一个 TS handler + 一份 Prompt 资产。</p>

          <div class="code">
            <div class="code__head"><span>backend/src/skills/ 结构（简化）</span><button @click="copy($event)">复制</button></div>
            <pre><code>backend/src/skills/
├── index.ts                 # skillHandlers 注册表（全部 handler 在此登记）
├── goal-conversation/       # 目标对话（conversational）
├── path-planning/           # 路径规划（generator）
├── teaching-turn/           # 教学回合（conversational）
├── session-wrapup/          # 课后产出（distiller）
└── …                        # 共 30+ 个 Skill 目录（含检索、网页、图片等外挂能力）

prompts/                     # 仓库根，与 backend/ 同级
├── skill.&lt;skillId&gt;.md      # Prompt 源文件（File-as-Truth）
└── core/&lt;skillId&gt;.yaml      # v4 核心定义（业务 SSOT）</code></pre>
          </div>

          <div class="mini-grid">
            <div class="mini">
              <span class="mini__k mono">executeSkill</span>
              <strong>统一执行入口</strong>
              <p>所有调用必须经 <code>skills.executeSkill(definition, input)</code>：自动获得日志、统计、上下文包装与可靠性预算，禁止绕开直连 LLM。</p>
            </div>
            <div class="mini">
              <span class="mini__k mono">skillHandlers</span>
              <strong>注册表</strong>
              <p><code>skills/index.ts</code> 的 <code>skillHandlers</code> map 把 skillId 映射到 handler；未注册即不存在。</p>
            </div>
          </div>
        </section>

        <!-- ================= Prompt 工程 ================= -->
        <section id="prompts" class="docs-sec">
          <h2>Prompt 工程</h2>
          <p class="docs-lead">Prompt 是一等工程资产，不是配置：源文件进 Git，DB 存生效版本。</p>

          <div class="flow">
            <div class="flow__node">prompts/skill.*.md<br /><span class="flow__sub">Git 审核</span></div>
            <span class="flow__arrow">→</span>
            <div class="flow__node">同步<br /><span class="flow__sub">seed / 部署</span></div>
            <span class="flow__arrow">→</span>
            <div class="flow__node flow__node--hot">DB agent_prompts<br /><span class="flow__sub">ACTIVE 版本</span></div>
            <span class="flow__arrow">→</span>
            <div class="flow__node">运行时生效</div>
          </div>

          <div class="mini-grid">
            <div class="mini">
              <span class="mini__k">五块结构</span>
              <strong>编译产物</strong>
              <p>v4 协议：<code>prompts/core/&lt;skillId&gt;.yaml</code> 是业务 SSOT，经 core-compiler 编译为五块 Prompt；frontmatter 携带 <code>coreHash</code> 防漂移。</p>
            </div>
            <div class="mini">
              <span class="mini__k">archetype</span>
              <strong>六种原型</strong>
              <p>conversational / generator / extractor / distiller / copywriter / code-only，决定块结构与运行时契约。</p>
            </div>
            <div class="mini">
              <span class="mini__k mono">prompts:lint</span>
              <strong>静态检查</strong>
              <p>v2/v4 双轨校验；<code>prompts:core:check</code> 检测 core 与产物漂移，发布前必过。</p>
            </div>
            <div class="mini">
              <span class="mini__k">只读线上</span>
              <strong>线上不可编辑</strong>
              <p>生效内容只能改文件、走同步。后台版本管理仅支持查看、对比、发布与删除草稿。</p>
            </div>
          </div>
        </section>

        <!-- ================= 开发一个 Skill ================= -->
        <section id="skill-dev" class="docs-sec">
          <h2>开发一个 Skill</h2>
          <p class="docs-lead">六步，从空目录到控制台可见可试跑：</p>

          <ol class="steps">
            <li>
              <span class="steps__no">1</span>
              <div>
                <strong>写 Prompt 源文件</strong>
                <p>新建 <code>prompts/skill.my-skill.md</code>（v4：先写 <code>prompts/core/my-skill.yaml</code> 再编译）。跑 <code>npm run prompts:lint</code> 校验。</p>
              </div>
            </li>
            <li>
              <span class="steps__no">2</span>
              <div>
                <strong>写 handler</strong>
                <p>在 <code>backend/src/skills/</code> 建模块，导出符合 <code>SkillHandler</code> 签名的函数；LLM 调用走 <code>executeSkill</code>。</p>
              </div>
            </li>
            <li>
              <span class="steps__no">3</span>
              <div>
                <strong>注册</strong>
                <p>在 <code>skills/index.ts</code> 的 <code>skillHandlers</code> map 中登记 <code>'my-skill': handler</code>。</p>
              </div>
            </li>
            <li>
              <span class="steps__no">4</span>
              <div>
                <strong>同步 Prompt 到 DB</strong>
                <p>通过部署同步（启动时自动执行 seed-core / 手动 sync）让源文件成为 ACTIVE 版本。</p>
              </div>
            </li>
            <li>
              <span class="steps__no">5</span>
              <div>
                <strong>接入业务链</strong>
                <p>在 routes / services / orchestrators 中调用；保持 <code>routes → services → executeSkill → LLM</code> 链路。</p>
              </div>
            </li>
            <li>
              <span class="steps__no">6</span>
              <div>
                <strong>控制台验证</strong>
                <p><a href="/admin/console" target="_blank">/admin/console</a>：拓扑看注册与调用量 → Skill 抽屉试跑 → <code>/admin/skills/my-skill</code> 设计页看生效 Prompt 与版本。</p>
              </div>
            </li>
          </ol>
        </section>

        <!-- ================= 控制台 ================= -->
        <section id="console" class="docs-sec">
          <h2>控制台</h2>
          <p class="docs-lead"><a href="/admin/console" target="_blank">/admin/console</a> 是运维与调试主入口（管理员登录）：</p>

          <div class="mini-grid">
            <div class="mini"><strong>平台总览</strong><p>健康简报、24h 调用脉搏、待办。</p></div>
            <div class="mini"><strong>Agent 拓扑</strong><p>五阶段流水线图：数据流动画、调用量边宽、hover 联动、时间范围切换；Skill 卡 ↗ 直达设计页。</p></div>
            <div class="mini"><strong>Skill 目录 / 抽屉</strong><p>统计排序、运行配置（路由/重试/超时）、试跑、协议规则、生效 Prompt。</p></div>
            <div class="mini"><strong>Prompt 设计页</strong><p><code>/admin/skills/:id</code>：工作台（Prompt + 试跑 + 最近调用一键重跑）、版本对比与发布、运行时、工程信息。</p></div>
            <div class="mini"><strong>Prompt Dry Run</strong><p>候选编译三视图（产物/候选/diff）+ 字段契约编辑。</p></div>
            <div class="mini"><strong>日志三件套</strong><p>执行日志（重试时间线/导出）、Prompt 调用、事件中心 + Trace 瀑布。</p></div>
            <div class="mini"><strong>虚拟学习者</strong><p>白盒/黑盒仿真、Quick Learn 一键代学、传播报告。</p></div>
            <div class="mini"><strong>连接与安全</strong><p>模型接入、网络策略、可靠性预算、能力健康探测。</p></div>
          </div>
        </section>

        <!-- ================= API 参考 ================= -->
        <section id="api" class="docs-sec">
          <h2>API 参考</h2>
          <p class="docs-lead">以 <code>backend/src/routes/</code> 为最终口径；以下为高频端点。Admin 端点需要管理员会话。</p>

          <h3>用户态</h3>
          <div class="api">
            <div class="api__row"><span class="api__m api__m--post">POST</span><code class="mono">/api/auth/register · /api/auth/login</code><span>注册与登录（HttpOnly Cookie）</span></div>
            <div class="api__row"><span class="api__m api__m--get">GET</span><code class="mono">/api/users/me</code><span>当前用户</span></div>
            <div class="api__row"><span class="api__m api__m--post">POST</span><code class="mono">/api/goal-conversation/start · /:id/reply</code><span>目标对话（路径生成入口）</span></div>
            <div class="api__row"><span class="api__m api__m--get">GET</span><code class="mono">/api/learning/paths · /paths/:id</code><span>学习路径</span></div>
            <div class="api__row"><span class="api__m api__m--post">POST</span><code class="mono">/api/learning/tasks/:taskId/complete</code><span>完成任务</span></div>
            <div class="api__row"><span class="api__m api__m--post">POST</span><code class="mono">/api/feedback/submit</code><span>教学反馈提交</span></div>
          </div>

          <h3>管理态（/api/admin）</h3>
          <div class="api">
            <div class="api__row"><span class="api__m api__m--get">GET</span><code class="mono">/agents/logs · /agents/topology</code><span>执行日志与拓扑统计</span></div>
            <div class="api__row"><span class="api__m api__m--get">GET</span><code class="mono">/skills · /skills/:name/effective-prompt</code><span>Skill 注册表与生效 Prompt</span></div>
            <div class="api__row"><span class="api__m api__m--post">POST</span><code class="mono">/skills/:name/test</code><span>Skill 在线试跑</span></div>
            <div class="api__row"><span class="api__m api__m--get">GET</span><code class="mono">/agent-prompts · /agent-prompts/compare</code><span>Prompt 版本与对比</span></div>
            <div class="api__row"><span class="api__m api__m--get">GET</span><code class="mono">/system/capabilities</code><span>AI 能力健康快照</span></div>
          </div>

          <div class="callout">
            <strong>提示：</strong> 健康检查 <code>GET /readyz</code> 无需认证，可用于部署探活。
          </div>
        </section>

        <!-- ================= 测试与质量 ================= -->
        <section id="testing" class="docs-sec">
          <h2>测试与质量</h2>
          <div class="code">
            <div class="code__head"><span>常用命令</span><button @click="copy($event)">复制</button></div>
            <pre><code># 后端（backend/）
npm test                 # Jest（__tests__/**/*.test.ts，超时 10s）
npm run lint             # ESLint
npm run prompts:lint     # Prompt 双轨校验（v2 文件 / v4 core）

# 前端（frontend/）
npm run build            # 类型 + 产物
npm run lint             # ESLint --fix

# E2E：Playwright（两包均有 @playwright/test）</code></pre>
          </div>
          <div class="callout callout--warn">
            <strong>提交前本地跑测试。</strong> 仓库没有 CI，质量门禁在你手里。
          </div>
        </section>

        <footer class="docs-foot">
          <span>© 2026 问流 WenFlow · 开发者文档</span>
          <a href="https://github.com/wenflow-org/wenflow" target="_blank" rel="noreferrer">项目源码</a>
        </footer>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { toast } from '../utils/toast'

const active = ref('quickstart')

async function copy(e: MouseEvent) {
  const block = (e.currentTarget as HTMLElement).closest('.code')
  const text = block?.querySelector('pre')?.textContent || ''
  if (!text) {
    toast.error('没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制')
  } catch {
    toast.error('复制失败，请手动选择')
  }
}

function onScroll() {
  const secs = document.querySelectorAll('.docs-sec')
  const y = window.scrollY + 120
  let current = 'quickstart'
  secs.forEach((s) => {
    if (y >= (s as HTMLElement).offsetTop) current = s.id
  })
  active.value = current
}

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<style scoped>
@import './v2/v2.css';

.docs { min-height: 100vh; }

/* ---------- 顶栏 ---------- */
.docs-nav {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.docs-nav__inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 24px;
  height: 58px;
  display: flex;
  align-items: center;
  gap: 28px;
}
.docs-brand { display: flex; align-items: center; gap: 8px; text-decoration: none; color: var(--ink); }
.docs-brand__logo { height: 28px; }
.docs-brand__name { font-size: 16px; font-weight: 700; }
.docs-brand__tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--faint);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.docs-nav__links { display: flex; gap: 22px; flex: 1; }
.docs-nav__links a {
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
}
.docs-nav__links a:hover { color: var(--blue); }
.docs-nav__back {
  padding: 7px 14px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 700;
  text-decoration: none;
}
.docs-nav__back:hover { color: var(--blue); border-color: rgba(52, 120, 246, 0.4); }
@media (max-width: 860px) {
  .docs-nav__links { display: none; }
}

/* ---------- 标题区 ---------- */
.docs-hero {
  max-width: 1180px;
  margin: 0 auto;
  padding: 52px 24px 30px;
}
.docs-hero h1 {
  margin: 10px 0 12px;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.docs-hero p { margin: 0; font-size: 15px; color: var(--muted); }
.docs-hero__chips { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.hero-chip {
  padding: 5px 12px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

/* ---------- 布局 ---------- */
.docs-body {
  max-width: 1180px;
  margin: 0 auto;
  padding: 10px 24px 60px;
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 48px;
}
@media (max-width: 860px) {
  .docs-body { grid-template-columns: 1fr; gap: 20px; }
}

/* 侧边栏 */
.docs-side {
  position: sticky;
  top: 82px;
  align-self: start;
  display: grid;
  gap: 20px;
}
@media (max-width: 860px) {
  .docs-side { display: none; }
}
.docs-side__group { display: grid; gap: 2px; }
.docs-side__title {
  padding: 0 10px 6px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  color: var(--faint);
  text-transform: uppercase;
}
.docs-side__group a {
  padding: 6px 10px;
  border-radius: 8px;
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
  border-left: 2px solid transparent;
}
.docs-side__group a:hover { background: #eef2fa; color: var(--ink); }
.docs-side__group a.on {
  color: var(--blue-deep);
  background: #eef5ff;
  border-left-color: var(--blue);
}

/* ---------- 内容 ---------- */
.docs-main { min-width: 0; max-width: 780px; }
.docs-sec { margin-bottom: 56px; scroll-margin-top: 80px; }
.docs-sec h2 {
  margin: 0 0 14px;
  font-size: 22px;
  font-weight: 700;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--line);
}
.docs-sec h3 {
  margin: 26px 0 12px;
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}
.docs-lead { margin: 0 0 16px; font-size: 14px; line-height: 1.8; color: var(--muted); }
.docs-main p { font-size: 13.5px; line-height: 1.8; color: var(--muted); }
.docs-main code:not(.mono) {
  background: #eef2fa;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--blue-deep);
  font-family: 'JetBrains Mono', Consolas, monospace;
}
.mono { font-family: 'JetBrains Mono', Consolas, monospace; }
.docs-main a { color: var(--blue); text-decoration: none; }
.docs-main a:hover { text-decoration: underline; }

/* 迷你卡网格 */
.mini-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.mini {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 16px;
  display: grid;
  gap: 5px;
  align-content: start;
}
.mini__k {
  font-size: 11px;
  font-weight: 700;
  color: var(--blue-deep);
  letter-spacing: 0.04em;
}
.mini strong { font-size: 13.5px; }
.mini p { margin: 0; font-size: 12px; line-height: 1.7; }

/* 调用条 */
.callout {
  margin: 16px 0;
  padding: 12px 16px;
  border-radius: 12px;
  background: #eff6ff;
  border: 1px solid #dbe7f6;
  color: #41516e;
  font-size: 13px;
  line-height: 1.7;
}
.callout--warn {
  background: #fffbeb;
  border-color: rgba(180, 83, 9, 0.25);
  color: #7c5a1e;
}

/* 链路图 */
.flow {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin: 18px 0;
  flex-wrap: wrap;
}
.flow__node {
  padding: 12px 16px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--line);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  text-align: center;
  display: grid;
  align-content: center;
  gap: 3px;
}
.flow__node--hot { border-color: rgba(52, 120, 246, 0.45); background: #eef5ff; color: var(--blue-deep); }
.flow__sub { font-size: 10.5px; font-weight: 600; color: var(--faint); }
.flow__arrow { align-self: center; color: var(--faint); font-weight: 700; }

/* 代码块 */
.code {
  margin: 16px 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #1c2a40;
  background: #101826;
}
.code__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid #1c2a40;
}
.code__head span { font-size: 11px; color: #7d93b8; font-weight: 600; }
.code__head button {
  border: 1px solid #2a3c58;
  background: transparent;
  color: #9db8dc;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
}
.code__head button:hover { border-color: #3f5a82; color: #cfe1f7; }
.code pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  font: 12px/1.7 'JetBrains Mono', Consolas, monospace;
  color: #b8cbe4;
  white-space: pre;
}

/* 表格 */
.table {
  margin: 14px 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.table__row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 2fr;
  gap: 14px;
  padding: 10px 14px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 12.5px;
  align-items: baseline;
}
.table__row:last-child { border-bottom: none; }
.table__row--head {
  background: #fafbfc;
  font-size: 11px;
  font-weight: 700;
  color: var(--faint);
  letter-spacing: 0.05em;
}
.table__row span:last-child { color: var(--muted); line-height: 1.6; }

/* 步骤 */
.steps { list-style: none; padding: 0; margin: 18px 0; display: grid; gap: 10px; }
.steps li {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.steps__no {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: #eef5ff;
  color: var(--blue-deep);
  font-size: 12px;
  font-weight: 700;
  display: grid;
  place-content: center;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', monospace;
}
.steps strong { font-size: 13.5px; display: block; margin-bottom: 3px; }
.steps p { margin: 0; font-size: 12.5px; }

/* API 列表 */
.api { display: grid; gap: 6px; margin: 12px 0; }
.api__row {
  display: grid;
  grid-template-columns: 46px minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 9px 14px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 12px;
}
.api__row code { font-size: 11.5px; color: var(--ink); }
.api__row span:last-child { color: var(--muted); }
.api__m {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 0;
  text-align: center;
  border-radius: 5px;
  letter-spacing: 0.04em;
}
.api__m--get { background: #ecfdf5; color: #15803d; }
.api__m--post { background: #eff6ff; color: var(--blue-deep); }
.api__m--patch { background: #fffbeb; color: #b45309; }

/* 页脚 */
.docs-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: 12px;
}
.docs-foot a { color: var(--muted); text-decoration: none; }
.docs-foot a:hover { color: var(--blue); }
</style>
