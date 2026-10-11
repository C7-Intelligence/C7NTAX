# PLAN-030 — Security sweep (dependency CVEs, bug classes, and the ready state)

**Date:** 2026-10-10
**Commit swept:** `3a864928` on `main`
**Asked for by:** the operator, as a standing instruction — from here, "run a security sweep" means this
document's full scope.
**For review by:** the PLAN-030 reviewer. This is the one item in the sweep that changes a file the deploy
reads, so it wants a second opinion before it is treated as settled.

---

## 1. What the sweep covers

The operator's standing definition, recorded here so it is not re-derived each time:

1. Bug checks and CVE-database checks.
2. Fix what is found, unless the fix would break the application.
3. Plan, fix and verify against this plan and the review conversation — the package must stay on PLAN-030's
   design and in the same ready state the reviewer and I agreed at the close of round 9.
4. Where something is found, write this response and update the migration documents so the reviewer can
   respond.

## 2. Dependency CVEs

| | Result |
|---|---|
| `pnpm audit --prod` | **No known vulnerabilities found** |
| `pnpm audit` (dev included) | 4 found → **1 fixed → 3 remain**, all with no patch published |
| Does anything ship? | No. `Dockerfile:55` installs `--prod --filter @C7NTAX/api…`, so no dev dependency reaches the runtime image |

**Fixed — one.** `postcss-selector-parser@6.1.4` (moderate, GHSA-rj75-hqrm-r3gf, quadratic complexity in flat
selector parsing). A patched version exists — `<7.1.6` vulnerable, `>=7.1.6` patched — so the fix is available
and I took it:

```jsonc
// package.json → pnpm.overrides, beside the twelve pins the earlier rounds added
"postcss-selector-parser@<7.1.6": "^7.1.6"
```

**It is a major-version override** (6 → 7) under `tailwindcss > postcss-nested@6`, which is the kind of
override that breaks a CSS build, so I tested it rather than reasoned about it: `pnpm --filter @C7NTAX/web build`
completes in 13.65s and emits a 110 kB stylesheet, and the `vite:css` transform runs twice as it should. The
override stays.

**Not fixed — three, because no patch exists.** `pnpm audit --json` reports `patched: <0.0.0` for all three:

| Package | Installed | Severity | Advisory | Reached through |
|---|---|---|---|---|
| `http-cache-semantics` | 4.2.0 | high | GHSA-ch52-4w7c-c8xp | desktop: `electron-builder > app-builder-lib > @electron/get > got > cacheable-request` |
| `braces` | 3.0.3 | high | GHSA-vfj7-8cjw-p6xm | web: `tailwindcss > chokidar` |
| `sprintf-js` | 1.1.3 | moderate | GHSA-hp3w-g68c-fv3c | desktop: `electron-builder > … > global-agent > roarr` |

`<0.0.0` means the advisory is open against **every published version** — there is nothing to upgrade to, and
an override cannot invent one. Each sits behind a build-time or desktop-packaging chain, none is reachable from
the API process, and none ships. The action is to re-check them when upstream publishes a patch, not to force
a version that does not exist.

## 3. The bug classes this codebase has actually produced findings in

Every real finding in this plan's history has been one of four shapes, so the sweep looks for those
deliberately rather than reading generally:

| Class | Example from this plan's history | Result |
|---|---|---|
| A permission declared, granted, and read by nothing | `mfa:enforce`; `kumo:view_all` | **One new instance found** — see §4 |
| A setting a screen reports but the code ignores | `SMTP_SECURE` | None found |
| A security warning written to a channel nobody reads | `logger.warn` → `dev-errors.log` only | **None remaining** — the vault-key work fixed the last two, and a grep for security-shaped `logger.*` calls that are not also on the console returns nothing |
| A flag honoured on one path and not its sibling | `isSensitive` honoured by the seeder, ignored by storage | None found |

