import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.VITE_SUPABASE_DB_URL
});

async function run() {
  const res = await pool.query("SELECT id, name, drawn_by, ST_AsText(boundary) FROM grazing_zones ORDER BY id DESC LIMIT 3");
  console.log(res.rows);
  pool.end();
}
run();
