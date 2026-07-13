/**
 * Jobs E2E smoke test against local API.
 * Prefer: node scripts/run-e2e-jobs.cjs
 */
import mysql from "mysql2/promise";
import { signAccessToken } from "../src/utils/jwt.util";

const BASE = process.env.E2E_API_BASE || "http://127.0.0.1:4000/api";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

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
  opts: { token?: string; adminKey?: string; body?: unknown } = {}
) {
  const h: Record<string, string> = {};
  if (opts.body !== undefined) h["Content-Type"] = "application/json";
  if (opts.token) h.Authorization = `Bearer ${opts.token}`;
  if (opts.adminKey) h["X-Admin-Key"] = opts.adminKey;
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
  console.log(`\nJobs E2E → ${BASE}\n`);

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
     ORDER BY id ASC LIMIT 20`
  )) as any[];

  if (users.length < 2) {
    fail("Need 2 approved users in a community", `found=${users.length}`);
    await conn.end();
    printSummary();
    return;
  }

  let poster = users[0];
  let applicant =
    users.find((u: any) => u.id !== poster.id && u.community === poster.community) || null;
  if (!applicant) {
    // find any community with 2 users
    for (const u of users) {
      const peer = users.find((x: any) => x.id !== u.id && x.community === u.community);
      if (peer) {
        poster = u;
        applicant = peer;
        break;
      }
    }
  }
  if (!applicant) {
    fail("Need two users in same community", "none");
    await conn.end();
    printSummary();
    return;
  }

  ok("Poster selected", `id=${poster.id} community=${poster.community}`);
  ok("Applicant selected", `id=${applicant.id}`);

  const posterToken = signAccessToken({ userId: Number(poster.id) });
  const applicantToken = signAccessToken({ userId: Number(applicant.id) });

  const me = await api("GET", "/home/summary", { token: posterToken });
  assert("Poster JWT accepted", me.status === 200, `status=${me.status}`);

  // Salary validation: max < min
  const badSalary = await api("POST", "/posts", {
    token: posterToken,
    body: {
      post_type: "JOB",
      title: `E2E Job Bad Salary ${Date.now()}`,
      description: "Should fail salary validation.",
      job_status: "OPEN",
      job_company: "Test Co",
      job_location: "Erode",
      job_employment_type: "FULL_TIME",
      job_salary_min: 50000,
      job_salary_max: 10000
    }
  });
  assert(
    "Reject salary max < min",
    badSalary.status === 400,
    `status=${badSalary.status} ${badSalary.json?.message || ""}`
  );

  const title = `E2E Job ${Date.now()}`;
  const create = await api("POST", "/posts", {
    token: posterToken,
    body: {
      post_type: "JOB",
      title,
      description: "E2E job role details, requirements, and how to apply for testing.",
      job_status: "OPEN",
      job_company: "Infosense E2E",
      job_location: "Erode",
      job_employment_type: "FULL_TIME",
      job_salary_min: 30000,
      job_salary_max: 45000
    }
  });
  assert(
    "Create job → OPEN",
    create.status === 200 || create.status === 201,
    `status=${create.status} ${create.json?.message || ""}`
  );
  const postId = create.json?.id as number | undefined;
  assert("Create returns id", Boolean(postId), String(postId));
  assert("Create job_status OPEN", create.json?.job_status === "OPEN", create.json?.job_status);
  assert(
    "Create structured fields",
    create.json?.job_company === "Infosense E2E" &&
      create.json?.job_location === "Erode" &&
      create.json?.job_employment_type === "FULL_TIME" &&
      create.json?.job_salary_min === 30000 &&
      create.json?.job_salary_max === 45000,
    JSON.stringify({
      company: create.json?.job_company,
      location: create.json?.job_location,
      type: create.json?.job_employment_type,
      min: create.json?.job_salary_min,
      max: create.json?.job_salary_max
    })
  );

  // Browse open jobs
  const browse = await api(
    "GET",
    `/home/feed?limit=50&sort=recent&postType=JOB&jobStatus=open&page=1`,
    { token: applicantToken }
  );
  const inBrowse = (browse.json?.items || []).find((i: any) => i.postId === postId);
  assert("Open job visible in Jobs browse", Boolean(inBrowse), `items=${(browse.json?.items || []).length}`);
  if (inBrowse) {
    assert(
      "Browse shows job fields",
      inBrowse.jobCompany === "Infosense E2E" && inBrowse.jobLocation === "Erode",
      JSON.stringify({ company: inBrowse.jobCompany, location: inBrowse.jobLocation })
    );
  }

  // Detail as applicant
  const detail = await api("GET", `/posts/${postId}`, { token: applicantToken });
  assert("Applicant can open job detail", detail.status === 200, `status=${detail.status}`);
  assert(
    "Detail not interested yet",
    detail.json?.job_interested_by_me === false,
    String(detail.json?.job_interested_by_me)
  );

  // Own interest blocked
  const selfInterest = await api("POST", `/posts/${postId}/job-interest`, {
    token: posterToken,
    body: { message: "myself" }
  });
  assert(
    "Poster cannot interest own job",
    selfInterest.status === 400,
    `status=${selfInterest.status}`
  );

  // Express interest
  const interest = await api("POST", `/posts/${postId}/job-interest`, {
    token: applicantToken,
    body: { message: "Interested via E2E test" }
  });
  assert(
    "Applicant express interest",
    interest.status === 200 || interest.status === 201,
    `status=${interest.status} ${interest.text}`
  );
  assert(
    "Interest created flag",
    interest.json?.interested === true && interest.json?.created === true,
    JSON.stringify(interest.json)
  );

  // Idempotent second interest
  const interest2 = await api("POST", `/posts/${postId}/job-interest`, {
    token: applicantToken,
    body: { message: "again" }
  });
  assert(
    "Re-interest is idempotent",
    (interest2.status === 200 || interest2.status === 201) &&
      interest2.json?.interested === true &&
      interest2.json?.created === false,
    interest2.text
  );

  const detail2 = await api("GET", `/posts/${postId}`, { token: applicantToken });
  assert(
    "Detail shows interested + count",
    detail2.json?.job_interested_by_me === true &&
      Number(detail2.json?.job_interest_count) >= 1,
    JSON.stringify({
      interested: detail2.json?.job_interested_by_me,
      count: detail2.json?.job_interest_count
    })
  );

  // Poster lists interests
  const list = await api("GET", `/posts/${postId}/job-interests`, { token: posterToken });
  assert("Poster lists interests", list.status === 200, `status=${list.status}`);
  const items = list.json?.items || list.json?.interests || [];
  // Check response shape
  const interestItems = Array.isArray(items)
    ? items
    : Array.isArray(list.json)
      ? list.json
      : [];
  // listJobInterestsForOwner may return { items } or array via success spread
  const foundInterest =
    interestItems.length > 0
      ? interestItems
      : Array.isArray(list.json?.items)
        ? list.json.items
        : [];
  // Parse from full json
  let listed: any[] = [];
  if (Array.isArray(list.json?.items)) listed = list.json.items;
  else if (Array.isArray(list.json?.interests)) listed = list.json.interests;
  else if (Array.isArray(list.json)) listed = list.json;

  assert(
    "Interest list includes applicant",
    listed.some((i: any) => i.from_user_id === applicant.id || i.author?.id === applicant.id),
    `count=${listed.length} keys=${Object.keys(list.json || {}).join(",")}`
  );

  // Applicant cannot list interests
  const listForbidden = await api("GET", `/posts/${postId}/job-interests`, {
    token: applicantToken
  });
  assert(
    "Applicant cannot list interests",
    listForbidden.status === 403 || listForbidden.status === 400,
    `status=${listForbidden.status}`
  );

  // Poster closes job
  const close = await api("PUT", `/posts/${postId}`, {
    token: posterToken,
    body: { job_status: "CLOSED" }
  });
  assert(
    "Poster closes job",
    close.status === 200 && close.json?.job_status === "CLOSED",
    `status=${close.status} ${close.json?.job_status}`
  );

  const browseClosedFilter = await api(
    "GET",
    `/home/feed?limit=50&postType=JOB&jobStatus=open&page=1`,
    { token: applicantToken }
  );
  assert(
    "Closed job hidden from open filter",
    !(browseClosedFilter.json?.items || []).some((i: any) => i.postId === postId)
  );

  const interestClosed = await api("POST", `/posts/${postId}/job-interest`, {
    token: applicantToken,
    body: { message: "too late" }
  });
  assert(
    "Interest blocked on closed job",
    interestClosed.status === 400,
    `status=${interestClosed.status} ${interestClosed.json?.message || ""}`
  );

  // Poster reopens
  const reopen = await api("PUT", `/posts/${postId}`, {
    token: posterToken,
    body: { job_status: "OPEN" }
  });
  assert(
    "Poster reopens job",
    reopen.status === 200 && reopen.json?.job_status === "OPEN",
    reopen.json?.job_status
  );

  // Admin list / close / reopen
  const adminList = await api("GET", "/admin/jobs?status=open&limit=50", { adminKey: ADMIN_KEY });
  assert("Admin list open jobs", adminList.status === 200, `status=${adminList.status}`);
  assert(
    "Job in admin open list",
    (adminList.json?.jobs || []).some((j: any) => j.id === postId)
  );

  const adminClose = await api("POST", `/admin/jobs/${postId}/close`, {
    adminKey: ADMIN_KEY,
    body: {}
  });
  assert("Admin close job", adminClose.status === 200, adminClose.text);

  const adminReopen = await api("POST", `/admin/jobs/${postId}/reopen`, {
    adminKey: ADMIN_KEY,
    body: {}
  });
  assert("Admin reopen job", adminReopen.status === 200, adminReopen.text);

  // Update job fields
  const update = await api("PUT", `/posts/${postId}`, {
    token: posterToken,
    body: {
      title,
      description: "Updated E2E job description with more role details for applicants.",
      job_company: "Infosense E2E Updated",
      job_location: "Coimbatore",
      job_employment_type: "CONTRACT",
      job_salary_min: 35000,
      job_salary_max: 50000
    }
  });
  assert(
    "Poster updates job fields",
    update.status === 200 &&
      update.json?.job_company === "Infosense E2E Updated" &&
      update.json?.job_location === "Coimbatore" &&
      update.json?.job_employment_type === "CONTRACT",
    `status=${update.status}`
  );

  // Mine filter
  const mine = await api(
    "GET",
    `/home/feed?limit=20&postType=JOB&mine=true&page=1`,
    { token: posterToken }
  );
  assert(
    "Mine jobs includes listing",
    (mine.json?.items || []).some((i: any) => i.postId === postId)
  );

  // Cleanup via admin delete
  const del = await api("DELETE", `/admin/jobs/${postId}`, { adminKey: ADMIN_KEY });
  assert("Admin delete job", del.status === 200, del.text);

  const gone = await api("GET", `/posts/${postId}`, { token: posterToken });
  assert("Deleted job not found", gone.status === 404, `status=${gone.status}`);

  await conn.end();
  printSummary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
