# Web application boundary

The browser application is not implemented. Its framework and dependencies await
an audit of the browser-facing OpenCode v2 UI and approval of the retained source set.

The companion will serve web assets and APIs under one private HTTPS origin.
Browser code must never import companion modules or receive backend credentials.
Future host-scoped navigation must not require a gateway or multi-host UI today.
