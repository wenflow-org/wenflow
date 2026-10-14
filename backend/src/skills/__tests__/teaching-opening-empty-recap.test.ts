/**
 * teaching-opening-generator 空数据承接出路（P1-9，2026-10-06 审计 §2.1）
 *
 * 规则曾强制「message 必须先承接上节卡住点/检索题/未答问题」，但 P1-8 素材 129/129 全空，
 * 模型在 recap 全空下把任务标题外推为已完成事实。本测试钉住：yaml 规则与编译 md 都给出
 * **空数据出路**——素材平淡（只有任务名/主题）时不必硬承接、只中性带过，禁止断言完成/掌握。
 *
 * 2026-10-14 开场形态自由化（用户纠偏「不要课课同构」）后规则措辞重写：原「必须先承接」
 * 改为「不要求放开头、也不要求每课都承接」。本测试断言随之对齐新措辞，守的仍是同一件事。
 */
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

const ROOT = path.resolve(__dirname, '../../../../')
const YAML_PATH = path.join(ROOT, 'prompts/core/teaching-opening-generator.yaml')
const MD_PATH = path.join(ROOT, 'prompts/skill.teaching-opening-generator.md')

describe('teaching-opening-generator 空数据承接出路（P1-9）', () => {
  const yamlText = fs.readFileSync(YAML_PATH, 'utf8')
  const mdText = fs.readFileSync(MD_PATH, 'utf8')
  const doc = yaml.load(yamlText) as { rules: string[] }

  it('yaml 规则给出空数据出路：素材平淡不必硬承接 + 禁止断言完成/掌握', () => {
    const rules = doc.rules.join('\n')
    expect(rules).toContain('不必硬承接')
    expect(rules).toContain('不得断言上次已完成')
    expect(rules).toContain('不得从任务标题外推出成就')
    expect(rules).toContain('中性带过')
  })

  it('编译 md 同样带上空数据出路（重编译已落地）', () => {
    expect(mdText).toContain('不必硬承接')
    expect(mdText).toContain('不得断言上次已完成')
    expect(mdText).toContain('不得从任务标题外推出成就')
  })
})

// 本文件无 import/export：声明为模块，避免 ts-jest --runInBand 单进程下与同目录
// 其他全局脚本测试的顶层 const 声明互相重声明（TS2451）
export {}