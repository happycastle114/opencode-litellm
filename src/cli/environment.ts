import { homedir } from 'node:os'

/** Normalize Windows and POSIX home variables once before resolving client paths. */
export function normalizeCliEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> & { readonly HOME: string } {
  const home = [environment.HOME, environment.USERPROFILE]
    .find((value) => value !== undefined && value.trim() !== '') ?? homedir()
  return { ...environment, HOME: home }
}
