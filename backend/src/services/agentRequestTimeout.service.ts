const DEFAULT_AI_REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || 600_000);
const PATH_AGENT_REQUEST_TIMEOUT_MS = Number(process.env.PATH_AGENT_REQUEST_TIMEOUT_MS || 600_000);

export type AgentRequestTimeoutInfo = {
  requestTimeoutMs: number;
  requestTimeoutSource: 'default' | 'agent-override';
};

export function getDefaultAIRequestTimeoutMs() {
  return DEFAULT_AI_REQUEST_TIMEOUT_MS;
}

export function getAgentRequestTimeoutInfo(agentId?: string): AgentRequestTimeoutInfo {
  if (agentId === 'path-agent') {
    return {
      requestTimeoutMs: PATH_AGENT_REQUEST_TIMEOUT_MS,
      requestTimeoutSource: 'agent-override',
    };
  }

  return {
    requestTimeoutMs: DEFAULT_AI_REQUEST_TIMEOUT_MS,
    requestTimeoutSource: 'default',
  };
}
