// Auth0 configuration
// These values come from environment variables (see .env.local)

export const auth0Config = {
  domain:   import.meta.env.VITE_AUTH0_DOMAIN   as string,
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID as string,
  audience: import.meta.env.VITE_AUTH0_AUDIENCE  as string | undefined,
  redirectUri: window.location.origin,
} as const
