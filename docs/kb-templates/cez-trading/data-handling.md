# Data Handling — Trade Data, Market Data, PII

**TL;DR:** Trade and order data are business-critical and regulated (REMIT/EMIR
audit trail, 5+ year retention). Market data has vendor licensing constraints
(Refinitiv/Montel/ICIS contracts restrict redistribution). Employee PII falls
under GDPR. Counterparty contact data is treated as Internal. NEVER copy
production trade or PPI data to dev/test, NEVER redistribute licensed market
data outside CEZ Trading, NEVER feed confidential data to external AI services.

## Data classes (recap from compliance-regulations.md)

- **Public**: published forecasts, UMM messages, exchange end-of-day data
- **Internal**: positions, P&L, internal forecasts, organizational info
- **Confidential**: trading strategies, model parameters, model outputs,
  individual deal pricing not yet on regulatory feed
- **Strictly Confidential / Insider (PPI)**: market-sensitive non-public info
  (plant outages, large position intent, M&A)

## Trade data

### Storage
- **System of record**: ETRM (`__ETRM_NAME__`) Oracle DB — never queried directly
- **Application copies**: only via ETRM API; cache at most 30 minutes; never persist
  beyond app TTL
- **Audit log**: immutable store at __AUDIT_LOG_STORE__, retention __AUDIT_RETENTION_YEARS__ years

### Modifications
Trades, once captured, are NEVER deleted or hard-edited. Corrections create
**amendment records** linked to the original (audit chain maintained). The
ETRM API exposes `POST /trades/<id>/amend`; never use UPDATE on the DB.

### Sensitive fields
- Counterparty LEI, name, contact: Internal
- Trade pricing on bilateral OTC: Confidential until on regulatory feed
- Strategy / book name when paired with deal flow: Confidential
- Trader identity on individual trades: Internal (kept off external dashboards)

## Market data

### Vendor contracts dictate usage
Each market data source has a license that restricts who and how data may be
used. Common categories:
- **Display use**: human eye on screen (broad license)
- **Programmatic use**: feed into models (narrower license, often per-app)
- **Redistribution**: showing to entities outside CEZ Trading (almost always forbidden)
- **Derived data**: indices, signals computed from raw data (often allowed
  internally, may require attribution)

Before integrating a new data source, check `__MARKET_DATA_LICENSE_REGISTRY__`.

### Redistribution rules
- ❌ Sharing Refinitiv/Montel/ICIS data with sister companies (CEZ Distribuce,
  CEZ ESCO etc.) WITHOUT separate license check
- ❌ Posting market data screenshots to public channels (LinkedIn, social media)
- ❌ Including market data in customer-facing reports without "powered by"
  attribution mandated by the contract
- ❌ Using market data to train external ML services (vendor data → external SaaS = breach)

### Caching market data
- **Real-time prices**: in-memory only, TTL ≤ 5 seconds (avoid stale order execution)
- **Intraday history**: Redis with TTL = end of trading day
- **Historical (D-1+)**: time-series DB `__TSDB_NAME__` (managed by data team)
- NEVER cache vendor data on developer laptops or personal cloud storage

## Personal data (GDPR)

Employee data we touch:
- AD account, email, full name, manager, department (from corporate directory)
- Trading desk role, permissions, group memberships
- Login times, IP addresses (audit logs)
- Personal account dealing pre-clearance records (compliance domain)

Counterparty contacts:
- Names, emails, phone numbers of broker/trader contacts
- Stored in CRM `__CRM_URL__`; do NOT replicate into other apps

### GDPR principles
- **Lawful basis**: legitimate interest for employee/counterparty data; consent
  for any optional processing
- **Minimization**: do not collect data your feature does not need
- **Retention**: define retention per data type, document in `__DATA_RETENTION_POLICY__`
- **Access requests**: subjects can request export/deletion; route via DPO `__DPO_EMAIL__`
- **Data residency**: EU only — no transfers to US/non-adequate countries
  without SCCs (corporate proxy + on-prem infra makes this default-safe)

