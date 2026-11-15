/**
 * Descriptions are HTML from calibre or a provider. They are never injected
 * raw. The webview path parses the fragment and keeps a small allowlist; the
 * non-DOM fallback (tests, SSR) returns escaped text.
 */

const ALLOWED = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "SPAN",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "A",
  "SUB",
  "SUP",
]);

const REMOVE = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "MATH",
  "FORM",
  "INPUT",
  "TEXTAREA",
  "BUTTON",
  "SELECT",
  "OPTION",
  "IMG",
  "VIDEO",
  "AUDIO",
  "SOURCE",
  "LINK",
  "META",
  "BASE",
  "TEMPLATE",
]);

const SAFE_HREF = /^https?:\/\//iu;

function clean(parent: Element): void {
  for (const child of Array.from(parent.children)) {
    const tag = child.tagName.toUpperCase();
    if (REMOVE.has(tag)) {
      child.remove();
      continue;
    }
    if (!ALLOWED.has(tag)) {
      // Unwrap unknown formatting elements, keeping their text.
      const owner = child.parentNode;
      if (!owner) continue;
      while (child.firstChild) owner.insertBefore(child.firstChild, child);
      owner.removeChild(child);
      // The moved children were not in the snapshot; start over.
      clean(parent);
      return;
    }

    for (const attribute of Array.from(child.attributes)) {
      if (tag === "A" && attribute.name.toLowerCase() === "href") {
        if (!SAFE_HREF.test(attribute.value.trim())) {
          child.removeAttribute(attribute.name);
        }
      } else {
        child.removeAttribute(attribute.name);
      }
    }
    if (tag === "A" && child.hasAttribute("href")) {
      child.setAttribute("target", "_blank");
      child.setAttribute("rel", "noopener noreferrer");
    }
    clean(child);
  }
}

function escapedText(html: string): string {
  const text = html
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  if (typeof document === "undefined") return escapedText(html);

  const parsed = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  const root = parsed.body.firstElementChild;
  if (!root) return "";
  clean(root);
  return root.innerHTML;
}
