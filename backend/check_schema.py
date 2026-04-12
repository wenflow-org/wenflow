import sqlite3

db_path = r'C:\Users\myadmin\.openclaw\workspace\ai-learning-platform\backend\prisma\dev.db'
conn = sqlite3.connect(db_path)
c = conn.cursor()

# Get users table schema
c.execute("PRAGMA table_info(users)")
columns = c.fetchall()
print("=== users表结构 ===")
for col in columns:
    print(f'{col[1]}: {col[2]}')

c.execute("PRAGMA table_info(learning_paths)")
columns = c.fetchall()
print("\n=== learning_paths表结构 ===")
for col in columns:
    print(f'{col[1]}: {col[2]}')

c.execute("PRAGMA table_info(weeks)")
columns = c.fetchall()
print("\n=== weeks表结构 ===")
for col in columns:
    print(f'{col[1]}: {col[2]}')

conn.close()
