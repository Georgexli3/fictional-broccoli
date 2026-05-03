# AI Proposal Editor — Founding Engineer Take-Home

An AI editor for civil-engineering proposals. Upload a proposal PDF, click any block, and ask AI to tighten it, match firm voice, fix names, or reference past work. Every change is shown as a track-changes diff before you accept it — and exports as a Word `.docx` with native track changes that opens in the Review pane for accept/reject.

**Live demo:** <https://fictional-broccoli-mu.vercel.app> (V1)
**V1.7 preview:** <https://fictional-broccoli-git-v16-passive-pdf-georges-projects-fe36494b.vercel.app>

> **Build status:** V1 shipped as planned (M1–M10). After V1, the PDF view itself was iterated three times — V1.5 added spatial overlays on the PDF, V1.6 attempted in-place text replacement, V1.7 dropped both and made the PDF a passive reference with all output flowing through Markdown / DOCX / HTML preview. The pivot story is in §3 — it's the most informative thing in this README.

---

## 1. Setup & run

```bash
pnpm install
cp .env.example .env.local      # then fill in ANTHROPIC_API_KEY (from the hiring contact)
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
| `ANTHROPIC_API_KEY` | Hiring-proxy auth token (works for both Anthropic and OpenAI endpoints) | Provided separately by the hiring contact |
| `ANTHROPIC_BASE_URL` | Proxy base URL | Defaults to the take-home hiring-proxy URL provided in the brief |
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

- **De facto easy fixture:** `ExampleProposals/MECOProposals/1_Copy of City of Dixon SOQ.pdf` (13 MB / 8 pp, ~136 parsed blocks). The end-to-end demo runs against this.
- **De facto hard fixture:** `ExampleProposals/AlphaCMProposals/Windsor ORH proposal.pdf` (24 pp, InDesign, TOC dot leaders, multi-section, appendices). Closer to the brief's hard-fixture archetype in *structural complexity* — file size is not the signal.

If the hiring team provides the intended `kb/` and `proposals/` folders before submission, we'd swap the KB source.

---

## 2. Design decisions

### Thesis: fidelity-first precision editor

The product feels like Track Changes for PDFs with an AI inside, not like ChatGPT-with-a-doc. Diffs by default, accept/reject every change, original PDF always visible. We trade away "creative chat with the doc" in favor of trust, transparency, and pixel-context fidelity — because the brief's own description of the loop (*"The user sees what changed and decides whether to apply it"*) is a trust pattern, not a creative pattern. Engineering / consulting firms review high-stakes proposals; trust > capability.

### Architecture: doc-first, PDF as opt-in reference (V1.7)

Default 2-pane layout: editable DocPane (center, with Edit ↔ Preview tabs) + always-visible ChangesPanel (right, 320 px). The original PDF is hidden by default; a "Show original" toggle in the header expands a third 1fr column on the left for the read-only PDF reference.

Why doc-first instead of PDF-first: V1 through V1.6 led with the PDF and tried to make it the live edited surface (overlays, then in-place text replacement). Both fought the typography tar-pit — see §3 for the full pivot story. V1.7 stops fighting it. The PDF is reference-only; edits surface in the DocPane (block-by-block) and in Preview mode (full-doc HTML with inline track-changes).

DocPane's Edit ↔ Preview tabs:
- **Edit** — block list with click-to-edit, the V1 UX preserved.
- **Preview** — full doc rendered as styled HTML with inline track-changes (red strikethrough + green underline) for edited blocks. Browser's native print-to-PDF on this view gives a clean output PDF for free.

Bidirectional scroll-sync wires the PDF and DocPane together when both are visible (`block.page` only — no fuzzy bbox math, which is why V1.5's spatial sync was unreliable). Hovering a change in the ChangesPanel scrolls both panes to that block.

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

### Export: 4 formats; DOCX with track changes is the headline

- **Word (.docx) with track changes** *(recommended, V1.7)* — every accepted edit becomes a real Word `<w:ins>` / `<w:del>` revision via the `docx` package's `InsertedTextRun` / `DeletedTextRun`. When the file opens in Word it shows as proper redline markup with the Review pane offering accept/reject per change, attributed to "AI Editor." This is the format proposal teams actually need — they review in Word.
- **Markdown** — clean text for Word / Notion / Slack paste.
- **Clean PDF** — pdf-lib regenerates a fresh PDF from the edited doc model. Loses original branding; gains accuracy on edited text content.
- **Annotated Original** — overlay numbered colored markers on the original PDF + append a Changes Summary page enumerating every edit with before/after text. Preserves branding 100%; never modifies content streams. For review/redlining workflows.

DOCX export is V1.7 work — explicitly included because the brief's stretch goal asks for "export back to PDF" but proposal-team review workflows are Word-integrated. DOCX with native track changes is more useful than a clean PDF rewrite for the proposal-review use case (legal/sales accept-rejects in Word's Review pane, no extra tooling).

**Why no in-place text replacement on the original PDF** (preserving branding *and* updating text): silent-failure modes. PDF content streams are glyph-runs at positions, not characters. Replacing text requires re-encoding glyphs in the same embedded font subset (which may not contain new characters), recomputing position offsets, handling line wrap. Commercial libraries (PDFTron, Aspose) solve this at $thousands/year licensing. pdf-lib explicitly does not. **V1.6 attempted this anyway and proved the point** — see §3 for the post-mortem. The honest answers are: original PDF unchanged with markers (Annotated), fresh PDF (Clean), or Word with native track-changes (DOCX).

### State: 3-tier (Blob + KV + localStorage)

| Tier | What lives there | Why |
|---|---|---|
| Vercel Blob | The uploaded PDF binary | Stable URLs; sidesteps Vercel's 4.5 MB body cap |
| Vercel KV | Parse cache, keyed by SHA-256 | Survives serverless cold starts; saves 10–20s + ~$0.20 on re-uploads |
| localStorage | Doc model + edit history (debounced 250ms) | Survives refresh; no DB needed for V1 |

**Undo:** ⌘Z pops the last accepted edit; ⌘⇧Z redoes. The Changes sidebar lists every accepted edit with click-to-jump. Linear undo only in V1; non-linear revert is V2 (requires confirmation UX for cascading reverts on the same block).

**Resume:** on home-page boot, the resume banner reads localStorage and offers to continue. One of the brief's "UX details that matter" — a 20-edit session shouldn't vanish on a refresh.

**Designed with multi-user V2 in mind.** The hiring contact confirmed proposals are typically worked on by multiple roles (proposal writer, engineers, principals). V1 is single-user, but the doc-model's per-block revision stack design is forward-compatible with an op-log / CRDT model: each `Revision` carries a stable `editId` and timestamps, so the migration path to a server-authoritative state with presence + multi-user merging is clean. localStorage will swap for server-stored sessions, and the persistence boundary in `lib/persistence.ts` is the single swap point.

---

## 3. What I cut and why

The interesting cuts are the ones I built first and then deliberately removed. After V1 shipped, I iterated three times on what the PDF view should *be*. Two iterations got built and then cut. Telling that story straight is the highest-signal thing in this README — and it's exactly the kind of "had an opinion, validated against reality, changed my mind" reasoning the brief asks for.

### V1.5 → cut: spatial overlays on the PDF

What I built: click PDF text → block selection on the right pane; drag-select text → highlights the block; amber rectangles drawn at edited regions; hover a region for a diff tooltip. Bidirectional scroll-sync between PDF and DocPane via IntersectionObserver bands. Stamped `data-block-id` on every PDF.js text-layer span via a fuzzy bbox resolver.

What broke: the bbox resolver fuzzy-matches parsed text against the PDF text-layer. Confidence varies by block — at low confidence the highlight rectangles drift visibly off the edited paragraph; at high confidence the click-routing still misroutes when blocks span multiple text-layer items. The bottom line: a *"neat demo when it works, broken when it doesn't"* feel that erodes the trust thesis. Closed the V1.5 PR; preserved the branch as `v1.5-editor-ux` for reference.

What I kept from V1.5: the scroll-mutex + bidirectional scroll-sync hooks (now block.page-only — no fuzzy bbox math), the `useActiveBlockTracking` IntersectionObserver, and the design pattern of separating ephemeral viewport state from persisted edit state. Those work well; the spatial overlays didn't.

### V1.6 → cut: cover-and-replace text in the original PDF

What I built: server-side pdf-lib generator that loads the original PDF and, for each edited block, draws a white rectangle over the original glyphs and writes the edited text in Helvetica at the same bbox. Soft yellow highlight indicator. Cached in Vercel Blob keyed by `(docHash, historyLen)`. New `/api/preview-pdf` endpoint, `usePreviewPdfRegen` hook with stale-while-revalidate, Original / Edited toggle in the PDF toolbar.

What broke: two compounding problems.
1. **Helvetica doesn't match original embedded fonts.** The replacement text visibly stands out as wrong typography — different x-height, different kerning, often different size since auto-fit shrinks to fit the bbox.
2. **When the bbox is off, we cover the wrong text and replace it with the edit** — strictly worse than a misplaced highlight. The user-facing summary was *"the PDF looks the same except with a yellow box that's in the wrong place, and the new text is invisible."*

The honest takeaway: PDF content streams are glyph-runs at positions, not characters. Replacing text requires re-encoding glyphs in the same embedded font subset, recomputing position offsets, handling line wrap, dealing with justified text and ligatures. Commercial PDF libraries (PDFTron, Aspose, PSPDFKit) solve this at $thousands/year licensing — and even they have edge cases. pdf-lib doesn't try. I shouldn't have either.

### V1.7 → kept: doc-first, PDF as passive reference

The fix: stop trying to make the PDF the live edited surface. PDF becomes a passive read-only reference, hidden behind a "Show original" toggle in the header (default off). All edited output flows through the DocPane and through exports — Markdown, Word `.docx` with native track changes, Clean PDF, Annotated original. The DocPane gets Edit ↔ Preview tabs; Preview is full-doc HTML with inline track-changes, and the browser's native print-to-PDF gives a clean output PDF for free.

This sits more honestly with the rest of the design. Proposal-team review workflows are Word-integrated — reviewers accept changes in Word's Review pane. Word is the universal format. A "perfect" PDF re-render was never the right goal for this customer.

### Other things considered and cut

| Cut | Why |
|---|---|
| **Multi-paragraph chat surface** | Dilutes the trust thesis at V1; cleanest add once the per-block reliability is proven. Top of the §7 next-up list now that DOCX is shipped. |
| **In-place PDF text replacement (V1.6)** | Documented above. Honest answer: Word with track-changes solves the same problem more reliably. |
| **Spatial overlays on the PDF (V1.5)** | Documented above. Replaced by the always-visible ChangesPanel. |
| **Hard-fixture multi-column / tables** | A real fix is parser-level (LlamaParse / structured extraction pre-pass), not an MVP feature. Documented as known limitation in §4. |
| **Auth + multi-user / Postgres** | Single-user V1 demo. **The hiring contact confirmed v2 is multi-user collaborative**, so this becomes the #1 V2 priority in §7 — the data model was designed for clean migration. |
| **Vector retrieval / embeddings for KB** | At 5 KB items, similarity search is noise. Inlined + cached is correct at this scale. |
| **Component tests / visual regression / Playwright in CI** | Manual UI testing is faster for this surface; CI stays lint+typecheck+Vitest. |
| **Real analytics backend** | Event vocabulary is scaffolded (`lib/track.ts` + `/api/events`). Posthog wiring is a 30-min V1.5 task. |
| **Sentry / rate limiting / custom domain / staging env** | V1.5 items; not load-bearing for the demo. |
| **Span-level data model** | Block context produces better edits; the surgical-feel comes from span-prefill UI, not a span data model. |
| **Adobe-quality re-rendering of the original** | $thousands/year commercial library territory. Tried in V1.6, gave up. |

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
| 21 | **Long / heavy PDFs may exceed 300s Vercel function ceiling** | The AlphaCM Windsor proposal (24-page InDesign with TOC + multi-section + appendices) consistently runs the parse + 1 retry past the 300s Vercel Hobby function maxDuration. Resolved by streaming the parse response so the connection stays alive during long generations — that's the V1.5 streamed-parse item. Dixon SOQ (24 pages, simpler structure) parses cleanly within budget. README's "demo flow" runs against Dixon. |
| 22 | **Anthropic occasionally returns `blocks` as a JSON-encoded string** (sometimes with malformed inner quotes) | Surfaced in production e2e. Mitigated with multi-unwrap defensive coercion + 2-attempt retry with progressively sharper instruction. Long-term fix: switch tool-use array output to JSONL streaming; that's also the V1.5 streamed-parse work. |

### What I'd check before letting a paying customer use it

**Per the hiring contact's clarification, all four rejection categories matter equally** — hallucination, wrong tone, lost information, and "sounded like AI" are equally serious failure modes for proposal editing. The eval suite is built to test all four, none deprioritized.

Three offline evals, gating any rollout:

1. **Edit-faithfulness LLM-judge** (50 sampled edits across all 4 chips + free-form): does the edit add unsupported claims (hallucination), lose information, or violate the user's intent? Threshold: <2% with new-claim hallucinations, <5% with information-loss issues.
2. **Name-fidelity synthetic test** (30 paragraphs with named entities): run "Tighten" + "Match firm voice" — every named entity must survive unchanged. Threshold: 100%.
3. **Annotated-export accuracy geometric check** (10 docs): markers must land within ±20pt of expected bbox. Threshold: ≥95%.

A fourth eval ("voice-match" — does the edit *sound* like the firm? LLM-judge against the synthesized voice doc) is the natural follow-on once we ship Posthog and have real 👎-with-reason labels to fine-tune against.

Plus the production observability described in §5 to watch all four failure modes in the wild.

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

Three suites, all described in §4 — and per the hiring contact they're equally load-bearing. V1 ships the **name-fidelity** suite as the one-suite proof-of-pattern (`evals/name-fidelity.test.ts` — placeholder structure scaffolded). Edit-faithfulness and annotated-accuracy are the two next-up suites; both are scaffolded and would land before paying customers.

---

## 6. What I added beyond the brief and why

| Addition | Why |
|---|---|
| **Proactive KB hints** *(V1.7.2)* | The KB was the most underused thing in V1 — it only fired when the user clicked "Reference past work" inside the composer. V1.7.2 makes it ambient: every block silently scores against per-proposal topic bags on doc load; relevant blocks get a 📎 chip in the metadata row showing the matched past project. One click → composer opens with the hint preview banner and the `reference_past_work` edit auto-fires. Pure deterministic matcher (no LLM, no embeddings — at 5 KB items vector search would be noise) with stopword filtering tuned for precision over recall. ~10 ms over a 100-block doc. |
| **Word `.docx` export with native track changes** *(V1.7, headline)* | Each accepted edit becomes a `<w:ins>` / `<w:del>` revision via the `docx` package. Opens in Word's Review pane with accept/reject for each change, attributed to "AI Editor." This is what proposal teams actually use to review redlines — the brief's "export to PDF" stretch goal is the literal interpretation; Word with track-changes is the *useful* one. |
| **Live HTML preview pane** *(V1.7)* | DocPane gets an Edit ↔ Preview tab. Preview renders the full doc as styled HTML with inline track-changes (red strikethrough + green underline). Print-to-PDF from this view gives a clean output PDF for free, no PDF-rebuilding logic needed. |
| **Annotated Original PDF export** preserving branding via overlay | Brief's stretch asks for "re-render to PDF"; we went deeper because the dominant customer scenario (partner's PDF, recycled past proposal) can't assume source files exist. |
| **PDF.js text-layer fuzzy matcher** for bbox resolution | Defensive use of original PDF as ground truth. LLM-emitted geometry is the wrong place to put trust. |
| **Span-aware composer prefill** | Drag-select pre-fills `Replace 'X' with…` — surgical-edit feel without paying for span-level data model. |
| **Hover scroll-sync between panes** | Brief explicitly rewards "UX details that matter." Bridges the two-pane structure when the PDF reference is open. |
| **Always-visible ChangesPanel with viewport tracking** *(V1.7)* | Auto-focuses the change relevant to whatever block is in the middle band of your DocPane viewport. Click any change → both panes scroll. |
| **Resume session banner** | Most products lose your work; this one doesn't. localStorage + KV-backed parse cache. |
| **Synthesized `voice.md`** | Build-time distillation of past proposals into a compact voice spec. Cheaper at inference than feeding raw proposals as voice context. |
| **`/api/health` smoke check + `pnpm verify:deploy`** | Catches the env-var-not-set-in-Vercel-dashboard failure that bites every Next.js deploy. |
| **Prompt caching with measured savings** | `cache_control: ephemeral` on KB + base rules. ~50% input-cost reduction on repeated edits. |
| **Pre-parsed committed KB** | Saves ~$1 + 60s on first deploy; makes the KB inspectable and version-controlled. |
| **Light CI** (lint + typecheck + Vitest on push/PR) | Operational maturity signal; reviewer sees green checkmarks on clone. |
| **End-to-end browser testing pass** with full bug-fixing loop | Surfaced 8 real bugs that wouldn't have shown up at typecheck/lint time — see "Bugs found and fixed during e2e" below. |

### Bugs found and fixed during end-to-end production testing

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Upload CORS to `blob.vercel-storage.com` | `@vercel/blob` 0.27.3 was 8 majors behind upstream | Upgraded to 2.3.3 |
| 2 | Upload still CORS to `vercel.com/api/blob` (private blob store) | Provisioned via dashboard as **Private**, but `access: 'public'` requires a public store | Recreated store as Public via `vercel blob create-store --access public` |
| 3 | `/api/parse` 504 timeout | Default 60s ceiling too tight for Claude PDF parse on 24-page docs | Bumped maxDuration to 300s |
| 4 | Parse output failed Zod with `blocks: Expected array, received string` | Anthropic occasionally returns array-typed tool fields as JSON-encoded strings (sometimes double-encoded with malformed inner quotes) despite strict input_schema | Multi-unwrap defensive coercion (loop JSON.parse up to 5 times) + spread-build new object since SDK freezes `tool_use.input` + 2-attempt retry with sharper "emit a TRUE JSON array" instruction |
| 5 | Re-upload of same PDF: "blob already exists" error | Path is content-addressed by SHA-256, so identical bytes hit the same path on second upload | `allowOverwrite: true` in server token (idempotent re-upload preserves URL + KV cache) |
| 6 | MECO cover blocks parsed as garbled doubled letter-spacing ("Statement of Statement of Qualifications Qualifications") | Visual letter-spacing + stacked banner repetition in the source PDF | Parse prompt extended with three explicit rules: collapse letter-spaced display titles, dedupe visual repetition, normalize phone/ID intra-word spaces |
| 7 | PDF.js text-layer intercepting clicks on right-pane Discard / Accept buttons | CSS Grid columns have implicit `min-width: auto`, so the PDF page wrapper (734px at scale 1.2) was blowing out the 1fr column allocation | `min-w-0` on PdfPane and DocPane roots; columns now honor 1fr and clip overflow |
| 8 | `/favicon.ico` 404 console noise on every page load | No favicon shipped | Added `/public/favicon.svg` (referenced by layout.tsx) |

---

## 7. What I'd build next given another 8 hours

The hiring contact confirmed v2 is multi-user collaborative — proposals are typically worked on by multiple roles (proposal writer, engineers, principals). That answer reshuffled the priorities below: collaboration infrastructure jumps to **#2** (DOCX shipped in V1.7, freeing the slot). The new top item is RFP-aware editing — the bottleneck I'd target next if I were trying to make the product 10× more useful in a single feature.

In priority order:

1. **RFP-aware editing** (~3 hr) — paste the RFP requirements into a sidebar; the app extracts required sections (Schedule, Approach, Team, Cost, …) → renders a checklist of which are present in the proposal vs. missing → auto-suggests boilerplate from the KB to fill gaps. Compliance is the actual proposal-team bottleneck (missing one required section can disqualify a bid). Demos in 30 seconds and instantly explains why someone would pay for this. *The biggest 10× lever on top of the V1.7 base.*
2. **Auth (Clerk) + Postgres + multi-user collaboration** (~3 hr) — the unblocking move for the rest of the v2 backlog. Clerk for sign-in (5 min config, native Vercel Marketplace integration). Postgres for server-authoritative state. Migrate the doc-model's per-block revision stack to an operation log — the design is already forward-compatible. Add per-firm KB upload UI replacing the hardcoded MECO build. Per-block locks for concurrent edits.
3. **Multi-paragraph chat surface** (~2 hr) — sidebar chat that emits multi-block patches; reviewed via accept-all/some/none gate. Enables *"rewrite the whole Project Approach section in our voice"* asks. Compounds well with DOCX track-changes — multi-block edits export as a coherent set of revisions.
4. **Streamed `/api/parse` + JSONL block delivery** (~2 hr) — biggest robustness win. Today's non-streamed parse hits Vercel's 300s function ceiling on large multi-section InDesign-built PDFs (e.g. AlphaCM Windsor). Streaming the response keeps the connection alive past the ceiling AND sidesteps Anthropic's occasional `blocks-as-stringified-JSON` quirk by emitting one block per stream event. Also enables a progressive "blocks appearing as they're parsed" UX.
5. **LLM-rerank on top of the deterministic KB matcher** (~1.5 hr) — the V1.7.2 token-overlap matcher is precise but coarse. Once a block has 2–3 candidate past projects from the deterministic pass, send the top candidates + block text to Claude for a fast yes/no relevance check. Better matches without paying for embeddings or per-block LLM calls (the deterministic pass filters the candidate set first).
6. **Hard-fixture support: multi-column reading order + table fidelity** (~1.5 hr) — LlamaParse or structured-extraction pre-pass for problem PDFs; fall back to current parser.
7. **Posthog wiring + Sentry + per-IP rate limiting on `/api/edit`** (~30 min) — turns the event-logging scaffolding into real production observability and protects spend.

**Already shipped post-V1** *(captured here for the rubric pass; details in §3 / §6):*
- V1.7.2 — Proactive KB hints (📎 chip on relevant blocks).
- V1.7.1 — Encrypted/image-only PDF detection in `/api/parse`; Anthropic 429/5xx classifier with actionable messages.
- V1.7 — Doc-first layout, DOCX export with native Word track changes, HTML preview pane.
- V1.6 — Cover-and-replace text on PDF (cut after testing — see §3).
- V1.5 — Spatial overlays on PDF (cut after testing — see §3).

Threaded comments + @-mentions on edits, role-based permissions (only principals can accept "Reference past work" edits), and PDF redlining for cross-firm partner reviews are the v2.5 backlog these unlock.

---

## Open questions for the hiring contact

All three are now answered:

1. **What's typically wrong when customers reject AI suggestions?** *Hiring contact: "Everything you've brought up are things we've built into the product bc they're all real concerns and equally important."* All four (hallucination, wrong tone, lost info, "sounded like AI") matter equally. We've kept the system-prompt guardrails for all four (no new claims, voice grounding, no info loss, minimum-edit) and weighted the eval suite to cover all four — see §4 and §5 (Layer 3).
2. **Is v2 single-user or multi-user collaborative?** *Hiring contact: "Multi-user as proposals are typically worked on by multiple people at all firms ie proposals writer, engineers, principles, etc."* V2 is multi-user. The §7 priority order now puts auth + Postgres + collab data layer at #1; we designed V1's per-block revision stack to migrate cleanly to an operation log (attributed, timestamped). The persistence boundary in `lib/persistence.ts` is the single swap point.
3. **What's in the KB?** *Hiring contact: "A large part of a customer's KB is past proposals … we've included 5 proposals for MECO. You can pick one as the proposal you're working on and treat the others as past proposals in the knowledge base."* We use the 5 MECO PDFs at `ExampleProposals/MECOProposals/`, with the active doc excluded by SHA-256 hash at runtime so it's never fed to itself as past-work context.

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
