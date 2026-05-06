# Business Domain — CEZ Trading Energy Markets

**TL;DR:** CEZ Trading is the wholesale energy trading desk of CEZ Group.
We trade electricity, natural gas, emission allowances (EUA), and
green/guarantee-of-origin certificates across European markets. All
applications must understand power/gas market mechanics, time zones (CET/CEST),
delivery periods, and trading sessions.

## What we trade

- **Electricity (power)** — physical and financial, day-ahead and intraday on
  exchanges (EPEX SPOT, OTE, HUPX, OPCOM, BSP), forwards on EEX, OTC bilateral.
- **Natural gas** — TTF, CEGH, NCG/THE, PSV; spot and forward.
- **Emission allowances (EUA)** — EU ETS, traded on EEX and ICE Endex.
- **Green certificates / Guarantees of Origin (GO)** — AIB hub trades.
- **Coal, freight, weather derivatives** — secondary, lower volume.

## Markets and exchanges

Power exchanges we connect to:
- **EPEX SPOT** (Paris) — day-ahead and intraday for DE/AT/FR/BE/NL/CH
- **OTE** (Prague) — Czech day-ahead and intraday
- **HUPX** (Budapest) — Hungarian day-ahead
- **OPCOM** (Bucharest) — Romanian day-ahead
- **BSP** (Ljubljana) — Slovenian/SI day-ahead
- **EEX** (Leipzig) — power forwards, gas, EUA
- **ICE Endex** — UK power, gas, EUA

Gas hubs: **TTF** (Netherlands), **THE** (Germany, post-NCG/GASPOOL merger),
**CEGH** (Austria), **PSV** (Italy), **PVB** (Spain).

## Time conventions — CRITICAL

All trading runs on **CET/CEST** (Central European Time, UTC+1/+2 with DST).
All internal timestamps must be stored in UTC and displayed in CET.

- **Delivery hour** — 1-24 (NOT 0-23). Hour 1 = 00:00–01:00 CET.
- **DST transition days** — March (23 hours, hour 3 missing) and October
  (25 hours, hour 3A and 3B). Code MUST handle both cases.
- **Day-ahead gate closure** — 12:00 CET on D-1 for delivery day D.
- **Intraday continuous** — until 5 minutes before delivery hour start.
- **Trading day boundary** — energy day starts 00:00 CET, NOT midnight UTC.

## Product taxonomy

- **Spot** — physical delivery within 1 trading day (day-ahead, intraday).
- **Prompt** — within-week delivery (next-day, weekend, balance-of-week).
- **Forward / Futures** — month, quarter, season (Q1=Winter, Q3=Summer
  in power; Sum/Win in gas), calendar year, multi-year.
- **Base** — 24h/day flat delivery.
- **Peak** — 8:00–20:00 weekdays (Mon-Fri) only.
- **Off-peak** — complement of peak.

## Pricing and units

- **Power**: EUR/MWh (always EUR for European trades)
- **Gas**: EUR/MWh (calorific value basis), occasionally EUR/Therm (UK)
- **EUA**: EUR/tCO₂ (per metric ton of CO₂ equivalent)
- **Volume tick** — typically 0.1 MW for spot, 1 MW for forward
- **Price tick** — 0.01 EUR/MWh

## Counterparties

We trade with utilities, banks, hedge funds, industrial consumers, and
producers. Every counterparty has:
- **Legal entity ID** (LEI — 20-char alphanumeric, e.g. `529900T8BM49AURSDO55`)
- **EIC code** (Energy Identification Code, used by ENTSO-E)
- **Internal credit limit** (must be checked before trade execution)
- **ISDA Master Agreement** or **EFET General Agreement** as bilateral framework

## DO NOT confuse with retail energy

- ❌ Retail electricity supply (B2C contracts, kWh billing) — different business
- ❌ Distribution / grid operations — that is CEZ Distribuce
- ❌ Power generation operations — that is CEZ-the-utility
- CEZ Trading is **wholesale only**: short-term optimization and proprietary trading

## DO NOT
- ❌ Use local time without explicit CET/CEST handling — leads to off-by-one-hour
  delivery period bugs that lose real money on settlement.
- ❌ Treat October DST day as 24 hours — it has 25, and hour 3 occurs twice.
- ❌ Round prices below 2 decimals — exchanges reject orders with finer granularity
  but settlement requires exactly 2.
- ❌ Mix peak/off-peak hours definitions across products — power peak is
  Mon-Fri 8-20 CET; gas has no peak/off-peak split.
- ❌ Display volumes without unit — "100" is meaningless; always "100 MW"
  or "100 MWh" depending on whether it is power (rate) or energy (quantity).

## Glossary

- **MW** — megawatt, instantaneous power capacity
- **MWh** — megawatt-hour, energy delivered over time (1 MW × 1 h)
- **TSO** — Transmission System Operator (e.g. ČEPS for Czechia, 50Hertz for DE)
- **DSO** — Distribution System Operator
- **PPA** — Power Purchase Agreement (long-term bilateral)
- **VPP** — Virtual Power Plant
- **ETRM** — Energy Trading and Risk Management system
- **CCP** — Central Counterparty (clearing house, e.g. ECC for EEX trades)
- **ENTSO-E** — European Network of Transmission System Operators for Electricity
