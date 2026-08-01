const fs = require('fs')
const path = require('path')

const source = path.resolve(__dirname, '..', 'src', 'generated', 'system-client')
const destination = path.resolve(__dirname, '..', 'dist', 'generated', 'system-client')

if (!fs.existsSync(source)) {
  throw new Error('Generated System Prisma Client is missing. Run npm run prisma:generate:system first.')
}

fs.rmSync(destination, { recursive: true, force: true })
fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.cpSync(source, destination, { recursive: true })
