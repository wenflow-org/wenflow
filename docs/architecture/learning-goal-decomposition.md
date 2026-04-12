# 学习目标分解算法设计文档

> 将用户的模糊学习目标分解为具体可执行的学习任务

---

## 🎯 核心概念

### 输入：模糊的学习目标

```
用户输入示例：
- "我想3个月学会Python做网站"
- "英语四级考试，现在初中水平"
- "6个月掌握数据分析"
```

### 输出：结构化的学习计划

```
学习计划示例：
├─ 主题：Python编程
├─ 时长：12周
├─ 目标：能独立开发Web应用
└─ 任务清单：
   - Week 1: 基础语法（5个任务）
   - Week 2: 流程控制（6个任务）
   - ...
```

---

## 📊 数据结构定义

### 1. 学习目标 (LearningGoal)

```python
class LearningGoal:
    """用户的学习目标"""
    
    def __init__(self):
        # 用户输入
        self.user_id = ""
        self.goal_description = ""  # "我想3个月学会Python做网站"
        
        # 用户背景（通过对话获取）
        self.user_profile = {
            "current_skill_level": "beginner",  # beginner/intermediate/advanced
            "time_per_day": "1-2 hours",         # 时间投入
            "learning_frequency": "daily",       # daily/weekends/batch
            "learning_style": "project-based",  # project-based/theoretical/mixed
            "prior_knowledge": [],              # 已有技能
            "weak_areas": [],                   # 薄弱环节
            "strong_areas": [],                 # 优势领域
        }
        
        # 目标约束
        self.constraints = {
            "duration": "3 months",             # 时间限制
            "budget": "free",                   # 预算
            "final_goal": "build a website",    # 最终产出
        }
```

---

### 2. 学习路径 (LearningPath)

```python
class LearningPath:
    """分解后的学习路径"""
    
    def __init__(self):
        # 基本信息
        self.path_id = ""
        self.subject = "Python编程"
        self.version = "1.0"
        
        # 时间规划
        self.total_duration_weeks = 12
        self.total_estimated_hours = 60
        
        # 难度曲线
        self.difficulty_curve = "gradual"  # gradual/linear/custom
        
        # 阶段划分
        self.phases = []
        # self.phases = [
        #     {
        #         "phase_id": "phase_1",
        #         "phase_name": "基础阶段",
        #         "weeks": 4,
        #         "objectives": ["掌握基础语法", ...],
        #         "tasks": [...]
        #     },
        #     ...
        # ]
        
        # 里程碑
        self.milestones = []
        # self.milestones = [
        #     {"week": 4, "title": "能独立写小程序"},
        #     {"week": 8, "title": "能用框架开发"},
        #     {"week": 12, "title": "完成完整项目"}
        # ]
```

---

### 3. 学习阶段 (LearningPhase)

```python
class LearningPhase:
    """学习阶段"""
    
    def __init__(self):
        self.phase_id = ""
        self.phase_name = ""  # "基础阶段"
        
        # 时间安排
        self.weeks = 4
        self.hours_per_week = 5
        
        # 学习目标
        self.objectives = []
        # self.objectives = [
        #     "掌握Python基本语法",
        #     "理解变量和数据类型",
        #     "能用Python写简单程序"
        # ]
        
        # 任务列表
        self.tasks = []
        
        # 验收标准
        self.acceptance_criteria = ""
```

---

### 4. 学习任务 (LearningTask)

```python
class LearningTask:
    """单个学习任务"""
    
    def __init__(self):
        # 基本信息
        self.task_id = ""
        self.title = ""
        self.description = ""
        
        # 时间属性
        self.duration_minutes = 30
        self.difficulty = 5  # 1-10
        
        # 认知属性
        self.bloom_level = "understand"  # recall/understand/apply/analyze/create
        self.cognitive_load = "medium"   # low/medium/high
        
        # 新知识 vs 复习
        self.new_concepts = []      # 本任务涉及的新概念
        self.recall_concepts = []    # 需要回顾的概念
        
        # 教学风格
        self.teaching_approach = ""  # 理论讲解/实战练习/项目导向
        
        # 验证方式
        self.verification = {
            "type": "quiz",          # quiz/project/exercise
            "passing_score": 0.8
        }
        
        # AI辅助配置
        self.ai_support = {
            "enabled": True,
            "hints_available": 3,
            "auto_assistance": True
        }
```

