import { buildAPIURL, buildHeaders } from '../utils/litellm-api'
import { STUDENT_AUTO } from '../utils/student-catalog'
import { isRecord, OmoPolicyError, parseOmoPolicy, type OmoPolicy } from './policy'

const ENDPOINT = { Models: '/v1/models', Policy: '/model/info' } as const
const HTTP_STATUS = { NotFound: 404, MethodNotAllowed: 405 } as const
const TIMEOUT_MS = 3000

export type OmoDiscoveryInput = {
  readonly baseURL: string
  readonly apiKey: string | undefined
  readonly customHeaders?: Record<string, string>
  readonly authorizedModels?: readonly { readonly id: string }[]
  readonly fetcher?: typeof globalThis.fetch
  readonly signal?: AbortSignal
}

export async function discoverOmoPolicy(input: OmoDiscoveryInput): Promise<OmoPolicy | undefined> {
  const signal = input.signal === undefined ? AbortSignal.timeout(TIMEOUT_MS) : AbortSignal.any([input.signal, AbortSignal.timeout(TIMEOUT_MS)])
  const request = async (endpoint: string) => {
    const response = await (input.fetcher ?? fetch)(buildAPIURL(input.baseURL, endpoint), {
      headers: buildHeaders(input.apiKey, input.customHeaders, { allowAmbientFallback: false }), signal, redirect: 'error',
    })
    return response
  }
  const authorized = input.authorizedModels?.map((model) => model.id) ?? await readAuthorizedModels(await request(ENDPOINT.Models))
  if (!authorized.includes(STUDENT_AUTO.Id)) return undefined
  const response = await request(ENDPOINT.Policy)
  if (response.status === HTTP_STATUS.NotFound || response.status === HTTP_STATUS.MethodNotAllowed) return undefined
  if (!response.ok) throw new OmoPolicyError(`LiteLLM OMO policy discovery responded with HTTP ${response.status}.`)
  return parseOmoPolicy(await response.json(), authorized)
}

async function readAuthorizedModels(response: Response): Promise<readonly string[]> {
  if (!response.ok) throw new OmoPolicyError(`LiteLLM model authorization responded with HTTP ${response.status}.`)
  const payload: unknown = await response.json()
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new OmoPolicyError('Invalid LiteLLM model authorization response.')
  return payload.data.map((row) => {
    if (!isRecord(row) || typeof row.id !== 'string') throw new OmoPolicyError('Invalid LiteLLM authorized model.')
    return row.id
  })
}
