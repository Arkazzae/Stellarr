import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createMarkdownRenderer, disposeMdItInstance, type MarkdownRenderer } from 'vitepress'
import { rewriteLinks } from './links.ts'

const repository = 'https://github.com/Arkazzae/Stellarr'
let md: MarkdownRenderer

before(async () => {
  md = await createMarkdownRenderer('/docs', { config: rewriteLinks(repository) }, '/Stellarr/')
})
after(() => disposeMdItInstance())

/** The href of every link and the links VitePress checks for a missing page. */
function render(markdown: string, relativePath: string) {
  const env: { relativePath: string; cleanUrls: boolean; links?: string[] } = {
    relativePath,
    cleanUrls: true,
  }
  const html = md.render(markdown, env)
  return { hrefs: [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]), links: env.links }
}

test('a link to the map goes to the home page, which is served as index', () => {
  assert.deepEqual(render('[map](README.md#understand)', 'ARCHITECTURE.md').hrefs, ['/Stellarr/#understand'])
  assert.deepEqual(render('[map](../README.md)', 'install/quick-start.md').hrefs, ['/Stellarr/'])
  // VitePress looks a README link up as a page named README, which the site does not have.
  assert.deepEqual(render('[map](../README.md)', 'install/quick-start.md').links, ['/'])
})

test('a link to a file outside docs goes to that file on GitHub', () => {
  assert.deepEqual(render('[design](../DESIGN.md#colour)', 'ARCHITECTURE.md').hrefs, [
    `${repository}/blob/main/DESIGN.md#colour`,
  ])
  assert.deepEqual(render('[compose](../../docker-compose.yml)', 'install/quick-start.md').hrefs, [
    `${repository}/blob/main/docker-compose.yml`,
  ])
  assert.deepEqual(render('[folder](../branding/)', 'ARCHITECTURE.md').hrefs, [
    `${repository}/blob/main/branding/`,
  ])
})

test('links to other pages, anchors and external addresses are left to VitePress', () => {
  const { hrefs, links } = render(
    '[page](../ARCHITECTURE.md), [section](#top), [site](https://example.org/a), [root](/other)',
    'install/quick-start.md',
  )

  assert.deepEqual(hrefs, ['./../ARCHITECTURE', '#top', 'https://example.org/a', '/Stellarr/other'])
  assert.deepEqual(links, ['./../ARCHITECTURE', '/other'])
})
