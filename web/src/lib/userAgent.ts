/** A browser and system read from a user-agent string, for lists a person scans. */
export interface DeviceDescription {
  browser?: string;
  system?: string;
}

const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/\biPhone\b|\biPad\b|\biPod\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

/**
 * Names the browser and system in a user-agent string. Order matters: Edge
 * and Opera also claim to be Chrome, and Chrome also claims to be Safari.
 * Anything it does not recognise is left out rather than guessed.
 */
export function describeUserAgent(agent: string): DeviceDescription {
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  return { ...(browser === undefined ? {} : { browser }), ...(system === undefined ? {} : { system }) };
}
