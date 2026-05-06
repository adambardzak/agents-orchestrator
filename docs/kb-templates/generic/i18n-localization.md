# Internationalization and Localization

**TL;DR:** Build i18n from day one even if you launch with one language —
retrofitting is painful. Use ICU MessageFormat (or i18next) for translatable
strings with placeholders and plurals. Store messages in JSON keyed by locale.
Format dates, numbers, and currencies via `Intl` (browser/Node native) — never
hand-roll. Detect locale from user setting first, then `Accept-Language`, then
fallback. Externalize ALL user-facing strings (no hardcoded English in
templates). Plan for RTL (Arabic, Hebrew) layouts even if you don't ship them
yet.

## Vocabulary

- **i18n** (internationalization) — engineering work that makes the product
  capable of multiple languages, formats, and conventions
- **l10n** (localization) — actual translations and locale-specific content
  for a target language/region
- **Locale** — language + region: `en-US`, `cs-CZ`, `de-AT`. Determines
  language, date format, number format, currency, calendar, sometimes legal text
- **Translation key** — stable identifier for a string (`auth.login.button.submit`)

## Locale identification

Use BCP 47 tags: `<language>[-<script>][-<region>]`
- `en` — English (any region)
- `en-US` — American English
- `en-GB` — British English
- `cs-CZ` — Czech (Czechia)
- `zh-Hans-CN` — Simplified Chinese (China)
- `pt-BR` — Brazilian Portuguese (different from `pt-PT`)

Order of locale resolution:
1. User's saved preference (profile setting in DB)
2. URL prefix (`/cs/dashboard`) — explicit, shareable
3. Cookie (set after first detection, persistent)
4. `Accept-Language` HTTP header (browser default)
5. Geolocation (last resort, often wrong)
6. App default (e.g. `en`)

## Translatable strings

EVERY user-facing string is a key:

```json
// locales/en.json
{
  "auth": {
    "login": {
      "title": "Sign in to your account",
      "button": { "submit": "Sign in" },
      "error": {
        "invalid_credentials": "Email or password is incorrect"
      }
    }
  }
}

// locales/cs.json
{
  "auth": {
    "login": {
      "title": "Přihlaste se ke svému účtu",
      "button": { "submit": "Přihlásit se" },
      "error": {
        "invalid_credentials": "Neplatný e-mail nebo heslo"
      }
    }
  }
}
```

In code:
```typescript
import { useTranslations } from 'next-intl'  // or i18next, lingui, etc.
const t = useTranslations('auth.login')
return <button>{t('button.submit')}</button>
```

NEVER hardcode strings in JSX/HTML — even if you "only ship in English". You
will regret it.

## Placeholders and interpolation

Use ICU MessageFormat (most modern libs support):
```json
{ "welcome": "Hello, {name}! You have {count} messages." }
```
```typescript
t('welcome', { name: 'Adam', count: 3 })
// → "Hello, Adam! You have 3 messages."
```

NEVER concatenate translated fragments — word order varies across languages:
```typescript
// ❌
t('hello') + ' ' + name + ', ' + t('welcome')
// In Japanese this might need to be reordered entirely

// ✅
t('greeting', { name })
```

## Plurals

Plural rules vary wildly by language. English has 2 (one / other), Czech has
3 (one / few / other), Arabic has 6, Chinese has 1.

```json
{
  "messages_count": {
    "one": "You have one message",
    "few": "You have {count} messages",
    "other": "You have {count} messages"
  }
}
```

Library handles selection via CLDR rules:
```typescript
t('messages_count', { count: 3 })  // English: "other"; Czech: "few"
```

NEVER write your own pluralization logic (`if (n === 1) ... else ...`). It
will be wrong for most languages.

## Gender / context variants

Some languages distinguish (e.g. "He invited" vs "She invited" in Slavic):
```json
{
  "invited": {
    "male":   "{name} pozval vás do projektu",
    "female": "{name} pozvala vás do projektu",
    "other":  "{name} pozvali vás do projektu"
  }
}
```

For UI strings, keep gender-neutral when possible. Avoid implying gender from
user names (false assumptions).

## Dates and times

ALWAYS use `Intl.DateTimeFormat` (native, fully locale-aware):

```typescript
new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Prague',
}).format(new Date())
// → "21. dubna 2025 v 14:30"

new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/New_York',
}).format(new Date())
// → "April 21, 2025 at 8:30 AM"
```

Rules:
- Store ALL timestamps in UTC (ISO 8601 with `Z`)
- Convert to user's timezone for display
- Use locale for format (en-US: M/D/YYYY; en-GB: D/M/YYYY; cs-CZ: D.M.YYYY)
- Beware locale ≠ timezone: `en-US` user can be in Tokyo

Relative time formatting:
```typescript
new Intl.RelativeTimeFormat('en').format(-3, 'day')  // "3 days ago"
new Intl.RelativeTimeFormat('cs').format(-3, 'day')  // "před 3 dny"
```

## Numbers and currency

