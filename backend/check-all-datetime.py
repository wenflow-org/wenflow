"""
Check all DateTime fields in all tables
"""

import sqlite3
import re

db_path = 'prisma/dev.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get all tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [t[0] for t in cursor.fetchall()]

print(f'Found {len(tables)} tables\n')

iso_pattern = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}')

for table in tables:
    # Get column info
    cursor.execute(f'PRAGMA table_info({table})')
    columns = cursor.fetchall()
    
    # Find DateTime columns
    datetime_cols = [col[1] for col in columns if col[2].upper() in ['DATETIME', 'DATE', 'TIMESTAMP']]
    
    if datetime_cols:
        print(f'Table: {table}')
        print(f'  DateTime columns: {datetime_cols}')
        
        # Check for invalid data
        for col in datetime_cols:
            cursor.execute(f'SELECT COUNT(*) FROM {table} WHERE {col} IS NOT NULL AND {col} NOT LIKE "____-__-__T__:__:__%"')
            invalid_count = cursor.fetchone()[0]
            if invalid_count > 0:
                print(f'  ⚠️  Found {invalid_count} invalid rows in column {col}')
                
                # Show sample invalid rows
                cursor.execute(f'SELECT id, {col} FROM {table} WHERE {col} IS NOT NULL AND {col} NOT LIKE "____-__-__T__:__:__%" LIMIT 5')
                invalid_rows = cursor.fetchall()
                for row in invalid_rows:
                    print(f'      ID: {row[0]}, {col}: {row[1]}')
        
        print()

conn.close()
print('Done!')
