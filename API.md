# API文档

## 基础信息

**Base URL**: `http://localhost:3001/api`

**认证方式**: Bearer Token (JWT)

```
Authorization: Bearer <token>
```

---

## 认证 API

### 注册用户

**POST** `/auth/register`

**请求体**:
```json
{
  "name": "用户名",
  "email": "user@example.com",
  "password": "password123"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "用户名",
      "email": "user@example.com",
      "level": 1,
      "xp": 0
    },
    "token": "jwt_token_string"
  }
}
```

---

### 用户登录

**POST** `/auth/login`

**请求体**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "用户名",
      "email": "user@example.com",
      "level": 1,
      "xp": 100
    },
    "token": "jwt_token_string"
  }
}
```

---

## 学习路径 API

### 创建学习路径

**POST** `/learning/paths`

**请求体**:
```json
{
  "title": "Python编程入门",
  "description": "从零开始学习Python",
  "totalWeeks": 12,
  "estimatedHours": 60,
  "goals": ["掌握基础语法", "能写简单项目"]
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Python编程入门",
    "totalWeeks": 12,
    "estimatedHours": 60,
    "createdAt": "2026-02-12T00:00:00.000Z"
  }
}
```

---

### 获取学习路径列表

**GET** `/learning/paths`

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Python编程入门",
      "totalWeeks": 12,
      "estimatedHours": 60,
      "createdAt": "2026-02-12T00:00:00.000Z"
    }
  ]
}
```

---

### 获取学习路径详情

**GET** `/learning/paths/:id`

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Python编程入门",
    "description": "从零开始学习Python",
    "totalWeeks": 12,
    "estimatedHours": 60,
    "weeks": [
      {
        "id": "uuid",
        "weekNumber": 1,
        "title": "第1周：Python基础",
        "tasks": [
          {
            "id": "uuid",
            "title": "安装Python环境",
            "description": "下载并安装Python",
            "status": "todo",
            "estimatedMinutes": 30
          }
        ]
      }
    ]
  }
}
```

---

## 任务 API

### 获取任务详情

**GET** `/learning/tasks/:id`

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "任务标题",
    "description": "任务描述",
    "contentJson": "{}",
    "status": "todo",
    "estimatedMinutes": 60,
    "actualMinutes": 0,
    "aiHints": "{}",
    "week": {
      "id": "uuid",
      "weekNumber": 1
    },
    "learningPath": {
      "id": "uuid",
      "title": "Python编程入门"
    }
  }
}
```

---

### 更新任务状态

**PATCH** `/learning/tasks/:id`

**请求体**:
```json
{
  "status": "completed",
  "notes": "学习笔记",
  "subjectiveDifficulty": 7
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "completed",
    "actualMinutes": 45
  }
}
```

---

## 学习会话 API

### 开始学习会话

**POST** `/sessions/start`

**请求体**:
```json
{
  "taskId": "task_uuid"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "session_uuid",
    "taskId": "task_uuid",
    "startTime": "2026-02-12T10:00:00.000Z"
  }
}
```

---

### 结束学习会话

**POST** `/sessions/:id/end`

**请求体**:
```json
{
  "notes": "学习笔记内容",
  "subjectiveDifficulty": 7
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "session_uuid",
    "endTime": "2026-02-12T10:45:00.000Z",
    "durationMinutes": 45,
    "metrics": {
      "lss": 6.5,
      "ktl": 5.2,
      "lf": 5.1,
      "lsb": 0.1
    }
  }
}
```

---

### 获取用户会话列表

**GET** `/sessions?limit=10`

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "session_uuid",
      "task": {
        "id": "task_uuid",
        "title": "任务标题"
      },
      "startTime": "2026-02-12T10:00:00.000Z",
      "endTime": "2026-02-12T10:45:00.000Z",
      "durationMinutes": 45,
      "notes": "学习笔记",
      "lss": 6.5
    }
  ]
}
```

---

## 学习状态 API

### 获取当前学习状态

**GET** `/state/current`

**响应**:
```json
{
  "success": true,
  "data": {
    "lss": 6.5,
    "ktl": 5.2,
    "lf": 5.1,
    "lsb": 0.1,
    "suggestion": {
      "level": "normal",
      "message": "学习状态良好，继续保持",
      "action": "可以继续学习当前难度的任务"
    }
  }
}
```

---

### 获取学习趋势

**GET** `/state/trends?days=7`

**响应**:
```json
{
  "success": true,
  "data": {
    "trends": [
      {
        "date": "2026-02-06T00:00:00.000Z",
        "lss": 6.5,
        "ktl": 5.2,
        "lf": 5.1,
        "lsb": 0.1
      }
    ]
  }
}
```

---

### 计算学习指标

**POST** `/state/calculate`

**请求体**:
```json
{
  "difficulty": 7,
  "independence": 8,
  "effectiveness": 6
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "lss": 6.7,
    "ktl": 5.34,
    "lf": 5.54,
    "lsb": -0.2
  }
}
```

---

## 成就 API

### 获取我的成就

**GET** `/achievements/my-achievements`

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "milestone",
      "title": "初学者",
      "description": "完成第一个任务",
      "iconUrl": "🎯",
      "xpReward": 10,
      "earnedAt": "2026-02-12T10:00:00.000Z"
    }
  ]
}
```

