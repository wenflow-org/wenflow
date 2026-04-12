export class AcpPermissionService {
  // 权限矩阵：哪个入口可以调用哪些 Agent
  private permissionMatrix: Record<string, string[]> = {
    'lab': ['goal-conversation', 'path-agent', 'content-agent', 'tutor-agent', 'cognitive-analysis', 'intervention'],
    'platform': ['goal-conversation', 'path-agent', 'content-agent', 'tutor-agent'],
    'arena': ['persona-agent', 'user-agent', 'dialog-agent', 'extract-agent', 'generate-agent', 'evaluate-agent'],
    'test': ['*'], // 测试环境可以调用所有
  };

  // 检查是否有权限调用目标 Agent
  canInvoke(sourceEntry: string, targetAgent: string): boolean {
    const allowedAgents = this.permissionMatrix[sourceEntry] || [];
    return allowedAgents.includes('*') || allowedAgents.includes(targetAgent);
  }

  // 获取入口允许调用的 Agent 列表
  getAllowedAgents(sourceEntry: string): string[] {
    return this.permissionMatrix[sourceEntry] || [];
  }
}

export const acpPermissionService = new AcpPermissionService();
