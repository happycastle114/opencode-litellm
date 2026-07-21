import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

type WorkflowStep = {
  name?: unknown
  id?: unknown
  if?: unknown
  run?: unknown
  uses?: unknown
}

const workflowPath = join(import.meta.dir, '..', '.github', 'workflows', 'release.yml')
const packagePath = join(import.meta.dir, '..', 'package.json')

test('release workflow has a single guarded tarball publish path', () => {
  const workflow = parse(readFileSync(workflowPath, 'utf8')) as {
    on?: { push?: { tags?: unknown }; release?: unknown; workflow_dispatch?: unknown }
    jobs?: { publish?: { steps?: WorkflowStep[] } }
  }
  const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string }
  const steps = workflow.jobs?.publish?.steps ?? []
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

  expect(workflow.on?.push?.tags).toEqual([`v${packageManifest.version}`])
  expect(Object.keys(workflow.on ?? {})).toEqual(['push'])

  const tagStep = step('Verify release tag and ancestry')
  expect(String(tagStep.run)).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main')

  const recordStep = step('Verify npm package records exist')
  expect(recordStep.if).toBeUndefined()
  expect(String(recordStep.run)).toContain('verify-npm-release-metadata.mjs record')
  expect(String(recordStep.run)).toContain('Bootstrap required')

  const packStep = step('Pack tested tarballs')
  expect(String(packStep.run)).toContain('manifest.gitHead = gitHead')
  step('Verify packed tarballs')

  const preflightStep = step('Check pre-existing npm metadata')
  expect(preflightStep.id).toBe('registry')
  expect(String(preflightStep.run)).toContain('verify-npm-release-metadata.mjs preflight')
  expect(String(preflightStep.run)).toContain('--integrity "$integrity"')
  expect(String(preflightStep.run)).toContain('check_package core "$CORE_PACKAGE" "$CORE_INTEGRITY"')
  expect(String(preflightStep.run)).toContain('check_package wrapper "$WRAPPER_PACKAGE" "$WRAPPER_INTEGRITY"')

  const corePublish = step('Publish scoped core tarball')
  expect(corePublish.if).toBe("steps.registry.outputs.publish_core == 'true'")
  expect(String(corePublish.run)).toContain('npm publish "$CORE_TARBALL" --ignore-scripts --provenance --access public')

  const wrapperPublish = step('Publish Codex wrapper tarball')
  expect(wrapperPublish.if).toBe("steps.registry.outputs.publish_wrapper == 'true'")
  expect(String(wrapperPublish.run)).toContain('npm publish "$WRAPPER_TARBALL" --ignore-scripts --provenance --access public')

  const publishSteps = steps.filter((candidate) => typeof candidate.run === 'string' && candidate.run.includes('npm publish'))
  expect(publishSteps).toHaveLength(2)

  const readbackStep = step('Verify published npm metadata')
  expect(String(readbackStep.run)).toContain('verify-npm-release-metadata.mjs readback')
  expect(String(readbackStep.run)).toContain('--integrity "$CORE_INTEGRITY"')
  expect(String(readbackStep.run)).toContain('--integrity "$WRAPPER_INTEGRITY"')

  const consumerStep = step('Verify clean Codex consumer install')
  expect(String(consumerStep.run)).toContain('npm install --ignore-scripts --no-audit --no-fund "$WRAPPER_PACKAGE"')
  expect(String(consumerStep.run)).toContain('npm audit signatures')

  const releaseStep = step('Create GitHub Release')
  expect(String(releaseStep.uses)).toMatch(/^softprops\/action-gh-release@/)
  expect(releaseStep.if).toBe('success()')
  expect(steps.at(-1)).toBe(releaseStep)

  const orderedSteps = [
    'Verify npm package records exist',
    'Check pre-existing npm metadata',
    'Publish scoped core tarball',
    'Publish Codex wrapper tarball',
    'Verify published npm metadata',
    'Verify clean Codex consumer install',
    'Create GitHub Release',
  ].map(indexOf)
  expect(orderedSteps.every((index) => index >= 0)).toBe(true)
  expect(orderedSteps).toEqual([...orderedSteps].sort((left, right) => left - right))
})
