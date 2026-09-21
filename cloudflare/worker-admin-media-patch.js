// QuizGameMaster Cloudflare Worker admin/media patch
// Insert this block ABOVE: export default { ... }

const QGM_ADMIN_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,X-QGM-QID,X-QGM-Kind,X-QGM-License-Status,X-QGM-License-Provider,X-QGM-License-Name,X-QGM-License-Source,X-QGM-Proof-URL",
  "Access-Control-Max-Age": "86400"
};

function qgmJson(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...QGM_ADMIN_CORS,
      ...extra
    }
  });
}

function qgmIsAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return Boolean(env.ADMIN_TOKEN) && auth === `Bearer ${env.ADMIN_TOKEN}`;
}

function qgmSafeKey(raw) {
  let key = decodeURIComponent(String(raw || "")).replace(/^\/+/, "");
  if (!key || key.length > 240 || key.includes("..") || !/^[A-Za-z0-9._\/-]+$/.test(key)) return null;
  return key;
}

async function qgmEnsureSchema(env) {
  if (!env.DB) throw new Error("D1 binding DB is missing");

  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS qgm_categories (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS qgm_questions (
        qid TEXT PRIMARY KEY,
        internal_id TEXT,
        category_slug TEXT,
        difficulty TEXT,
        type TEXT,
        question TEXT NOT NULL,
        answers_json TEXT,
        correct_answer TEXT,
        fact TEXT,
        fact_tag TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        question_image_key TEXT,
        fact_image_key TEXT,
        question_audio_key TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS qgm_assets (
        asset_key TEXT PRIMARY KEY,
        qid TEXT,
        kind TEXT NOT NULL DEFAULT 'other',
        content_type TEXT,
        size_bytes INTEGER,
        license_status TEXT NOT NULL DEFAULT 'review',
        license_provider TEXT,
        license_name TEXT,
        license_source TEXT,
        proof_url TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS qgm_sessions (
        session_id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT 'tiktok',
        channel TEXT,
        started_at TEXT,
        ended_at TEXT,
        peak_viewers INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS qgm_session_players (
        session_id TEXT NOT NULL,
        user_key TEXT NOT NULL,
        display_name TEXT,
        country_code TEXT,
        region TEXT,
        geo_source TEXT,
        geo_confidence REAL,
        language TEXT,
        entry_source TEXT,
        entry_type TEXT,
        joined_at TEXT,
        left_at TEXT,
        active_seconds INTEGER NOT NULL DEFAULT 0,
        answers_count INTEGER NOT NULL DEFAULT 0,
        correct_count INTEGER NOT NULL DEFAULT 0,
        points INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, user_key)
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS qgm_question_stats (
        session_id TEXT NOT NULL,
        qid TEXT NOT NULL,
        shown INTEGER NOT NULL DEFAULT 0,
        answers INTEGER NOT NULL DEFAULT 0,
        correct INTEGER NOT NULL DEFAULT 0,
        answer_a INTEGER NOT NULL DEFAULT 0,
        answer_b INTEGER NOT NULL DEFAULT 0,
        answer_c INTEGER NOT NULL DEFAULT 0,
        answer_d INTEGER NOT NULL DEFAULT 0,
        avg_response_ms REAL,
        PRIMARY KEY (session_id, qid)
      )
    `)
  ]);
}

async function qgmHandlePublicAsset(request, env, url) {
  if (!env.ASSETS) return qgmJson({ ok:false, error:"R2 binding ASSETS is missing" }, 500);
  if (!["GET","HEAD"].includes(request.method)) return qgmJson({ ok:false, error:"Method not allowed" }, 405);

  const key = qgmSafeKey(url.pathname.slice("/assets/".length));
  if (!key) return qgmJson({ ok:false, error:"Invalid asset key" }, 400);

  const object = await env.ASSETS.get(key);
  if (!object) return qgmJson({ ok:false, error:"Asset not found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  headers.set("access-control-allow-origin", "*");

  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function qgmHandleAdmin(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { status:204, headers:QGM_ADMIN_CORS });

  if (!qgmIsAdmin(request, env)) {
    return qgmJson({ ok:false, error:"Unauthorized" }, 401);
  }

  if (url.pathname === "/admin/ping" && request.method === "GET") {
    return qgmJson({
      ok:true,
      admin:true,
      r2:Boolean(env.ASSETS),
      d1:Boolean(env.DB)
    });
  }

  if (url.pathname === "/admin/init" && request.method === "POST") {
    await qgmEnsureSchema(env);
    return qgmJson({ ok:true, schema:"ready" });
  }

  if (url.pathname === "/admin/assets" && request.method === "GET") {
    if (!env.ASSETS) return qgmJson({ ok:false, error:"R2 binding ASSETS is missing" }, 500);
    await qgmEnsureSchema(env);

    const prefix = url.searchParams.get("prefix") || "";
    const listed = await env.ASSETS.list({ prefix, limit:1000 });
    const keys = listed.objects.map(o => ({
      key:o.key,
      size:o.size,
      uploaded:o.uploaded,
      etag:o.etag
    }));
    return qgmJson({ ok:true, objects:keys, truncated:listed.truncated });
  }

  if (url.pathname.startsWith("/admin/assets/") && request.method === "PUT") {
    if (!env.ASSETS) return qgmJson({ ok:false, error:"R2 binding ASSETS is missing" }, 500);
    await qgmEnsureSchema(env);

    const key = qgmSafeKey(url.pathname.slice("/admin/assets/".length));
    if (!key) return qgmJson({ ok:false, error:"Invalid asset key" }, 400);

    const contentType = request.headers.get("Content-Type") || "application/octet-stream";
    if (!(contentType.startsWith("image/") || contentType.startsWith("audio/") || contentType === "application/octet-stream")) {
      return qgmJson({ ok:false, error:"Only image/audio files are allowed" }, 415);
    }

    const length = Number(request.headers.get("Content-Length") || 0);
    const MAX = 25 * 1024 * 1024;
    if (length > MAX) return qgmJson({ ok:false, error:"File too large. Max 25 MB." }, 413);

    const body = await request.arrayBuffer();
    if (!body.byteLength) return qgmJson({ ok:false, error:"Empty file" }, 400);
    if (body.byteLength > MAX) return qgmJson({ ok:false, error:"File too large. Max 25 MB." }, 413);

    const qid = (request.headers.get("X-QGM-QID") || "").trim().toUpperCase();
    const kind = (request.headers.get("X-QGM-Kind") || "other").trim().toLowerCase();
    const licenseStatus = (request.headers.get("X-QGM-License-Status") || "review").trim().toLowerCase();
    const licenseProvider = (request.headers.get("X-QGM-License-Provider") || "").trim();
    const licenseName = (request.headers.get("X-QGM-License-Name") || "").trim();
    const licenseSource = (request.headers.get("X-QGM-License-Source") || "").trim();
    const proofUrl = (request.headers.get("X-QGM-Proof-URL") || "").trim();

    await env.ASSETS.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { qid, kind, licenseStatus }
    });

    await env.DB.prepare(`
      INSERT INTO qgm_assets
        (asset_key,qid,kind,content_type,size_bytes,license_status,license_provider,license_name,license_source,proof_url,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(asset_key) DO UPDATE SET
        qid=excluded.qid,
        kind=excluded.kind,
        content_type=excluded.content_type,
        size_bytes=excluded.size_bytes,
        license_status=excluded.license_status,
        license_provider=excluded.license_provider,
        license_name=excluded.license_name,
        license_source=excluded.license_source,
        proof_url=excluded.proof_url,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      key, qid || null, kind, contentType, body.byteLength, licenseStatus,
      licenseProvider || null, licenseName || null, licenseSource || null, proofUrl || null
    ).run();

    return qgmJson({
      ok:true,
      key,
      size:body.byteLength,
      url:`${url.origin}/assets/${key.split("/").map(encodeURIComponent).join("/")}`
    }, 201);
  }

  if (url.pathname.startsWith("/admin/assets/") && request.method === "DELETE") {
    if (!env.ASSETS) return qgmJson({ ok:false, error:"R2 binding ASSETS is missing" }, 500);
    await qgmEnsureSchema(env);

    const key = qgmSafeKey(url.pathname.slice("/admin/assets/".length));
    if (!key) return qgmJson({ ok:false, error:"Invalid asset key" }, 400);

    await env.ASSETS.delete(key);
    await env.DB.prepare("DELETE FROM qgm_assets WHERE asset_key=?").bind(key).run();
    return qgmJson({ ok:true, deleted:key });
  }

  return qgmJson({ ok:false, error:"Admin route not found" }, 404);
}

// INSIDE your existing fetch(), immediately after:
// const url = new URL(request.url);
// add these two lines:
//
// if (url.pathname.startsWith("/assets/")) return qgmHandlePublicAsset(request, env, url);
// if (url.pathname.startsWith("/admin/")) return qgmHandleAdmin(request, env, url);
