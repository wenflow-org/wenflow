"""
Check remaining invalid DateTime fields
"""

import sqlite3

db_path = 'prisma/dev.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print('Checking learning_sessions...')
cursor.execute("SELECT id, createdAt, updatedAt FROM learning_sessions")
for row in cursor.fetchall():
    id, created, updated = row
    if not created or not created.startswith('20'):
        print(f'  Invalid createdAt: {id} = {created}')
    if not updated or not updated.startswith('20'):
        print(f'  Invalid updatedAt: {id} = {updated}')

print('\nChecking all tables for non-ISO dates...')
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()

for (table_name,) in cursor.fetchall():
    try:
        cursor.execute(f'PRAGMA table_info({table_name})')
        columns = cursor.fetchall()
        datetime_cols = [col[1] for col in columns if 'date' in col[2].lower() or 'time' in col[2].lower()]
        
        for col in datetime_cols:
            cursor.execute(f'SELECT id, {col} FROM {table_name} WHERE {col} IS NOT NULL AND {col} NOT LIKE "____-__-__T%" LIMIT 5')
            invalid = cursor.fetchall()
            if invalid:
                print(f'\n{table_name}.{col}:')
                for row in invalid:
                    print(f'  {row[0]}: {row[1]}')
    except:
        pass

conn.close()
