import { posix } from 'node:path'
import type { MarkdownRenderer } from 'vitepress'

// A scheme, a protocol-relative address, an anchor or a site-absolute path.
const notRelative = /^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i

/**
 * The pages are written to be read on GitHub, so their relative links point at
 * files in the repository. On the site, a link to README.md goes to the home
 * page (the map is served as index) and a link to a file outside docs/ goes to
 * that file on GitHub, because the site does not contain it.
 */
export function rewriteLinks(repository: string) {
  return (md: MarkdownRenderer) => {
    md.core.ruler.push('rewrite_links', (state) => {
      const directory = posix.dirname(state.env.relativePath)
      for (const block of state.tokens) {
        for (const token of block.children ?? []) {
          const href = token.type === 'link_open' ? token.attrGet('href') : null
          if (href && !notRelative.test(href)) {
            token.attrSet('href', rewrite(href, directory, repository))
          }
        }
      }
    })
  }
}

function rewrite(href: string, directory: string, repository: string): string {
  const suffix = /[?#].*$/.exec(href)?.[0] ?? ''
  const target = posix.join(directory, href.slice(0, href.length - suffix.length))
  if (target === 'README.md') return `/${suffix}`
  if (target.startsWith('../')) {
    return `${repository}/blob/main/${posix.join('docs', target)}${suffix}`
  }
  return href
}
