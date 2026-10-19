/* Shared page states: loading, empty, error and not-found. Every page that
 * can fail or show nothing uses one of these instead of inventing its own,
 * so the site behaves the same everywhere. */

import { Link } from '../router.jsx';
import './shell.css';

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="state-spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="state">
      <h2 className="state-title">{title}</h2>
      {children && <div className="state-body">{children}</div>}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', children, onRetry }) {
  return (
    <div className="state state-error" role="alert">
      <h2 className="state-title">{title}</h2>
      {children && <div className="state-body">{children}</div>}
      {onRetry && (
        <div className="state-action">
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function NotFoundState() {
  return (
    <div className="state">
      <p className="state-code" aria-hidden="true">404</p>
      {/* One h1 per page, even on the error page. */}
      <h1 className="state-title">This page does not exist</h1>
      <div className="state-body">
        <p>
          The link may be mistyped, or the page may have moved. Everything on the
          site is reachable from the navigation above.
        </p>
      </div>
      <div className="state-action">
        <Link to="/" className="btn btn-primary">
          Go to the home page
        </Link>
      </div>
    </div>
  );
}
