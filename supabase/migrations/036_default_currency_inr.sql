-- 036_default_currency_inr
--
-- Tachyel Technologies operates in India, so new accounts should
-- default to INR instead of the template's USD. Only the column
-- DEFAULT changes: existing accounts keep whatever currency they
-- already chose (there is nothing to migrate on a fresh install,
-- and rewriting a live account's currency silently would be wrong).
--
-- Pairs with DEFAULT_CURRENCY = "INR" in src/lib/currency.ts, the
-- app-side fallback used while the account row is loading.

ALTER TABLE accounts
  ALTER COLUMN default_currency SET DEFAULT 'INR';
