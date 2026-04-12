"""
Test Prisma Client directly with Python
"""

import sqlite3

db_path = 'prisma/dev.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Test direct query
cursor.execute('SELECT id, email, name, isAdmin, createdAt, updatedAt FROM users WHERE email = "admin@example.com"')
row = cursor.fetchone()

if row:
    print('✅ Admin user found (via SQLite):')
    print(f'   ID: {row[0]}')
    print(f'   Email: {row[1]}')
    print(f'   Name: {row[2]}')
    print(f'   isAdmin: {row[3]}')
    print(f'   createdAt: {row[4]}')
    print(f'   updatedAt: {row[5]}')
else:
    print('❌ Admin user not found')

# Test all users
cursor.execute('SELECT COUNT(*) FROM users')
count = cursor.fetchone()[0]
print(f'\n📊 Total users: {count}')

conn.close()
