import { Download, X, Loader2, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { previewUrl, downloadUrl } from '../lib/api.js';

const STATUS_STYLE = {
  queued: 'bg-amber-500/15 text-amber-300',
  processing: 'bg-sky-500/15 text-sky-300',
  done: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
  cancelled: 'bg-white/10 text-slate-400',
};

export default function JobCard({ job, selected, onSelect, onCancel }) {
  const busy = job.status === 'queued' || job.status === 'processing';
  return (
    <div
      className={`rounded-2xl border p-3 transition ${selected ? 'border-[#42d9f5]/60 bg-[#42d9f5]/5' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
    >
      <div className="flex items-start gap-3">
        <img
          src={previewUrl(job.id, 'input')}
          alt={job.originalName}
          className="h-16 w-16 shrink-0 rounded-xl border border-white/10 object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white" title={job.originalName}>
            {job.originalName}
          </p>
          <p className="text-xs text-slate-400">
            {job.inputW}×{job.inputH} → {job.status === 'done' ? `${job.outputW}×${job.outputH}` : `${job.scale}x`}
            {' · '}scale {job.scale}x
          </p>
          <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[job.status] || ''}`}>
            {job.status === 'processing' && <Loader2 size={12} className="animate-spin" />}
            {job.status === 'done' && <CheckCircle2 size={12} />}
            {job.status === 'failed' && <AlertTriangle size={12} />}
            {job.status === 'queued' && <Clock size={12} />}
            {job.status === 'processing' ? 'Processing…' : job.status}
          </span>
          {job.status === 'processing' && (
            <p className="mt-1 text-xs text-slate-500">
              Real AI processing on CPU — this takes minutes. Progress is indeterminate; no percentage is estimated.
            </p>
          )}
          {job.status === 'failed' && job.error && (
            <p className="mt-1 text-xs text-red-300/90">{job.error}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {job.status === 'done' && (
          <>
            <button type="button" onClick={() => onSelect(job)}
              className="rounded-full bg-[#2563eb] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8]">
              Compare
            </button>
            <a href={downloadUrl(job.id)}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/10">
              <Download size={13} /> Download
            </a>
          </>
        )}
        {busy && (
          <button type="button" onClick={() => onCancel(job.id)}
            className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/10">
            <X size={13} /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}
