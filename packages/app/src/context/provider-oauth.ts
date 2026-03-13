export function buildFoundryProviderOauthRedirectUri(realmUrl: string): string | null {
  const trimmedRealmUrl = realmUrl.trim()
  if (!trimmedRealmUrl) {
    return null
  }

  try {
    return new URL("/json/foundry/providers/oauth/callback", trimmedRealmUrl).toString()
  } catch {
    return null
  }
}
