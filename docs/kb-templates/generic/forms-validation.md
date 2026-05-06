# Forms and Validation

**TL;DR:** Define one schema (Zod or equivalent) and reuse it for client
validation, server validation, type inference, and OpenAPI generation. Validate
on blur (per field) AND on submit (whole form). Show errors next to fields,
not in a top banner. Disable submit while submitting, never on validation
state alone. Always validate on the server — client validation is UX, not
security.

## Single source of truth schema

```typescript
import { z } from 'zod'

export const createUserSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(12, 'At least 12 characters').max(128),
  fullName: z.string().min(1, 'Name is required').max(100),
  age: z.number().int().min(18, 'Must be 18 or older').max(120),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms' }),
  }),
})

export type CreateUserInput = z.infer<typeof createUserSchema>
```

Used by:
- React Hook Form via `zodResolver`
- Fastify route via schema validation
- OpenAPI generator (`zod-to-openapi`)
- TypeScript type for the function signature

One change in the schema → propagates everywhere.

## When to validate (client side)

- **On blur** — validate that field after user leaves it (avoid yelling while
  they're still typing)
- **On change** — only re-validate fields that previously had errors (so they
  see the error clear as they fix it)
- **On submit** — full schema, all errors at once, focus first invalid field
- **NOT on every keystroke** — feels harassing, especially for emails/passwords

## Where to show errors

- **Inline, below the field** — directly tied to the input, accessible via
  `aria-describedby`
- **Red border on the field** — visual but not the only signal (color + text + icon)
- **Optional summary at top** — for forms with many fields, list errors with
  anchor links jumping to each field
- **NEVER in a toast/snackbar** — disappears, fails accessibility

```html
<div class="field">
  <label for="email">Email</label>
  <input
    id="email"
    type="email"
    aria-invalid={hasError}
    aria-describedby={hasError ? 'email-error' : undefined}
  />
  {hasError && (
    <p id="email-error" role="alert" class="error">
      {errorMessage}
    </p>
  )}
</div>
```

## Submit behavior

```typescript
const onSubmit = async (data: CreateUserInput) => {
  setSubmitting(true)
  try {
    await api.createUser(data)
    onSuccess()
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN') {
      setFieldError('email', 'This email is already registered')
      return
    }
    setSubmitError('Something went wrong. Please try again.')
  } finally {
    setSubmitting(false)
  }
}
```

Submit button:
- **Disabled while submitting** (prevent double-click) with spinner
- **NOT disabled by validation state** — let user click it to see all errors at once
  (disabled buttons are confusing — "why won't this work?")
- Loading text or spinner inside button while pending

## Server validation MUST exist

Client validation is UX. Server validation is security and integrity.
ALWAYS validate on the server with the same schema, even if the client
already validated:

```typescript
fastify.post('/api/v1/users', {
  schema: { body: createUserSchema },  // or zodToJsonSchema for fastify-zod
  handler: async (req, reply) => {
    const data = req.body  // already validated and typed
    // ...
  },
})
```

Reasons:
- Attackers bypass the client trivially (Postman, curl)
- Different client versions may skip validations
- Multiple clients (web, mobile, public API) may not all validate identically

## Field-level patterns

### Email
- Type `email` for mobile keyboard, but ALSO regex/Zod validate
- Trim whitespace before validation
- Lowercase on submit (case-insensitive comparisons everywhere)
- Show "we'll send a verification email" if applicable

### Password
- Minimum 12 characters (NIST recommendation; 8 is dated)
- Allow ALL characters including spaces and unicode (no arbitrary restrictions)
- Show strength meter (zxcvbn library) but don't block weak unless policy requires
- "Show password" toggle (improves accuracy, especially mobile)
- Never enforce "must contain uppercase + number + symbol" — discourages length

### Phone
- Use `libphonenumber` for parsing/validation/formatting
- Store E.164 (`+420123456789`), display formatted per locale
- Country selector with default from user locale

### Date / Date-time
- Native `<input type="date">` accessible but limited; consider library for ranges
- Store ISO 8601 UTC, display in user locale and timezone
- Validate timezone-aware boundaries (e.g. "must be in future" depends on user's TZ)

### Number / Currency
- Type `inputmode="numeric"` for mobile (NOT `type="number"` — breaks copy-paste,
  scroll-wheel modifies value)
- Format with thousand separators on blur (`1,000` not `1000`)
- For currency: separate input for amount; show currency symbol as adornment
- Validate range AND precision (e.g. EUR has 2 decimals, JPY has 0)

### File upload
- Show file name + size after selection
- Validate type and size CLIENT side (UX) AND SERVER side (security)
- Progress bar for files > 1 MB
- Allow drag-and-drop in addition to click-to-select
- Show clear error if upload fails (network, size, type, virus scan)

### Rich text
- Sanitize HTML on the SERVER (DOMPurify or equivalent) before storage
- Whitelist allowed tags/attributes; reject everything else
- Render with care (use library that knows about XSS, not raw `dangerouslySetInnerHTML`)

## Multi-step / wizard forms

- Show progress (`Step 2 of 4`)
- Allow back navigation without losing entered data
- Persist draft to localStorage / server every N seconds (resilience to crashes)
- Validate each step before allowing forward (don't let users get to step 4 then fail)
- Final review step before submit shows all entered data for confirmation

## Optimistic vs pessimistic submit

**Pessimistic** (default): wait for server response, then show success.
- Use for: payments, deletes, anything irreversible

**Optimistic**: update UI immediately, rollback on failure.
- Use for: likes, comments, low-stakes mutations
- Show subtle "saving..." indicator
- On failure: rollback + clear error toast

## Accessibility

- Every input has a visible `<label>` (NOT just placeholder)
- Required fields marked with `aria-required="true"` AND visual indicator
  (asterisk + "Required" text on hover)
- Errors announced to screen readers via `role="alert"` or `aria-live="polite"`
- Tab order matches visual order
- Submit reachable via keyboard (Enter in any field submits)
- Color contrast for error states meets WCAG AA (red text needs sufficient contrast)

## Saving / draft state

For long forms, save draft automatically:
- Debounced save to server (every 5s of inactivity, or on field blur)
- Show "Saved" / "Saving..." / "Unsaved changes" indicator
- On navigation away with unsaved changes, prompt with `beforeunload`

## DO NOT
- ❌ Validate only on the client — security hole
- ❌ Use placeholder as the only label — disappears on focus, fails a11y
- ❌ Disable submit button based on form validity — users get stuck
- ❌ Show all errors in a toast that disappears — lose context
- ❌ Reset the form on validation error — users lose their work
- ❌ Use `type="number"` for things like phone numbers, OTP codes, ZIP codes
- ❌ Restrict password characters (allow all printable Unicode)
- ❌ Force "must contain symbol/digit" — incentivizes worse passwords
- ❌ Send raw user HTML to other users (XSS) — sanitize SERVER-side
- ❌ Trust client-side file MIME type — verify with magic bytes server-side
- ❌ Submit form on Enter when there are textareas (Enter should newline in textarea)
- ❌ Auto-format aggressively while typing (e.g. cursor jumping in card number) —
  format on blur or use libraries that handle cursor position correctly
