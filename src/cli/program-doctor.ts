import {
  inspectCodexConfig,
  inspectOpenCodeConfig,
  type DoctorReport,
} from './doctor'
import type { DoctorOptions } from './argument-parser'
import { InstallTarget } from './install-intent'
import type { CliResult } from './command'
import {
  resolveCodexConfigPath,
  resolveOpenCodeConfigPath,
  type PathEnv,
} from './paths'

export function runDoctor(options: DoctorOptions, env: PathEnv): CliResult {
  const reports: DoctorReport[] = []
  if (options.target === InstallTarget.OpenCode || options.target === InstallTarget.Both) {
    reports.push(inspectOpenCodeConfig(resolveOpenCodeConfigPath(options.opencodeConfig, env)))
  }
  if (options.target === InstallTarget.Codex || options.target === InstallTarget.Both) {
    reports.push(inspectCodexConfig(resolveCodexConfigPath(options.codexConfig, env)))
  }
  const status = reports.some((report) => report.status === 'error')
    ? 'error'
    : reports.some((report) => report.status === 'warn') ? 'warn' : 'ok'
  const report = { status, checks: reports.flatMap((entry) => entry.checks) }
  const stdout = options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${report.checks.map((check) => `[${check.status}] ${check.message} (${check.path})`).join('\n')}\n`
  return { exitCode: status === 'error' ? 1 : 0, stdout, stderr: '' }
}
