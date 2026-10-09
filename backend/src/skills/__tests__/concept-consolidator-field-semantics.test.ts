/**
 * concept-consolidator 契约字段语义（P1-17 选项①，2026-10-06 审计 §2.1）
 *
 * 代码向 LLM 注入 canonicalWhitelist/aliasMap，但 yaml（rules/fields/constraints 全文）
 * 对二者零定义——模型当场编造语义并当作裁决依据（pcl_8b696598 自述「canonicalWhitelist 为空…
 * 没有可依据的标准名」）。本测试钉住：① yaml 与编译 md 都对两个字段有语义定义；
 * ② 字段确实仍在 payload（选项①保留字段而非删除）。
 */
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

const ROOT = path.resolve(__dirname, '../../../../')
const YAML_PATH = path.join(ROOT, 'prompts/core/concept-consolidator.yaml')
const MD_PATH = path.join(ROOT, 'prompts/skill.concept-consolidator.md')

describe('concept-consolidator 契约字段语义（P1-17）', () => {
  const yamlText = fs.readFileSync(YAML_PATH, 'utf8')
  const mdText = fs.readFileSync(MD_PATH, 'utf8')
  const doc = yaml.load(yamlText) as { rules: string[] }

  it('yaml rules 定义 canonicalWhitelist 与 aliasMap 的语义', () => {
    const rules = doc.rules.join('\n')
    expect(rules).toContain('canonicalWhitelist')
    expect(rules).toContain('aliasMap')
    // 语义要点：whitelist = 上轮待办规范键；aliasMap = 别名→规范名映射
    expect(rules).toContain('待办规范键')
    expect(rules).toContain('别名')
    expect(rules).toContain('规范名')
  })

  it('编译 md 同样带上两个字段的语义（重编译已落地，不漂移）', () => {
    expect(mdText).toContain('canonicalWhitelist')
    expect(mdText).toContain('aliasMap')
    expect(mdText).toContain('待办规范键')
  })
})

// 本文件无 import/export：声明为模块，避免 ts-jest --runInBand 单进程下与同目录
// 其他全局脚本测试（teaching-opening-empty-recap.test.ts）的 const fs/path 顶层声明互相重声明（TS2451）
export {}