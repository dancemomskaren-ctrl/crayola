import { createSignal, For, Show } from "solid-js";

type Caption = { text: string; startMs: number; endMs: number };
type Candidate = Caption & { id: string; score: number; selected?: boolean; note?: string; captions?: Caption[] };
export default function ClipReview(props: { batchId: string; candidates: Candidate[]; transcript: Caption[]; onApproved: () => void; onDiscard: () => void }) {
  const [clips, setClips] = createSignal(props.candidates.map(c => ({ ...c, selected: false })));
  const [confirmed, setConfirmed] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let player!: HTMLVideoElement;
  let previewEnd = Infinity;
  function update(id: string, patch: Partial<Candidate>) {
    setClips(clips().map(c => c.id === id ? { ...c, ...patch } : c));
    setConfirmed(false);
  }
  function textFor(c: Candidate, context = 0) {
    return props.transcript.filter(w => w.endMs > c.startMs - context && w.startMs < c.endMs + context).map(w => w.text).join(" ");
  }
  async function approve() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/batch/${props.batchId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: clips().filter(c => c.selected), contextConfirmed: confirmed() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      props.onApproved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return <section class="bg-zinc-900 border border-zinc-700 rounded-xl p-6 mb-8 space-y-4">
    <h2 class="text-xl font-semibold">Review the message before rendering</h2>
    <p class="text-sm text-zinc-400">These are suggested excerpts, not theological assessments. Listen to the surrounding context and check that the speaker’s meaning and conclusion are preserved.</p>
    <video ref={player} controls preload="metadata" class="w-full max-h-80 bg-black" src={`/api/batch/${props.batchId}/source`}
      onTimeUpdate={() => { if (player.currentTime >= previewEnd) { player.pause(); previewEnd = Infinity; } }} />
    <For each={clips()}>{c => <div class="border border-zinc-700 rounded-lg p-4 space-y-3">
      <label class="flex gap-3"><input type="checkbox" checked={c.selected} onChange={e => update(c.id, { selected: e.currentTarget.checked })} />Include this excerpt</label>
      <p class="text-sm">{textFor(c)}</p>
      <details class="text-sm text-zinc-400"><summary>Read surrounding context (15 seconds each side)</summary><p>{textFor(c, 15000)}</p></details>
      <div class="flex flex-wrap gap-3 items-center">
        <label>Start (s) <input class="bg-zinc-800 w-24 p-1" type="number" min="0" step="0.1" value={c.startMs / 1000}
          onChange={e => update(c.id, { startMs: Number(e.currentTarget.value) * 1000, captions: undefined })} /></label>
        <label>End (s) <input class="bg-zinc-800 w-24 p-1" type="number" min="0" step="0.1" value={c.endMs / 1000}
          onChange={e => update(c.id, { endMs: Number(e.currentTarget.value) * 1000, captions: undefined })} /></label>
        <button class="bg-zinc-700 rounded px-3 py-1" onClick={() => { player.currentTime = Math.max(0, c.startMs / 1000 - 10); previewEnd = c.endMs / 1000 + 10; void player.play(); }}>Listen with context</button>
      </div>
      <label class="block text-sm">Review note<input class="block bg-zinc-800 p-2 w-full mt-1" placeholder="Why this excerpt works; any context concerns" value={c.note ?? ""}
        onChange={e => update(c.id, { note: e.currentTarget.value })} /></label>
      <details><summary class="text-sm cursor-pointer">Correct caption text</summary>
        <button class="text-sm underline my-2" onClick={() => update(c.id, { captions: props.transcript.filter(w => w.endMs > c.startMs && w.startMs < c.endMs).map(w => ({ text: w.text, startMs: Math.max(0, w.startMs - c.startMs), endMs: Math.min(c.endMs - c.startMs, w.endMs - c.startMs) })) })}>Load editable words</button>
        <p class="text-xs text-zinc-400">Caption times are relative to the excerpt. Changing excerpt boundaries resets edits. Silence removal is skipped when custom captions are saved.</p>
        <div class="max-h-56 overflow-auto"><For each={c.captions}>{(w, i) => <label class="flex gap-2 items-center text-xs my-1"><span class="w-28">{(w.startMs / 1000).toFixed(1)}–{(w.endMs / 1000).toFixed(1)}s</span><input class="bg-zinc-800 p-1 flex-1" value={w.text} onChange={e => { const value = e.currentTarget.value; update(c.id, { captions: c.captions!.map((word, index) => index === i() ? { ...word, text: value } : word) }); }} /></label>}</For></div>
      </details>
    </div>}</For>
    <label class="flex gap-2 text-sm"><input type="checkbox" checked={confirmed()} onChange={e => setConfirmed(e.currentTarget.checked)} />I reviewed the selected excerpts in context and approve their meaning and wording.</label>
    <Show when={error()}><p role="alert" class="text-red-400">{error()}</p></Show>
    <button class="bg-brand rounded px-4 py-2 disabled:opacity-40" disabled={busy() || !confirmed() || !clips().some(c => c.selected)} onClick={approve}>{busy() ? "Submitting…" : "Render approved excerpts"}</button>
    <button class="ml-4 text-zinc-400" disabled={busy()} onClick={async () => {
      setBusy(true);
      try { const res = await fetch(`/api/batch/${props.batchId}`, { method: "DELETE" }); if (!res.ok) throw new Error((await res.json()).error); props.onDiscard(); }
      catch (e: any) { setError(e.message); } finally { setBusy(false); }
    }}>Discard this batch</button>
  </section>;
}
