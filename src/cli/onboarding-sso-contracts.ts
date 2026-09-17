import type { NativeLiteBoundary } from './native-lite'

export const RESULT_STATUS = {
  Authenticated: 'authenticated',
} as const

export const ERROR_CODE = {
  NativeLogin: 'native_login_failed',
} as const

export type SsoOnboardingBoundaries = NativeLiteBoundary

export type SsoOnboardingInput = {
  readonly baseUrl: string
  readonly tokenFilePath?: string
  readonly boundaries?: SsoOnboardingBoundaries
}

export type SsoOnboardingResult = {
  readonly status: typeof RESULT_STATUS.Authenticated
}

export class SsoOnboardingError extends Error {
  readonly name = 'SsoOnboardingError'

  constructor(readonly code: typeof ERROR_CODE[keyof typeof ERROR_CODE], message: string) {
    super(message)
  }
}
