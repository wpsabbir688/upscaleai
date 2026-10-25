import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calculator, Layers, Sparkles, AlertTriangle, Archive } from 'lucide-react';
import UploadZone from '../components/UploadZone.jsx';
import CompareSlider from '../components/CompareSlider.jsx';
import JobCard from '../components/JobCard.jsx';
import {
  createJob, createBatch, listJobs, cancelJob,
  previewUrl, downloadUrl, batchZipUrl, estimateSeconds, formatDuration,
} from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { takePendingFile } from '../lib/transfer.js';

const DISABLED_SCALES = [6, 8, 10, 15, 20];

function readImageDims(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export default function Studio() {
  const { user, loading: authLoading, refresh: authRefresh } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [scale, setScale] = useState(4);
  const [staged, setStaged] = useState(null); // { file, w, h } before upload
  const [notice, setNotice] = useState(null); // { kind, text }
  const [uploading, setUploading] = useState(false);
  const [batch, setBatch] = useState(null); // { batchId, jobs, rejected }
  const pollingRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listJobs();
      // Keep the nav credit balance truthful (creation, refund on failure).
      authRefresh();
      setJobs(list);
      setSelected((prev) => {
        if (!prev) return list.find((j) => j.status === 'done') || null;
        const fresh = list.find((j) => j.id === prev.id);
        return fresh || prev;
      });
    } catch { /* server down: keep last state, banner below handles it */ }
  }, [authRefresh]);

  useEffect(() => { if (user) refresh(); }, [refresh, user]);

  // Poll while anything is queued/processing.
  useEffect(() => {
    const busy = jobs.some((j) => j.status === 'queued' || j.status === 'processing');
    if (busy && !pollingRef.current) {
      pollingRef.current = setInterval(refresh, 3000);
    } else if (!busy && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, [jobs, refresh]);

  // File handed over from the homepage hero dropzone.
  useEffect(() => {
    const f = takePendingFile();
    if (f) {
      readImageDims(f).then((dims) => setStaged({ file: f, w: dims?.w, h: dims?.h }));
    }
  }, []);

  // Clipboard paste anywhere on the studio page.
  useEffect(() => {
    const onPaste = (e) => {
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        e.preventDefault();
        handleFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  const handleFiles = async (files) => {
    setNotice(null);
    if (files.length === 1) {
      const dims = await readImageDims(files[0]);
      setStaged({ file: files[0], w: dims?.w, h: dims?.h });
      return;
    }
    // Batch: upload immediately, one job per file.
    setUploading(true);
    try {
      const res = await createBatch(files, scale);
      setBatch(res);
      if (res.rejected.length > 0) {
        setNotice({ kind: 'warn', text: `${res.rejected.length} file(s) rejected: ${res.rejected.map((x) => `${x.name} — ${x.error}`).join('; ')}` });
      }
      await refresh();
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    } finally {
      setUploading(false);
    }
  };

  const startSingle = async () => {
    if (!staged) return;
    setUploading(true);
    setNotice(null);
    try {
      const job = await createJob(staged.file, scale);
      setStaged(null);
      setSelected(job);
      await refresh();
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    } finally {
      setUploading(false);
    }
  };

  const doCancel = async (id) => {
    try {
      await cancelJob(id);
      await refresh();
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    }
  };

  const stagedEstimate = staged?.w
    ? { outW: staged.w * scale, outH: staged.h * scale, sec: estimateSeconds(staged.w, staged.h, scale) }
    : null;

  // Stable preview URL for the staged file (creating one per render leaks
  // URLs and reloads the image on every state change).
  const stagedUrl = useMemo(() => {
    if (!staged) return null;
    const url = URL.createObjectURL(staged.file);
    return url;
  }, [staged]);
  useEffect(() => () => { if (stagedUrl) URL.revokeObjectURL(stagedUrl); }, [stagedUrl]);

  if (!authLoading && !user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <h1 className="font-display text-3xl font-extrabold text-white">Log in to use the studio</h1>
        <p className="mt-2 text-slate-400">
          The studio requires an account so your jobs, files, and credits stay private.
          New accounts start with 10 free credits.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/login" className="inline-flex min-h-11 items-center rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8]">Log in</Link>
          <Link to="/register" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10">Create account</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft size={15} /> Back home
      </Link>
      <h1 className="font-display mt-4 text-3xl font-extrabold text-white sm:text-4xl">
        AI Upscaler Studio
      </h1>
      <p className="mt-1 max-w-2xl text-slate-400">
        Real Real-ESRGAN x4plus processing on CPU. Jobs run one at a time and take minutes —
        larger images are processed in tiles. AI-generated detail is approximate, not a
        guaranteed recovery of original detail.
      </p>
      {user && (
        <p className="mt-2 text-sm text-slate-300">
          Credits: <span className="font-bold text-white">{user.credits}</span>
          <span className="text-slate-500"> · 2x costs 1 credit, 4x costs 2 credits · failed or cancelled jobs refund automatically</span>
        </p>
      )}

      {notice && (
        <div className={`mt-4 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${notice.kind === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{notice.text}</span>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Left: upload + settings */}
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-display text-lg font-bold text-white">1 · Upload</h2>
            <div className="mt-3">
              <UploadZone onFiles={handleFiles} compact />
            </div>
            {staged && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3">
                <div className="flex items-center gap-3">
                  <img src={stagedUrl} alt="Staged upload"
                    className="h-16 w-16 rounded-xl border border-white/10 object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{staged.file.name}</p>
                    <p className="text-xs text-slate-400">
                      {staged.w ? `${staged.w}×${staged.h}` : 'Reading dimensions…'}
                      {' · '}{(staged.file.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                </div>
                <button type="button" onClick={startSingle} disabled={uploading}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50">
                  <Sparkles size={16} /> {uploading ? 'Uploading…' : `Enhance at ${scale}x`}
                </button>
                <button type="button" onClick={() => setStaged(null)}
                  className="mt-2 w-full text-xs text-slate-400 hover:text-white">Clear</button>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-display text-lg font-bold text-white">2 · Scale</h2>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Upscale factor">
              {[2, 4].map((s) => (
                <button key={s} type="button" role="radio" aria-checked={scale === s}
                  onClick={() => setScale(s)}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-semibold ${scale === s ? 'bg-[#2563eb] text-white' : 'border border-white/15 text-slate-300 hover:bg-white/10'}`}>
                  {s}x
                </button>
              ))}
              {DISABLED_SCALES.map((s) => (
                <button key={s} type="button" disabled title="Higher scales need staged upscaling, which has not been benchmarked on CPU yet."
                  className="inline-flex min-h-11 cursor-not-allowed items-center rounded-full border border-white/10 px-4 py-2 text-sm text-slate-600">
                  {s}x
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              2x is derived from the native 4x model output (downsampled), not a separate 2x model.
              6x and above are disabled until staged upscaling is benchmarked.
            </p>
            <p className="mt-1 text-xs text-slate-500">Model: Real-ESRGAN x4plus · face restoration and denoise are not included in v1 — no compatible model is bundled, so no such controls are shown.</p>
          </section>

          {stagedEstimate && (
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
                <Calculator size={18} /> Resolution calculator
              </h2>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-slate-400">Input</dt><dd className="text-white">{staged.w}×{staged.h}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">Output at {scale}x</dt><dd className="text-white">{stagedEstimate.outW}×{stagedEstimate.outH}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">Est. processing time</dt><dd className="text-white">{formatDuration(stagedEstimate.sec)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">Est. peak memory</dt><dd className="text-white">{Math.max(staged.w, staged.h) <= 256 ? '~1.2 GB' : '~1.6 GB (tiled)'}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-slate-500">Estimates come from the CPU benchmark in the README; actual time varies with image content and server load.</p>
            </section>
          )}

          {batch && (
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
                <Archive size={18} /> Batch {batch.batchId.slice(0, 8)}
              </h2>
              <p className="mt-1 text-sm text-slate-400">{batch.jobs.length} job(s) created.</p>
              <a href={batchZipUrl(batch.batchId)}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8]">
                <Archive size={15} /> Download ZIP of completed
              </a>
              <p className="mt-1 text-xs text-slate-500">The ZIP includes only completed images; failed jobs are listed in a notes file inside it.</p>
            </section>
          )}
        </div>

        {/* Right: compare + job list */}
        <div className="space-y-6 lg:col-span-3">
          {selected?.status === 'done' ? (
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="font-display text-lg font-bold text-white">Compare &amp; download</h2>
              <p className="mt-1 text-sm text-slate-400">
                {selected.originalName} · {selected.inputW}×{selected.inputH} → {selected.outputW}×{selected.outputH}
              </p>
              <div className="mt-4">
                <CompareSlider
                  originalUrl={previewUrl(selected.id, 'input')}
                  enhancedUrl={previewUrl(selected.id, 'output')}
                  alt={selected.originalName}
                />
              </div>
              <a href={downloadUrl(selected.id)}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8]">
                Download enhanced PNG
              </a>
            </section>
          ) : (
            <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
              <p className="text-slate-400">
                {jobs.some((j) => j.status === 'queued' || j.status === 'processing')
                  ? 'A job is processing — its result will appear here when done. Select a completed job below to compare it.'
                  : 'Upload an image and enhance it — the before/after comparison will appear here.'}
              </p>
            </section>
          )}

          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
              <Layers size={18} /> Jobs
            </h2>
            {jobs.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No jobs yet. Files are kept for 24 hours, then deleted automatically.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {jobs.map((job) => (
                  <JobCard key={job.id} job={job}
                    selected={selected?.id === job.id}
                    onSelect={setSelected} onCancel={doCancel} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
