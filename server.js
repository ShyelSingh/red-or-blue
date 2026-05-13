const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id SERIAL PRIMARY KEY,
      choice TEXT NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/vote', async (req, res) => {
  const { choice, session_id } = req.body;

  if (!choice || !['red', 'blue'].includes(choice)) {
    return res.status(400).json({ error: 'Invalid choice' });
  }
  if (!session_id || typeof session_id !== 'string' || session_id.trim() === '') {
    return res.status(400).json({ error: 'Invalid session_id' });
  }

  try {
    await pool.query(
      'INSERT INTO votes (choice, session_id) VALUES ($1, $2)',
      [choice, session_id.trim()]
    );
    return res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already voted' });
    }
    console.error('Vote insert error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/admin', async (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;

  function send401() {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Unauthorized');
  }

  const authHeader = req.headers['authorization'] || '';
  const parts = authHeader.split(' ');
  if (parts[0] !== 'Basic' || !parts[1]) return send401();

  const decoded = Buffer.from(parts[1], 'base64').toString('utf8');
  // username:password — password may contain colons
  const colonIdx = decoded.indexOf(':');
  const password = colonIdx === -1 ? '' : decoded.slice(colonIdx + 1);

  if (!adminPassword || password !== adminPassword) return send401();

  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN choice = 'red' THEN 1 ELSE 0 END) AS red_count,
        SUM(CASE WHEN choice = 'blue' THEN 1 ELSE 0 END) AS blue_count
      FROM votes
    `);
    const { total, red_count, blue_count } = result.rows[0];
    const t = parseInt(total, 10);
    const r = parseInt(red_count, 10) || 0;
    const b = parseInt(blue_count, 10) || 0;
    const pctBlue = t === 0 ? 0 : ((b / t) * 100).toFixed(1);
    const thresholdMet = t > 0 && b / t >= 0.5;

    const statusColor = thresholdMet ? '#4ade80' : '#f87171';
    const statusIcon = thresholdMet ? '✓' : '✗';
    const statusText = thresholdMet
      ? 'THRESHOLD MET — everyone lives'
      : 'THRESHOLD NOT MET — only red-choosers survive';

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin — Red or Blue</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0f0f0f;
    color: #e5e5e5;
    font-family: 'Courier New', monospace;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .panel {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 2.5rem 3rem;
    min-width: 340px;
  }
  h1 { font-size: 1.1rem; color: #888; margin-bottom: 2rem; letter-spacing: 0.1em; text-transform: uppercase; }
  .stat { margin-bottom: 1rem; }
  .stat-label { font-size: 0.75rem; color: #666; text-transform: uppercase; letter-spacing: 0.08em; }
  .stat-value { font-size: 2rem; font-weight: bold; margin-top: 0.2rem; }
  .divider { border: none; border-top: 1px solid #2a2a2a; margin: 1.5rem 0; }
  .threshold {
    font-size: 1rem;
    font-weight: bold;
    color: ${statusColor};
    margin-top: 1.5rem;
    padding: 0.75rem 1rem;
    border: 1px solid ${statusColor}40;
    border-radius: 4px;
    background: ${statusColor}10;
  }
  .red-val { color: #f87171; }
  .blue-val { color: #60a5fa; }
</style>
</head>
<body>
<div class="panel">
  <h1>Admin Dashboard</h1>
  <div class="stat">
    <div class="stat-label">Total Votes</div>
    <div class="stat-value">${t}</div>
  </div>
  <hr class="divider">
  <div class="stat">
    <div class="stat-label">Red</div>
    <div class="stat-value red-val">${r}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Blue</div>
    <div class="stat-value blue-val">${b}</div>
  </div>
  <div class="stat">
    <div class="stat-label">% Blue</div>
    <div class="stat-value">${pctBlue}%</div>
  </div>
  <div class="threshold">${statusIcon} ${statusText}</div>
</div>
</body>
</html>`);
  } catch (err) {
    console.error('Admin query error:', err);
    res.status(500).send('Server error');
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
