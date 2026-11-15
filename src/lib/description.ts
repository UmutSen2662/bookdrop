/**
 * The description field's custom mode is plain text. Blank lines become
 * paragraphs; single line breaks stay line breaks. Existing HTML is turned
 * back into readable text when the user chooses "Type my own".
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

/** `First\n\nSecond` -> `<p>First</p><p>Second</p>` */
export function textToParagraphHtml(text: string): string {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return "";

  return normalized
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/gu, "<br />")}</p>`,
    )
    .join("");
}

/** `<p>First</p><p>Second</p>` -> `First\n\nSecond` */
export function htmlToPlainText(html: string): string {
  if (!html) return "";

  if (typeof document === "undefined") {
    return html
      .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/giu, " ")
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<\/(?:p|div|li|blockquote|h[1-4])>/giu, "\n\n")
      .replace(/<[^>]*>/gu, "")
      .replace(/&nbsp;/giu, " ")
      .replace(/&quot;/giu, '"')
      .replace(/&#39;/giu, "'")
      .replace(/&lt;/giu, "<")
      .replace(/&gt;/giu, ">")
      .replace(/&amp;/giu, "&")
      .replace(/\n{3,}/gu, "\n\n")
      .replace(/[ \t]+\n/gu, "\n")
      .trim();
  }

  const parsed = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  const root = parsed.body.firstElementChild;
  if (!root) return "";

  for (const unsafe of Array.from(
    root.querySelectorAll("script, style, iframe"),
  )) {
    unsafe.remove();
  }
  for (const br of Array.from(root.querySelectorAll("br"))) {
    br.replaceWith("\n");
  }
  for (const block of Array.from(
    root.querySelectorAll("p, div, li, blockquote, h1, h2, h3, h4"),
  )) {
    block.append("\n\n");
  }

  return (root.textContent ?? "")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]+\n/gu, "\n")
    .trim();
}
