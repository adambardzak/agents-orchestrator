# Compliance and Regulations — Energy Trading

**TL;DR:** CEZ Trading operates under EU energy market regulation (REMIT,
EMIR, MiFID II) and EU ETS rules for emission allowances. Every trading
application MUST emit complete, immutable audit trails, support trade
reconstruction within 5 years, and integrate with our regulatory reporting
pipeline. Failure to comply means regulatory fines and trading license risk.
NEVER deploy a trading-related app without compliance team sign-off.

## Regulations that apply to us

### REMIT (Regulation on Wholesale Energy Market Integrity and Transparency)
- **Authority**: ACER (EU) + national regulator __NATIONAL_REGULATOR__ (e.g. ERÚ for CZ)
- **Scope**: ALL wholesale electricity and gas trades in EU markets
- **Reporting**: trades and orders submitted via __REMIT_RRM__ (Registered
  Reporting Mechanism, e.g. Equias, Trayport, exchange-as-RRM)
- **Inside information disclosure**: market-moving info (plant outages,
  capacity changes) MUST be published on __UMM_PLATFORM__ before being
  acted upon internally
- **Data retention**: 5 years minimum for all trade data, orders, communications

### EMIR (European Market Infrastructure Regulation)
- **Authority**: ESMA + national __NATIONAL_REGULATOR__
- **Scope**: derivatives — power and gas forwards, swaps, options
- **Reporting**: T+1 to a registered Trade Repository __TRADE_REPOSITORY__
  (e.g. REGIS-TR, DTCC, KDPW)
- **Clearing obligation**: certain standardized derivatives must clear via CCP
- **Risk mitigation**: timely confirmation, portfolio reconciliation, dispute resolution

### MiFID II (Markets in Financial Instruments Directive)
- **Authority**: ESMA + national regulator
- **Scope**: financial instruments (most physical power/gas EXEMPT under
  ancillary activity exemption, but financially-settled and certain
  speculative trades are in scope)
- **Best execution**: MUST document venue selection rationale
- **Transaction reporting**: T+1 via __ARM__ (Approved Reporting Mechanism)
- **Algorithmic trading**: pre-trade risk controls, kill switch, annual self-assessment

### EU ETS (Emissions Trading System)
- **Authority**: European Commission + national authority __ETS_REGISTRY__
- **Scope**: EU Allowances (EUA) and aviation allowances (EUAA)
- **Account types**: trading accounts, holding accounts, person accounts
- **MAR (Market Abuse Regulation)** applies to EUA trading

### MAR (Market Abuse Regulation)
- Insider trading prohibition
- Market manipulation prohibition
- Suspicious Transaction and Order Reports (STOR) obligation
- Insider lists maintenance per project / inside information

## Audit trail requirements

Every trade-affecting action MUST be logged with:
- **Actor**: user `sub` (AD account) OR service identity (mTLS cert CN)
- **Timestamp**: UTC, microsecond precision, sourced from NTP-synced clock
- **Action**: structured (`order.placed`, `order.cancelled`, `trade.confirmed`,
  `position.adjusted`, `risk_limit.breached`, `kill_switch.activated`)
- **Before/after state**: full snapshot of changed entity (immutable JSON diff)
- **Source**: app name, version, hostname, request ID, correlation ID
- **Approval chain**: if action required four-eyes approval, who approved when

Logs ship to **__AUDIT_LOG_STORE__** (e.g. Splunk, immutable Loki bucket).
Retention: **__AUDIT_RETENTION_YEARS__ years** (5 minimum, often 7 for safety).

```typescript
import { auditLog } from '@cez-trading/audit'

await auditLog.emit({
  actor: { type: 'user', id: session.sub, source_ip: req.ip },
  action: 'order.placed',
  resource: { type: 'order', id: order.id, market: 'EPEX-DE-DA' },
  state_before: null,
  state_after: order,
  correlation_id: req.headers['x-correlation-id'],
})
```

NEVER use generic application logging for audit events — they have
different retention, access control, and tamper-evidence requirements.

## Pre-trade controls (MiFID II RTS 6, REMIT)

