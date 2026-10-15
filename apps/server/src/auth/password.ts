import { hash, verify } from '@node-rs/argon2'

/**
 * argon2id parameters from PLAN §1 (OWASP minimum): 19 MiB memory, 2 iterations,
 * 1 lane. `algorithm: 2` is Algorithm.Argon2id (an ambient const enum we can't import
 * under isolatedModules).
 */
export const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

export async function verifyPassword({
  hash: stored,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  if (!stored.startsWith('$argon2')) return false
  try {
    return await verify(stored, password)
  } catch {
    return false
  }
}
