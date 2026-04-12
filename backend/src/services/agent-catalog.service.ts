import fs from 'fs/promises';
import path from 'path';

export type AgentLifecycleStatus = 'draft' | 'staging' | 'published';

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface AgentCatalogRecord {
  status: AgentLifecycleStatus;
  updatedAt: string;
  updatedBy?: string;
}

type AgentCatalog = Record<string, AgentCatalogRecord>;

export const OFFICIAL_AGENT_DEFINITIONS: AgentDefinition[] = [
  { id: 'goal-conversation-agent', name: '目标对话 Agent', description: '收集学习目标与上下文', category: 'learning' },
  { id: 'path-agent', name: '学习路径规划 Agent', description: '规划学习路径', category: 'learning' },
  { id: 'content-agent', name: '内容生成 Agent', description: '生成学习内容', category: 'content' },
  { id: 'content-agent-v3', name: '对话式内容 Agent', description: '对话式内容生成', category: 'content' },
  { id: 'content-agent-v5', name: '授课内容生成 Agent', description: '授课型内容生成', category: 'content' },
  { id: 'ai-teaching-agent', name: 'AI 授课 Agent', description: 'AI 互动授课', category: 'teaching' },
  { id: 'tutor-agent', name: 'AI 辅导 Agent', description: '个性化辅导', category: 'tutoring' },
  { id: 'progress-agent', name: '进度追踪 Agent', description: '追踪学习进度', category: 'tracking' },
  { id: 'user-profile-agent', name: '用户画像 Agent', description: '分析用户特征', category: 'analysis' }
];

const catalogPath = path.join(__dirname, '../../config/agent-catalog.json');

function buildDefaultCatalog(): AgentCatalog {
  const now = new Date().toISOString();
  return OFFICIAL_AGENT_DEFINITIONS.reduce((acc, item) => {
    acc[item.id] = {
      status: 'published',
      updatedAt: now,
      updatedBy: 'system'
    };
    return acc;
  }, {} as AgentCatalog);
}

async function readRawCatalog(): Promise<AgentCatalog> {
  try {
    const raw = await fs.readFile(catalogPath, 'utf-8');
    const parsed = JSON.parse(raw) as AgentCatalog;
    return parsed || {};
  } catch {
    return {};
  }
}

async function writeRawCatalog(catalog: AgentCatalog): Promise<void> {
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8');
}

export function isOfficialAgent(agentId: string): boolean {
  return OFFICIAL_AGENT_DEFINITIONS.some(agent => agent.id === agentId);
}

export async function getAgentCatalog(): Promise<AgentCatalog> {
  const defaults = buildDefaultCatalog();
  const raw = await readRawCatalog();
  const merged = { ...defaults, ...raw };

  for (const key of Object.keys(merged)) {
    if (!merged[key]?.updatedAt) {
      merged[key] = {
        ...merged[key],
        updatedAt: new Date().toISOString()
      };
    }
  }

  return merged;
}

export async function listOfficialAgentCatalog() {
  const catalog = await getAgentCatalog();
  return OFFICIAL_AGENT_DEFINITIONS.map(agent => ({
    ...agent,
    lifecycleStatus: catalog[agent.id]?.status || 'published',
    lifecycleUpdatedAt: catalog[agent.id]?.updatedAt,
    lifecycleUpdatedBy: catalog[agent.id]?.updatedBy || 'system'
  }));
}

export async function getAgentLifecycleStatus(agentId: string): Promise<AgentLifecycleStatus> {
  const catalog = await getAgentCatalog();
  return catalog[agentId]?.status || (isOfficialAgent(agentId) ? 'published' : 'draft');
}

export async function setAgentLifecycleStatus(
  agentId: string,
  status: AgentLifecycleStatus,
  updatedBy?: string
): Promise<AgentCatalogRecord> {
  const catalog = await getAgentCatalog();
  const nextRecord: AgentCatalogRecord = {
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || 'admin'
  };

  catalog[agentId] = nextRecord;
  await writeRawCatalog(catalog);
  return nextRecord;
}
