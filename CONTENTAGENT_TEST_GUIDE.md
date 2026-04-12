# ContentAgent v3.0 测试快速启动指南

## 前置要求

### 必需环境
- ✅ Node.js >= 18.x
- ✅ 后端服务运行在 `http://localhost:3001`
- ✅ 前端服务运行在 `http://localhost:5173`（浏览器测试需要）
- ✅ Playwright 浏览器已安装

### 检查环境
```powershell
# 检查 Node.js
node --version

# 检查后端服务
Invoke-WebRequest -Uri "http://localhost:3001/api/health" -UseBasicParsing

# 检查前端服务
Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing

# 检查 Playwright
npx playwright --version
```

---

## 快速启动

### 方法 1: 使用 PowerShell 脚本（推荐）

```powershell
# 在项目根目录执行
.\test-content-agent-browser.ps1
```

**功能**:
- ✅ 自动检查环境
- ✅ 执行浏览器自动化测试
- ✅ 生成测试报告
- ✅ 整理截图文件

### 方法 2: 使用 npm 脚本

```bash
# 浏览器自动化测试
npm run test:contentagent

# API 集成测试
node backend/test-content-agent-api.mjs
```

### 方法 3: 直接运行测试脚本

```bash
# 浏览器测试
node backend/test-content-agent-browser.mjs

# API 测试
node backend/test-content-agent-api.mjs
```

---

## 启动开发服务

如果服务未运行，需要先启动：

### 启动后端
```powershell
cd backend
npm run dev
```

后端运行在：http://localhost:3001

### 启动前端
```powershell
cd frontend
npm run dev
```

前端运行在：http://localhost:5173

### 使用一键启动脚本
```powershell
# Windows PowerShell
.\start-dev.ps1

# 或批处理
.\start-dev.bat
```

---

## 测试类型说明

### 1. 浏览器自动化测试
**文件**: `backend/test-content-agent-browser.mjs`

**测试内容**:
- 完整的用户操作流程
- 前端 UI 渲染验证
- 真实浏览器环境
- 自动生成截图

**适合场景**:
- UI/UX 验证
- 端到端测试
- 视觉回归测试

**运行时间**: ~5-10 分钟

### 2. API 集成测试
**文件**: `backend/test-content-agent-api.mjs`

**测试内容**:
- 后端 API 功能验证
- 不依赖前端 UI
- 快速执行
- 性能指标收集

**适合场景**:
- 快速功能验证
- 回归测试
- 性能测试

**运行时间**: ~2-5 分钟

---

## 测试配置

### 修改测试账号
编辑测试脚本中的 `TEST_CONFIG`:

```javascript
const TEST_CONFIG = {
  username: 'contentagent_test',
  email: `contentagent_test_${Date.now()}@example.com`,
  password: 'Test123456!',
  baseUrl: 'http://localhost:5173',
  goal: '我想学习新媒体运营，掌握小红书、公众号、抖音的内容创作和运营技巧'
};
```

### 修改浏览器设置
```javascript
const browser = await chromium.launch({
  headless: false,  // true = 无头模式（不显示窗口）
  slowMo: 100       // 放慢操作速度（毫秒）
});
```

### 修改性能阈值
```javascript
const metrics = {
  pageLoadTime: 0,      // 目标：< 3000ms
  apiResponseTime: 0,   // 目标：< 2000ms
  contentAgentGenTime: 0 // 目标：< 5000ms
};
```

---

## 测试结果

### 输出文件

测试完成后会生成以下文件：

#### 截图文件
```
contentagent-test-01-home.jpg
contentagent-test-02-login-filled.jpg
contentagent-test-03-after-login.jpg
contentagent-test-04-goal-conversation.jpg
contentagent-test-05-round1-input.jpg
contentagent-test-06-round2-input.jpg
contentagent-test-07-round3-input.jpg
contentagent-test-08-round4-confirm.jpg
contentagent-test-09-round1-response.jpg
contentagent-test-09-round2-response.jpg
contentagent-test-09-round3-response.jpg
contentagent-test-09-round4-response.jpg
contentagent-test-10-path-generated.jpg
contentagent-test-11-task-selected.jpg
contentagent-test-12-contentagent-card.jpg
contentagent-test-13-answer-submitted.jpg
contentagent-test-14-feedback-received.jpg
contentagent-test-15-task-complete.jpg
```

#### 测试报告
```
test-reports/
  contentagent-test-report-20260317-175700.json
  screenshots-20260317-175700/
    contentagent-test-*.jpg
```

### 查看测试结果

测试完成后会显示：
```
========================================
  测试完成！
========================================

测试详情:
  开始时间：2026-03-17 17:57:00
  结束时间：2026-03-17 18:02:30
  总耗时：330.45 秒
  截图数量：15
  报告文件：C:\...\test-reports\contentagent-test-report-20260317-175700.json
```

---

## 常见问题

### Q1: 测试失败 "后端服务未启动"
**解决**:
```powershell
cd backend
npm run dev
```

### Q2: 测试失败 "前端服务未启动"
**解决**:
```powershell
cd frontend
npm run dev
```

### Q3: Playwright 浏览器未安装
**解决**:
```bash
npx playwright install chromium
```

### Q4: 测试超时
**原因**: AI 响应时间较长（20-35 秒/轮）

**解决**:
- 等待测试自动重试
- 或增加超时时间：
  ```javascript
  await page.waitForTimeout(90000); // 增加到 90 秒
  ```

### Q5: 数据库 Schema 错误
**解决**:
```powershell
cd backend
npx prisma db push
```

---

## 调试技巧

### 1. 开启详细日志
在测试脚本中添加：
```javascript
console.log('调试信息:', variable);
```

### 2. 使用有头模式
```javascript
const browser = await chromium.launch({
  headless: false,  // 显示浏览器窗口
  slowMo: 500       // 更慢，便于观察
});
```

### 3. 暂停测试
```javascript
await page.pause(); // 打开 Chrome DevTools
```

### 4. 查看网络请求
```javascript
page.on('request', request => {
  console.log('请求:', request.url());
});

page.on('response', response => {
  console.log('响应:', response.status(), response.url());
});
```

### 5. 保存页面状态
```javascript
await page.screenshot({ 
  path: 'debug-state.jpg', 
  fullPage: true 
});
```

---

## 性能优化建议

### 1. 减少 AI 响应时间
- 使用流式响应
- 优化 Prompt 长度
- 考虑升级到更快的模型

### 2. 加速测试执行
```javascript
// 跳过截图（如果需要快速测试）
// await page.screenshot(...);

// 减少等待时间
await page.waitForTimeout(1000); // 而不是 3000
```

### 3. 并行测试
```javascript
// 可以同时运行多个测试实例
// 注意：需要不同的测试账号
```

---

## 下一步

测试完成后：

1. **查看测试报告**
   ```powershell
   cat test-reports/contentagent-test-report-*.json
   ```

2. **检查截图**
   ```powershell
   explorer test-reports\screenshots-*
   ```

3. **分析问题**
   - 查看错误日志
   - 检查截图
   - 对比性能指标

4. **修复并重试**
   ```powershell
   # 修复问题后重新运行
   .\test-content-agent-browser.ps1
   ```

---

## 联系支持

如有问题，请：
1. 查看 `CONTENTAGENT_BROWSER_TEST_REPORT.md`
2. 检查后端日志：`backend/logs/`
3. 查看前端控制台：浏览器 DevTools

---

**文档版本**: v1.0  
**最后更新**: 2026-03-17  
**维护者**: AI 学习平台团队
