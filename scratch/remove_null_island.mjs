import { createClient } from '@supabase/supabase-js';

const db = createClient(
  'https://bzufqeuaordhrykgsiub.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6dWZxZXVhb3JkaHJ5a2dzaXViIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczOTAyNzg5OCwiZXhwIjoyMDU0NjAzODk4fQ.YOUR_KEY' // wait, I need the actual service role key, but the anon key might work if RLS allows delete. Or I can just write an RPC.
);
