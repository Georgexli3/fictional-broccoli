# Buoyant Proposal Editor — Founding Engineer Take-Home

A fidelity-first AI editor for civil-engineering proposals. Upload a proposal PDF, click any block, and ask AI to tighten it, match firm voice, fix names, or reference past work — every change shown as a track-changes diff before you accept it.

**Live demo:** _to be added at deploy time_

> **Build status:** the full implementation plan and locked decisions live at [`docs/PLAN.md`](./docs/PLAN.md) (mirrored from `~/.claude/plans/this-repository-will-jaunty-swan.md`). All milestones M1–M10 are structurally complete; some features (parse/edit Anthropic calls, full annotated-export bbox accuracy) require deployment with real environment variables to verify end-to-end.

---

## 1. Setup & run

```bash
pnpm install
cp .env.example .env.local      # then fill in ANTHROPIC_API_KEY (from Eric)
pnpm dev
```

The app boots at <http://localhost:3000>. `/api/health` returns the status of every dependency:

```bash
curl http://localhost:3000/api/health | jq
```

For full functionality (PDF upload + AI parse/edit), the environment also needs Vercel Blob and Vercel KV:

```bash
vercel link              # link to a Vercel project
vercel env pull          # pulls BLOB_READ_WRITE_TOKEN, KV_REST_API_*
```

Or deploy to Vercel — the storage env vars auto-inject. The KB build (`pnpm build:kb`) runs once with the Anthropic token and produces committed artifacts in `kb/` (~$1 in proxy credit).

### Required environment

| Variable | Purpose | Source |
|---|---|---|
| `ANTHROPIC_API_KEY` | Buoyant proxy auth token (works for both Anthropic and OpenAI endpoints) | Eric (separately) |
| `ANTHROPIC_BASE_URL` | Proxy base URL | Defaults to `https://hiring-proxy.trybuoyant.ai/anthropic` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (PDF storage) | Auto-injected on Vercel |
| `KV_REST_API_URL` | Vercel KV (parse cache) | Auto-injected on Vercel |
| `KV_REST_API_TOKEN` | Vercel KV (parse cache) | Auto-injected on Vercel |

### Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript strict |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit + integration |
| `pnpm test:e2e` | Playwright E2E (local only; not in CI) |
| `pnpm build:kb` | Pre-parse + distill the MECO past-proposal KB (idempotent; ~$1) |
| `pnpm verify:deploy <url>` | Health-check a deployed URL |

### Note on fixtures

The brief lists fixtures `proposals/easy.pdf` (clean single-column 6–8 page) and `proposals/hard.pdf` (multi-column, table, headers/footers, embedded image) — but those files were not provided to us. We substitute from the user-provided proposals:

- **De facto easy fixture:** `ExampleProposals/MECOProposals/1_Copy of City of Dixon SOQ.pdf` (smallest MECO at 13 MB / 24 pp). The end-to-end demo runs against this.
- **De facto hard fixture:** `ExampleProposals/AlphaCMProposals/Windsor ORH proposal.pdf` (24 pp, InDesign, TOC dot leaders, multi-section, appendices). Closer to the brief's hard-fixture archetype in *structural complexity* — file size is not the signal.

If Buoyant provides the intended `kb/` and `proposals/` folders before submission, we'd swap the KB source.

---

## 2. Design decisions

### Thesis: fidelity-first precision editor

The product feels like Track Changes for PDFs with an AI inside, not like ChatGPT-with-a-doc. Diffs by default, accept/reject every change, original PDF always visible. We trade away "creative chat with the doc" in favor of trust, transparency, and pixel-context fidelity — because the brief's own description of the loop (*"The user sees what changed and decides whether to apply it"*) is a trust pattern, not a creative pattern. Buoyant's customers review high-stakes proposals; trust > capability.

### Architecture: hybrid two-pane

