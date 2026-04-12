# ContentAgent v3.0 监控和日志系统文档

## 概述

本文档介绍了 ContentAgent v3.0 的完整监控和日志系统，包括 Agent 调用日志、性能监控、实时日志流和告警系统。

## 架构组件

### 1. AgentLogger 工具类

**文件位置**: `backend/src/utils/agent-logger.ts`

**功能**: 提供统一的日志记录接口，记录 ContentAgent 的各种运行状态。

**API 方法**:

```typescript
// 记录策略选择
AgentLogger.logStrategySelection({
  userId: string;
  sessionId: string;
  studentState: any;
  selectedStrategy: string;
  strategyReason: string;
});

// 记录内容生成
AgentLogger.logContentGeneration({
  userId: string;
  sessionId: string;
  strategy: string;
  uiType: string;
  difficulty: number;
  duration: number;
  qualityScore: number;
  tokensUsed?: number;
});

// 记录错误
AgentLogger.logError({
  userId: string;
  sessionId: string;
  error: string;
  stack?: string;
  errorCode?: string;
});

// 记录性能指标
AgentLogger.logPerformance({
  agentId: string;
  action: string;
  duration: number;
  tokensUsed: number;
  success: boolean;
  promptVersion?: number;
});
```

### 2. AgentAlerts 告警工具

**文件位置**: `backend/src/utils/agent-alerts.ts`

**功能**: 自动检测 Agent 运行异常并发送告警。

**告警类型**:
- **HIGH_ERROR_RATE**: 高错误率（>10%）
- **HIGH_LATENCY**: 高延迟（>5000ms）
- **LOW_THROUGHPUT**: 低吞吐量（调用量骤降）
- **SYSTEM_ERROR**: 系统错误

**配置选项**:

```typescript
interface AlertConfig {
  errorRateThreshold: number; // 错误率阈值（默认 10%）
  latencyThreshold: number; // 延迟阈值（默认 5000ms）
  checkInterval: number; // 检查间隔（默认 5 分钟）
  alertCooldown: number; // 告警冷却时间（默认 10 分钟）
}
```

**使用方法**:

```typescript
import { agentAlerts } from './utils/agent-alerts';

// 检查高错误率
await agentAlerts.checkHighErrorRate('content-agent-v3');

// 检查高延迟
await agentAlerts.checkHighLatency('content-agent-v3');

// 检查所有告警
const alerts = await agentAlerts.checkAllAlerts();

// 记录系统错误
await agentAlerts.logSystemError('content-agent-v3', '错误信息', 'ERROR_CODE');
```

### 3. Agent Monitoring 路由

**文件位置**: `backend/src/routes/admin/agent-monitoring.ts`

**API 端点**:

#### GET /api/admin/agent-monitoring/metrics

获取 Agent 性能指标。

**参数**:
- `agentId` (可选): Agent ID
- `startTime` (可选): 开始时间
- `endTime` (可选): 结束时间
- `page` (可选): 页码，默认 1
- `limit` (可选): 每页数量，默认 50

**响应示例**:
```json
{
  "success": true,
  "data": {
    "metrics": [
      {
        "agentId": "content-agent-v3",
        "totalCalls": 100,
        "successCalls": 95,
        "failedCalls": 5,
        "successRate": 0.95,
        "avgDuration": 2500,
        "avgTokens": 1200,
        "totalTokens": 120000,
        "totalDuration": 250000
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 100,
      "totalPages": 2
    }
  }
}
```

#### GET /api/admin/agent-monitoring/metrics/detail

获取 Agent 详细调用记录。

**参数**: 同上

#### GET /api/admin/agent-monitoring/strategies/stats

获取策略使用统计。

**参数**:
- `agentId` (可选): Agent ID，默认 'content-agent-v3'
- `startTime` (可选): 开始时间
- `endTime` (可选): 结束时间

