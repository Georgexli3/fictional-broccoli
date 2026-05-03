/**
 * Sanitizer for text drawn via pdf-lib's standard fonts.
 *
 * pdf-lib's bundled StandardFonts (Helvetica, Times-Roman, etc.) use the
 * WinAnsi (CP-1252) encoding. Characters outside that codepage cause
 * `font.encodeText` to throw `WinAnsi cannot encode "X" (0xNNNN)` — which
 * crashes the export route with a 500.
 *
 * Real-world inputs that hit this:
 *   - LLM output containing arrows (→ ←), bullets beyond •, ellipsis-as-…
 *     when the model returns multi-byte UTF-8, em-quad spaces, geometric
 *     shapes, mathematical symbols
 *   - User prompts pasted from Slack/Notion that contain Unicode glyphs
 *   - Non-Latin client / project names (CJK, Cyrillic, Greek, accented Vietnamese)
 *
 * What WinAnsi DOES support (so we don't over-sanitize):
 *   - Standard ASCII
 *   - Most Latin-1 (À–ÿ)
 *   - Smart quotes "" '' (0x91–0x94)
 *   - En-dash – em-dash — bullet • ellipsis … (0x96, 0x97, 0x95, 0x85)
 *   - Currency € £ ¥ (0x80, 0xA3, 0xA5)
 *   - Trademark ™ © ® (0x99, 0xA9, 0xAE)
 *
 * Strategy: try a curated map of common substitutions first; fall through
 * to "?" for anything still un-encodable. Always preserves text length-ish
 * so wrap calculations don't drift.
 */

const SUBSTITUTIONS: Record<string, string> = {
  // Arrows
  "→": "->",
  "←": "<-",
  "↑": "^",
  "↓": "v",
  "↔": "<->",
  "⇒": "=>",
  "⇐": "<=",
  // Geometric / decorative
  "■": "[]",
  "□": "[]",
  "▪": "*",
  "●": "*",
  "○": "o",
  "◦": "o",
  "★": "*",
  "☆": "*",
  "✓": "v",
  "✔": "v",
  "✗": "x",
  "✘": "x",
  "✦": "*",
  // Math
  "×": "x",
  "÷": "/",
  "≈": "~",
  "≠": "!=",
  "≤": "<=",
  "≥": ">=",
  "±": "+/-",
  "∞": "inf",
  "√": "sqrt",
  "∑": "sum",
  "∆": "delta",
  // Whitespace / typography that WinAnsi lacks
  " ": " ", // thin space
  " ": " ", // hair space
  "​": "", // zero-width space
  "‌": "", // zero-width non-joiner
  "‍": "", // zero-width joiner
  " ": "\n", // line separator
  " ": "\n\n", // paragraph separator
  " ": " ", // non-breaking space (technically WinAnsi 0xA0 but we collapse)
  "　": "  ", // ideographic space
  "﻿": "", // BOM / zero-width no-break space
};

// CP-1252 (WinAnsi) is a superset of Latin-1 with extras in 0x80–0x9F.
// pdf-lib's encodeText accepts: ASCII (0x20–0x7E), Latin-1 (0xA0–0xFF),
// and the 27 CP-1252-specific code points in 0x80–0x9F that map to
// Unicode characters like “”‘’ –—•… € ™ etc.
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function isWinAnsiSafe(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return true;
  // ASCII printable + standard whitespace
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return true;
  // Latin-1 supplement
  if (cp >= 0xa0 && cp <= 0xff) return true;
  // CP-1252 extras
  return WINANSI_EXTRAS.has(cp);
}

/**
 * Make a string safe to pass to `pdf-lib`'s standard fonts. Substitutions
 * preserve meaning where possible; un-substitutable characters become "?".
 */
export function winAnsiSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    if (isWinAnsiSafe(ch)) {
      out += ch;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(SUBSTITUTIONS, ch)) {
      out += SUBSTITUTIONS[ch];
      continue;
    }
    out += "?";
  }
  return out;
}
