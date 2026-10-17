import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto'

/**
 * A minimal software passkey (ES256, "none" attestation) for driving Better Auth's passkey
 * endpoints from tests, like a browser with a platform authenticator would.
 */

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | { [k: string]: Cbor }

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n])
  if (n < 0x10000) {
    const b = Buffer.alloc(3)
    b[0] = (major << 5) | 25
    b.writeUInt16BE(n, 1)
    return b
  }
  const b = Buffer.alloc(5)
  b[0] = (major << 5) | 26
  b.writeUInt32BE(n, 1)
  return b
}

/** Just enough CBOR (RFC 8949) for an attestation object and a COSE key. */
export function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v)
  if (typeof v === 'string') {
    const s = Buffer.from(v, 'utf8')
    return Buffer.concat([head(3, s.length), s])
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)])
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)])
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v)
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)]),
  ])
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest()

export class SoftPasskey {
  readonly credentialId = randomBytes(32)
  private readonly privateKey: KeyObject
  private readonly publicJwk: { x: string; y: string }
  private counter = 0

  readonly rpId: string
  readonly origin: string

  constructor(rpId: string, origin: string) {
    this.rpId = rpId
    this.origin = origin
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    this.privateKey = privateKey
    const jwk = publicKey.export({ format: 'jwk' })
    this.publicJwk = { x: jwk.x as string, y: jwk.y as string }
  }

  get id(): string {
    return b64url(this.credentialId)
  }

  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }))
  }

  private authData(flags: number, attested?: Buffer): Buffer {
    const count = Buffer.alloc(4)
    count.writeUInt32BE(this.counter)
    return Buffer.concat([
      sha256(this.rpId),
      Buffer.from([flags]),
      count,
      attested ?? Buffer.alloc(0),
    ])
  }

  /** `RegistrationResponseJSON` for options from generate-register-options. */
  register(options: { challenge: string }) {
    const cose = cbor(
      new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(this.publicJwk.x, 'base64url')],
        [-3, Buffer.from(this.publicJwk.y, 'base64url')],
      ]),
    )
    const idLen = Buffer.alloc(2)
    idLen.writeUInt16BE(this.credentialId.length)
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, cose])
    // UP | UV | AT
    const authData = this.authData(0x45, attested)
    const attestationObject = cbor({ fmt: 'none', attStmt: {}, authData })
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  /** `AuthenticationResponseJSON` for options from generate-authenticate-options. */
  assert(options: { challenge: string }) {
    this.counter++
    const authData = this.authData(0x05) // UP | UV
    const clientDataJSON = this.clientData('webauthn.get', options.challenge)
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.privateKey,
    )
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }
}
