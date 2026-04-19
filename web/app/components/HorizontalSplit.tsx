import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

interface HorizontalSplitProps {
  left: ReactNode;
  right: ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
}

/**
 * HorizontalSplit renders a two-pane horizontal layout with a draggable
 * splitter between the left (fixed-pixel) and right (flex) panels.
 *
 * Left-panel width is held in component state and is intentionally NOT
 * persisted — on every mount it resets to `defaultLeftWidth`. The splitter
 * supports mouse drag as well as ArrowLeft/ArrowRight keyboard adjustment
 * while focused.
 */
export default function HorizontalSplit({
  left,
  right,
  defaultLeftWidth = 420,
  minLeftWidth = 240,
  maxLeftWidth = 800,
}: Readonly<HorizontalSplitProps>) {
  const [leftWidth, setLeftWidth] = useState<number>(defaultLeftWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<boolean>(false);

  const clamp = useCallback(
    (value: number) => {
      if (value < minLeftWidth) return minLeftWidth;
      if (value > maxLeftWidth) return maxLeftWidth;
      return value;
    },
    [minLeftWidth, maxLeftWidth],
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      draggingRef.current = true;

      const previousUserSelect = document.body.style.userSelect;
      const previousCursor = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (e: MouseEvent) => {
        if (!draggingRef.current) return;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const next = clamp(e.clientX - rect.left);
        setLeftWidth(next);
      };

      const onUp = () => {
        draggingRef.current = false;
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clamp],
  );

  // Safety: if the component unmounts mid-drag, ensure body styles are not
  // left in a resize state. The onUp handler above also removes listeners,
  // but this guards against unmount during an active drag.
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 32 : 8;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setLeftWidth((w) => clamp(w - step));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setLeftWidth((w) => clamp(w + step));
      }
    },
    [clamp],
  );

  return (
    <div ref={containerRef} className="flex w-full h-full min-h-0">
      <div
        style={{ width: leftWidth }}
        className="shrink-0 min-w-0 h-full overflow-hidden"
      >
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={leftWidth}
        aria-valuemin={minLeftWidth}
        aria-valuemax={maxLeftWidth}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        className="shrink-0 w-1.5 cursor-col-resize bg-gray-200 hover:bg-gray-300 focus:bg-gray-400 focus:outline-none transition-colors"
      />
      <div className="flex-1 min-w-0 h-full overflow-hidden">{right}</div>
    </div>
  );
}
