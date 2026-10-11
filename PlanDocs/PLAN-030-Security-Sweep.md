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