---

## 🧠 分解算法设计

### 算法流程总览

```
┌─────────────────────────────────────┐
│  输入：用户的学习目标               │
│  "我想3个月学会Python做网站"        │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Step 1: 目标识别与分析（AI）       │
│  - 识别学科主题                     │
│  - 提取时间约束                     │
│  - 识别最终目标                     │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Step 2: 用户背景评估（对话式）      │
│  - 当前技能水平                     │
│  - 时间投入                         │
│  - 学习风格                         │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Step 3: 知识图谱查询               │
│  - 从预建技能树中找到路径           │
│  - 确定需要的知识点                 │
│  - 建立依赖关系                     │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Step 4: 阶段划分（AI）             │
│  - 划分学习阶段                     │
│  - 确定各阶段目标                   │
│  - 分配时间                         │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Step 5: 任务生成（AI）             │
│  - 为每个知识点生成具体任务         │
│  - 设定任务难度和时间               │
│  - 设计验证方式                     │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Step 6: 难度曲线调整               │
│  - 确保难度渐进                     │
│  - 避免跳度过大                     │
│  - 留出缓冲时间                     │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Step 7: 输出学习计划               │
│  - 生成可视化路径                   │
│  - 提供预览和修改                   │
│  - 用户确认后开始学习               │
└─────────────────────────────────────┘
```

---

## 🔍 详细算法步骤

### Step 1: 目标识别与分析

**AI提示词模板**：

```
请分析用户的学习目标，提取关键信息：

输入描述："{user_goal_description}"

请提取：
1. 学科/主题：（例如：Python编程、英语学习）
2. 水平目标：（零基础入门/进阶提升/精通）
3. 时间约束：（例如：3个月、6周）
4. 最终目标/产出：（例如：能做网站/通过考试）
5. 隐含需求：（例如：需要学前端框架、包括数据库）

输出格式：
{
  "subject": "学科",
  "level": "水平目标",
  "duration": "时间",
  "final_goal": "最终目标",
  "implicit_requirements": ["需求1", "需求2"]
}
```

**Python实现示例**：

```python
def analyze_goal(goal_description, ai_client):
    """分析学习目标"""
    
    prompt = f"""
请分析用户的学习目标，提取关键信息：

输入描述："{goal_description}"

请提取：
1. 学科/主题
2. 水平目标
3. 时间约束
4. 最终目标/产出
5. 隐含需求

输出JSON格式
"""
    
    response = ai_client.chat_completion(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3  # 低温度，稳定输出JSON
    )
    
    # 解析JSON
    import json
    result = json.loads(response["choices"][0]["message"]["content"])
    
    return result
```

---

### Step 2: 用户背景评估

**对话式提问模板**：

```
基于你的学习目标"{goal}"，我需要了解一些情况：

1. 你的当前水平？
   A. 完全零基础，从来没接触过
   B. 学过一点，了解基本概念
   C. 有一定基础，想系统学习
   D. 有经验，想提升到高级

2. 你每天/每周能投入多少时间？
   A. 每天少于30分钟
   B. 每天30分钟-1小时
   C. 每天1-2小时
   D. 每周周末集中学习

3. 你喜欢的学习方式？
   A. 先理论后实践
   B. 边学边做，项目驱动
   C. 大量练习巩固
   D. 综合型

4. 你已经会什么？（可选）
```

---

### Step 3: 知识图谱查询

**预建技能树**（以Python为例）：

