<template>
  <div class="developer-docs">
    <!-- 导航栏 -->
    <header class="docs-navbar">
      <div class="container">
        <div class="navbar-brand">
          <router-link to="/" class="brand-link">
            <img src="/logo.png" alt="WenFlow Logo" class="brand-logo-img" />
            <span class="brand-text">问流 WenFlow</span>
          </router-link>
        </div>
        <nav class="docs-nav">
          <a href="#quickstart" class="nav-link">快速开始</a>
          <a href="#architecture" class="nav-link">架构</a>
          <a href="#agent-development" class="nav-link">Agent 开发</a>
          <a href="#api-reference" class="nav-link">API 参考</a>
          <a href="#examples" class="nav-link">示例</a>
        </nav>
        <div class="navbar-actions">
          <router-link to="/login" class="btn btn-secondary">登录</router-link>
          <router-link to="/register" class="btn btn-primary">注册</router-link>
        </div>
      </div>
    </header>

    <!-- Hero 区域 -->
    <section class="docs-hero">
      <div class="container">
        <div class="hero-content">
          <h1 class="hero-title">开发者文档</h1>
          <p class="hero-subtitle">
            构建 AI 驱动的学习体验<br />
            加入我们，打造下一代个性化学习平台
          </p>
          <div class="hero-cta">
            <a href="#quickstart" class="btn btn-primary btn-lg">
              🚀 开始开发
            </a>
            <a href="https://github.com/your-repo" target="_blank" class="btn btn-outline btn-lg">
              📦 GitHub
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- 主体内容 -->
    <div class="docs-container">
      <!-- 侧边栏导航 -->
      <aside class="docs-sidebar">
        <div class="sidebar-section">
          <h3 class="sidebar-title">入门指南</h3>
          <ul class="sidebar-menu">
            <li><a href="#quickstart" :class="{ active: activeSection === 'quickstart' }">快速开始</a></li>
            <li><a href="#architecture" :class="{ active: activeSection === 'architecture' }">技术架构</a></li>
            <li><a href="#setup" :class="{ active: activeSection === 'setup' }">环境配置</a></li>
          </ul>
        </div>

        <div class="sidebar-section">
          <h3 class="sidebar-title">核心开发</h3>
          <ul class="sidebar-menu">
            <li><a href="#agent-development" :class="{ active: activeSection === 'agent-development' }">Agent 开发</a></li>
            <li><a href="#agent-registration" :class="{ active: activeSection === 'agent-registration' }">Agent 注册流程</a></li>
            <li><a href="#api-reference" :class="{ active: activeSection === 'api-reference' }">API 参考</a></li>
          </ul>
        </div>

        <div class="sidebar-section">
          <h3 class="sidebar-title">进阶主题</h3>
          <ul class="sidebar-menu">
            <li><a href="#mcp-integration" :class="{ active: activeSection === 'mcp-integration' }">MCP 集成</a></li>
            <li><a href="#arena-system" :class="{ active: activeSection === 'arena-system' }">Arena 竞技场</a></li>
            <li><a href="#examples" :class="{ active: activeSection === 'examples' }">示例代码</a></li>
          </ul>
        </div>

        <div class="sidebar-section">
          <h3 class="sidebar-title">外部链接</h3>
          <ul class="sidebar-menu">
            <li><a href="https://github.com/your-repo/wenflow/blob/main/docs/architecture" target="_blank">架构文档</a></li>
            <li><a href="https://github.com/your-repo/wenflow/blob/main/docs/theory" target="_blank">教育理论</a></li>
            <li><a href="https://github.com/your-repo/wenflow/blob/main/API.md" target="_blank">完整 API</a></li>
          </ul>
        </div>
      </aside>

      <!-- 主内容区 -->
      <main class="docs-content">
        <!-- 快速开始 -->
        <section id="quickstart" class="content-section">
          <h2 class="section-title">🚀 快速开始</h2>
          
          <div class="info-box">
            <p><strong>本指南将帮助你：</strong></p>
            <ul>
              <li>了解平台架构和技术栈</li>
              <li>配置开发环境</li>
              <li>创建和注册自定义 Agent</li>
              <li>使用 MCP Gateway 进行 AI 调用</li>
              <li>参与 Arena 竞技场测试</li>
            </ul>
          </div>

          <h3>前置要求</h3>
          <div class="requirement-grid">
            <div class="requirement-card">
              <div class="requirement-icon">📦</div>
              <h4>Node.js</h4>
              <p>版本 >= 18.x</p>
            </div>
            <div class="requirement-card">
              <div class="requirement-icon">🐍</div>
              <h4>Python</h4>
              <p>版本 3.12+（可选）</p>
            </div>
            <div class="requirement-card">
              <div class="requirement-icon">🗄️</div>
              <h4>数据库</h4>
              <p>SQLite（开发）或 PostgreSQL（生产）</p>
            </div>
            <div class="requirement-card">
              <div class="requirement-icon">🤖</div>
              <h4>AI 服务</h4>
              <p>NewAPI + DeepSeek</p>
            </div>
          </div>

          <h3>安装步骤</h3>
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">终端命令</span>
              <button class="copy-btn" @click="copyCode('install')">复制</button>
            </div>
            <pre><code># 克隆项目
