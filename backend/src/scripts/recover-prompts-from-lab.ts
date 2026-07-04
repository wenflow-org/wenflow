import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import yaml from 'js-yaml'
import systemPrisma from '../config/system-database'

type RecoverConfig = {
  skillId: string
  archetype: string
  name: string
  description: string
  acceptableAgentIds?: string[]
  temperature?: number
  maxTokens?: number
  model?: string | null
  thinkingMode?: string
  reasoningEffort?: string
}

const RECOVERY_TARGETS: RecoverConfig[] = [
  {
    skillId: 'adaptive-guidance-copy',
    archetype: 'copywriter',
    name: 'default-adaptive-guidance-copy',
    description: '动态引导文案生成器',
    temperature: 0.7,
    maxTokens: 8000,
    model: null,
    thinkingMode: 'default',
    reasoningEffort: 'default'
  },
  {
    skillId: 'path-planning',
    archetype: 'generator',
    name: 'default-skill-path-planning',
    description: '学习路径规划',
    acceptableAgentIds: ['skill:path-planning', 'path-agent'],
    temperature: 0.7,
    maxTokens: 8000,
    model: null,
    thinkingMode: 'default',
    reasoningEffort: 'default'
  }
]

async function backupCurrentProdFile(skillId: string, prodPath: string) {
  const backupsDir = path.join(process.cwd(), '../prompt-lab/backups', skillId)
  await fs.mkdir(backupsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`)).catch(() => undefined)
}

async function readExistingFrontmatter(prodPath: string) {
  try {
    const raw = await fs.readFile(prodPath, 'utf-8')
    const match = raw.match(/^---\n([\s\S]*?)\n---/)
    return match ? (yaml.load(match[1]) as Record<string, unknown>) || {} : {}
  } catch {
    return {}
  }
}

function buildFrontmatter(config: RecoverConfig, existing: Record<string, unknown>) {
  const acceptableAgentIds = Array.isArray(existing.acceptableAgentIds)
    ? (existing.acceptableAgentIds as string[])
    : config.acceptableAgentIds || []

  const lines = [
    '---',
    `agentId: skill:${config.skillId}`,
    `name: ${config.name}`,
    `archetype: ${config.archetype}`,
    `description: ${config.description}`,
    `temperature: ${config.temperature ?? 0.7}`,
    `maxTokens: ${config.maxTokens ?? 8000}`
  ]

  if (acceptableAgentIds.length > 0) {
    lines.push('acceptableAgentIds:')
    acceptableAgentIds.forEach((item) => lines.push(`  - ${item}`))
  }

  lines.push('---', '')
  return lines.join('\n')
}

async function publishDbVersion(config: RecoverConfig, promptBody: string) {
  const agentId = `skill:${config.skillId}`
  const latest = await systemPrisma.agent_prompts.findFirst({
    where: { agentId },
    orderBy: { version: 'desc' },
    select: { version: true }
  })

  const newVersion = (latest?.version ?? 0) + 1
  const promptId = uuidv4()

  await systemPrisma.agent_prompts.create({
    data: {
      id: promptId,
      agentId,
      name: `${config.name} v${newVersion}`,
      systemPrompt: promptBody.trim(),
      status: 'ACTIVE',
      version: newVersion,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 8000,
      model: config.model || process.env.AI_MODEL || 'deepseek-v4-flash',
      description: config.description,
      publishedAt: new Date(),
      createdBy: 'prompt-recovery-script'
    }
  })

  await systemPrisma.agent_prompts.updateMany({
    where: { agentId, status: 'ACTIVE', id: { not: promptId } },
    data: { status: 'ARCHIVED' }
  })

  const existingCfg = await systemPrisma.skill_model_configs.findFirst({
    where: { skillId: config.skillId }
  })

  if (existingCfg) {
    await systemPrisma.skill_model_configs.update({
      where: { id: existingCfg.id },
      data: {
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens ?? 8000,
        model: config.model || null,
        thinkingMode: config.thinkingMode || 'default',
        reasoningEffort: config.reasoningEffort || 'default',
        updatedAt: new Date().toISOString()
      }
    })
  } else {
    await systemPrisma.skill_model_configs.create({
      data: {
        id: uuidv4(),
        skillId: config.skillId,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens ?? 8000,
        model: config.model || null,
        thinkingMode: config.thinkingMode || 'default',
        reasoningEffort: config.reasoningEffort || 'default',
        enabled: true,
        updatedAt: new Date().toISOString()
      }
    })
  }

  return { promptId, newVersion }
}

async function recoverOne(config: RecoverConfig) {
  const sourcePath = path.join(process.cwd(), '../prompt-lab/sources', `${config.skillId}.md`)
  const prodPath = path.join(process.cwd(), '../prompts', `skill.${config.skillId}.md`)

  const sourceBody = await fs.readFile(sourcePath, 'utf-8')
  const existingFrontmatter = await readExistingFrontmatter(prodPath)
  const frontmatter = buildFrontmatter(config, existingFrontmatter)

  await backupCurrentProdFile(config.skillId, prodPath)
  await fs.writeFile(prodPath, `${frontmatter}${sourceBody.trim()}\n`, 'utf-8')

  const publishResult = await publishDbVersion(config, sourceBody)
  return {
    skillId: config.skillId,
    version: publishResult.newVersion,
    promptId: publishResult.promptId,
    prodPath
  }
}

async function main() {
  const results = []
  for (const config of RECOVERY_TARGETS) {
    results.push(await recoverOne(config))
  }
  console.log(JSON.stringify(results, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await systemPrisma.$disconnect()
  })
