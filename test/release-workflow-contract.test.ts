import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

type WorkflowStep = {
  name?: unknown
  id?: unknown
  if?: unknown
  env?: Record<string, unknown>
  run?: unknown
  uses?: unknown
}

const workflowPath = join(import.meta.dir, '..', '.github', 'workflows', 'release.yml')
const packagePath = join(import.meta.dir, '..', 'package.json')

test('release workflow is a main-branch GitHub Packages path with manual dispatch', () => {
  const workflow = parse(readFileSync(workflowPath, 'utf8')) as {
    on?: {
      push?: { branches?: unknown; paths?: unknown }
      workflow_dispatch?: unknown
    }
    jobs?: {
      publish?: {
        permissions?: Record<string, unknown>
        env?: Record<string, unknown>
        steps?: WorkflowStep[]
      }
    }
  }
  const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    version: string
    publishConfig?: { registry?: string }
  }
  const job = workflow.jobs?.publish
  const steps = job?.steps ?? []
  const stepsByName = new Map(
    steps
      .filter((step): step is WorkflowStep & { name: string } => typeof step.name === 'string')
      .map((step) => [step.name, step]),
  )
  const step = (name: string) => {
    const found = stepsByName.get(name)
    expect(found, `missing workflow step: ${name}`).toBeDefined()
    return found as WorkflowStep
  }
  const indexOf = (name: string) => steps.findIndex((candidate) => candidate.name === name)
  const workflowText = readFileSync(workflowPath, 'utf8')

  expect(workflow.on?.push?.branches).toEqual(['main'])
  expect(workflow.on?.push?.paths).toEqual([
    'package.json',
    'package-lock.json',
    'packages/codex-litellm/package.json',
    'packages/codex-litellm/bin/**',
    '.github/workflows/release.yml',
    'scripts/verify-npm-release-metadata.mjs',
  ])
  expect(workflow.on?.workflow_dispatch).toBeDefined()
  expect(job?.permissions).toEqual({ contents: 'read', packages: 'write' })
  expect(job?.env?.NODE_AUTH_TOKEN).toBeUndefined()
  expect(job?.env?.NPM_CONFIG_USERCONFIG).toBeUndefined()
  expect(job?.env?.GITHUB_PACKAGES_REGISTRY).toBe('https://npm.pkg.github.com')
  expect(workflowText).toContain('group: github-packages-release-${{ github.repository }}')
  expect(workflowText).toContain('cancel-in-progress: false')
  expect(packageManifest.publishConfig?.registry).toBe('https://npm.pkg.github.com')
  expect(workflowText).not.toContain('id-token: write')
  expect(workflowText).not.toContain('npm provenance')
  expect(workflowText).not.toContain('Trusted Publishing')

  const authStep = step('Configure ephemeral GitHub Packages npm auth')
  expect(String(authStep.run)).toContain('$RUNNER_TEMP/github-packages.npmrc')
  expect(String(authStep.run)).toContain('@happycastle114:registry=https://npm.pkg.github.com')
  expect(String(authStep.run)).toContain('//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}')
  expect(String(authStep.run)).not.toContain('GITHUB_ENV')

  const metadataStep = step('Verify main revision and package metadata')
  expect(String(metadataStep.run)).toContain('GITHUB_REF_NAME" == main')
  expect(String(metadataStep.run)).toContain('GITHUB_SHA')
  expect(String(metadataStep.run)).toContain('@happycastle114/codex-litellm')

  const packStep = step('Pack tested tarballs')
  expect(String(packStep.run)).toContain('manifest.gitHead = gitHead')
  step('Verify packed tarballs')

  const preflightStep = step('Check pre-existing GitHub Packages metadata')
  expect(preflightStep.id).toBe('registry')
  expect(preflightStep.env?.NODE_AUTH_TOKEN).toContain('secrets.GITHUB_TOKEN')
  expect(preflightStep.env?.NPM_CONFIG_USERCONFIG).toContain('runner.temp')
  expect(String(preflightStep.run)).toContain('verify-npm-release-metadata.mjs preflight')
  expect(String(preflightStep.run)).toContain('--registry "$GITHUB_PACKAGES_REGISTRY"')
  expect(String(preflightStep.run)).toContain('check_package core "$CORE_PACKAGE" "$CORE_INTEGRITY"')
  expect(String(preflightStep.run)).toContain('check_package wrapper "$WRAPPER_PACKAGE" "$WRAPPER_INTEGRITY"')

  const corePublish = step('Publish scoped core tarball')
  expect(corePublish.if).toBe("steps.registry.outputs.publish_core == 'true'")
  expect(corePublish.env?.NODE_AUTH_TOKEN).toContain('secrets.GITHUB_TOKEN')
  expect(corePublish.env?.NPM_CONFIG_USERCONFIG).toContain('runner.temp')
  expect(String(corePublish.run)).toContain('npm publish "$CORE_TARBALL"')
  expect(String(corePublish.run)).toContain('--access public')
  expect(String(corePublish.run)).toContain('--registry "$GITHUB_PACKAGES_REGISTRY"')

  const wrapperPublish = step('Publish scoped Codex wrapper tarball')
  expect(wrapperPublish.if).toBe("steps.registry.outputs.publish_wrapper == 'true'")
  expect(wrapperPublish.env?.NODE_AUTH_TOKEN).toContain('secrets.GITHUB_TOKEN')
  expect(wrapperPublish.env?.NPM_CONFIG_USERCONFIG).toContain('runner.temp')
  expect(String(wrapperPublish.run)).toContain('npm publish "$WRAPPER_TARBALL"')
  expect(String(wrapperPublish.run)).toContain('--access public')
  expect(String(wrapperPublish.run)).toContain('--registry "$GITHUB_PACKAGES_REGISTRY"')

  const publishSteps = steps.filter((candidate) => typeof candidate.run === 'string' && candidate.run.includes('npm publish'))
  expect(publishSteps).toHaveLength(2)

  const readbackStep = step('Verify published metadata and tarball identity')
  expect(readbackStep.env?.NODE_AUTH_TOKEN).toContain('secrets.GITHUB_TOKEN')
  expect(readbackStep.env?.NPM_CONFIG_USERCONFIG).toContain('runner.temp')
  expect(String(readbackStep.run)).toContain('verify-npm-release-metadata.mjs readback')
  expect(String(readbackStep.run)).toContain('npm pack "$package_spec"')
  expect(String(readbackStep.run)).toContain('actual_integrity')
  expect(String(readbackStep.run)).toContain('package/package.json')

  const consumerStep = step('Verify clean GitHub Packages consumer install')
  expect(consumerStep.env?.NODE_AUTH_TOKEN).toContain('secrets.GITHUB_TOKEN')
  expect(consumerStep.env?.NPM_CONFIG_USERCONFIG).toContain('runner.temp')
  expect(String(consumerStep.run)).toContain('npm config get @happycastle114:registry')
  expect(String(consumerStep.run)).toContain('npm install --ignore-scripts --no-audit --no-fund --package-lock=false "$WRAPPER_PACKAGE"')
  expect(String(consumerStep.run)).toContain('node_modules/@happycastle114/codex-litellm/package.json')

  const orderedSteps = [
    'Check pre-existing GitHub Packages metadata',
    'Publish scoped core tarball',
    'Publish scoped Codex wrapper tarball',
    'Verify published metadata and tarball identity',
    'Verify clean GitHub Packages consumer install',
  ].map(indexOf)
  expect(orderedSteps.every((index) => index >= 0)).toBe(true)
  expect(orderedSteps).toEqual([...orderedSteps].sort((left, right) => left - right))
})
