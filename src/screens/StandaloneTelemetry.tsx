import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { TelemetryControl } from '../components/TelemetryControl.tsx';
import { IconCow } from '../components/Icons.tsx';

export function StandaloneTelemetry() {
  const [animalId, setAnimalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('devices')
      .select('animal_id')
      .eq('device_key', 'PASHU-A01')
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else if (data?.animal_id) setAnimalId(data.animal_id);
        else setError('Device PASHU-A01 not found or not assigned to an animal.');
      });
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center" style={{ background: 'var(--bg)', color: 'var(--red)' }}>
        <p>{error}</p>
      </div>
    );
  }

  if (!animalId) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 999 }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-4 border-b border-[var(--line-soft)]" style={{ background: 'var(--card)' }}>
        <div className="grid place-items-center rounded-full" style={{ width: 42, height: 42, background: 'var(--green-soft)', color: 'var(--green)' }}>
          <IconCow size={24} />
        </div>
        <div>
          <h1 className="text-[18px] font-extrabold leading-tight">Live Telemetry</h1>
          <p className="text-[13px] font-semibold text-[var(--text-dim)]">Collar: PASHU-A01</p>
        </div>
      </header>

      {/* Telemetry Control */}
      <div className="p-4 flex-1">
        <TelemetryControl animalId={animalId} />
      </div>
    </div>
  );
}