**响应示例**:
```json
{
  "success": true,
  "data": {
    "strategies": [
      {
        "strategy": "scaffolding",
        "count": 50,
        "percentage": "50.00%",
        "avgDuration": 2300,
        "successRate": 0.96,
        "avgQualityScore": 4.5
      }
    ],
    "totalCalls": 100,
    "timeRange": {
      "startTime": "2026-03-17T00:00:00.000Z",
      "endTime": "2026-03-18T00:00:00.000Z"
    }
  }
}
```

#### GET /api/admin/agent-monitoring/errors

获取错误日志。

**参数**:
- `agentId` (可选): Agent ID
- `page` (可选): 页码
- `limit` (可选): 每页数量

#### GET /api/admin/agent-monitoring/errors/summary

获取错误摘要（按错误类型分组）。

**参数**:
- `agentId` (可选): Agent ID
- `hours` (可选): 时间窗口（小时），默认 24

**响应示例**:
```json
{
  "success": true,
  "data": {
    "summary": [
      {
        "errorCode": "TIMEOUT",
        "count": 3,
        "affectedAgents": ["content-agent-v3"],
        "sampleError": "请求超时",
        "percentage": "60.00%"
      }
    ],
    "totalErrors": 5,
    "timeWindow": "24h"
  }
}
```

#### GET /api/admin/agent-monitoring/alerts

获取当前告警状态。

#### POST /api/admin/agent-monitoring/alerts/check

手动触发告警检查。

**请求体**:
```json
{
  "agentId": "content-agent-v3"
}
```

#### GET /api/admin/agent-monitoring/usage/trends

获取使用趋势（按小时/天）。

**参数**:
- `agentId` (可选): Agent ID
- `period` (可选): 'hour' | 'day'，默认 'day'
- `days` (可选): 天数，默认 7

#### GET /api/admin/agent-monitoring/summary

获取 Agent 总体摘要。

**参数**:
- `hours` (可选): 时间窗口（小时），默认 24

### 4. AgentConfigService 增强

**文件位置**: `backend/src/services/agentConfig.service.ts`

**新增方法**:

```typescript
// 记录 Agent 调用日志
await agentConfigService.recordAgentCall({
  agentId: 'content-agent-v3',
  userId: 'user123',
  promptVersion: 3,
  duration: 2500,
  tokensUsed: 1200,
  success: true,
  input: {...},
  output: {...},
  studentState: {
    frustration: 0.3,
    problemClarity: 0.8,
    strategy: 'scaffolding'
  },
  quality: {
    score: 4.5,
    latency: 2500
  }
});

// 静态日志方法
AgentConfigService.logStrategySelection({...});
AgentConfigService.logContentGeneration({...});
AgentConfigService.logError({...});
```

## 数据库表

### agent_call_logs 表

**字段说明**:
- `id`: 主键
- `agentId`: Agent 标识
- `userId`: 用户 ID
- `sourceEntry`: 来源（默认 'platform'）
- `traceId`: 追踪 ID
- `callerAgent`: 调用 Agent
- `userRole`: 用户角色
- `input`: 输入（JSON 字符串）
- `output`: 输出（JSON 字符串）
- `success`: 是否成功
- `durationMs`: 耗时（毫秒）
- `tokensUsed`: 使用的 Token 数
- `error`: 错误信息
- `errorCode`: 错误代码
- `calledAt`: 调用时间
- `metadata`: 元数据（JSON 字符串，包含 promptVersion、studentState、quality 等）

**索引**:
- `(agentId, calledAt)`: Agent 和时间查询
- `(calledAt)`: 时间范围查询
- `(success)`: 成功/失败筛选
- `(traceId)`: 追踪查询
- `(sourceEntry)`: 来源筛选
- `(userId)`: 用户查询
- `(agentId)`: Agent 查询

## 使用示例

### 1. 在 ContentAgent 中记录调用日志

