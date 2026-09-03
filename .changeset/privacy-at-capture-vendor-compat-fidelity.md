---
"rrweb-snapshot": minor
"rrweb": minor
"@rrweb/types": minor
---

`vendorCompat` fidelity pass: entries now match the vendors' verified implementations, and gain an events-only ignore slot.

- Vendor registry entries gain an `ignoreEvents` slot compiled into the new
  `ignoreEventsSelector`: input events from a matching element are suppressed
  and nothing else changes — no masking implied, unlike `data-privacy="ignore"`.
- Sentry (`.sentry-ignore`, `[data-sentry-ignore]`), PostHog
  (`.ph-ignore-input`), New Relic (`.nr-ignore`), and Highlight
  (`.highlight-ignore`) ignore tokens are now honored, each verified from the
  vendor's source.
- The mapping doctrine is now pinned in code and tests: each vendor token maps
  to the closest treatment our verbs express, never a less protective one, and
  no entry may carry an allow/unmask-like selector in any slot.
- Datadog `mask-user-input` stays mapped to text mask: form values are already
  masked globally wherever compat applies, and dropping the token would record
  the form-element text (e.g. `<option>` labels) it protects there.
