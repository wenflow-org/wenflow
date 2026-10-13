/**
 * 数据流水线模型单测：用运行时抓取的真实字段路由矩阵驱动，
 * 验证「入口 / 出口 / 步骤 / 内部边」推导与编排文件语义一致（File-as-Truth 投影）。
 */
import { describe, expect, it } from 'vitest'
import { buildStageFlow, familyOf, familyHue } from '../dataFlow'
import { fixtureDetails } from './fixture-details'
// ?raw 读源码：缩放接线断言（视口/内容层分工、量测坐标基准）对源文本做白盒校验
import DataFlowGraphSource from '../DataFlowGraph.vue?raw'

const detailsById = fixtureDetails as Record<string, unknown>
const stageNames = { goal: 'Goal 阶段', path: 'Path 阶段', teaching: '教学阶段' }

const flowOf = (s: string) =>
  buildStageFlow(
    s,
    (detailsById as any)[s],
    detailsById as any,
    s === 'path'
      ? [
          { step: 1, agentId: 'PathCoordinator.buildFramedNormalizedInput', role: 'input-framing', condition: 'when goal handoff received', resolved: { displayName: 'PathCoordinator.buildFramedNormalizedInput', kind: 'service' } },
          { step: 2, agentId: 'skill:path-planning', role: 'cognitive-core-and-milestones', resolved: { displayName: '路径规划 Skill', kind: 'skill' } },
          { step: 3, agentId: 'skill:stage-designer', role: 'stage-task-expansion', loopOver: 'milestones', resolved: { displayName: '阶段设计 Skill', kind: 'skill' } },
        ]
      : [],
    stageNames,
  )

describe('familyOf / familyHue', () => {
  it('取 fieldId 首段为数据族，无点号整体为族', () => {
    expect(familyOf('cognitiveCore.cognitiveDomain')).toBe('cognitiveCore')
    expect(familyOf('personaSeed')).toBe('personaSeed')
  })
  it('同一数据族颜色稳定', () => {
    expect(familyHue('cognitiveCore')).toBe(familyHue('cognitiveCore'))
    expect(familyHue('milestones')).toBe(familyHue('milestones'))
  })
})

describe('goal 阶段（链首：无入口，出口 24 字段 → path）', () => {
  const f = flowOf('goal')
  it('fieldCount 与真实定义一致（31）', () => {
    expect(f.fieldCount).toBe(31)
  })
  it('无上游入口；出口字段全部交接给 path', () => {
    expect(f.entry).toHaveLength(0)
    expect(f.exit.length).toBeGreaterThan(0)
    expect(f.exit.every((c) => c.handoffTargets.includes('path'))).toBe(true)
  })
  it('步骤含 goal-conversation（编排定义步骤）', () => {
    const skill = f.steps.find((s) => s.agentId === 'skill:goal-conversation')
    expect(skill).toBeTruthy()
  })
})

describe('path 阶段（入口 24 字段；闸口分发 normalizedInput；内部边 path-planning→stage-designer）', () => {
  const f = flowOf('path')
  it('入口 = goal 阶段交接字段（无过滤）', () => {
    expect(f.entry.length).toBeGreaterThan(0)
    expect(f.entryFrom?.stageId).toBe('goal')
  })
  it('桥接闸口步骤包含分发字段（normalizedInput.* → skills），不含跨阶段出口字段', () => {
    const gate = f.steps.find((s) => s.kind === 'bridge-entry')
    expect(gate).toBeTruthy()
    expect(gate!.outputs.some((c) => c.family === 'normalizedInput')).toBe(true)
    // 闸口分发字段的去向标签 = 内部 skill
    const dist = gate!.outputs.find((c) => c.family === 'normalizedInput')!
    expect(dist.toTags.some((t) => t.kind === 'skill')).toBe(true)
    // 跨阶段字段（milestones.goal → teaching）不属于闸口分发，进出口卡
    expect(gate!.outputs.some((c) => c.fieldId === 'milestones.goal')).toBe(false)
    expect(f.exit.some((c) => c.fieldId === 'milestones.goal')).toBe(true)
  })
  it('步骤顺序 = defSteps：闸口 → path-planning → stage-designer', () => {
    const order = f.steps.map((s) => s.agentId)
    expect(order.indexOf('path-agent')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('skill:path-planning')).toBeGreaterThan(order.indexOf('path-agent'))
    expect(order.indexOf('skill:stage-designer')).toBeGreaterThan(order.indexOf('skill:path-planning'))
  })
  it('path-planning 产出 cognitiveCore.* 且其 handoff 指向 stage-designer → 内部边', () => {
    const pp = f.steps.find((s) => s.agentId === 'skill:path-planning')!
    expect(pp.outputs.some((c) => c.fieldId === 'cognitiveCore.cognitiveDomain')).toBe(true)
    const internal = f.edges.filter((e) => e.kind === 'internal')
    expect(internal.length).toBeGreaterThan(0)
  })
  it('stage-designer 的输入包含 path-planning 移交字段（里程碑/认知核心）', () => {
    const sd = f.steps.find((s) => s.agentId === 'skill:stage-designer')!
    expect(sd.inputs.some((c) => c.fieldId === 'milestones.goal')).toBe(true)
    expect(sd.inputs.some((c) => c.fieldId === 'cognitiveCore.cognitiveDomain')).toBe(true)
  })
  it('出口 = 桥接 agent 交接 teaching 的字段（milestones/path/subtasks）', () => {
    expect(f.exitTo?.stageId).toBe('teaching')
    const ids = f.exit.map((c) => c.fieldId)
    expect(ids).toContain('milestones.goal')
    expect(ids).toContain('path.name')
    expect(ids).toContain('subtasks.acceptanceCriteria')
  })
  it('服务步骤如实标注（代码服务，无字段契约）', () => {
    const svc = f.steps.find((s) => s.agentId === 'PathCoordinator.buildFramedNormalizedInput')
    expect(svc).toBeTruthy()
    expect(svc!.kind).toBe('service')
    expect(svc!.outputs).toHaveLength(0)
  })
  it('orphan 步骤：已注册 agent 但无字段契约（0 routing 行 + 不在 defSteps）→ kind=orphan', () => {
    if (f.steps.some((s) => s.agentId === 'skill:kc-mapper')) {
      const o = f.steps.find((s) => s.agentId === 'skill:kc-mapper')!
      expect(o.kind).toBe('orphan')
      expect(o.outputs).toHaveLength(0)
      expect(o.inputs).toHaveLength(0)
    } else {
      // fixture 无 orphan 时：确认 model 类型可表达且普通 skill 不受影响
      const pp = f.steps.find((s) => s.agentId === 'skill:path-planning')!
      expect(pp.kind).toBe('skill')
      expect(pp.outputs.length).toBeGreaterThan(0)
    }
  })
})

