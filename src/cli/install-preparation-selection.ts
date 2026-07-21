import {
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
  type GatewayToolDiscoveryResult,
  type GatewayDiscoveryWarning,
} from './gateway-tool-discovery'
import {
  McpDefaultState,
  McpServerDefaultStates,
  type InstallOptions,
} from './install-intent'
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
  EnabledMcp: 'enabled-mcp',
  DisabledMcp: 'disabled-mcp',
} as const

export type InstallSelectionResource =
  (typeof INSTALL_SELECTION_RESOURCE)[keyof typeof INSTALL_SELECTION_RESOURCE]

export const INSTALL_SELECTION_WARNING_KIND = {
  NotVisible: 'not-visible',
  Unverified: 'unverified',
} as const

export type InstallSelectionWarning =
  | {
      readonly kind: typeof INSTALL_SELECTION_WARNING_KIND.NotVisible
      readonly resource: InstallSelectionResource
      readonly name: string
    }
  | {
      readonly kind: typeof INSTALL_SELECTION_WARNING_KIND.Unverified
      readonly resource: InstallSelectionResource
      readonly name: string
    }

type SelectionRequest = {
  readonly resource: InstallSelectionResource
  readonly visible: readonly string[]
  readonly requested: readonly string[]
  readonly enabled: boolean
  readonly defaultSelection: SelectionDefault
  readonly discoveryWarnings: readonly GatewayDiscoveryWarning[]
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
  const mcp = selectVisible({
    resource: INSTALL_SELECTION_RESOURCE.Mcp,
    visible: discovery.mcpServerNames,
    requested: options.mcp,
    enabled: !options.noMcp,
    defaultSelection: SelectionDefault.All,
    discoveryWarnings: discovery.warnings,
  })
  return {
    search: selectVisible({
      resource: INSTALL_SELECTION_RESOURCE.Search,
      visible: discovery.searchToolNames,
      requested: options.search,
      enabled: !options.noSearch,
      defaultSelection: SelectionDefault.All,
      discoveryWarnings: discovery.warnings,
    }),
    mcp,
    toolsets: selectVisible({
      resource: INSTALL_SELECTION_RESOURCE.Toolset,
      visible: toolsets,
      requested: options.toolsets,
      enabled: !options.noToolsets,
      defaultSelection: SelectionDefault.All,
      discoveryWarnings: discovery.warnings,
    }),
    disabledMcp: selectDisabledMcp(options, discovery, mcp.names),
  }
}

export function selectDisabledMcp(
  options: InstallOptions,
  discovery: GatewayToolDiscoveryResult,
  selectedMcpNames: readonly string[],
): InstallSelection {
  const enabledOverrides = selectVisible({
    resource: INSTALL_SELECTION_RESOURCE.EnabledMcp,
    visible: discovery.mcpServerNames,
    requested: options.enableMcp,
    enabled: !options.noMcp,
    defaultSelection: SelectionDefault.None,
    discoveryWarnings: discovery.warnings,
  })
  const disabledOverrides = selectVisible({
    resource: INSTALL_SELECTION_RESOURCE.DisabledMcp,
    visible: discovery.mcpServerNames,
    requested: options.disableMcp,
    enabled: !options.noMcp,
    defaultSelection: SelectionDefault.None,
    discoveryWarnings: discovery.warnings,
  })
  const explicitlyEnabled = new Set(enabledOverrides.names)
  const explicitlyDisabled = new Set(disabledOverrides.names)
  return {
    names: selectedMcpNames.filter((name) => (
      explicitlyDisabled.has(name) || (
        !explicitlyEnabled.has(name) &&
        (McpServerDefaultStates.get(name) ?? McpDefaultState.Enabled) === McpDefaultState.Disabled
      )
    )),
    warnings: [...enabledOverrides.warnings, ...disabledOverrides.warnings],
  }
}

export function resourcesForOnboarding(
  discovery: GatewayToolDiscoveryResult,
  options: InstallOptions,
): OnboardingResources {
  return {
    searchTools: options.noSearch ? [] : available(discovery.searchToolNames),
    mcpServers: options.noMcp ? [] : available(discovery.mcpServerNames),
    mcpToolsets: options.noToolsets
      ? []
      : available(discovery.toolsets.map((toolset) => toolset.toolsetName)),
  }
}

function selectVisible(request: SelectionRequest): InstallSelection {
  if (!request.enabled) return { names: [], warnings: [] }
  const optionalDiscoveryFailed = hasFailedOptionalDiscovery(request)
  if (request.requested.length === 0) {
    return {
      names: optionalDiscoveryFailed || request.defaultSelection === SelectionDefault.None
        ? []
        : request.visible,
      warnings: [],
    }
  }
  if (optionalDiscoveryFailed) {
    const names = uniqueInOrder(request.requested)
    return {
      names,
      warnings: names.map((name) => ({
        kind: INSTALL_SELECTION_WARNING_KIND.Unverified,
        resource: request.resource,
        name,
      })),
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

function hasFailedOptionalDiscovery(request: SelectionRequest): boolean {
  const discoveryResource = discoveryResourceFor(request.resource)
  if (discoveryResource === undefined) return false
  return request.discoveryWarnings.some((warning) => (
    warning.resource === discoveryResource && isOptionalDiscoveryWarning(warning)
  ))
}

function discoveryResourceFor(
  resource: InstallSelectionResource,
): typeof GATEWAY_DISCOVERY_RESOURCE.SearchTools
  | typeof GATEWAY_DISCOVERY_RESOURCE.Toolsets
  | undefined {
  switch (resource) {
    case INSTALL_SELECTION_RESOURCE.Search:
      return GATEWAY_DISCOVERY_RESOURCE.SearchTools
    case INSTALL_SELECTION_RESOURCE.Toolset:
      return GATEWAY_DISCOVERY_RESOURCE.Toolsets
    case INSTALL_SELECTION_RESOURCE.Mcp:
    case INSTALL_SELECTION_RESOURCE.EnabledMcp:
    case INSTALL_SELECTION_RESOURCE.DisabledMcp:
    default:
      return undefined
  }
}

function isOptionalDiscoveryWarning(warning: GatewayDiscoveryWarning): boolean {
  switch (warning.kind) {
    case GATEWAY_DISCOVERY_WARNING_KIND.AvailableFallback:
      return false
    case GATEWAY_DISCOVERY_WARNING_KIND.InvalidResponse:
    case GATEWAY_DISCOVERY_WARNING_KIND.TimedOut:
    case GATEWAY_DISCOVERY_WARNING_KIND.Unavailable:
    case GATEWAY_DISCOVERY_WARNING_KIND.Unsupported:
      return true
    default:
      return false
  }
}

function uniqueInOrder(names: readonly string[]): readonly string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    unique.push(name)
  }
  return unique
}

function available(names: readonly string[]): readonly OnboardingResource[] {
  return names.map((name) => ({ name, access: OnboardingResourceAccess.Available }))
}
