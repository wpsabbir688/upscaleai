import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';

// Before/After comparison: the original (left) and the enhanced image
// (right) are shown at the SAME display size so detail can be compared.
// Divider drags with pointer events; when zoomed, dragging the image pans.
export default function CompareSlider({ originalUrl, enhancedUrl, alt = 'Comparison' }) {
  const rootRef = useRef(null);
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragRef = useRef(null);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const posFromClientX = useCallback((clientX) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(96, Math.max(4, p)));
  }, []);

  const onPointerDown = (e) => {
    const target = e.target;
    const isHandle = target.closest('[data-handle="true"]');
    if (isHandle) {
      dragRef.current = { kind: 'divider' };
      target.setPointerCapture?.(e.pointerId);
    } else if (zoom > 1) {
      dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, pan: { ...pan } };
    }
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'divider') posFromClientX(e.clientX);
    else if (d.kind === 'pan') {
      setPan({ x: d.pan.x + (e.clientX - d.startX), y: d.pan.y + (e.clientY - d.startY) });
    }
  };

  const endDrag = () => { dragRef.current = null; };

  // Wheel zoom (non-passive so the page does not scroll while zooming).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      setZoom((z) => Math.min(4, Math.max(1, z + (e.deltaY < 0 ? 0.25 : -0.25))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const reset = () => {
    setPos(50);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.();
  };

  const imgStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: 'center',
  };

  return (
    <div className="w-full">
      <div
        ref={rootRef}
        data-testid="compare-slider"
        className="compare-root relative aspect-[4/3] w-full overflow-hidden rounded-3xl border border-white/10 bg-black/40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Enhanced (right / base layer) */}
        <img src={enhancedUrl} alt={`${alt} enhanced`} draggable={false}
          className="absolute inset-0 h-full w-full object-contain" style={imgStyle} />
        {/* Original (left layer, clipped to the divider). Both layers stay
            full-size so the two images align exactly; only the clip moves. */}
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <img src={originalUrl} alt={`${alt} original`} draggable={false}
            className="absolute inset-0 h-full w-full object-contain" style={imgStyle} />
        </div>
        {/* Divider */}
        <div className="absolute inset-y-0 z-10" style={{ left: `${pos}%` }}>
          <div className="absolute inset-y-0 -left-px w-0.5 bg-white/90 shadow" />
          <button
            type="button"
            data-handle="true"
            aria-label="Drag to compare"
            className="absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-white/60 bg-[#0b1020]/90 text-sm font-bold text-white shadow-lg"
          >
            ↔
          </button>
        </div>
        <span className="absolute left-3 top-3 z-10 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">Original</span>
        <span className="absolute right-3 top-3 z-10 rounded-full bg-[#2563eb]/90 px-3 py-1 text-xs font-semibold text-white">Enhanced</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
          className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
          <ZoomIn size={15} /> Zoom in
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
          className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
          <ZoomOut size={15} /> Zoom out
        </button>
        <span className="text-sm text-slate-400" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={reset}
          className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
          <RotateCcw size={15} /> Reset
        </button>
        <button type="button" onClick={toggleFullscreen}
          className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
          <Maximize size={15} /> {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
        <span className="ml-auto hidden text-xs text-slate-500 sm:block">
          Drag the handle to compare · scroll to zoom · drag image to pan when zoomed
        </span>
      </div>
    </div>
  );
}
