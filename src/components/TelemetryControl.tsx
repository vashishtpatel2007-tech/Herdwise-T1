import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase.ts';
import { haversine, pointToSegmentMeters } from '../engine/geo.ts';

interface TelemetryControlProps {
  animalId: string;
}

export function TelemetryControl({ animalId }: TelemetryControlProps) {
  const [live, setLive] = useState<Record<string, any> | null>(null);
  const [risk, setRisk] = useState<Record<string, any> | null>(null);
  const [zone, setZone] = useState<any[]>([]);

  useEffect(() => {
    // 1. Fetch live telemetry, risk state, and the animal's boundary zone from Supabase
    const fetchAll = async () => {
      const [posRes, riskRes, zoneRes] = await Promise.all([
        supabase.from('latest_positions').select('*').eq('animal_id', animalId).maybeSingle(),
        supabase.from('risk_state').select('*').eq('animal_id', animalId).maybeSingle(),
        supabase.from('zones').select('geom').eq('animal_id', animalId).limit(1)
      ]);

      setLive(posRes.data);
      setRisk(riskRes.data);
      
      // Parse the zone geometry if it exists
      if (zoneRes.data && zoneRes.data.length > 0 && zoneRes.data[0].geom) {
        const geom = zoneRes.data[0].geom;
        // geom is GeoJSON like: { type: "Polygon", coordinates: [[[lon, lat], ...]] }
        if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
          const points = geom.coordinates[0].map((coord: number[]) => ({
            lat: coord[1],
            lon: coord[0]
          }));
          // Remove the closing point if it matches the first
          if (points.length > 0 && 
              points[0].lat === points[points.length - 1].lat && 
              points[0].lon === points[points.length - 1].lon) {
            points.pop();
          }
          setZone(points);
        }
      }
    };

    fetchAll();
    const id = setInterval(fetchAll, 5000); // refresh every 5 seconds like live telemetry
    return () => clearInterval(id);
  }, [animalId]);

  // Calculate Nearest Corners and Sides exactly like the old gateway.ino!
  const mathData = useMemo(() => {
    if (!live || !live.lat || !live.lon || zone.length < 3) return null;
    
    const corners = [];
    const sides = [];
    
    for (let i = 0; i < zone.length; i++) {
      const p1 = zone[i];
      const p2 = zone[(i + 1) % zone.length];
      
      const cornerDist = haversine(live.lat, live.lon, p1.lat, p1.lon);
      corners.push({ index: i + 1, distance: cornerDist });
      
      const sideDist = pointToSegmentMeters(live.lat, live.lon, p1.lat, p1.lon, p2.lat, p2.lon);
      sides.push({ index: i + 1, distance: sideDist });
    }
    
    sides.sort((a, b) => a.distance - b.distance);
    corners.sort((a, b) => a.distance - b.distance);
    
    return { corners, sides };
  }, [live, zone]);

  if (!live) {
    return <div className="card"><p className="opacity-70">Waiting for collar telemetry...</p></div>;
  }

  return (
    <div className="grid gap-3">
      {/* LOCAL PREDICTION ENGINE CARD */}
      <section className="card bg-card2 border border-[var(--line-soft)]" style={{ padding: '16px', borderRadius: '16px' }}>
        <div className="flex justify-between items-center border-b border-[var(--line-soft)] pb-3 mb-3" style={{ borderBottom: '1px solid var(--line-soft)', paddingBottom: '12px', marginBottom: '12px' }}>
          <h2 className="text-[15px] font-extrabold uppercase tracking-wide opacity-80" style={{ fontSize: '15px', fontWeight: 800, textTransform: 'uppercase', opacity: 0.8 }}>Local Prediction Engine</h2>
          <span className="text-[10px] font-bold bg-green/20 text-green px-2 py-1 rounded-sm tracking-wider" style={{ fontSize: '10px', fontWeight: 700, backgroundColor: 'rgba(47,174,99,0.2)', color: 'var(--green)', padding: '4px 8px', borderRadius: '4px' }}>RUNNING ON COLLAR</span>
        </div>
        
        <div className="grid grid-cols-2 gap-y-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: '12px' }}>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider">Risk Score</span>
            <span className="text-[22px] font-extrabold" style={{ fontSize: '22px', fontWeight: 800 }}>{risk?.risk_score ?? 0}<span className="text-[14px] opacity-50" style={{ fontSize: '14px', opacity: 0.5 }}>/100</span></span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider">Status</span>
            <span className="text-[16px] font-bold" style={{ fontSize: '16px', fontWeight: 700, color: risk?.state === 'HIGH_RISK' ? 'var(--red)' : risk?.state === 'WARNING' ? 'var(--amber)' : 'var(--green)' }}>
              {risk?.state || 'SAFE'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider">GPS Fix</span>
            <span className="text-[15px] font-bold" style={{ fontSize: '15px', fontWeight: 700 }}>{live.sats ? live.sats + ' Sats' : 'No Fix'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider">Battery</span>
            <span className="text-[15px] font-bold" style={{ fontSize: '15px', fontWeight: 700 }}>{live.battery_pct != null ? live.battery_pct + '%' : '—'}</span>
          </div>
        </div>
      </section>

      {/* BOUNDARY ANALYSIS CARD */}
      {mathData && (
        <section className="card bg-card2 border border-[var(--line-soft)]" style={{ padding: '16px', borderRadius: '16px' }}>
          <div className="border-b border-[var(--line-soft)] pb-3 mb-3" style={{ borderBottom: '1px solid var(--line-soft)', paddingBottom: '12px', marginBottom: '12px' }}>
            <h2 className="text-[15px] font-extrabold uppercase tracking-wide opacity-80" style={{ fontSize: '15px', fontWeight: 800, textTransform: 'uppercase', opacity: 0.8 }}>Boundary Analysis</h2>
            <p className="text-[12px] font-semibold text-[var(--text-dim)] mt-1" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)' }}>Live distance to virtual fence</p>
          </div>
          
          <div className="grid gap-2" style={{ display: 'grid', gap: '8px' }}>
            <p className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider mt-1" style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Sides</p>
            {mathData.sides.slice(0, 2).map((s, idx) => (
              <div key={'s'+s.index} className="flex justify-between items-center rounded-lg px-3 py-2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: '8px', background: idx === 0 ? 'rgba(47, 174, 99, 0.1)' : 'var(--card)', borderLeft: idx === 0 ? '2px solid var(--green)' : '2px solid transparent' }}>
                <span className="text-[14px] font-bold" style={{ fontSize: '14px', fontWeight: 700, color: idx === 0 ? 'var(--green)' : 'var(--text-dim)' }}>{idx === 0 ? `Nearest Side (${s.index})` : `Side ${s.index}`}</span>
                <span className="text-[15px] font-extrabold" style={{ fontSize: '15px', fontWeight: 800, color: idx === 0 ? 'var(--green)' : 'inherit' }}>{s.distance.toFixed(1)} m</span>
              </div>
            ))}
            
            <p className="text-[11px] font-bold text-[var(--text-dim)] uppercase tracking-wider mt-2" style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', marginTop: '8px' }}>Corners</p>
            {mathData.corners.slice(0, 2).map((c, idx) => (
              <div key={'c'+c.index} className="flex justify-between items-center rounded-lg px-3 py-2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: '8px', background: idx === 0 ? 'rgba(47, 174, 99, 0.1)' : 'var(--card)', borderLeft: idx === 0 ? '2px solid var(--green)' : '2px solid transparent' }}>
                <span className="text-[14px] font-bold" style={{ fontSize: '14px', fontWeight: 700, color: idx === 0 ? 'var(--green)' : 'var(--text-dim)' }}>{idx === 0 ? `Nearest Corner (${c.index})` : `Corner ${c.index}`}</span>
                <span className="text-[15px] font-extrabold" style={{ fontSize: '15px', fontWeight: 800, color: idx === 0 ? 'var(--green)' : 'inherit' }}>{c.distance.toFixed(1)} m</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
