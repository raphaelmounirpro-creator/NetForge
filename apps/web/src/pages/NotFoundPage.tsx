import { Link } from "../app/router";
import { messages } from "../i18n";

const { app } = messages;

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-text">{app.notFoundTitle}</h1>
      <p className="mt-2 text-text-muted">{app.notFoundBody}</p>
      <Link to="/laboratoire" className="mt-6 inline-block font-medium text-accent-text underline underline-offset-4">
        {app.backToLab}
      </Link>
    </div>
  );
}
