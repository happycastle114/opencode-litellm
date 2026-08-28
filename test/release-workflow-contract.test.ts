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
  with?: Record<string, unknown>
}

const workflowPath = join(import.meta.dir, '..', '.github', 'workflows', 'release.yml')
const packagePath = join(import.meta.dir, '..', 'package.json')

test('release workflow is a main-branch npm path with manual dispatch', () => {
  const workflow = parse(readFileSync(workflowPath, 'utf8')) as {
    name?: unknown
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
    publishConfig?: { access?: string; registry?: string }
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
  expect(workflow.name).toBe('Publish to npm')
  expect(job?.permissions).toEqual({ contents: 'read' })
  expect(job?.env?.NODE_AUTH_TOKEN).toBeUndefined()
  expect(job?.env?.NPM_CONFIG_USERCONFIG).toBeUndefined()
  expect(job?.env?.GITHUB_PACKAGES_REGISTRY).toBeUndefined()
  expect(workflowText).toContain('group: npm-release-${{ github.repository }}')
  expect(workflowText).toContain('cancel-in-progress: false')
  expect(packageManifest.publishConfig?.access).toBe('public')
  expect(packageManifest.publishConfig?.registry).toBeUndefined()
  expect(workflowText).not.toContain('@happycastle114')
  expect(workflowText).not.toContain('npm.pkg.github.com')
  expect(workflowText).not.toContain('id-token: write')
  expect(workflowText).not.toContain('npm provenance')
  expect(workflowText).not.toContain('Trusted Publishing')

  const setupNodeStep = step('Setup Node.js')
  expect(setupNodeStep.uses).toContain('actions/setup-node@820762786026740c76f36085b0efc47a31fe5020')
  expect(setupNodeStep.with?.['registry-url']).toBe('https://registry.npmjs.org')
  expect(stepsByName.has('Configure ephemeral GitHub Packages npm auth')).toBe(false)

  const metadataStep = step('Verify main revision and package metadata')
  expect(String(metadataStep.run)).toContain('GITHUB_REF_NAME" == main')
  expect(String(metadataStep.run)).toContain('GITHUB_SHA')
  expect(String(metadataStep.run)).toContain('@happycastle/codex-litellm')

  const testStep = step('Test, build, and typecheck')
  expect(String(testStep.run)).toContain('npm test')
  expect(String(testStep.run)).toContain('npm audit --omit=dev --audit-level=high')

  const packStep = step('Pack tested tarballs')
  expect(String(packStep.run)).toContain('manifest.gitHead = gitHead')
  step('Verify packed tarballs')

  const preflightStep = step('Check pre-existing npm metadata')
  expect(preflightStep.id).toBe('registry')
  expect(preflightStep.env?.NODE_AUTH_TOKEN).toBeUndefined()
  expect(preflightStep.env?.NPM_CONFIG_USERCONFIG).toBeUndefined()
  expect(String(preflightStep.run)).toContain('verify-npm-release-metadata.mjs preflight')
  expect(String(preflightStep.run)).toContain('--registry "https://registry.npmjs.org"')
  expect(String(preflightStep.run)).toContain('check_package core "$CORE_PACKAGE" "$CORE_INTEGRITY"')
  expect(String(preflightStep.run)).toContain('check_package wrapper "$WRAPPER_PACKAGE" "$WRAPPER_INTEGRITY"')

  const corePublish = step('Publish scoped core tarball')
  expect(corePublish.if).toBe("steps.registry.outputs.publish_core == 'true'")
  expect(corePublish.env?.NODE_AUTH_TOKEN).toContain('secrets.NPM_TOKEN')
  expect(corePublish.env?.NPM_CONFIG_USERCONFIG).toBeUndefined()
  expect(String(corePublish.run)).toContain('npm publish "$CORE_TARBALL"')
  expect(String(corePublish.run)).toContain('--access public')
  expect(String(corePublish.run)).toContain('--registry "https://registry.npmjs.org"')

  const wrapperPublish = step('Publish scoped Codex wrapper tarball')
  expect(wrapperPublish.if).toBe("steps.registry.outputs.publish_wrapper == 'true'")
  expect(wrapperPublish.env?.NODE_AUTH_TOKEN).toContain('secrets.NPM_TOKEN')
  expect(wrapperPublish.env?.NPM_CONFIG_USERCONFIG).toBeUndefined()
  expect(String(wrapperPublish.run)).toContain('npm publish "$WRAPPER_TARBALL"')
  expect(String(wrapperPublish.run)).toContain('--access public')
  expect(String(wrapperPublish.run)).toContain('--registry "https://registry.npmjs.org"')

  const publishSteps = steps.filter((candidate) => typeof candidate.run === 'string' && candidate.run.includes('npm publish'))
  expect(publishSteps).toHaveLength(2)

  const readbackStep = step('Verify published metadata and tarball identity')
  expect(readbackStep.env?.NODE_AUTH_TOKEN).toBeUndefined()
  expect(readbackStep.env?.NPM_CONFIG_USERCONFIG).toBeUndefined()
  expect(String(readbackStep.run)).toContain('verify-npm-release-metadata.mjs readback')
  expect(String(readbackStep.run)).toContain('--registry "https://registry.npmjs.org"')
  expect(String(readbackStep.run)).toContain('npm pack "$package_spec"')
  expect(String(readbackStep.run)).toContain('actual_integrity')
  expect(String(readbackStep.run)).toContain('package/package.json')

  const consumerStep = step('Verify clean npm consumer install')
  expect(consumerStep.env?.NODE_AUTH_TOKEN).toBeUndefined()
  expect(consumerStep.env?.NPM_CONFIG_USERCONFIG).toBeUndefined()
  expect(String(consumerStep.run)).not.toContain('npm config get @happycastle:registry')
  expect(String(consumerStep.run)).toContain('npm install --ignore-scripts --no-audit --no-fund --package-lock=false "$WRAPPER_PACKAGE"')
  expect(String(consumerStep.run)).not.toContain('unset NODE_AUTH_TOKEN NPM_CONFIG_USERCONFIG')
  expect(String(consumerStep.run)).toContain('node_modules/@happycastle/codex-litellm/package.json')

  const orderedSteps = [
    'Check pre-existing npm metadata',
    'Publish scoped core tarball',
    'Publish scoped Codex wrapper tarball',
    'Verify published metadata and tarball identity',
    'Verify clean npm consumer install',
  ].map(indexOf)
  expect(orderedSteps.every((index) => index >= 0)).toBe(true)
  expect(orderedSteps).toEqual([...orderedSteps].sort((left, right) => left - right))
})
