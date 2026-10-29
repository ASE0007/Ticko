# Contributing to Ticko

This repository is a coursework project for a real-time service request management system. Keep changes small, easy to review, and linked to the requirements in the project documents.

## Before making changes

1. Read `README.md` and `SETUP-WINDOWS.md`.
2. Use a separate branch for a new feature or fix when possible.
3. Never commit real `.env` files, passwords, access tokens, database dumps, or private customer data.
4. Keep `.env.example` limited to safe example values.
5. Run the checks described in the relevant package files before proposing a change.

## Branch names

Use clear names, for example:

- `docs/system-design`
- `fix/database-startup`
- `feat/ticket-filter`
- `test/websocket-events`

## Commit messages

Write a short, meaningful message that explains the change. Suggested prefixes:

- `feat:` a new feature
- `fix:` a bug fix
- `docs:` documentation changes
- `test:` tests or test fixtures
- `refactor:` code restructuring without a behaviour change
- `chore:` maintenance or configuration

Examples:

- `docs: explain database setup on Windows`
- `fix: handle invalid ticket status updates`
- `test: cover WebSocket reconnect behaviour`

Do not split a single small change into many empty commits or create fake historical commits. Commits should reflect real, reviewable changes.

## Pull request checklist

- [ ] The change solves a clear problem or requirement.
- [ ] The code and documentation agree.
- [ ] Relevant tests have been run, and their actual result is stated.
- [ ] No secrets or personal data are included.
- [ ] Setup instructions still work for a clean checkout.
- [ ] Any known limitation is documented.

## Coursework scope

The current Ticko implementation uses simulated network diagnosis and speed verification. Do not describe those checks as real router or ISP network operations unless a real integration is implemented and tested.