git clone https://github.com/your-repo/wenflow.git
cd wenflow

# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install

# 配置环境变量
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 初始化数据库
cd backend
npx prisma generate
npx prisma db push

# 启动开发服务器
# 方式一：使用启动脚本（推荐）
.\start-dev.ps1  # Windows PowerShell
# 或
.\start-dev.bat  # Windows 批处理

# 方式二：手动启动
# 后端：cd backend && npm run dev
# 前端：cd frontend && npm run dev</code></pre>
          </div>

          <div class="tip-box">
            <span class="tip-icon">💡</span>
            <div class="tip-content">
              <strong>提示：</strong> 使用启动脚本会自动处理端口占用问题，并依次启动后端和前端服务。
            </div>
          </div>
        </section>

        <!-- 技术架构 -->
        <section id="architecture" class="content-section">
          <h2 class="section-title">🏗️ 技术架构</h2>
          
          <h3>后端架构</h3>
          <div class="tech-stack">
            <div class="tech-item">
              <span class="tech-icon">🌐</span>
              <div>
                <h4>Node.js + Express</h4>
                <p>Web 框架，TypeScript 开发</p>
              </div>
            </div>
            <div class="tech-item">
              <span class="tech-icon">🗄️</span>
              <div>
                <h4>Prisma ORM</h4>
                <p>数据库操作，支持 SQLite/PostgreSQL</p>
              </div>
            </div>
            <div class="tech-item">
              <span class="tech-icon">🤖</span>
              <div>
                <h4>Agent 系统</h4>
                <p>多 Agent 协作，插件化扩展</p>
              </div>
            </div>
            <div class="tech-item">
              <span class="tech-icon">🔐</span>
              <div>
                <h4>JWT 认证</h4>
                <p>安全的用户认证机制</p>
              </div>
            </div>
          </div>

          <h3>前端架构</h3>
          <div class="tech-stack">
            <div class="tech-item">
              <span class="tech-icon">⚡</span>
              <div>
                <h4>Vue 3 + TypeScript</h4>
                <p>现代化前端框架</p>
              </div>
            </div>
            <div class="tech-item">
              <span class="tech-icon">🎨</span>
              <div>
                <h4>Element Plus</h4>
                <p>UI 组件库</p>
              </div>
            </div>
            <div class="tech-item">
              <span class="tech-icon">📊</span>
              <div>
                <h4>Chart.js</h4>
                <p>数据可视化</p>
              </div>
            </div>
            <div class="tech-item">
              <span class="tech-icon">🔄</span>
              <div>
                <h4>Pinia</h4>
                <p>状态管理</p>
              </div>
            </div>
          </div>

          <h3>核心系统</h3>
          <div class="system-grid">
            <div class="system-card">
              <h4>🎯 学习目标分解系统</h4>
              <p>将模糊的学习目标分解为具体可执行的任务</p>
            </div>
            <div class="system-card">
              <h4>📚 学习执行系统</h4>
              <p>学习路径管理、任务完成追踪、时间记录</p>
            </div>
            <div class="system-card">
              <h4>📊 学习状态追踪系统</h4>
              <p>LSS/KTL/LF/LSB 科学量化学习状态</p>
            </div>
            <div class="system-card">
              <h4>🤖 ZPD 分层 AI 辅导</h4>
              <p>基于最近发展区理论的个性化辅导</p>
            </div>
            <div class="system-card">
              <h4>🏆 成就系统</h4>
              <p>14 个预定义成就，XP 奖励机制</p>
            </div>
            <div class="system-card">
              <h4>📈 学习报告系统</h4>
              <p>周报/月报生成，智能建议</p>
            </div>
          </div>
        </section>

        <!-- 环境配置 -->
        <section id="setup" class="content-section">
          <h2 class="section-title">⚙️ 环境配置</h2>
          
          <h3>后端环境变量</h3>
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">backend/.env</span>
              <button class="copy-btn" @click="copyCode('backend-env')">复制</button>
            </div>
            <pre><code># 服务器配置
