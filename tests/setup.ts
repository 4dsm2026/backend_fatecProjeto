import { randomBytes } from 'node:crypto'

// Minimum env vars required before any src/ module is imported.
// DATABASE_URL is required by env.ts validation but never used — Prisma is mocked.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/test_db'
process.env.JWT_ACCESS_SECRET ??= randomBytes(32).toString('hex')
process.env.JWT_REFRESH_SECRET ??= randomBytes(32).toString('hex')
process.env.JWT_ISSUER = 'helpdesk'
process.env.JWT_AUDIENCE = 'helpdesk-app'
process.env.JWT_ACCESS_EXPIRES = '15m'
process.env.JWT_REFRESH_EXPIRES = '7d'
process.env.CORS_ORIGIN = 'http://localhost:3000'
process.env.COOKIE_SECRET ??= randomBytes(32).toString('hex')
process.env.STORAGE_DRIVER = 'local'
process.env.LOCAL_STORAGE_DIR = '/tmp/test-uploads'
process.env.DEFAULT_TEMP_PASSWORD ??= `${randomBytes(24).toString('base64url')}A1!`
process.env.ANON_EMAIL_DOMAIN = 'anon.local'
process.env.ANON_EDU_DOMAIN = 'anon.edu.local'
