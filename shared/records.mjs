// Contribution records from the drupal.org JSON:API view.
// https://www.drupal.org/drupalorg/docs/apis/rest-and-other-apis#s-contribution-records

import { fetchJson, pooled, PAGE_SIZE, MAX_PAGES, MAX_CONCURRENCY } from './fetch.mjs';

const VIEW = 'https://new.drupal.org/jsonapi/views/contribution_records/by_user';

function normalize(node) {
  const a = node.attributes;
  const url = a.field_source_link?.uri ?? null;
  return {
    nid: a.drupal_internal__nid,
    title: a.title,
    project: a.field_project_name,
    // The credit date — when the issue reached its final status, not when the record was created.
    credited: (a.field_last_status_change || a.changed).slice(0, 10),
    // The trailing number is a per-project work item id, NOT a drupal.org node id, so the
    // link has to be the source link itself: /i/<number> lands on an unrelated node.
    issue: /(\d+)\s*$/.exec(url || '')?.[1] ?? null,
    url,
  };
}

async function fetchPage(uid, page, months) {
  const params = new URLSearchParams({
    'views-argument[0]': uid,
    'views-filter[field_is_sa_value]': '0',
    page: String(page),
  });
  if (months) params.set('views-filter[last_status_change]', `${months} months ago`);
  const body = await fetchJson(`${VIEW}?${params}`);
  return { records: body.data.map(normalize), total: Number(body.meta?.count ?? 0) };
}

/**
 * Contribution records for a uid, security advisories excluded. Omit `months` for
 * all-time. Page 0 reveals the total, so the rest are fetched in parallel — sequential
 * paging would blow the function's time budget.
 */
export async function fetchRecords(uid, { months, from } = {}) {
  const first = await fetchPage(uid, 0, months);
  const pageCount = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES);
  const rest = await pooled(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => () => fetchPage(uid, i + 1, months)),
    MAX_CONCURRENCY,
  );
  const collected = [first, ...rest].flatMap((page) => page.records);
  // The upstream window is coarser than the requested range, so trim to the exact cutoff.
  const records = from ? collected.filter((record) => record.credited >= from) : collected;
  return {
    total: from ? records.length : first.total,
    truncated: collected.length < first.total,
    records,
  };
}