NODE_ENV=development
PORT=3001

# 数据库配置（开发用 SQLite）
DATABASE_URL="file:./dev.db"

# JWT 配置
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d

# AI 服务配置
AI_API_URL=http://localhost:3000
AI_API_KEY=sk-your-api-key
AI_MODEL=deepseek-chat

# 日志配置
LOG_LEVEL=debug</code></pre>
          </div>

          <h3>前端环境变量</h3>
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">frontend/.env</span>
              <button class="copy-btn" @click="copyCode('frontend-env')">复制</button>
            </div>
            <pre><code>VITE_API_BASE_URL=http://localhost:3001/api</code></pre>
          </div>

          <h3>AI 服务配置</h3>
          <div class="info-box">
            <p><strong>生产环境模型：</strong> DeepSeek（通过 NewAPI 服务）</p>
            <ul>
              <li>地址：http://101.43.146.102:30001</li>
              <li>模型：deepseek-chat / deepseek-think</li>
              <li>兼容 OpenAI API 格式</li>
            </ul>
          </div>
        </section>

        <!-- Agent 开发 -->
        <section id="agent-development" class="content-section">
          <h2 class="section-title">🤖 Agent 开发指南</h2>
          
          <div class="info-box info-primary">
            <p><strong>Agent 系统</strong> 是平台的核心，支持插件化扩展和多 Agent 协作。</p>
          </div>

          <h3>1. 创建 Agent 文件</h3>
          <p>在 <code>backend/src/agents/standard/</code> 目录下创建新文件：</p>
          
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">MyAgent.ts</span>
              <button class="copy-btn" @click="copyCode('agent-template')">复制</button>
            </div>
            <pre><code>// MyAgent.ts
import { BaseAgent } from '../../core/agent/BaseAgent';
import { IAgentInput, IAgentOutput, IAgentCapabilities } from '../../core/agent/ILearningAgent';

export class MyAgent extends BaseAgent {
  readonly id = 'my-agent';
  readonly name = 'MyAgent';
  readonly version = '1.0.0';
  readonly description = '我的自定义 Agent';
  readonly subject = '综合';

  readonly capabilities: IAgentCapabilities = {
    tags: ['my-tag'],
    subjects: ['编程', '英语'],
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        result: { type: 'string' }
      }
    }
  };

  protected async execute(input: IAgentInput): Promise&lt;IAgentOutput&gt; {
    // 实现核心逻辑
    return {
      success: true,
      data: { result: 'Hello World' }
    };
  }
}

export default MyAgent;</code></pre>
          </div>

          <h3>2. ILearningAgent 接口详解</h3>
          <div class="table-container">
            <table class="docs-table">
              <thead>
                <tr>
                  <th>属性</th>
                  <th>类型</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>id</code></td>
                  <td>string</td>
                  <td>唯一标识符（kebab-case）</td>
                </tr>
                <tr>
                  <td><code>name</code></td>
                  <td>string</td>
                  <td>显示名称</td>
                </tr>
                <tr>
                  <td><code>version</code></td>
                  <td>string</td>
                  <td>版本号</td>
                </tr>
                <tr>
                  <td><code>description</code></td>
                  <td>string</td>
                  <td>功能描述</td>
                </tr>
                <tr>
                  <td><code>subject</code></td>
                  <td>string</td>
                  <td>所属学科</td>
                </tr>
                <tr>
                  <td><code>capabilities</code></td>
                  <td>IAgentCapabilities</td>
                  <td>能力定义</td>
                </tr>
                <tr>
                  <td><code>run</code></td>
                  <td>method</td>
                  <td>执行方法</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>3. BaseAgent 基类功能</h3>
          <ul class="feature-list">
            <li>
              <span class="feature-icon">✅</span>
              <div>
                <strong>输入验证</strong>
                <p>自动调用 <code>validate()</code> 方法</p>
              </div>
            </li>
            <li>
              <span class="feature-icon">🔄</span>
              <div>
                <strong>预处理/后处理</strong>
                <p><code>preprocess()</code> / <code>postprocess()</code></p>
              </div>
            </li>
            <li>
              <span class="feature-icon">🤖</span>
              <div>
                <strong>AI 调用</strong>
                <p><code>callAI()</code> 便捷方法</p>
              </div>
            </li>
            <li>
              <span class="feature-icon">📝</span>
              <div>
                <strong>JSON 解析</strong>
                <p><code>parseJSON()</code> 带错误处理</p>
              </div>
            </li>
            <li>
              <span class="feature-icon">⚙️</span>
              <div>
                <strong>配置管理</strong>
                <p><code>this.config</code> 访问配置</p>
              </div>
            </li>
          </ul>

          <h3>4. 生命周期</h3>
          <div class="flow-diagram">
            <div class="flow-step">
              <span class="step-label">run(input)</span>
              <div class="step-content">
                <div class="step-box">validate(input)</div>
                <div class="step-arrow">↓</div>
                <div class="step-box">preprocess(input)</div>
                <div class="step-arrow">↓</div>
                <div class="step-box highlight">execute(input)</div>
                <div class="step-arrow">↓</div>
                <div class="step-box">postprocess(output)</div>
              </div>
            </div>
          </div>

          <h3>5. 自动加载</h3>
          <div class="tip-box">
            <span class="tip-icon">✨</span>
            <div class="tip-content">
              <strong>自动加载：</strong> Agent 文件创建后，<code>AgentLoader</code> 会自动扫描并加载，无需修改核心代码。
            </div>
          </div>

          <h3>6. 验证 Agent</h3>
          <p>访问管理平台查看 Agent 是否已注册：</p>
          <div class="code-block">
            <pre><code>http://localhost:5173/admin/agent-registry</code></pre>
          </div>
        </section>

        <!-- Agent 注册流程 -->
        <section id="agent-registration" class="content-section">
          <h2 class="section-title">📝 Agent 注册流程</h2>
          
          <div class="info-box">
            <p><strong>注册方式：</strong> 平台支持自动注册和手动注册两种方式</p>
          </div>

          <h3>方式一：自动注册（推荐）</h3>
          <p>将 Agent 文件放在 <code>backend/src/agents/standard/</code> 目录下，系统启动时会自动加载：</p>
          
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">backend/src/agents/index.ts</span>
            </div>
            <pre><code>import { AgentLoader } from '../core/agent/AgentLoader';

