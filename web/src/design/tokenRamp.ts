/** A deliberately small CSS reader for the design-system tests. */

/** The custom properties declared in one block, keyed without their `--`. */
export type Declarations = Map<string, string>;

/**
 * Reads a flat stylesheet into `selector -> custom properties`. A selector list
 * gives each of its selectors the block's declarations, and a selector that
 * repeats merges its blocks. Only the shape `palettes.css` is written in is
 * understood: at-rules and nested blocks throw instead of being guessed at.
 */
export function parseBlocks(css: string): Map<string, Declarations> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (source.includes("@")) {
    throw new Error("parseBlocks reads flat stylesheets: at-rules are not supported");
  }

  const blocks = new Map<string, Declarations>();
  for (const [, selectors = "", body = ""] of source.matchAll(
    /([^{}]+)\{([^{}]*)\}/g,
  )) {
    const declarations = customProperties(body);
    if (declarations.size === 0) continue;
    for (const selector of selectors.split(",")) {
      const key = selector.trim();
      const block = blocks.get(key) ?? new Map();
      for (const [name, value] of declarations) block.set(name, value);
      blocks.set(key, block);
    }
  }
  return blocks;
}

function customProperties(body: string): Declarations {
  const declarations: Declarations = new Map();
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim();
    if (property.startsWith("--")) {
      declarations.set(property.slice(2), declaration.slice(colon + 1).trim());
    }
  }
  return declarations;
}
