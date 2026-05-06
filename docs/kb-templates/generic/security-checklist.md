# Security Checklist

**TL;DR:** Authenticate every request, authorize every action, validate every
input, parameterize every query, escape every output, encrypt every transport,
audit every sensitive operation, never trust the client. Use established
libraries (do not roll your own auth, crypto, or session management). Patch
dependencies regularly. Treat security as a recurring practice, not a one-time
checklist.

## Authentication

- ✅ Industry-standard protocol: OIDC / OAuth 2.0 / SAML
- ✅ Established library (Auth.js, Passport, your platform SSO)
- ✅ MFA supported, ideally enforced for privileged accounts
- ✅ Sessions short-lived (1h access tokens) with refresh
- ✅ Logout invalidates session server-side, not just client cookie
- ✅ Account lockout / rate limiting on login endpoint
- ❌ Custom JWT signing without rotation strategy
- ❌ Passwords stored anywhere (use SSO, or hash with bcrypt/argon2id only)
- ❌ Generic "wrong username or password" details that enable enumeration
  (return same error for both cases AND consume same time)

## Authorization

- ✅ Permission check on EVERY endpoint (no "default allow")
- ✅ Authorization at the data layer too (`WHERE owner_id = current_user`)
- ✅ Role / scope model documented; reviewed at design time
- ❌ Trust client-supplied user_id in request body — derive from session
- ❌ Frontend-only authorization (hide button = security theater)
- ❌ Rely on UUIDs being "unguessable" — still authorize

### Common holes
- **IDOR (Insecure Direct Object Reference)**: `/api/orders/123` — user A
  can fetch user B's order because endpoint trusted the ID without checking ownership
- **Mass assignment**: `req.body` spread into model — user sets `is_admin: true`
  in payload. Always validate against an allow-list schema.
- **Privilege escalation via update**: PATCH /users/:id with `{ role: "admin" }` —
  ensure role field is not mutable by the user themselves.

## Input validation

- ✅ Validate on the SERVER (client validation is UX, not security)
- ✅ Whitelist known-good values; do not blacklist known-bad
- ✅ Validate types, lengths, ranges, formats (Zod / JSON schema)
- ✅ Reject unknown fields (no silent acceptance)
- ❌ Trust Content-Type, file extensions, or MIME types from client
  (verify with magic bytes server-side)

## Output encoding (XSS prevention)

- ✅ Use a templating engine that escapes by default (React, Vue, Handlebars)
- ✅ Sanitize HTML before storage if you must accept it (DOMPurify SERVER-side)
- ✅ Set `Content-Type` correctly with `charset=utf-8`
- ✅ `Content-Security-Policy` header restricting script sources
- ❌ `dangerouslySetInnerHTML` / `v-html` with user data
- ❌ String-concat HTML in code
- ❌ Inline event handlers on user-controlled attributes

## SQL injection

- ✅ Parameterized queries / prepared statements only
- ✅ ORM with parameterization (Prisma, etc.)
- ❌ String-concatenate user input into SQL — EVER

```typescript
// ❌
db.query(`SELECT * FROM users WHERE email = '${email}'`)
// ✅
db.query('SELECT * FROM users WHERE email = $1', [email])
```

## Command injection

- ✅ Avoid `exec()` with user input; use library APIs instead
- ✅ If you must shell out, use `execFile()` with array args (no shell parsing)
- ❌ `exec(\`convert ${userFilename} out.png\`)` — `; rm -rf /` in filename

## SSRF (Server-Side Request Forgery)

User submits URL → your server fetches it. Risks:
- Internal network access (`http://169.254.169.254/` cloud metadata)
- Localhost / RFC1918 ranges
- File scheme (`file:///etc/passwd`)

Mitigations:
- ✅ Allow-list of permitted hosts/schemes
- ✅ DNS resolution check (block private IPs)
- ✅ Use a dedicated outbound proxy with policy
- ❌ Block-list — easy to bypass (DNS rebinding, IPv6 mapped, octal IPs)

## File upload

