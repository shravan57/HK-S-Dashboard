// netlify/functions/save-data.js
//
// Merges incoming upload data with the existing data.json in your GitHub repo.
// Rules:
//   - Biometric days: merge by date. Same date = overwrite (latest upload wins).
//   - Feedback rows:  merge by unique key (dateISO + branch + subType). Same key = overwrite.
//   - Tech tracker:   passed through as-is (managed via UI edits, not uploads).
//   - Deployed log:   passed through as-is.
//
// Environment variables required (set in Netlify dashboard):
//   GITHUB_TOKEN  — Personal Access Token with repo scope
//   GITHUB_REPO   — e.g. "yourusername/hks-dashboard"

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO  = process.env.GITHUB_REPO;
  const FILE_PATH    = 'hks-dashboard/data/data.json'; // full path from repo root
  const BRANCH       = 'main';

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Missing GITHUB_TOKEN or GITHUB_REPO env vars. Check Netlify site settings.',
        hint: 'Go to Netlify → Site configuration → Environment variables'
      }),
    };
  }

  // Debug: log what we're working with (token is masked for security)
  const debugInfo = {
    repo: GITHUB_REPO,
    filePath: FILE_PATH,
    branch: BRANCH,
    tokenPresent: !!GITHUB_TOKEN,
    tokenPrefix: GITHUB_TOKEN ? GITHUB_TOKEN.substring(0, 4) + '...' : 'MISSING'
  };

  // Parse the incoming payload from the dashboard
  // Shape: { bio?: {...}, fb?: {...}, tech?: [...], dep?: [...], lastUpdated: string }
  let incoming;
  try {
    incoming = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;
  const ghHeaders = {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  // ── Step 1: Fetch existing data.json from GitHub ──────────────────────────
  let existing = null;
  let sha = null;

  try {
    const getRes = await fetch(`${apiBase}?ref=${BRANCH}`, { headers: ghHeaders });
    if (getRes.ok) {
      const fileInfo = await getRes.json();
      sha = fileInfo.sha;
      // Content is base64-encoded
      const decoded = Buffer.from(fileInfo.content, 'base64').toString('utf8');
      existing = JSON.parse(decoded);
    }
    // 404 = file doesn't exist yet, we'll create it fresh
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Failed to read existing data from GitHub', detail: e.message }),
    };
  }

  // ── Step 2: Merge incoming data with existing ─────────────────────────────
  const merged = mergData(existing, incoming);

  // ── Step 3: Commit merged data back to GitHub ─────────────────────────────
  const newContent = Buffer.from(JSON.stringify(merged, null, 2)).toString('base64');
  const now = new Date().toISOString();

  const putBody = {
    message: `Dashboard update — ${now}`,
    content: newContent,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: ghHeaders,
    body: JSON.stringify(putBody),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    return {
      statusCode: putRes.status,
      headers,
      body: JSON.stringify({
        error: 'GitHub commit failed',
        detail: errText,
        debug: debugInfo
      }),
    };
  }

  // Return merge summary so the dashboard can show a helpful message
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      committed: now,
      summary: merged._mergeSummary || {},
    }),
  };
};


// ══════════════════════════════════════════════════════════════════════════════
// MERGE LOGIC
// ══════════════════════════════════════════════════════════════════════════════

