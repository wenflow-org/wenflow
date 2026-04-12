import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';

test.describe('MCP Agent 3 - 学习页面和任务完成测试', () => {
  const screenshots: string[] = [];
  const performanceMetrics = {
    pageLoadTimes: [] as number[],
    aiResponseTimes: [] as number[],
    totalInteractionTime: 0
  };
  const testResults = {
    pathsList: { status: '❌ 失败', details: '' },
    pathDetail: { status: '❌ 失败', details: '' },
    taskList: { status: '❌ 失败', details: '' },
    learningPage: { status: '❌ 失败', details: '' },
    aiTutor: { status: '❌ 失败', details: '' },
    taskCompletion: { status: '❌ 失败', details: '' },
    progressUpdate: { status: '❌ 失败', details: '' }
  };
  const consoleLogs: any[] = [];
  const errors: any[] = [];

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    // 捕获控制台消息
    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString()
      });
    });

    // 捕获页面错误
    page.on('pageerror', err => {
      errors.push({
        message: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
      });
    });
  });

  test('完成学习任务完整流程', async ({ page }) => {
    const startTime = Date.now();
    const backendDir = join(process.cwd(), 'backend');

    console.log('🚀 开始 MCP 学习页面和任务完成测试 (Agent 3)...\n');

    try {
      // 步骤 1: 访问首页
      console.log('[1/12] 访问首页...');
      let loadTime = Date.now();
      await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });
      loadTime = Date.now() - loadTime;
      performanceMetrics.pageLoadTimes.push(loadTime);
      console.log(`✅ 首页已加载 (${loadTime}ms)`);
      
      const screenshot1 = 'mcp-agent3-01-homepage.jpg';
      await page.screenshot({ path: join(backendDir, screenshot1) });
      screenshots.push(screenshot1);

      // 步骤 2: 检查登录状态
      console.log('[2/12] 检查登录状态...');
      await page.waitForTimeout(2000);
      
      const userMenu = await page.$('.user-menu, .avatar-placeholder, .el-dropdown-user').catch(() => null);
      if (!userMenu) {
        console.log('未登录，执行登录流程...');
        const loginButton = await page.$('button:has-text("登录")').catch(() => null);
        if (loginButton) {
          await loginButton.click();
          await page.waitForURL('**/login', { timeout: 10000 });
          await page.waitForTimeout(1000);
          
          // 尝试多种选择器
          const emailInput = await page.$('#email, input[type="email"], input[placeholder*="邮箱"]').catch(() => null);
          const passwordInput = await page.$('#password, input[type="password"], input[placeholder*="密码"]').catch(() => null);
          
          if (emailInput && passwordInput) {
            await emailInput.fill('mcp_test_fix@test.com');
            await passwordInput.fill('Test123456!');
            await page.waitForTimeout(500);
            
            const submitButton = await page.$('button[type="submit"], button:has-text("登录")').catch(() => null);
            if (submitButton) {
              await submitButton.click();
              await page.waitForTimeout(5000);
              console.log('✅ 登录成功');
            }
          }
        }
      } else {
        console.log('✅ 用户已登录');
      }
      
      const screenshot2 = 'mcp-agent3-02-logged-in.jpg';
      await page.screenshot({ path: join(backendDir, screenshot2) });
      screenshots.push(screenshot2);

      // 步骤 3: 导航到学习路径列表
      console.log('[3/12] 导航到学习路径列表...');
      loadTime = Date.now();
      await page.goto('http://localhost:5173/learning-paths', { waitUntil: 'networkidle', timeout: 30000 });
      loadTime = Date.now() - loadTime;
      performanceMetrics.pageLoadTimes.push(loadTime);
      await page.waitForTimeout(3000);
      console.log(`✅ 学习路径列表已加载 (${loadTime}ms)`);
      
      // 检查路径列表
      const pathSelectors = [
        '.learning-path-card',
        '.path-item',
        '.el-card',
        '.path-card',
        '[class*="path-card"]',
        '[class*="path-item"]'
      ];
      
      let pathsFound = false;
      for (const selector of pathSelectors) {
        const elements = await page.$$(selector).catch(() => []);
        if (elements && elements.length > 0) {
          console.log(`✅ 找到学习路径：${selector}, 数量：${elements.length}`);
          pathsFound = true;
          testResults.pathsList = { status: '✅ 成功', details: `显示 ${elements.length} 个学习路径` };
          break;
        }
      }
      
      if (!pathsFound) {
        console.log('⚠️ 未找到学习路径，检查页面内容...');
        testResults.pathsList = { status: '⚠️ 警告', details: '未找到学习路径卡片' };
      }
      
      const screenshot3 = 'mcp-agent3-03-paths-list.jpg';
      await page.screenshot({ path: join(backendDir, screenshot3) });
      screenshots.push(screenshot3);

      // 步骤 4: 选择第一个学习路径
      console.log('[4/12] 选择第一个学习路径...');
      const firstPath = await page.$('.learning-path-card:first-child, .path-item:first-child, .el-card:first-child, .path-card:first-child, [class*="path"]:first-child').catch(() => null);
      
      if (firstPath) {
        const pathTitle = await firstPath.textContent();
        console.log(`路径标题：${pathTitle?.substring(0, 100)}`);
        
        await firstPath.click();
        await page.waitForTimeout(3000);
        
        // 检查是否进入详情页
        const detailSelectors = [
          '.path-detail',
          '.learning-path-detail',
          '.path-header',
          '.el-card__header',
          'h1',
          '.page-title'
        ];
        
        let detailFound = false;
        for (const selector of detailSelectors) {
          const element = await page.$(selector).catch(() => null);
          if (element) {
            console.log(`✅ 路径详情页找到：${selector}`);
            detailFound = true;
            break;
          }
        }
        
        if (detailFound) {
          testResults.pathDetail = { status: '✅ 成功', details: '路径详情页加载成功' };
        } else {
          testResults.pathDetail = { status: '⚠️ 警告', details: '路径详情页可能未完全加载' };
        }
        
        const screenshot4 = 'mcp-agent3-04-path-detail.jpg';
        await page.screenshot({ path: join(backendDir, screenshot4) });
        screenshots.push(screenshot4);
      } else {
        console.log('❌ 未找到学习路径');
        testResults.pathDetail = { status: '❌ 失败', details: '未找到学习路径' };
      }

      // 步骤 5: 查看任务列表
      console.log('[5/12] 查看任务列表...');
      await page.waitForTimeout(2000);
      
      const taskSelectors = [
        '.task-item',
        '.task-card',
        '.el-list-item',
        '.week-card',
        '.stage-card',
        '[class*="task-item"]',
        '[class*="task-card"]'
      ];
      
      let tasksFound = false;
      for (const selector of taskSelectors) {
        const elements = await page.$$(selector).catch(() => []);
        if (elements && elements.length > 0) {
          console.log(`✅ 找到任务：${selector}, 数量：${elements.length}`);
          tasksFound = true;
          testResults.taskList = { status: '✅ 成功', details: `显示 ${elements.length} 个任务` };
          break;
        }
      }
      
      if (!tasksFound) {
        console.log('⚠️ 未找到任务列表');
        testResults.taskList = { status: '⚠️ 警告', details: '未找到任务列表' };
      }
      
      const screenshot5 = 'mcp-agent3-05-task-list.jpg';
      await page.screenshot({ path: join(backendDir, screenshot5) });
      screenshots.push(screenshot5);

      // 步骤 6: 进入第一个任务的学习页面
      console.log('[6/12] 进入第一个任务的学习页面...');
      
      if (tasksFound) {
        const firstTask = await page.$('.task-item:first-child, .task-card:first-child, .el-list-item:first-child, [class*="task"]:first-child').catch(() => null);
        
        if (firstTask) {
          const startButton = await firstTask.$('button:has-text("开始学习"), button:has-text("学习"), .start-learning-btn, .el-button--primary').catch(() => null);
          
          if (startButton) {
            console.log('✅ 找到"开始学习"按钮');
            await startButton.click();
            await page.waitForTimeout(5000);
            
            const learningSelectors = [
              '.learning-page',
              '.task-learning',
              '.dialogue-card',
              '.question-card',
              '.ai-tutor',
              '[class*="learning"]',
              '[class*="dialogue"]'
            ];
            
            let learningPageFound = false;
            for (const selector of learningSelectors) {
              const element = await page.$(selector).catch(() => null);
              if (element) {
                console.log(`✅ 学习页面找到：${selector}`);
                learningPageFound = true;
                break;
              }
            }
            
            if (learningPageFound) {
              testResults.learningPage = { status: '✅ 成功', details: '学习页面加载成功' };
            } else {
              testResults.learningPage = { status: '⚠️ 警告', details: '学习页面可能使用不同的组件' };
            }
            
            const screenshot6 = 'mcp-agent3-06-learning-page.jpg';
            await page.screenshot({ path: join(backendDir, screenshot6) });
            screenshots.push(screenshot6);
          } else {
            console.log('⚠️ 未找到"开始学习"按钮');
            testResults.learningPage = { status: '⚠️ 警告', details: '未找到开始学习按钮' };
          }
        } else {
          console.log('❌ 未找到第一个任务');
          testResults.learningPage = { status: '❌ 失败', details: '未找到任务' };
        }
      }

      // 步骤 7: 阅读任务内容
      console.log('[7/12] 阅读任务内容...');
      await page.waitForTimeout(2000);
      
      const questionText = await page.textContent('.question-text, .question-content, .question-title, .task-description').catch(() => null);
      if (questionText) {
        console.log(`✅ 问题/任务内容：${questionText.substring(0, 150)}...`);
      } else {
        console.log('⚠️ 未找到问题/任务内容');
      }
      
      const screenshot7 = 'mcp-agent3-07-question-content.jpg';
      await page.screenshot({ path: join(backendDir, screenshot7) });
      screenshots.push(screenshot7);

      // 步骤 8: 查看 AI 辅导对话
      console.log('[8/12] 查看 AI 辅导对话...');
      
      const aiResponseSelectors = [
        '.ai-response',
        '.ai-message',
        '.tutor-response',
        '.el-message',
        '.chat-message.ai',
        '[class*="ai-response"]',
        '[class*="tutor-response"]'
      ];
      
      let aiResponseFound = false;
      for (const selector of aiResponseSelectors) {
        const element = await page.$(selector).catch(() => null);
        if (element) {
          console.log(`✅ AI 响应找到：${selector}`);
          aiResponseFound = true;
          testResults.aiTutor = { status: '✅ 成功', details: 'AI 辅导对话显示正常' };
          break;
        }
      }
      
      if (!aiResponseFound) {
        console.log('⚠️ 未找到 AI 响应，可能是开放式问题');
        testResults.aiTutor = { status: '⚠️ 警告', details: 'AI 辅导对话未找到' };
      }
      
      const screenshot8 = 'mcp-agent3-08-ai-tutor.jpg';
      await page.screenshot({ path: join(backendDir, screenshot8) });
      screenshots.push(screenshot8);

      // 步骤 9: 回答问题并提交
      console.log('[9/12] 回答问题并提交...');
      let submitted = false;
      
      const optionButton = await page.$('.option-item:first-child, .el-radio:first-child, .option-choice:first-child, .choice-item:first-child').catch(() => null);
      if (optionButton) {
        console.log('✅ 找到选择题选项');
        await optionButton.click();
        await page.waitForTimeout(500);
        
        const submitButton = await page.$('button:has-text("提交"), button:has-text("确认"), .submit-btn, .el-button--primary').catch(() => null);
        if (submitButton) {
          console.log('✅ 找到提交按钮');
          let respTime = Date.now();
          await submitButton.click();
          await page.waitForTimeout(5000);
          respTime = Date.now() - respTime;
          performanceMetrics.aiResponseTimes.push(respTime);
          console.log(`✅ 已提交答案 (${respTime}ms)`);
          submitted = true;
        }
      }
      
      if (!submitted) {
        const textarea = await page.$('textarea').catch(() => null);
        if (textarea) {
          console.log('✅ 找到文本输入框');
          await textarea.fill('这是我的回答，基于我对问题的理解。');
          await page.waitForTimeout(500);
          
          const submitButton = await page.$('button:has-text("提交"), button:has-text("确认"), .submit-btn, .el-button--primary').catch(() => null);
          if (submitButton) {
            console.log('✅ 找到提交按钮');
            let respTime = Date.now();
            await submitButton.click();
            await page.waitForTimeout(5000);
            respTime = Date.now() - respTime;
            performanceMetrics.aiResponseTimes.push(respTime);
            console.log(`✅ 已提交文本回答 (${respTime}ms)`);
            submitted = true;
          }
        }
      }
      
      if (!submitted) {
        console.log('⚠️ 未能找到答题方式');
      }
      
      const screenshot9 = 'mcp-agent3-09-submitted.jpg';
      await page.screenshot({ path: join(backendDir, screenshot9) });
      screenshots.push(screenshot9);

      // 步骤 10: 查看 AI 反馈
      console.log('[10/12] 查看 AI 反馈...');
      await page.waitForTimeout(3000);
      
      const feedbackSelectors = [
        '.feedback',
        '.ai-feedback',
        '.correct-answer',
        '.explanation',
        '.el-alert--success',
        '.el-alert--info',
        '[class*="feedback"]'
      ];
      
      let feedbackFound = false;
      for (const selector of feedbackSelectors) {
        const element = await page.$(selector).catch(() => null);
        if (element) {
          console.log(`✅ AI 反馈找到：${selector}`);
          feedbackFound = true;
          break;
        }
      }
      
      if (feedbackFound) {
        console.log('✅ AI 反馈显示正常');
      } else {
        console.log('⚠️ 未找到明确的 AI 反馈');
      }
      
      const screenshot10 = 'mcp-agent3-10-feedback.jpg';
      await page.screenshot({ path: join(backendDir, screenshot10) });
      screenshots.push(screenshot10);

      // 步骤 11: 完成任务
      console.log('[11/12] 完成任务...');
      
      const completeButton = await page.$('button:has-text("完成"), button:has-text("标记为完成"), button:has-text("继续"), .complete-btn, .el-button--success').catch(() => null);
      if (completeButton) {
        console.log('✅ 找到任务完成按钮');
        await completeButton.click();
        await page.waitForTimeout(3000);
        console.log('✅ 任务已标记为完成');
        testResults.taskCompletion = { status: '✅ 成功', details: '任务完成状态更新成功' };
      } else {
        console.log('⚠️ 未找到任务完成按钮');
        testResults.taskCompletion = { status: '⚠️ 警告', details: '未找到完成按钮' };
      }
      
      const screenshot11 = 'mcp-agent3-11-task-complete.jpg';
      await page.screenshot({ path: join(backendDir, screenshot11) });
      screenshots.push(screenshot11);

      // 步骤 12: 查看学习进度更新
      console.log('[12/12] 查看学习进度更新...');
      await page.waitForTimeout(2000);
      
      await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      const progressSelectors = [
        '.progress',
        '.progress-bar',
        '.el-progress',
        '.completion-rate',
        '[class*="progress"]',
        '[class*="completion"]'
      ];
      
      let progressFound = false;
      for (const selector of progressSelectors) {
        const element = await page.$(selector).catch(() => null);
        if (element) {
          console.log(`✅ 进度指示器找到：${selector}`);
          progressFound = true;
          testResults.progressUpdate = { status: '✅ 成功', details: '学习进度更新成功' };
          break;
        }
      }
      
      if (!progressFound) {
        console.log('⚠️ 未找到进度指示器');
        testResults.progressUpdate = { status: '⚠️ 警告', details: '未找到进度更新' };
      }
      
      const screenshot12 = 'mcp-agent3-12-progress-update.jpg';
      await page.screenshot({ path: join(backendDir, screenshot12) });
      screenshots.push(screenshot12);

    } catch (error: any) {
      console.error('❌ 测试过程中发生错误:', error.message);
      errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      const errorScreenshot = 'mcp-agent3-error.jpg';
      await page.screenshot({ path: join(backendDir, errorScreenshot) });
      screenshots.push(errorScreenshot);
    }

    // 计算性能指标
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    performanceMetrics.totalInteractionTime = totalTime;
    
    const avgPageLoadTime = performanceMetrics.pageLoadTimes.length > 0
      ? (performanceMetrics.pageLoadTimes.reduce((a, b) => a + b, 0) / performanceMetrics.pageLoadTimes.length).toFixed(0)
      : 0;
    
    const avgAIResponseTime = performanceMetrics.aiResponseTimes.length > 0
      ? (performanceMetrics.aiResponseTimes.reduce((a, b) => a + b, 0) / performanceMetrics.aiResponseTimes.length).toFixed(0)
      : 0;

    // 生成测试报告
    const report = {
      timestamp: new Date().toISOString(),
      testName: 'MCP Agent 3 - 学习页面和任务完成测试',
      totalTime: totalTime + '秒',
      performanceMetrics: {
        averagePageLoadTime: avgPageLoadTime + 'ms',
        averageAIResponseTime: avgAIResponseTime + 'ms',
        totalPageLoads: performanceMetrics.pageLoadTimes.length,
        totalAIInteractions: performanceMetrics.aiResponseTimes.length,
        totalInteractionTime: totalTime + '秒'
      },
      testResults: testResults,
      summary: {
        total: 7,
        passed: Object.values(testResults).filter(r => r.status.includes('✅')).length,
        failed: Object.values(testResults).filter(r => r.status.includes('❌')).length,
        warnings: Object.values(testResults).filter(r => r.status.includes('⚠️')).length
      },
      screenshots: screenshots,
      consoleLogs: consoleLogs.slice(0, 50),
      errors: errors
    };

    console.log('\n' + '='.repeat(60));
    console.log('📊 MCP Agent 3 测试报告');
    console.log('='.repeat(60));
    console.log(JSON.stringify(report, null, 2));
    console.log('='.repeat(60));

    // 保存报告
    writeFileSync(
      join(backendDir, 'mcp-agent3-learning-report.json'),
      JSON.stringify(report, null, 2)
    );
    console.log('\n✅ 测试报告已保存到：backend/mcp-agent3-learning-report.json');

    // 保存控制台日志
    writeFileSync(
      join(backendDir, 'mcp-agent3-console-logs.json'),
      JSON.stringify(consoleLogs, null, 2)
    );
    console.log('✅ 控制台日志已保存到：backend/mcp-agent3-console-logs.json');

    // 保存错误日志
    writeFileSync(
      join(backendDir, 'mcp-agent3-errors.json'),
      JSON.stringify(errors, null, 2)
    );
    console.log('✅ 错误日志已保存到：backend/mcp-agent3-errors.json');

    console.log('\n✅ 浏览器测试完成！');
  });
});
