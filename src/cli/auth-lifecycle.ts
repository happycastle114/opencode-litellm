import { readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isHeaderSafeApiKey } from '../utils/api-key'

const TOKEN_FILE = {
  directory: '.litellm',
  name: 'token.json',
  baseUrl: 'base_url',
  key: 'key',
  userId: 'user_id',
  userEmail: 'user_email',
  userRole: 'user_role',
  timestamp: 'timestamp',
} as const

const INSPECTION_STATUS = {
  Authenticated: 'authenticated',
  Missing: 'missing',
  Malformed: 'malformed',
  Mismatch: 'mismatch',
} as const

const LOGOUT_STATUS = {
  Removed: 'removed',
  Absent: 'absent',
} as const

const ERROR_CODE = {
  ReadFailed: 'read-failed',
  DeleteFailed: 'delete-failed',
} as const

export const AuthInspectionStatus = INSPECTION_STATUS
export type AuthInspectionStatus = (typeof INSPECTION_STATUS)[keyof typeof INSPECTION_STATUS]

export const AuthLogoutStatus = LOGOUT_STATUS
export type AuthLogoutStatus = (typeof LOGOUT_STATUS)[keyof typeof LOGOUT_STATUS]

export type AuthLifecycleErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE]

export type LiteLLMAuthInspectionInput = {
  readonly baseUrl: string
  readonly tokenFilePath?: string
}

export type LiteLLMAuthInspection = {
  readonly status: AuthInspectionStatus
  readonly tokenPresent: boolean
  readonly baseUrl?: string
  readonly userId?: string
  readonly userEmail?: string
  readonly userRole?: string
  readonly timestamp?: number
}

export type LiteLLMAuthLogoutInput = {
  readonly tokenFilePath?: string
}

export type LiteLLMAuthLogoutResult = {
  readonly status: AuthLogoutStatus
}

export class LiteLLMAuthLifecycleError extends Error {
  readonly name = 'LiteLLMAuthLifecycleError'

  constructor(readonly code: AuthLifecycleErrorCode) {
    super(`LiteLLM auth lifecycle failed (${code}).`)
  }
}

export function inspectLiteLLMAuth(
  input: LiteLLMAuthInspectionInput,
): LiteLLMAuthInspection {
  const path = resolveTokenFilePath(input.tokenFilePath)
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return { status: INSPECTION_STATUS.Missing, tokenPresent: false }
    }
    throw new LiteLLMAuthLifecycleError(ERROR_CODE.ReadFailed)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return { status: INSPECTION_STATUS.Malformed, tokenPresent: false }
  }
  if (!isRecord(parsed)) {
    return { status: INSPECTION_STATUS.Malformed, tokenPresent: false }
  }

  const tokenPresent = isHeaderSafeApiKey(parsed[TOKEN_FILE.key])
  const baseUrl = parsed[TOKEN_FILE.baseUrl]
  if (!isNonEmptyString(baseUrl)) {
    return { status: INSPECTION_STATUS.Malformed, tokenPresent }
  }

  const metadata = readSafeMetadata(parsed, baseUrl, tokenPresent)
  if (metadata === undefined) {
    return { status: INSPECTION_STATUS.Malformed, tokenPresent }
  }

  const expectedBaseUrl = input.baseUrl.replace(/\/+$/, '')
  return baseUrl === expectedBaseUrl
    ? { status: INSPECTION_STATUS.Authenticated, ...metadata }
    : { status: INSPECTION_STATUS.Mismatch, ...metadata }
}

export function logoutLiteLLMAuth(
  input: LiteLLMAuthLogoutInput = {},
): LiteLLMAuthLogoutResult {
  const path = resolveTokenFilePath(input.tokenFilePath)
  try {
    unlinkSync(path)
    return { status: LOGOUT_STATUS.Removed }
  } catch (error: unknown) {
    if (isMissingFile(error)) return { status: LOGOUT_STATUS.Absent }
    throw new LiteLLMAuthLifecycleError(ERROR_CODE.DeleteFailed)
  }
}

export function resolveLiteLLMAuthTokenPath(tokenFilePath?: string): string {
  return tokenFilePath ?? join(process.env.HOME ?? homedir(), TOKEN_FILE.directory, TOKEN_FILE.name)
}

function resolveTokenFilePath(tokenFilePath: string | undefined): string {
  return resolveLiteLLMAuthTokenPath(tokenFilePath)
}

function readSafeMetadata(
  parsed: Readonly<Record<string, unknown>>,
  baseUrl: string,
  tokenPresent: boolean,
): (Omit<LiteLLMAuthInspection, 'status'> & { readonly tokenPresent: boolean }) | undefined {
  const userId = optionalString(parsed[TOKEN_FILE.userId])
  const userEmail = optionalString(parsed[TOKEN_FILE.userEmail])
  const userRole = optionalString(parsed[TOKEN_FILE.userRole])
  const timestamp = parsed[TOKEN_FILE.timestamp]
  if (
    !optionalFieldIsValid(parsed, TOKEN_FILE.userId, userId) ||
    !optionalFieldIsValid(parsed, TOKEN_FILE.userEmail, userEmail) ||
    !optionalFieldIsValid(parsed, TOKEN_FILE.userRole, userRole) ||
    timestamp !== undefined && (typeof timestamp !== 'number' || !Number.isFinite(timestamp))
  ) {
    return undefined
  }
  return {
    tokenPresent,
    baseUrl,
    ...(userId === undefined ? {} : { userId }),
    ...(userEmail === undefined ? {} : { userEmail }),
    ...(userRole === undefined ? {} : { userRole }),
    ...(timestamp === undefined ? {} : { timestamp }),
  }
}

function optionalFieldIsValid(
  record: Readonly<Record<string, unknown>>,
  field: string,
  value: string | undefined,
): boolean {
  return record[field] === undefined || value !== undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT'
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
