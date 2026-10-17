/** Friendly names for the device-authorization client ids the server accepts (DEVICE_CLIENT_IDS). */
const CLIENT_NAMES: Record<string, string> = {
  'game-unity-client': 'the desktop game app',
  'game-mobile-client': 'the mobile app',
}

/** What the Device approval page calls the app asking to sign in (unknown ids as they are). */
export function deviceClientName(clientId: string): string {
  return CLIENT_NAMES[clientId] ?? clientId
}
