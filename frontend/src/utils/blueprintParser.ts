/**
 * YAML 蓝图加载工具
 * 用于加载 blueprints/*.yaml 文件
 */

import * as yaml from 'js-yaml'
import type { YamlBlueprint } from '@/types/blueprint'

// 旧的类型定义（保持向后兼容）
export interface BlueprintField {
  id: string
  title: string
  content: string
  order: number
  deletable: boolean
}

export interface BlueprintMeta {
  blueprintId: string
  skillId: string
  archetype: string
  name: string
  description: string
  version: string
  temperature?: number
  maxTokens?: number
  [key: string]: any
}

export interface BlueprintSchema {
  input: any[]
  output: any[]
}

export interface ParsedBlueprint {
  meta: BlueprintMeta
  fields: BlueprintField[]
  schema: BlueprintSchema
}

/**
 * 加载 YAML 蓝图（新版）
 */
export async function loadYamlBlueprint(blueprintId: string): Promise<YamlBlueprint> {
  const yamlResponse = await fetch(`/prompt-lab/blueprints/${blueprintId}.yaml`)
  if (!yamlResponse.ok) {
    throw new Error(`Failed to load YAML blueprint: ${blueprintId}`)
  }
  
  const yamlText = await yamlResponse.text()
  const blueprint = yaml.load(yamlText) as YamlBlueprint
  
  return blueprint
}

/**
 * 保存 YAML 蓝图
 */
export function serializeYamlBlueprint(blueprint: YamlBlueprint): string {
  return yaml.dump(blueprint, {
    indent: 2,
    lineWidth: 100,
    noRefs: true
  })
}

/**
 * 加载并解析蓝本（旧版，保持向后兼容）
 * @deprecated 使用 loadYamlBlueprint 代替
 */
export async function loadBlueprint(blueprintId: string): Promise<ParsedBlueprint> {
  // 尝试加载 YAML 蓝图
  try {
    const yamlBlueprint = await loadYamlBlueprint(blueprintId)
    
    // 转换为旧格式（用于兼容现有代码）
    return convertYamlToLegacy(yamlBlueprint)
  } catch (yamlError) {
    // 如果 YAML 不存在，回退到旧的 Markdown 格式
    console.warn('YAML blueprint not found, falling back to legacy Markdown format')
    return loadLegacyMarkdownBlueprint(blueprintId)
  }
}

/**
 * 加载旧版 Markdown 蓝本（向后兼容）
 */
async function loadLegacyMarkdownBlueprint(blueprintId: string): Promise<ParsedBlueprint> {
  const mdResponse = await fetch(`/prompt-lab/blueprint.${blueprintId}.md`)
  if (!mdResponse.ok) {
    throw new Error(`Failed to load legacy blueprint: ${blueprintId}`)
  }
  const mdContent = await mdResponse.text()

  const schemaResponse = await fetch(`/prompt-lab/blueprint.${blueprintId}.schema.json`)
  if (!schemaResponse.ok) {
    throw new Error(`Failed to load blueprint schema: ${blueprintId}`)
  }
  const schema: BlueprintSchema = await schemaResponse.json()

  const { meta, body } = parseLegacyFrontmatter(mdContent)
  const fields = parseLegacyFields(body)

  return {
    meta,
    fields,
    schema
  }
}

/**
 * 转换 YAML 蓝图为旧格式（向后兼容）
 */
function convertYamlToLegacy(yamlBlueprint: YamlBlueprint): ParsedBlueprint {
  return {
    meta: {
      blueprintId: yamlBlueprint.blueprintId,
      skillId: yamlBlueprint.blueprintId,
      archetype: yamlBlueprint.archetype,
      name: yamlBlueprint.name,
      description: yamlBlueprint.name,
      version: yamlBlueprint.version
    },
    fields: [
      {
        id: 'identity',
        title: '身份定义',
        content: `角色: ${yamlBlueprint.identity.role}\n任务: ${yamlBlueprint.identity.mission}`,
        order: 0,
        deletable: false
      }
    ],
    schema: {
      input: Object.entries(yamlBlueprint.io_schema?.input || {}).map(([key, value]) => ({
        field: key,
        ...value
      })),
      output: Object.entries(yamlBlueprint.io_schema?.output || {}).map(([key, value]) => ({
        field: key,
        ...value
      }))
    }
  }
}

/**
 * 解析旧版 Frontmatter（向后兼容）
 */
function parseLegacyFrontmatter(content: string): { meta: BlueprintMeta; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    throw new Error('Invalid blueprint format: missing frontmatter')
  }

  const [, yamlContent, body] = match
  const meta: any = {}

  yamlContent.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim()
      const value = line.substring(colonIndex + 1).trim()
      
      if (!isNaN(Number(value))) {
        meta[key] = Number(value)
      } else {
        meta[key] = value
      }
    }
  })

  return { meta, body: body.trim() }
}

/**
 * 解析旧版 Markdown 字段（向后兼容）
 */
function parseLegacyFields(body: string): BlueprintField[] {
  const fields: BlueprintField[] = []
  const sections = body.split(/\n(?=## )/)

  sections.forEach((section, index) => {
    const lines = section.trim().split('\n')
    const titleLine = lines[0]

    if (!titleLine.startsWith('## ')) {
      return
    }

    const title = titleLine.replace(/^## /, '').trim()
    const content = lines.slice(1).join('\n').trim()

    fields.push({
      id: title,
      title,
      content,
      order: index,
      deletable: title !== '身份定义'
    })
  })

  return fields
}
