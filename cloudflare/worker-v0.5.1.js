const ACCOUNT_ID = 42168;
const TIKTOK_UNIQUE_ID = "the_quizgame_master";
const STATE_KEY = "qgm:state:v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://brixmon.github.io",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

const DEFAULT_SETTINGS = {
  answerTime: 30,
  questionsPerRound: 20,
  percentSeconds: 4,
  playerResultsSeconds: 5.5,
  factSeconds: 7,
  leaderboardSeconds: 12,
  categories: []
};

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function sanitizeSettings(input = {}) {
  return {
    answerTime: clampNumber(input.answerTime, 5, 120, DEFAULT_SETTINGS.answerTime),
    questionsPerRound: Math.round(clampNumber(input.questionsPerRound, 1, 100, DEFAULT_SETTINGS.questionsPerRound)),
    percentSeconds: clampNumber(input.percentSeconds, 2, 30, DEFAULT_SETTINGS.percentSeconds),
    playerResultsSeconds: clampNumber(input.playerResultsSeconds, 2, 30, DEFAULT_SETTINGS.playerResultsSeconds),
    factSeconds: clampNumber(input.factSeconds, 2, 30, DEFAULT_SETTINGS.factSeconds),
    leaderboardSeconds: clampNumber(input.leaderboardSeconds, 3, 60, DEFAULT_SETTINGS.leaderboardSeconds),
    categories: Array.isArray(input.categories)
      ? input.categories.filter(x => typeof x === "string").slice(0, 20)
      : []
  };
}

function sanitizePlayers(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const out = {};
  for (const [key, value] of Object.entries(input).slice(0, 5000)) {
    if (!key || key.length > 160 || !value || typeof value !== "object") continue;

    const points = Math.round(clampNumber(value.points, -1000000, 1000000, 0));
    const name = String(value.name || "PLAYER").slice(0, 80);
    let avatar = typeof value.avatar === "string" ? value.avatar.slice(0, 2048) : "";

    if (avatar && !/^https?:\/\//i.test(avatar)) avatar = "";

    out[key] = { points, name, avatar };
  }
  return out;
}

async function createEulerJWT(env) {
  if (!env.EULER_API_KEY) {
    throw new Error("EULER_API_KEY secret is missing");
  }

  const response = await fetch(
    `https://api.eulerstream.com/accounts/${ACCOUNT_ID}/jwt/create`,
    {
      method: "POST",
      headers: {
        "X-Api-Key": env.EULER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "QuizGameMaster LIVE",
        expireAfter: 7200,
        websockets: {
          allowedCreators: [TIKTOK_UNIQUE_ID],
          maxWebSockets: 2
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.token) {
    console.log("Euler JWT request failed:", response.status, data?.code, data?.message);
    throw new Error("EulerStream JWT creation failed");
  }

  return data.token;
}

async function readState(env) {
  if (!env.QGM_DATA) {
    return {
      ok: false,
      status: 503,
      body: { ok: false, code: "storage_not_configured", message: "QGM_DATA KV binding is missing" }
    };
  }

  const raw = await env.QGM_DATA.get(STATE_KEY);

  if (!raw) {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        hasState: false,
        settings: DEFAULT_SETTINGS,
        players: {},
        updatedAt: null
      }
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        hasState: true,
        settings: sanitizeSettings(parsed.settings),
        players: sanitizePlayers(parsed.players),
        updatedAt: parsed.updatedAt || null
      }
    };
  } catch {
    return {
      ok: false,
      status: 500,
      body: { ok: false, message: "Stored game state is invalid" }
    };
  }
}

async function writeState(request, env) {
  if (!env.QGM_DATA) {
    return {
      status: 503,
      body: { ok: false, code: "storage_not_configured", message: "QGM_DATA KV binding is missing" }
    };
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > 500000) {
    return { status: 413, body: { ok: false, message: "Game state payload is too large" } };
  }

  const input = await request.json();
  const state = {
    settings: sanitizeSettings(input?.settings),
    players: sanitizePlayers(input?.players),
    updatedAt: new Date().toISOString()
  };

  const encoded = JSON.stringify(state);
  if (encoded.length > 500000) {
    return { status: 413, body: { ok: false, message: "Game state payload is too large" } };
  }

  await env.QGM_DATA.put(STATE_KEY, encoded);

  return {
    status: 200,
    body: {
      ok: true,
      updatedAt: state.updatedAt,
      playerCount: Object.keys(state.players).length
    }
  };
}

async function fetchEulerProfile(uniqueId, env) {
  if (!env.EULER_API_KEY) {
    throw new Error("EULER_API_KEY secret is missing");
  }

  const response = await fetch(
    `https://api.eulerstream.com/tiktok/users/${encodeURIComponent(uniqueId)}/basic`,
    {
      headers: {
        "X-Api-Key": env.EULER_API_KEY
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return Response.json(
      {
        ok: false,
        code: data?.code,
        message: data?.message || "Euler profile request failed"
      },
      { status: response.status, headers: corsHeaders }
    );
  }

  return Response.json(
    {
      ok: true,
      user: data?.user || null
    },
    { headers: corsHeaders }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (url.pathname === "/") {
      return new Response(
        "QuizGameMaster Bridge ONLINE",
        { headers: { "content-type": "text/plain; charset=UTF-8" } }
      );
    }

    if (url.pathname === "/test-token") {
      try {
        await createEulerJWT(env);

        return Response.json(
          { ok: true, message: "EulerStream JWT created successfully" },
          { headers: corsHeaders }
        );
      } catch (error) {
        console.log("JWT test failed:", error.message);

        return Response.json(
          { ok: false, message: error.message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    if (url.pathname === "/token") {
      try {
        const token = await createEulerJWT(env);

        return Response.json(
          { ok: true, token },
          { headers: corsHeaders }
        );
      } catch (error) {
        console.log("Token endpoint failed:", error.message);

        return Response.json(
          { ok: false, message: "Unable to create EulerStream token" },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    if (url.pathname === "/profile" && request.method === "GET") {
      const uniqueId = String(url.searchParams.get("uniqueId") || "").replace(/^@/, "").trim();

      if (!uniqueId || uniqueId.length > 80) {
        return Response.json(
          { ok: false, message: "Invalid TikTok uniqueId" },
          { status: 400, headers: corsHeaders }
        );
      }

      try {
        return await fetchEulerProfile(uniqueId, env);
      } catch (error) {
        return Response.json(
          { ok: false, message: error.message },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    if (url.pathname === "/game/state" && request.method === "GET") {
      const result = await readState(env);
      return Response.json(result.body, {
        status: result.status,
        headers: corsHeaders
      });
    }

    if (url.pathname === "/game/state" && request.method === "PUT") {
      try {
        const result = await writeState(request, env);
        return Response.json(result.body, {
          status: result.status,
          headers: corsHeaders
        });
      } catch (error) {
        return Response.json(
          { ok: false, message: "Unable to save game state" },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return new Response("Not found", { status: 404 });
  }
};
