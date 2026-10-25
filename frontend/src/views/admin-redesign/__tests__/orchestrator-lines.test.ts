/**
 * 编排图连线几何（2026-10-21 用户「线的位置不对 错位 1080视觉检查」）：
 * 真因不是坐标算错，而是 main.css 给所有 svg 的全局 `max-width: 100%`——窄档画布容器
 * 只有 770px，连线层语言宽 1172，整张 SVG 被等比缩到 65.7% 并按 preserveAspectRatio
 * 垂直居中（实测 y=19 被画到 415.5），四条线整体上移、端点落在卡片之间的空白里。
 * 另一条：锚点原本取整列垂直中点，列高随 Skill 条数 148→852 不等，箭头会停在两张卡之间。
 * 这里用源码断言锁两件事，几何本身由浏览器脚本 verify-orch-lines.mjs 复核。
 */
import { describe, expect, it } from 'vitest'
import OrchestratorSource from '../Orchestrator.vue?raw'
import DataFlowGraphSource from '../DataFlowGraph.vue?raw'

describe('编排图连线', () => {
  it('连线层不吃全局 max-width：画布溢出交给滚动区，SVG 不能被容器夹窄', () => {
    expect(OrchestratorSource).toMatch(/\.orch-odg-svg\s*\{[^}]*max-width:\s*none/)
    expect(DataFlowGraphSource).toMatch(/\.dfg-edges\s*\{[^}]*max-width:\s*none/)
  })

  it('锚点落在阶段头中线，不再取整列垂直中点', () => {
    expect(OrchestratorSource).toContain("querySelector<HTMLElement>('.orch-odg-colhead')")
    expect(OrchestratorSource).toContain('ha.offsetHeight')
    // 旧实现（列高中点）不得回潮：列高差异越大，箭头越会停在卡片之间的空白
    expect(OrchestratorSource).not.toContain('a.offsetTop + Math.round(a.offsetHeight / 2)')
  })

  it('两端同高时画直线（阶段头对齐 → 四条线水平），不同高才退贝塞尔', () => {
    expect(OrchestratorSource).toContain('`M${x1} ${y1} L${x2} ${y2}`')
    expect(OrchestratorSource).toContain("Math.abs(y2 - y1) < 1")
  })

  it('阶段头单行：名称不折、agent id 省略，避免各列头高不一致把锚点拉斜', () => {
    expect(OrchestratorSource).toMatch(/\.orch-odg-colname\s*\{[^}]*white-space:\s*nowrap/)
    expect(OrchestratorSource).toMatch(/\.orch-odg-agent\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(OrchestratorSource).toContain(':title="s.agentId"')
  })

  it('列脚跟着本组走：不压到列底（2026-10-24 用户「怎么固定底部了」）', () => {
    // margin-top:auto + body flex-grow 会把字段行推到整屏下方，和所属阶段脱开
    expect(OrchestratorSource).not.toMatch(/\.orch-odg-foot\s*\{[^}]*margin-top:\s*auto/)
    expect(OrchestratorSource).not.toMatch(/\.orch-odg-body\s*\{[^}]*flex:\s*1 1 auto/)
  })
})
