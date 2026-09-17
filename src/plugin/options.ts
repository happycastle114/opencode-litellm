import { InstallAuth } from '../cli/install-intent'

export class PluginAuthConfigurationError extends Error {
  readonly name = 'PluginAuthConfigurationError'
}

export function parsePluginAuth(
  options: Readonly<Record<string, unknown>> | undefined,
): InstallAuth | undefined {
  const auth = options?.auth
  switch (auth) {
    case undefined:
    case InstallAuth.Environment:
    case InstallAuth.Sso:
      return auth
    default:
      throw new PluginAuthConfigurationError(
        `Invalid auth option: expected '${InstallAuth.Environment}' or '${InstallAuth.Sso}'.`,
      )
  }
}
