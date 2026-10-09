/**
 * teaching-opening-generator 空数据承接出路（P1-9，2026-10-06 审计 §2.1）
 *
 * 规则 9/10 强制「message 必须先承接上节卡住点/检索题/未答问题」，但由 P1-8 这些素材
 * 129/129 全空，模型在 recap 全空下把任务标题外推为已完成事实（pcl_b3ce4a85 编造
 * 「上次你写出了让父母自己挑第一件的开场说法」）。本测试钉住：yaml 规则 9/10 与编译 md
 * 都给出**空数据出路**——只中性提一句任务名、禁止断言完成/掌握。
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

  it('yaml 规则 9/10 给出空数据出路：中性提任务名 + 禁止断言完成/掌握', () => {
    const rules = doc.rules.join('\n')
    expect(rules).toContain('只中性提一句上次任务名')
    expect(rules).toContain('不得断言上次已完成')
    expect(rules).toContain('不得从任务标题外推出成就')
    // 承接仍要求「先承接」——但只在素材真实给出时
    expect(rules).toContain('必须先承接')
  })

  it('编译 md 规则 9/10 同样带上空数据出路（重编译已落地）', () => {
    expect(mdText).toContain('只中性提一句上次任务名')
    expect(mdText).toContain('不得断言上次已完成')
    expect(mdText).toContain('不得从任务标题外推出成就')
  })
})

// 本文件无 import/export：声明为模块，避免 ts-jest --runInBand 单进程下与同目录
// 其他全局脚本测试的顶层 const 声明互相重声明（TS2451）
export {}