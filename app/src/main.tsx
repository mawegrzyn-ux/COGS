import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import { auth0Config } from './config/auth0'
import App from './App'
import './index.css'
import './i18n'  // initialises i18next before React renders

const root = document.getElementById('root')!

createRoot(root).render(
  <StrictMode>
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      authorizationParams={{
        redirect_uri: auth0Config.redirectUri,
        // Refresh-token rotation is a hard requirement for the standalone
        // Pepper PWA at /pepper — installed PWAs block third-party cookies
        // aggressively, so the default silent-iframe token refresh fails and
        // every API call ends up with no Authorization header (visible as
        // "fetch error" in chat). Refresh tokens use a same-origin POST and
        // sidestep the iframe entirely.
        scope: 'openid profile email offline_access',
        ...(auth0Config.audience ? { audience: auth0Config.audience } : {}),
      }}
      // Use localStorage so refresh tokens survive a full app restart (matters
      // when the PWA is re-launched from the home-screen icon hours later) and
      // so silent-auth fallbacks don't re-trigger on every reload.
      useRefreshTokens
      useRefreshTokensFallback
      cacheLocation="localstorage"
    >
      <App />
    </Auth0Provider>
  </StrictMode>
)
