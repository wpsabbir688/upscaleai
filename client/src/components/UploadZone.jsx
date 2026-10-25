import { useRef, useState } from 'react';
import { UploadCloud, ImagePlus } from 'lucide-react';

export default function UploadZone({ onFiles, compact = false }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const accept = (files) => {
    const list = Array.from(files || []).filter((f) => f.type.startsWith('image/'));
    if (list.length > 0) onFiles(list);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload images"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        accept(e.dataTransfer.files);
      }}
      className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed px-6 text-center transition
        ${dragging
          ? 'border-[#42d9f5] bg-[#42d9f5]/10 shadow-[0_0_0_4px_rgba(66,217,245,0.15)]'
          : 'border-white/20 bg-white/[0.03] hover:border-white/40 hover:bg-white/[0.05]'}
        ${compact ? 'py-8' : 'py-12'}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => { accept(e.target.files); e.target.value = ''; }}
      />
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2563eb]/20 text-[#42d9f5]">
        {dragging ? <ImagePlus size={24} /> : <UploadCloud size={24} />}
      </span>
      <p className="font-display text-base font-bold text-white">
        {dragging ? 'Drop to upload' : (
          <>
            <span className="hidden sm:inline">Drag &amp; drop images here</span>
            <span className="sm:hidden">Tap to choose images</span>
          </>
        )}
      </p>
      <p className="text-sm text-slate-400">
        <span className="hidden sm:inline">or click to browse — you can also paste an image (Ctrl+V). </span>
        <span className="sm:hidden">Browse from your phone. </span>
        PNG, JPEG, WebP · max 10MB · longest side max 1024px.
      </p>
    </div>
  );
}