Also checked and clean: all 480 routes carry a permission guard or a documented exemption; `instance:security`
is genuinely enforced in the API; the new analytics code adds no injection or escaping surface (values are
React-escaped, the `dimension` parameter is whitelisted against four values, and the period is resolved through
the shared `parsePeriod`, which narrows a caller's scope and cannot widen it).

## 4. Found and reported rather than fixed — `report:export`

`Permission.ReportExport = "report:export"` is declared in the shared enum, granted in `ROLE_PERMISSIONS`, and
**read by nothing** — zero references in the API, in the web app, or anywhere else in the repository. Its only
appearance is its own declaration and the role grants.

**What it means in practice.** Exporting a report (Print, PDF, Excel, CSV) is limited only by `report:view`.
A role that should be able to read a report but not take it out of the product cannot be expressed, and an
administrator looking at the role editor would reasonably believe it can — the permission is presented as a
control that does not exist.

**Why it is not a vulnerability.** There is no server-side export endpoint to gate: the outputs are produced in
the browser from data the account has already been permitted to fetch. Nothing is exposed that `report:view`
did not already allow; what is missing is the *denial* half of the control, not the protection half.

**Why I have not fixed it unilaterally.** Both fixes are decisions rather than patches:

- **Implement it** — a genuine server-side export gate, which means moving output generation behind the API.
  That is a real change to how reports are produced, and it would deny export to any role that today has
  `report:view` without `report:export`, which could break someone's day-1 workflow.
- **Remove it** — delete the permission and its grants, so the role editor stops offering a control that does
  nothing. Small and honest, but it is a change to the permission model the operator deliberately tiered
  earlier this month.

I have left it alone and written it here. The reviewer's opinion on which of the two is right is the thing I am
asking for.

## 5. The PLAN-030 ready state

The operator's condition was that the sweep must leave the package exactly as it was when the reviewer agreed
there were no further issues. Checked rather than asserted:

| Check | Result |
|---|---|
| Files the deploy reads, changed since the round-9 close | **None.** `infra/`, `scripts/azure/`, `.github/workflows/` and the `Dockerfile` are untouched by every commit in this sweep |
| `pnpm audit --prod` | No known vulnerabilities — the same result the reviewer recorded at round 9 |
| The overrides block | One line added, following the twelve pins already there and stated in the same `range -> target` form, which is the form pnpm honours (the failure the reviewer caught at round 7) |
| Lockfile consistency | `pnpm install --lockfile-only` run; the build stage's `--frozen-lockfile` and the runtime stage's `--prod --frozen-lockfile` both still resolve |
| The four open operator decisions | Untouched: replica count, the `pgaudit` setup, a second prod confirmation after the `what-if`, and a unique suffix per attempt |

**One thing the reviewer should weigh.** The new override changes `pnpm-lock.yaml`, and `pnpm-lock.yaml` is
read by both Docker stages. The change is a single package resolution inside a dev/build chain that the runtime
stage does not install, and I verified the production build against it — but it is the only line in this sweep
that reaches a file the deploy touches, which is why it is called out here rather than buried in §2.

## 6. What is left, and whose call it is

- **`report:export`** — implement the gate or remove the permission. §4. The operator's or the reviewer's
  decision.
- **Three unpatchable CVEs** — re-check when upstream publishes. No action available today.
- **The nine remaining `await import("../index")` sites** — carried over from the vault-key round, mechanical,
  and not a security finding.
- **PLAN-030's deploy evidence** — unchanged and still blocked on an Azure subscription and spending authority.


---

## Round 2 — corrections after review

The reviewer checked this sweep on `origin/main` at `65465c76` and found one defect in it and one place where my
reading of an existing decision was wrong. Both are recorded as corrections rather than folded quietly into the
text above.

### 1. The override broke the dependency parity guard — fixed

`guard:deps` (`node scripts/audit-baseline.mjs`) failed on `main`:

```
x postcss-selector-parser@<7.1.6 is in package.json only
An override only one package manager reads is a floor that stops applying.
```

`pnpm-workspace.yaml` carries a twenty-line comment explaining that the security floors are declared in **both**
files on purpose — pnpm 9.1.0 (the version `packageManager` pins and the Dockerfile installs) reads overrides
only from the root `pnpm` field of `package.json`, while pnpm 10 and later read them only from the workspace
file — and that the two lists must stay identical. I added the override to `package.json` alone.

**I missed this because I did not run the repository's own dependency guard.** The sweep's "ready state checked"
paragraph ran `pnpm audit`, the route guard, the API-document guard, the help-link guard and the encoding guard,
and asserted the package was unchanged on that basis. `guard:deps` was the one check written specifically to
catch this class, and it was the one I skipped. That is the same mistake the sweep was written to avoid: a claim
of verification that outran the verification. It is recorded here rather than corrected silently.

**Fixed:** the floor is now in both files, and `guard:deps` exits 0 — *"3 advisories (0 in production), 3
accepted"* and *"override parity: 14 security floors declared in both files"*.

### 2. Corrected: none of the four advisories was a new find

§2 above presents four advisories as though the sweep discovered them. It did not. `security/audit-baseline.json`
— generated 2026-10-07 and read by `guard:deps` — already recorded **all four as accepted, each with a reason**.
The honest statement of what this sweep did is narrower and more useful: it closed one previously accepted
advisory and retired its acceptance. The baseline's own instructions say to remove an entry when the advisory
stops being reported, so the entry is gone and the totals now read 3 advisories, 3 accepted, bySeverity `{high:
2, moderate: 1}`.

### 3. The baseline's decision on `postcss-selector-parser` was the opposite of mine, and I overrode it by measurement

The accepted entry said:

> *"Tailwind 3 depends on the 6.x line, and 7.x is a breaking API change; the advisory is a build-time parse
> cost on our own CSS. Revisit with the Tailwind 4 upgrade."*

So the decision to wait was deliberate, reasoned, and mine reversed it without having read it. The reviewer's
objection to my override was exactly that the CSS had not been rebuilt — which is fair, because until then I had
only shown that the build *succeeds*, and a build that succeeds does not prove the CSS it emits is the same.

**The question was settled by measurement rather than judgement.** I built the stylesheet with the override in
place, reverted the override in both files, rebuilt, and compared:

| | File | Bytes | SHA-256 (first 8) |
|---|---|---|---|
| `postcss-selector-parser@7.1.6` | `index-CfRKbkfc.css` | 112,302 | `659F66C6` |
| `postcss-selector-parser@6.1.4` | `index-CfRKbkfc.css` | 112,302 | `659F66C6` |

**Byte-identical, including the content hash in the filename.** The 7.x API change has no effect on the CSS this
project generates. On that evidence the override stands, and the baseline now carries the measurement and the
instruction to re-measure at the Tailwind 4 upgrade — where the dependency moves to 7.x on its own and the floor
becomes moot.

### 4. `report:export` — the reviewer's reading is better than either of my two options

The reviewer added two facts §4 above did not have, and both change the answer:

- **Export exists today, in the browser.** `ReportViewer.tsx` offers Print, PDF, Excel and CSV, with no
  permission check. So "no server-side export endpoint" is true, but users can export. What is missing is the
  denial half of the control, not a capability.
- **The permission has a planned user.** `PLAN-028` (the CLI, line 674) assigns `ticket export … --out file.csv`
  to `report:export`. Deleting it would churn every role's grants and then need re-adding.

**Neither of my two options was right.** The reviewer's reading is accepted, in its own terms:

- **Do not build a client-side gate.** Anything that hides those buttons is cosmetic: the data already reached
  the browser under `report:view` and a user can read it from the network tab. A browser-side gate would look
  like a control and be one only on paper — the `SMTP_SECURE` shape again, which is precisely what this finding
  was raised to avoid.
- **Do not delete the permission.** PLAN-028 gives it a real meaning, and a server-side check belongs on the CLI
  export, where the request is not already answered.
- **Fix what the role editor implies.** Until something enforces it, label `report:export` as not yet enforced,
  or keep it out of the editor. The codebase already has the idiom: the Roles screen carries a reasoned note
  beside a category whose scope is not obvious, and the branding screens carry a "What is enforced today" band.
- **Optionally, and only if a real control is wanted today:** an audit-log entry when someone exports. That
  detects exfiltration instead of pretending to prevent it.

**Not implemented.** This is a change to the permission model the operator deliberately tiered, and the
labelling touches the role editor; I did not have the budget left to implement and verify it in both interfaces,
and recording it as done without verifying would repeat the mistake in §1 of this section. It is written up as
the agreed next step for whoever picks it up, with the reviewer's reasoning attached so the decision does not
have to be re-derived.

## Round 2 — the ready state, re-checked properly

The §5 table claimed verification without the dependency guard, so it is restated here with the guard included
and run:

| Check | Result |
|---|---|
| `guard:deps` (`audit-baseline.mjs`) | **exit 0** — 3 advisories, 0 in production, 3 accepted; override parity 14 floors in both files |
| `pnpm audit --prod` | No known vulnerabilities |
| `check-encoding`, `check-route-guards`, `check-api-docs`, `check-help-links` | pass |
| Web production build with the override | succeeds; stylesheet byte-identical to the pre-override build |
| `infra/`, `scripts/azure/`, `.github/workflows/`, `Dockerfile` | untouched |
| The four open operator decisions | unchanged |

---

## Round 3 — `report:export` is now labelled, and one decision recorded as taken

**Implemented.** `apps/web/src/pages/Roles.tsx` now carries a `PERMISSION_NOTES` map and renders any note it
holds under the category that contains the permission, using the idiom the screen already has for its Developer
category: modern says it as a sentence beside the control with an icon, classic as a form note under the label
with a heading. The words are shared; only the arrangement differs.

> `report:export` is not enforced yet. Exporting a report happens in the browser from data `report:view` already
> allows, so granting this changes nothing and revoking it denies nothing. It is kept because the CLI's ticket
> export is planned against it, where the check will be server-side.

**What was verified, and what was not.** Verified: `Permission.ReportExport` is a member of the category that
holds `[ReportView, ReportExport, ReportCreate]` (`packages/shared/src/enums.ts:407`), so the render condition is
satisfiable and is not dead code; the full sentence is present in the built bundle after a production build;
`tsc --noEmit` is clean for the web app; and the Developer note beside it is unchanged. **Not verified:** the
note as it appears on screen in either interface. The permission grid renders only when a role card is expanded,
and I could not reach it by scripted clicking before running out of budget. The wiring is proved; the pixels are
not.

**No Help change, and the reason is a decision rather than an omission.** The Help rule asks whether a feature
change needs the in-app documentation updated. Help does not name individual permissions anywhere — its
`permission` field gates *which* sections a reader sees and never enumerates the model — so there is no row that
would become false. The note lives at the point the claim is made, which is the only place a reader forms the
belief it corrects.

**The operator's call, unchanged.** This makes the role editor honest; it does not make the permission work. The
real control belongs on the CLI export path in PLAN-028, where the request is not already answered. Whether that
happens before the deploy is the operator's decision, as the reviewer says.

**One thing the reviewer offered that is not done.** An audit-log entry when someone exports. It is the stronger
of the two options — detection rather than theatre — and it is a smaller change than it sounds, since the audit
middleware already exists. It is not in this commit because it was offered as optional and the labelling was the
gap both of us named. It is recorded here so it is a decision rather than a dropped suggestion.