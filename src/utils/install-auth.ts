export const InstallAuth = {
  Environment: 'env',
  Sso: 'sso',
} as const

export type InstallAuth = (typeof InstallAuth)[keyof typeof InstallAuth]
