# Web application

The browser client for the companion. It is a React 19 single-page app bundled by the
companion at startup with `Bun.build` (see `apps/companion/src/web.ts`) and served under
the same private HTTPS origin as the authentication and control routes. See
`docs/web-app.md` for the architecture, data flow and limits.

Browser code never imports companion modules and never receives backend credentials. It
talks only to `/auth/*` and `/control/*`.

Layout: `src/api.ts` (HTTP client and event stream), `src/state.ts` (pure helpers),
`src/timeline.ts` and `src/composer.ts` (pure transcript and attachment logic),
`src/connection.ts` (stream lifecycle hook), `src/App.tsx` (root state), `src/views`
(auth, session list, chat frame, sheets) and `src/components` (timeline, markdown,
composer, approvals). Styles live in `src/app.css` (tokens, shell) and
`src/components.css`. Tests run with `bun test apps/web`.
