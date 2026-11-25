import { X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const FRAME_WIDTH = 300;
const FRAME_HEIGHT = 450;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const OUTPUT_WIDTH = 1200;
const OUTPUT_HEIGHT = 1800;

type Size = { width: number; height: number };
type Offset = { x: number; y: number };

type Props = {
  imageUrl: string;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
};

function clampOffset(
  x: number,
  y: number,
  displayWidth: number,
  displayHeight: number,
): Offset {
  const clampAxis = (value: number, frame: number, display: number) =>
    display <= frame
      ? (frame - display) / 2
      : Math.min(0, Math.max(frame - display, value));
  return {
    x: clampAxis(x, FRAME_WIDTH, displayWidth),
    y: clampAxis(y, FRAME_HEIGHT, displayHeight),
  };
}

export function CoverCrop({ imageUrl, onCancel, onApply }: Props) {
  const [size, setSize] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
  } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const base =
    size === null
      ? 0
      : Math.max(FRAME_WIDTH / size.width, FRAME_HEIGHT / size.height);
  const scale = base * zoom;
  const displayWidth = size ? size.width * scale : 0;
  const displayHeight = size ? size.height * scale : 0;

  function applyZoom(next: number) {
    if (!size) return;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const oldScale = base * zoomRef.current;
    const newScale = base * clamped;
    if (oldScale <= 0) return;
    const centerX = (FRAME_WIDTH / 2 - offset.x) / oldScale;
    const centerY = (FRAME_HEIGHT / 2 - offset.y) / oldScale;
    const width = size.width * newScale;
    const height = size.height * newScale;
    zoomRef.current = clamped;
    setZoom(clamped);
    setOffset(
      clampOffset(
        FRAME_WIDTH / 2 - centerX * newScale,
        FRAME_HEIGHT / 2 - centerY * newScale,
        width,
        height,
      ),
    );
  }

  const applyZoomRef = useRef(applyZoom);
  applyZoomRef.current = applyZoom;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 0.92;
      applyZoomRef.current(zoomRef.current * factor);
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  function onImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const natural = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    if (natural.width === 0 || natural.height === 0) return;
    const fit = Math.max(
      FRAME_WIDTH / natural.width,
      FRAME_HEIGHT / natural.height,
    );
    setSize(natural);
    setZoom(1);
    setOffset({
      x: (FRAME_WIDTH - natural.width * fit) / 2,
      y: (FRAME_HEIGHT - natural.height * fit) / 2,
    });
  }

  async function exportCrop() {
    const image = imageRef.current;
    if (!image || !size || scale <= 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      -offset.x / scale,
      -offset.y / scale,
      FRAME_WIDTH / scale,
      FRAME_HEIGHT / scale,
      0,
      0,
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT,
    );
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.9);
    });
    if (blob) onApply(blob);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent showCloseButton={false} size="md">
        <div className="flex items-center justify-between">
          <DialogTitle>Crop cover</DialogTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel"
            onClick={onCancel}
          >
            <X aria-hidden />
          </Button>
        </div>

        <div
          ref={frameRef}
          style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}
          className={cn(
            "relative mx-auto mt-4 touch-none overflow-hidden rounded-lg border bg-muted select-none",
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              x: event.clientX,
              y: event.clientY,
              ox: offset.x,
              oy: offset.y,
            };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            setOffset(
              clampOffset(
                drag.ox + (event.clientX - drag.x),
                drag.oy + (event.clientY - drag.y),
                displayWidth,
                displayHeight,
              ),
            );
          }}
          onPointerUp={(event) => {
            dragRef.current = null;
            setDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setDragging(false);
          }}
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt=""
            draggable={false}
            onLoad={onImageLoad}
            onError={() => setFailed(true)}
            className="absolute max-w-none"
            style={{
              left: offset.x,
              top: offset.y,
              width: displayWidth || undefined,
              height: displayHeight || undefined,
            }}
          />
          {failed && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted px-4 text-center text-xs text-muted-foreground">
              Could not read that image.
            </div>
          )}
        </div>

        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Drag to pan · scroll or use the slider to zoom
        </p>

        <div className="mt-3 flex items-center gap-2">
          <ZoomOut className="size-4 text-muted-foreground" aria-hidden />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(event) => applyZoom(Number(event.target.value))}
            className="h-1.5 flex-1 accent-foreground"
            aria-label="Zoom"
          />
          <ZoomIn className="size-4 text-muted-foreground" aria-hidden />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => void exportCrop()} disabled={!size}>
            Use this crop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
