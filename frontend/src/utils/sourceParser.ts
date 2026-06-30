/**
 * 解析 Lab 源文件（Markdown）为结构化 Section 树
 *
 * 源文件格式：
 *   # DEFINITIONS          ← level 1 section
 *   ## Identity             ← level 2 section
 *   ...content...
 *   ## Input
 *   ...table...
 *   ## Output Schema
 *   ...nested fields...
 *   ## Stages
 *   ...stage definitions...
 *
 *   # EXECUTION             ← level 1 section
 *   ## Format
 *   ## Context Handling
 *   ...
 */

export type ContentType = 'text' | 'table' | 'schema' | 'stages' | 'constraints'

export interface SourceSection {
  id: string
  level: 1 | 2
  title: string
  content: string
  parentId: string | null
  children?: SourceSection[]
  /** 内容类型，用于前端选择渲染器 */
  contentType: ContentType
}

export interface SourceDocument {
  raw: string
  rootSections: SourceSection[]
  /** 扁平化所有 section，方便查找 */
  flatSections: SourceSection[]
}

/**
 * 解析源文件 markdown 文本
 */
export function parseSource(raw: string): SourceDocument {
  const lines = raw.split('\n')
  const sections: SourceSection[] = []
  let currentSection: SourceSection | null = null
  let currentParent: string | null = null
  let contentLines: string[] = []

  function flushSection() {
    if (currentSection) {
      currentSection.content = contentLines.join('\n').trim()
      currentSection.contentType = detectContentType(currentSection.title, currentSection.content)
      sections.push(currentSection)
    }
    contentLines = []
  }

  for (const line of lines) {
    // ## section（level 2）
    const h2Match = line.match(/^## (.+)/)
    if (h2Match) {
      flushSection()
      const title = h2Match[1].trim()
      currentSection = {
        id: toSectionId(title),
        level: 2,
        title,
        content: '',
        parentId: currentParent,
        contentType: 'text'
      }
      continue
    }

    // # section（level 1）— DEFINITIONS / EXECUTION
    const h1Match = line.match(/^# (.+)/)
    if (h1Match) {
      flushSection()
      const title = h1Match[1].trim()
      currentParent = toSectionId(title)
      currentSection = {
        id: currentParent,
        level: 1,
        title,
        content: '',
        parentId: null,
        contentType: 'text'
      }
      continue
    }

    contentLines.push(line)
  }

  flushSection()

  // 构建层级关系
  const rootSections = sections.filter(s => s.level === 1)
  for (const root of rootSections) {
    root.children = sections.filter(s => s.parentId === root.id)
  }

  return {
    raw,
    rootSections,
    flatSections: sections
  }
}

/**
 * 将 Section 树重新序列化为 Markdown 文本
 */
export function serializeSource(doc: SourceDocument): string {
  const parts: string[] = []
  for (const section of doc.flatSections) {
    const prefix = section.level === 1 ? '# ' : '## '
    parts.push(`${prefix}${section.title}`)
    if (section.content) {
      parts.push('')
      parts.push(section.content)
    }
    parts.push('')
  }
  return parts.join('\n').trim() + '\n'
}

/**
 * 将标题转为 section id（小写+连字符）
 */
function toSectionId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * 根据标题和内容自动判断内容类型
 */
function detectContentType(title: string, content: string): ContentType {
  const t = title.toLowerCase()

  if (t.includes('input') || t === '输入') return 'table'
  if (t.includes('output') || t.includes('schema')) return 'schema'
  if (t.includes('stage') || t.includes('阶段')) return 'stages'
  if (t.includes('constraint') || t.includes('约束')) return 'constraints'
  if (content.includes('|') && content.includes('---')) return 'table'
  return 'text'
}
