# Accessibility (a11y)

**TL;DR:** Build accessible by default — it's cheaper, legally safer, and
benefits all users (keyboard power-users, mobile, low-vision, temporary
disability). Use semantic HTML (`<button>`, `<nav>`, `<main>`), provide text
alternatives for images, ensure color contrast meets WCAG AA, make everything
keyboard-reachable, label every form control, announce dynamic changes to
screen readers, never trap focus. Test with keyboard-only and at least one
screen reader (VoiceOver, NVDA). Aim for WCAG 2.1 AA compliance as the baseline;
AAA where reasonable.

## Why it matters

- **15-20% of users** have a disability (vision, motor, cognitive, hearing)
- **Legal**: ADA (US), EAA (EU 2025), Section 508 — lawsuits and fines for
  inaccessible products
- **Quality**: a11y discipline yields better UX for everyone (clearer labels,
  better keyboard support, less reliance on color)
- **SEO**: semantic markup helps crawlers
- **Cost**: fixing a11y after the fact is 10x more expensive than building it in

## Standards

- **WCAG 2.1** — Web Content Accessibility Guidelines (current production target)
- **WCAG 2.2** — adds 9 new criteria, 2023; adopt incrementally
- Levels: **A** (basic) / **AA** (target) / **AAA** (high bar, contextual)
- **WAI-ARIA** — roles/states/properties for custom widgets when HTML semantics insufficient

## Semantic HTML — start here

```html
<!-- ❌ Div soup -->
<div class="button" onclick="submit()">Submit</div>

<!-- ✅ Real button -->
<button type="submit">Submit</button>
```

