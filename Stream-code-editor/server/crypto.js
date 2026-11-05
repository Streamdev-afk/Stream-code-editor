import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_ENV = process.env.GITHUB_TOKEN_ENCRYPTION_KEY

let key = null

if (KEY_ENV) {
  try {
    key = Buffer.from(KEY_ENV, 'base64')
    if (key.length !== 32) {
      console.warn('⚠️  GITHUB_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64). Got', key.length, 'bytes.')
      key = null
    }
  } catch (e) {
    console.warn('⚠️  GITHUB_TOKEN_ENCRYPTION_KEY is not valid base64.')
    key = null
  }
}

if (!key) {
  console.warn('⚠️  GITHUB_TOKEN_ENCRYPTION_KEY missing — GitHub token storage disabled')
}

export function isCryptoConfigured() {
  return !!key
}

/**
 * Encrypt a string. Returns "iv:authTag:ciphertext" (all base64).
 */
export function encrypt(plaintext) {
  if (!key) throw new Error('Encryption not configured')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':')
}

/**
 * Decrypt an encrypted string produced by `encrypt`.
 */
export function decrypt(payload) {
  if (!key) throw new Error('Encryption not configured')
  const [ivB64, tagB64, ctB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Invalid encrypted payload')
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}