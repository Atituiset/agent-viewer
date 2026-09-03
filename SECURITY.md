# Security Policy

Agent Viewer reads your AI agent session files (which may contain secrets, proprietary
code, and personal data) and stores SSH credentials for remote machines. We take the
security of this data seriously.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report vulnerabilities privately via
[GitHub's private vulnerability reporting](../../security/advisories/new), or by
contacting the maintainer through the GitHub profile
[@Atituiset](https://github.com/Atituiset).

Please include:

- A description of the issue and its potential impact
- Steps to reproduce or a proof of concept
- Affected versions/platforms, if known

You can expect an acknowledgement within a few days. We will keep you informed as we
triage and fix the issue, and credit you in the release notes if you wish.

## Scope Notes

- Session transcripts are rendered from **untrusted content**; report any path by which
  transcript content could execute code, navigate the app window, or exfiltrate data.
- SSH credentials are encrypted with the OS keychain (`safeStorage`) and are never sent
  to the renderer process. On systems without a keyring backend (some Linux setups)
  they are stored unencrypted — hardening this path is a known, public area of work.
- SSH host keys are verified trust-on-first-use (TOFU) since v0.3.0.

## Supported Versions

Only the latest release receives security fixes.

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |
