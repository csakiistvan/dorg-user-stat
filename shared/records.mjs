// Contribution records from the drupal.org JSON:API view.
// https://www.drupal.org/drupalorg/docs/apis/rest-and-other-apis#s-contribution-records

import { fetchJson, PAGE_SIZE } from './fetch.mjs';

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
/**
 * One page of records. Collecting everything in a single request is what breaks on large
 * accounts: a cold page takes up to 7 seconds and four of them outlive the function, while
 * each page requested on its own comfortably fits. The client stitches the pages together.
 *
 * Pages are not strictly ordered by date, so there is no stopping early — the upstream
 * months window bounds the set and `from` trims it to the exact cutoff.
 */
export async function fetchRecords(uid, { months, from, page = 0 } = {}) {
  const { records, total } = await fetchPage(uid, page, months);
  const pageCount = Math.ceil(total / PAGE_SIZE);
  return {
    records: from ? records.filter((record) => record.credited >= from) : records,
    page,
    pageCount,
    total,
    hasMore: page + 1 < pageCount,
  };
}
