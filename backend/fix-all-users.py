"""
Check and fix all users createdAt/updatedAt fields
"""

import sqlite3
from datetime import datetime

db_path = 'prisma/dev.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get all users
cursor.execute('SELECT id, email, name, createdAt, updatedAt FROM users')
users = cursor.fetchall()

print(f'Found {len(users)} users:\n')

fixed_count = 0
for user in users:
    user_id, email, name, created_at, updated_at = user
    
    # Check if timestamps are valid (should be ISO format or integer milliseconds)
    try:
        # Try to parse as integer (milliseconds)
        if isinstance(created_at, int) or (isinstance(created_at, str) and created_at.isdigit()):
            # Convert from milliseconds to ISO format
            created_dt = datetime.fromtimestamp(int(created_at) / 1000)
            created_iso = created_dt.isoformat()
            
            updated_dt = datetime.fromtimestamp(int(updated_at) / 1000)
            updated_iso = updated_dt.isoformat()
            
            # Update the record
            cursor.execute(
                'UPDATE users SET createdAt = ?, updatedAt = ? WHERE id = ?',
                (created_iso, updated_iso, user_id)
            )
            fixed_count += 1
            print(f'  Fixed: {email} ({name})')
            print(f'    createdAt: {created_at} -> {created_iso}')
            print(f'    updatedAt: {updated_at} -> {updated_iso}')
        else:
            print(f'  OK: {email} ({name}) - {created_at}')
    except Exception as e:
        print(f'  Error: {email} ({name}) - {e}')

conn.commit()
conn.close()

print(f'\n✅ Fixed {fixed_count} users')
