"""
Check all DateTime fields in users table
"""

import sqlite3
import re

db_path = 'prisma/dev.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get all users
cursor.execute('SELECT id, email, createdAt, updatedAt FROM users')
users = cursor.fetchall()

print('Checking DateTime fields:\n')

iso_pattern = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}')

for user in users:
    user_id, email, created_at, updated_at = user
    
    # Check if it's a valid ISO format
    if isinstance(created_at, str):
        if iso_pattern.match(created_at):
            print(f'✓ {email}: createdAt = {created_at}')
        else:
            print(f'✗ {email}: createdAt = {created_at} (INVALID FORMAT)')
    else:
        print(f'✗ {email}: createdAt = {created_at} (TYPE: {type(created_at).__name__})')

conn.close()
