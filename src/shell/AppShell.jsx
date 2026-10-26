/* The application shell: branding, navigation, theme toggle, breadcrumbs,
 * page header and footer. Every route renders inside exactly one of these —
 * there is no second shell for marketing pages.

 * The playground route uses the same shell but opts out of the footer and
 * scrolls its own panes instead of the page. */

import { useEffect, useState } from 'react';

import { BrandLogo } from '../brand/BrandLogo.jsx';
import { Link } from '../router.jsx';
import { useRouter } from '../routerContext.js';
import { currentTheme, toggleTheme } from '../theme.js';
import { FOOTER_LINKS, isActive, NAV } from './nav.js';
import './shell.css';

/** Sun/moon switch. Reads the painted theme, so it can never show the wrong
 *  icon even if the theme was changed by the boot script or the OS. */
function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    const onTheme = (event) => setTheme(event.detail);
    window.addEventListener('codelens:theme', onTheme);
    return () => window.removeEventListener('codelens:theme', onTheme);
  }, []);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => toggleTheme()}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? (
        // Sun.
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
          </g>
        </svg>
      ) : (
        // Moon.
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

export function AppShell({ children, wide = false }) {
  const { match } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastRoute, setLastRoute] = useState(match?.route.name ?? null);
  const routeName = match?.route.name ?? null;

  // Close the mobile menu when the page changes. Deriving during render (not
  // in an effect) keeps the menu in step without an extra render pass.
  if (routeName !== lastRoute) {
    setLastRoute(routeName);
    setMenuOpen(false);
  }

  // The playground is one screen tall and scrolls inside itself; every other
  // page is normal document flow with a footer.
  const isApp = routeName === 'python-visualizer';

  return (
    <div className={isApp ? 'shell shell-app' : 'shell'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell-nav">
        <Link to="/" className="shell-brand" aria-label="CodeLens home">
          <BrandLogo className="shell-brand-logo" decorative />
        </Link>

        <nav className={menuOpen ? 'shell-links shell-links-open' : 'shell-links'} aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={isActive(routeName, item.match) ? 'shell-link shell-link-active' : 'shell-link'}
              aria-current={isActive(routeName, item.match) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="shell-actions">
          <ThemeToggle />
          <Link to="/get-started" className="btn btn-primary shell-cta">
            Get Started
          </Link>
          <button
            type="button"
            className="shell-burger"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                {menuOpen ? (
                  <path d="M4 4l8 8M12 4l-8 8" />
                ) : (
                  <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
                )}
              </g>
            </svg>
          </button>
        </div>
      </header>

      <main className={wide ? 'shell-main shell-main-wide' : 'shell-main'} id="main" tabIndex={-1}>
        {children}
      </main>

      {!isApp && (
        <footer className="shell-footer">
          <div className="shell-footer-inner">
            <div className="shell-footer-brand">
              <BrandLogo className="shell-footer-logo" />
              <p>
                Watch your code run, one step at a time. Free, in your browser — your
                code never leaves your machine.
              </p>
            </div>
            <nav className="shell-footer-links" aria-label="Footer">
              {FOOTER_LINKS.map((item) => (
                <Link key={item.to} to={item.to}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <p className="shell-footer-note">
            Built with React, Vite and Pyodide. Python runs locally in a Web Worker.
          </p>
        </footer>
      )}
    </div>
  );
}

/** A consistent page header: breadcrumbs, title, optional subtitle. */
export function PageHeader({ crumbs = [], title, subtitle, actions }) {
  return (
    <div className="page-header">
      {crumbs.length > 0 && (
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="crumb">
              {i > 0 && <span className="crumb-sep" aria-hidden="true">/</span>}
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </div>
  );
}
