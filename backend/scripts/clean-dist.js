const fs = require('fs')
const path = require('path')

fs.rmSync(path.resolve(__dirname, '..', 'dist'), { recursive: true, force: true })