### NEVER log PII at INFO level
```typescript
// ❌ Bad
logger.info({ user_email: 'jan.novak@cez.cz', ip: req.ip }, 'login successful')

// ✅ Good — log identifier suitable for correlation, not raw PII
logger.info({ user_id: session.sub, source_ip_class: classifyIP(req.ip) }, 'login successful')
```

Audit logs (separate channel) MAY contain identifiers per regulatory mandate.

## PII / PPI in dev and test environments

- ❌ Copying production DB dumps to dev WITHOUT scrubbing
- ❌ Using real counterparty names in test fixtures
- ❌ Using real trader names in screenshots, demos, or training material
- ✅ Use `@cez-trading/test-fixtures` which provides realistic but synthetic
  counterparties, traders, deals
- ✅ When real data shape is needed, request scrubbed extract from data team
  (named accounts replaced with `Counterparty_001`, etc.)

## Data residency

- All production data MUST stay within EU data centers
- Backups MUST be encrypted and stored within EU
- Disaster recovery sites are __DR_LOCATION__ (e.g. secondary EU data center)
- ❌ NO production data in AWS, Azure, GCP — even EU regions (data sovereignty
  policy stricter than GDPR adequacy)

## Encryption

- **In transit**: TLS 1.2+ everywhere; mTLS for service-to-service
- **At rest**:
  - DBs: transparent encryption via storage layer (managed by platform)
  - Object storage: server-side encryption with customer-managed keys
    (Vault transit engine `__VAULT_TRANSIT__`)
  - Backups: encrypted before leaving source system
- **Key management**: HashiCorp Vault `__VAULT_URL__` (transit + KV engines)
- **NEVER**: hardcoded keys in repos, plaintext secrets in env files committed to git,
  bring-your-own-key from cloud provider (we self-manage)

## AI / LLM usage

- Internal LLM gateway: `__INTERNAL_LLM_GATEWAY__` (OpenAI/Anthropic/Azure
  proxied through corporate network with logging and policy enforcement)
- ❌ ChatGPT.com, Claude.ai web UI, Copilot Free, Gemini direct — banned for
  Internal/Confidential/PPI data
- ✅ GitHub Copilot for code (corporate license, opt-out of training enabled)
- ✅ Internal LLM gateway for chat/RAG features in apps
- For agent orchestration: provider configured via internal proxy, do NOT
  route trade/position data through external LLMs

## Incident response

If you suspect a data breach (leak, unauthorized access, accidental email):
1. STOP further propagation immediately
2. Notify __SECURITY_INCIDENT_CONTACT__ within 1 hour
3. Preserve evidence (logs, emails) — do NOT delete to "clean up"
4. Cooperate with __DPO_EMAIL__ for GDPR breach assessment (72-hour
   regulator notification clock starts)

## DO NOT
- ❌ Replicate trade/position data into shadow databases for "convenience"
- ❌ Build dashboards that combine market data from multiple licensed vendors
  without checking each license for derived-data permissions
- ❌ Email spreadsheets containing trade data to personal addresses (yours or anyone's)
- ❌ Use external file-sharing (WeTransfer, Dropbox, Google Drive personal)
  for any work data
- ❌ Train ML models on confidential trade data using external compute (AWS SageMaker,
  Google Vertex, Hugging Face Spaces) — use internal GPU cluster `__INTERNAL_ML_PLATFORM__`
- ❌ Skip data classification review on new data sources or new data flows

## Quick reference

| Data type                    | Where it lives          | Who can access        | Retention   |
|------------------------------|-------------------------|------------------------|-------------|
| Trades (system of record)    | ETRM Oracle             | Trading + ops + compliance | 5+ years (legal hold may extend) |
| Trades (audit log)           | __AUDIT_LOG_STORE__     | Compliance + audit     | __AUDIT_RETENTION_YEARS__ years |
| Real-time prices             | App memory + Redis      | App users (license-permitting) | seconds–hours |
| Historical market data       | __TSDB_NAME__           | Per data classification | per vendor contract |
| Counterparty CRM             | __CRM_URL__             | Sales + traders        | per contract lifecycle + 7 years |
| Employee directory           | AD + corporate HR       | All employees (basic), HR (full) | per employment + GDPR |
| Application audit logs       | Splunk / Loki           | Security + compliance  | 1+ year (longer for trade-related) |
