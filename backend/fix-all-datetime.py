"""
Fix all invalid DateTime fields in database
"""

import sqlite3
from datetime import datetime

db_path = 'prisma/dev.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def fix_timestamp(cursor, table, column, id_value, timestamp):
    """Convert millisecond timestamp to ISO format"""
    try:
        ts = int(timestamp)
        dt = datetime.fromtimestamp(ts / 1000)
        iso_format = dt.isoformat()
        cursor.execute(f'UPDATE {table} SET {column} = ? WHERE id = ?', (iso_format, id_value))
        return True
    except Exception as e:
        print(f'  Error fixing {table}.{column}[{id_value}]: {e}')
        return False

def fix_datetime(cursor, table, column, id_value, dt_string):
    """Fix datetime string format"""
    try:
        dt = datetime.strptime(dt_string, '%Y-%m-%d %H:%M:%S')
        iso_format = dt.isoformat()
        cursor.execute(f'UPDATE {table} SET {column} = ? WHERE id = ?', (iso_format, id_value))
        return True
    except Exception as e:
        print(f'  Error fixing {table}.{column}[{id_value}]: {e}')
        return False

fixed_count = 0

# Fix _prisma_migrations
print('Fixing _prisma_migrations...')
cursor.execute("SELECT id, finished_at FROM _prisma_migrations WHERE finished_at IS NOT NULL AND finished_at NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, '_prisma_migrations', 'finished_at', row[0], row[1]):
        fixed_count += 1

cursor.execute("SELECT id, started_at FROM _prisma_migrations WHERE started_at IS NOT NULL AND started_at NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, '_prisma_migrations', 'started_at', row[0], row[1]):
        fixed_count += 1

# Fix agent_registrations
print('Fixing agent_registrations...')
cursor.execute("SELECT id, createdAt FROM agent_registrations WHERE createdAt NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, 'agent_registrations', 'createdAt', row[0], row[1]):
        fixed_count += 1

cursor.execute("SELECT id, updatedAt FROM agent_registrations WHERE updatedAt NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, 'agent_registrations', 'updatedAt', row[0], row[1]):
        fixed_count += 1

# Fix skill_registrations
print('Fixing skill_registrations...')
cursor.execute("SELECT id, createdAt FROM skill_registrations WHERE createdAt NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, 'skill_registrations', 'createdAt', row[0], row[1]):
        fixed_count += 1

cursor.execute("SELECT id, updatedAt FROM skill_registrations WHERE updatedAt NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, 'skill_registrations', 'updatedAt', row[0], row[1]):
        fixed_count += 1

# Fix student_baselines
print('Fixing student_baselines...')
cursor.execute("SELECT id, createdAt FROM student_baselines WHERE createdAt NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, 'student_baselines', 'createdAt', row[0], row[1]):
        fixed_count += 1

cursor.execute("SELECT id, updatedAt FROM student_baselines WHERE updatedAt NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, 'student_baselines', 'updatedAt', row[0], row[1]):
        fixed_count += 1

# Fix learning_sessions
print('Fixing learning_sessions...')
cursor.execute("SELECT id, startTime FROM learning_sessions WHERE startTime NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, 'learning_sessions', 'startTime', row[0], row[1]):
        fixed_count += 1

cursor.execute("SELECT id, createdAt FROM learning_sessions WHERE createdAt NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, 'learning_sessions', 'createdAt', row[0], row[1]):
        fixed_count += 1

cursor.execute("SELECT id, updatedAt FROM learning_sessions WHERE updatedAt NOT LIKE '____-__-__T%'")
for row in cursor.fetchall():
    if fix_timestamp(cursor, 'learning_sessions', 'updatedAt', row[0], row[1]):
        fixed_count += 1

# Fix learning_sessions with "YYYY-MM-DD HH:MM:SS" format
cursor.execute("SELECT id, createdAt FROM learning_sessions WHERE createdAt LIKE '____-__-__ __:__:__'")
for row in cursor.fetchall():
    if fix_datetime(cursor, 'learning_sessions', 'createdAt', row[0], row[1]):
        fixed_count += 1

cursor.execute("SELECT id, updatedAt FROM learning_sessions WHERE updatedAt LIKE '____-__-__ __:__:__'")
for row in cursor.fetchall():
    if fix_datetime(cursor, 'learning_sessions', 'updatedAt', row[0], row[1]):
        fixed_count += 1

conn.commit()
conn.close()

print(f'\n✅ Fixed {fixed_count} DateTime fields')