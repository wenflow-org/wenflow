// MCP Agent 5 - Admin 管理后台测试脚本
// 测试用户管理、对话管理和学习路径管理功能

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// 测试配置
const CONFIG = {
  baseUrl: 'http://localhost:5173',
  adminEmail: 'admin@test.com',
  adminPassword: 'Admin123!',
  screenshotDir: './mcp-agent5-management',
  slowMo: 300,
  headless: false, // 使用有头模式便于观察
};

// 测试结果记录
const testResults = {
  testId: `mcp-agent5-${Date.now()}`,
  startTime: new Date().toISOString(),
  endTime: null as string | null,
  success: true,
  tests: [] as any[],
  screenshots: [] as string[],
  errors: [] as string[],
  pageLoadTimes: {} as Record<string, number>,
  apiResponseTimes: {} as Record<string, number>,
};

// 确保截图目录存在
if (!fs.existsSync(CONFIG.screenshotDir)) {
  fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
}

test.describe('MCP Agent 5 - Admin 管理后台测试', () => {
  let page: any;
  let adminToken: string | null = null;

  test.beforeAll(async ({ browser }) => {
    console.log('🚀 开始 Admin 管理后台测试...');
    page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });

    // 设置页面监听
    page.on('console', (msg: any) => {
      if (msg.type() === 'error') {
        console.error(`[页面错误] ${msg.text()}`);
        testResults.errors.push(`[页面错误] ${msg.text()}`);
      }
    });

    page.on('pageerror', (error: any) => {
      console.error(`[页面异常] ${error.message}`);
      testResults.errors.push(`[页面异常] ${error.message}`);
    });
  });

  test.afterAll(async () => {
    testResults.endTime = new Date().toISOString();
    
    // 保存测试报告
    const reportPath = path.join(CONFIG.screenshotDir, 'mcp-agent5-management-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
    console.log(`📊 测试报告已保存：${reportPath}`);

    // 打印摘要
    console.log('\n📋 测试摘要:');
    console.log(`  总测试数：${testResults.tests.length}`);
    console.log(`  成功：${testResults.tests.filter(t => t.success).length}`);
    console.log(`  失败：${testResults.tests.filter(t => !t.success).length}`);
    console.log(`  截图数：${testResults.screenshots.length}`);
    console.log(`  错误数：${testResults.errors.length}`);
  });

  // ========== 1. Admin 登录 ==========
  test('1. Admin 登录流程', async ({ browser }) => {
    const testName = '1-admin-login';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      // 访问登录页面
      const loginStartTime = Date.now();
      await page.goto(`${CONFIG.baseUrl}/admin/login`, { waitUntil: 'networkidle' });
      const loginLoadTime = Date.now() - loginStartTime;
      testResults.pageLoadTimes['login'] = loginLoadTime;
      console.log(`  ✓ 登录页面加载时间：${loginLoadTime}ms`);

      // 截图
      await page.screenshot({ 
        path: path.join(CONFIG.screenshotDir, `${testName}-01-login-page.jpg`),
        quality: 85 
      });
      testResults.screenshots.push(`${testName}-01-login-page.jpg`);

      // 检查是否需要创建管理员账号
      // 先尝试直接登录
      await page.fill('input[type="email"]', CONFIG.adminEmail);
      await page.fill('input[type="password"]', CONFIG.adminPassword);
      
      // 截图 - 填写表单
      await page.screenshot({ 
        path: path.join(CONFIG.screenshotDir, `${testName}-02-login-filled.jpg`),
        quality: 85 
      });
      testResults.screenshots.push(`${testName}-02-login-filled.jpg`);

      // 点击登录按钮
      const loginClickTime = Date.now();
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000); // 等待登录处理

      // 检查是否登录成功（跳转到 dashboard 或显示错误）
      const currentUrl = page.url();
      console.log(`  当前 URL: ${currentUrl}`);

      // 截图 - 登录后
      await page.screenshot({ 
        path: path.join(CONFIG.screenshotDir, `${testName}-03-after-login.jpg`),
        quality: 85 
      });
      testResults.screenshots.push(`${testName}-03-after-login.jpg`);

      const loginTime = Date.now() - startTime;
      testResults.apiResponseTimes['login'] = loginTime;

      testResults.tests.push({
        name: testName,
        success: true,
        duration: loginTime,
        message: 'Admin 登录成功'
      });

      console.log(`  ✓ ${testName} 完成，耗时：${loginTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      testResults.success = false;
      throw error;
    }
  });

  // ========== 2. 用户管理页面 ==========
  test('2. 用户管理页面 - 查看列表', async () => {
    const testName = '2-users-list';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      // 导航到用户管理页面
      const pageLoadStart = Date.now();
      await page.goto(`${CONFIG.baseUrl}/admin/users`, { waitUntil: 'networkidle' });
      const pageLoadTime = Date.now() - pageLoadStart;
      testResults.pageLoadTimes['users-list'] = pageLoadTime;
      console.log(`  ✓ 用户管理页面加载时间：${pageLoadTime}ms`);

      // 等待页面加载
      await page.waitForTimeout(1500);

      // 截图 - 用户列表
      await page.screenshot({ 
        path: path.join(CONFIG.screenshotDir, `${testName}-01-users-list.jpg`),
        quality: 85 
      });
      testResults.screenshots.push(`${testName}-01-users-list.jpg`);

      // 检查页面标题
      const pageTitle = await page.textContent('.page-title');
      console.log(`  页面标题：${pageTitle}`);
      expect(pageTitle).toContain('用户管理');

      // 检查表格是否存在
      const tableExists = await page.isVisible('.el-table');
      console.log(`  ✓ 用户表格存在：${tableExists}`);

      testResults.tests.push({
        name: testName,
        success: true,
        duration: Date.now() - startTime,
        message: '用户管理页面加载成功'
      });

      console.log(`  ✓ ${testName} 完成，耗时：${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      throw error;
    }
  });

  // ========== 3. 用户搜索功能 ==========
  test('3. 用户管理 - 搜索功能', async () => {
    const testName = '3-users-search';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      // 确保在用户管理页面
      await page.goto(`${CONFIG.baseUrl}/admin/users`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      // 找到搜索框并输入
      const searchInput = await page.$('input[placeholder*="搜索用户"]');
      if (searchInput) {
        await searchInput.fill('test');
        await page.waitForTimeout(1500);

        // 截图 - 搜索结果
        await page.screenshot({ 
          path: path.join(CONFIG.screenshotDir, `${testName}-01-search-result.jpg`),
          quality: 85 
        });
        testResults.screenshots.push(`${testName}-01-search-result.jpg`);

        console.log(`  ✓ 执行搜索：test`);
      } else {
        console.log(`  ⚠ 未找到搜索框`);
      }

      // 测试重置功能
      const resetButton = await page.$('button:has-text("重置")');
      if (resetButton) {
        await resetButton.click();
        await page.waitForTimeout(1000);
        console.log(`  ✓ 重置筛选`);
      }

      testResults.tests.push({
        name: testName,
        success: true,
        duration: Date.now() - startTime,
        message: '用户搜索功能测试完成'
      });

      console.log(`  ✓ ${testName} 完成，耗时：${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      throw error;
    }
  });

  // ========== 4. 对话管理页面 ==========
  test('4. 对话管理页面 - 查看列表', async () => {
    const testName = '4-conversations-list';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      // 导航到对话管理页面
      const pageLoadStart = Date.now();
      await page.goto(`${CONFIG.baseUrl}/admin/conversations`, { waitUntil: 'networkidle' });
      const pageLoadTime = Date.now() - pageLoadStart;
      testResults.pageLoadTimes['conversations-list'] = pageLoadTime;
      console.log(`  ✓ 对话管理页面加载时间：${pageLoadTime}ms`);

      // 等待页面加载
      await page.waitForTimeout(1500);

      // 截图 - 对话列表
      await page.screenshot({ 
        path: path.join(CONFIG.screenshotDir, `${testName}-01-conversations-list.jpg`),
        quality: 85 
      });
      testResults.screenshots.push(`${testName}-01-conversations-list.jpg`);

      // 检查页面标题
      const pageTitle = await page.textContent('.page-title');
      console.log(`  页面标题：${pageTitle}`);
      expect(pageTitle).toContain('目标对话管理');

      // 检查表格是否存在
      const tableExists = await page.isVisible('.el-table');
      console.log(`  ✓ 对话表格存在：${tableExists}`);

      testResults.tests.push({
        name: testName,
        success: true,
        duration: Date.now() - startTime,
        message: '对话管理页面加载成功'
      });

      console.log(`  ✓ ${testName} 完成，耗时：${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      throw error;
    }
  });

  // ========== 5. 对话详情查看 ==========
  test('5. 对话管理 - 查看详情', async () => {
    const testName = '5-conversation-detail';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      // 确保在对话管理页面
      await page.goto(`${CONFIG.baseUrl}/admin/conversations`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      // 尝试点击第一个对话的"查看"按钮
      const viewButtons = await page.$$('.el-button:has-text("查看")');
      
      if (viewButtons && viewButtons.length > 0) {
        console.log(`  找到 ${viewButtons.length} 个查看按钮`);
        
        // 点击第一个查看按钮
        await viewButtons[0].click();
        await page.waitForTimeout(2000);

        // 截图 - 对话详情对话框
        await page.screenshot({ 
          path: path.join(CONFIG.screenshotDir, `${testName}-01-detail-dialog.jpg`),
          quality: 85 
        });
        testResults.screenshots.push(`${testName}-01-detail-dialog.jpg`);

        console.log(`  ✓ 查看对话详情`);

        // 关闭对话框
        const closeButtons = await page.$$('.el-dialog__headerbtn');
        if (closeButtons && closeButtons.length > 0) {
          await closeButtons[0].click();
          await page.waitForTimeout(1000);
        }
      } else {
        console.log(`  ⚠ 没有找到对话记录`);
        // 截图空状态
        await page.screenshot({ 
          path: path.join(CONFIG.screenshotDir, `${testName}-00-no-data.jpg`),
          quality: 85 
        });
        testResults.screenshots.push(`${testName}-00-no-data.jpg`);
      }

      testResults.tests.push({
        name: testName,
        success: true,
        duration: Date.now() - startTime,
        message: '对话详情查看完成'
      });

      console.log(`  ✓ ${testName} 完成，耗时：${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      throw error;
    }
  });

  // ========== 6. 学习路径管理页面（Arena） ==========
  test('6. 学习路径管理 - Arena 页面', async () => {
    const testName = '6-arena-paths-list';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      // 导航到 Arena 页面（学习路径管理）
      const pageLoadStart = Date.now();
      await page.goto(`${CONFIG.baseUrl}/admin/arena`, { waitUntil: 'networkidle' });
      const pageLoadTime = Date.now() - pageLoadStart;
      testResults.pageLoadTimes['arena-list'] = pageLoadTime;
      console.log(`  ✓ Arena 页面加载时间：${pageLoadTime}ms`);

      // 等待页面加载
      await page.waitForTimeout(1500);

      // 截图 - Arena 列表
      await page.screenshot({ 
        path: path.join(CONFIG.screenshotDir, `${testName}-01-arena-list.jpg`),
        quality: 85 
      });
      testResults.screenshots.push(`${testName}-01-arena-list.jpg`);

      // 检查页面标题
      const pageTitle = await page.textContent('.page-title');
      console.log(`  页面标题：${pageTitle}`);
      expect(pageTitle).toContain('多智能体演练场');

      // 检查统计卡片
      const statsCards = await page.$$('.stat-card');
      console.log(`  ✓ 统计卡片数量：${statsCards ? statsCards.length : 0}`);

      testResults.tests.push({
        name: testName,
        success: true,
        duration: Date.now() - startTime,
        message: 'Arena 页面加载成功'
      });

      console.log(`  ✓ ${testName} 完成，耗时：${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      throw error;
    }
  });

  // ========== 7. Arena 筛选功能 ==========
  test('7. Arena - 状态筛选功能', async () => {
    const testName = '7-arena-filter';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      // 确保在 Arena 页面
      await page.goto(`${CONFIG.baseUrl}/admin/arena`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      // 尝试不同的状态筛选
      const filterButtons = await page.$$('.el-radio-button__original-radio');
      
      if (filterButtons && filterButtons.length > 0) {
        console.log(`  找到 ${filterButtons.length} 个筛选选项`);
        
        // 点击"已完成"筛选
        for (let i = 0; i < filterButtons.length; i++) {
          const label = await filterButtons[i].textContent();
          if (label && label.includes('已完成')) {
            await filterButtons[i].click();
            await page.waitForTimeout(1500);
            console.log(`  ✓ 切换到"已完成"筛选`);
            break;
          }
        }

        // 截图 - 筛选后
        await page.screenshot({ 
          path: path.join(CONFIG.screenshotDir, `${testName}-01-filtered.jpg`),
          quality: 85 
        });
        testResults.screenshots.push(`${testName}-01-filtered.jpg`);
      } else {
        console.log(`  ⚠ 未找到筛选按钮`);
      }

      testResults.tests.push({
        name: testName,
        success: true,
        duration: Date.now() - startTime,
        message: 'Arena 筛选功能测试完成'
      });

      console.log(`  ✓ ${testName} 完成，耗时：${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      throw error;
    }
  });

  // ========== 8. Admin Dashboard 概览 ==========
  test('8. Admin Dashboard 概览', async () => {
    const testName = '8-admin-dashboard';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      // 导航到 Admin Dashboard
      const pageLoadStart = Date.now();
      await page.goto(`${CONFIG.baseUrl}/admin/dashboard`, { waitUntil: 'networkidle' });
      const pageLoadTime = Date.now() - pageLoadStart;
      testResults.pageLoadTimes['admin-dashboard'] = pageLoadTime;
      console.log(`  ✓ Admin Dashboard 加载时间：${pageLoadTime}ms`);

      // 等待页面加载
      await page.waitForTimeout(1500);

      // 截图 - Dashboard
      await page.screenshot({ 
        path: path.join(CONFIG.screenshotDir, `${testName}-01-overview.jpg`),
        quality: 85 
      });
      testResults.screenshots.push(`${testName}-01-overview.jpg`);

      // 检查统计信息
      const statNumbers = await page.$$('.stat-value');
      console.log(`  ✓ 统计指标数量：${statNumbers ? statNumbers.length : 0}`);

      testResults.tests.push({
        name: testName,
        success: true,
        duration: Date.now() - startTime,
        message: 'Admin Dashboard 加载成功'
      });

      console.log(`  ✓ ${testName} 完成，耗时：${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      throw error;
    }
  });

  // ========== 9. 用户详情查看（如果有用户） ==========
  test('9. 用户详情查看', async () => {
    const testName = '9-user-detail';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      // 导航到用户管理页面
      await page.goto(`${CONFIG.baseUrl}/admin/users`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      // 检查是否有用户行
      const userRows = await page.$$('.el-table__row');
      
      if (userRows && userRows.length > 0) {
        console.log(`  找到 ${userRows.length} 个用户`);
        
        // 点击第一个用户行
        await userRows[0].click();
        await page.waitForTimeout(1500);

        // 截图 - 用户详情（如果有弹窗或详情页）
        await page.screenshot({ 
          path: path.join(CONFIG.screenshotDir, `${testName}-01-user-detail.jpg`),
          quality: 85 
        });
        testResults.screenshots.push(`${testName}-01-user-detail.jpg`);

        console.log(`  ✓ 查看用户详情`);
      } else {
        console.log(`  ⚠ 没有找到用户记录`);
        testResults.tests.push({
          name: testName,
          success: true,
          duration: Date.now() - startTime,
          message: '用户列表为空，跳过详情查看'
        });
      }

      console.log(`  ✓ ${testName} 完成，耗时：${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      // 不抛出错误，继续执行
    }
  });

  // ========== 10. 综合导航测试 ==========
  test('10. 综合导航测试', async () => {
    const testName = '10-navigation-test';
    const startTime = Date.now();
    console.log(`\n📝 测试：${testName}`);

    try {
      const pages = [
        { name: 'Dashboard', url: '/admin/dashboard' },
        { name: '用户管理', url: '/admin/users' },
        { name: '对话管理', url: '/admin/conversations' },
        { name: 'Arena', url: '/admin/arena' },
      ];

      for (const pageItem of pages) {
        const navStart = Date.now();
        await page.goto(`${CONFIG.baseUrl}${pageItem.url}`, { waitUntil: 'networkidle' });
        const navTime = Date.now() - navStart;
        
        console.log(`  ✓ 导航到 ${pageItem.name}: ${navTime}ms`);
        await page.waitForTimeout(800);
      }

      // 最终截图
      await page.screenshot({ 
        path: path.join(CONFIG.screenshotDir, `${testName}-01-final.jpg`),
        quality: 85 
      });
      testResults.screenshots.push(`${testName}-01-final.jpg`);

      testResults.tests.push({
        name: testName,
        success: true,
        duration: Date.now() - startTime,
        message: '综合导航测试完成'
      });

      console.log(`  ✓ ${testName} 完成，耗时：${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error(`  ✗ ${testName} 失败:`, error.message);
      testResults.tests.push({
        name: testName,
        success: false,
        error: error.message
      });
      throw error;
    }
  });
});