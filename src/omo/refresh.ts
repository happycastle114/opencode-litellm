import { discoverOmoPolicy, type OmoDiscoveryInput } from './discovery'
import { OmoPolicyError } from './policy'
import { renderOmoPolicy } from './profile'
import { resolveOhMyOpenAgentProfilePath } from '../cli/qwen-routing'
import { assertManagedRegularFileOrAbsent, readManagedTextFile } from '../cli/managed-file-safety'
import { writeConfigAtomic } from '../cli/file-adapter'

export type OmoRefreshInput = OmoDiscoveryInput & {
  readonly configPath: string
  readonly now: () => Date
}

export async function refreshOmoProfile(input: OmoRefreshInput): Promise<void> {
  const path = resolveOhMyOpenAgentProfilePath(input.configPath)
  const source = readManagedTextFile(path, '{}\n')
  const policy = await discoverOmoPolicy(input)
  if (policy === undefined) return
  const output = renderOmoPolicy(source, policy)
  if (output === source) return
  if (readManagedTextFile(path, '{}\n') !== source) throw new OmoPolicyError('OMO profile changed during policy refresh; retry startup.')
  assertManagedRegularFileOrAbsent(path)
  writeConfigAtomic(path, output, input)
}
