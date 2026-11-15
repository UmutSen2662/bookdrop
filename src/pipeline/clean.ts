/**
 * Join paragraphs that a PDF conversion split mid-sentence.
 *
 * Scope: only EPUBs this pipeline produced from another format. Dropped
 * publisher EPUBs are never cleaned.
 *
 * Pure function over bytes: no filesystem, no Tauri, no Node APIs. The zip is
 * read and written with fflate and the XHTML with @xmldom/xmldom, so the same
 * code runs in the app and under Bun.
 *
 * `clean.test.ts` pins the join rules; a change there is a behavior change, not
 * a refactor.
 */

import {
  DOMParser,
  onErrorStopParsing,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import { unzipSync, zipSync } from "fflate";
import { errorMessage } from "./errors";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const NCX_NS = "http://www.daisy.org/z3986/2005/ncx/";

/** XHTML documents whose text may be joined. */
const XHTML_NAME_RE = /\.(x?html?)$/i;

const CLOSERS = "\u201d\"\u2019')]\u00bb";
const TERMINAL = ".!?\u2026";
const CLOSERS_AT_END = new RegExp(
  `[${CLOSERS.replace(/[\\\]]/g, "\\$&")}]+$`,
  "u",
);

export type Join = {
  file: string;
  /** Last 50 characters of the paragraph that kept its place. */
  before: string;
  /** First 40 characters of the paragraph that was absorbed. */
  after: string;
};

export type CleanReport = {
  joins: Join[];
  tocProblemsBefore: string[];
  tocProblemsAfter: string[];
  changedFiles: string[];
  /** True when cleaning broke a TOC target that resolved before. */
  blocked: boolean;
  /** Human-readable reason when the zip, XHTML, or rebuild failed. */
  error?: string;
};

export type CleanResult = {
  /** New EPUB bytes, or null when nothing changed or the write was blocked. */
  output: Uint8Array | null;
  report: CleanReport;
};

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

/** All descendant text and tails, in document order. */
function textOf(element: XmlElement): string {
  let text = "";
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 /* text */ || child.nodeType === 4 /* cdata */) {
      text += child.nodeValue ?? "";
    } else if (child.nodeType === 1) {
      text += textOf(child as XmlElement);
    }
  }
  return text;
}

function trimEnd(text: string): string {
  return text.replace(/\s+$/u, "");
}

/** True when the text closes a sentence, ignoring trailing quotes/brackets. */
function endsSentence(text: string): boolean {
  let trimmed = trimEnd(text);
  trimmed = trimEnd(trimmed.replace(CLOSERS_AT_END, ""));
  if (!trimmed) return false;
  return TERMINAL.includes(trimmed[trimmed.length - 1]);
}

function isLowercase(character: string): boolean {
  return (
    character !== character.toUpperCase() &&
    character === character.toLowerCase()
  );
}

function firstToken(text: string): string {
  return text.trim().split(/\s+/u)[0] ?? "";
}