```python
PYTHON_SKILL_TREE = {
    "subject": "Python编程",
    "nodes": [
        {
            "node_id": "python_basics",
            "name": "Python基础",
            "level": "beginner",
            "difficulty": 3,
            "estimated_hours": 10,
            "prerequisites": [],
            "recommended_duration": "2 weeks"
        },
        {
            "node_id": "data_structures",
            "name": "数据结构",
            "level": "beginner",
            "difficulty": 5,
            "estimated_hours": 8,
            "prerequisites": ["python_basics"],
            "recommended_duration": "1.5 weeks"
        },
        {
            "node_id": "control_flow",
            "name": "流程控制",
            "level": "beginner",
            "difficulty": 4,
            "estimated_hours": 8,
            "prerequisites": ["data_structures"],
            "recommended_duration": "1.5 weeks"
        },
        {
            "node_id": "functions",
            "name": "函数",
            "level": "intermediate",
            "difficulty": 6,
            "estimated_hours": 10,
            "prerequisites": ["control_flow"],
            "recommended_duration": "2 weeks"
        },
        {
            "node_id": "oop",
            "name": "面向对象",
            "level": "intermediate",
            "difficulty": 7,
            "estimated_hours": 12,
            "prerequisites": ["functions"],
            "recommended_duration": "2.5 weeks"
        },
        {
            "node_id": "web_framework",
            "name": "Web框架（Flask/Django）",
            "level": "advanced",
            "difficulty": 8,
            "estimated_hours": 15,
            "prerequisites": ["oop"],
            "recommended_duration": "3 weeks"
        }
    ],
    
    "connections": [
        {"from": "python_basics", "to": "data_structures"},
        {"from": "data_structures", "to": "control_flow"},
        {"from": "control_flow", "to": "functions"},
        {"from": "functions", "to": "oop"},
        {"from": "oop", "to": "web_framework"}
    ]
}
```

**查询算法**：

```python
def find_learning_path(subject, level, skill_tree):
    """从技能树中查找学习路径"""
    
    # 找到匹配的学科
    if skill_tree["subject"] != subject:
        return None
    
    # 根据水平过滤节点
    nodes = skill_tree["nodes"]
    if level == "beginner":
        relevant_nodes = [n for n in nodes if n["level"] in ["beginner", "intermediate"]]
    elif level == "intermediate":
        relevant_nodes = [n for n in nodes if n["level"] in ["intermediate"]]
    else:
        relevant_nodes = nodes
    
    # 按照依赖关系排序
    path = []
    visited = set()
    
    def add_node_with_dependencies(node_id):
        if node_id in visited:
            return
        
        node = next((n for n in nodes if n["node_id"] == node_id), None)
        if not node:
            return
        
        # 先添加前置依赖
        for prereq in node.get("prerequisites", []):
            add_node_with_dependencies(prereq)
        
        # 添加当前节点
        if node_id not in visited:
            path.append(node)
            visited.add(node_id)
    
    # 添加所有相关节点
    for node in relevant_nodes:
        add_node_with_dependencies(node["node_id"])
    
    # 返回路径（已按依赖关系排序）
    return path
```

---

### Step 4: 阶段划分

**AI提示词模板**：

```
基于以下学习节点，将其划分为合理的阶段：

学习节点列表：
{learning_nodes}

用户需求：
- 总时长：{total_duration}周
- 总目标：{final_goal}

请划分为3-4个阶段，每个阶段包含：
1. 阶段名称
2. 包含的学习节点
3. 阶段目标（3-5条）
4. 建议时长

输出格式：
{
  "phases": [
    {
      "phase_name": "基础阶段",
      "nodes": ["node1", "node2"],
      "objectives": ["目标1", "目标2"],
      "duration_weeks": 4
    }
  ]
}
```

---

### Step 5: 任务生成

**AI提示词模板**（为单个知识点生成任务）：

