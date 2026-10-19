# Security Policy

## Supported versions

Security fixes are accepted against the default branch of this repository (`main`). Published plugin versions inherit those fixes on the next release or marketplace refresh.

## Reporting a vulnerability

Do **not** open a public GitHub issue for security reports that include exploit details, credentials, or private user data.

Report vulnerabilities privately through the contact methods listed on the [Imoten repository](https://github.com/j2bap/imoten-public), or open a private [GitHub Security Advisory](https://github.com/j2bap/imoten-public/security/advisories/new) when that feature is available.

Please include:

- a clear description of the issue and its impact
- steps to reproduce, or a proof of concept when safe to share
- affected plugin version or commit SHA when known

We will acknowledge receipt when possible and coordinate disclosure after a fix is available.

## Scope notes

This repository is a Codex plugin of skills, hooks, and local helper scripts. Reports about third-party tools invoked by user-directed workflows, such as `git`, `gh`, or Bun, should be filed with those projects unless the vulnerability is in this repository's wrapping code or instructions.
