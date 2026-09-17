import {
  ERROR_CODE,
  RESULT_STATUS,
  SsoOnboardingError,
  type SsoOnboardingInput,
  type SsoOnboardingResult,
} from './onboarding-sso-contracts'
import {
  NativeLiteCommand,
  NativeLiteError,
  runNativeLite,
} from './native-lite'
import { loadOfficialLiteLLMApiKey, readOfficialLiteLLMTokenTimestamp } from './official-token'

export {
  SsoOnboardingError,
  type SsoOnboardingBoundaries,
  type SsoOnboardingInput,
  type SsoOnboardingResult,
} from './onboarding-sso-contracts'

export async function onboardLiteLLMSso(input: SsoOnboardingInput): Promise<SsoOnboardingResult> {
  try {
    const previousTimestamp = readOfficialLiteLLMTokenTimestamp(input.tokenFilePath)
    runNativeLite({
      command: NativeLiteCommand.Login,
      baseUrl: input.baseUrl,
      tokenFilePath: input.tokenFilePath,
    }, input.boundaries)
    const timestamp = readOfficialLiteLLMTokenTimestamp(input.tokenFilePath)
    // Native save_cli_token stamps each saved login strictly after the prior credential.
    if (timestamp === undefined || previousTimestamp !== undefined && timestamp <= previousTimestamp) {
      throw incompleteNativeLogin()
    }
    const key = loadOfficialLiteLLMApiKey({
      tokenFilePath: input.tokenFilePath,
      expectedBaseURL: input.baseUrl,
      native: input.boundaries,
    })
    if (key === undefined) throw incompleteNativeLogin()
  } catch (error) {
    if (error instanceof NativeLiteError) {
      throw new SsoOnboardingError(ERROR_CODE.NativeLogin, error.message)
    }
    throw error
  }
  return { status: RESULT_STATUS.Authenticated }
}

function incompleteNativeLogin(): SsoOnboardingError {
  return new SsoOnboardingError(
    ERROR_CODE.NativeLogin,
    'Official LiteLLM login did not create a new usable credential for this gateway. Run lite login --pkce again.',
  )
}