// 自动扫描并加载所有 Agent
const loader = new AgentLoader();
await loader.loadAll();</code></pre>
          </div>

          <h3>方式二：手动注册</h3>
          <p>通过 API 手动注册 Agent：</p>
          
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">使用 API 注册</span>
              <button class="copy-btn" @click="copyCode('register-agent-api')">复制</button>
            </div>
            <pre><code>// API 端点
POST /api/agents/register

// 请求体
{
  "id": "my-agent",
  "name": "MyAgent",
  "version": "1.0.0",
  "description": "我的自定义 Agent",
  "subject": "综合",
  "capabilities": {
    "tags": ["my-tag"],
    "subjects": ["编程", "英语"],
    "inputSchema": {...},
    "outputSchema": {...}
  }
}</code></pre>
          </div>

          <h3>方式三：通过 Gateway 注册</h3>
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">使用 MCP Gateway</span>
              <button class="copy-btn" @click="copyCode('gateway-register')">复制</button>
            </div>
            <pre><code>import { mcpGateway } from '../../core/mcp/McpGateway';

const agentId = await mcpGateway.registerAgent({
  id: 'my-agent',
  name: 'MyAgent',
  version: '1.0.0',
  description: '我的自定义 Agent',
  capabilities: {...}
}, handler);

console.log(`Agent 已注册：${agentId}`);</code></pre>
          </div>

          <h3>Agent 类型</h3>
          <div class="agent-types">
            <div class="agent-type-card">
              <h4>🎓 ai-teaching-agent</h4>
              <p>AI 授课编排 Agent</p>
              <span class="agent-version">v2.0</span>
            </div>
            <div class="agent-type-card">
              <h4>🗺️ path-agent</h4>
              <p>路径生成 Agent</p>
              <span class="agent-version">v1.0</span>
            </div>
            <div class="agent-type-card">
              <h4>🧠 learner-model-agent</h4>
              <p>学习者画像与状态中心</p>
              <span class="agent-version">v1.0</span>
            </div>
            <div class="agent-type-card">
              <h4>🔄 coordinator</h4>
              <p>协调 Agent</p>
              <span class="agent-version">v1.0</span>
            </div>
          </div>
        </section>

        <!-- API 参考 -->
        <section id="api-reference" class="content-section">
          <h2 class="section-title">📡 API 参考</h2>
          
          <h3>认证相关</h3>
          <div class="api-list">
            <div class="api-item">
              <div class="api-method method-post">POST</div>
              <div class="api-endpoint">/api/auth/register</div>
              <div class="api-description">用户注册</div>
            </div>
            <div class="api-item">
              <div class="api-method method-post">POST</div>
              <div class="api-endpoint">/api/auth/login</div>
              <div class="api-description">用户登录</div>
            </div>
            <div class="api-item">
              <div class="api-method method-get">GET</div>
              <div class="api-endpoint">/api/users/me</div>
              <div class="api-description">获取当前用户信息</div>
            </div>
          </div>

          <h3>Agent 相关</h3>
          <div class="api-list">
            <div class="api-item">
              <div class="api-method method-get">GET</div>
              <div class="api-endpoint">/api/agents</div>
              <div class="api-description">获取 Agent 列表</div>
            </div>
            <div class="api-item">
              <div class="api-method method-post">POST</div>
              <div class="api-endpoint">/api/agents/register</div>
              <div class="api-description">注册 Agent</div>
            </div>
            <div class="api-item">
              <div class="api-method method-post">POST</div>
              <div class="api-endpoint">/api/agents/:id/call</div>
              <div class="api-description">调用 Agent</div>
            </div>
            <div class="api-item">
              <div class="api-method method-get">GET</div>
              <div class="api-endpoint">/api/agents/logs</div>
              <div class="api-description">获取 Agent 日志</div>
            </div>
            <div class="api-item">
              <div class="api-method method-get">GET</div>
              <div class="api-endpoint">/api/admin/agent-monitoring</div>
              <div class="api-description">Agent 监控</div>
            </div>
          </div>

          <h3>学习相关</h3>
          <div class="api-list">
            <div class="api-item">
              <div class="api-method method-post">POST</div>
              <div class="api-endpoint">/api/learning/goals</div>
              <div class="api-description">创建学习目标</div>
            </div>
            <div class="api-item">
              <div class="api-method method-get">GET</div>
              <div class="api-endpoint">/api/learning/paths</div>
              <div class="api-description">获取学习路径列表</div>
            </div>
            <div class="api-item">
              <div class="api-method method-get">GET</div>
              <div class="api-endpoint">/api/learning/paths/:id</div>
              <div class="api-description">获取学习路径详情</div>
            </div>
            <div class="api-item">
              <div class="api-method method-patch">PATCH</div>
              <div class="api-endpoint">/api/learning/tasks/:id</div>
              <div class="api-description">更新任务状态</div>
            </div>
          </div>

          <div class="tip-box">
            <span class="tip-icon">📖</span>
            <div class="tip-content">
              <strong>完整 API 文档：</strong> 查看 <a href="https://github.com/your-repo/wenflow/blob/main/API.md" target="_blank">API.md</a> 获取更详细的 API 参考。
            </div>
          </div>
        </section>

        <!-- MCP 集成 -->
        <section id="mcp-integration" class="content-section">
          <h2 class="section-title">🔌 MCP 集成</h2>
          
          <div class="info-box">
            <p><strong>MCP (Model Context Protocol)</strong> 是平台的核心通信协议，用于 Agent 与 AI 模型之间的交互。</p>
          </div>

          <h3>使用 MCP Gateway</h3>
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">调用 AI 模型</span>
              <button class="copy-btn" @click="copyCode('mcp-gateway')">复制</button>
            </div>
            <pre><code>import { mcpGateway } from '../../core/mcp/McpGateway';

