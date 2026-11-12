import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { rewriteLinks } from './links.ts'
import { buildNavigation } from './navigation.ts'

const repository = 'https://github.com/Arkazzae/Stellarr'
const docs = fileURLToPath(new URL('..', import.meta.url))
const branding = fileURLToPath(new URL('../../branding', import.meta.url))

// The drawings are read from branding/ and embedded, so the site has no copy
// of them to keep in step.
function drawing(name: string): string {
  const svg = readFileSync(`${branding}/logo/${name}.svg`, 'utf8')
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const { nav, sidebar } = buildNavigation(docs)

export default defineConfig({
  title: 'Stellarr',
  description: 'Documentation of Stellarr, a self-hosted text and voice chat for a small group of friends.',
  lang: 'en',
  base: '/Stellarr/',
  cleanUrls: true,
  lastUpdated: true,
  // The documentation map is the home page; the file stays README.md for GitHub.
  rewrites: { 'README.md': 'index.md' },
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: drawing('tile') }]],
  markdown: {
    config(md) {
      rewriteLinks(repository)(md)
      const defaultFence = md.renderer.rules.fence!
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        if (token.info.trim() === 'mermaid') {
          return `<MermaidDiagram code="${encodeURIComponent(token.content)}" />`
        }
        return defaultFence(tokens, idx, options, env, self)
      }
    },
  },
  // The default theme preloads its own typeface, Inter, which no page uses.
  // Outfit is preloaded in its place.
  transformHead({ assets }) {
    const outfit = assets.find((file) => /outfit-100-900-latin\.[\w-]+\.woff2$/.test(file))
    if (!outfit) return []
    return [['link', { rel: 'preload', href: outfit, as: 'font', type: 'font/woff2', crossorigin: '' }]]
  },
  transformHtml: (html) =>
    html.replace(/<link rel="preload" href="[^"]*inter-roman-latin[^"]*"[^>]*>/, ''),
  vite: {
    // The style sheet loads the fonts from branding/, outside the docs/ root.
    server: { fs: { allow: [docs, branding] } },
  },
  themeConfig: {
    // small.svg (the mark for 16 to 47 px) has a light bubble for dark
    // backgrounds. The light scheme takes the one-colour mark, which an image
    // draws in black.
    logo: { light: drawing('mono'), dark: drawing('small') },
    nav,
    sidebar,
    outline: { level: [2, 3] },
    socialLinks: [{ icon: 'github', link: repository, ariaLabel: 'Stellarr on GitHub' }],
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
  },
})
