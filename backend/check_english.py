import sqlite3
import json

conn = sqlite3.connect(r'C:\Users\myadmin\.openclaw\workspace\ai-learning-platform\backend\prisma\dev.db')
conn.row_factory = sqlite3.Row
c = conn.cursor()

# 1. 查找用户
c.execute("SELECT id, email, username FROM User WHERE email LIKE '%english%'")
users = c.fetchall()
print('=== 用户信息 ===')
for u in users:
    print(f'ID: {u["id"]}, Email: {u["email"]}, Username: {u["username"]}')

if users:
    user_id = users[0]["id"]
    
    # 2. 查找学习路径
    c.execute("""
        SELECT id, title, totalWeeks, aiAnalysis 
        FROM LearningPath 
        WHERE userId = ?
        ORDER BY createdAt DESC
    """, (user_id,))
    paths = c.fetchall()
    
    print('\n=== 学习路径信息 ===')
    for p in paths:
        print(f'路径: {p["title"]}')
        print(f'  - ID: {p["id"]}')
        print(f'  - totalWeeks 字段: {p["totalWeeks"]}')
        
        # 3. 查询实际周数
        c.execute("SELECT COUNT(*) as cnt FROM Week WHERE learningPathId = ?", (p["id"],))
        week_count = c.fetchone()["cnt"]
        print(f'  - 实际weeks记录数: {week_count}')
        
        # 4. 查看周序号
        c.execute("SELECT weekNumber FROM Week WHERE learningPathId = ? ORDER BY weekNumber", (p["id"],))
        week_numbers = [row["weekNumber"] for row in c.fetchall()]
        print(f'  - weekNumber 值: {week_numbers}')
        
        # 5. 解析 AI 原始分析
        if p["aiAnalysis"]:
            try:
                ai = json.loads(p["aiAnalysis"])
                print(f'  - AI返回的 estimatedWeeks: {ai.get("estimatedWeeks", "无")}')
                print(f'  - AI返回的 weeklyPlan 长度: {len(ai.get("weeklyPlan", []))}')
                if ai.get("weeklyPlan"):
                    print('  - AI weeklyPlan 内容:')
                    for i, w in enumerate(ai.get("weeklyPlan", [])[:8]):  # 只显示前8周
                        print(f'      周{i+1}: {w.get("theme", "无主题")}')
                    if len(ai.get("weeklyPlan", [])) > 8:
                        print(f'      ... 还有 {len(ai.get("weeklyPlan", [])) - 8} 周')
            except:
                print('  - AI解析失败')

conn.close()