```typescript
new Intl.NumberFormat('en-US').format(1234567.89)
// → "1,234,567.89"

new Intl.NumberFormat('cs-CZ').format(1234567.89)
// → "1 234 567,89"  (space thousand separator, comma decimal)

new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(99.5)
// → "99,50 €"

new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(99.5)
// → "€99.50"
```

NEVER format with `.toFixed(2)` and string concat. NEVER assume `.` decimal
or `,` thousand. NEVER hardcode currency symbols in templates.

## Lists and conjunctions

```typescript
new Intl.ListFormat('en').format(['Apples', 'Oranges', 'Bananas'])
// → "Apples, Oranges, and Bananas"

new Intl.ListFormat('cs').format(['Jablka', 'Pomeranče', 'Banány'])
// → "Jablka, Pomeranče a Banány"
```

## Sorting

`Array.sort()` uses code-point order — wrong for non-English. Use locale-aware:
```typescript
items.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }))
```

For Czech, `Č` should sort after `C`, not after `Z`. `localeCompare` knows this.

## RTL (right-to-left) languages

Even if not shipping Arabic/Hebrew yet, design for it:
- Use logical CSS properties: `margin-inline-start` instead of `margin-left`
- `text-align: start` / `end` instead of `left` / `right`
- `<html dir="rtl">` switches the whole layout
- Test with `dir="rtl"` set manually — surfaces leaked physical assumptions
- Icons that imply direction (back arrows, chevrons) should mirror in RTL

## Pluralisation library example (i18next)

```typescript
i18next.init({
  fallbackLng: 'en',
  supportedLngs: ['en', 'cs', 'de'],
  resources: {
    en: { translation: enJson },
    cs: { translation: csJson },
  },
  interpolation: { escapeValue: false },  // React already escapes
})

const t = i18next.t
t('messages_count', { count: 3 })
```

## Translation workflow

- **Source of truth**: one base locale (usually `en`), other locales derived
- **Translator tool**: Crowdin, Lokalise, Phrase, Tolgee, Weblate (or self-host)
- **CI integration**: PR adds new key → tool sees missing translations → translators get notified
- **Fallback chain**: missing `cs-CZ` → fall back to `cs` → fall back to `en`
- **Don't ship** with placeholder/missing translations visible to users in production

## Locale-specific content

Beyond strings:
- **Phone numbers**: country code prefix, format
- **Postal codes**: format varies (`90210` US vs `12345` DE vs `120 00` CZ)
- **Names**: order varies (Hungarian: surname first; Spanish: two surnames)
- **Addresses**: field order, required vs optional fields differ per country
- **Identification numbers**: SSN, RČ, NIE — different validations
- **Currency**: locale ≠ currency (Swiss user might want EUR; US user might pay USD)
- **Tax**: different VAT rules per region; reverse charge for B2B EU
- **Legal text**: terms, privacy policy — must be reviewed per jurisdiction

## Server-side i18n

Server-rendered pages must localize too:
- Pass `Accept-Language` or user preference into rendering context
- API error messages: return code + parameters; let client localize
  ```json
  { "code": "VALIDATION_REQUIRED", "field": "email" }
  ```
  Client maps to localized message. Better than server returning translated text.
- Email templates: per-locale templates; pick based on recipient preference

## Testing i18n

- Run app in pseudo-locale that wraps all translated strings:
  `[Welcome to our app !!!]` — instantly see hardcoded English
- Run app with longest-translation locale (German is often 30% longer than English)
  to catch UI overflow
- Run with RTL direction to catch layout assumptions
- Snapshot tests per locale where layout differs

## Storage

- DB column for user locale preference: `users.locale TEXT NOT NULL DEFAULT 'en'`
- DB column for user timezone: `users.timezone TEXT NOT NULL DEFAULT 'UTC'`
  (IANA name like `Europe/Prague`, NOT offset like `+02:00`)
- DB content meant to be localized per-row: separate translation table
  ```sql
  product_translations(product_id, locale, name, description)
  ```
  or JSONB column with locale keys
  ```sql
  products.name_i18n JSONB  -- { "en": "Hat", "cs": "Klobouk" }
  ```

## DO NOT
- ❌ Hardcode user-facing strings in code/templates
- ❌ Concatenate translated fragments — word order is language-specific
- ❌ Roll your own plural logic — use CLDR via library
- ❌ Use `.toFixed()`, `.toLocaleString()` without explicit locale — varies by browser
- ❌ Format dates/numbers manually — `Intl` covers everything
- ❌ Assume `MM/DD/YYYY` date format — only US uses it
- ❌ Use physical CSS (`margin-left`) when logical (`margin-inline-start`) works
- ❌ Store timestamps in local time — UTC always, format on display
- ❌ Conflate locale with timezone — separate concepts
- ❌ Ship localized strings translated by machine without human review for
  user-facing critical UI (legal, payment, error messages)
- ❌ Forget plural forms in non-English locales — they break grammatically
- ❌ Use country flag emoji to represent language (Spanish ≠ Spain only)
