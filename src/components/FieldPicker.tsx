import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Input, Textarea } from "@/components/ui/input";
import { EYEBROW, FIELD_LABEL } from "@/components/ui/typography";
import { htmlToPlainText } from "@/lib/description";
import { sourceLabel } from "@/lib/format";
import { sanitizeHtml } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import type {
  CandidateField,
  CandidateSource,
  FieldCandidate,
} from "@/pipeline/types";

type Option = {
  value: string;
  source: CandidateSource;
  /** The row's current value, not one of the stored alternatives. */
  current: boolean;
};

type Props = {
  field: CandidateField;
  label: string;
  /** The value currently in the EPUB. */
  current: string;
  candidates: FieldCandidate[];
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  html?: boolean;
  /** Tells the sheet whether the value is custom text, not picked HTML. */
  onModeChange?: (custom: boolean) => void;
  /** Remove a remembered alternative. The current file value has no button. */
  onDelete?: (candidate: FieldCandidate) => void;
};

export function FieldPicker({
  field,
  label,
  current,
  candidates,
  value,
  onChange,
  multiline = false,
  html = false,
  onModeChange,
  onDelete,
}: Props) {
  const options = useMemo<Option[]>(() => {
    const seen = new Set<string>();
    const list: Option[] = [];
    if (current) {
      seen.add(current);
      list.push({ value: current, source: "file", current: true });
    }
    for (const candidate of candidates) {
      if (!candidate.value || seen.has(candidate.value)) continue;
      seen.add(candidate.value);
      list.push({
        value: candidate.value,
        source: candidate.source,
        current: false,
      });
    }
    return list;
  }, [current, candidates]);

  const startsCustom = !options.some((option) => option.value === value);
  const [custom, setCustom] = useState(startsCustom);
  // Kept separately from the committed field value so switching to a
  // candidate and back does not throw away what the user typed.
  const [draft, setDraft] = useState<string | null>(
    startsCustom ? value : null,
  );

  const selected = custom ? null : value;

  useEffect(() => {
    onModeChange?.(custom);
  }, [custom, onModeChange]);

  useEffect(() => {
    // A deleted candidate or an external reset can leave the value with no
    // matching option. Keep it visible and editable as custom text.
    if (!custom && !options.some((option) => option.value === value)) {
      setDraft(value);
      setCustom(true);
    }
  }, [custom, options, value]);

  useEffect(() => {
    if (!custom) return;
    // If the parent replaces the value while custom mode is open, follow it.
    setDraft((current) => (current === value ? current : value));
  }, [custom, value]);

  function enterCustom() {
    let next = draft;
    if (next === null) {
      next = html ? htmlToPlainText(value) : value;
      setDraft(next);
    }
    setCustom(true);
    if (next !== value) onChange(next);
  }

  function updateDraft(next: string) {
    setDraft(next);
    onChange(next);
  }

  return (
    <fieldset>
      <legend className={FIELD_LABEL}>{label}</legend>
      <div className="mt-1.5 overflow-hidden rounded-lg border">
        {options.map((option) => (
          <div
            key={`${option.source}:${option.value}`}
            className={cn(
              "flex items-start gap-2 border-b px-3 py-2.5 transition last:border-b-0 hover:bg-muted/40",
              selected === option.value && "bg-muted/55",
            )}
          >
            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name={field}
                checked={selected === option.value}
                onChange={() => {
                  setCustom(false);
                  onChange(option.value);
                }}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className={cn("block", EYEBROW)}>
                  {option.current
                    ? "In the file"
                    : option.source === "file"
                      ? "Original file"
                      : sourceLabel(option.source)}
                </span>
                {html ? (
                  <div
                    className="mt-1 max-h-24 overflow-hidden text-sm leading-relaxed text-foreground/90 [&_a]:underline [&_p:first-child]:mt-0 [&_p]:mt-1 [&_ul]:list-disc [&_ul]:pl-4"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(option.value),
                    }}
                  />
                ) : (
                  <span className="mt-0.5 block break-words text-sm">
                    {option.value}
                  </span>
                )}
              </span>
            </label>

            {!option.current && onDelete && (
              <button
                type="button"
                aria-label={`Remove ${
                  option.source === "file"
                    ? "original file"
                    : sourceLabel(option.source)
                } alternative`}
                title="Remove this alternative"
                onClick={() =>
                  onDelete({ value: option.value, source: option.source })
                }
                className="mt-0.5 rounded-md p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        ))}

        <label
          className={cn(
            "flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition hover:bg-muted/40",
            custom && "bg-muted/55",
          )}
        >
          <input
            type="radio"
            name={field}
            checked={custom}
            onChange={enterCustom}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span className="min-w-0 flex-1">
            <span className={cn("block", EYEBROW)}>Custom</span>
            <span className="mt-0.5 block text-sm">Type my own</span>
          </span>
        </label>

        {custom && (
          <div className="border-t bg-background/60 p-3">
            {multiline ? (
              <Textarea
                value={draft ?? value}
                onChange={(event) => updateDraft(event.target.value)}
                rows={5}
                placeholder={
                  html ? "First paragraph…\n\nSecond paragraph…" : undefined
                }
              />
            ) : (
              <Input
                value={draft ?? value}
                onChange={(event) => updateDraft(event.target.value)}
              />
            )}
            {html && (
              <p className="mt-1 text-xs text-muted-foreground">
                Blank line = new paragraph. Single lines stay line breaks.
              </p>
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}