const response = await mcpGateway.chatCompletion({
  model: process.env.AI_MODEL || 'deepseek-chat',
  messages: [
    { role: 'system', content: '你是一个专业的 AI 辅导老师' },
    { role: 'user', content: '请解释什么是递归' }
  ],
  temperature: 0.7,
  max_tokens: 4000
}, 'newapi');  // 指定 MCP 服务器

console.log(response.content);</code></pre>
          </div>

          <h3>MCP 服务器配置</h3>
          <div class="table-container">
            <table class="docs-table">
              <thead>
                <tr>
                  <th>服务器</th>
                  <th>地址</th>
                  <th>模型</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>newapi</td>
                  <td>http://localhost:3000</td>
                  <td>deepseek-chat</td>
                </tr>
                <tr>
                  <td>production</td>
                  <td>http://101.43.146.102:30001</td>
                  <td>deepseek-chat / deepseek-think</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 示例代码 -->
        <section id="examples" class="content-section">
          <h2 class="section-title">💡 示例代码</h2>
          
          <h3>示例 1：简单的问答 Agent</h3>
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">QnaAgent.ts</span>
              <button class="copy-btn" @click="copyCode('qna-agent')">复制</button>
            </div>
            <pre><code>import { BaseAgent } from '../../core/agent/BaseAgent';

export class QnaAgent extends BaseAgent {
  readonly id = 'qna-agent';
  readonly name = '问答 Agent';
  readonly version = '1.0.0';
  readonly description = '简单的问答 Agent';
  readonly subject = '综合';

