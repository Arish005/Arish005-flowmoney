const express   = require('express');
const basicAuth = require('express-basic-auth');
const path      = require('path');
const app       = express();
const PORT      = process.env.PORT || 3000;

// ─── LOGIN PROTECTION ────────────────────────────────────────────────────────
const AUTH_USER = process.env.AU || 'arish';
const AUTH_PASS = process.env.AP || 'FlowMoney2025';
app.use(basicAuth({ users: { [AUTH_USER]: AUTH_PASS }, challenge: true, realm: 'FlowMoney' }));

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(__dirname));

// ─── DATABASE ─────────────────────────────────────────────────────────────────
// Uses DATABASE_URL env-var if set, otherwise falls back to the built-in DB.
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://flowmoney_user:X30SmduHBseIoW7hQs5LJdFSBPIs9vT5@dpg-d8f8escm0tmc73en52s0-a.oregon-postgres.render.com:5432/flowmoney';

const { Pool } = require('pg');
// Let the connection string sslmode param control SSL behaviour
const pool = new Pool({ connectionString: DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id   BIGINT  PRIMARY KEY,
      cat  TEXT    NOT NULL,
      amt  NUMERIC NOT NULL,
      date TEXT    NOT NULL,
      note TEXT    DEFAULT ''
    );
  `);
  console.log('  ✓ Database ready');
}
initDB().catch(e => console.error('DB init:', e.message));

const db = {
  async getData() {
    const [s, e] = await Promise.all([
      pool.query('SELECT key, value FROM settings'),
      pool.query('SELECT * FROM entries ORDER BY id DESC'),
    ]);
    const settings = {};
    s.rows.forEach(r => { settings[r.key] = JSON.parse(r.value); });
    const entries = e.rows.map(r => ({
      id: Number(r.id), cat: r.cat, amt: Number(r.amt), date: r.date, note: r.note,
    }));
    return { settings, entries };
  },
  async saveSettings(obj) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM settings');
      for (const [k, v] of Object.entries(obj))
        await c.query('INSERT INTO settings(key,value) VALUES($1,$2)', [k, JSON.stringify(v)]);
      await c.query('COMMIT');
    } finally { c.release(); }
  },
  async addEntry(e)    { await pool.query('INSERT INTO entries(id,cat,amt,date,note) VALUES($1,$2,$3,$4,$5)', [e.id,e.cat,e.amt,e.date,e.note]); },
  async deleteEntry(id){ await pool.query('DELETE FROM entries WHERE id=$1', [id]); },
  async deleteMonth(m) { await pool.query("DELETE FROM entries WHERE date LIKE $1", [m+'%']); },
  async reset()        { await pool.query('DELETE FROM entries'); await pool.query('DELETE FROM settings'); },
};

// ─── SERVE INDEX ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.get   ('/api/data',                async (req,res) => { try{res.json(await db.getData())}              catch(e){res.status(500).json({error:e.message})} });
app.post  ('/api/settings',            async (req,res) => { try{await db.saveSettings(req.body);res.json({ok:true})} catch(e){res.status(500).json({error:e.message})} });
app.post  ('/api/entries',             async (req,res) => { try{const en={...req.body,id:Date.now()};await db.addEntry(en);res.json({ok:true,entry:en})} catch(e){res.status(500).json({error:e.message})} });
app.delete('/api/entries/month/:month',async (req,res) => { try{await db.deleteMonth(req.params.month);res.json({ok:true})} catch(e){res.status(500).json({error:e.message})} });
app.delete('/api/entries/:id',         async (req,res) => { try{await db.deleteEntry(parseInt(req.params.id));res.json({ok:true})} catch(e){res.status(500).json({error:e.message})} });
app.post  ('/api/reset',               async (req,res) => { try{await db.reset();res.json({ok:true})}    catch(e){res.status(500).json({error:e.message})} });

// ─── START ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  FlowMoney running → http://localhost:${PORT}`);
    console.log(`  Login: ${AUTH_USER} / ${AUTH_PASS}\n`);
  });
} else {
  module.exports = app;   // Vercel serverless
}
