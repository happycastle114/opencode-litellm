import type { AgentLaunchBoundary } from './agent-launch'
import type { ClientInstallerBoundary } from './client-installer'
import type { InstallPreparationBoundary } from './install-preparation'
import type { ProgramAuthContext } from './program-auth-lifecycle'
import type { PathEnv } from './paths'

export type ProgramContext = ClientInstallerBoundary & ProgramAuthContext & {
  readonly env: PathEnv & Readonly<Record<string, string | undefined>>
  readonly now: () => Date
  readonly onboardingIO?: InstallPreparationBoundary['onboardingIO']
  readonly gatewayDiscovery?: InstallPreparationBoundary['discover']
  readonly agentLaunchBoundary?: AgentLaunchBoundary
}