Algorithmic / automated trading systems MUST implement:
- **Maximum order value**: configurable per trader, per market
- **Maximum order volume**: configurable per product
- **Maximum position**: enforced before order placement
- **Price collar**: reject orders outside ±N% of last trade price
- **Self-trade prevention**: reject orders that would match against own resting orders
- **Kill switch**: single button cancels all open orders in market, halts strategy

All controls MUST be configurable WITHOUT code deploy (config service
`__RISK_CONFIG_URL__`). Audit log every change.

## Communications recording

ALL trader communications related to deals MUST be recorded:
- Voice calls (turret system __TURRET_VENDOR__)
- Chat (Bloomberg / __CHAT_PLATFORM__) — feed integrated to __ARCHIVE_PLATFORM__
- Email — corporate Outlook with retention policy
- ANY in-app messaging feature you build MUST integrate with __ARCHIVE_PLATFORM__

## Personal account dealing

Employees may trade personally subject to PA dealing policy:
- Pre-clearance via __PA_DEALING_TOOL__
- Restricted list (companies on which we have inside info) blocked automatically
- Cooling-off periods after corporate events

If you build features showing market data to traders, do NOT expose them
to employees outside trading desk without compliance review (selective
information disclosure risk).

## Inside information ("PPI" — privileged information)

Material non-public information about generation, transmission, or consumption:
- MUST be published to UMM platform __UMM_PLATFORM__ within reasonable time
  before being acted on internally
- Insider list MUST be maintained — anyone with access logged
- Information barriers ("Chinese walls") between trading and asset operations

If your app surfaces such data, integrate access logging that feeds the
insider list service `__INSIDER_LIST_SERVICE__`.

## STOR (Suspicious Transaction and Order Report)

Surveillance system __SURVEILLANCE_PLATFORM__ monitors for:
- Wash trades, spoofing, layering, momentum ignition
- Cross-product manipulation
- Quote stuffing

Triggers human compliance review → potential STOR filing to regulator.
Your app does NOT need to implement detection (centralized) but MUST emit
order/trade events to surveillance feed (Kafka topic `surveillance.events.v1`).

## Sanctions screening

Counterparty checks before any new trade or onboarding:
- EU sanctions list, OFAC SDN, UK OFSI, UN consolidated list
- Service: `__SANCTIONS_SERVICE_URL__`
- Refresh daily; trades blocked on positive hit until compliance clears

## Data classification

| Class             | Examples                                | Storage location                  |
|-------------------|-----------------------------------------|-----------------------------------|
| Public            | Published forecasts, UMM messages       | Any                               |
| Internal          | Approved positions, P&L summaries       | Internal apps only                |
| Confidential      | Trading strategies, model parameters    | Restricted access, encrypted at rest |
| Strictly Confidential / Insider | PPI, M&A info, proprietary algos | Insider-controlled, audit every access |

NEVER copy Confidential or above to dev/test environments without scrubbing.

## DO NOT
- ❌ Suppress, edit, or delete audit log entries — illegal under REMIT/MiFID.
- ❌ Use unencrypted channels for trade messaging — TLS minimum.
- ❌ Build messaging features without compliance archive integration.
- ❌ Display Insider information to users not on the insider list for that case.
- ❌ Trade without sanctions screening — every counterparty, every trade.
- ❌ Copy production trading data to dev/test without approval and PII/PPI scrubbing.
- ❌ Use generative AI on confidential trade data through external SaaS
  (ChatGPT, Claude.ai web, Copilot Free) — use only approved internal LLM gateway.
- ❌ Allow algorithmic strategies without pre-trade risk controls and kill switch.
- ❌ Let clock drift exceed 100ms from UTC — regulatory timestamps require accuracy.

## Pre-go-live compliance checklist

Before any trading-impacting feature ships:
- [ ] Audit logging implemented and tested (sample log entries reviewed)
- [ ] Pre-trade risk controls configured and tested (negative tests for breach)
- [ ] Kill switch / cancel-all functionality verified
- [ ] Sanctions screening hooked in for counterparty interactions
- [ ] Data classification reviewed; PPI/Insider data flows mapped
- [ ] Surveillance feed emits order/trade events in correct schema
- [ ] Documentation in `__COMPLIANCE_DOC_REPO__` updated
- [ ] Compliance team sign-off recorded in CHG ticket
