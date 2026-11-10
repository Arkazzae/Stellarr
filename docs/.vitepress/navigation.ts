import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import type { DefaultTheme } from 'vitepress'

interface Section {
  /** Folder under docs/; null stands for the reference documents at the top level. */
  folder: string | null
  label: string
}

// The order of the documentation map in README.md. A section is left out
// until it has a page.
const sections: Section[] = [
  { folder: 'install', label: 'Install' },
  { folder: 'admin', label: 'Administer' },
  { folder: null, label: 'Understand' },
  { folder: 'development', label: 'Develop' },
]

interface Page {
  link: string
  title: string
}

/**
 * Builds the top navigation and the sidebar from the files under docs/, so a
 * new page needs no change here. A page is titled by its first heading and
 * sits where the map in README.md lists it; pages the map does not list follow
 * in alphabetical order.
 */
export function buildNavigation(docs: string) {
  const mapOrder = linkOrder(readFileSync(join(docs, 'README.md'), 'utf8'))
  const groups = sections
    .map((section) => ({ label: section.label, pages: readPages(docs, section, mapOrder) }))
    .filter((group) => group.pages.length > 0)

  const nav: DefaultTheme.NavItem[] = groups.map(({ label, pages }) => ({
    text: label,
    link: pages[0].link,
    activeMatch: `^(${pages.map((page) => escapeRegExp(page.link)).join('|')})$`,
  }))
  const sidebar: DefaultTheme.SidebarItem[] = groups.map(({ label, pages }) => ({
    text: label,
    items: pages.map(({ title, link }) => ({ text: title, link })),
  }))
  return { nav, sidebar }
}

function readPages(docs: string, { folder }: Section, mapOrder: Map<string, number>): Page[] {
  const directory = join(docs, folder ?? '')
  if (!existsSync(directory)) return []
  const rank = (path: string) => mapOrder.get(path) ?? mapOrder.size
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => posix.join(folder ?? '', entry.name))
    .filter((path) => path !== 'README.md')
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en'))
    .map((path) => ({
      link: `/${path.slice(0, -'.md'.length)}`,
      title: firstHeading(path, readFileSync(join(docs, path), 'utf8')),
    }))
}

/** Position of every Markdown file in the order the map links to it. */
function linkOrder(map: string): Map<string, number> {
  const order = new Map<string, number>()
  for (const [, target] of map.matchAll(/\]\(([^)\s#]+\.md)/g)) {
    const path = posix.normalize(target)
    if (!order.has(path)) order.set(path, order.size)
  }
  return order
}

function firstHeading(path: string, markdown: string): string {
  let inCode = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode
    const heading = inCode ? null : /^#\s+(.+?)\s*$/.exec(line)
    if (heading) {
      return heading[1].replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    }
  }
  throw new Error(`${path} has no first-level heading, which the site uses as its title`)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
