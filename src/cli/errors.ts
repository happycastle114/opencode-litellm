export class ConfigurationError extends Error {
  readonly name = 'ConfigurationError'

  constructor(
    message: string,
    readonly path: string | undefined,
  ) {
    super(path === undefined ? message : `${message} (${path})`)
  }
}

export function isConfigurationError(value: unknown): value is ConfigurationError {
  return value instanceof ConfigurationError
}
