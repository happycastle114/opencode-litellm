const POSIX_SIGNAL_EXIT_CODE = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGILL: 132,
  SIGTRAP: 133,
  SIGABRT: 134,
  SIGBUS: 135,
  SIGFPE: 136,
  SIGKILL: 137,
  SIGUSR1: 138,
  SIGSEGV: 139,
  SIGUSR2: 140,
  SIGPIPE: 141,
  SIGALRM: 142,
  SIGTERM: 143,
} as const satisfies Readonly<Partial<Record<NodeJS.Signals, number>>>

export type ProcessCompletion = {
  readonly status: number | null
  readonly signal: string | null
}

export function resolveProcessExitCode(completion: ProcessCompletion): number {
  if (completion.status !== null) return completion.status
  if (completion.signal === null) return 1
  return isKnownPosixSignal(completion.signal)
    ? POSIX_SIGNAL_EXIT_CODE[completion.signal]
    : 128
}

function isKnownPosixSignal(signal: string): signal is keyof typeof POSIX_SIGNAL_EXIT_CODE {
  return Object.hasOwn(POSIX_SIGNAL_EXIT_CODE, signal)
}
