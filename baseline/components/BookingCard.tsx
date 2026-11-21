'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type State = {
  ok?: boolean; message?: string; emergency?: string; notice?: string;
  pending?: { reference: string; readback: string; expires_at: string };
  saved?: { booking: { id: string; demo_alias: string }; slot: { starts_at: string; timezone: string }; doctor: { doctorName: string; clinicName: string } };
};
export function BookingCard() {
  const [state, setState] = useState<State>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch('/api/booking/session', { cache: 'no-store' });
        const data = await response.json();
        if (active) { setState(data); setError(response.ok ? '' : 'Booking session is unavailable. Start a new conversation.'); }
      } catch { if (active) { setState({}); setError('Cannot reach the booking server.'); } }
      if (active) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  const confirm = async () => {
    if (!state.pending || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/booking/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: state.pending.reference }) });
      const result = await response.json();
      if (!result.ok) { setState({}); setError(result.message ?? 'Booking could not be confirmed.'); }
      else setState({ ok: true, saved: result });
    } catch { setError('Outcome unknown. Retry confirmation to retrieve the same saved booking.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Booking review" aria-live="polite" className="mx-auto w-full max-w-xl shrink-0 rounded-xl border border-border bg-card p-4 text-sm">
    <h2 className="mb-2 font-semibold">{state.saved ? 'Saved booking' : 'Appointment review'}</h2>
    {state.saved && <div className="space-y-1">
      <p>{state.saved.doctor.doctorName} · {state.saved.doctor.clinicName}</p>
      <p>{new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' }).format(new Date(state.saved.slot.starts_at))} · Asia/Kolkata</p>
      <p>{state.saved.booking.demo_alias} · 30 minutes</p>
      <p className="break-all text-xs text-muted-foreground">Saved reference: {state.saved.booking.id}</p>
    </div>}
    {state.emergency ? <p role="alert" className="text-destructive">{state.emergency}</p> : state.pending ? <div className="space-y-3">
      <p>{state.pending.readback}</p>
      <p className="text-xs text-muted-foreground">Review these exact details. Clicking confirms and saves this fictional booking. Spoken “yes” alone does not save. New speech requires fresh review.</p>
      <Button onClick={confirm} disabled={busy || !state.ok || Date.parse(state.pending.expires_at) <= Date.now()}>{busy ? 'Saving…' : 'I approve — save booking'}</Button>
    </div> : !state.saved && <p className="text-muted-foreground">Choose an available slot with the voice assistant. Review and approve here before it is saved.</p>}
    {state.message && !state.emergency && <p role="status">{state.message}</p>}
    {state.notice && <p className="mt-2 text-xs text-muted-foreground">{state.notice}</p>}
    {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
  </section>;
}
