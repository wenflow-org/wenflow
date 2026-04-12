"""
Debug user data
"""

import sqlite3

db_path = 'prisma/dev.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get admin user
cursor.execute('SELECT * FROM users WHERE email = "admin@example.com"')
row = cursor.fetchone()

if row:
    # Get column names
    cursor.execute('PRAGMA table_info(users)')
    columns = cursor.fetchall()
    column_names = [col[1] for col in columns]
    
    print('Admin user data:')
    for i, (name, value) in enumerate(zip(column_names, row)):
        print(f'  {name}: {value} (type: {type(value).__name__})')
else:
    print('Admin user not found')

conn.close()
