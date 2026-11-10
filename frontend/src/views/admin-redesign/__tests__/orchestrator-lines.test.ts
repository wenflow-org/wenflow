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

  it('两端锚点都落在列头标题框：本列标题出发，汇入下一列标题框（不随内容带拉伸）', () => {
    // 2026-10-31 外部评审拍板：原「汇入下一组内容带中点」在末列很长时把曲线拽成大斜线；
    // 起止固定连向每列顶部的标题框后，各列头等高、连线平行（取代 2026-10-24 的组中点方案）
    expect(OrchestratorSource).not.toContain('const groupMidY')
    expect(OrchestratorSource).toContain('const y1 = headMidY(a)')
    expect(OrchestratorSource).toContain('const y2 = headMidY(b)')
    // 旧实现（拉伸后的列中点）不得回潮：中点会落在列底空白里
    expect(OrchestratorSource).not.toContain('a.offsetTop + Math.round(a.offsetHeight / 2)')
  })

  it('连线是曲线而不是横杠（2026-10-24 用户「箭头之前是曲线，更好看」）', () => {
    // 三次贝塞尔：两端控制点都在水平切线上，起止都不歪，纵向落差在跨列间隙里完成
    expect(OrchestratorSource).not.toMatch(/orch-odg-edge[\s\S]{0,80}`M\$\{x1\} \$\{y1\} L\$\{x2\} \$\{y2\}`/)
    expect(OrchestratorSource).toContain('`M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`')
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

  it('阶段内三枚页签并列：字段旅程不再靠「再点一次阶段页签」回程（2026-10-26 评审）', () => {
    expect(OrchestratorSource).toContain("{ id: 'journey', label: '字段旅程' }")
    // 回程特殊分支已删：点当前阶段页签与点别的阶段同一条路径
    expect(OrchestratorSource).not.toContain("pane.value !== 'overview' && active.value === id")
    // SkillFieldRouting 的「→ 编排图页」用 ?tab=routing，与白名单同词
    expect(OrchestratorSource).toContain("qTab === 'field-routings'")
  })

  it('字段契约失败可分辨、可重试：列脚显红字「未加载」，卡头给重试（2026-10-26 评审）', () => {
    // 失败与「加载中 …」必须两态可分辨；重试入口接回同一加载器
    expect(OrchestratorSource).toContain('orch-odg-chip--failed')
    expect(OrchestratorSource).toContain('function contractCountText')
    expect(OrchestratorSource).toContain("if (c.failed) return '未加载'")
    expect(OrchestratorSource).toContain('async function retryStageContracts')
    expect(OrchestratorSource).toContain('@click="retryStageContracts"')
    // 卡头两枚图例 chip（阶段入参 / 阶段产出）与列脚同形，已撤
    expect(OrchestratorSource).not.toContain('>阶段入参</span>')
    expect(OrchestratorSource).not.toContain('>阶段产出</span>')
  })
})
