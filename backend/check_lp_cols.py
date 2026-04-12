import sqlite3

db_path = r'C:\Users\myadmin\.openclaw\workspace\ai-learning-platform\backend\prisma\dev.db'
conn = sqlite3.connect(db_path)
c = conn.cursor()

# Get all learning_paths columns
c.execute("PRAGMA table_info(learning_paths)")
columns = c.fetchall()
print("=== learning_paths 所有列 ===")
for col in columns:
    print(f'{col[1]}: {col[2]}')

conn.close()