- ✅ Validate file type by magic bytes (libmagic), not extension or MIME header
- ✅ Limit size (in bytes, server-enforced)
- ✅ Store outside web root, serve via authenticated handler
- ✅ Randomize filenames (don't trust user-provided)
- ✅ Antivirus scan before serving (ClamAV or vendor scanner)
- ✅ Strip EXIF / metadata from images that may leak GPS / device info
- ❌ Serve user uploads from your main domain — use separate domain
  (e.g. `userfiles.example.com`) to isolate cookies/CSP

## Sessions and cookies

- ✅ `HttpOnly` (no JS access, XSS-resistant)
- ✅ `Secure` (HTTPS only)
- ✅ `SameSite=Lax` (or `Strict` for sensitive)
- ✅ `Path=/` (or narrower)
- ✅ Set short `Max-Age` and rotate on privilege change
- ✅ Domain-bind cookies; never wildcard `*.example.com` for sensitive sessions
- ❌ Store JWTs in localStorage (XSS extracts them)
- ❌ Long-lived static session cookies (rotate on every privileged action)

## CSRF

- ✅ `SameSite=Lax` cookies cover most cases
- ✅ Use anti-CSRF tokens for state-changing operations from forms
- ✅ Verify `Origin` / `Referer` for non-GET requests
- ✅ For APIs using `Authorization: Bearer` (no cookie) → CSRF doesn't apply
- ❌ Mix cookie auth with state-changing GET endpoints

## Transport security

- ✅ HTTPS everywhere; HTTP redirects to HTTPS
- ✅ HSTS header with `max-age` ≥ 1 year and `includeSubDomains`
- ✅ Modern TLS only (TLS 1.2 minimum, prefer 1.3)
- ✅ Cipher suites without RC4, 3DES, MD5
- ✅ Certificates auto-renewed (Let's Encrypt, ACM, internal CA + cert-manager)
- ❌ Self-signed certs in production
- ❌ Mixed content (HTTPS page loading HTTP resources)

## Secrets management

- ✅ Secrets in dedicated secret manager (Vault, AWS Secrets Manager,
  Doppler, 1Password CLI)
- ✅ Injected as env vars at runtime, not baked into images
- ✅ Rotated on schedule; immediately on suspected compromise
- ✅ Different secrets per environment
- ✅ Pre-commit hooks scan for secrets (gitleaks, trufflehog)
- ❌ Secrets in `.env` committed to git
- ❌ Secrets in CI logs (mask via CI features)
- ❌ Hardcoded keys "just for dev"

## Dependencies

- ✅ Lockfile committed (`pnpm-lock.yaml`, `package-lock.json`)
- ✅ Automated vulnerability scanning (Dependabot, Snyk, Renovate)
- ✅ Pin major versions; allow patch auto-updates
- ✅ Review new dependencies before adding (maintenance, reputation, scope)
- ❌ Add packages from random GitHub forks
- ❌ `npm install` without lockfile
- ❌ Ignore high/critical CVE alerts

## Logging and monitoring

- ✅ Log all authentication events (success, failure, MFA, logout)
- ✅ Log authorization failures (potential probing)
- ✅ Log admin actions, privilege changes, config changes
- ✅ Logs centralized, immutable, alerted on
- ✅ Alert on: spike in 401s, brute-force patterns, geographic anomalies,
  privilege escalations
- ❌ Log passwords, tokens, full credit cards, SSNs, API keys
- ❌ Logs writable by application user (tampering risk)

## Rate limiting and abuse

- ✅ Rate limit by IP AND by authenticated user (different thresholds)
- ✅ Stricter limits on login, password-reset, account-creation endpoints
- ✅ CAPTCHAs / proof-of-work on signup if abuse suspected
- ✅ Block obvious scanners (User-Agent patterns, scanning paths)
- ❌ Rely on client-side rate limiting only

## CORS

- ✅ Allow-list specific origins (not `*` if cookies are involved)
- ✅ Restrict methods and headers to what you actually use
- ✅ `Access-Control-Allow-Credentials: true` only with explicit origin
- ❌ `Access-Control-Allow-Origin: *` with credentials (browsers reject; design fail)

## Headers

Set on EVERY response:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-...'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
X-Frame-Options: DENY  (or use CSP frame-ancestors)
```

Use a library / middleware (`helmet` for Node, equivalents elsewhere) to apply
sensible defaults.

## Backups and recovery

- ✅ Backups encrypted at rest
- ✅ Backups tested by actually restoring (untested = doesn't work)
- ✅ Off-site copy (separate region/provider)
- ✅ Retention policy documented and enforced
- ✅ Backup access logged and restricted
- ❌ Backups on the same machine that they protect
- ❌ Long retention without legal basis (GDPR minimization)

## Pre-deployment security checklist

Before shipping a new feature:
- [ ] All endpoints require authentication unless explicitly public
- [ ] All endpoints check authorization on the affected resource
- [ ] All inputs validated server-side
- [ ] All outputs escaped per context (HTML, JSON, SQL, shell)
- [ ] Secrets not in code or config files
- [ ] New dependencies reviewed for vulnerabilities
- [ ] Errors don't leak stack traces, SQL, internal hostnames
- [ ] Logs include request_id but not PII at INFO level
- [ ] Rate limits on public-facing endpoints
- [ ] HTTPS enforced; security headers set
- [ ] Pen-test or threat-model review done if feature is sensitive

## Recurring practices

- **Monthly**: dependency vulnerability review, log audit (privilege grants)
- **Quarterly**: access review (who has admin? still needed?), secret rotation
- **Annually**: external penetration test, threat-model refresh, DR drill

## DO NOT
- ❌ Roll your own crypto, auth, or session management
- ❌ Store passwords in any form (use SSO; if you must, argon2id only)
- ❌ Disable certificate validation, even "just in dev" (creates muscle memory)
- ❌ Log secrets, tokens, PII, full PANs, full SSNs
- ❌ Allow file:// or internal IPs in user-supplied URL fetchers
- ❌ Use eval() / Function() / setTimeout(string) on user input
- ❌ Trust user-supplied user_id, role, or permission in request body
- ❌ Store secrets in client-side code or localStorage
- ❌ Use HTTP for any data — TLS or nothing
- ❌ Skip HTTPS in dev — replicate prod patterns to catch issues early
