# Kumo vault key fix — response to the adversarial read, round 2

**Answers:** `KUMO-Security-Review-Adversarial-Read-Round-2.md` (reviewer's, branch `claude/kumo-vault-key-round-2`, commit `6e48d1f9`).
**Checked against:** `main` at `d7c7fc89`.
**Status:** all three points fixed and verified by running them.

---

## Verdict

The central finding was right, and it was right about the part I had already noticed and then under-described. I had
disclosed that `logger.warn` writes `dev-errors.log` and called it a limitation of the existing logging channel.
That framing was wrong: the file channel is not "the app's warning channel", it is *no* channel in a container,
and I should have said so rather than filing it as a caveat.

## The one real problem

**Confirmed at the source.** `writeLine` in `services/logger.ts` is `fs.appendFileSync(LOG_FILE, line + "\n")` and
nothing else; the only `console` calls in that file are the banner and the two `[FATAL]` handlers. So `logger.warn`
and `logger.info` are invisible to anything that is not reading that file, and Azure Container Apps forwards only
stdout and stderr to Log Analytics. The check worked in development and did nothing where it was written to work.

**Fixed with `console.warn` beside `logger.warn`.** Verified rather than assumed: with a well-formed but wrong key
the line now appears on the process's console output —

```
[KumoCrypto] the vault key from KUMO_MASTER_KEY (fingerprint 08e6911ab101) opened 0 of 5 stored passwords. …
```

— and the same holds for the key-source warning at `kumoCrypto.ts`, which already used `console.warn`.

**One step further, and it should be said plainly because it is outside what was reviewed.** The same defect was
sitting two lines above mine: `JWT_SECRET is unset — using the development secret` went through `logger.info`, so it
has been invisible in production for as long as it has existed. It is a security warning about the secret that also
derives the vault key, in the same assertion block this work already modified. I fixed it rather than leave the
block half-correct, and it is flagged here as an adjacent change beyond the review's scope.

**The pattern, since it is a third instance.** A security warning written to a channel nobody reads is not a
weaker control, it is no control — that is exactly the shape of the original defect, where the startup line
reported success while the master key was ignored. Worth a rule: anything in the assertion block at startup goes
to the console.

## The smaller two

**The remedy sentence is reworded.** It now says to run `pnpm kumo:reencrypt` — a dry run, which writes nothing —
to see which generation each row is on before changing anything, and not to pass `--apply` until those counts make
sense. That is right for a rotated key and for a mixed vault, and the mixed vault is the case where the sentence
mattered.

**The sample is ordered and its frame is stated.** `orderBy: { id: "asc" }` fixes the sample, so the same rows are
read on every restart and two log lines are comparable; a mixed vault is precisely when the count is worth
watching. The count also now reads `opened 0 of 20 of 2387 stored passwords` when the sample is partial and
`opened 0 of 5` when it is not, so the reader knows whether they are looking at the whole vault or a sample.
Verified: two runs against the same wrong key both reported `0 of 5`.

## An incident worth recording, because it is a property of the codebase

While verifying the console output I wrote a scratch script that imported the health check. That module reaches
Prisma through `await import("../index")` — the cycle-avoidance pattern `services/mfaPolicy.ts` established — so
importing it **starts the whole API**. The scratch process bound port 4000; the dev server's next hot-restart then
failed with `EADDRINUSE`, its crash guard exited the child, and the watcher was left alive with nothing listening.
I found it because the next health check failed, cleared the orphan and restarted the server.

None of that is a defect in this change, and it is worth writing down for a different reason: **any script or test
that touches `kumoKeyHealth` or `mfaPolicy` will try to start a server.** That is a real property of the
dynamic-import-of-`index` convention and it will mislead the next person to write a probe against either. The
console-output verification above is done with a self-terminating process as a result, and a probe against
`kumoKeyHealth` should be treated as starting the application, not as a unit test.

## Evidence

| Check | Result |
|---|---|
| `writeLine` reads only the log file | confirmed — `fs.appendFileSync` is its only write, and `logger.ts` has four `console` calls, all banners or `[FATAL]` |
| Mismatch warning on the console | confirmed — the line appears in the process output under a well-formed wrong key |
| Warning content | `opened 0 of 5 stored passwords`, with the fingerprint, and the dry run named as the next step |
| Count stability | two runs, same wrong key, both `0 of 5` |
| Adjacent `JWT_SECRET` warning | now also on the console |
| `pnpm probe:kumo-key` | 14 cases, 14 passed / 0 failed |
| `tsc --noEmit` | clean |
| API after restart | 200, and 5/5 passwords reveal under the master key |