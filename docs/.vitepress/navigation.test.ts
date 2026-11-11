import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { buildNavigation } from './navigation.ts'

function docsWith(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-navigation-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test('sections follow the documentation map and appear once they have a page', (t) => {
  const docs = docsWith(t, {
    'README.md': '# Documentation\n',
    'ARCHITECTURE.md': '# Architecture\n',
    'development/setup.md': '# Set up\n',
    'install/quick-start.md': '# Quick start\n',
  })
  const { nav, sidebar } = buildNavigation(docs)

  assert.deepEqual(sidebar, [
    { text: 'Install', items: [{ text: 'Quick start', link: '/install/quick-start' }] },
    { text: 'Understand', items: [{ text: 'Architecture', link: '/ARCHITECTURE' }] },
    { text: 'Develop', items: [{ text: 'Set up', link: '/development/setup' }] },
  ])
  assert.deepEqual(
    nav.map(({ text, link }) => [text, link]),
    [
      ['Install', '/install/quick-start'],
      ['Understand', '/ARCHITECTURE'],
      ['Develop', '/development/setup'],
    ],
  )
})

test('pages are ordered as the map links to them, then alphabetically', (t) => {
  const docs = docsWith(t, {
    'README.md': [
      '# Documentation',
      '- [Requirements](install/requirements.md)',
      '- [Quick start](./install/quick-start.md#steps)',
    ].join('\n'),
    'install/configuration.md': '# Configuration\n',
    'install/quick-start.md': '# Quick start\n',
    'install/requirements.md': '# Requirements\n',
    'install/upgrading.md': '# Upgrading\n',
  })
  const [install] = buildNavigation(docs).sidebar

  assert.deepEqual(
    install.items?.map((item) => item.text),
    ['Requirements', 'Quick start', 'Configuration', 'Upgrading'],
  )
})

test('a title is the first heading outside a code block, without markup', (t) => {
  const docs = docsWith(t, {
    'README.md': '# Documentation\n',
    'one.md': '```sh\n# a comment, not a heading\n```\n\n# The `.env` file\n\n# Second\n',
    'two.md': '# See [the guide](guide.md)\n',
  })
  const [group] = buildNavigation(docs).sidebar

  assert.deepEqual(
    group.items?.map((item) => item.text),
    ['The .env file', 'See the guide'],
  )
})

test('the map itself is not a page of the sidebar', (t) => {
  const docs = docsWith(t, { 'README.md': '# Documentation\n' })

  assert.deepEqual(buildNavigation(docs), { nav: [], sidebar: [] })
})

test('a page without a first-level heading stops the build', (t) => {
  const docs = docsWith(t, {
    'README.md': '# Documentation\n',
    'untitled.md': 'Text only.\n\n## Second level\n',
  })

  assert.throws(() => buildNavigation(docs), /untitled\.md has no first-level heading/)
})

test('a navigation item is active on every page of its section only', (t) => {
  const docs = docsWith(t, {
    'README.md': '# Documentation\n',
    'ARCHITECTURE.md': '# Architecture\n',
    'install/quick-start.md': '# Quick start\n',
    'install/v1.2.md': '# Version 1.2\n',
  })
  const [install, understand] = buildNavigation(docs).nav.map((item) => new RegExp(item.activeMatch!))

  assert.ok(install.test('/install/quick-start'))
  assert.ok(install.test('/install/v1.2'))
  assert.ok(!install.test('/install/v1x2'))
  assert.ok(!install.test('/ARCHITECTURE'))
  assert.ok(understand.test('/ARCHITECTURE'))
})
