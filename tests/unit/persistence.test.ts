/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearSession,
  readSession,
  startSession,
  writeSession,
} from "@/lib/persistence";

describe("persistence (localStorage round-trip)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("writes and reads back a fresh session", () => {
    const meta = {
      pdfBlobUrl: "https://blob.example.com/abc.pdf",
      pdfHash: "a".repeat(64),
      filename: "Dixon SOQ.pdf",
      size: 13_000_000,
      uploadedAt: Date.now(),
    };
    const written = startSession(meta);
    const read = readSession();
    expect(read).not.toBeNull();
    expect(read!.pdfHash).toBe(written.pdfHash);
    expect(read!.filename).toBe(meta.filename);
    expect(read!.version).toBe(1);
  });

  it("returns null when no session is stored", () => {
    expect(readSession()).toBeNull();
  });

  it("clearSession removes the stored entry", () => {
    startSession({
      pdfBlobUrl: "https://example/x",
      pdfHash: "b".repeat(64),
      filename: "x.pdf",
      size: 100,
      uploadedAt: 0,
    });
    expect(readSession()).not.toBeNull();
    clearSession();
    expect(readSession()).toBeNull();
  });

  it("returns null on schema mismatch (forward-compat)", () => {
    window.localStorage.setItem(
      "buoyant.session.v1",
      JSON.stringify({ version: 99, junk: true }),
    );
    expect(readSession()).toBeNull();
  });

  it("writeSession overwrites prior state", () => {
    const meta1 = {
      pdfBlobUrl: "https://e/x1",
      pdfHash: "c".repeat(64),
      filename: "first.pdf",
      size: 10,
      uploadedAt: 0,
    };
    const meta2 = {
      pdfBlobUrl: "https://e/x2",
      pdfHash: "d".repeat(64),
      filename: "second.pdf",
      size: 20,
      uploadedAt: 1,
    };
    startSession(meta1);
    writeSession({ version: 1, ...meta2 });
    expect(readSession()!.filename).toBe("second.pdf");
  });
});
