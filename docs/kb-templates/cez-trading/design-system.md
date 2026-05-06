# Design System — CEZ Trading UI

**TL;DR:** All CEZ Trading user interfaces use the internal design system
**`@cez-trading/ui`** (version __UI_VERSION__) built on top of __BASE_LIBRARY__
(e.g. Mantine, Material UI, Ant Design — replace with your real base).
Brand tokens align with CEZ corporate identity (orange `#F26522`, dark blue
`#003D7A`). NEVER use shadcn/ui, Radix raw, Material directly, Tailwind utility
classes for component styling, or any other UI kit.

## Component library

Install:
```bash
pnpm add @cez-trading/ui@^__UI_MAJOR__
```

Provides:
- **Layout**: `AppShell`, `Sidebar`, `TopBar`, `PageHeader`, `Card`, `Stack`, `Group`
- **Forms**: `TextInput`, `NumberInput`, `Select`, `MultiSelect`, `DatePicker`,
  `DateTimePicker`, `TimeRangePicker`, `Checkbox`, `Radio`, `Switch`, `FormField`
- **Data display**: `DataTable` (with sticky headers, virtualization, column pinning),
  `MetricCard`, `Sparkline`, `PnLBadge` (color-coded gain/loss), `PriceTicker`
- **Trading-specific**: `OrderBookView`, `TradeBlotter`, `PositionGrid`,
  `PriceCurveChart`, `DeliveryPeriodPicker` (handles DST 23/25-hour days)
- **Feedback**: `Notification`, `Modal`, `Drawer`, `Loader`, `Skeleton`, `EmptyState`
- **Trading actions**: `ConfirmTradeDialog`, `KillSwitchButton` (red, double-confirm)

## Tokens

Defined in `@cez-trading/ui/tokens`:
```typescript
import { tokens } from '@cez-trading/ui/tokens'

tokens.color.brand.primary       // #F26522 (CEZ orange)
tokens.color.brand.secondary     // #003D7A (CEZ dark blue)
tokens.color.semantic.gain       // green for profit
tokens.color.semantic.loss       // red for loss
tokens.color.semantic.neutral    // gray for unchanged
tokens.color.surface.background  // light/dark mode aware
tokens.spacing[1..8]             // 4px..32px scale
tokens.radius.sm | md | lg
tokens.typography.mono           // for prices and IDs
```

NEVER hardcode colors like `color: '#F26522'`. Use `tokens.color.brand.primary`.

## Number formatting

Trading apps display many numbers — formatting must be consistent and locale-aware:
```typescript
import { formatPrice, formatVolume, formatPnL } from '@cez-trading/ui/format'

formatPrice(123.456, 'EUR/MWh')   // "123.46 EUR/MWh" (2 decimals, EN locale always)
formatVolume(1500, 'MW')          // "1,500 MW" (thousand separators)
formatPnL(-45_000)                // "-€45,000.00" (red, with sign)
```

**Locale**: numbers always EN format (`1,234.56`) regardless of user UI language —
prevents bugs when copying values across systems and aligns with exchange feeds.

## Typography

- UI text: Inter (sans-serif)
- Numbers (prices, volumes, IDs): JetBrains Mono — tabular figures so columns align
- Headings: Inter, weight 600 with brand color underline accent

```tsx
<Text variant="number-mono">{price}</Text>  // tabular, monospace
```

## Light vs dark mode

Both supported. Trader workstations typically use dark mode (4-monitor setups).
Dark mode is NOT just inverted colors — gain/loss reds and greens have
specific shades calibrated for low ambient light.

Toggle via `<ThemeProvider>`; respects `prefers-color-scheme` and saves
preference to user profile via `__USER_PREFS_API__`.

## Charts

Use **`@cez-trading/charts`** (wrapper around __CHART_LIB__, e.g. uPlot,
LightweightCharts, ECharts). Provides:
- `PriceLineChart` — multi-series with x-axis as delivery period (handles DST)
- `OrderBookDepthChart`
- `CandlestickChart` (OHLC for forwards)
- `HeatmapChart` (volume by hour-of-day, day-of-week)

NEVER use Chart.js, Recharts, Victory, Highcharts directly — license cost
and DST handling does not work out of the box.

## Accessibility

Components ship with WCAG AA compliance:
- All interactive elements keyboard-reachable (Tab, Enter, Esc, Arrow keys)
- Focus rings visible (do NOT remove with `outline: none`)
- ARIA roles applied (`role="grid"` for DataTable, `role="alert"` for errors)
- Color is never the only signal (PnL has +/- sign + color)

## Tailwind usage

Tailwind is used ONLY for layout utilities (`flex`, `grid`, `gap-*`,
`p-*`, `m-*`, `w-*`, responsive prefixes). NOT for:
- Colors → use `@cez-trading/ui` components or `tokens.color.*`
- Typography → use `<Text>` and `<Heading>` components
- Borders / shadows / radius → use components

```tsx
// ✅ Good
<div className="flex gap-4 p-6">
  <Card>...</Card>
  <Card>...</Card>
</div>

// ❌ Bad
<div style={{ backgroundColor: '#F26522' }}>...</div>
<div className="bg-orange-500 text-white rounded-lg p-4">...</div>
```

## DO NOT
- ❌ shadcn/ui, Radix bare primitives, Material UI, Ant Design, Chakra,
  Headless UI, NextUI — use `@cez-trading/ui` only.
- ❌ Inline `<style>` or `style={{...}}` for colors, fonts, sizes.
- ❌ CSS-in-JS libraries (styled-components, emotion, stitches).
- ❌ Custom number formatting (`.toFixed()`, `.toLocaleString()`) — use
  `@cez-trading/ui/format` helpers.
- ❌ DatePicker libraries other than what `@cez-trading/ui` exports —
  delivery date pickers must understand DST and trading calendars.
- ❌ Toast libraries (react-hot-toast, sonner) — use `<Notification>` for
  audit trail integration.
- ❌ Icon libraries other than `@cez-trading/ui/icons` (Heroicons / Lucide
  selection vetted for finance UI).

## When new components are needed

If `@cez-trading/ui` does not have what you need:
1. Check the design backlog in __DESIGN_REPO_URL__
2. Open a request with mockup; do NOT build a one-off in your app repo
3. For prototypes only, build inline but mark `// TODO: extract to design system`
