import type { GatewayToolDiscoveryResult } from './gateway-tool-discovery'
import type { InstallOptions } from './install-intent'
import {
  OnboardingResourceAccess,
  type OnboardingResource,
  type OnboardingResources,
} from './onboarding'

const SelectionDefault = { All: 'all', None: 'none' } as const
type SelectionDefault = (typeof SelectionDefault)[keyof typeof SelectionDefault]

export const INSTALL_SELECTION_RESOURCE = {
  Search: 'search',
  Mcp: 'mcp',
  Toolset: 'toolset',
  DisabledMcp: 'disabled-mcp',
} as const

export type InstallSelectionResource =
  (typeof INSTALL_SELECTION_RESOURCE)[keyof typeof INSTALL_SELECTION_RESOURCE]

export const INSTALL_SELECTION_WARNING_KIND = { NotVisible: 'not-visible' } as const

export type InstallSelectionWarning = {
  readonly kind: typeof INSTALL_SELECTION_WARNING_KIND.NotVisible
  readonly resource: InstallSelectionResource
  readonly name: string
}

type SelectionRequest = {
  readonly resource: InstallSelectionResource
  readonly visible: readonly string[]
  readonly requested: readonly string[]
  readonly enabled: boolean
  readonly defaultSelection: SelectionDefault
}

export type InstallSelection = {
  readonly names: readonly string[]
  readonly warnings: readonly InstallSelectionWarning[]
}

export type InstallSelections = {
  readonly search: InstallSelection
  readonly mcp: InstallSelection
  readonly toolsets: InstallSelection
  readonly disabledMcp: InstallSelection
}

export function selectInstallResources(
  options: InstallOptions,
  discovery: GatewayToolDiscoveryResult,
): InstallSelections {
  const toolsets = discovery.toolsets.map((toolset) => toolset.toolsetName)
  return {
    search: selectVisible({
      resource: INSTALL_SELECTION_RESOURCE.Search,
      visible: discovery.searchToolNames,
      requested: options.search,
      enabled: !options.noSearch,
      defaultSelection: SelectionDefault.All,
    }),
    mcp: selectVisible({
      resource: INSTALL_SELECTION_RESOURCE.Mcp,
      visible: discovery.mcpServerNames,
      requested: options.mcp,
      enabled: !options.noMcp,
      defaultSelection: SelectionDefault.All,
    }),
    toolsets: selectVisible({
      resource: INSTALL_SELECTION_RESOURCE.Toolset,
      visible: toolsets,
      requested: options.toolsets,
      enabled: !options.noToolsets,
      defaultSelection: SelectionDefault.All,
    }),
    disabledMcp: selectDisabledMcp(options, discovery),
  }
}

export function selectDisabledMcp(
  options: InstallOptions,
  discovery: GatewayToolDiscoveryResult,
): InstallSelection {
  return selectVisible({
    resource: INSTALL_SELECTION_RESOURCE.DisabledMcp,
    visible: discovery.mcpServerNames,
    requested: options.disableMcp,
    enabled: !options.noMcp,
    defaultSelection: SelectionDefault.None,
  })
}

export function resourcesForOnboarding(
  discovery: GatewayToolDiscoveryResult,
  options: InstallOptions,
): OnboardingResources {
  return {
    searchTools: options.noSearch ? [] : authorized(discovery.searchToolNames),
    mcpServers: options.noMcp ? [] : authorized(discovery.mcpServerNames),
    mcpToolsets: options.noToolsets
      ? []
      : authorized(discovery.toolsets.map((toolset) => toolset.toolsetName)),
  }
}

function selectVisible(request: SelectionRequest): InstallSelection {
  if (!request.enabled) return { names: [], warnings: [] }
  if (request.requested.length === 0) {
    return {
      names: request.defaultSelection === SelectionDefault.All ? request.visible : [],
      warnings: [],
    }
  }
  const requested = new Set(request.requested)
  const visible = new Set(request.visible)
  const warned = new Set<string>()
  const warnings: InstallSelectionWarning[] = []
  for (const name of request.requested) {
    if (!visible.has(name) && !warned.has(name)) {
      warned.add(name)
      warnings.push({
        kind: INSTALL_SELECTION_WARNING_KIND.NotVisible,
        resource: request.resource,
        name,
      })
    }
  }
  return { names: request.visible.filter((name) => requested.has(name)), warnings }
}

function authorized(names: readonly string[]): readonly OnboardingResource[] {
  return names.map((name) => ({ name, access: OnboardingResourceAccess.Authorized }))
}
