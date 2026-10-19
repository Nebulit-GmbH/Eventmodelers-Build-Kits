import { matchPath, NavLink, Outlet, useLocation } from 'react-router-dom';
import { APP_TITLE, PAGES, TIMELINES } from './model';

type LayoutProps = {
  email: string | undefined;
  onSignOut: () => void;
};

// Main container: one navigation entry per timeline in the event model.
export function Layout({ email, onSignOut }: LayoutProps) {
  const { pathname } = useLocation();
  // A timeline stays active on its overview and on any of its pages.
  const activeTimeline = TIMELINES.find((t) =>
    matchPath(`/timelines/${t.slug}`, pathname) ||
    PAGES.some((p) => t.pages.includes(p.name) && matchPath(p.route, pathname)),
  );

  return (
    <>
      <nav className="navbar is-light" aria-label="main navigation">
        <div className="navbar-brand">
          <NavLink to="/" className="navbar-item has-text-weight-bold">{APP_TITLE}</NavLink>
        </div>
        <div className="navbar-menu is-active">
          <div className="navbar-start">
            {TIMELINES.map((t) => (
              <NavLink key={t.slug} to={`/timelines/${t.slug}`}
                className={`navbar-item${t === activeTimeline ? ' is-active has-text-weight-semibold' : ''}`}>
                {t.title}
              </NavLink>
            ))}
          </div>
          <div className="navbar-end">
            <div className="navbar-item">{email}</div>
            <div className="navbar-item">
              <button className="button is-light" onClick={onSignOut}>Sign out</button>
            </div>
          </div>
        </div>
      </nav>
      <section className="section">
        <div className="container">
          <Outlet />
        </div>
      </section>
    </>
  );
}
