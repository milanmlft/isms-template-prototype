# ISMS template workshop

Audience: ISMS policy authors. Non-technical, basic git. Tooling: VS Code + Quarto extension, each
participant working in their own institution repo.

Everything below was verified against a clean-room `quarto use template` install on Quarto 1.8.25,
not read off the README. The findings that change the teaching are in
[Before the day](#before-the-day).

---

## Before the day

- [x] Set up workshop repo: https://github.com/UCL-ARC/2026-09-17-isms-workshop

Pre-create one repo per participant, already scaffolded, with the `.gitignore` and CI workflow in
place, and have them clone.

---

## The spine of the day

The actual intellectual content, and the thing most likely to be got wrong in practice, is the
escalation ladder. State it in Module 0, reinforce it at every checkpoint, assess it at the end:

> **variable → front-matter override → block override → un-adopt → request a baseline change**

Use the weakest tool that works. The two failure modes worth designing the whole day to prevent are
overriding something that should have been a variable, and un-adopting a document that needed one
paragraph changed.

---

## Outline

### Why this exists

Presentation.

- The problem: many institutions, one standard, copy-paste drift and no way to see who changed what.
- The two layers — baseline vs. institution. What you own, what you inherit, what is regenerated.
- The escalation ladder (above).
- **Prototype framing, explicitly, at minute two.** The policy text is placeholder; the machinery is
  real. The shipped `_overrides/ISMS03.qmd` contains `EXAMPLE OVERRIDE TEXT, REPLACE ME` callouts
  that will appear in their site _and_ in their deviations register. Say so now or lose people to
  confusion about whether they are reading real policy.

### Set up your ISMS

Hands-on.

- Clone your pre-made repo. Open in VS Code.
- Guided tour of the four things that matter:
  - `_variables.yml` — your institution's names
  - `_overrides/` — your policy changes
  - `_isms.yml` — what you publish
  - `_extensions/milanmlft/isms/` — the baseline, **read-only**
  - `docs/` + `deviations.qmd` — **generated, never edit**
- `quarto preview`. See your site.

**Checkpoint:** every screen shows a rendered ISMS site.

### Variables, the first line of defence

Hands-on.

- Edit `_variables.yml`: organisation, environment, role titles.
- Watch the site update live.
- Exercise: make the entire site speak in your institution's names and role titles.
- Teaching point: if the change is only a name, it is a variable. Never an override.

### Overrides

Hands-on. The core of the day; budget the most slack here.

- **Find your block IDs:** `_extensions/milanmlft/isms/manifest.yml`. The `blocks:` list is the
  published surface — those IDs, and only those, can be targeted.
- Anatomy of `_overrides/ISMS03.qmd`: front matter, `isms:override`, `isms:end`.
- **The render loop, taught up front:** saving an override does _not_ update the preview. Save, then
  **Quarto: Render Project**, then refresh.
- The four modes and when each is right: `replace`, `before`, `after`, `delete`.
- **Exercise A — front matter.** Replace the placeholder `document-author` and `approver` with real
  names. Teaching point: this is _not_ a deviation and gets no register row — replacing a
  placeholder is adopting the baseline, not departing from it.
- **Exercise B — `mode=after`.** Add a local paragraph to `scope`.
- **Exercise C — `mode=replace`.** Change the approval chain in `user-access.approval-chain`.
- **Error drill (do this deliberately).** Typo a block ID in both the `override` and the `end`
  marker. The render stops with `file:line` and lists every valid block ID for that document. This
  is the single most useful thing they can learn to read — most real mistakes land here.
  - Worth knowing as facilitator: if they typo _only_ the `override` id and not the matching `end`,
    the error is the less helpful "must be closed by …" instead. Expect it and explain it.
- Open `deviations.qmd`. Everything they just did, with reasons and approvers, deep-linked into the
  documents.
- Teaching point: `reason` is **published prose**. It renders on the register and is indexed by the
  site search. Write it for an auditor.

**Checkpoint:** every participant has at least one override and can point to its register row.

### Declining a whole document

Hands-on.

- `_isms.yml`: a denylist. Absence means adopted, so a document added by a future baseline arrives
  adopted rather than silently missing.
- Exercise: un-adopt ISMS08 with a real reason and approver.
- **Error drills:** omit `reason` → hard error (an un-adopted document leaves no trace anywhere, so
  the register entry is the entire audit record). Write `adopted: no` → hard error, because YAML
  reads it as the string `"no"`.
- Show the register: the Coverage table still lists ISMS08, marked not adopted, with the reason. The
  un-adoption is _published_, not hidden — absence is not evidence.
- Teaching point: this is the biggest hammer available. Prefer an override.

### Review and approval

Hands-on, in pairs. Requires the CI workflow from the pre-work.

- Branch → edit → commit → push → PR, all in VS Code.
- **What a reviewer actually reads:** the override file and the diff of `deviations.qmd`. Never
  `docs/`.
- The CI check: a PR that breaks composition fails, with the same `file:line` message.
- Paired exercise: review your partner's PR, ask for one change, approve, merge.
- Discussion: who signs off, and what `approved-by` / `approved-date` mean in your governance.

### Living with a new baseline, and what's missing

Demo, not hands-on.

- Demo `quarto update`: `_variables.yml`, `_overrides/` and `_isms.yml` survive untouched. Verified.
- What a new baseline version can do to you: new documents arrive **adopted**; a renamed or removed
  block ID breaks your override, which is why that is a MAJOR release.
- How to request a baseline change, and who maintains it.
- **Known limitations**:
  - You cannot yet append institution-only sections outside the baseline blocks.
  - The register is a snapshot of the present, not a history — deleting an override removes its row
    with no trace. History lives in git.
- Where to get help.
