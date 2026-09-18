import { AgentCommand, type AgentLaunchBoundary, type AgentLaunchInput, type AgentProcessResult } from './agent-launch-contracts'
import { buildChildEnvironment } from './agent-launch-environment'
import { defaultBoundary, resolveExecutable } from './agent-launch-process'
import { CodexProviderId } from './codex-config-blocks'
import { startHybridProxy } from './codex-hybrid-proxy'

export async function launchHybridClient(
  input: AgentLaunchInput,
  boundary: AgentLaunchBoundary = defaultBoundary(),
): Promise<AgentProcessResult> {
  if (input.apiKey === undefined) throw new Error('A LiteLLM gateway key is required.')
  if (boundary.spawnAsync === undefined) throw new Error('Client hybrid routing requires an asynchronous process launcher.')
  const executable = resolveExecutable(AgentCommand.Codex, boundary)
  const environment = buildChildEnvironment(AgentCommand.Codex, input, input.gatewayOrigin)
  const proxy = await startHybridProxy({ gatewayOrigin: input.gatewayOrigin, apiKey: input.apiKey })
  try {
    return await boundary.spawnAsync(executable, [
      '-c', `model_providers.${CodexProviderId.Hybrid}.base_url=${JSON.stringify(proxy.baseUrl)}`,
      ...input.args,
    ], { stdio: 'inherit', env: environment })
  } finally {
    await proxy.close()
  }
}
