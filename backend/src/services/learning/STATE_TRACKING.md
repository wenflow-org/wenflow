# 学习状态追踪系统实现计划

## 📊 核心指标

### 1. LSS (Learning Stress Score) - 学习压力评分
衡量单次学习的综合压力程度

**计算公式**:
```
LSS = (difficulty×0.3 + cognitiveLoad×0.3 + independence×0.2 + effectiveness×0.2)
```

**数据来源**:
- `difficulty`: 用户主观难度 (1-10, 来自用户评估)
- `cognitiveLoad`: 认知负荷 (1-10, 预估或用户评估)
- `independence`: 独立性 (1-10, 根据AI提示使用频率评估)
- `effectiveness`: 学习效果 (1-10, 根据笔记质量评估)

**应用**:
- 高LSS (>7): 建议休息或降低难度
- 低LSS (<3): 可以增加难度
- 正常范围 (3-7): 继续当前节奏

---

### 2. KTL (Knowledge Training Load) - 知识掌握度
长期知识积累水平

**计算公式** (指数加权移动平均 - EWMA):
```
KTL_t = λ × KTL_{t-1} + (1-λ) × LSS_t
```

**参数**:
- λ = 0.95 (42天衰减)
- 初始值 KTL_0 = 0

**应用**:
- 追踪长期学习曲线
- 评估知识积累进度
- 为ZPD等级提供依据

---

### 3. LF (Learning Fatigue) - 学习疲劳度
近期学习疲劳程度

**计算公式** (短期加权平均):
```
LF_t = λ_short × LF_{t-1} + (1-λ_short) × LSS_t
```

**参数**:
- λ_short = 0.70 (7天衰减)
- 初始值 LF_0 = 0

**应用**:
- 疲劳预警 (LF > 6)
- 建议休息时间
- 避免过度学习

---

### 4. LSB (Learning State Balance) - 学习状态值
当前可用学习状态

**计算公式**:
```
LSB = KTL - LF
```

**应用**:
- LSB > 4: 高效学习状态
- LSB 2-4: 正常学习状态
- LSB < 2: 建议休息或做简单任务
- LSB < 0: 需要强制休息

---

## 🎯 实现步骤

### Phase 1: 数据库扩展
- [ ] 添加 learning_metrics 表
  ```typescript
  model LearningMetrics {
    id: String @id @default(cuid())
    userId: String
    LSS: Float
    KTL: Float
    LF: Float
    LSB: Float
    sessionId: String?
    timestamp: DateTime @default(now())
  }
  ```

### Phase 2: 后端API
- [ ] 计算LSS的Service方法
- [ ] 更新KTL/LF的Service方法 (EWMA算法)
- [ ] 获取当前学习状态 API: `GET /api/learning/status`
- [ ] 获取学习趋势 API: `GET /api/learning/trends`

### Phase 3: 前端展示
- [ ] 学习状态仪表盘
- [ ] 学习趋势图表 (Chart.js集成)
- [ ] 动态学习建议
- [ ] 疲劳预警通知

---

## 📈 可视化设计

### 1. 学习趋势图
```
图表类型: 折线图
X轴: 时间 (过去30天/7天)
Y轴: 分数 (0-10)
多条线: LSS, KTL, LF, LSB
```

### 2. 状态仪表盘
```
┌─────────────────────────────┐
│  KTL: 6.7  ─────────█────  │
│  LF:  4.2  ────────────█─  │
│  LSB: 2.5  ───────█──────  │
│                             │
│  当前状态: 正常学习         │
│  建议: 继续当前节奏        │
└─────────────────────────────┘
```

### 3. 学习建议卡片
```
📊 本次学习分析
- 难度: 6/10 (适中)
- 认知负荷: 7/10 (较高)
- 建议: 适当休息, 补充知识

⚠️ 疲劳预警
- LF连续3天 > 6
- 建议休息1-2天
```

---

## 💡 智能建议规则

基于LSB和LTS的动态建议

1. **LSB < 0**
   - ❌ 建议: "强制休息"
   - 🎯 操作: 停止新任务, 复习旧知识

2. **LSB 0-2**
   - ⚠️ 建议: "降低难度"
   - 🎯 操作: 选择简单任务, 看视频教程

3. **LSB 2-4**
   - ✅ 建议: "正常学习"
   - 🎯 操作: 继续当前节奏

4. **LSB > 4**
   - 🚀 建议: "挑战高难"
   - 🎯 操作: 尝试项目实践, 深入研究

---

**预计开发时间**: 4-6小时