function mergData(existing, incoming) {
  const summary = {};

  // ── Biometric: merge daily rows by date ───────────────────────────────────
  let mergedBio = existing ? { ...existing.bio } : { totalUniqueBranches: 0, daily: [] };

  if (incoming.bio && incoming.bio.daily) {
    const existingByDate = {};
    (mergedBio.daily || []).forEach(d => { existingByDate[d.date] = d; });

    let newDays = 0, updatedDays = 0;

    incoming.bio.daily.forEach(d => {
      if (existingByDate[d.date]) {
        updatedDays++;
      } else {
        newDays++;
      }
      existingByDate[d.date] = d; // overwrite on duplicate
    });

    // Re-sort chronologically
    mergedBio.daily = Object.values(existingByDate).sort((a, b) => a.date.localeCompare(b.date));

    // Recompute totalUniqueBranches as the max single-day branch count
    // (we can't truly deduplicate across days without branch-level data)
    mergedBio.totalUniqueBranches = incoming.bio.totalUniqueBranches || mergedBio.totalUniqueBranches;

    summary.bio = {
      newDays,
      updatedDays,
      totalDays: mergedBio.daily.length,
    };
  }

  // ── Feedback: merge raw rows by composite key ─────────────────────────────
  let mergedFb = existing ? { ...existing.fb } : null;

  if (incoming.fb) {
    if (!mergedFb) {
      // No existing feedback — just use incoming
      mergedFb = incoming.fb;
      summary.fb = { newRows: (incoming.fb.rawRows || []).length, updatedRows: 0 };
    } else {
      // Merge rawRows if present (uploaded via Excel)
      const incomingRawRows = incoming.fb.rawRows || [];

      if (incomingRawRows.length > 0) {
        const existingRows = mergedFb.rawRows || [];

        // Key = dateISO + '|' + branch + '|' + subType + '|' + designation
        // This uniquely identifies a form submission
        const existingByKey = {};
        existingRows.forEach(r => {
          const key = `${r.dateISO}|${r.branch}|${r.subType}|${r.designation}`;
          existingByKey[key] = r;
        });

        let newRows = 0, updatedRows = 0;

        incomingRawRows.forEach(r => {
          const key = `${r.dateISO}|${r.branch}|${r.subType}|${r.designation}`;
          if (existingByKey[key]) {
            updatedRows++;
          } else {
            newRows++;
          }
          existingByKey[key] = r; // overwrite on duplicate
        });

        const allRows = Object.values(existingByKey);

        // Re-aggregate summary stats from the full merged row set
        mergedFb = reAggregateFb(allRows, mergedFb);
        summary.fb = { newRows, updatedRows, totalRows: allRows.length };
      } else {
        // No rawRows in incoming — just update the summary stats
        mergedFb = { ...mergedFb, ...incoming.fb };
        summary.fb = { note: 'Summary stats updated (no raw rows)' };
      }
    }
  }

  // ── Tech tracker and deployed log: passed through from incoming if provided,
  //    otherwise keep existing. These are UI-managed, not Excel-uploaded.
  const mergedTech  = incoming.tech  || (existing ? existing.tech  : []);
  const mergedDep   = incoming.dep   || (existing ? existing.dep   : []);

  const result = {
    lastUpdated: incoming.lastUpdated || new Date().toISOString(),
    bio: mergedBio,
    fb: mergedFb,
    tech: mergedTech,
    dep: mergedDep,
    _mergeSummary: summary,
  };

  return result;
}


// Re-aggregate feedback summary stats from the full set of raw rows
function reAggregateFb(rows, existingFb) {
  const total     = rows.length;
  const submitted = rows.filter(r => r.isSubmitted).length;
  const overdue   = rows.filter(r => r.isOverdue).length;
  const branches  = new Set(rows.map(r => r.branch).filter(Boolean)).size;
  const overdueDays = rows.filter(r => r.daysOverdue > 0).map(r => r.daysOverdue);
  const avgOverdue  = overdueDays.length > 0
    ? parseFloat((overdueDays.reduce((a, b) => a + b, 0) / overdueDays.length).toFixed(1))
    : 0;

  // Sub-type breakdown
  const bySubType = {};
  rows.forEach(r => {
    const st = r.subType || 'Other';
    if (!bySubType[st]) bySubType[st] = { total: 0, submitted: 0 };
    bySubType[st].total++;
    if (r.isSubmitted) bySubType[st].submitted++;
  });

  const find = (kws) => {
    for (const k of Object.keys(bySubType)) {
      if (kws.some(w => k.toLowerCase().includes(w))) return bySubType[k];
    }
    return { total: 0, submitted: 0 };
  };

  const hk = find(['housekeeping', 'hk']);
  const sg = find(['security', 'sg']);
  const wk = find(['weekly', 'week']);

  return {
    total, submitted, overdue, branches, avgOverdue,
    hkTotal:       hk.total,
    hkSubmitted:   hk.submitted,
    sgTotal:       sg.total,
    sgSubmitted:   sg.submitted,
    weeklyTotal:   wk.total,
    weeklySubmitted: wk.submitted,
    bySubType,
    rawRows: rows, // keep full row set for client-side date filtering
  };
}
