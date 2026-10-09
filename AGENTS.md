# Working conventions

Read `.redsun/memory.md` before substantive work. Maintain it as the live roadmap:
distinguish implemented behavior, approved direction, and undecided questions.

Prefer small, readable functions and immutable data. Minimize code without compressing
it at the expense of clarity. Use strict TypeScript; never introduce `any`.
Prefer Effect for service lifecycle and asynchronous orchestration.

Document design decisions in project memory, not code comments. Add tests for new
logic and bug fixes. Ask before adding dependencies or making an undecided choice
that changes product limitations, trust boundaries, or user-visible behavior.

Never commit credentials, private hostnames, service registrations, or device-specific
configuration. Never bind the companion off IPv4 loopback or configure a tunnel or
public listener from this repository. Never start, stop, or replace a redsun backend
without explicit authorization.
