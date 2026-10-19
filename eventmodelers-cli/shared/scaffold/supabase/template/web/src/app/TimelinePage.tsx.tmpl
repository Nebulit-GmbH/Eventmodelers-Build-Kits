import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getReadModel, isNotBuilt } from '../lib/api';
import { NotBuilt } from '../lib/NotBuilt';
import { NotFound } from './NotFound';
import { PAGES, TIMELINES, type SliceInfo } from './model';

type Probe = { state: 'loading' } | { state: 'built'; rows: number } | { state: 'not-built' } | { state: 'error'; message: string };

// Asks the backend for a read model. A 501 means its slice is not built yet and shows as a placeholder.
function ReadModelStatus({ slice }: { slice: SliceInfo }) {
  const [probe, setProbe] = useState<Probe>({ state: 'loading' });
  const path = slice.endpoint!.replace(/^GET /, '');

  useEffect(() => {
    getReadModel<unknown>(path)
      .then((data) => setProbe({ state: 'built', rows: Array.isArray(data) ? data.length : data ? 1 : 0 }))
      .catch((err: unknown) =>
        setProbe(isNotBuilt(err) ? { state: 'not-built' } : { state: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, [path]);

  if (probe.state === 'loading') return <span className="tag">checking…</span>;
  if (probe.state === 'built') return <span className="tag is-success">built · {probe.rows} row{probe.rows === 1 ? '' : 's'}</span>;
  if (probe.state === 'not-built') return <NotBuilt compact />;
  return <span className="tag is-danger" title={probe.message}>error: {probe.message}</span>;
}

const TYPE_LABEL: Record<string, string> = { STATE_CHANGE: 'Command', STATE_VIEW: 'Read model', AUTOMATION: 'Automation' };

// Overview of one timeline: its pages and its slices, with a live 501 check for each read model.
export function TimelinePage() {
  const { slug } = useParams();
  const timeline = TIMELINES.find((t) => t.slug === slug);
  if (!timeline) return <NotFound />;

  const pages = PAGES.filter((p) => timeline.pages.includes(p.name));

  return (
    <>
      <h1 className="title">{timeline.title}</h1>

      <h2 className="title is-5">Pages</h2>
      {pages.length === 0 ? <p className="mb-5">This timeline has no screens.</p> : (
        <ul className="mb-5">
          {pages.map((p) => (
            <li key={p.name}>
              {p.hasParams ? <span>{p.title} <span className="has-text-grey">({p.route}, opened from another page)</span></span>
                : <Link to={p.route}>{p.title}</Link>}
            </li>
          ))}
        </ul>
      )}

      <h2 className="title is-5">Slices</h2>
      {timeline.slices.length === 0 ? <p>This timeline has no slices.</p> : (
        <table className="table is-fullwidth is-narrow">
          <thead><tr><th>Slice</th><th>Type</th><th>Endpoint</th><th>Status</th></tr></thead>
          <tbody>
            {timeline.slices.map((s) => (
              <tr key={s.title}>
                <td>{s.title}</td>
                <td>{TYPE_LABEL[s.type] ?? s.type}</td>
                <td><code>{s.endpoint ?? '—'}</code></td>
                <td>{s.type === 'STATE_VIEW' && s.endpoint ? <ReadModelStatus slice={s} /> : <span className="has-text-grey">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
