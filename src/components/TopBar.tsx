import {
  ArrowUpDown,
  Loader2,
  Moon,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { NeedsAttention } from "@/components/NeedsAttention";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EYEBROW } from "@/components/ui/typography";
import { isDark, setDark, subscribeTheme } from "@/lib/theme";
import type { QueueProgress } from "@/lib/useLibrary";
import { cn } from "@/lib/utils";
import type { SortBy } from "@/pipeline/config";
import type { Book } from "@/pipeline/types";

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "author", label: "Author A–Z" },
  { value: "title", label: "Title A–Z" },
  { value: "added", label: "Recently added" },
  { value: "published", label: "Published (newest)" },
  { value: "series", label: "Series" },
];

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  sortBy: SortBy;
  onSortChange: (value: SortBy) => void;
  needsReviewOnly: boolean;
  needsReviewCount: number;
  onToggleNeedsReview: () => void;
  missingCoverOnly: boolean;
  missingCoverCount: number;
  onToggleMissingCover: () => void;
  flagged: Book[];
  missing: Book[];
  attentionOpen: boolean;
  onAttentionOpenChange: (open: boolean) => void;
  onShow: (book: Book) => void;
  onRetry: (book: Book) => void;
  onDismiss: (book: Book) => void;
  onOpenSettings: () => void;
  queue: QueueProgress | null;
};

export function TopBar({
  query,
  onQueryChange,
  searchRef,
  sortBy,
  onSortChange,
  needsReviewOnly,
  needsReviewCount,
  onToggleNeedsReview,
  missingCoverOnly,
  missingCoverCount,
  onToggleMissingCover,
  flagged,
  missing,
  attentionOpen,
  onAttentionOpenChange,
  onShow,
  onRetry,
  onDismiss,
  onOpenSettings,
  queue,
}: Props) {
  const [dark, setDarkState] = useState(isDark);

  useEffect(() => subscribeTheme(setDarkState), []);

  function toggleDark() {
    setDark(!dark);
  }

  const reviewActive = needsReviewOnly || missingCoverOnly;
  const showReview =
    reviewActive || needsReviewCount > 0 || missingCoverCount > 0;

  return (
    <header className="border-b bg-background/90 backdrop-blur">
      <div className="flex h-14 w-full items-center gap-3 px-5">
        <div className="relative w-full min-w-0 max-w-md">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search title or author…"
            aria-label="Search the library"
            className="h-8 pl-8 pr-8"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                onQueryChange("");
                searchRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <div className="relative shrink-0">
          <ArrowUpDown
            className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Select
            items={SORT_OPTIONS}
            value={sortBy}
            onValueChange={(value) => value && onSortChange(value as SortBy)}
          >
            <SelectTrigger
              aria-label="Sort the library"
              title="Sort the library"
              className="h-8 pl-8"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {queue && (
            <span className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {queue.done} of {queue.total}
            </span>
          )}

          {showReview && (
            <ReviewMenu
              needsReviewCount={needsReviewCount}
              needsReviewOnly={needsReviewOnly}
              onToggleNeedsReview={onToggleNeedsReview}
              missingCoverCount={missingCoverCount}
              missingCoverOnly={missingCoverOnly}
              onToggleMissingCover={onToggleMissingCover}
            />
          )}

          {(flagged.length > 0 || missing.length > 0) && (
            <Popover open={attentionOpen} onOpenChange={onAttentionOpenChange}>
              <PopoverTrigger render={<Button variant="outline" />}>
                Needs attention
                <Badge tone="warning" className="ml-0.5">
                  {flagged.length + missing.length}
                </Badge>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[22rem] gap-0 p-0">
                <NeedsAttention
                  flagged={flagged}
                  missing={missing}
                  onShow={onShow}
                  onRetry={onRetry}
                  onDismiss={onDismiss}
                  onClose={() => onAttentionOpenChange(false)}
                />
              </PopoverContent>
            </Popover>
          )}

          <Button
            variant="ghost"
            size="icon"
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleDark}
          >
            {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            title="Settings"
            onClick={onOpenSettings}
          >
            <Settings aria-hidden />
          </Button>
        </div>
      </div>
    </header>
  );
}

function ReviewMenu({
  needsReviewCount,
  needsReviewOnly,
  onToggleNeedsReview,
  missingCoverCount,
  missingCoverOnly,
  onToggleMissingCover,
}: {
  needsReviewCount: number;
  needsReviewOnly: boolean;
  onToggleNeedsReview: () => void;
  missingCoverCount: number;
  missingCoverOnly: boolean;
  onToggleMissingCover: () => void;
}) {
  const active = needsReviewOnly || missingCoverOnly;
  const total = needsReviewCount + missingCoverCount;

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant={active ? "default" : "outline"} />}
      >
        Review
        <Badge tone={active ? "neutral" : "warning"} className="ml-0.5">
          {total}
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-0 p-0">
        <div className="border-b px-3 py-2">
          <PopoverTitle className={EYEBROW}>Review</PopoverTitle>
        </div>
        <div className="p-1.5">
          <ReviewRow
            label="Needs review"
            count={needsReviewCount}
            checked={needsReviewOnly}
            onChange={onToggleNeedsReview}
            tone="warning"
          />
          <ReviewRow
            label="Missing cover"
            count={missingCoverCount}
            checked={missingCoverOnly}
            onChange={onToggleMissingCover}
          />
        </div>
        {active && (
          <div className="border-t p-1.5">
            <Button
              size="xs"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                if (needsReviewOnly) onToggleNeedsReview();
                if (missingCoverOnly) onToggleMissingCover();
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ReviewRow({
  label,
  count,
  checked,
  onChange,
  tone = "neutral",
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
  tone?: "neutral" | "warning";
}) {
  const disabled = count === 0 && !checked;
  const id = `review-${label.toLowerCase().replace(/ /g, "-")}`;

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:bg-muted/50",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={() => onChange()}
      />
      <span className="flex-1">{label}</span>
      <Badge tone={tone}>{count}</Badge>
    </label>
  );
}
