import sqlite3
import json

db_path = r'C:\Users\myadmin\.openclaw\workspace\ai-learning-platform\backend\prisma\dev.db'
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
c = conn.cursor()

# 1. Find English user
c.execute("SELECT id, email, username FROM users WHERE email LIKE '%english%'")
users = c.fetchall()
print('=== 用户信息 ===')
for u in users:
    print(f'ID: {u["id"]}, Email: {u["email"]}, Username: {u["username"]}')

if users:
    user_id = users[0]["id"]
    
    # 2. Find learning paths
    c.execute("""
        SELECT id, title, totalWeeks, aiAnalysis 
        FROM learning_paths 
        WHERE userId = ?
        ORDER BY createdAt DESC
    """, (user_id,))
    paths = c.fetchall()
    
    print('\n=== 学习路径信息 ===')
    for p in paths:
        print(f'路径: {p["title"]}')
        print(f'  - ID: {p["id"]}')
        print(f'  - totalWeeks 字段值: {p["totalWeeks"]}')
        
        # 3. Count actual weeks
        c.execute("SELECT COUNT(*) as cnt FROM weeks WHERE learningPathId = ?", (p["id"],))
        week_count = c.fetchone()["cnt"]
        print(f'  - 实际weeks记录数: {week_count}')
        
        # 4. Get week numbers
        c.execute("SELECT weekNumber FROM weeks WHERE learningPathId = ? ORDER BY weekNumber", (p["id"],))
        week_numbers = [row["weekNumber"] for row in c.fetchall()]
        print(f'  - weekNumber 值列表: {week_numbers}')
        
        # 5. Parse AI analysis
        if p["aiAnalysis"]:
            try:
                ai = json.loads(p["aiAnalysis"])
                print(f'  - AI返回 estimatedWeeks: {ai.get("estimatedWeeks", "无")}')
                print(f'  - AI返回 totalWeeks: {ai.get("totalWeeks", "无")}')
                print(f'  - AI返回 weeklyPlan 长度: {len(ai.get("weeklyPlan", []))}')
                if ai.get("weeklyPlan"):
                    print('  - AI weeklyPlan 内容预览:')
                    for i, w in enumerate(ai.get("weeklyPlan", [])[:10]):
                        print(f'      周{i+1}: {w.get("theme", "无主题")[:50]}')
                    if len(ai.get("weeklyPlan", [])) > 10:
                        print(f'      ... 还有 {len(ai.get("weeklyPlan", [])) - 10} 周')
            except Exception as e:
                print(f'  - AI解析失败: {e}')

conn.close()
