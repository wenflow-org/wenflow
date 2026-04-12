# MCP 浏览器测试快速指南

## 📋 测试目的

使用 Playwright 浏览器自动化测试，模拟真实用户在 AI 学习平台上的完整学习流程。

---

## 🚀 快速开始

### 前置条件

1. **确保后端和前端服务正在运行**
   ```powershell
   # 使用启动脚本（推荐）
   .\start-dev.ps1
   
   # 或手动启动
   cd backend
   npm run dev
   
   cd ../frontend
   npm run dev
   ```

2. **确认服务端口**
   - 后端：http://localhost:3001
   - 前端：http://localhost:5173

3. **安装 Playwright**
   ```bash
   cd backend
   npm install playwright
   ```

---

## 📝 测试脚本版本

### v1 - 初始版本
- 文件：`test-mcp-browser-human.mjs`
- 状态：❌ 已弃用

### v2 - 简化版
- 文件：`test-mcp-browser-v2.mjs`
- 状态：❌ 已弃用

### v3 - 修复版
- 文件：`test-mcp-browser-v3.mjs`
- 状态：❌ 已弃用

### v4 - 稳定版 ⭐ 推荐
- 文件：`test-mcp-browser-v4.mjs`
- 状态：✅ 稳定可用
- 功能：登录 + 目标对话 + 路径生成
- 耗时：~90 秒

### v5 - 完整版
- 文件：`test-mcp-browser-v5.mjs`
- 状态：⚠️ 部分功能待修复
- 功能：v4 + 学习对话 + 反馈 + 进度
- 耗时：~140 秒

---

## 🔧 运行测试

### 方法 1: 运行 v4 稳定版（推荐）
```powershell
cd backend
node test-mcp-browser-v4.mjs
```

### 方法 2: 运行 v5 完整版
```powershell
cd backend
node test-mcp-browser-v5.mjs
```

### 方法 3: 创建新测试账号
```javascript
// 编辑测试脚本，修改 TEST_CONFIG
const TEST_CONFIG = {
  baseUrl: 'http://localhost:5173',
  user: {
    email: 'new_test@test.com',  // 新邮箱
    password: 'Test123456!'
  }
};
```

---

## 📊 测试流程

### v4 测试流程（90 秒）

```
[1/8] 访问首页 ..................... 1.4s
[2/8] 用户登录 ..................... 5.1s
[3/8] 进入目标对话页面 ............... 4.0s
[4-7/8] 目标对话（5 轮）............. 91.1s
  - 第 1 轮：我想学习 Python 数据分析
  - 第 2 轮：我是市场分析师
  - 第 3 轮：每天晚上能有 1 小时
  - 第 4 轮：喜欢实战练习
  - 第 5 轮：确认方案
[8/8] 查看学习路径 ................. 3.2s
```

### v5 测试流程（140 秒）

```
[1/10] 访问首页 .................... 1.4s
[2/10] 用户登录 .................... 5.1s
[3/10] 进入目标对话页面 .............. 4.0s
[4-7/10] 目标对话（5 轮）............ 91.1s
[8/10] 查看学习路径 ................ 3.2s
[9/10] 学习对话（2 轮）............. 待完善
[10/10] 提供反馈和查看进度 .......... 待完善
```

---

## 📸 测试输出

### 截图文件
测试会生成 JPEG 格式的截图文件：

**v4 截图** (10 张):
- `mcp-v4-01-homepage.jpg`
- `mcp-v4-02-login-filled.jpg`
- `mcp-v4-03-goal-conversation.jpg`
- `mcp-v4-05-round1-response.jpg` ~ `mcp-v4-05-round5-response.jpg`
- `mcp-v4-06-conversation-complete.jpg`
- `mcp-v4-07-path-generated.jpg`

**v5 截图** (12 张):
- `mcp-v5-01-homepage.jpg`
- `mcp-v5-02-login-filled.jpg`
- `mcp-v5-03-goal-conversation.jpg`
- `mcp-v5-05-round1-response.jpg` ~ `mcp-v5-05-round5-response.jpg`
- `mcp-v5-06-conversation-complete.jpg`
- `mcp-v5-07-path-generated.jpg`
- `mcp-v5-08-paths-list.jpg`
- `mcp-v5-11-progress-view.jpg`

### JSON 报告

**v4 报告**: `mcp-browser-test-v4-report.json`
```json
{
  "timestamp": "2026-03-18T03:28:28.777Z",
  "status": "success",
  "totalTime": 91.359,
  "conversationRounds": 5,
  "dialogueRounds": 0,
  "screenshots": [...],
  "stepTimings": {...}
}
```

