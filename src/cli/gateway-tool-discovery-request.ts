import {
  OPTIONAL_FAILURE_KIND,
  OptionalEndpointFailure,
  type OptionalEndpoint,
} from './gateway-tool-discovery-contracts'

export function requestJson(
  url: string,
  endpoint: OptionalEndpoint,
  apiKey: string,
  fetcher: typeof globalThis.fetch,
  overallSignal: AbortSignal,
  requestTimeoutMs: number,
): Promise<unknown> {
  const requestController = new AbortController()
  const signal = AbortSignal.any([overallSignal, requestController.signal])
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let onOverallAbort: (() => void) | undefined
  const timeout = new Promise<never>((_, reject) => {
    const rejectTimeout = () => {
      requestController.abort()
      reject(new OptionalEndpointFailure(endpoint, OPTIONAL_FAILURE_KIND.TimedOut))
    }
    timeoutHandle = setTimeout(rejectTimeout, requestTimeoutMs)
    if (overallSignal.aborted) {
      rejectTimeout()
    } else {
      onOverallAbort = rejectTimeout
      overallSignal.addEventListener('abort', onOverallAbort, { once: true })
    }
  })
  const request = Promise.resolve().then(() => fetcher(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  }))

  return Promise.race([request, timeout])
    .then(async (response) => {
      if (!response.ok) {
        throw new OptionalEndpointFailure(
          endpoint,
          OPTIONAL_FAILURE_KIND.Status,
          response.status,
        )
      }
      try {
        return await response.json()
      } catch {
        throw new OptionalEndpointFailure(endpoint, OPTIONAL_FAILURE_KIND.InvalidJson)
      }
    })
    .catch((error: unknown) => {
      if (error instanceof OptionalEndpointFailure) throw error
      throw new OptionalEndpointFailure(endpoint, OPTIONAL_FAILURE_KIND.Request)
    })
    .finally(() => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      if (onOverallAbort !== undefined) {
        overallSignal.removeEventListener('abort', onOverallAbort)
      }
    })
}
