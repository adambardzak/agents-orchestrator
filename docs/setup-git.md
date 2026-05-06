# Git Provider Setup

The orchestrator supports **GitHub**, **GitLab**, and **Bitbucket** for cloning
repos, pushing agent commits, and (for GitHub) opening Pull Requests from
branch chats.

Both **SaaS** (github.com, gitlab.com, bitbucket.org) and **self-hosted**
(GitHub Enterprise Server, GitLab self-hosted) are supported via env vars.

---

## Choosing the OAuth path

Each provider needs an OAuth Application registered on the provider side.
The orchestrator never asks for your password — you authorize it once per
provider via OAuth, and the access token is stored encrypted in the DB.

You only need to set up the providers you'll actually use. Skip the rest;
the registry only registers providers whose env vars are set.

---

## GitHub (SaaS — github.com)

1. Open https://github.com/settings/applications/new
2. Fill in:
   - **Application name**: `Agent Orchestrator` (or your preferred name)
   - **Homepage URL**: `http://localhost:3010` (dev) or your prod web URL
   - **Authorization callback URL**: `http://localhost:3002/api/git/callback/github`
     - For prod: `https://your-api-host/api/git/callback/github`
3. Submit → you'll get a **Client ID**. Click "Generate a new client secret".
4. Add to `apps/api/.env`:
   ```
   GITHUB_OAUTH_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
   GITHUB_OAUTH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
5. Restart the API. The provider should appear in `/settings/git-providers`
   in the web UI.

---

## GitHub Enterprise Server (self-hosted GitHub)

Identical to SaaS, but you **also set the API base URL**:

1. Register an OAuth App on your Enterprise instance:
   `https://github.your-corp.com/settings/applications/new`
   - Same fields as SaaS — callback URL must be `http://localhost:3002/api/git/callback/github`
2. Add to `apps/api/.env`:
   ```
   GITHUB_API_BASE=https://github.your-corp.com
   GITHUB_OAUTH_CLIENT_ID=...
   GITHUB_OAUTH_CLIENT_SECRET=...
   ```
3. Restart API. The UI will show `GitHub (github.your-corp.com)` so you
   can tell on-prem from SaaS at a glance.

> **Single instance per deploy.** If you set `GITHUB_API_BASE`, you cannot
> simultaneously connect to github.com from the same orchestrator instance.
> Re-deploy with separate envs if you need both.

---

## GitLab (SaaS — gitlab.com)

1. Open https://gitlab.com/-/user_settings/applications
2. Click **Add new application**:
   - **Name**: `Agent Orchestrator`
   - **Redirect URI**: `http://localhost:3002/api/git/callback/gitlab`
   - **Confidential**: ✅ checked
   - **Scopes**: `read_user`, `api`, `write_repository`
3. Save → copy **Application ID** and **Secret**.
4. Add to `apps/api/.env`:
   ```
   GITLAB_OAUTH_CLIENT_ID=<Application ID>
   GITLAB_OAUTH_CLIENT_SECRET=<Secret>
   ```
5. Restart API.

---

## GitLab self-hosted (e.g. on-prem corporate instance)

Same as SaaS, plus the API base URL:

1. Open `https://gitlab.your-corp.com/-/user_settings/applications`
   (or `https://gitlab.your-corp.com/-/profile/applications` on older GitLab)
   - **You don't need admin rights** — user-level OAuth Applications work for
     your own account. If the option isn't visible, your admin disabled
     user Applications and you'll need to ask them to either enable it or
     create a group/instance-wide OAuth app for the orchestrator.
2. Same form as SaaS — Redirect URI: `http://localhost:3002/api/git/callback/gitlab`,
   Confidential ✅, scopes `read_user api write_repository`.
3. Add to `apps/api/.env`:
   ```
   GITLAB_API_BASE=https://gitlab.your-corp.com
   GITLAB_OAUTH_CLIENT_ID=<Application ID>
   GITLAB_OAUTH_CLIENT_SECRET=<Secret>
   ```
4. Restart API. The UI will show `GitLab (gitlab.your-corp.com)`.

### Network requirements for self-hosted

- **Your browser** must be able to reach `gitlab.your-corp.com` — if you're
  off the corporate VPN, OAuth will fail at the consent screen.
- **The API process** must also be able to reach the host for the token
  exchange step. Usually identical requirement, but worth noting if you
  run the API on a different machine than your browser.
- **Self-signed certificates**: if your GitLab uses an internal CA not in
  the system trust store, the API will fail with `self signed certificate`.
  Either install the CA bundle on the host running the API, or contact
  the maintainers — TLS opt-out flag is not currently exposed.

---

## Bitbucket (SaaS — bitbucket.org)

1. Open https://bitbucket.org/account/settings/app-passwords/ — or for OAuth:
   https://bitbucket.org/<workspace>/workspace/settings/api
2. Add a new OAuth consumer:
   - **Name**: `Agent Orchestrator`
   - **Callback URL**: `http://localhost:3002/api/git/callback/bitbucket`
   - **Permissions**: Account (read), Repositories (read + write)
3. Add to `apps/api/.env`:
   ```
   BITBUCKET_OAUTH_CLIENT_ID=<Key>
   BITBUCKET_OAUTH_CLIENT_SECRET=<Secret>
   ```
4. Restart API.

> **Bitbucket Data Center** (self-hosted) has a different REST API path
> (`/rest/api/1.0`) and is **not currently supported**. Open an issue if
> you need it.

---

## After setup — what changes

Once a provider is configured and you click **Connect** in `/settings/git-providers`:

- The provider appears in your account with a green "connected" badge.
- When you create a new project you can choose **Clone existing repo** and
  pick from your provider's repo list.
- Agent commits push to the connected remote on the same branch.
- For GitHub, the **"Open as Pull Request"** toggle in branch chat merge
  modal becomes available. The branch is pushed to origin and a PR opens
  via the GitHub API instead of doing a local merge. (GitLab and Bitbucket
  support coming later.)

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `redirect_uri_mismatch` after authorize | The OAuth app's registered Redirect URI doesn't match what the API sends. Copy the exact URL from `/api/git/connect/<provider>` redirect target and paste into the provider's app config. Watch for trailing slashes. |
| `invalid_client` | Client ID or Secret in env doesn't match the OAuth app. Re-copy from provider UI. |
| `getaddrinfo ENOTFOUND gitlab.your-corp.com` | API can't reach the on-prem host. Check VPN / network policy. |
| `self signed certificate` | On-prem instance uses internal CA not trusted by the API host. Install the CA bundle system-wide or use `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` env. |
| Provider not showing up in UI after env change | API not restarted. The env is read at boot; restart the API process. |
| Callback redirects to `localhost:3002/settings/...` and 404s | API is sending an absolute redirect to the wrong port. Check `CORS_ORIGINS` in API env — first entry must be the web origin (e.g. `http://localhost:3010`). |

## Multi-instance (e.g. SaaS + on-prem)

The orchestrator currently supports **one instance per provider per deploy**.
If you need both `gitlab.com` and `gitlab.your-corp.com` from the same
orchestrator install, run two separate API processes with different
`GITLAB_API_BASE` envs and route per use case. Multi-instance per workspace
is not on the roadmap unless multiple users ask for it.
