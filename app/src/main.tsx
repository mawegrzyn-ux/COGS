import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import { auth0Config } from './config/auth0'
import App from './App'
import './index.css'

const root = document.getElementById('root')!

createRoot(root).render(
  <StrictMode>
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      authorizationParams={{
        redirect_uri: auth0Config.redirectUri,
        ...(auth0Config.audience ? { audience: auth0Config.audience } : {}),
      }}
    >
      <App />
    </Auth0Provider>
  </StrictMode>
)
