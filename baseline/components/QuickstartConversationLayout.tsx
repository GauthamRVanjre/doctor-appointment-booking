 'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { BookingCard } from './BookingCard';
import { ClinicBrand } from './ClinicBrand';
type Props = { statusPanel: ReactNode; pipelineMetrics: ReactNode; transcriptPanel: ReactNode; visualizer: ReactNode; controls: ReactNode; onEndConversation: () => void };
export function QuickstartConversationLayout({statusPanel,pipelineMetrics,transcriptPanel,visualizer,controls,onEndConversation}: Props) {
 return <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col text-left"><header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-5 sm:px-8"><ClinicBrand/><div className="flex items-center gap-5">{statusPanel}<Button variant="outline" size="sm" className="rounded-full border-primary/40 text-foreground hover:bg-destructive/10 hover:text-destructive" onClick={onEndConversation}>End conversation</Button></div></header>
 <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden"><div className="flex min-h-0 flex-col gap-4"><div className="h-[52dvh] min-h-72 lg:h-auto lg:min-h-0 lg:flex-1">{transcriptPanel}</div><div className="shrink-0">{controls}</div></div><aside className="min-h-0 space-y-4 lg:overflow-y-auto"><BookingCard/><details className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">Connection performance</summary><div className="pt-3">{pipelineMetrics}</div></details></aside></main>
 {/* RemoteUser audio remains mounted inside this presentation slot. */}<div hidden>{visualizer}</div></div>;
}
