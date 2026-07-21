import {
  ENDPOINT,
  GATEWAY_DISCOVERY_RESOURCE,
  GATEWAY_DISCOVERY_WARNING_KIND,
  HTTP_STATUS,
  OPTIONAL_FAILURE_KIND,
  OptionalEndpointFailure,
  type GatewayDiscoveryResource,
  type GatewayDiscoveryWarning,
  type OptionalEndpoint,
} from './gateway-tool-discovery-contracts'

export function availableFallbackWarning(): GatewayDiscoveryWarning {
  return {
    resource: GATEWAY_DISCOVERY_RESOURCE.SearchTools,
    kind: GATEWAY_DISCOVERY_WARNING_KIND.AvailableFallback,
    endpoint: ENDPOINT.SearchToolsAvailable,
  }
}

export function optionalWarning(
  resource: GatewayDiscoveryResource,
  endpoint: OptionalEndpoint,
  reason: unknown,
): GatewayDiscoveryWarning {
  if (!(reason instanceof OptionalEndpointFailure)) {
    return {
      resource,
      kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
      endpoint,
    }
  }
  if (
    endpoint === ENDPOINT.Toolsets &&
    reason.kind === OPTIONAL_FAILURE_KIND.Status &&
    (reason.status === HTTP_STATUS.NotFound || reason.status === HTTP_STATUS.MethodNotAllowed)
  ) {
    return {
      resource,
      kind: GATEWAY_DISCOVERY_WARNING_KIND.Unsupported,
      endpoint,
      status: reason.status,
    }
  }
  switch (reason.kind) {
    case OPTIONAL_FAILURE_KIND.InvalidJson:
    case OPTIONAL_FAILURE_KIND.InvalidShape:
      return {
        resource,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.InvalidResponse,
        endpoint,
      }
    case OPTIONAL_FAILURE_KIND.TimedOut:
      return {
        resource,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.TimedOut,
        endpoint,
      }
    case OPTIONAL_FAILURE_KIND.Status:
      return {
        resource,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
        endpoint,
        status: reason.status,
      }
    case OPTIONAL_FAILURE_KIND.Request:
    default:
      return {
        resource,
        kind: GATEWAY_DISCOVERY_WARNING_KIND.Unavailable,
        endpoint,
      }
  }
}
