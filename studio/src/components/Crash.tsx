import { Component, type ErrorInfo, type ReactNode } from "react";

/** send a crash to the rental's log, so "Claude on this rental" and the debug report can see it */
export function reportCrash(where: string, e: unknown, extra = "") {
  const err = e as Error;
  const text = `[${where}] ${err?.name ?? "Error"}: ${err?.message ?? String(e)}\n${err?.stack ?? ""}${extra ? `\n${extra}` : ""}`.slice(0, 8000);
  try { navigator.sendBeacon?.("/studio-api/client-error", new Blob([JSON.stringify({ where, text })], { type: "application/json" })); } catch { /* ignore */ }
  return text;
}

/** one broken part of the page shows what went wrong instead of turning the whole Studio black */
export class Crash extends Component<{ where: string; children: ReactNode; full?: boolean }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: String((e as Error)?.message ?? e) }; }
  componentDidCatch(e: Error, info: ErrorInfo) { this.setState({ error: reportCrash(this.props.where, e, info.componentStack ?? "") }); }
  render() {
    if (!this.state.error) return this.props.children;
    const text = this.state.error;
    return (
      <div className={this.props.full ? "m-auto max-w-2xl p-8" : "m-auto max-w-2xl p-6"}>
        <h2 className="text-lg font-semibold text-ink">This part of the Studio hit an error</h2>
        <p className="mt-1 text-sm text-muted">Your work is safe — nothing was deleted. Copy the error and paste it to Claude to get it fixed; the other tabs still work.</p>
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-line bg-black/40 p-3 text-[11.5px] leading-snug text-muted whitespace-pre-wrap">{text}</pre>
        <div className="mt-3 flex gap-2">
          <button className="btn-raised rounded-lg px-3 py-1.5 text-sm text-ink" onClick={() => navigator.clipboard?.writeText(text)}>Copy the error</button>
          <button className="btn-raised rounded-lg px-3 py-1.5 text-sm text-ink" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn-raised rounded-lg px-3 py-1.5 text-sm text-ink" onClick={() => location.reload()}>Reload the page</button>
        </div>
      </div>
    );
  }
}
