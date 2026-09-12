type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function capacitor(): CapacitorBridge | undefined {
  return (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;
}

/** True only inside the iOS/Android shell. The website stays a normal browser. */
export function isNativeApp() {
  return Boolean(capacitor()?.isNativePlatform?.());
}

export function nativePlatform() {
  if (!isNativeApp()) return "web";
  return capacitor()?.getPlatform?.() ?? "web";
}
