# Internal Systems — ETRM, Market Data, Settlement

**TL;DR:** Our trading stack revolves around our ETRM platform __ETRM_NAME__
(e.g. Allegro, Endur, RightAngle, or in-house). Market data flows from
exchange APIs and __MARKET_DATA_VENDOR__ (e.g. Refinitiv/LSEG, Montel,
ICIS). Internal apps integrate via REST API at __INTERNAL_API_BASE__
and Kafka topics at __KAFKA_BOOTSTRAP__.

## ETRM (Energy Trading and Risk Management)

Our ETRM is **__ETRM_NAME__** (version __ETRM_VERSION__). It is the system
of record for:
- Trade capture (deals from voice, chat, exchange)
- Position keeping (real-time MW/MWh by product/period/portfolio)
- P&L (mark-to-market, realized, unrealized)
- Risk metrics (VaR, PFE, credit exposure)
- Settlement and confirmation generation

### Integration points
- **REST API**: `__ETRM_API_URL__` — read positions, deals, prices
- **Trade booking**: SOAP/REST endpoint `__ETRM_BOOKING_URL__`
- **Outbound events**: Kafka topic `etrm.deals.v1`, `etrm.positions.v1`
- **Direct DB read** (Oracle): NEVER — always go through API

### Authentication
ETRM API uses __ETRM_AUTH_METHOD__ (e.g. mTLS client certs from
internal PKI, or OAuth from internal SSO). Service accounts requested
via ServiceNow ticket to __ETRM_TEAM__.

## Market data

Real-time and historical market data sources:
- **__MARKET_DATA_VENDOR__** — primary fundamental + price feed, accessed via
  __MD_API_URL__ with API key from Vault path `secret/market-data/__MD_VENDOR__`.
- **Exchange direct feeds** — EPEX SPOT M7, EEX T7 via FIX gateway at
  __FIX_GATEWAY_HOST__ (handled by trading-gateway service, not direct).
- **ENTSO-E Transparency Platform** — public, for cross-border flows,
  generation, load. Use via internal proxy `__ENTSOE_PROXY__`.
- **Internal forecasts** — load and renewables forecasts published by
  the analytics team to Kafka topic `forecasts.power.v2`.

### Time-series storage
All market data lands in our time-series DB: **__TSDB_NAME__**
(e.g. InfluxDB, TimescaleDB, kdb+) at `__TSDB_HOST__`.
- Read via internal SDK `@cez-trading/marketdata-client`
- Never query TSDB directly — use SDK for caching, retry, and access logging

## Settlement and clearing

Trades clear through:
- **ECC** (European Commodity Clearing) — for EEX-cleared trades
- **Bilateral** — for OTC, settled directly with counterparty per master agreement
- Settlement files (SDAT, SDAC, ESS) are processed by `settlement-service`
  daily at 06:00 CET.

## Reference data

Master data lives in our reference data service `__REFDATA_URL__`:
- Counterparties (with LEI, EIC, credit limits)
- Products (with delivery period, market, base/peak)
- Calendars (trading days, delivery days, holidays per market)
- FX rates (EUR/CZK, EUR/USD, EUR/PLN, EUR/HUF, EUR/RON)

**Never hardcode counterparty IDs, product codes, or holidays. Always
fetch from refdata.**

## Internal naming conventions

- **Trade ID format**: `__TRADE_ID_PATTERN__` (e.g. `T-YYYYMMDD-NNNNNN`)
- **Position keys**: `<book>/<product>/<period>` e.g. `PROP-PWR-DE/PWR-BASE/2025M03`
- **Portfolio (book) codes**: 4-8 char uppercase, e.g. `PROP-PWR-DE`, `OPT-GAS-CZ`

## DO NOT
- ❌ Read directly from ETRM Oracle DB — bypasses audit log, breaks on upgrades.
- ❌ Cache market data prices in app memory longer than 5 seconds without TTL —
  stale prices cause off-market trade execution.
- ❌ Generate trade IDs in app — always request from ETRM (collision risk
  during failover otherwise).
- ❌ Store credentials in code — use Vault `__VAULT_URL__` with AppRole.
- ❌ Connect to production ETRM from dev/test environments — use
  `__ETRM_TEST_URL__` (refreshed nightly from prod, with PII scrubbed).

## Environments

- **Production**: `__PROD_HOST_PATTERN__` (e.g. `*.trading.cez.cz`)
- **UAT**: `__UAT_HOST_PATTERN__` (full integration with ETRM-TEST)
- **Dev**: `__DEV_HOST_PATTERN__` (mocked market data, in-memory ETRM stub)
- **Local**: docker-compose with stub services from `@cez-trading/test-fixtures`