---

### 获取所有成就及状态

**GET** `/achievements/all`

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "first_task",
      "name": "初学者",
      "description": "完成第一个任务",
      "icon": "🎯",
      "xpReward": 10,
      "type": "milestone",
      "unlocked": true,
      "progress": {
        "current": 1,
        "total": 1,
        "percentage": 100
      },
      "earnedAt": "2026-02-12T10:00:00.000Z"
    }
  ]
}
```

---

### 触发成就检测

**POST** `/achievements/check`

**请求体**:
```json
{
  "eventType": "task_completed"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "newAchievements": [
      {
        "id": "task_10",
        "name": "渐入佳境",
        "icon": "📈",
        "xpReward": 50
      }
    ],
    "count": 1
  }
}
```

---

## 学习报告 API

### 生成学习报告

**GET** `/reports/generate?type=weekly`

**Query参数**:
- `type`: `weekly` | `monthly`
- `date`: ISO日期字符串 (可选)

**响应**:
```json
{
  "success": true,
  "data": {
    "user": {
      "name": "用户名",
      "email": "user@example.com",
      "level": 1,
      "xp": 100
    },
    "period": {
      "startDate": "2026-02-01T00:00:00.000Z",
      "endDate": "2026-02-08T23:59:59.999Z",
      "type": "weekly"
    },
    "learning": {
      "totalSessions": 5,
      "totalTimeMinutes": 180,
      "completedTasks": 3,
      "completedPaths": 0
    },
    "metrics": {
      "avgLSS": 6.5,
      "avgKTL": 5.2,
      "avgLF": 5.1,
      "avgLSB": 0.1,
      "ktlGrowth": 0.3
    },
    "achievements": {
      "unlocked": 4,
      "newUnlocked": 1,
      "topAchievements": [
        {
          "title": "初学者",
          "earnedAt": "2026-02-06T10:00:00.000Z"
        }
      ]
    },
    "trends": {
      "dailyStats": [
        {
          "date": "2026-02-06T00:00:00.000Z",
          "sessions": 2,
          "timeMinutes": 60,
          "lss": 6.5,
          "ktl": 5.2
        }
      ]
    },
    "recommendations": [
      "学习压力较大，建议适当降低任务难度",
      "知识掌握度提升了0.3，表现优秀！"
    ]
  }
}
```

---

### 获取报告历史

**GET** `/reports/history`

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "date": "2026-02-06T00:00:00.000Z",
      "type": "weekly",
      "completedTasks": 3,
      "totalTimeHours": 3.5,
      "ktlGrowth": 0.3
    }
  ]
}
```

---

## AI辅导 API

### ZPD分层辅导

**POST** `/ai/zpd-tutor`

**请求体**:
```json
{
  "userLevel": 1,
  "userXP": 50,
  "taskTitle": "安装Python环境",
  "userQuestion": "安装失败怎么办？",
  "conversationHistory": []
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "userLevel": "Novice",
    "hintLevel": 1,
    "response": "安装失败通常有以下几个原因：\n\n1. 路径问题...",
    "nextHint": "请检查你的环境变量PATH设置",
    "hasMoreHints": true
  }
}
```

---

## 错误响应格式

所有错误响应遵循以下格式：

```json
{
  "error": {
    "message": "错误描述信息",
    "status": 400
  }
}
```

**常见状态码**:
- `400` - 请求参数错误
- `401` - 未认证
- `403` - 权限不足
- `404` - 资源不存在
- `500` - 服务器内部错误

---

## 状态码说明

### 任务状态 (status)
- `todo` - 待完成
- `in_progress` - 进行中
- `completed` - 已完成
- `skipped` - 已跳过

### 成就类型 (type)
- `milestone` - 里程碑
- `streak` - 连续学习
- `completion` - 完成度
- `mastery` - 知识掌握
- `special` - 特殊成就

### 学习建议级别 (level)
- `critical` - 紧急（需要休息）
- `warning` - 警告（注意休息）
- `normal` - 正常
- `optimal` - 最佳（高效学习状态）

### ZPD用户等级
- `Novice` - 新手 (0-99 XP)
- `Advanced Beginner` - 高级初学者 (100-299 XP)
- `Competent` - 胜任 (300-599 XP)
- `Proficient` - 精通 (600-999 XP)
- `Expert` - 专家 (1000+ XP)

---

*最后更新: 2026-02-12*
*版本: v1.0.0*
