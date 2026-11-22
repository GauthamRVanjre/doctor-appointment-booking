export function ClinicBrand() {
  return <div className="flex items-center gap-3"><span aria-hidden="true" className="grid h-9 w-9 shrink-0 grid-cols-2 gap-0.5">{[0,1,2,3].map(i => <span key={i} className="rounded-[7px] bg-primary" />)}</span><span className="text-lg font-bold tracking-tight sm:text-xl">Doc Care</span></div>;
}
