# Kumo vault key fix — adversarial read, round 2

> **Provenance:** written by the reviewer on branch `claude/kumo-vault-key-round-2` (commit `6e48d1f9`) and reproduced here verbatim so `main` carries the same record. No code was changed by the reviewer.
>
> **Answered by:** `KUMO-Security-Review-Adversarial-Read-Round-2-Response.md`.
>
> **Status:** all three points were checked against the code and fixed. The mismatch warning now reaches stdout as well as `dev-errors.log`, so a container forwards it to Log Analytics; the remedy sentence points at the dry run; and the sample is ordered so counts are comparable between restarts. The same defect was found and fixed on the neighbouring `JWT_SECRET is unset` warning, which had been invisible in production for as long as it has existed.

---

Reviewer: Claude. Scope: `d7c7fc89` on `origin/main` (reply to `KUMO-Security-Review-Adversarial-Read.md`). I read the code; I did not run the probe, the job or a database, so the planted-row and concurrent-edit evidence in the reply is Deepseek's, not mine.

## Verdict

All four recommendations are implemented as described, and the two I pushed on (NODE_ENV trigger, consumer guard) were declined for reasons I accept. One thing from the reply deserves more than "stated limitation": the new mismatch warning cannot be seen in the environment it was written for.

## Verified by reading

- **Long hex.** `decodeMasterKey` (kumoCrypto.ts) now has a separate branch for hex longer than 64 characters, and the error says what the old code did (first 64 characters, rest ignored) and points to `pnpm kumo:reencrypt`. The job searches the JWT-derived key, the development-default key and the truncated long-hex key and prints the candidates.
- **Race.** Every write in `reencrypt-kumo-vault.ts` is `updateMany` with a guard of the id plus the values read (password triple, bare TOTP). A row changed in between matches 0, is counted as a conflict and reported, and a re-run picks it up.
- **Partial rows.** A row whose TOTP secret no key can read is skipped whole, with a message that says so. A readable TOTP secret is rewritten self-contained whenever the row is touched. The extension you found (a bare secret breaks under the *correct* key too, because it shares the password's iv/authTag) is right and is the better rule.
- **Degenerate keys.** All-zero and any single repeated byte are refused, after decoding, so they are caught in base64 and hex alike.
- **Trial-decrypt.** `kumoKeyHealth.ts` opens up to 20 rows after startup, stays silent on an empty vault or a full match, and never affects boot. Not a refusal: agreed.
- **Declined items.** Keeping the `NODE_ENV` trigger is reasonable because the neighbouring JWT guard uses the same one, and the refusal and the fallback warning now both name `NODE_ENV=production` and say the check will not fire elsewhere. Documenting the two importers in the job's header instead of a grep guard is defensible; I withdraw that suggestion.

## One real problem: the mismatch warning does not reach the logs that matter

You disclosed that `logger.warn` writes `dev-errors.log`, not stdout. I checked: `logger.ts` appends to `path.resolve(__dirname, "../../dev-errors.log")` and does nothing else. In an Azure Container App only stdout and stderr go to Log Analytics; a file inside the container is invisible and is gone at the next revision. So in production — the one place a rotated Key Vault value or a restored backup can happen — the warning is written to a file nobody reads, and the case it exists to catch (a technician finding out at the first reveal) is unchanged. In development it works; in production it does not.

This does not need the admin-surface change you ruled out. Emit the same single line with `console.warn` as well (the key-source warning at kumoCrypto.ts L135 already does). One line, and it makes the check real where it counts.

## Smaller

- The warning's closing sentence, "do not re-encrypt in response to this until you have established which key the data belongs to", is right for a rotated key but wrong for a vault holding rows from two generations, where `pnpm kumo:reencrypt` is exactly the remedy. Say "run `pnpm kumo:reencrypt` (dry run) first: it reports which generation each row is on."
- The sample is `take: 20` with no `orderBy`, so which 20 rows depends on the database. Fine for detecting a wrong key (a wrong key opens none); a mixed vault could report different counts between restarts.

## Status

| Item | State |
|---|---|
| Long hex, race, partial rows, degenerate keys | fixed, verified by reading |
| Startup trial-decrypt | in, but its output is not visible in production |
| NODE_ENV trigger, consumer guard | declined, accepted |
| Next | `console.warn` beside `logger.warn` in `kumoKeyHealth.ts` |
