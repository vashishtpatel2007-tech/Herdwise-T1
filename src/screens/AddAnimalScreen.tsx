/**
 * §9.4 — add-animal flow: name, photo, Pashu Aadhaar tag, assign a collar,
 * generate a printable QR.
 *
 * The tag field accepts the 12-digit government ear-tag number the animal is
 * almost certainly already wearing. Typing it is the single step that links
 * this system to the national registry, so it gets a numeric keypad and its
 * own validation rather than being one field among many.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.ts';
import { AnimalQR } from '../components/AnimalQR.tsx';

interface FreeDevice { id: string; device_key: string }

export function AddAnimalScreen() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [breed, setBreed] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<FreeDevice[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; name: string; tag: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('devices')
        .select('id, device_key').is('animal_id', null);
      setDevices((data ?? []) as FreeDevice[]);
    })();
  }, []);

  const tagValid = tag === '' || /^\d{12}$/.test(tag);

  async function save() {
    setError(null);
    if (!name.trim()) { setError('Give her a name.'); return; }
    if (!tagValid) { setError('A Pashu Aadhaar tag is 12 digits.'); return; }

    setSaving(true);
    try {
      const { data: farmer } = await supabase.from('farmers').select('id').maybeSingle();
      if (!farmer) throw new Error('No farmer profile found.');

      const { data: slug } = await supabase.rpc('generate_public_slug', { p_name: name });

      const { data: animal, error: insErr } = await supabase.from('animals').insert({
        farmer_id: farmer.id,
        name: name.trim(),
        pashu_aadhaar_tag: tag || null,
        breed: breed || null,
        public_slug: slug as string,
      }).select('id, public_slug, name, pashu_aadhaar_tag').single();

      if (insErr) throw insErr;

      if (deviceId) {
        await supabase.from('devices').update({ animal_id: animal.id }).eq('id', deviceId);
      }

      setCreated({
        slug: animal.public_slug as string,
        name: animal.name as string,
        tag: (animal.pashu_aadhaar_tag as string) ?? '',
      });
    } catch (e) {
      // State what broke and what to do (§10 copy rules).
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <div className="h-full overflow-y-auto bg-card2 p-4">
        <h1 className="d-lg">{created.name} is added</h1>
        <p className="mt-1 text-[16px] font-semibold opacity-70">
          Print this and tie it to her ear tag. Anyone who finds her can scan it.
        </p>
        <div className="mt-4">
          <AnimalQR slug={created.slug} animalName={created.name} tagNumber={created.tag || null} />
        </div>
        <button onClick={() => navigate('/animals')} className="btn btn-ghost mt-4 w-full">
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-card2 p-4">
      <h1 className="d-lg">Add an animal</h1>

      <label className="mt-4 block text-[15px] font-bold">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)}
               className="mt-1 w-full rounded-lg border-2 border-line p-3 text-[17px]" />
      </label>

      <label className="mt-3 block text-[15px] font-bold">
        Pashu Aadhaar tag number
        <input value={tag} onChange={(e) => setTag(e.target.value.replace(/\D/g, ''))}
               inputMode="numeric" maxLength={12} placeholder="12 digits"
               className={`tnum mt-1 w-full rounded-lg border-2 p-3 text-[17px] ${
                 tagValid ? 'border-line' : 'border-red'}`} />
        {!tagValid && <span className="text-[14px] font-bold text-red">Must be 12 digits.</span>}
      </label>

      <label className="mt-3 block text-[15px] font-bold">
        Breed
        <input value={breed} onChange={(e) => setBreed(e.target.value)}
               className="mt-1 w-full rounded-lg border-2 border-line p-3 text-[17px]" />
      </label>

      <label className="mt-3 block text-[15px] font-bold">
        Collar
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}
                className="mt-1 w-full rounded-lg border-2 border-line p-3 text-[17px]">
          <option value="">No collar yet</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.device_key}</option>)}
        </select>
      </label>

      {error && (
        <p className="mt-3 rounded-lg bg-red/10 p-3 text-[15px] font-bold text-red">{error}</p>
      )}

      <button onClick={() => void save()} disabled={saving}
              className="btn btn-primary mt-5 w-full disabled:opacity-40">
        Save and make tag
      </button>
    </div>
  );
}
