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
  /* 2026-11-01 校正：原实现走用户登录页 `${BASE}/login` 的「请输入用户名 / 登录并继续」——
   * 那是**用户侧**表单，且文案早已改动，于是 fill 永远等不到元素、整条巡检卡在登录超时。
   * 管理台是独立的 /admin/login。凭据只从环境变量取（仓库里不写明文密码）：
   *   ADMIN_USER / ADMIN_PASSWORD（默认账号 admin，密码必须显式提供）。 */
  const user = process.env.ADMIN_USER || 'admin'
  const pass = process.env.ADMIN_PASSWORD
  if (!pass) {
    throw new Error('缺少 ADMIN_PASSWORD 环境变量：管理台巡检需要真实管理员凭据（未内置明文密码）')
  }
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.locator('input[placeholder*="管理员账号"]').fill(user)
  await page.locator('input[placeholder*="密码"]').fill(pass)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL((url) => !url.pathname.includes('/admin/login'), { timeout: 20000 })
  return !page.url().includes('/admin/login')
}

// 所有实际存在的 Admin 路由
/* 2026-11-01 校正：原清单 17 条里有 12 条指向**已不存在的页面**
 * （/admin/dashboard、/admin/learner-models、/admin/platform-capabilities、/admin/agent-registry、
 * /admin/orchestrator-registry、/admin/orchestrator-definitions、/admin/skill-manager、
 * /admin/skill-prompt-preview、/admin/prompt-call-logs、/admin/orchestrators、
 * /admin/manifest-diagnostics、/admin/activity-stream）。
 * /admin/:page? 会把未知 id 兜住并回退总览，所以这些路径不会 404，而是**安静地渲染总览**——
 * 巡检照样打勾。现改为以 frontend/src/views/admin-redesign/manifest.ts 为准的真实场景清单。 */
const adminPages = [
  { path: '/admin/overview', name: '平台总览' },
  { path: '/admin/ops-hub', name: '运营中心' },
  { path: '/admin/people', name: '用户账号' },
  { path: '/admin/api-config', name: '模型与接入' },
  { path: '/admin/goal-conversations', name: '目标对话' },
  { path: '/admin/learning-paths', name: '学习路径' },
  { path: '/admin/teaching-sessions', name: '教学会话' },
  { path: '/admin/learner-state', name: '学习状态' },
  { path: '/admin/memory-review', name: '复习积压' },
  { path: '/admin/virtual-learners', name: '虚拟学习者' },
  { path: '/admin/virtual-learner-cards', name: '学习者卡库' },
  { path: '/admin/orchestrator', name: '字段流转' },
  { path: '/admin/skills', name: 'Skill 目录' },
  { path: '/admin/prompt-eval', name: 'Prompt 评估' },
  { path: '/admin/addons', name: '插件' },
  { path: '/admin/execution-logs', name: '执行日志' },
  { path: '/admin/audit-logs', name: '审计日志' },
  { path: '/admin/token-cost', name: '成本分析' },
  { path: '/admin/health-center', name: '健康中心' },
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
    /* 2026-11-01 修复「失败即通过」：原实现登录失败时直接 return，而本文件**没有任何断言**，
     * 于是 Playwright 判 passed——登录挂了也显示绿灯（上面 10.5s 就"通过"、19 个页面一个没走，
     * 正是这个原因）。巡检类脚本必须让失败真的失败。 */
    throw new Error(`登录失败，巡检未执行：${checkpoints[0].detail}`)
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
      /* 2026-11-01 补强（假绿灯）：只查 HTTP 200 抓不到「未知 id 被兜底回总览」——
       * /admin/:page? 会接住任何 id 并静默回退 overview，HTTP 依然是 200。
       * 改为断言 URL 没有被改写到 /admin/overview（除 overview 自身）。 */
      const scene = p.path.replace('/admin/', '')
      const url = page.url()
      const fellBack = url.includes('/admin/overview') && !p.path.endsWith('/overview')
      if (fellBack) throw new Error(`被兜底回总览（未知场景 id「${scene}」？）`)
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