describe('teaching 阶段（入口 path 交接；teaching-turn 输入来自闸口分发；内部边 teaching-turn→peer-reinforcement）', () => {
  const f = flowOf('teaching')
  it('入口来自 path 阶段', () => {
    expect(f.entryFrom?.stageId).toBe('path')
    expect(f.entry.length).toBeGreaterThan(0)
  })
  it('teaching-turn 输入含闸口分发的 classroomContext（内部）', () => {
    const tt = f.steps.find((s) => s.agentId === 'skill:teaching-turn')!
    expect(tt.inputs.some((c) => c.fieldId === 'classroomContext')).toBe(true)
    // 闸口同样不混入 analysis.*（这些字段走 teaching-agent → profile 出口）
    const gate = f.steps.find((s) => s.kind === 'bridge-entry')!
    expect(gate.outputs.some((c) => c.fieldId === 'analysis.confusionPoints')).toBe(false)
  })
  it('control.shouldTriggerPeer → peer-reinforcement 内部边', () => {
    const pr = f.steps.find((s) => s.agentId === 'skill:peer-reinforcement')
    expect(pr).toBeTruthy()
    expect(
      f.edges.some((e) => e.kind === 'internal' && e.fieldId === 'control.shouldTriggerPeer'),
    ).toBe(true)
  })
})

describe('数据族', () => {
  it('数据族清单按字段数降序', () => {
    const fams = flowOf('path').families
    expect(fams.length).toBeGreaterThan(0)
    for (let i = 1; i < fams.length; i++) {
      expect(fams[i - 1].count).toBeGreaterThanOrEqual(fams[i].count)
    }
  })
})

/** 类型导出冒烟：StageFlow 可由模型产出 */
it('类型导出', () => {
  const f: import('../dataFlow').StageFlow = flowOf('path')
  expect(f.stageId).toBe('path')
})