  protected async execute(input: any): Promise&lt;any&gt; {
    const response = await this.callAI([
      { role: 'system', content: '你是一个 helpful 的助手' },
      { role: 'user', content: input.question }
    ]);

    return {
      success: true,
      data: { answer: response.content }
    };
  }
}</code></pre>
          </div>

          <h3>示例 2：带验证的 Agent</h3>
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">MathAgent.ts（片段）</span>
              <button class="copy-btn" @click="copyCode('math-agent')">复制</button>
            </div>
            <pre><code>export class MathAgent extends BaseAgent {
  validate(input: any): boolean {
    if (!input.problem || input.problem.length &lt; 5) {
      return false;
    }
    return true;
  }

  protected async execute(input: any): Promise&lt;any&gt; {
    try {
      const response = await this.callAI([
        { role: 'system', content: '你是一个数学专家' },
        { role: 'user', content: `请解答：${input.problem}` }
      ]);

      return {
        success: true,
        data: { solution: response.content }
      };
    } catch (error: any) {
      return {
        success: false,
        data: null,
        error: {
          code: 'MATH_ERROR',
          message: error.message
        }
      };
    }
  }
}</code></pre>
          </div>

          <h3>示例 3：使用 MCP Gateway</h3>
          <div class="code-block">
            <div class="code-header">
              <span class="code-title">使用 MCP 调用 AI</span>
              <button class="copy-btn" @click="copyCode('mcp-example')">复制</button>
            </div>
            <pre><code>import { mcpGateway } from '../../core/mcp/McpGateway';
import { logger } from '../../utils/logger';

async function generateContent(prompt: string) {
  try {
    logger.info('开始生成内容...');
    
    const response = await mcpGateway.chatCompletion({
  model: process.env.AI_MODEL || 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是一个专业的内容生成器' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 2000
    }, 'newapi');

    logger.info('内容生成完成');
    
    return {
      success: true,
      data: { content: response.content }
    };
  } catch (error) {
    logger.error('生成失败:', error);
    return {
      success: false,
      error: { message: '生成失败' }
    };
  }
}</code></pre>
          </div>

          <h3>更多示例</h3>
          <p>参考现有标准化 Agent 获取灵感：</p>
          <ul class="simple-list">
            <li><code>backend/src/agents/path-agent/</code> - 路径生成 Agent</li>
            <li><code>backend/src/services/ai-teaching/</code> - AI 授课编排</li>
          </ul>
        </section>

        <!-- 页脚 -->
        <footer class="docs-footer">
          <div class="footer-content">
            <p>© 2026 问流 WenFlow · 开发者文档</p>
            <div class="footer-links">
              <router-link to="/">返回首页</router-link>
              <a href="https://github.com/your-repo/wenflow/blob/main/docs/architecture" target="_blank">架构文档</a>
              <a href="https://github.com/your-repo/wenflow/blob/main/API.md" target="_blank">完整 API</a>
              <a href="https://github.com/your-repo" target="_blank">GitHub</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const activeSection = ref('quickstart');

const copyCode = (codeId: string) => {
  // TODO: 实现代码复制功能
  console.log('复制代码:', codeId);
  alert('代码已复制到剪贴板（功能待实现）');
};

const handleScroll = () => {
  const sections = document.querySelectorAll('.content-section');
  const scrollPosition = window.scrollY + 100;

  sections.forEach((section) => {
    const sectionTop = (section as HTMLElement).offsetTop;
    const sectionHeight = (section as HTMLElement).offsetHeight;
    const sectionId = section.getAttribute('id');

    if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
      activeSection.value = sectionId || '';
    }
  });
};

onMounted(() => {
  window.addEventListener('scroll', handleScroll);
  handleScroll(); // 初始化
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>

<style scoped>
/* ========== 基础变量 ========== */
.developer-docs {
  min-height: 100vh;
  background: var(--bg-body);
  color: var(--text-primary);
}

.container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 2rem;
}

/* ========== 导航栏 ========== */
.docs-navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-light);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.docs-navbar .container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-decoration: none;
  color: var(--text-primary);
  font-weight: 700;
  font-size: 1.25rem;
  transition: opacity 0.2s ease;
}

.brand-link:hover {
  opacity: 0.8;
}

.brand-logo {
  font-size: 1.75rem;
}

.docs-nav {
  display: flex;
  gap: 2rem;
}

.nav-link {
  color: var(--text-secondary);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.95rem;
  transition: color 0.2s ease;
}

.nav-link:hover {
  color: var(--color-primary);
}

