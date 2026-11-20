export const clinic = {
  doctorId: 'dr-ramesh',
  doctorName: 'Dr. Ramesh',
  clinicName: 'Demo Care Clinic',
  specialty: 'General physician',
  service: 'Routine general physician consultation',
  timezone: 'Asia/Kolkata',
  weekdays: [1, 2, 4, 5],
  startMinute: 17 * 60,
  endMinute: 20 * 60,
  durationMinutes: 30,
  keywords: ['general physician', 'general doctor', 'routine', 'checkup', 'check-up', 'fever', 'cold', 'cough', 'headache'],
} as const;

export function localDate(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export type Slot = {
  id: string; doctor_id: string; starts_at: string; ends_at: string; timezone: string;
};

export function schedule(now: Date): Slot[] {
  const slots: Slot[] = [];
  for (let day = 0; day < 7; day++) {
    const date = addDays(localDate(now), day);
    if (!(clinic.weekdays as readonly number[]).includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
    for (let minute = clinic.startMinute; minute < clinic.endMinute; minute += clinic.durationMinutes) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const start = new Date(`${date}T${time}:00+05:30`);
      if (start.getTime() <= now.getTime()) continue;
      slots.push({ id: `${clinic.doctorId}:${date}:${time}`, doctor_id: clinic.doctorId,
        starts_at: start.toISOString(), ends_at: new Date(start.getTime() + clinic.durationMinutes * 60_000).toISOString(), timezone: clinic.timezone });
    }
  }
  return slots;
}
