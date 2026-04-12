"""
Fix admin user createdAt/updatedAt fields
"""

import sqlite3
from datetime import datetime

db_path = 'prisma/dev.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get current timestamp
now = datetime.now().isoformat()

# Fix admin user
admin_id = 'cmmtz-admin-1773713500'
cursor.execute(
    """UPDATE users 
       SET createdAt = ?, updatedAt = ? 
       WHERE id = ?""",
    (now, now, admin_id)
)

conn.commit()

# Verify
cursor.execute('SELECT id, email, name, isAdmin, createdAt FROM users WHERE id = ?', (admin_id,))
row = cursor.fetchone()

if row:
    print('✅ Admin user fixed successfully!')
    print(f'   ID: {row[0]}')
    print(f'   Email: {row[1]}')
    print(f'   Name: {row[2]}')
    print(f'   isAdmin: {row[3]}')
    print(f'   createdAt: {row[4]}')
else:
    print('❌ Admin user not found')

conn.close()