.navbar-actions {
  display: flex;
  gap: 1rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1.5rem;
  font-weight: 600;
  font-size: 0.95rem;
  border-radius: var(--radius-lg);
  text-decoration: none;
  transition: all 0.3s ease;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: var(--gradient-primary);
  color: white;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.btn-primary:hover {
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
  transform: translateY(-2px);
}

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}

.btn-secondary:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

/* ========== Hero 区域 ========== */
.docs-hero {
  padding: 120px 0 60px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  text-align: center;
}

.hero-content {
  max-width: 800px;
  margin: 0 auto;
}

.hero-title {
  font-size: clamp(2.5rem, 5vw, 4rem);
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 1.5rem;
  letter-spacing: -0.02em;
}

.hero-subtitle {
  font-size: clamp(1.1rem, 2vw, 1.35rem);
  color: var(--text-secondary);
  line-height: 1.8;
  margin-bottom: 2.5rem;
}

.hero-cta {
  display: flex;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.btn-lg {
  padding: 1rem 2rem;
  font-size: 1.05rem;
}

.btn-outline {
  background: transparent;
  border: 2px solid var(--color-primary);
  color: var(--color-primary);
}

.btn-outline:hover {
  background: var(--color-primary);
  color: white;
}

/* ========== 文档布局 ========== */
.docs-container {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 3rem;
  max-width: 1280px;
  margin: 0 auto;
  padding: 3rem 2rem;
}

/* 侧边栏 */
.docs-sidebar {
  position: sticky;
  top: 100px;
  height: calc(100vh - 120px);
  overflow-y: auto;
  padding-right: 1rem;
}

.sidebar-section {
  margin-bottom: 2rem;
}

.sidebar-title {
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 1rem;
  letter-spacing: 0.05em;
}

.sidebar-menu {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sidebar-menu li {
  margin-bottom: 0.5rem;
}

.sidebar-menu a {
  display: block;
  padding: 0.5rem 1rem;
  color: var(--text-secondary);
  text-decoration: none;
  border-radius: var(--radius-lg);
  transition: all 0.2s ease;
  font-size: 0.95rem;
}

.sidebar-menu a:hover {
  background: var(--bg-muted);
  color: var(--color-primary);
}

.sidebar-menu a.active {
  background: rgba(102, 126, 234, 0.1);
  color: var(--color-primary);
  font-weight: 600;
}

/* 主内容区 */
.docs-content {
  min-width: 0;
}

.content-section {
  margin-bottom: 4rem;
  scroll-margin-top: 100px;
}

.section-title {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid var(--border-default);
}

.content-section h3 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 2.5rem 0 1.5rem;
}

.content-section h4 {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 1.5rem 0 1rem;
}

.content-section p {
  font-size: 1rem;
  line-height: 1.7;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

.content-section ul {
  margin-bottom: 1rem;
  padding-left: 1.5rem;
}

.content-section li {
  margin-bottom: 0.5rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

.content-section code {
  background: var(--bg-muted);
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  color: var(--color-primary);
  font-family: 'Consolas', 'Monaco', monospace;
}

.content-section pre {
  background: var(--bg-muted);
  padding: 1.5rem;
  border-radius: var(--radius-xl);
  overflow-x: auto;
  margin: 1rem 0;
}

.content-section pre code {
  background: none;
  padding: 0;
  color: var(--text-primary);
}

/* 信息框 */
.info-box {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: 1.5rem;
  margin: 1.5rem 0;
}

.info-box ul {
  margin: 1rem 0 0;
  padding-left: 1.5rem;
}

.info-primary {
  background: rgba(102, 126, 234, 0.05);
  border-color: var(--color-primary);
}

/* 提示框 */
.tip-box {
  display: flex;
  gap: 1rem;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: var(--radius-lg);
  padding: 1rem 1.5rem;
  margin: 1.5rem 0;
}

.tip-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.tip-content {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
}

/* 要求网格 */
.requirement-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  margin: 1.5rem 0;
}

.requirement-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: 1.5rem;
  text-align: center;
  transition: all 0.3s ease;
}

.requirement-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.15);
  transform: translateY(-4px);
}

.requirement-icon {
  font-size: 2.5rem;
  margin-bottom: 1rem;
}

.requirement-card h4 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.requirement-card p {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0;
}

/* 技术栈 */
.tech-stack {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
  margin: 1.5rem 0;
}

.tech-item {
  display: flex;
  gap: 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: 1.5rem;
  transition: all 0.3s ease;
}

.tech-item:hover {
  border-color: var(--color-primary);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.15);
}

.tech-icon {
  font-size: 2rem;
  flex-shrink: 0;
}

.tech-item h4 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.tech-item p {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0;
}

