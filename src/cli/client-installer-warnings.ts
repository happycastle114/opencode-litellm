import {
  GATEWAY_DISCOVERY_WARNING_KIND,
  type GatewayDiscoveryWarning,
} from './gateway-tool-discovery'
import {
  INSTALL_SELECTION_WARNING_KIND,
  type InstallSelectionWarning,
  type PreparedInstall,
} from './install-preparation'

export function formatPreparedInstallWarnings(
  prepared: PreparedInstall,
): readonly string[] {
  return [
    ...prepared.selectionWarnings.map(formatSelectionWarning),
    ...prepared.discovery.warnings.map(formatGatewayWarning),
  ]
}

function formatSelectionWarning(warning: InstallSelectionWarning): string {
  switch (warning.kind) {
    case INSTALL_SELECTION_WARNING_KIND.NotVisible:
      return `Selected ${warning.resource} '${warning.name}' is not present in gateway discovery inventory and was skipped.`
    case INSTALL_SELECTION_WARNING_KIND.Unverified:
      return `Gateway ${warning.resource} discovery was unavailable; selected '${warning.name}' was configured without verification.`
    default:
      return unsupportedWarning(warning)
  }
}

function formatGatewayWarning(warning: GatewayDiscoveryWarning): string {
  if (warning.kind === GATEWAY_DISCOVERY_WARNING_KIND.AvailableFallback) {
    return `Gateway ${warning.resource} discovery used router-wide inventory at ${warning.endpoint}; invocation POST enforces gateway permissions.`
  }
  const status = warning.status === undefined ? '' : ` (HTTP ${warning.status})`
  return `Gateway ${warning.resource} discovery ${warning.kind} at ${warning.endpoint}${status}; continuing with available resources.`
}

function unsupportedWarning(value: never): never {
  throw new Error(`Unsupported client install warning: ${String(value)}`)
}
