import { createDb } from './index.ts'
import { seedCatalog } from './seed.ts'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}
const { db, close } = createDb(url, { max: 1 })
try {
  await seedCatalog(db)
  console.log('catalog seeded')
} finally {
  await close()
}
