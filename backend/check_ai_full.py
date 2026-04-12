import sqlite3
import json

db_path = r'C:\Users\myadmin\.openclaw\workspace\ai-learning-platform\backend\prisma\dev.db'
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
c = conn.cursor()

# Get full aiPromptTemplate
c.execute("SELECT aiPromptTemplate FROM learning_paths WHERE id = 'c4e06c29-eebc-4c93-a9bf-fc1d2a9aa49b'")
row = c.fetchone()
if row and row["aiPromptTemplate"]:
    ai = json.loads(row["aiPromptTemplate"])
    print('=== 完整 AI 返回数据结构 ===')
    print('顶层 keys:', list(ai.keys()))
    
    # Check for different possible field names
    for key in ['weeklyPlan', 'weeks', 'weekly_plan', 'WeeklyPlan', 'plan']:
        if key in ai:
            print(f'\n{key}:')
            print(json.dumps(ai[key], indent=2, ensure_ascii=False)[:3000])
    
    # Print full content
    print('\n\n=== 完整 JSON (前5000字符) ===')
    print(json.dumps(ai, indent=2, ensure_ascii=False)[:5000])

conn.close()
