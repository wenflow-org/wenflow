/**
 * 覆盖层行为不变量（2026-10-21 交互走查）：
 * 每个带 `.mk-modal` 遮罩的组件都必须接上三件套——
 * - `useOverlay`：打开时锁背景滚动、aria-modal、焦点进面板、Tab 焦点陷阱、关闭后回焦触发元素
 * - `useEscape`：Esc 关闭（全局 LIFO 栈，只关最上面那一层）
 * - `useMaskClose`：遮罩按下并松开才关（选中文本拖到遮罩松手不会误关）
 * 缺任何一件都会退化成「焦点留在背景页 / Esc 关不掉 / 点遮罩无反应或误关」。
 * 新增弹层时本测试会直接失败，提醒接线。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const srcRoot = resolve(__dirname, '../../../..')

function vueFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) vueFiles(full, out)
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

const modalFiles = vueFiles(srcRoot).filter((f) => readFileSync(f, 'utf-8').includes('class="mk-modal'))

describe('覆盖层三件套接线', () => {
  it('扫描范围非空（遮罩组件都在这棵树下）', () => {
    expect(modalFiles.length).toBeGreaterThan(10)
  })

  it('每个带遮罩的组件都接了 useOverlay / useEscape / useMaskClose', () => {
    const missing: string[] = []
    for (const file of modalFiles) {
      const src = readFileSync(file, 'utf-8')
      const lacks = ['useOverlay(', 'useEscape(', 'useMaskClose('].filter((hook) => !src.includes(hook))
      if (lacks.length) missing.push(`${file.replace(srcRoot, '')} 缺 ${lacks.join(' / ')}`)
    }
    expect(missing).toEqual([])
  })
})

describe('页签行键盘契约', () => {
  it('每个 role="tablist" 都挂了 @keydown（方向键切换）+ 页签自身走 roving tabindex', () => {
    const offenders: string[] = []
    for (const file of vueFiles(srcRoot)) {
      const src = readFileSync(file, 'utf-8')
      const lists = [...src.matchAll(/role="tablist"([^<>]*)/g)]
      if (!lists.length) continue
      for (const m of lists) {
        if (!m[1].includes('@keydown')) offenders.push(`${file.replace(srcRoot, '')}：tablist 没有 @keydown`)
      }
      // 至少有一处 tabindex 绑定（要么 :tabindex 要么 MkSubTabs 内部实现），
      // 否则整行 N 个页签各占一个 Tab 位、方向键也没有落点
      if (!src.includes(':tabindex') && !src.includes('MkSubTabs')) {
        offenders.push(`${file.replace(srcRoot, '')}：页签没有 roving tabindex`)
      }
    }
    expect(offenders).toEqual([])
  })
})
