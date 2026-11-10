export interface DesktopAutostartStatus {
  available: boolean;
  enabled: boolean;
}

/** Operating-system preferences that only Stellarr Desktop can reach. */
export interface DesktopPort {
  getAutostart(): Promise<DesktopAutostartStatus>;
  setAutostart(enabled: boolean): Promise<DesktopAutostartStatus>;
}
