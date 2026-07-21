export function isHeaderSafeApiKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !/[\u0000-\u001f\u007f]/.test(value)
}

export function resolveHeaderSafeApiKey(value: unknown): string | undefined {
  return isHeaderSafeApiKey(value) ? value : undefined
}
