import { test, Page } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const BASE = 'http://localhost:5173'
const SCREENSHOT_DIR = join(__dirname, 'mcp-admin-screenshots')
const REPORT_PATH = join(__dirname, 'mcp-admin-report.json')

interface Checkpoint { name: string; status: '✅' | '⚠️' | '❌'; detail: string }
const checkpoints: Checkpoint[] = []
const screenshots: string[] = []
const errors: string[] = []

async function shot(page: Page, name: string) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const path = join(SCREENSHOT_DIR, `${name.replace(/[/\\?]/g, '-')}.jpg`)
  await page.screenshot({ path, type: 'jpeg', quality: 80 })
  screenshots.push(path)
}

async function check(page: Page, name: string, fn: () => Promise<boolean>) {
  console.log(`\n📍 ${name}`)
  try {
    const ok = await fn()
    checkpoints.push({ name, status: ok ? '✅' : '⚠️', detail: ok ? '正常' : '页面加载但异常' })
  } catch (e: any) {
    checkpoints.push({ name, status: '❌', detail: e.message })
    errors.push(`${name}: ${e.message}`)
  }
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  const loggedIn = await page.$('.user-chip').catch(() => null)
  if (loggedIn) return true
  await page.fill('input[placeholder*="请输入用户名"]', 'admin')
  await page.fill('input[placeholder*="请输入密码"]', 'admin123')
  await page.click('button:has-text("登录并继续")')
  await page.waitForTimeout(3000)
  return (await page.$('.user-chip').catch(() => null)) !== null
}

// 所有实际存在的 Admin 路由
const adminPages = [
  // content 组
  { path: '/admin/dashboard', name: 'Dashboard 数据概览' },
  { path: '/admin/users', name: '用户管理' },
  { path: '/admin/learner-models', name: '学习者模型' },
  { path: '/admin/teaching-sessions', name: '教学会话巡检' },
  // system 组
  { path: '/admin/api-config', name: 'API 管理' },
  { path: '/admin/platform-capabilities', name: '能力地图（Capability Catalog）' },
  { path: '/admin/agent-registry', name: 'Prompt 运营中心（Agent Registry）' },
  { path: '/admin/orchestrator-registry', name: '编排配置中心' },
  { path: '/admin/orchestrator-definitions', name: '编排定义' },
  { path: '/admin/skill-manager', name: 'Skill 管理中心' },
  // devDebug / test 组
  { path: '/admin/skill-prompt-preview', name: 'Skill Prompt 预览' },
  { path: '/admin/virtual-learners', name: '虚拟用户模拟' },
  // monitor 组
  { path: '/admin/execution-logs', name: 'Agent 执行日志' },
  { path: '/admin/prompt-call-logs', name: 'Prompt 调用日志' },
  { path: '/admin/orchestrators', name: '编排运行监控' },
  { path: '/admin/manifest-diagnostics', name: 'Agent 架构诊断' },
  { path: '/admin/activity-stream', name: '活动流' },
]

test('Admin 全面功能检查', async ({ page }) => {
  console.log('\n🚀 开始 Admin 全面功能检查\n')

  await check(page, '登录', async () => {
    const ok = await login(page)
    await shot(page, '01-login')
    return ok
  })

  if (!checkpoints[0].status.includes('✅')) {
    errors.forEach(e => console.error(e))
    return
  }

  for (const p of adminPages) {
    await check(page, p.name, async () => {
      const resp = await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(3000)
      await shot(page, p.name)
      const body = await page.textContent('body').catch(() => '')
      const statusCode = resp?.status() || 0
      const hasJsError = await page.evaluate(() => (window as any).__vite_error__ ? true : false).catch(() => false)
      if (statusCode >= 400) throw new Error(`HTTP ${statusCode}`)
      if (hasJsError) throw new Error('Vite error overlay detected')
      if (body.length < 50 && body.includes('Login')) throw new Error('Redirected to login page')
      return true
    })
  }

  // 如果有 Skill 数据，检查展开详情
  const skillPage = checkpoints.find(c => c.name === 'Skill 管理中心')
  if (skillPage?.status.includes('✅')) {
    await check(page, 'Skill 详情抽屉', async () => {
      const card = await page.$('.skill-card')
      if (!card) {
        console.log('  ↪ 无 Skill 卡片可点击')
        return false
      }
      await card.click()
      await page.waitForTimeout(2000)
      await shot(page, 'Skill-drawer')
      const drawer = await page.$('.el-drawer')
      return drawer !== null
    })
  }

  // 检查 Prompt 运营中心 → 点击查看详情
  const agentPage = checkpoints.find(c => c.name.includes('Prompt 运营中心'))
  if (agentPage?.status.includes('✅')) {
    await check(page, 'Agent Registry 详情查看', async () => {
      // 尝试选中一个 agent
      const agentRow = await page.$('.agent-row, .el-table__row, .agent-item')
      if (!agentRow) {
        console.log('  ↪ 无 Agent 条目可点击')
        return false
      }
      await agentRow.click()
      await page.waitForTimeout(2000)
      await shot(page, 'Agent-detail')
      return true
    })
  }

  // 报告
  const report = {
    timestamp: new Date().toISOString(),
    testName: 'Admin 全面功能检查',
    total: checkpoints.length,
    passed: checkpoints.filter(c => c.status === '✅').length,
    warnings: checkpoints.filter(c => c.status === '⚠️').length,
    failed: checkpoints.filter(c => c.status === '❌').length,
    checkpoints, errors, screenshots,
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 Admin 检查报告: ${report.passed}/${report.total} 通过, ${report.warnings} 警告, ${report.failed} 失败`)
  checkpoints.forEach(c => console.log(`  ${c.status} ${c.name}: ${c.detail}`))
  if (errors.length) console.log(`\n❌ 错误:\n${errors.join('\n')}`)
  console.log(`${'='.repeat(60)}`)
})