Real elements bring keyboard, focus, screen reader semantics for free:
- `<button>` — clickable, focusable, fires on Enter/Space
- `<a href>` — navigable, focusable, opens in new tab semantics
- `<input>`, `<select>`, `<textarea>` — labeled, validated, accessible by default
- `<nav>`, `<main>`, `<header>`, `<footer>`, `<aside>`, `<section>`, `<article>` — landmarks
- `<h1>` through `<h6>` — heading structure (one `h1` per page; don't skip levels)
- `<ul>`, `<ol>`, `<li>` — lists announced as such
- `<table>`, `<th>`, `<caption>` — tabular data with proper structure

Custom widgets (modals, dropdowns, tabs) require ARIA. Prefer libraries that
handle a11y (Radix UI, React Aria, Headless UI, Aria-Kit) over rolling your own.

## Keyboard

EVERY interactive element must be reachable and operable by keyboard:
- **Tab** moves focus forward; **Shift+Tab** backward
- **Enter** activates buttons and links
- **Space** activates buttons (and toggles checkboxes)
- **Arrow keys** within composite widgets (radio groups, tabs, menus, sliders)
- **Esc** closes modals, menus, popovers

Visible focus indicator on every focusable element:
```css
/* ❌ Never do this without replacement */
*:focus { outline: none; }

/* ✅ Visible focus, customizable */
:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
```

`:focus-visible` (vs `:focus`) shows ring on keyboard focus only, hides on
mouse click — the best of both worlds.

Tab order should match visual order. If you must override, use `tabindex`:
- `tabindex="0"` — included in tab order at natural position (use for custom widgets)
- `tabindex="-1"` — focusable programmatically but skipped by Tab (for modal containers, error summary)
- `tabindex="1+"` — DO NOT USE; breaks expected order

## Focus management

When opening a modal:
1. Move focus into the modal (usually first focusable element or close button)
2. Trap Tab/Shift+Tab within the modal
3. On close, return focus to the element that opened it

When deleting an item from a list:
- Move focus to the next item, or to the list container, never let it disappear

After route navigation in SPAs:
- Focus the new page's `<h1>` or main landmark — screen reader users otherwise
  don't realize the page changed

## Forms

Every form control needs a label:
```html
<!-- ✅ Explicit label -->
<label for="email">Email</label>
<input id="email" type="email" required />

<!-- ✅ Wrapped label -->
<label>
  Email
  <input type="email" required />
</label>
```

Required fields:
- `required` attribute (browsers convey to assistive tech)
- Visual indicator: asterisk + "Required" text, NOT color alone
- Don't disable submit on validation state

Errors:
- Associate via `aria-describedby`:
  ```html
  <input
    id="email"
    aria-invalid="true"
    aria-describedby="email-error"
  />
  <p id="email-error" role="alert">Please enter a valid email</p>
  ```
- `role="alert"` announces the error to screen readers immediately
- Error text near the field, not only at the top of the form

See `forms-validation.md` for full details.

## Images and media

Every meaningful image needs alt text:
```html
<img src="chart.png" alt="Sales by quarter: Q1 100, Q2 150, Q3 200, Q4 250" />
```

Decorative images use empty alt:
```html
<img src="ornament.svg" alt="" role="presentation" />
```

Icons used as buttons need accessible names:
```html
<button aria-label="Close dialog">
  <svg aria-hidden="true">...</svg>
</button>
```

Videos:
- Captions for spoken content
- Audio descriptions for visual-only content
- Transcript available

## Color and contrast

WCAG AA contrast ratios:
- **4.5:1** for normal text
- **3:1** for large text (18pt regular or 14pt bold) and UI components

Tools: Chrome DevTools color picker shows ratio; `axe-core`, `Lighthouse`,
WebAIM Contrast Checker.

Never rely on color alone:
- Form errors: red border + error text + icon
- Charts: shapes, patterns, labels, not just color
- Status: text label ("Active") plus the green dot

## Motion and animation

- Respect `prefers-reduced-motion`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```
- Avoid auto-playing video with sound
- Avoid blinking/flashing > 3 times per second (seizure risk)
- Carousels: provide pause control; don't auto-advance under 5s

## Live regions (dynamic content)

When content updates without page navigation, screen readers don't notice
unless told:
```html
<!-- For non-critical updates (cart count, save indicator) -->
<div aria-live="polite">Cart: 3 items</div>

<!-- For critical alerts (errors, important confirmations) -->
<div role="alert">Your session will expire in 1 minute</div>

<!-- For ongoing status (loading, progress) -->
<div role="status">Saving…</div>
```

Use sparingly — too many live regions become noise.

## Page structure

- One `<h1>` per page (the page title)
- Heading levels nest properly: `h1` → `h2` → `h3` (don't skip)
- Landmark roles via semantic elements: `<header>`, `<nav>`, `<main>`, `<footer>`
- Skip-to-main-content link as the first focusable element:
  ```html
  <a href="#main-content" class="skip-link">Skip to main content</a>
  ```
- `lang` attribute on `<html>`: `<html lang="en">`

## ARIA — only when necessary

Rule: prefer real HTML over ARIA. ARIA is a fallback for when HTML doesn't
have a fitting element.

Common ARIA patterns:
- `aria-label="Close"` on icon-only buttons
- `aria-labelledby="dialog-title"` to associate widget with label element
- `aria-describedby="email-help"` for helper/error text
- `aria-expanded="true|false"` for collapsible sections
- `aria-current="page"` on current nav link
- `aria-hidden="true"` on decorative icons (and `<svg>` inside labeled buttons)
- `role="dialog"` for modals (with `aria-modal="true"`)
- `role="alert"` for important messages

Anti-patterns:
- `role="button"` on a `<div>` — use `<button>`
- `role="link"` on a `<span>` — use `<a href>`
- ARIA without keyboard support — ARIA describes; you still need actual interactivity

## Touch targets

Minimum **44x44 CSS pixels** for tappable elements (WCAG 2.5.5 Level AAA, but
target it anyway). Spacing between targets prevents mis-taps.

## Mobile and zoom

- Don't disable user zoom: avoid `<meta name="viewport" content="user-scalable=no">`
- Layouts must work at 200% zoom and 320px wide
- Touch and keyboard both supported (iPad with keyboard exists; many users connect external keyboards)

## Testing

### Automated (catches ~30% of issues)
- **axe-core** in CI: `@axe-core/playwright`, `jest-axe`
- **Lighthouse** in CI: a11y score budget
- **eslint-plugin-jsx-a11y** for React (catches missing alt, label issues)

Don't trust automated scores alone — they miss interaction issues, screen
reader experience, cognitive load.

### Manual (essential)
- **Keyboard only**: unplug mouse, navigate the entire app — every interaction
  must work
- **Screen reader**:
  - macOS / iOS: VoiceOver (built-in, Cmd+F5)
  - Windows: NVDA (free) or JAWS
  - Android: TalkBack
- **Zoom**: 200% in browser, 400% in OS
- **Color**: use a color blindness simulator (Sim Daltonism, Color Oracle)

### User testing
Real users with disabilities catch issues that automation never will. Engage
panels (Fable, AccessWorks, local advocacy groups).

## Common mistakes

- ❌ Click handlers on `<div>` — not keyboard accessible
- ❌ `placeholder` as the only label — disappears on focus
- ❌ Icon buttons without `aria-label` — screen readers say "button" only
- ❌ Modal that doesn't trap focus — Tab escapes into background page
- ❌ `outline: none` without `:focus-visible` replacement — keyboard users lost
- ❌ Color-only error indication — invisible to color-blind users
- ❌ Auto-playing video with sound — disorienting, breaks screen readers
- ❌ Carousel that auto-advances under 5s — unreadable
- ❌ Tab order out of visual order due to absolute positioning
- ❌ Headings used for styling (`h1` for big text on a paragraph) — breaks structure
- ❌ Tooltips that only show on mouse hover — invisible to keyboard
- ❌ Link text "click here" — meaningless out of context for screen readers

## Pre-launch a11y checklist

- [ ] All images have alt text (or `alt=""` for decorative)
- [ ] All form fields have visible labels
- [ ] All interactive elements reachable by Tab
- [ ] Visible focus indicator on every focusable element
- [ ] Color contrast meets 4.5:1 (text) / 3:1 (UI)
- [ ] No information conveyed by color alone
- [ ] Headings nest properly, one H1 per page
- [ ] Landmarks present (header, nav, main, footer)
- [ ] `lang` attribute on `<html>`
- [ ] `prefers-reduced-motion` respected
- [ ] Modals trap focus and restore on close
- [ ] Errors announced via `role="alert"` or `aria-live`
- [ ] Tested with keyboard only
- [ ] Tested with at least one screen reader
- [ ] Lighthouse a11y score ≥ 95
- [ ] axe-core finds no violations in CI

## DO NOT
- ❌ Use `<div onclick>` instead of `<button>` — always use the right element
- ❌ Disable browser focus rings without a replacement
- ❌ Hide content with `display: none` and expect it to be readable by SR (it isn't)
- ❌ Use `aria-hidden="true"` on focusable elements (creates phantom focus)
- ❌ Set `tabindex` greater than 0 (breaks expected order)
- ❌ Trap focus permanently (every focus trap must have an Escape route)
- ❌ Communicate state only via color or icon
- ❌ Auto-advance carousels faster than user can read
- ❌ Use placeholder text as a label
- ❌ Skip heading levels (H2 → H4)
- ❌ Use only `:hover` for revealing content (excludes touch and keyboard)
- ❌ Roll your own modal/dropdown/combobox — use accessible primitives