```typescript
import { agentConfigService } from '../services/agentConfig.service';
import { AgentLogger } from '../utils/agent-logger';

// 在 AI 调用前记录开始时间
const startTime = Date.now();

try {
  // 调用 AI
  const response = await aiService.chat(prompt);
  
  const duration = Date.now() - startTime;
  
  // 记录调用日志
  await agentConfigService.recordAgentCall({
    agentId: 'content-agent-v3',
    userId: studentId,
    promptVersion: 3,
    duration,
    tokensUsed: response.usage?.total_tokens || 0,
    success: true,
    input: { prompt },
    output: { response: response.choices[0].message },
    studentState: {
      frustration: studentState.frustration,
      problemClarity: studentState.problemClarity,
      strategy: selectedStrategy
    },
    quality: {
      score: qualityScore,
      latency: duration
    }
  });
  
  return response;
} catch (error) {
  const duration = Date.now() - startTime;
  
  // 记录错误
  await agentConfigService.recordAgentCall({
    agentId: 'content-agent-v3',
    userId: studentId,
    promptVersion: 3,
    duration,
    tokensUsed: 0,
    success: false,
    error: error.message,
    errorCode: error.code
  });
  
  throw error;
}
```

### 2. 记录策略选择

```typescript
import { AgentConfigService } from '../services/agentConfig.service';

// 当选择辅导策略时
AgentConfigService.logStrategySelection({
  userId: studentId,
  sessionId: sessionToken,
  studentState: {
    frustration: 0.3,
    problemClarity: 0.8,
    currentLevel: 'advanced_beginner'
  },
  selectedStrategy: 'scaffolding',
  strategyReason: '学生表现出较高的理解能力，但需要引导'
});
```

### 3. 记录内容生成

```typescript
import { AgentConfigService } from '../services/agentConfig.service';

// 当生成学习内容时
AgentConfigService.logContentGeneration({
  userId: studentId,
  sessionId: sessionToken,
  strategy: 'scaffolding',
  uiType: 'QuestionCard',
  difficulty: 0.7,
  duration: 2500,
  qualityScore: 4.5,
  tokensUsed: 1200
});
```

## 监控仪表板

可以通过访问以下端点查看监控数据：

- **性能指标**: `GET /api/admin/agent-monitoring/metrics`
- **详细调用**: `GET /api/admin/agent-monitoring/metrics/detail`
- **策略统计**: `GET /api/admin/agent-monitoring/strategies/stats`
- **错误日志**: `GET /api/admin/agent-monitoring/errors`
- **错误摘要**: `GET /api/admin/agent-monitoring/errors/summary`
- **告警状态**: `GET /api/admin/agent-monitoring/alerts`
- **使用趋势**: `GET /api/admin/agent-monitoring/usage/trends`
- **总体摘要**: `GET /api/admin/agent-monitoring/summary`

## 测试

运行测试脚本：

```bash
node test-agent-monitoring.js
```

测试前请确保：
1. 后端服务已启动（http://localhost:3001）
2. 已创建 admin 用户（email: admin@example.com, password: admin123）

## 告警配置

可以通过修改 `agent-alerts.ts` 中的 `defaultConfig` 来调整告警阈值：

```typescript
const defaultConfig: AlertConfig = {
  errorRateThreshold: 0.1, // 10% 错误率
  latencyThreshold: 5000, // 5 秒延迟
  checkInterval: 300000, // 5 分钟检查一次
  alertCooldown: 600000 // 10 分钟冷却时间
};
```

## 日志文件

日志文件位于 `backend/logs/` 目录：
- `combined.log`: 所有日志
- `error.log`: 错误日志

## 最佳实践

1. **性能优化**: 在生产环境中，建议定期清理旧的日志记录
2. **监控频率**: 建议每 5-10 分钟检查一次告警状态
3. **日志轮转**: 配置日志轮转，避免日志文件过大
4. **告警通知**: 集成外部告警系统（钉钉、企业微信、Slack 等）

## 未来扩展

- [ ] 实现外部告警通知（钉钉、企业微信、Slack）
- [ ] 创建 `agent_alerts` 表存储历史告警
- [ ] 添加实时监控 WebSocket 推送
- [ ] 实现自动扩缩容建议
- [ ] 添加 A/B 测试支持
