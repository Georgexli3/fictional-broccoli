# Take-Home Assessment — Founding Engineer

Welcome, and thank you for spending the time on this. This document is everything you need to get started.

---

## What we're building

Buoyant builds AI tools for engineering and consulting firms — small teams that write a lot of proposals to win civil engineering, infrastructure, and construction-adjacent contracts. Our customers spend dozens of hours on each proposal; we want them to spend a few. We're a small, growing team, and you'd be one of the first engineers shaping what the product becomes.

This take-home is designed to be representative of the work you'd actually do here. We're looking for someone who can take an open-ended problem, make good engineering and product decisions under time pressure, and ship something a real user could use.

---

## The assignment

A common workflow for our customers: a consultant has a proposal PDF — their own draft, a partner's submission, or a past proposal being recycled — and wants to make targeted edits. "Fix this paragraph." "Rewrite this in our voice." "The client name is wrong." "Add a sentence about our experience on similar projects." Today this is manual.

<aside>
🎯

**Build a web app that lets a user upload a proposal PDF and use AI to edit it section by section.**

</aside>

The basic loop:

1. The user uploads a PDF.
2. The PDF is rendered in the browser in a way that lets them interact with its content.
3. The user can select a paragraph (or whatever unit you decide is right) and ask the AI to do something to it — rewrite, tighten, fix names, change tone, add information from a knowledge base, etc.
4. The AI returns a proposed change. The user sees what changed and decides whether to apply it.
5. Applied changes are reflected in the document. Multiple edits compose. Undo if possible.

How you implement each of those steps is up to you. PDFs don't natively expose paragraphs, sections, headings, or any structural metadata — recovering structure from a PDF is itself a real engineering problem, and we want to see how you approach it.

---

## A finished, working product is the minimum bar

<aside>
⚠️

**This is the bar.** The easy fixture must work end-to-end on your deployed app: a user uploads it, selects content, gets an AI-proposed edit, and applies it. A submission that doesn't close this loop won't pass review — no matter how polished the parts that do work are. Scope aggressively so the loop closes before you reach for anything else.

</aside>

---

## We are looking for strong product instincts

This brief describes a starting point, not the whole product. We're hiring someone who will help **shape what Buoyant becomes**, not just execute on specs. We want to see what you'd build if you had your own opinions about what the user actually needs.

If, while building, you have an opinion about how the product should work — what's missing, what's clunky, what would matter to a real user — bring it. We'd rather see a smaller, intentional product that reflects your judgment than a literal interpretation of this brief.

Themes we'd notice and reward (illustrative — not a checklist):

- **UX details that matter.** The small things that separate a real product from a demo.
- **Performance choices.** Where you chose to invest in making things feel fast, and where you accepted the trade-off.
- **Product taste.** Anything you built because you thought the user would want it.
- **Polish.** The visual and interaction details that make a product feel cared for.

What we **don't** reward:

- Quantity of features for its own sake. Two thoughtful additions beat ten half-finished ones.
- Things that look impressive but aren't grounded in user value.

In the README, call out the choices you made and why. We'll ask "why?" in the demo, and what we want to hear is real reasoning grounded in the user, not "I thought it would look cool."

---

## Constraints

- **Stack:** Next.js + TypeScript. Beyond that, your call.
- **Deployment:** We recommend Vercel, but it’s up to you.
- **Database:** Optional. Use whatever makes sense (Supabase, Vercel Postgres, none). If you're not sure, you don't need one.
- **AI:** Use the API proxy described in the next section. We've set spend caps; budget accordingly.

---

## Time budget

We expect this to take about **4 focused hours**. You have **until the given deadline** from when you receive this document to submit. Use as much or as little of that window as you want — we won't penalize either way.

Use any AI tooling you want. We expect Claude Code, Cursor, Codex, or similar in your workflow — Buoyant is a heavy AI-assisted development shop. We're more interested in what you ship and how you defend it vs. how you typed it.

The README is part of how we grade.

---

## Required README sections

When you submit, your README must include:

1. **Setup & run instructions.** How we run your project locally if we want to.
2. **Design decisions.** Approach to PDF representation, agent design, UX. Brief justifications.
3. **What I cut and why.** What you considered and decided not to ship. This is one of the highest-signal sections — be specific.
4. **Failure modes I worried about.** Where could this break? What are the silent-failure risks? What would you check before letting a paying customer use it?
5. **How I'd evaluate this.** If we shipped this to production, how would you know if it was working well? What would you measure?
6. **What I added beyond the brief and why.** If you didn't add anything, that's a choice too — explain it.
7. **What I'd build next given another 8 hours.**

---

## Stretch goals (optional, don't expect to finish)

If you have time and want to push further — we'd notice but don't expect any of these:

- **Knowledge base integration.** Use the provided KB to inform edits ("add a paragraph about a past project we did" should pull from the KB).
- **Multi-paragraph chat.** A chat surface where the user describes edits affecting multiple paragraphs at once. Significantly harder than the per-paragraph flow.
- **Export back to PDF.** Re-render the edited document back to a downloadable PDF.
- **Hard fixture.** Make the system gracefully handle the harder PDF (multi-column, table, etc.).

---

## What we provide

- **Two fixture PDFs:**
    - `proposals/easy.pdf` — clean single-column 6–8 page consulting proposal. Make this work end-to-end.
    - `proposals/hard.pdf` — more realistic customer PDF with a two-column section, a small table, headers/footers, and an embedded image. Stretch goal.
- **A small knowledge base** (`kb/`) — 3–5 sanitized prior proposals + a "company voice" markdown doc. Use it or ignore it — it's there if you want to ground edits in real context.
- **API proxy access.** See next section.

---

## API details

Use our AI proxy to make calls to the OpenAI and Anthropic APIs. We'll provide you with:

- **Proxy Base URL:** `https://hiring-proxy.trybuoyant.ai`
- **Authentication Token:** A single token usable for both OpenAI and Anthropic. Sent separately.

The proxy is a drop-in replacement for the official APIs. Use the official SDKs, point them at the proxy, and use the auth token we send you in place of provider keys. 

### OpenAI Endpoint

**Endpoint:** `https://hiring-proxy.trybuoyant.ai/openai`

Use the official OpenAI SDK:

```tsx
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: <Your Authentication Token>,
  baseURL: 'https://hiring-proxy.trybuoyant.ai/openai',
});
```

### Anthropic Endpoint

**Endpoint:** `https://hiring-proxy.trybuoyant.ai/anthropic`

Use the official Anthropic SDK:

```tsx
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: <Your Authentication Token>,
  baseURL: 'https://hiring-proxy.trybuoyant.ai/anthropic',
});
```

Models, request shapes, and streaming all behave exactly as the official SDKs document. The proxy adds nothing and removes nothing — it just authenticates you and meters spend.

---

## Communication

Ask any clarifying questions you want — text Eric directly. **No penalty.** We'd rather you ask than guess wrong. Strong candidates often ask one or two sharp questions early.

---

## Submission

When you're done, send us:

1. **A link to a public GitHub repo.** Don't squash your commit history — we want to see how the work evolved.
2. **A URL link** where the app is running.
3. **Your README** (in the repo).

---

## Demo follow-up

After you submit, we'll schedule a **45-minute follow-up call:**

- **10 min** — you walk us through the product. Demo it like you're showing a customer.
- **25 min** — code review and pushback. We'll dig into your design decisions and ask you to defend them.
- **10 min** — "What would v2 look like if we paid you to keep working on this for a month?"

---

Excited to see what you build. Reach out if anything's unclear. Good luck!