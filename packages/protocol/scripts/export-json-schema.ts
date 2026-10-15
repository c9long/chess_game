/** Writes schema/protocol.schema.json (checked by src/json-schema.test.ts). */
import { writeFileSync } from 'node:fs'
import { buildProtocolJsonSchema } from '../src/json-schema.ts'

const out = new URL('../schema/protocol.schema.json', import.meta.url)
writeFileSync(out, `${JSON.stringify(buildProtocolJsonSchema(), null, 2)}\n`)
console.log(`wrote ${out.pathname}`)
