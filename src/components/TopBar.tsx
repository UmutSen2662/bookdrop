import {
  AlertTriangle,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isDark, setDark, subscribeTheme } from "@/lib/theme";
import type { QueueProgress } from "@/lib/useLibrary";
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

  return (
    <header className="border-b bg-background/90 backdrop-blur">
      <div className="flex h-14 w-full items-center gap-3 px-4">
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
            className="h-9 pl-8 pr-8"
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
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
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
              className="h-9 pl-8"
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

          {(needsReviewCount > 0 || needsReviewOnly) && (
            <Button
              variant={needsReviewOnly ? "default" : "outline"}
              size="sm"
              aria-pressed={needsReviewOnly}
              onClick={onToggleNeedsReview}
            >
              Needs review
              <span className="ml-0.5 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                {needsReviewCount}
              </span>
            </Button>
          )}

          {(missingCoverCount > 0 || missingCoverOnly) && (
            <Button
              variant={missingCoverOnly ? "default" : "outline"}
              size="sm"
              aria-pressed={missingCoverOnly}
              onClick={onToggleMissingCover}
            >
              Missing cover
              <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                {missingCoverCount}
              </span>
            </Button>
          )}

          {(flagged.length > 0 || missing.length > 0) && (
            <Popover open={attentionOpen} onOpenChange={onAttentionOpenChange}>
              <PopoverTrigger render={<Button variant="outline" size="sm" />}>
                <AlertTriangle
                  className="text-amber-600 dark:text-amber-400"
                  aria-hidden
                />
                Needs attention
                <span className="ml-0.5 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  {flagged.length + missing.length}
                </span>
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
