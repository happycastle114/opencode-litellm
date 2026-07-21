import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLAUDE_MARKETPLACE_KEY,
  CLAUDE_SETTINGS_MODE,
  planClaudeMarketplaceAsset,
  resolveClaudeMarketplaceUrl,
} from '../src/cli/claude-marketplace-asset'
import { CLIENT_INSTALL_ASSET_OPERATION, type ClientInstallAssetPlan } from '../src/cli/client-install-assets'

const ORIGIN = 'https://gateway.example.test///' as const
const MARKETPLACE_URL = 'https://gateway.example.test/claude-code/marketplace.json' as const

let homeDirectory: string

beforeEach(() => {
  homeDirectory = mkdtempSync(join(realpathSync(tmpdir()), 'claude-marketplace-asset-'))
})

afterEach(() => {
  rmSync(homeDirectory, { recursive: true, force: true })
})

describe('Claude Code marketplace asset planning', () => {
  test('plans the normalized LiteLLM marketplace URL as a restrictive write asset', () => {
    const asset = planClaudeMarketplaceAsset({
      homeDirectory,
      gatewayOrigin: ORIGIN,
    })

    expect(asset).toMatchObject({
      operation: CLIENT_INSTALL_ASSET_OPERATION.Write,
      path: join(homeDirectory, '.claude', 'settings.json'),
      mode: CLAUDE_SETTINGS_MODE,
    })
    expect(JSON.parse(asset.contents)).toEqual({
      extraKnownMarketplaces: {
        [CLAUDE_MARKETPLACE_KEY]: {
          source: { source: 'url', url: MARKETPLACE_URL },
        },
      },
    })
    expect(asset.contents).not.toContain('apiKey')
    const compatibleAssets: readonly ClientInstallAssetPlan[] = [asset]
    expect(compatibleAssets).toHaveLength(1)
  })

  test('preserves unrelated settings and marketplaces', () => {
    const path = settingsPath()
    const source = JSON.stringify({
      theme: 'dark',
      enabledPlugins: { 'existing@team': true },
      extraKnownMarketplaces: {
        team: { source: { source: 'github', repo: 'acme/tools' } },
      },
    }, null, 2) + '\n'
    writeSettings(source)

    const asset = planClaudeMarketplaceAsset({
      homeDirectory,
      gatewayOrigin: ORIGIN,
    })
    const output = JSON.parse(asset.contents)
    expect(output.theme).toBe('dark')
    expect(output.enabledPlugins).toEqual({ 'existing@team': true })
    expect(output.extraKnownMarketplaces.team).toEqual({
      source: { source: 'github', repo: 'acme/tools' },
    })
    expect(output.extraKnownMarketplaces[CLAUDE_MARKETPLACE_KEY]).toEqual({
      source: { source: 'url', url: MARKETPLACE_URL },
    })
  })

  test('returns the original bytes when the managed marketplace is equivalent', () => {
    const path = settingsPath()
    const source = '{\n  "keep": 1,\n  "extraKnownMarketplaces": {\n' +
      '    "litellm": { "source": { "url": "' + MARKETPLACE_URL +
      '", "source": "url" }, "autoUpdate": true }\n  }\n}\n'
    writeSettings(source)

    const asset = planClaudeMarketplaceAsset({
      homeDirectory,
      gatewayOrigin: ORIGIN,
    })
    expect(asset.contents).toBe(source)
    expect(readFileSync(path, 'utf8')).toBe(source)
  })

  test('migrates a legacy flat marketplace entry to the nested source schema', () => {
    const legacy = JSON.stringify({
      extraKnownMarketplaces: {
        [CLAUDE_MARKETPLACE_KEY]: {
          source: 'url',
          url: MARKETPLACE_URL,
          autoUpdate: true,
        },
      },
    }, null, 2) + '\n'
    writeSettings(legacy)

    const asset = planClaudeMarketplaceAsset({
      homeDirectory,
      gatewayOrigin: ORIGIN,
    })
    expect(asset.contents).not.toBe(legacy)
    expect(JSON.parse(asset.contents).extraKnownMarketplaces[CLAUDE_MARKETPLACE_KEY])
      .toEqual({
        source: { source: 'url', url: MARKETPLACE_URL },
        autoUpdate: true,
      })
    const migrated = JSON.parse(asset.contents)
    expect(migrated.extraKnownMarketplaces[CLAUDE_MARKETPLACE_KEY].url).toBeUndefined()
  })

  test.each([
    ['malformed JSON', '{ malformed\n'],
    ['non-object root', '[]\n'],
    ['non-object marketplace map', '{"extraKnownMarketplaces": []}\n'],
  ])('fails closed before mutation on %s', (_label, source) => {
    const path = settingsPath()
    writeSettings(source)

    expect(() => planClaudeMarketplaceAsset({
      homeDirectory,
      gatewayOrigin: ORIGIN,
    })).toThrow()
    expect(readFileSync(path, 'utf8')).toBe(source)
  })

  test('rejects credential-bearing or non-http gateway origins', () => {
    expect(() => resolveClaudeMarketplaceUrl('https://user:secret@gateway.example.test'))
      .toThrow()
    expect(() => resolveClaudeMarketplaceUrl('https://gateway.example.test/?key=secret'))
      .toThrow()
    expect(() => resolveClaudeMarketplaceUrl('ftp://gateway.example.test'))
      .toThrow()
  })

  test('removes a terminal /v1 while preserving a gateway path prefix', () => {
    expect(resolveClaudeMarketplaceUrl('https://gateway.example.test/proxy/v1///'))
      .toBe('https://gateway.example.test/proxy/claude-code/marketplace.json')
    expect(resolveClaudeMarketplaceUrl('https://gateway.example.test/proxy/v1/v1///'))
      .toBe('https://gateway.example.test/proxy/v1/claude-code/marketplace.json')
  })

  test('the planned destination can be installed with mode 0600', () => {
    const path = settingsPath()
    const asset = planClaudeMarketplaceAsset({
      homeDirectory,
      gatewayOrigin: ORIGIN,
    })
    mkdirSync(join(homeDirectory, '.claude'), { recursive: true })
    writeFileSync(path, asset.contents, { mode: asset.mode })
    chmodSync(path, asset.mode ?? 0)

    expect(existsSync(path)).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(CLAUDE_SETTINGS_MODE)
  })

  test('passes the generated settings to Claude doctor when Claude is installed', {
    timeout: 15_000,
  }, () => {
    const binary = spawnSync('which', ['claude'], { encoding: 'utf8' }).stdout.trim()
    if (binary === '') {
      expect(binary).toBe('')
      return
    }

    const asset = planClaudeMarketplaceAsset({
      homeDirectory,
      gatewayOrigin: ORIGIN,
    })
    mkdirSync(join(homeDirectory, '.claude'), { recursive: true })
    writeFileSync(settingsPath(), asset.contents, { mode: asset.mode })
    const result = spawnSync(binary, ['--settings', settingsPath(), 'doctor'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: homeDirectory,
        NO_COLOR: '1',
        TERM: 'dumb',
      },
      timeout: 10_000,
    })
    const output = `${result.stdout}${result.stderr}`
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(output).toContain('Claude Code doctor')
    expect(output).not.toMatch(/invalid settings/i)
  })
})

function settingsPath(): string {
  return join(homeDirectory, '.claude', 'settings.json')
}

function writeSettings(source: string): void {
  mkdirSync(join(homeDirectory, '.claude'), { recursive: true })
  writeFileSync(settingsPath(), source)
}