PDF.js text-layer rendered on the left (immutable, scrollable, zoomable, native-text-selectable). Structured doc-model rendered on the right (editable, click-to-edit, diff-by-default when an edit is pending). Hovering a block on the right scrolls the PDF on the left to that page (debounced).

**Trade-off:** The two views can drift if the parser misbehaves (e.g., merges paragraphs); we ship a `Reparse` escape hatch for those cases (V1.5 — current build relies on first-pass parse).

### PDF parsing: Claude Sonnet 4.6 native PDF support

Client uploads PDFs directly to Vercel Blob (sidesteps Vercel's 4.5 MB body cap — every MECO PDF would fail through a route handler). Server passes the Blob URL to Claude Sonnet 4.6 with a Zod-validated tool-use schema (`emit_document_structure`). Result is cached server-side in Vercel KV by SHA-256.

**Trade-off vs OpenAI:** Both endpoints work through the proxy. We chose Claude because (a) native PDF input is more mature, (b) prompt caching at ~10× input price is critical for our edit volume, (c) single-provider keeps the prompt patterns and SDK consistent. A team that already uses OpenAI tooling could swap by changing `lib/anthropic.ts` and the few model-name string references — the architecture is provider-agnostic above that line.

### Edit unit: block-level data model + span-aware UI prefill

One block selectable at a time, inline composer slides in beneath it. The data model is uniform across kinds (`paragraph | heading | list_item | cover | caption`); locked kinds (`header_footer | figure`) are visibly read-only.

**Span-aware UI:** if the user drag-selects text within a block before opening the composer (e.g., highlights "Alejandra Ricci"), the textarea pre-fills with `Replace 'Alejandra Ricci' with `. This gives the *surgical-edit feel* without paying the cost of a span-level data model. The LLM still sees the whole block as context.

### Edit composer: 4 chips + free-form textarea

- **Tighten** — reduces word count by 20–35%, preserves every fact.
- **Match firm voice** — applies the synthesized voice doc; preserves content.
- **Fix names** — audits proper nouns/dates/dollar figures against the surrounding context; refuses to invent corrections.
- **Reference past work** — splices in a single sentence referencing a relevant past project from the KB, *only if* one is genuinely relevant. No-ops gracefully otherwise.
- Free-form textarea for everything else (`⌘↵` to submit).

The model is instructed to (a) make the *minimum* edit, (b) never add new factual claims, (c) preserve named entities. We compute the diff client-side via `diff-match-patch` with word-level cleanup + curly-quote/em-dash normalization (so spurious quote-style differences don't show as edits).

### Knowledge base: distilled, not raw

Per CTO clarification, the KB is past proposals. We use the 5 MECO PDFs at `ExampleProposals/MECOProposals/`: at runtime, the KB is the 4 not currently being edited (matched by SHA-256 hash exclusion).

**Distilled at build time, not raw:** raw 4-PDF inline ≈ 150–400K tokens, busts Sonnet's 200K context window. `pnpm build:kb` uses Claude to distill each into:
- ~300-token abstract (frontmatter + scope summary)
- entity table (firm names, projects, clients, dates, locations, dollar figures) — for grounded recall
- 3–5 representative paragraphs tagged by section type — for voice + reference exemplars

Plus a single `kb/voice.synthesized.md` (~600–1,500 tokens) generated from the past-proposal exemplars. Total cached payload ≈ 15–30K tokens.

**Prompt caching:** the entire KB block is wrapped with `cache_control: ephemeral`. After the first edit in a session, subsequent edits read cached input at ~10% price. Sample 20-edit session post-cache cost: ~$0.10 in compute. Dominant cost is the one-time parse (~$0.20 per new PDF, $0 on KV-cache hit).

### Export: 3 formats with quality gate

- **Annotated Original** — overlay numbered colored markers on the original PDF + append a Changes Summary page enumerating every edit with before/after text. Preserves branding 100%; never modifies content streams. Marker placement uses a PDF.js text-layer fuzzy matcher (NFKC + soft-hyphen-strip + sliding match w/ confidence). Markers only draw at confidence ≥ 0.6; lower-confidence edits appear in the summary page only.
- **Clean Rewrite PDF** — pdf-lib generates a fresh PDF from the edited doc model. Loses original branding; gains accuracy on edited text content. Useful when the user needs the *result* without the change history.
- **Markdown** — for users who'll paste into Word/Notion/etc.

**Quality gate:** Markdown is the default export until we've measured ≥80% of edit markers landing within ±20pt on the Dixon SOQ. If the bbox accuracy gate passes, Annotated is promoted to primary.

**Why no in-place text replacement (preserving branding *and* updating text):** silent-failure modes. PDF content streams are glyph-runs at positions, not characters. Replacing text requires re-encoding glyphs in the same embedded font subset (which may not contain new characters), recomputing position offsets, handling line wrap. Commercial libraries (PDFTron, Aspose) solve this at $thousands/year licensing. pdf-lib explicitly does not. The annotated-overlay approach (DocuSign/HelloSign pattern) is honest and reliable.

### State: 3-tier (Blob + KV + localStorage)

| Tier | What lives there | Why |
|---|---|---|
| Vercel Blob | The uploaded PDF binary | Stable URLs; sidesteps Vercel's 4.5 MB body cap |
| Vercel KV | Parse cache, keyed by SHA-256 | Survives serverless cold starts; saves 10–20s + ~$0.20 on re-uploads |
| localStorage | Doc model + edit history (debounced 250ms) | Survives refresh; no DB needed for V1 |

**Undo:** ⌘Z pops the last accepted edit; ⌘⇧Z redoes. The Changes sidebar lists every accepted edit with click-to-jump. Linear undo only in V1; non-linear revert is V2 (requires confirmation UX for cascading reverts on the same block).

**Resume:** on home-page boot, the resume banner reads localStorage and offers to continue. One of the brief's "UX details that matter" — a 20-edit session shouldn't vanish on a refresh.

---

## 3. What I cut and why

| Cut | Why |
|---|---|
| **Multi-paragraph chat surface** | Dilutes the trust thesis. V2 once per-block reliability is proven. |
| **DOCX export** | Buoyant's actual product is Word-integrated, so DOCX is V2-correct. But the brief's stretch goal lists *PDF*, and ~1 hr of DOCX layout API spent on a less-aligned format vs. shipping annotated-PDF properly. |
| **In-place PDF text replacement** | Silent-failure modes (font subsetting, glyph encoding, position drift) violate fidelity-first. Annotated overlay gets 95% of value with zero silent failures. |
| **Hard-fixture multi-column / tables** | A real fix is parser-level (LlamaParse / structured extraction pre-pass), not an MVP feature. Documented as known limitation in §4. |
| **Auth + multi-user / Postgres** | Single-user demo. Auth is a 1-hr scope creep that demos nothing for the brief. KV covers our needs. |
| **Vector retrieval / embeddings for KB** | At 5 KB items, similarity search is noise. Inlined + cached is correct at this scale. |
| **Component tests / visual regression / Playwright in CI** | Manual UI testing is faster for this surface; CI stays lint+typecheck+Vitest. |
| **Real analytics backend** | Event vocabulary is scaffolded (`lib/track.ts` + `/api/events`). Posthog wiring is a 30-min V1.5 task. |
| **Sentry / DDoS protection / rate limiting / custom domain / staging env** | V1.5 items; not load-bearing for the demo. |
| **Span-level data model** | Block context produces better edits; the surgical-feel comes from span-prefill UI, not a span data model. |
| **Adobe-quality re-rendering of the original** | $thousands/year commercial library territory. Out of scope. |

---

## 4. Failure modes I worried about

### Tier 1 — Hard-fail with explicit UI handling (handled in code)

| # | Failure | Detection | Handling |
|---|---|---|---|
| 1 | PDF > 32 MB | Client-side file-size check before upload | Toast: *"Files over 32 MB aren't supported yet"* |
| 2 | Encrypted/password PDF | `pdfjs.getDocument` throws `PasswordException` | Modal explaining decryption need |
| 3 | Scanned/image-only PDF | Heuristic: extracted text-layer < 100 chars across all pages | Warning banner; parse still attempted via Claude vision |
| 4 | Claude API error / rate limit / spend cap | Anthropic SDK error | Surfaces in proposed-change panel: *"Couldn't generate edit"*; no silent fail |
| 5 | localStorage quota exceeded | `try/catch` around `setItem` | Banner with one-click "Clear oldest sessions" |
| 6 | Parser returns malformed structure | Zod validation rejects | Error UI in right pane with Reparse button |
| 7 | Streaming edit drops mid-response | SSE error | Retry button preserving full request context |
| 8 | Concurrent edits on same block | UI invariant | Composer disabled during pending |

### Tier 2 — Soft-fail / graceful degradation

| # | Failure | Mitigation |
|---|---|---|
| 9 | Parser splits / merges blocks awkwardly | Reparse button (V1.5); current build tolerates and documents |
| 10 | "Reference past work" finds no relevant project | System prompt: "if no clearly relevant project, return block unchanged" |
| 11 | Bbox marker drift on annotated export | Markers only draw at confidence ≥ 0.6; lower-confidence edits go to summary page only |
| 12 | Annotation insertion would overlap layout | Markers placed in left margin, not over text |
| 13 | KB context drift (wrong client name from past proposal) | System prompt explicitly forbids carrying over named entities from past proposals |
| 14 | Curly quotes / em-dashes / non-Latin chars in export | Pre-normalized in diff layer + during pdf-lib drawing |

### Tier 3 — Acknowledged but not handled in V1

| # | Failure | Why deferred |
|---|---|---|
| 15 | Multi-column reading order | Stretch goal; documented as single-column-first |
| 16 | Tables exported as plain tab-aligned text | DOCX or HTML export is the right answer; V2 |
| 17 | Concurrent multi-user editing | Out of scope for single-user V1 |
| 18 | Browser crash loses pending (un-accepted) edit | Pending proposals only persist on Accept |
| 19 | Mobile / small screen | V1 is desktop-first; banner < 1024px would be V1.5 |
| 20 | "Reference past work" hallucination | Mitigated by KB grounding + system prompt; not eliminated. Detection requires LLM-judge offline eval (scaffolded; not run for V1) |

### What I'd check before letting a paying customer use it

Three offline evals, gating any rollout:

1. **Edit-faithfulness LLM-judge** (50 sampled edits across all 4 chips + free-form): does the edit add unsupported claims, lose information, or violate the user's intent? Threshold: <2% with new-claim hallucinations, <5% with information-loss issues.
2. **Name-fidelity synthetic test** (30 paragraphs with named entities): run "Tighten" + "Match firm voice" — every named entity must survive unchanged. Threshold: 100%.
3. **Annotated-export accuracy geometric check** (10 docs): markers must land within ±20pt of expected bbox. Threshold: ≥95%.

Plus the production observability described in §5 to watch all three in the wild.

---

## 5. How I'd evaluate this in production

**3-layer framework: in-product metrics + per-edit user signal + offline evals.**

### Layer 1 — Online metrics (the dashboard I'd watch)

| Metric | Definition | Healthy | Concerning |
|---|---|---|---|
| Edit acceptance rate | accepted / (accepted + discarded) | > 70% | < 50% |
| Retry rate per intent | regenerate-clicks / first-edits, by chip | < 15% | > 30% on any chip |
| Time-to-first-edit | upload → first accept | p50 < 2 min | p50 > 5 min |
| Parse-failure rate | Reparse clicks / total uploads | < 5% | > 15% |
| Export conversion | sessions w/ ≥1 accept and ≥1 export / sessions w/ ≥1 accept | > 60% | < 30% |

A retry spike on "Reference past work" would tell me the KB is mismatched; low export conversion would say the formats aren't useful and I need DOCX. These are *diagnoses you can act on*, not vanity metrics.

### Layer 2 — In-product user signal

A subtle 👍/👎 on each accepted edit (one click, dismissible). Hovering 👎 reveals: *"Wrong info / Wrong tone / Lost something / Other"*. Gives a labeled stream for offline eval improvement and is the only honest way to detect hallucinations the user *did* accept.

V1 ships the event vocabulary (`lib/track.ts`) and a no-op `/api/events` endpoint. Wiring to Posthog is a 30-min V1.5 task.

### Layer 3 — Offline evals (run before any prompt change ships)

Three suites, all described in §4. V1 ships the **name-fidelity** suite as the one-suite proof of pattern (`evals/name-fidelity.test.ts` — placeholder structure scaffolded).

---

## 6. What I added beyond the brief and why

| Addition | Why |
|---|---|
| **Annotated Original PDF export** preserving branding via overlay | Brief's stretch asks for "re-render to PDF"; we went deeper because the dominant customer scenario (partner's PDF, recycled past proposal) can't assume source files exist. |
| **PDF.js text-layer fuzzy matcher** for bbox resolution | Defensive use of original PDF as ground truth. LLM-emitted geometry is the wrong place to put trust. |
| **Span-aware composer prefill** | Drag-select pre-fills `Replace 'X' with…` — surgical-edit feel without paying for span-level data model. |
| **PDF ↔ right-pane hover-link** | Brief explicitly rewards "UX details that matter." Bridges the two-pane structure. |
| **Resume session banner** | Most products lose your work; this one doesn't. localStorage + KV-backed parse cache. |
| **Synthesized `voice.md`** | Build-time distillation of past proposals into a compact voice spec. Cheaper at inference than feeding raw proposals as voice context. |
| **`/api/health` smoke check + `pnpm verify:deploy`** | Catches the env-var-not-set-in-Vercel-dashboard failure that bites every Next.js deploy. |
| **Prompt caching with measured savings** | `cache_control: ephemeral` on KB + base rules. ~50% input-cost reduction on repeated edits. |
| **Pre-parsed committed KB** | Saves ~$1 + 60s on first deploy; makes the KB inspectable and version-controlled. |
| **Light CI** (lint + typecheck + Vitest on push/PR) | Operational maturity signal; reviewer sees green checkmarks on clone. |

---

## 7. What I'd build next given another 8 hours

In priority order:

1. **DOCX export** (~1.5 hr) — closes the loop with Buoyant's actual product workflow (Word-integrated). Customers who own the source files would prefer DOCX over PDF for re-styling.
2. **Multi-paragraph chat surface** (~2.5–3 hr) — sidebar chat that emits multi-block patches; user reviews via accept-all/some/none gate. Enables "rewrite the whole Project Approach section" style asks.
3. **Hard-fixture support: multi-column reading order + table fidelity** (~1.5–2 hr) — pull in LlamaParse or a structured-extraction pre-pass for problem PDFs, falling back to the current parser. Improves robustness on partner submissions and recycled docs.
4. **Auth (Clerk) + Postgres + per-firm KB upload** (~2 hr) — enables team workflows, persistent multi-device sessions, and the V2 product shape where each firm uploads its own past proposals.
5. **Posthog wiring + Sentry + per-IP rate limiting on `/api/edit`** (~30 min remaining) — turns the event-logging scaffolding into real production observability.

---

## Open questions for Eric

Two were sent early per the brief's encouragement:

1. **What's typically wrong when customers reject AI suggestions?** (hallucination / wrong tone / lost info / "sounded like AI"). Routes which offline eval to ship first and which guardrail in the system prompt to lean hardest on.
2. **Is v2 single-user or multi-user collaborative?** Determines whether auth+Postgres jumps from priority #4 to #1 in the V2 list. V1 is single-user regardless.

Plus one resolved during build:

3. **What's in the KB?** Resolved by the CTO: past proposals are the KB. We use the 5 MECO PDFs with the active doc excluded by hash.

---

## Token-cost analysis

- **Parse** (per new PDF): ~$0.20 first call; $0 on KV-cache hit (24-page MECO).
- **Edit** (Sonnet 4.6, KB inlined): first edit ~$0.013 (cache write), subsequent ~$0.005 each (cache read).
- **Sample 20-edit session**: ~$0.10 in compute.
- **KB build** (one-time): ~$1 for parse + distill + voice synthesis on all 5 MECO PDFs. Cached forever (committed to repo).

Prompt-cache savings can be measured live via a `TokenMeter` overlay (V1.5 polish — scaffold exists in the event vocabulary).

---

## Architecture map (high level)

```
/app
  /api
    blob-token/    issues client-direct Vercel Blob upload tokens
    parse/         streamed Claude PDF parse → Zod-validated DocumentModel → KV cache
    edit/          streamed Claude edit with KB-cached system prompt
    export/        Markdown / Clean PDF / Annotated-original PDF
    events/        no-op telemetry collector (V1.5: Posthog wiring)
    health/        env + Anthropic + KV + Blob smoke check
  /editor/[docHash]
                  3-pane editor: PDF (left) + DocPane (center) + ChangesSidebar (right)
  page.tsx        upload + resume banner

/components
  /upload         UploadDropzone (client-direct hashing + upload), ResumeBanner
  /editor         PdfPane, DocPane, BlockView, EditComposer, DiffView, ChangesSidebar,
                  ExportPopover, EditorKeyboardShortcuts, useBboxResolution, usePdfHoverScroll

/lib
  env.ts          zod-validated env, fail-fast at boot
  anthropic.ts    proxy-pointed Anthropic client
  anthropic-pdf.ts URL → base64 → Files-API fallback chain for PDF input
  doc-model.ts    types + pure ops; revision stacks per block
  doc-model-zod.ts schema validation at every boundary
  diff.ts         diff-match-patch wrapper with quote/dash normalization
  edit-prompt.ts  intent-specific system prompts + min-edit guardrails
  edit-stream.ts  client-side SSE consumer w/ usage marker parsing
  kb.ts           runtime KB loader with hash-exclusion
  prompt-cache.ts cached-system-blocks builder (cache_control wrapping)
  bbox-resolver.ts NFKC + soft-hyphen-strip + sliding fuzzy match w/ confidence
  pdf-coords.ts   PDF.js (top-left) ↔ pdf-lib (bottom-left) flip
  /export
    markdown.ts   walk doc model → markdown
    clean.ts      pdf-lib fresh render with manual word-wrap
    annotated.ts  overlay numbered markers on original + summary page appendix
  persistence.ts  versioned localStorage codec, debounced writer
  session-store.ts Zustand store w/ full edit lifecycle (start/result/accept/undo/redo)
  track.ts        event vocab → /api/events
  hash.ts         SHA-256 over ArrayBuffer (web crypto)

/scripts
  build-kb.ts          orchestrates parse + distill + voice synthesis (`pnpm build:kb`)
  copy-pdf-worker.mjs  postinstall copies pdfjs worker to public/pdfjs/
  verify-deploy.ts     pings /api/health on a deployed URL

/kb/
  parsed/<hash>.json   full parsed doc models (build-time, committed)
  abstracts/<hash>.md  per-PDF abstracts
  entities/<hash>.json entity tables (firms, projects, clients, dates, $)
  snippets/<hash>.json 3–5 representative paragraphs per past proposal
  voice.synthesized.md compact firm voice spec
  manifest.json        hash → metadata index

/tests
  /unit       Vitest: doc-model, diff, bbox-resolver, persistence, kb-exclusion, export-markdown
  /e2e        Playwright: happy path + resume session (local-only, not in CI)

/.github/workflows/test.yml   lint + typecheck + Vitest on push/PR
```
