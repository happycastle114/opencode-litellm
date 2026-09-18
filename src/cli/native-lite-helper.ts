import { FILE_AUTH_ENVIRONMENT } from './credential-storage'
import { nativeLiteOrigin } from './native-lite'

export function renderNativeLiteAuthHelper(origin: string, homeDirectory: string): string {
  return `#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const env = { ...process.env, ...${JSON.stringify(FILE_AUTH_ENVIRONMENT)}, HOME: ${JSON.stringify(homeDirectory)} }
delete env.LITELLM_PROXY_API_KEY
delete env.LITELLM_PROXY_URL
if (process.platform === 'win32') env.USERPROFILE = env.HOME

if (process.argv.length !== 2) {
  process.stderr.write('Unsupported Codex auth helper arguments.\\n')
  process.exit(1)
}
const result = spawnSync('lite', ['--base-url', ${JSON.stringify(nativeLiteOrigin(origin))}, 'auth', 'print-token'], {
  env, encoding: 'utf8', stdio: 'pipe', shell: false, timeout: 30000, maxBuffer: 65536,
})
const token = (result.stdout ?? '').replace(/\\r?\\n$/, '')
if (result.error || result.status !== 0 || token.trim() === '' || /[\\u0000-\\u0020\\u007f]/.test(token)) {
  process.stderr.write('File-based LiteLLM authentication is unavailable. Run codex-litellm login for this gateway.\\n')
  process.exitCode = 1
} else {
  process.stdout.write(token + '\\n')
}
`
}
