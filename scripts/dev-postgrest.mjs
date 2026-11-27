// Minimal PostgREST emulator for LOCAL testing only (the build sandbox cannot reach Supabase).
// Supports the subset supabase-js uses in this app: select/filters/order/limit/offset, insert, update,
// delete, rpc. Every request runs as role "anon" inside a transaction, so grants and RLS are exercised.
// Usage: PGURL="postgres://postgres@localhost/risa2?host=/tmp&port=5544" node scripts/dev-postgrest.mjs [port]
import http from 'node:http';
import pg from 'pg';

pg.types.setTypeParser(1700, parseFloat); // numeric -> number, like PostgREST JSON
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1082, (v) => v); // date -> "YYYY-MM-DD", like PostgREST
pg.types.setTypeParser(1114, (v) => v.replace(" ", "T")); // timestamp -> ISO without zone
pg.types.setTypeParser(1184, (v) => v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")); // timestamptz
const pool = new pg.Pool({ connectionString: process.env.PGURL });
const PORT = Number(process.argv[2] || 54321);
const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const val = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? null);

function parseFilters(params, values) {
  const where = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|in|is)\.(.*)$/s.exec(v);
    if (!m) continue;
    const [, not, op, raw] = m;
    let clause;
    if (op === 'in') {
      const items = raw.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      values.push(items);
      clause = `${ident(k)}::text = any($${values.length}::text[])`;
    } else if (op === 'is') {
      clause = `${ident(k)} is ${raw === 'null' ? 'null' : raw === 'true' ? 'true' : 'false'}`;
    } else {
      const sym = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }[op];
      values.push(op.endsWith('like') ? raw.replace(/\*/g, '%') : raw);
      clause = ['gt', 'gte', 'lt', 'lte'].includes(op)
        ? `${ident(k)} ${sym} $${values.length}`
        : `${ident(k)}::text ${sym} $${values.length}::text`;
    }
    where.push(not ? `not (${clause})` : clause);
  }
  return where.length ? ' where ' + where.join(' and ') : '';
}

function orderBy(o) {
  if (!o) return '';
  return ' order by ' + o.split(',').map((p) => {
    const [c, ...mods] = p.split('.');
    return ident(c) + (mods.includes('desc') ? ' desc' : ' asc') +
      (mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : '');
  }).join(', ');
}

const cols = (sel) => (!sel || sel === '*' ? '*' : sel.split(',').map((c) => ident(c.trim())).join(','));

async function run(sql, values) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role anon');
    const r = await c.query(sql, values);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Content-Range',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, 'http://x');
  const m = /^\/rest\/v1\/(rpc\/)?([a-z0-9_]+)$/i.exec(url.pathname);
  let body = '';
  for await (const ch of req) body += ch;
  const send = (code, obj, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...cors, ...extra });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
  };
  if (!m) return send(404, { message: 'not found' });
  const [, isRpc, name] = m;
  const values = [];
  const prefer = req.headers['prefer'] || '';
  try {
    if (isRpc) {
      const args = body ? JSON.parse(body) : {};
      const keys = Object.keys(args);
      const call = `${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
      const meta = await pool.query(
        'select p.proretset, t.typtype from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 limit 1', [name]);
      const setof = meta.rows[0]?.proretset || meta.rows[0]?.typtype === 'c';
      const r = await run(setof ? `select * from ${call}` : `select ${call} as v`, keys.map((k) => val(args[k])));
      return send(200, setof ? r.rows : r.rows[0]?.v ?? null);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const where = parseFilters(url.searchParams, values);
      let sql = `select ${cols(url.searchParams.get('select'))} from ${ident(name)}${where}${orderBy(url.searchParams.get('order'))}`;
      if (url.searchParams.get('limit')) sql += ` limit ${Number(url.searchParams.get('limit'))}`;
      if (url.searchParams.get('offset')) sql += ` offset ${Number(url.searchParams.get('offset'))}`;
      const r = await run(sql, values);
      const extra = {};
      if (prefer.includes('count=exact')) {
        const cv = [];
        const cnt = await run(`select count(*)::int n from ${ident(name)}${parseFilters(url.searchParams, cv)}`, cv);
        extra['Content-Range'] = `0-${Math.max(r.rows.length - 1, 0)}/${cnt.rows[0].n}`;
      }
      return send(200, req.method === 'HEAD' ? undefined : r.rows, extra);
    }
    const ret = prefer.includes('return=representation') ? ` returning ${cols(url.searchParams.get('select'))}` : '';
    if (req.method === 'POST') {
      const rows = [].concat(JSON.parse(body));
      if (!rows.length) return send(201, []);
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const tuples = rows.map((r) => '(' + keys.map((k) => { values.push(val(r[k])); return `$${values.length}`; }).join(',') + ')');
      const r = await run(`insert into ${ident(name)} (${keys.map(ident).join(',')}) values ${tuples.join(',')}${ret}`, values);
      return send(201, ret ? r.rows : undefined);
    }
    if (req.method === 'PATCH') {
      const obj = JSON.parse(body);
      const sets = Object.keys(obj).map((k) => { values.push(val(obj[k])); return `${ident(k)} = $${values.length}`; });
      const where = parseFilters(url.searchParams, values);
      const r = await run(`update ${ident(name)} set ${sets.join(', ')}${where}${ret}`, values);
      return send(200, ret ? r.rows : undefined);
    }
    if (req.method === 'DELETE') {
      const where = parseFilters(url.searchParams, values);
      const r = await run(`delete from ${ident(name)}${where}${ret}`, values);
      return send(200, ret ? r.rows : undefined);
    }
    send(405, { message: 'method not allowed' });
  } catch (e) {
    send(400, { message: e.message, code: e.code });
  }
}).listen(PORT, () => console.log(`dev PostgREST on :${PORT}`));
