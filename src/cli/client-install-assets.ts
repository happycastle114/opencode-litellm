export const CLIENT_INSTALL_ASSET_OPERATION = {
  Retire: 'retire',
  Write: 'write',
} as const

type ClientInstallAssetOperation = typeof CLIENT_INSTALL_ASSET_OPERATION[
  keyof typeof CLIENT_INSTALL_ASSET_OPERATION
]

export const CLIENT_INSTALL_BACKUP_POLICY = {
  Create: 'create',
  None: 'none',
} as const

export type ClientInstallBackupPolicy = typeof CLIENT_INSTALL_BACKUP_POLICY[
  keyof typeof CLIENT_INSTALL_BACKUP_POLICY
]

export type ClientInstallExpectedFile = {
  readonly contents: Buffer
  readonly mode: number
  readonly device: number
  readonly inode: number
}

export type ClientInstallExpectation = {
  readonly previous: ClientInstallExpectedFile | undefined
}

export type ClientInstallPathGuard = {
  readonly path: string
  readonly expectation: ClientInstallExpectation
}

export type ClientInstallWriteAssetPlan = {
  readonly operation: typeof CLIENT_INSTALL_ASSET_OPERATION.Write
  readonly path: string
  readonly contents: string
  readonly mode?: number
  readonly backup?: ClientInstallBackupPolicy
  readonly expectation?: ClientInstallExpectation
}

export type ClientInstallRetireAssetPlan = {
  readonly operation: typeof CLIENT_INSTALL_ASSET_OPERATION.Retire
  readonly path: string
  readonly expectation?: ClientInstallExpectation
}

export type ClientInstallAssetPlan =
  | ClientInstallWriteAssetPlan
  | ClientInstallRetireAssetPlan

export class ClientInstallAssetError extends Error {
  readonly name = 'ClientInstallAssetError'

  constructor(readonly operation: ClientInstallAssetOperation | string) {
    super(`Unsupported client install asset operation: ${operation}`)
  }
}
