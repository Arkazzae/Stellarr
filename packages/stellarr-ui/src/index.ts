/**
 * Joins the truthy class names with single spaces. Components in this package
 * join class names with it instead of clsx or tailwind-merge, so the package
 * pulls no dependency into either app.
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
