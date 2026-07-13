/**
 * Helping Hands E2E smoke against local API.
 * Prefer: node scripts/run-e2e-helping-hands.cjs
 */
import mysql from "mysql2/promise";
import { signAccessToken } from "../src/utils/jwt.util";

const BASE = process.env.E2E_API_BASE || "http://127.0.0.1:4000/api";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function ok(name: string, detail?: string) {
  results.push({ name, pass: true, detail });
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail?: string) {
  results.push({ name, pass: false, detail });
  console.error(`❌ ${name} — ${detail}`);
}
function assert(name: string, cond: unknown, detail?: string) {
  if (cond) ok(name, detail);
  else fail(name, detail || "assertion failed");
}

async function api(
  method: string,
  urlPath: string,
  opts: { token?: string; body?: unknown } = {}
) {
  const h: Record<string, string> = {};
  if (opts.body !== undefined) h["Content-Type"] = "application/json";
  if (opts.token) h.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: h,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

function printSummary() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n——— Summary: ${passed} passed, ${failed} failed ———\n`);
  if (failed) process.exitCode = 1;
}

async function main() {
  console.log(`\nHelping Hands E2E → ${BASE}\n`);

  const health = await api("GET", "/health");
  assert("API health", health.status === 200, `status=${health.status}`);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const [users] = (await conn.query(
    `SELECT id, fullName, community, status FROM users
     WHERE status = 'APPROVED' AND community IS NOT NULL AND community <> ''
     ORDER BY id ASC LIMIT 30`
  )) as any[];

  if (users.length < 2) {
    fail("Need 2 approved users in a community", `found=${users.length}`);
    await conn.end();
    printSummary();
    return;
  }

  let requester = users[0];
  let helper =
    users.find((u: any) => u.id !== requester.id && u.community === requester.community) || null;
  if (!helper) {
    for (const u of users) {
      const peer = users.find((x: any) => x.id !== u.id && x.community === u.community);
      if (peer) {
        requester = u;
        helper = peer;
        break;
      }
    }
  }
  if (!helper) {
    fail("Need two users in same community", "none");
    await conn.end();
    printSummary();
    return;
  }

  ok("Requester selected", `id=${requester.id} community=${requester.community}`);
  ok("Helper selected", `id=${helper.id}`);

  const requesterToken = signAccessToken({ userId: Number(requester.id) });
  const helperToken = signAccessToken({ userId: Number(helper.id) });

  const me = await api("GET", "/home/summary", { token: requesterToken });
  assert("Requester JWT accepted", me.status === 200, `status=${me.status}`);

  // Stats endpoint
  const stats = await api("GET", "/helping-hands/stats", { token: requesterToken });
  assert(
    "GET /helping-hands/stats",
    stats.status === 200 && typeof stats.json?.peopleHelped === "number",
    `status=${stats.status} body=${JSON.stringify(stats.json)?.slice(0, 120)}`
  );

  // Validation: short description rejected
  const badCreate = await api("POST", "/posts", {
    token: requesterToken,
    body: {
      post_type: "HELP_REQUEST",
      title: "Need help",
      description: "too short",
      help_category: "MEDICAL",
      help_urgency: "URGENT",
      help_location: "Erode",
      help_contact_phone: "9876543210"
    }
  });
  assert(
    "Reject short description",
    badCreate.status === 400,
    `status=${badCreate.status} ${badCreate.json?.message || ""}`
  );

  // Validation: missing category
  const badCat = await api("POST", "/posts", {
    token: requesterToken,
    body: {
      post_type: "HELP_REQUEST",
      title: "Need medical help soon",
      description: "Need community support for an urgent medical appointment tomorrow morning.",
      help_urgency: "URGENT",
      help_location: "Erode",
      help_contact_phone: "9876543210"
    }
  });
  assert(
    "Reject missing category",
    badCat.status === 400,
    `status=${badCat.status} ${badCat.json?.message || ""}`
  );

  const title = `E2E Help ${Date.now()}`;
  const create = await api("POST", "/posts", {
    token: requesterToken,
    body: {
      post_type: "HELP_REQUEST",
      title,
      description:
        "Need community support for an urgent medical appointment tomorrow morning. Looking for transport help.",
      help_category: "MEDICAL",
      help_urgency: "URGENT",
      help_location: "Erode",
      help_contact_phone: "9876543210",
      urgent: true
    }
  });
  assert(
    "Create HELP_REQUEST",
    create.status === 200 || create.status === 201,
    `status=${create.status} ${create.json?.message || ""}`
  );
  const postId = create.json?.id as number | undefined;
  assert("Create returns id", Boolean(postId), String(postId));
  assert("help_status OPEN", create.json?.help_status === "OPEN", create.json?.help_status);
  assert(
    "help fields persisted",
    create.json?.help_category === "MEDICAL" &&
      create.json?.help_urgency === "URGENT" &&
      create.json?.help_location === "Erode" &&
      create.json?.help_contact_phone === "9876543210",
    JSON.stringify({
      category: create.json?.help_category,
      urgency: create.json?.help_urgency,
      location: create.json?.help_location,
      phone: create.json?.help_contact_phone
    })
  );

  // Browse feed — should appear
  const browse = await api(
    "GET",
    `/home/feed?limit=50&sort=recent&postType=HELP_REQUEST&page=1`,
    { token: helperToken }
  );
  const inBrowse = (browse.json?.items || []).find((i: any) => i.postId === postId);
  assert("Appears in help feed", Boolean(inBrowse), `found=${Boolean(inBrowse)}`);
  assert(
    "Feed has help fields",
    inBrowse?.helpCategory === "MEDICAL" && inBrowse?.helpUrgency === "URGENT",
    JSON.stringify({
      cat: inBrowse?.helpCategory,
      urg: inBrowse?.helpUrgency,
      helpers: inBrowse?.helpHelperCount
    })
  );

  // Category filter
  const filtered = await api(
    "GET",
    `/home/feed?limit=50&sort=recent&postType=HELP_REQUEST&helpCategory=MEDICAL&page=1`,
    { token: helperToken }
  );
  assert(
    "Category filter includes post",
    (filtered.json?.items || []).some((i: any) => i.postId === postId),
    `total=${filtered.json?.items?.length}`
  );

  const foodOnly = await api(
    "GET",
    `/home/feed?limit=50&sort=recent&postType=HELP_REQUEST&helpCategory=FOOD&page=1`,
    { token: helperToken }
  );
  assert(
    "FOOD filter excludes MEDICAL post",
    !(foodOnly.json?.items || []).some((i: any) => i.postId === postId),
    "ok"
  );

  // Get post detail
  const detail = await api("GET", `/posts/${postId}`, { token: helperToken });
  assert(
    "Get post detail",
    detail.status === 200 && detail.json?.help_status === "OPEN",
    `status=${detail.status}`
  );
  assert(
    "Detail helper count 0",
    detail.json?.help_helper_count === 0,
    String(detail.json?.help_helper_count)
  );

  // Cannot offer on own request
  const selfOffer = await api("POST", `/helping-hands/requests/${postId}/offer`, {
    token: requesterToken,
    body: {}
  });
  assert(
    "Reject self offer",
    selfOffer.status === 400,
    `status=${selfOffer.status} ${selfOffer.json?.message || ""}`
  );

  // Offer help
  const offer = await api("POST", `/helping-hands/requests/${postId}/offer`, {
    token: helperToken,
    body: { message: "I can help with transport." }
  });
  assert(
    "Offer help",
    (offer.status === 200 || offer.status === 201) && offer.json?.offered === true,
    `status=${offer.status} ${offer.json?.message || ""}`
  );
  assert(
    "Offer returns requester + phone",
    offer.json?.requesterUserId === requester.id &&
      offer.json?.canMessage === true &&
      offer.json?.contactPhone === "9876543210",
    JSON.stringify({
      requester: offer.json?.requesterUserId,
      phone: offer.json?.contactPhone
    })
  );

  // Status moved to IN_PROGRESS
  const afterOffer = await api("GET", `/posts/${postId}`, { token: requesterToken });
  assert(
    "Status IN_PROGRESS after offer",
    afterOffer.json?.help_status === "IN_PROGRESS",
    afterOffer.json?.help_status
  );
  assert(
    "Helper count >= 1",
    (afterOffer.json?.help_helper_count ?? 0) >= 1,
    String(afterOffer.json?.help_helper_count)
  );
  assert(
    "offered_by_me for helper",
    (
      await api("GET", `/posts/${postId}`, { token: helperToken })
    ).json?.help_offered_by_me === true,
    "ok"
  );

  // Idempotent re-offer
  const reOffer = await api("POST", `/helping-hands/requests/${postId}/offer`, {
    token: helperToken,
    body: {}
  });
  assert(
    "Re-offer is idempotent",
    (reOffer.status === 200 || reOffer.status === 201) && reOffer.json?.created === false,
    `created=${reOffer.json?.created}`
  );

  // List helpers
  const helpers = await api("GET", `/helping-hands/requests/${postId}/helpers`, {
    token: requesterToken
  });
  assert(
    "List helpers",
    helpers.status === 200 && (helpers.json?.total ?? 0) >= 1,
    `total=${helpers.json?.total}`
  );
  const helperUserId = helpers.json?.items?.[0]?.from_user_id as number | undefined;
  assert("Helper user id", helperUserId === helper.id, String(helperUserId));

  // Non-owner cannot complete
  const badComplete = await api("POST", `/helping-hands/requests/${postId}/complete`, {
    token: helperToken,
    body: {}
  });
  assert(
    "Reject complete by non-owner",
    badComplete.status === 403,
    `status=${badComplete.status}`
  );

  // Complete + appreciate
  const complete = await api("POST", `/helping-hands/requests/${postId}/complete`, {
    token: requesterToken,
    body: {
      helper_user_id: helperUserId,
      appreciation: "Because of your support, the appointment went smoothly. Thank you."
    }
  });
  assert(
    "Complete + appreciate",
    complete.status === 200 &&
      complete.json?.status === "COMPLETED" &&
      complete.json?.appreciationSaved === true,
    JSON.stringify({
      status: complete.json?.status,
      appreciationSaved: complete.json?.appreciationSaved,
      message: complete.json?.message
    })
  );

  const completedDetail = await api("GET", `/posts/${postId}`, { token: helperToken });
  assert(
    "Detail shows COMPLETED",
    completedDetail.json?.help_status === "COMPLETED",
    completedDetail.json?.help_status
  );

  // Completed should not appear in public browse
  const browseAfter = await api(
    "GET",
    `/home/feed?limit=50&sort=recent&postType=HELP_REQUEST&page=1`,
    { token: helperToken }
  );
  assert(
    "Completed hidden from public browse",
    !(browseAfter.json?.items || []).some((i: any) => i.postId === postId),
    "ok"
  );

  // Mine feed still sees it
  const mine = await api(
    "GET",
    `/home/feed?limit=50&sort=recent&postType=HELP_REQUEST&mine=1&helpStatus=all&page=1`,
    { token: requesterToken }
  );
  assert(
    "Owner mine feed includes completed",
    (mine.json?.items || []).some((i: any) => i.postId === postId),
    `total=${mine.json?.items?.length}`
  );

  // Heroes
  const heroes = await api("GET", "/helping-hands/heroes?limit=20", { token: requesterToken });
  assert("Heroes list", heroes.status === 200 && Array.isArray(heroes.json?.items), `status=${heroes.status}`);
  const hero = (heroes.json?.items || []).find((h: any) => h.userId === helper.id);
  assert(
    "Helper appears as hero",
    Boolean(hero) && (hero?.livesHelped ?? 0) >= 1,
    JSON.stringify(hero || {})
  );
  assert(
    "Hero has appreciation",
    Boolean(hero?.recentAppreciation),
    hero?.recentAppreciation?.slice?.(0, 60)
  );

  // My activity
  const activityA = await api("GET", "/helping-hands/my-activity", { token: requesterToken });
  assert(
    "Requester activity has request",
    (activityA.json?.requests || []).some((r: any) => r.postId === postId && r.status === "COMPLETED"),
    "ok"
  );

  const activityB = await api("GET", "/helping-hands/my-activity", { token: helperToken });
  const contrib = (activityB.json?.contributions || []).find((c: any) => c.postId === postId);
  assert("Helper activity has contribution", Boolean(contrib), "ok");
  assert(
    "Contribution has appreciation",
    Boolean(contrib?.appreciation),
    contrib?.appreciation?.slice?.(0, 60)
  );

  // Cannot offer after completed
  const lateOffer = await api("POST", `/helping-hands/requests/${postId}/offer`, {
    token: helperToken,
    body: {}
  });
  assert(
    "Reject offer on completed",
    lateOffer.status === 400,
    `status=${lateOffer.status}`
  );

  // Cleanup
  await conn.query("DELETE FROM help_appreciations WHERE postId = ?", [postId]);
  await conn.query("DELETE FROM help_offers WHERE postId = ?", [postId]);
  await conn.query("DELETE FROM posts WHERE id = ?", [postId]);
  ok("Cleanup test post", `postId=${postId}`);

  await conn.end();
  printSummary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