describe('字段旅程画布缩放接线（2026-10-13 用户：这里也要支持缩放）', () => {
  it('视口与内容层分开：zoom 在内容层、滚动在视口；宽度由 JS 给基准宽 px', () => {
    // 两者必须分开：直接 zoom 滚动容器会让视口跟着内容一起放大，永远没有可平移的余量
    expect(DataFlowGraphSource).toContain('ref="viewRef"')
    expect(DataFlowGraphSource).toContain('class="dfg-view"')
    expect(DataFlowGraphSource).toContain(':style="dfgZoomStyle"')
    expect(DataFlowGraphSource).toContain('zoom: String(dfgZoom.value)')
    expect(DataFlowGraphSource).toContain('width: dfgBaseW.value ?')
    // 视口宽必须显式给满 + 滚动条槽位常驻：margin:0 auto 会让交叉轴失去 stretch，
    // 宽度跟内容缩；滚动条出现/消失会让「基准宽 = clientWidth」抖
    expect(DataFlowGraphSource).toContain('scrollbar-gutter: stable')
    expect(DataFlowGraphSource).toContain('width: 100%;')
  })

  it('内容整体居中（2026-10-13 用户：默认在左上角，希望视觉居中）：视口 flex + 内容层 margin:auto', () => {
    // 视口 flex 化，内容层用 margin:auto 吃余量：居中与「溢出时从左上角起滚」两者都要成立
    // （justify-content:center 会把溢出内容的开头裁掉，故不用）
    expect(DataFlowGraphSource).toContain('display: flex;')
    expect(DataFlowGraphSource).toContain('margin: auto;')
    // flex 子项默认 flex-shrink:1 会为塞进视口而压缩内容层 → 放大压不出滚动条，必须 flex:none
    expect(DataFlowGraphSource).toContain('flex: none;')
  })

  it('滚轮直缩 + 拖动平移；量测基准与 SVG 同在层自有坐标（÷zoom，且不再加滚动量）', () => {
    expect(DataFlowGraphSource).toContain('@wheel.prevent="onDfgWheelZoom"')
    expect(DataFlowGraphSource).not.toContain('DFG_ZOOM_STEP')
    expect(DataFlowGraphSource).toContain('@pointerdown="onDfgPointerDown"')
    expect(DataFlowGraphSource).toContain('@click.capture="onDfgClickCapture"')
    expect(DataFlowGraphSource).toContain('DFG_ZOOM_WHEEL_K')
    // 层自有坐标：rect 差值 ÷zoom（层随滚动移动，差值已含滚动量，再加一次就是双计）
    expect(DataFlowGraphSource).toContain('pipeW.value = rr.width / z')
    expect(DataFlowGraphSource).not.toContain('view.scrollLeft / z')
    // 布局未落地前量到的是中间态：等到层自有宽 === 基准宽再画
    expect(DataFlowGraphSource).toContain('Math.abs(rr.width / z - dfgBaseW.value) > 1')
  })

  it('对端跳转收在入口/出口卡题上：卡题即「切到对端阶段」，与卡本身同色调', () => {
    // 2026-10-13 删掉顶部「配合头」概览条——它与这两张卡是同一条事实的复读；
    // 唯一不能丢的能力=切到对端，收进卡题（.dfg-gate__src 按钮）。
    expect(DataFlowGraphSource).toContain('class="dfg-gate__src"')
    expect(DataFlowGraphSource).toContain('@click="switchStage(flow.entryFrom!.stageId)"')
    expect(DataFlowGraphSource).toContain('@click="switchStage(flow.exitTo!.stageId)"')
    // 对端是谁：title 里带 stageName + `<stageId>-agent`
    expect(DataFlowGraphSource).toContain('${flow.entryFrom?.stageId}-agent')
    expect(DataFlowGraphSource).toContain('${flow.exitTo?.stageId}-agent')
    // 同色调配对：卡身 --hz = 对端阶段色（与对面那张卡同源）
    expect(DataFlowGraphSource).toContain("'--hz': toneOf(flow.entryFrom?.stageId || '').hue")
    expect(DataFlowGraphSource).toContain("'--hz': toneOf(flow.exitTo?.stageId || '').hue")
    // 顶部概览条整套（模板 + 样式 + 暗色档 border 覆盖）彻底退役
    expect(DataFlowGraphSource).not.toContain('dfg-journey')
  })

  it('三段并列（上游 | 本阶段 | 下游）：列容器 + 连线按列自适配 + 容器查询折档', () => {
    // 三列：上下游两列按内容定宽、本阶段列吃剩余；窄档折回单列栈（列容器 display: contents）
    expect(DataFlowGraphSource).toContain('class="dfg-cols"')
    expect(DataFlowGraphSource).toContain('class="dfg-col dfg-col--up"')
    expect(DataFlowGraphSource).toContain('class="dfg-col dfg-col--main"')
    expect(DataFlowGraphSource).toContain('class="dfg-col dfg-col--down"')
    // 折档判据 = 容器宽度，不是视口宽度（面板宽随侧栏展开/折叠差 220px）
    expect(DataFlowGraphSource).toContain('container-type: inline-size')
    expect(DataFlowGraphSource).toContain('@container (max-width: 1100px)')
    expect(DataFlowGraphSource).not.toContain('@media (max-width: 1180px)')
    // 连线分派：同列 → 右走廊 Bus；跨列 → 源右缘到目标左缘的水平贝塞尔（箭头朝卡内）
    expect(DataFlowGraphSource).toContain('const sameCol = Math.abs(srcCard.left - dstCard.left) < 2')
    expect(DataFlowGraphSource).toContain('const dstAnchorLeft = !sameCol && dstIsRight')
    // far 只对同列成立：跨列边线不该被「纵向跨度大」降级成端口徽标
    expect(DataFlowGraphSource).toContain('const mode: EdgeMode = sameCol && spanY > FAR_SPAN ? \'far\' : \'near\'')
    // 本阶段列封顶 + 整组居中（2026-10-13 用户：步骤卡「不那么宽，高一些」）——
    // 无上限的 flex-grow 会把单卡拉成 1064px 扁条，芯片只铺 3 行
    expect(DataFlowGraphSource).toContain('.dfg-col--main { flex: 1 1 520px; max-width: 720px; }')
    expect(DataFlowGraphSource).toContain('justify-content: center;')
  })
})
