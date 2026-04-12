import sqlite3
import bcrypt

conn = sqlite3.connect('prisma/dev.db')
cursor = conn.cursor()

# Check if isAdmin column exists
cursor.execute("PRAGMA table_info(users)")
columns = [col[1] for col in cursor.fetchall()]

if 'isAdmin' not in columns:
    print('Adding isAdmin column to users table...')
    cursor.execute('ALTER TABLE users ADD COLUMN isAdmin BOOLEAN DEFAULT false')
    conn.commit()
    print('Column added successfully!')

# Check if admin already exists
cursor.execute("SELECT id, email FROM users WHERE isAdmin = true")
admin = cursor.fetchone()

if admin:
    print(f'\nAdmin user already exists: {admin[1]} (ID: {admin[0]})')
else:
    print('\nCreating admin user...')
    
    # Generate admin data
    admin_id = 'cmmtz-admin-' + str(int(__import__('time').time()))
    email = 'admin@example.com'
    name = '系统管理员'
    password = 'admin123'
    hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    # Insert admin user
    cursor.execute('''
        INSERT INTO users (id, email, name, password, role, currentLevel, xp, isAdmin, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (admin_id, email, name, hashed_password, 'admin', 'beginner', 9999, 1, 
          __import__('time').time() * 1000, __import__('time').time() * 1000))
    
    conn.commit()
    print(f'\n✅ Admin user created successfully!')
    print(f'   Email: {email}')
    print(f'   Password: {password}')
    print(f'   ID: {admin_id}')

conn.close()
