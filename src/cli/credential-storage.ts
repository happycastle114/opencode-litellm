export const FILE_AUTH_ENVIRONMENT = { LITELLM_CLI_DISABLE_KEYRING: '1' } as const

export const CODEX_FILE_AUTH_SETTINGS = {
  cli_auth_credentials_store: 'file',
  mcp_oauth_credentials_store: 'file',
} as const

export const CODEX_FILE_AUTH_ARGS = Object.entries(CODEX_FILE_AUTH_SETTINGS)
  .flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`])

export const CODEX_FILE_AUTH_TOML = Object.entries(CODEX_FILE_AUTH_SETTINGS)
  .map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')
