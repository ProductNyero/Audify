import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  formatTableForSpeech,
  narrateHtmlTables,
  narrateMarkdownTables,
  narratePlainTextTables,
  narratePunctuation,
} from "../src/lib/table-narration";

// ---------------------------------------------------------------------------
// formatTableForSpeech — contextual "Under <Header>: <Value>." narration
// ---------------------------------------------------------------------------

describe("formatTableForSpeech", () => {
  it("produces the user-specified contextual narration", () => {
    const out = formatTableForSpeech({
      headers: ["Process", "Description"],
      rows: [
        [
          "Develop Project Charter",
          "It is only when a project has been selected and the business case defined (the project's why) that a charter can be created",
        ],
      ],
    });
    // Note: narratePunctuation is applied later by normalizeAndValidate, not
    // by formatTableForSpeech itself. So the raw cell text (with parens)
    // appears here verbatim; the punctuation pass tests cover that step.
    assert.equal(
      out,
      "Here is a table with two columns: Process and Description. " +
        "First row. Under Process: Develop Project Charter. " +
        "Under Description: It is only when a project has been selected " +
        "and the business case defined (the project's why) that a charter " +
        "can be created.",
    );
  });

  it("repeats the 'Under <Header>:' prefix for every row, with ordinal labels", () => {
    const out = formatTableForSpeech({
      headers: ["Name", "Role", "Status"],
      rows: [
        ["Nyero", "TPM", "Active"],
        ["Sam", "Designer", "Away"],
      ],
    });
    assert.equal(
      out,
      "Here is a table with three columns: Name, Role, and Status. " +
        "First row. Under Name: Nyero. Under Role: TPM. Under Status: Active. " +
        "Second row. Under Name: Sam. Under Role: Designer. Under Status: Away.",
    );
  });

  it("skips empty cells without leaving dangling 'Under X:' fragments", () => {
    const out = formatTableForSpeech({
      headers: ["Name", "Email", "Phone"],
      rows: [
        ["Alex", "alex@example.com", ""],
        ["Bea", "", "555-1234"],
      ],
    });
    assert.equal(
      out,
      "Here is a table with three columns: Name, Email, and Phone. " +
        "First row. Under Name: Alex. Under Email: alex@example.com. " +
        "Second row. Under Name: Bea. Under Phone: 555-1234.",
    );
  });

  it("falls back gracefully when there are no headers", () => {
    const out = formatTableForSpeech({
      headers: null,
      rows: [
        ["foo", "bar"],
        ["baz", ""],
      ],
    });
    assert.equal(
      out,
      "Here is a table with two rows. First row. foo. bar. Second row. baz.",
    );
  });

  it("does not double-period values that already end in punctuation", () => {
    const out = formatTableForSpeech({
      headers: ["Note"],
      rows: [["Use it carefully!"]],
    });
    assert.equal(
      out,
      "Here is a table with one column: Note. First row. Under Note: Use it carefully!",
    );
  });

  it("uses 'Row N' after the first ten ordinal words", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [String(i + 1)]);
    const out = formatTableForSpeech({ headers: ["Index"], rows });
    assert.ok(out.includes("Tenth row. Under Index: 10."));
    assert.ok(out.includes("Row 11. Under Index: 11."));
    assert.ok(out.includes("Row 12. Under Index: 12."));
  });

  it("returns an empty string for a fully empty table", () => {
    assert.equal(
      formatTableForSpeech({ headers: null, rows: [[]] }),
      "",
    );
    assert.equal(
      formatTableForSpeech({ headers: ["", "", ""], rows: [["", ""]] }),
      "",
    );
  });
});

// ---------------------------------------------------------------------------
// narratePunctuation — bracketed groups → spoken prose
// ---------------------------------------------------------------------------

