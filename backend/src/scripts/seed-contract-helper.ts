import { getAgentManifest } from '../services/agent-manifest.service';

/**
 * 契约元数据单源化（统一化 1d）：
 * agent_contracts 的 displayName/description 一律从 manifest 派生，
 * seed 文件只声明 agentId，不再重复维护名称/描述（避免与 manifest 漂移）。
 */
export interface SeedContractMeta {
  agentId: string;
  displayName: string;
  description: string;
}

export function deriveContract(agentId: string): SeedContractMeta {
  const entry = getAgentManifest(agentId);
  return {
    agentId,
    displayName: entry?.name || agentId,
    description: entry?.description || `Agent ${agentId}`,
  };
}