```
为以下知识点生成3-5个具体的学习任务：

知识点：{knowledge_node}
难度：{difficulty} (1-10)
预计时长：{estimated_hours}小时
学习风格：{learning_style}

要求：
1. 每个任务时长15-60分钟
2. 任务具体可执行（不是抽象的"学习XX"）
3. 有明确的验证方式
4. 遵循遗忘曲线（包含复习）

任务类型：
- 理论讲解：阅读/观看 + 总结
- 实践练习：做练习题/写代码
- 项目实战：完成小项目
- 复习巩固：回顾之前内容

输出格式：
{
  "tasks": [
    {
      "task_id": "task_1_1",
      "title": "任务标题",
      "description": "详细描述做什么",
      "duration_minutes": 30,
      "difficulty": 5,
      "bloom_level": "understand",
      "new_concepts": ["概念1", "概念2"],
      "recall_concepts": [],
      "verification": {
        "type": "quiz",
        "passing_score": 0.8
      }
    }
  ]
}
```

---

### Step 6: 难度曲线调整

**验证规则**：

```python
def validate_difficulty_curve(phases):
    """验证难度曲线是否合理"""
    
    all_tasks = []
    for phase in phases:
        all_tasks.extend(phase["tasks"])
    
    # 规则1: 总体难度渐进
    difficulties = [t["difficulty"] for t in all_tasks]
    for i in range(1, len(difficulties)):
        if difficulties[i] - difficulties[i-1] > 3:
            # 难度跳度过大
            print(f"警告: 任务{i}到{i+1}难度跳度过大")
            return False
    
    # 规则2: 阶段难度渐进
    for i in range(1, len(phases)):
        phase_avg_diff_prev = sum(t["difficulty"] for t in phases[i-1]["tasks"]) / len(phases[i-1]["tasks"])
        phase_avg_diff_curr = sum(t["difficulty"] for t in phases[i]["tasks"]) / len(phases[i]["tasks"])
        
        if phase_avg_diff_curr - phase_avg_diff_prev > 2:
            # 阶段间难度跳度过大
            print(f"警告: 阶段{i}到{i+1}难度跳度过大")
            return False
    
    # 规则3: 缓冲任务
    # 每10个任务插入1个复习任务
    review_interval = 10
    for i in range(review_interval, len(all_tasks), review_interval):
        if all_tasks[i]["bloom_level"] == "create":
            # 高难度任务前应该有复习
            print(f"建议: 任务{i+1}前插入复习任务")
    
    return True
```

---

### Step 7: 输出学习计划

**最终输出格式**：

```python
def generate_learning_plan(goal_name, phases):
    """生成最终学习计划"""
    
    plan = {
        "plan_id": f"{goal_name}_{datetime.now().strftime('%Y%m%d')}",
        "goal": goal_name,
        "created_at": datetime.now().isoformat(),
        
        "summary": {
            "total_duration_weeks": sum(p["duration_weeks"] for p in phases),
            "total_tasks": sum(len(p["tasks"]) for p in phases),
            "estimated_hours": sum(p["estimated_hours"] for p in phases)
        },
        
        "overview": {
            "phases": len(phases),
            "milestones": [
                {
                    "week": sum(p["duration_weeks"] for p in phases[:i+1]),
                    "title": phases[i]["phase_name"] + "完成"
                }
                for i in range(len(phases))
            ]
        },
        
        "phases": phases
    }
    
    return plan
```

---

## 🎨 英语四级技能树设计

### 技能树结构