**v5 报告**: `mcp-browser-test-v5-report.json`
```json
{
  "timestamp": "2026-03-18T03:34:46.037Z",
  "status": "success",
  "totalTime": 140.111,
  "conversationRounds": 5,
  "dialogueRounds": 0,
  "feedbackProvided": false,
  "screenshots": [...],
  "apiResponseTimes": [3005, 3014, 3063, 3013, 3007]
}
```

---

## ✅ 验收标准

### 必须通过的标准
- [x] 浏览器成功启动并访问平台
- [x] 用户登录成功
- [x] 目标对话完成（5 轮对话）
- [x] 学习路径生成成功
- [ ] 查看路径详情（阶段和任务）
- [ ] 开始第一个任务学习
- [ ] 完成至少 2 轮对话
- [ ] 提供反馈
- [ ] 查看学习进度
- [x] 生成完整测试报告
- [x] 截图保存关键步骤

**当前通过率**: 55% (6/11)

---

## 🔍 常见问题

### Q1: 测试失败，提示 "ERR_CONNECTION_REFUSED"
**A**: 前端或后端服务未启动
```powershell
# 检查服务状态
.\start-dev.ps1
```

### Q2: 登录失败，提示 "邮箱或密码错误"
**A**: 测试账号不存在，需要先注册
```javascript
// 方法 1: 手动注册
访问 http://localhost:5173/register

// 方法 2: 使用 API 注册
node -e "const axios=require('axios');axios.post('http://localhost:3001/api/auth/register',{name:'测试',email:'test@test.com',password:'Test123456!'}).then(r=>console.log(r.data))"
```

### Q3: 目标对话页面找不到输入框
**A**: 页面未正确加载或登录状态失效
- 检查是否已登录
- 检查路由是否正确跳转到 `/goal-conversation`
- 查看浏览器控制台错误

### Q4: AI 响应时间过长（>10 秒）
**A**: AI 服务可能负载过高
- 检查 NewAPI 服务是否正常运行
- 检查 deepseek-chat 模型服务状态
- 查看后端日志 `backend/logs/error.log`

### Q5: 截图文件未生成
**A**: 可能是路径问题或权限问题
- 确保在 `backend/` 目录运行测试
- 检查文件系统权限
- 查看测试脚本中的截图路径配置

---

## 🛠️ 调试技巧

### 1. 显示浏览器窗口
测试脚本默认会显示浏览器窗口（`headless: false`），便于观察测试过程。

### 2. 调整操作速度
修改 `slowMo` 参数：
```javascript
const browser = await chromium.launch({
  headless: false,
  slowMo: 150  // 增大数值放慢速度，减小数值加快速度
});
```

### 3. 查看详细日志
测试脚本会输出详细的控制台日志，包括：
- 每个步骤的执行状态
- AI 响应时间
- 错误信息

### 4. 查看页面错误
测试脚本会捕获页面控制台错误：
```javascript
page.on('console', msg => {
  if (msg.type() === 'error') {
    console.log(`[页面错误] ${msg.text()}`);
  }
});
```

---

## 📈 性能基准

### 优秀标准
- 首页加载：<2 秒 ✅
- 登录流程：<5 秒 ✅
- AI 响应：<3 秒 ✅
- 对话轮次：5 轮完成 ✅

### 需要改进
- 学习路径列表加载：当前失败 ❌
- 任务学习页面：无法进入 ❌
- 反馈功能：缺失 ❌

---

## 🔄 持续集成

### 添加到 CI/CD
```yaml
# GitHub Actions 示例
name: Browser Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: |
          cd backend && npm install
          cd ../frontend && npm install
      
      - name: Start services
        run: |
          # 启动后端和前端
          ./start-dev.sh &
          sleep 30
      
      - name: Run browser tests
        run: |
          cd backend
          node test-mcp-browser-v4.mjs
      
      - name: Upload test artifacts
        uses: actions/upload-artifact@v2
        with:
          name: test-results
          path: |
            backend/mcp-browser-test-v*.jpg
            backend/mcp-browser-test-v*.json
```

---

## 📚 相关文档

- **测试报告**: `MCP_BROWSER_TEST_FINAL_REPORT.md`
- **v4 报告**: `backend/mcp-browser-test-v4-report.json`
- **v5 报告**: `backend/mcp-browser-test-v5-report.json`
- **测试脚本**: `backend/test-mcp-browser-v4.mjs`
- **测试脚本**: `backend/test-mcp-browser-v5.mjs`

---

## 📞 联系支持

如有问题，请查看：
1. 后端日志：`backend/logs/error.log`
2. 前端控制台：浏览器 DevTools
3. 测试报告：`MCP_BROWSER_TEST_FINAL_REPORT.md`

---

*文档版本：v1.0*  
*最后更新：2026-03-18*  
*维护者：MCP Browser Test Team*

