import sqlite3

conn = sqlite3.connect('prisma/dev.db')
cursor = conn.cursor()

# Get users table schema
cursor.execute("PRAGMA table_info(users)")
columns = cursor.fetchall()

print('Users table columns:')
for col in columns:
    print(f'  - {col[1]} ({col[2]})')

# Get all users
cursor.execute("SELECT * FROM users")
users = cursor.fetchall()

print(f'\nFound {len(users)} users:')
for u in users:
    print(f'  User: {u}')

conn.close()