```json
{
  "subject": "英语四级（CET-4）",
  "target_level": "初中生水平",
  "final_goal": "通过CET-4考试",
  
  "skill_areas": [
    {
      "area_id": "vocabulary",
      "name": "词汇",
      "nodes": [
        {
          "node_id": "basic_vocabulary",
          "name": "基础词汇（CET-4高频1500词）",
          "level": "beginner",
          "difficulty": 4,
          "estimated_hours": 20,
          "prerequisites": [],
          "objectives": [
            "掌握CET-4高频词汇1500个",
            "能熟练使用这些词汇"
          ]
        },
        {
          "node_id": "advanced_vocabulary",
          "name": "进阶词汇（CET-4中低频词）",
          "level": "intermediate",
          "difficulty": 5,
          "estimated_hours": 15,
          "prerequisites": ["basic_vocabulary"],
          "objectives": [
            "掌握CET-4中低频词汇1000个",
            "能区分同义词"
          ]
        }
      ]
    },
    {
      "area_id": "grammar",
      "name": "语法",
      "nodes": [
        {
          "node_id": "basic_grammar",
          "name": "基础语法",
          "level": "beginner",
          "difficulty": 5,
          "estimated_hours": 15,
          "prerequisites": [],
          "objectives": [
            "掌握基本句型结构",
            "熟悉时态和语态"
          ]
        },
        {
          "node_id": "advanced_grammar",
          "name": "进阶语法",
          "level": "intermediate",
          "difficulty": 6,
          "estimated_hours": 12,
          "prerequisites": ["basic_grammar"],
          "objectives": [
            "掌握复杂从句",
            "熟悉虚拟语气"
          ]
        }
      ]
    },
    {
      "area_id": "reading",
      "name": "阅读",
      "nodes": [
        {
          "node_id": "reading_comprehension",
          "name": "阅读理解",
          "level": "intermediate",
          "difficulty": 6,
          "estimated_hours": 20,
          "prerequisites": ["basic_vocabulary", "basic_grammar"],
          "objectives": [
            "能快速阅读理解文章",
            "掌握阅读技巧"
          ]
        }
      ]
    },
    {
      "area_id": "listening",
      "name": "听力",
      "nodes": [
        {
          "node_id": "listening_comprehension",
          "name": "听力理解",
          "level": "intermediate",
          "difficulty": 6,
          "estimated_hours": 20,
          "prerequisites": ["basic_vocabulary"],
          "objectives": [
            "能听懂日常对话",
            "能抓住听力材料要点"
          ]
        }
      ]
    },
    {
      "area_id": "writing",
      "name": "写作",
      "nodes": [
        {
          "node_id": "writing_basics",
          "name": "基础写作",
          "level": "intermediate",
          "difficulty": 5,
          "estimated_hours": 12,
          "prerequisites": ["basic_grammar"],
          "objectives": [
            "能写简单的短文",
            "掌握基本写作技巧"
          ]
        }
      ]
    },
    {
      "area_id": "exam_skills",
      "name": "考试技巧",
      "nodes": [
        {
          "node_id": "exam_strategy",
          "name": "考试策略",
          "level": "intermediate",
          "difficulty": 4,
          "estimated_hours": 5,
          "prerequisites": [
            "basic_vocabulary",
            "basic_grammar",
            "reading_comprehension"
          ],
          "objectives": [
            "熟悉CET-4考试题型",
            "掌握时间分配"
          ]
        },
        {
          "node_id": "mock_exam",
          "name": "模拟考试",
          "level": "advanced",
          "difficulty": 7,
          "estimated_hours": 20,
          "prerequisites": [
            "advanced_vocabulary",
            "advanced_grammar",
            "reading_comprehension",
            "listening_comprehension",
            "writing_basics",
            "exam_strategy"
          ],
          "objectives": [
            "完成3套完整模拟试卷",
            "分析错误",
            "查漏补缺"
          ]
        }
      ]
    }
  ],
  
  "total_duration_weeks": 12,
  "total_estimated_hours": 139,
  "recommended_schedule": {
    "daily_minutes": 35,
    "weekly_days": 6,
    "rest_day": 1
  }
}
```

---

## 🧪 AI测试方案

### 测试策略

```
不是让AI写代码，而是：
1. 用AI生成学习内容
2. 验证内容的合理性
3. 检查算法生成的任务是否可行
```

---

*文档版本：v1.0*  
*创建日期：2026-02-11*
