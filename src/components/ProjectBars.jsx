/** Horizontal bars of project machine name to issue count, with linked issue chips. */
export default function ProjectBars({ entries, accent = false }) {
  const max = Math.max(...entries.map(([, issues]) => issues.length));
  return (
    <div className={accent ? 'hbars accent' : 'hbars'}>
      {entries.map(([project, issues]) => (
        <div className="row" key={project}>
          <div className="n">
            <a href={`https://www.drupal.org/project/${project}`} target="_blank" rel="noopener">
              {project}
            </a>
          </div>
          <div>
            <div className="t" style={{ width: `${(issues.length / max) * 100}%` }} />
          </div>
          <div className="v">{issues.length}</div>
          <div className="issues">
            {issues.map(({ issue, url }) => (
              // Each chip links to its own source: the number is a per-project work item id,
              // so a constructed drupal.org/i/<number> link can land on an unrelated node.
              <a key={issue} href={url} target="_blank" rel="noopener">
                #{issue}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
