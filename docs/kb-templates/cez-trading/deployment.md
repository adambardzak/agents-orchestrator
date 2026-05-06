# Deployment — CEZ Trading Internal Infrastructure

**TL;DR:** All CEZ Trading apps deploy to internal Kubernetes clusters
(`__K8S_CLUSTER_PROD__` for production, `__K8S_CLUSTER_UAT__` for UAT)
managed by the platform team. Container images are built in GitLab CI
(`__GITLAB_URL__`) and pushed to the internal Harbor registry
(`__HARBOR_URL__`). Helm charts live in repo `__INFRA_REPO__`.
NEVER use AWS, Azure, GCP, Vercel, Netlify, or any public cloud — all
workloads run on-premise per data residency policy.

## Pipeline overview

```
Developer push to GitLab
        ↓
GitLab CI runs (`.gitlab-ci.yml`)
  - lint, test, build
  - build Docker image
  - scan image (Trivy + Twistlock)
  - push to Harbor
        ↓
ArgoCD detects new image tag in Helm values
        ↓
ArgoCD syncs to target cluster
        ↓
Health check → traffic shift (blue/green or canary)
```

## Environments

| Env  | K8s cluster              | Hostname pattern              | Auto-deploy from |
|------|--------------------------|-------------------------------|------------------|
| Dev  | `__K8S_CLUSTER_DEV__`    | `*.dev.trading.cez.cz`        | feature branches |
| UAT  | `__K8S_CLUSTER_UAT__`    | `*.uat.trading.cez.cz`        | `develop` branch |
| Prod | `__K8S_CLUSTER_PROD__`   | `*.trading.cez.cz`            | `main` + manual approval |

Production deploys require:
- Two approvers from the deployment-approvers group
- CHG ticket in ServiceNow (Standard or Normal change)
- Deployment window (Mon-Thu 09:00-16:00 CET; never Fri or before market close)

## GitLab CI

`.gitlab-ci.yml` template — extend from `__CI_TEMPLATE_REPO__`:
```yaml
include:
  - project: 'platform/ci-templates'
    ref: 'v3'
    file: '/templates/node-service.yml'

variables:
  HARBOR_PROJECT: trading
  HELM_CHART: charts/__APP_NAME__
```

The template provides:
- Multi-stage Docker build (Node.js base from `__BASE_IMAGE_REGISTRY__`)
- npm install from internal registry `__NPM_REGISTRY__`
- Trivy vulnerability scan (build fails on HIGH/CRITICAL)
- Image signing with Cosign

## Container registry (Harbor)

- URL: `__HARBOR_URL__`
- Project per team (e.g. `trading`, `risk`, `analytics`)
- Image naming: `__HARBOR_URL__/<project>/<app>:<git-sha>` and `:<tag>`
- Retention: untagged images deleted after 14 days; tagged kept indefinitely
- Pull secrets injected by platform via service account

## Helm charts

Standard chart in `__INFRA_REPO__/charts/<app-name>/`:
```
charts/__APP_NAME__/
├── Chart.yaml
├── values.yaml          # defaults
├── values-dev.yaml      # dev overrides
├── values-uat.yaml
├── values-prod.yaml
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    ├── ingress.yaml
    ├── hpa.yaml
    ├── networkpolicy.yaml
    └── servicemonitor.yaml
```

Use the platform's library chart `__PLATFORM_LIB_CHART__` as a base — do not
hand-roll Kubernetes manifests.

## Secrets management

Secrets come from **HashiCorp Vault** at `__VAULT_URL__` via External Secrets
Operator. Define in chart:
```yaml
externalSecrets:
  - name: oidc-credentials
    vaultPath: secret/apps/__APP_NAME__/oidc/__ENV__
    keys: [client_id, client_secret]
```

NEVER commit secrets to Git, even in encrypted form. NEVER use Kubernetes
`Secret` objects directly — always External Secrets so rotation is automatic.

## Networking

- Ingress controller: **__INGRESS_CONTROLLER__** (e.g. nginx, Traefik)
- TLS: Internal CA-signed certs auto-issued via cert-manager (do NOT use Let's Encrypt)
- All ingresses internal-only by default; expose externally requires
  security review and WAF rule registration
- East-west traffic: enforced via NetworkPolicy (default deny, explicit allow)

## Observability

Pre-wired by platform — your app must:
- Expose **Prometheus** metrics at `/metrics` on port `9090` (use `prom-client`)
- Log to **stdout in JSON** (`pino` recommended) — collected by Fluent Bit → Loki
- Emit **OpenTelemetry traces** to OTLP endpoint `__OTEL_COLLECTOR__:4317`
- Health endpoints: `/health/live` and `/health/ready` on app port

## Deployment cadence

- Hotfix: immediate after approval, any time
- Regular: daytime weekdays, batched
- Major (breaking schema/API changes): scheduled with downstream coordination
- **No deploys after 16:00 CET (1 hour before EPEX intraday session ends)**
- **No deploys on settlement days without operations approval** (1st of month)

## DO NOT
- ❌ Deploy to AWS/Azure/GCP/Vercel/Netlify/Heroku/Railway — banned by policy.
- ❌ Use Docker Hub for base images — use `__BASE_IMAGE_REGISTRY__` (mirrored, scanned).
- ❌ Run `kubectl apply` directly on production — only via ArgoCD GitOps.
- ❌ Bake secrets into Docker image layers — use External Secrets at runtime.
- ❌ Use `latest` tag for images — always pin to git SHA or semver.
- ❌ Skip the security scan — failing builds cannot be force-pushed.
- ❌ Set `replicas: 1` for production — always >= 2 for HA, with PodDisruptionBudget.
- ❌ Use `hostNetwork: true` or privileged containers — blocked by Pod Security Admission.
