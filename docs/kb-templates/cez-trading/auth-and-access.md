# Authentication and Access — CEZ Internal SSO

**TL;DR:** All CEZ Trading applications authenticate users via the corporate
Active Directory through internal SSO at `__SSO_URL__` (e.g.
`https://sso.cez.cz`). The standard protocol is OIDC; legacy apps use SAML 2.0.
Service-to-service auth uses mTLS with certificates from the internal PKI.
NEVER use external identity providers (Auth0, Okta SaaS, Clerk, NextAuth, etc.).

## User authentication (OIDC)

All new web apps integrate via OpenID Connect against `__SSO_URL__`:
- **Authorization endpoint**: `__SSO_URL__/oidc/authorize`
- **Token endpoint**: `__SSO_URL__/oidc/token`
- **JWKS**: `__SSO_URL__/oidc/jwks`
- **Userinfo**: `__SSO_URL__/oidc/userinfo`
- **Discovery**: `__SSO_URL__/.well-known/openid-configuration`

### Required setup
1. Request a client registration via ServiceNow ticket to **__IAM_TEAM__**.
   Provide: app name, environment (prod/uat/dev), redirect URIs, required scopes.
2. Receive `client_id` and `client_secret` (rotate every __SECRET_ROTATION_DAYS__ days).
3. Store secrets in Vault path `secret/apps/<app-name>/oidc/<env>`.

### Standard library
Use **`@cez-trading/auth-client`** (npm internal registry `__NPM_REGISTRY__`):
```typescript
import { createAuthClient } from '@cez-trading/auth-client'

const auth = createAuthClient({
  issuer: process.env.SSO_ISSUER, // = __SSO_URL__/oidc
  clientId: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  redirectUri: process.env.OIDC_REDIRECT_URI,
})
```

### Token format
Access tokens are JWT (RS256) with claims:
- `sub` — user's AD `sAMAccountName` (e.g. `jnovak1`)
- `email` — corporate email (e.g. `jan.novak@cez.cz`)
- `groups` — array of AD group names user belongs to
- `tenant_id` — always `"CEZ-TRADING"` for our apps
- `exp` — 1 hour expiration
- `aud` — your `client_id`

### Authorization (RBAC)
Map AD groups to application roles in your app config:
```yaml
roles:
  trader:    ["AD-CEZ-TRADING-TRADERS"]
  analyst:   ["AD-CEZ-TRADING-ANALYSTS", "AD-CEZ-TRADING-RISK"]
  admin:     ["AD-CEZ-TRADING-IT-ADMINS"]
  viewer:    ["AD-CEZ-TRADING-ALL"]
```

## Service-to-service authentication (mTLS)

Backend services authenticate to each other with X.509 client certificates
issued by the internal PKI at `__PKI_URL__`.

- Cert request via ServiceNow → IT Security
- Certs valid 1 year, must be rotated before expiry (alerting via __MONITORING__)
- Store cert and key in Vault at `secret/apps/<app-name>/mtls/<env>`
- Trust chain: Internal Root CA + Internal Issuing CA (download from `__PKI_URL__/ca`)

### NOT for service auth
- ❌ Static API keys / shared secrets in headers
- ❌ JWT with HMAC signing (no central revocation)
- ❌ HTTP Basic Auth
- ❌ User OIDC tokens (these are for users, not services)

## Network access (Zero Trust)

All apps deploy behind the corporate proxy. Outbound HTTPS to internet
goes through `__CORPORATE_PROXY__` (e.g. `proxy.cez.cz:8080`).
Set in containers:
```bash
HTTP_PROXY=http://__CORPORATE_PROXY__
HTTPS_PROXY=http://__CORPORATE_PROXY__
NO_PROXY=.cez.cz,localhost,127.0.0.1,10.0.0.0/8
```

## Session management

- **Session cookie name**: `__SESSION_COOKIE__` (e.g. `_cez_session`)
- **Cookie attributes**: `HttpOnly; Secure; SameSite=Lax; Domain=.cez.cz`
- **Idle timeout**: 30 minutes
- **Absolute timeout**: 8 hours (then re-auth required)
- **Logout**: must hit `__SSO_URL__/oidc/end-session` to clear SSO session globally

## Audit and compliance

Every authentication event MUST be logged with:
- timestamp (UTC)
- user `sub`
- source IP (X-Forwarded-For if behind proxy)
- action (`login`, `logout`, `token_refresh`, `mfa_required`, `denied`)
- target resource

Logs ship to **__SIEM_NAME__** (e.g. Splunk) via `__LOG_FORWARDER__`.

## DO NOT
- ❌ Use Auth0, Okta SaaS, Clerk, NextAuth, Firebase Auth, AWS Cognito,
  Supabase Auth, or any external IdP — security and compliance violation.
- ❌ Roll your own auth (custom JWT signing, password hashing) — must use
  central SSO for revocation, MFA, and audit.
- ❌ Store passwords anywhere — we are SSO-only, never password-based locally.
- ❌ Disable cert validation for outbound HTTPS — all corporate certs are
  signed by the Internal Root CA which is in the OS trust store.
- ❌ Pass tokens via URL query strings — use Authorization header or cookies.
- ❌ Persist tokens in localStorage or sessionStorage (XSS risk) — use
  HttpOnly cookies for browsers.

## Common pitfalls
- Group names from AD are case-sensitive in some tooling — normalize to upper.
- `groups` claim is paginated for users in >100 groups — use `groups_url`
  claim and fetch full list if needed.
- Clock skew between app and SSO causes spurious token-expired errors —
  ensure NTP sync (chrony from `__NTP_SERVER__`).