describe("narratePunctuation", () => {
  it("matches the user's example output verbatim", () => {
    const input =
      "It is only when a project has been selected and the business case defined (the project's why) that a charter can be created";
    assert.equal(
      narratePunctuation(input),
      "It is only when a project has been selected and the business case defined, in parentheses, the project's why, that a charter can be created",
    );
  });

  it("narrates square brackets and curly braces too", () => {
    assert.equal(
      narratePunctuation("See [the manual] and {appendix A}."),
      "See, in brackets, the manual, and, in braces, appendix A.",
    );
  });

  it("strips empty groups", () => {
    assert.equal(narratePunctuation("hello () world"), "hello world");
    assert.equal(narratePunctuation("hello [ ] world"), "hello world");
  });

  it("handles a paren at the start of a sentence cleanly", () => {
    assert.equal(
      narratePunctuation("(see chapter 5) for details."),
      "in parentheses, see chapter 5, for details.",
    );
  });

  it("does not leave dangling commas before periods", () => {
    assert.equal(
      narratePunctuation("The result is fine (mostly)."),
      "The result is fine, in parentheses, mostly.",
    );
  });

  it("collapses repeated commas left behind by adjacent parens", () => {
    assert.equal(
      narratePunctuation("a (b) (c) d"),
      "a, in parentheses, b, in parentheses, c, d",
    );
  });

  it("expands simple nesting in multiple passes", () => {
    // "(outer [inner])" → inner first, then outer wraps the expanded text.
    const out = narratePunctuation("see (outer [inner] thing) now");
    assert.ok(out.includes("in parentheses"));
    assert.ok(out.includes("in brackets"));
    assert.ok(out.includes("outer"));
    assert.ok(out.includes("inner"));
  });
});

// ---------------------------------------------------------------------------
// Per-format finders — markdown / HTML / plain text
// ---------------------------------------------------------------------------

describe("narrateMarkdownTables", () => {
  it("converts a GFM pipe table to spoken form and leaves surrounding text alone", () => {
    const md = [
      "# Heading",
      "",
      "Intro line.",
      "",
      "| Name | Role | Status |",
      "|---|---|---|",
      "| Nyero | TPM | Active |",
      "",
      "Closing line.",
    ].join("\n");
    const out = narrateMarkdownTables(md);
    assert.ok(out.startsWith("# Heading"));
    assert.ok(out.includes("Intro line."));
    assert.ok(
      out.includes(
        "Here is a table with three columns: Name, Role, and Status.",
      ),
    );
    assert.ok(out.includes("First row. Under Name: Nyero. Under Role: TPM. Under Status: Active."));
    assert.ok(out.includes("Closing line."));
    // The pipe row itself should no longer be present.
    assert.ok(!out.includes("| Nyero |"));
  });

  it("requires a separator row — bare pipe lines stay as prose", () => {
    const md = "| not a table |\nstill prose";
    const out = narrateMarkdownTables(md);
    assert.equal(out, md);
  });
});

describe("narrateHtmlTables (mammoth-style input)", () => {
  it("treats the first row as the header when there is more than one row", () => {
    const html =
      "<p>Before.</p>" +
      "<table><tr><td>Process</td><td>Description</td></tr>" +
      "<tr><td>Develop Project Charter</td><td>It is only when (a project) is defined</td></tr></table>" +
      "<p>After.</p>";
    const out = narrateHtmlTables(html);
    assert.ok(out.includes("<p>Before.</p>"));
    assert.ok(out.includes("<p>After.</p>"));
    assert.ok(
      out.includes(
        "Here is a table with two columns: Process and Description.",
      ),
    );
    assert.ok(out.includes("Under Process: Develop Project Charter."));
    // Parens are preserved here; narratePunctuation runs later.
    assert.ok(out.includes("It is only when (a project) is defined."));
  });

  it("respects explicit <th> markup", () => {
    const html =
      "<table><tr><th>Quarter</th><th>Revenue</th></tr>" +
      "<tr><td>Q1</td><td>$1.2M</td></tr></table>";
    const out = narrateHtmlTables(html);
    assert.ok(out.includes("Under Quarter: Q1."));
    assert.ok(out.includes("Under Revenue: $1.2M."));
  });
});

describe("narratePlainTextTables", () => {
  it("detects an ASCII pipe table and narrates it", () => {
    const txt = [
      "Status:",
      "",
      "| Name  | Role     | Status |",
      "| Nyero | TPM      | Active |",
      "| Sam   | Designer | Away   |",
      "",
      "Done.",
    ].join("\n");
    const out = narratePlainTextTables(txt);
    assert.ok(out.includes("Here is a table with three columns"));
    assert.ok(out.includes("Under Name: Nyero."));
    assert.ok(out.includes("Under Role: Designer."));
    assert.ok(out.includes("Done."));
  });

  it("does NOT misidentify a single line containing a pipe as a table", () => {
    const txt = "Use the | character to separate fields.";
    assert.equal(narratePlainTextTables(txt), txt);
  });
});