/** Strip the sentence punctuation that would otherwise look like a domain dot. */
function bareToken(token: string): string {
  return token.replace(/[.,;:!?\u2026"'\u201d\u2019)\]]+$/u, "");
}

// ---------------------------------------------------------------------------
// the join rule
// ---------------------------------------------------------------------------

function isParagraph(element: XmlElement): boolean {
  return (element.localName ?? element.nodeName).toLowerCase() === "p";
}

function containsImage(element: XmlElement): boolean {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const name = (
      (child as XmlElement).localName ?? child.nodeName
    ).toLowerCase();
    if (name === "img" || containsImage(child as XmlElement)) return true;
  }
  return false;
}

/**
 * Narrow guards against joins that are typographically legal but semantically
 * wrong: a URL or email continued from a sentence, a camel-cased word, or a
 * line number/year at the end of the previous line.
 */
function looksWrong(previous: string, next: string): boolean {
  const token = bareToken(firstToken(next));

  // 1. URL, domain, email, or path.
  if (token.includes(".") || token.includes("/") || token.includes("@")) {
    return true;
  }
  // 2. camel-cased first word, e.g. "eBook".
  if (/[a-z][A-Z]/.test(token)) return true;
  // 3. a line number or year at the end of the previous line.
  if (/\d$/u.test(previous.trim())) return true;

  return false;
}

function joinCandidate(previous: XmlElement, next: XmlElement): boolean {
  if (!isParagraph(previous) || !isParagraph(next)) return false;
  if (containsImage(previous) || containsImage(next)) return false;

  const previousText = textOf(previous).trim();
  const nextText = textOf(next).trim();
  if (!previousText || !nextText) return false;
  if (previousText.endsWith("\u2014")) return false;
  if (endsSentence(previousText)) return false;
  if (!isLowercase(nextText[0])) return false;

  return !looksWrong(previousText, nextText);
}

// ---------------------------------------------------------------------------
// merging
// ---------------------------------------------------------------------------

/** Append text, extending the trailing text node when there is one. */
function appendText(element: XmlElement, text: string) {
  const last = element.lastChild;
  if (last?.nodeType === 3) {
    last.nodeValue = (last.nodeValue ?? "") + text;
    return;
  }
  const doc = element.ownerDocument;
  if (!doc) return;
  element.appendChild(doc.createTextNode(text));
}

function merge(previous: XmlElement, next: XmlElement) {
  appendText(previous, " ");

  const id = next.getAttribute("id");
  if (id) {
    // Keep the anchor the absorbed paragraph carried; links still resolve.
    const doc = previous.ownerDocument;
    if (doc) {
      const anchor = doc.createElementNS(XHTML_NS, "span");
      anchor.setAttribute("id", id);
      previous.appendChild(anchor);
    }
  }

  // Only the text before the first child element belongs to this paragraph;
  // the child elements are moved separately below. Using textContent here
  // would duplicate everything inside them.
  if (next.firstChild?.nodeType === 3) {
    appendText(previous, next.firstChild.nodeValue ?? "");
    next.removeChild(next.firstChild);
  }

  while (next.firstChild) {
    previous.appendChild(next.firstChild);
  }

  // The text node after the element is its tail. Removing the element alone
  // leaves that stray blank line behind, so drop it too.
  const parent = next.parentNode;
  const tail = next.nextSibling;
  if (parent) {
    parent.removeChild(next);
    if (tail && tail.nodeType === 3) parent.removeChild(tail);
  }
}

// ---------------------------------------------------------------------------
// table of contents check
// ---------------------------------------------------------------------------

type Target = { source: string; href: string };

function elementsOf(
  doc: XmlDocument,
  name: string,
  namespace?: string,
): XmlElement[] {
  return Array.from(doc.getElementsByTagNameNS(namespace ?? "*", name));
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function normalizePosix(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function dirnamePosix(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function collectTargets(entries: Record<string, Uint8Array>): Target[] {
  const targets: Target[] = [];
  for (const name of Object.keys(entries)) {
    if (name.toLowerCase().endsWith(".ncx")) {
      const doc = parseXml(entries[name]);
      for (const content of elementsOf(doc, "content", NCX_NS)) {
        const src = content.getAttribute("src");
        if (src) targets.push({ source: name, href: src });
      }
    }
    if (name.toLowerCase().endsWith("nav.xhtml")) {
      const doc = parseXml(entries[name]);
      for (const anchor of elementsOf(doc, "a")) {
        const href = anchor.getAttribute("href");
        if (href) targets.push({ source: name, href });
      }
    }
  }
  return targets;
}

function hasId(doc: XmlDocument, id: string): boolean {
  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    if (element.getAttribute("id") === id) return true;
  }
  return false;
}

function checkTargets(
  entries: Record<string, Uint8Array>,
  targets: Target[],
): string[] {
  const problems: string[] = [];
  for (const { source, href } of targets) {
    const [path, fragment] = href.split("#");
    const full =
      path === ""
        ? source
        : normalizePosix(`${dirnamePosix(source)}/${decodeHref(path)}`);

    const bytes = entries[full];
    if (!bytes) {
      problems.push(`${href}: file missing (${full})`);
      continue;
    }
    if (!fragment) continue;

    let doc: XmlDocument;
    try {
      doc = parseXml(bytes);
    } catch {
      problems.push(`${href}: unreadable (${full})`);
      continue;
    }
    if (!hasId(doc, decodeHref(fragment))) {
      problems.push(`${href}: anchor missing in ${full}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// parsing and serializing
// ---------------------------------------------------------------------------

function parseXml(bytes: Uint8Array): XmlDocument {
  const text = new TextDecoder("utf-8").decode(bytes);
  return new DOMParser({ onError: onErrorStopParsing }).parseFromString(
    text,
    "application/xhtml+xml",
  );
}

/** The namespace may be declared as the default or under a prefix. */
function declaresXhtmlNamespace(xml: string): boolean {
  for (const match of xml.matchAll(/\sxmlns(?::[\w.-]+)?=(["'])(.*?)\1/gu)) {
    if (match[2] === XHTML_NS) return true;
  }
  return false;
}

function serialize(doc: XmlDocument, hadDeclaration: boolean): Uint8Array {
  // xmldom keeps the original XML declaration as a node and re-emits it; only
  // add one when the source had none and the serializer dropped it.
  const body = new XMLSerializer()
    .serializeToString(doc)
    .replace(/^\uFEFF/, "")
    .replace(/^\s+/, "");
  const xml =
    hadDeclaration && !body.startsWith("<?xml")
      ? `<?xml version="1.0" encoding="utf-8"?>\n${body}`
      : body;

  // A missing XHTML namespace would be a silent, serious change.
  if (!declaresXhtmlNamespace(xml)) {
    throw new Error("serializer dropped the XHTML namespace");
  }
  return new TextEncoder().encode(xml);
}

function hasXmlDeclaration(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8")
    .decode(bytes.slice(0, 64))
    .replace(/^\uFEFF/u, "");
  return head.startsWith("<?xml");
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export function cleanEpub(input: Uint8Array): CleanResult {
  const report: CleanReport = {
    joins: [],
    tocProblemsBefore: [],
    tocProblemsAfter: [],
    changedFiles: [],
    blocked: false,
  };

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(input);
  } catch (error) {
    report.error = `cannot read epub: ${errorMessage(error)}`;
    return { output: null, report };
  }

  let targets: Target[];
  try {
    targets = collectTargets(entries);
    report.tocProblemsBefore = checkTargets(entries, targets);
  } catch (error) {
    report.error = `cannot read table of contents: ${errorMessage(error)}`;
    return { output: null, report };
  }

  const changed: Record<string, Uint8Array> = {};
  for (const name of Object.keys(entries)) {
    if (!XHTML_NAME_RE.test(name)) continue;
    const joinsBefore = report.joins.length;
    try {
      const result = cleanFile(name, entries[name], report.joins);
      if (result) {
        changed[name] = result;
        report.changedFiles.push(name);
      }
    } catch (error) {
      // One broken XHTML file must not be reported as a failed conversion.
      report.joins.length = joinsBefore;
      report.error = `cannot clean ${name}: ${errorMessage(error)}`;
      return { output: null, report };
    }
  }

  if (report.changedFiles.length > 0) {
    for (const [name, bytes] of Object.entries(changed)) entries[name] = bytes;
    report.tocProblemsAfter = checkTargets(entries, targets);
  } else {
    report.tocProblemsAfter = report.tocProblemsBefore;
  }

  // A target that resolved before and no longer resolves blocks the write. A
  // target that was already broken is reported but does not: cleaning must
  // never make things worse, and never be blamed for existing damage.
  const regressions = report.tocProblemsAfter.filter(
    (problem) => !report.tocProblemsBefore.includes(problem),
  );
  if (regressions.length > 0) {
    report.blocked = true;
    return { output: null, report };
  }
  if (report.changedFiles.length === 0) {
    return { output: null, report };
  }

  const zippable: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  // The mimetype entry must be first and uncompressed, even when the input
  // archive had it somewhere else.
  if (entries.mimetype) {
    zippable.mimetype = [entries.mimetype, { level: 0 }];
  }
  for (const name of Object.keys(entries)) {
    if (name === "mimetype") continue;
    zippable[name] = [entries[name], { level: 6 }];
  }

  try {
    return { output: zipSync(zippable), report };
  } catch (error) {
    report.error = `cannot rebuild epub: ${errorMessage(error)}`;
    return { output: null, report };
  }
}

/** Returns new bytes for one XHTML file, or null when no join happened. */
function cleanFile(
  name: string,
  bytes: Uint8Array,
  joins: Join[],
): Uint8Array | null {
  const doc = parseXml(bytes);
  const bodies = elementsOf(doc, "body", XHTML_NS);
  const body = bodies[0] ?? elementsOf(doc, "body")[0];
  if (!body) return null;

  const before = joins.length;
  let changed = true;
  while (changed) {
    changed = false;
    const paragraphs = Array.from(body.childNodes).filter(
      (node): node is XmlElement => node.nodeType === 1,
    );
    for (let index = 0; index + 1 < paragraphs.length; index++) {
      const previous = paragraphs[index];
      const next = paragraphs[index + 1];
      if (!joinCandidate(previous, next)) continue;

      joins.push({
        file: name,
        before: textOf(previous).trim().slice(-50),
        after: textOf(next).trim().slice(0, 40),
      });
      merge(previous, next);
      changed = true;
      break;
    }
  }

  if (joins.length === before) return null;
  return serialize(doc, hasXmlDeclaration(bytes));
}
