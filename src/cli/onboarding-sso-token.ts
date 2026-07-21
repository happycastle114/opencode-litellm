import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isHeaderSafeApiKey } from '../utils/api-key'
import {
  ERROR_CODE,
  SsoOnboardingError,
  type Credential,
} from './onboarding-sso-contracts'

const [FILE_MODE, DIRECTORY_MODE] = [0o600, 0o700] as const
const PLATFORM = { Windows: 'win32' } as const
const IS_WINDOWS = process.platform === PLATFORM.Windows
const TOKEN_FILE_RELATIVE_PATH = ['.litellm', 'token.json'] as const

export function defaultTokenPath(): string {
  return join(process.env.HOME ?? homedir(), ...TOKEN_FILE_RELATIVE_PATH)
}

export function createSsoToken(
  baseUrl: string,
  credential: Credential,
  completedAt: number,
): Readonly<Record<string, unknown>> {
  return {
    base_url: baseUrl,
    key: credential.key,
    user_id: credential.userId ?? 'cli-user',
    user_email: 'unknown',
    user_role: 'cli',
    auth_header_name: 'Authorization',
    jwt_token: '',
    timestamp: completedAt / 1000,
  }
}

export function persistSsoToken(
  path: string,
  token: Readonly<Record<string, unknown>>,
): void {
  if (!isHeaderSafeApiKey(token.key)) {
    throw new SsoOnboardingError(ERROR_CODE.TokenWrite)
  }
  const directory = dirname(path)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  let temporaryCreated = false
  try {
    mkdirSync(directory, {
      recursive: true,
      ...(IS_WINDOWS ? {} : { mode: DIRECTORY_MODE }),
    })
    writeFileSync(temporary, JSON.stringify(token, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
      ...(IS_WINDOWS ? {} : { mode: FILE_MODE }),
    })
    temporaryCreated = true
    renameSync(temporary, path)
    if (!IS_WINDOWS) chmodSync(path, FILE_MODE)
  } catch {
    if (temporaryCreated && existsSync(temporary)) unlinkSync(temporary)
    throw new SsoOnboardingError(ERROR_CODE.TokenWrite)
  }
}