/* 系统网格 */
.system-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin: 1.5rem 0;
}

.system-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: 1.5rem;
  transition: all 0.3s ease;
}

.system-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.15);
  transform: translateY(-4px);
}

.system-card h4 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.system-card p {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
}

/* 代码块 */
.code-block {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  overflow: hidden;
  margin: 1.5rem 0;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: var(--bg-muted);
  border-bottom: 1px solid var(--border-default);
}

.code-title {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.copy-btn {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  padding: 0.375rem 0.75rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.copy-btn:hover {
  background: var(--bg-body);
  color: var(--color-primary);
  border-color: var(--color-primary);
}

.code-block pre {
  margin: 0;
  padding: 1.5rem;
  background: var(--bg-surface);
  overflow-x: auto;
}

.code-block code {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-primary);
}

/* 表格 */
.table-container {
  overflow-x: auto;
  margin: 1.5rem 0;
}

.docs-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.docs-table thead {
  background: var(--bg-muted);
}

.docs-table th {
  padding: 1rem;
  text-align: left;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
  border-bottom: 2px solid var(--border-default);
}

.docs-table td {
  padding: 1rem;
  border-bottom: 1px solid var(--border-light);
  font-size: 0.95rem;
  color: var(--text-secondary);
}

.docs-table tr:last-child td {
  border-bottom: none;
}

.docs-table code {
  background: var(--bg-muted);
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  color: var(--color-primary);
}

/* API 列表 */
.api-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 1.5rem 0;
}

.api-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 1rem 1.5rem;
  transition: all 0.3s ease;
}

.api-item:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
}

.api-method {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.75rem;
  border-radius: var(--radius-md);
  text-transform: uppercase;
  flex-shrink: 0;
}

.method-get {
  background: rgba(34, 197, 94, 0.1);
  color: var(--color-success);
}

.method-post {
  background: rgba(102, 126, 234, 0.1);
  color: var(--color-primary);
}

.method-patch {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.api-endpoint {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9rem;
  color: var(--text-primary);
  min-width: 250px;
}

.api-description {
  font-size: 0.9rem;
  color: var(--text-secondary);
  flex: 1;
}

/* Agent 类型 */
.agent-types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin: 1.5rem 0;
}

.agent-type-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  text-align: center;
  position: relative;
  transition: all 0.3s ease;
}

.agent-type-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.15);
}

.agent-type-card h4 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.agent-type-card p {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0;
}

.agent-version {
  display: inline-block;
  margin-top: 0.75rem;
  font-size: 0.75rem;
  background: var(--bg-muted);
  padding: 0.25rem 0.75rem;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
}

/* 特性列表 */
.feature-list {
  list-style: none;
  padding: 0;
  margin: 1.5rem 0;
}

.feature-list li {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  transition: all 0.3s ease;
}

.feature-list li:hover {
  border-color: var(--color-primary);
}

.feature-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.feature-list li strong {
  display: block;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.feature-list li p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

/* 流程图 */
.flow-diagram {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: 2rem;
  margin: 1.5rem 0;
}

.flow-step {
  text-align: center;
}

.step-label {
  display: block;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1.5rem;
}

.step-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.step-box {
  background: var(--bg-body);
  border: 2px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 1rem 2rem;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 200px;
}

.step-box.highlight {
  background: rgba(102, 126, 234, 0.1);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.step-arrow {
  font-size: 1.5rem;
  color: var(--text-muted);
}

/* 简单列表 */
.simple-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0;
}

.simple-list li {
  padding: 0.75rem 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  margin-bottom: 0.5rem;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

/* 页脚 */
.docs-footer {
  margin-top: 4rem;
  padding-top: 2rem;
  border-top: 1px solid var(--border-light);
}

.footer-content {
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.footer-links {
  display: flex;
  justify-content: center;
  gap: 2rem;
  margin-top: 1rem;
}

.footer-links a {
  color: var(--text-secondary);
  text-decoration: none;
  transition: color 0.2s ease;
}

.footer-links a:hover {
  color: var(--color-primary);
}

/* ========== 响应式 ========== */
@media (max-width: 968px) {
  .docs-container {
    grid-template-columns: 1fr;
  }

  .docs-sidebar {
    position: static;
    height: auto;
    padding-right: 0;
    margin-bottom: 2rem;
  }

  .docs-nav {
    display: none;
  }

  .docs-hero {
    padding: 100px 0 40px;
  }

  .hero-title {
    font-size: clamp(2rem, 8vw, 3rem);
  }

  .hero-cta {
    flex-direction: column;
    align-items: center;
  }
}
</style>
