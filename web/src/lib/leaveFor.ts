/**
 * A full navigation that replaces this page in the history, for places the
 * app's router does not serve, such as Cockpit under `/cockpit/`. Callers pass
 * a path checked to stay on this origin.
 */
export function leaveFor(path: string): void {
  window.location.replace(path);
}
