# Public Launch Checklist

This is the current launch-prep checklist for publishing Foundry as a public, source-available repository.

## Positioning and README

- [x] Add a public-facing root README with product framing, release links, quickstart, and license positioning
- [ ] Add two polished screenshots or a short product GIF near the top of the README
- [ ] Add a short "Why Foundry" architecture diagram or visual
- [ ] Replace any remaining "open source" phrasing with "source-available" where ELv2 applies

## Community Health

- [x] Add `LICENSE`, `LICENSING.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md`
- [x] Add issue templates, a PR template, and a support entry point
- [x] Add a changelog entry point for public releases
- [ ] Enable GitHub Discussions or publish a dedicated support/discussion channel
- [ ] Add branch protections, required checks, and at least two maintainers with admin access
- [ ] Add repository labels and a documented issue-triage routine

## Release and Distribution

- [x] Publish desktop artifacts through GitHub Releases
- [x] Wire signed OTA updater metadata into the desktop release flow
- [x] Wire macOS code signing and notarization into the desktop release workflow
- [ ] Add Apple Developer signing and notarization credentials to GitHub repository settings
- [ ] Publish checksums alongside every public release asset
- [ ] Add release-note templates for desktop and server changes
- [ ] Document a stable self-hosting path for the server stack

## Security and Trust

- [x] Keep secret scanning in local hooks and CI
- [x] Publish a security reporting policy
- [ ] Enable GitHub private vulnerability reporting in the public repo settings
- [x] Add dependency update automation for Bun, Cargo, Python, and GitHub Actions
- [ ] Publish an SBOM or provenance story for public releases

## Documentation Cleanup

- [ ] Curate `docs/architecture` so only public-facing architecture docs remain
- [ ] Remove or relocate product-plan documents that are still internal planning artifacts
- [x] Add a docs index for contributors and self-hosters
- [x] Add an FAQ for install, updates, self-hosting expectations, and license questions

## Launch-Day Operations

- [ ] Prepare the first public release notes and announcement post
- [ ] Verify README links, issue templates, releases, and support paths after the repo is public
- [ ] Smoke-test desktop downloads on macOS, Windows, and Linux from the public release page
- [ ] Confirm OTA upgrade from `0.1.1` to the next public version on a real installed client
