import { useState } from 'react';
import { formatMonth, monthSequence } from '../aggregate.js';

/**
 * Month histogram with a year filter. Newest month first, so the axis reads right to left.
 * Clicking a bar selects that month; clicking it again clears the selection.
 */
export default function MonthlyBars({ months, second, secondLabel, selected, onSelect }) {
  const sequence = monthSequence({ ...second, ...months });
  const years = [...new Set(sequence.map((key) => key.slice(0, 4)))].sort().reverse();
  // The sequence always runs to the current month, so the current year leads the list and is
  // the default. A year held over from another user may not exist here — fall back to it too.
  const [selectedYear, setYear] = useState(null);
  const year = selectedYear && [...years, 'ALL'].includes(selectedYear) ? selectedYear : years[0];
  const [tip, setTip] = useState(null);

  const visible = (year === 'ALL' ? sequence : sequence.filter((key) => key.startsWith(`${year}-`)))
    .slice()
    .reverse();
  // One shared scale, so the two series stay comparable.
  const max = Math.max(1, ...visible.map((key) => Math.max(months[key] || 0, second?.[key] || 0)));
  const dense = visible.length > 24;
  const minWidth = dense ? `${visible.length * 10}px` : 'auto';

  return (
    <>
      {second && (
        <p className="legend">
          <span>
            <i style={{ background: 'var(--series-1)' }} />
            Contribution records
          </span>
          <span>
            <i style={{ background: 'var(--series-2)' }} />
            {secondLabel}
          </span>
        </p>
      )}
      <div className="years" role="group" aria-label="Filter by year">
        {[...years, 'ALL'].map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === year}
            onClick={() => {
              setYear(option);
              onSelect(null);
            }}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="plot">
        <div className="bars" style={{ minWidth }}>
          {visible.map((key) => {
            const value = months[key] || 0;
            const secondValue = second?.[key] || 0;
            const summary = `${formatMonth(key)} — ${value} record${value === 1 ? '' : 's'}${
              second ? `, ${secondValue} uncredited` : ''
            }`;
            return (
              <button
                key={key}
                type="button"
                className={selected && key !== selected ? 'bar muted' : 'bar'}
                aria-pressed={key === selected}
                aria-label={summary}
                disabled={!value && !secondValue}
                onClick={() => onSelect(key === selected ? null : key)}
                onMouseMove={(event) =>
                  setTip({ x: event.clientX, y: event.clientY, text: summary })
                }
                onMouseLeave={() => setTip(null)}
              >
                <i style={{ height: `${(value / max) * 100}%` }} />
                {second && <i className="t" style={{ height: `${(secondValue / max) * 100}%` }} />}
              </button>
            );
          })}
        </div>
        <div className="xaxis" style={{ minWidth }}>
          {visible.map((key) => (
            <span key={key}>
              {dense ? key.endsWith('-01') && key.slice(0, 4) : formatMonth(key, { month: 'short' })}
            </span>
          ))}
        </div>
      </div>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 170), top: tip.y - 34 }}>
          {tip.text}
        </div>
      )}
    </>
  );
}
