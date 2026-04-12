import sqlite3
import json

db_path = r'C:\Users\myadmin\.openclaw\workspace\ai-learning-platform\backend\prisma\dev.db'
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
c = conn.cursor()

# List tables
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in c.fetchall()]
print("Tables:", tables)

conn.close()
