# -*- coding: utf-8 -*-
import re

# 读取文件
with open('prisma/schema.prisma', 'r', encoding='utf-8') as f:
    content = f.read()

# 定义新的 PathDecomposition 模型
new_model = '''
model PathDecomposition {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  learningPathId  String?
  learningPath    LearningPath? @relation(fields: [learningPathId], references: [id], onDelete: SetNull)

  goalDescription String   // 学习目标
  subject         String?  // 学科

  aiAnalysis      String?  // JSON - AI 分析结果
  metadata        String?  // JSON - 额外元数据

  decompositionType String? @default("initial")
  success           Boolean @default(true)
  error             String?
  durationMs        Int     // 耗时（毫秒）

  createdAt DateTime @default(now())

  @@index([userId])
  @@index([success])
  @@index([createdAt])
  @@map("path_decompositions")
}
'''

# 查找并替换旧的 PathDecomposition 模型
pattern = r'model PathDecomposition \{[^}]*\}'
content = re.sub(pattern, new_model.strip(), content, flags=re.DOTALL)

# 写回文件
with open('prisma/schema.prisma', 'w', encoding='utf-8') as f:
    f.write(content)

print("Schema updated successfully!")
