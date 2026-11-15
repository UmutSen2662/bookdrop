import { X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { canonicalTags, parseTags, serializeTags } from "../lib/tags";

type Props = {
  /** The stored comma-separated value. */
  value: string;
  /** Every tag already used in the library, for quick reuse. */
  suggestions: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * Tag pills. Enter or comma adds a tag, Backspace removes the last one, and
 * typing shows tags already used elsewhere in the library. Commas are not
 * allowed inside a tag because calibre's `--tags` uses them as the separator.
 */
export function TagEditor({ value, suggestions, onChange, disabled }: Props) {
  const tags = useMemo(() => canonicalTags(parseTags(value)), [value]);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function commit(raw: string) {
    const additions = parseTags(raw);
    setDraft("");
    if (additions.length === 0) return;
    onChange(serializeTags([...tags, ...additions]));
  }

  function update(next: string) {
    if (!next.includes(",")) {
      setDraft(next);
      return;
    }
    const parts = next.split(",");
    const tail = parts.pop() ?? "";
    const additions = parts.filter((part) => part.trim());
    if (additions.length > 0) {
      onChange(serializeTags([...tags, ...additions]));
    }
    setDraft(tail);
  }

  function remove(tag: string) {
    const key = tag.toLocaleLowerCase("en-US");
    onChange(
      serializeTags(
        tags.filter((entry) => entry.toLocaleLowerCase("en-US") !== key),
      ),
    );
  }

  const available = useMemo(() => {
    if (!focused && !draft.trim()) return [];
    const selected = new Set(tags.map((tag) => tag.toLocaleLowerCase("en-US")));
    const term = draft.trim().toLocaleLowerCase("en-US");
    return suggestions
      .filter(
        (tag) =>
          !selected.has(tag.toLocaleLowerCase("en-US")) &&
          (!term || tag.toLocaleLowerCase("en-US").includes(term)),
      )
      .slice(0, 8);
  }, [draft, focused, suggestions, tags]);

  return (
    <div>
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          disabled && "pointer-events-none opacity-50",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/60 py-0.5 pl-2.5 pr-1 text-xs"
          >
            <span className="truncate">{tag}</span>
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              title="Remove"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                remove(tag);
              }}
              className="rounded-full p-0.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => update(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit(draft);
            } else if (
              event.key === "Backspace" &&
              draft === "" &&
              tags.length > 0
            ) {
              event.preventDefault();
              remove(tags[tags.length - 1]);
            }
          }}
          placeholder={tags.length === 0 ? "Add a tag…" : "Add…"}
          aria-label="Add a tag"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {available.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            In your library
          </span>
          {available.map((tag) => (
            <button
              key={tag}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(serializeTags([...tags, tag]));
                inputRef.current?.focus();
              }}
              className="rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground transition hover:border-solid hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              + {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
