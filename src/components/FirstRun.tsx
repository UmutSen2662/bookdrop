import { FolderOpen, LibraryBig } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";

type Props = {
  onChoose: () => Promise<void>;
};

export function FirstRun({ onChoose }: Props) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-8 text-card-foreground shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LibraryBig className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Bookdrop</h1>
            <p className="text-sm text-muted-foreground">
              Drop your ebooks in. Get one organized library with clean metadata
              and a reading log.
            </p>
          </div>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          Choose the folder your e-reader syncs from — usually the Dropbox or
          Syncthing folder. Nothing is created and nothing is moved until you
          pick one.
        </p>

        <div className="mt-6 flex items-center gap-2">
          <Button
            size="lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onChoose();
              } finally {
                setBusy(false);
              }
            }}
          >
            <FolderOpen aria-hidden />
            Choose library folder…
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          You can change it later from the settings gear. Books stay in the
          folder they were filed in.
        </p>
      </div>
    </div>
  );
}
