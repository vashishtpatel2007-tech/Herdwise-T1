import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.VITE_SUPABASE_DB_URL });

async function run() {
  const res = await pool.query("SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'grazing_zones'");
  console.log(res.rows);
  pool.end();
}
run();
