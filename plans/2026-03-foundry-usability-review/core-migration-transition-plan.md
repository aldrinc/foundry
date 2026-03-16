# Foundry Core Migration and Branding Transition Plan

Date: 2026-03-15
Status: Investigation complete, implementation not started
Owner: Foundry Core + desktop + design/brand

## Purpose

This document covers the remaining core migration work required to finish the product transition from Zulip-branded surfaces to Foundry-branded surfaces for the parts of the product that matter directly to usability.

This is not a proposal to rename every internal symbol or every inherited upstream reference. The focus is user-visible, flow-critical surfaces:

- login and signup
- image/download access flows
- browser fallback pages
- navigation/header/footer
- desktop shell branding
- bot/system identity surfaces
- metadata and logos visible to users

Examples that do not need to block this phase:

- internal type names containing `zulip`
- generated bindings comments
- icon-font CSS class names such as `zulip-icon` when the class name itself is not user-visible

## Executive Assessment

Foundry currently has a split architecture:

- the desktop app UI in `packages/app` and `packages/desktop` is partially rebranded and custom
- the browser-served auth/portico/public-access surfaces in `services/foundry-core/app` still contain many direct Zulip-branded assets, templates, and links

That split is exactly why users can use a Foundry desktop app but still hit a Zulip login page when an image is opened externally and the browser is not authenticated.

## Most Important Migration Finding

The image-login problem is not only an image-viewer bug. It is also evidence that the browser-facing Foundry Core surfaces have not been fully migrated off Zulip branding.

Today the flow is:

1. Foundry desktop opens a protected upload URL in the external browser.
2. The user’s browser session is not authenticated.
3. Foundry Core redirects to the inherited server login path.
4. The user sees a Zulip-branded login page, footer, logo, and help/legal framing.

That is a core transition problem, not a cosmetic edge case.

## Migration Principles

1. Foundry must have a single visible product identity across desktop, browser, login, public access, and notifications.
2. High-frequency and high-confusion surfaces are higher priority than deep admin or documentation cleanup.
3. User-visible rebranding must be driven from the primary codebase, not runtime overrides.
4. Migration should prefer centralized brand configuration over one-off string edits wherever possible.
5. Any remaining `Zulip Desktop` naming or asset surface should be treated as legacy carryover to remove or archive, not as a supported secondary brand.
6. The team should explicitly separate:
  - user-visible brand cleanup
  - technical internal symbol cleanup
  - upstream divergence management

## Current-State Audit

### Surface 1: Login and Signup Pages

Evidence:

- `services/foundry-core/app/templates/zerver/login.html`
  - page title: `Log in | Zulip`
  - primary heading: `Log in to Zulip`
- related server-rendered account templates also retain Zulip wording

Impact:

- highly visible
- flow-critical
- causes immediate trust and product-identity confusion

Priority: P0

### Surface 2: Footer, Marketing Nav, and Legal/Help Links

Evidence:

- `services/foundry-core/app/templates/zerver/footer.html`
  - `Powered by Zulip`
  - Zulip help, policy, company, and marketing links
- `services/foundry-core/app/templates/zerver/marketing_nav.html`
  - Zulip logos, Zulip product links, Zulip marketing IA
  - duplicated desktop/mobile nav copies in the same template

Impact:

- every unauthenticated or portico surface reinforces the wrong brand
- footer and nav link users to Zulip properties instead of Foundry destinations

Priority: P0

### Surface 3: Browser Gating for Images and Private Content

Evidence:

- `services/foundry-core/app/web/templates/login_to_view_image_button.hbs`
  - still renders Zulip icon classes and `Log in to view image`
- `services/foundry-core/app/web/templates/login_to_access.hbs`
  - still says users can participate by creating a Zulip account

Impact:

- directly connected to the user-reported image/login problem
- affects spectators, private-content gates, and partial-public flows

Priority: P0

### Surface 4: Meta Tags and Shared Brand Assets

Evidence:

- `services/foundry-core/app/templates/zerver/meta_tags.html`
  - `og:site_name` is `Zulip`
  - default OG image is `images/logo/zulip-icon-128x128.png`
- `services/foundry-core/app/static/images/logo/*`
  - multiple Zulip logo assets remain in active use

Impact:

- wrong brand in previews, embeds, social cards, browser metadata, and shared links

Priority: P1

### Surface 5: Notification Bot and System Bot Identity

Evidence:

- `services/foundry-core/app/static/images/static_avatars/notification-bot*.png`
  - Zulip-branded notification bot avatar
- `services/foundry-core/app/zproject/default_settings.py`
  - system bot defaults remain Zulip-branded in multiple places

Impact:

- mixed-brand bot identity inside the product

Priority: P1

### Surface 6: Desktop Shell Leftovers

Evidence:

- `packages/desktop/index.html`
  - document title still `Zulip`
- `packages/desktop/src/menu.ts`
  - menu item `Zulip Help Center`
- `packages/desktop/src-tauri/capabilities/default.json`
  - description still says `Zulip Desktop app`
- `packages/app/src/views/settings-servers.tsx`
  - user-facing copy still says `Zulip organizations`, `Zulip tenant organization URL`, and `Your Zulip password`

Impact:

- the desktop app should be fully Foundry-branded; any remaining `Zulip Desktop` identity is legacy and should be removed from active product surfaces and archived once replaced

Priority: P1

### Surface 7: Secondary User-Facing Copy Across Portico and Help Access

Examples found during review:

- account confirmation templates
- spectator/public access prompts
- onboarding/help copy
- button text or descriptions in settings where Zulip is still directly named

Impact:

- medium frequency individually
- high cumulative perception cost

Priority: P2

### Surface 8: Non-Core Long-Tail Zulip Content

Examples:

- integration docs
- server admin copy
- developer docs
- many inherited templates and translations

Impact:

- large volume
- not all of it matters to immediate product usability

Priority: separate backlog, not blocking the core migration completion criteria

## Recommended Migration Scope

### Wave 1: Core Usability Surfaces

Complete all of the following before calling the migration complete from a user-usability standpoint:

- login page and signup flow branding
- footer and marketing nav branding
- spectator/private-content gating branding
- image access/login-to-view-image flow
- desktop shell title/menu/help strings
- notification bot avatar and visible system bot naming
- meta tags and active logo assets

### Wave 2: Secondary Product Surfaces

- remaining account templates
- onboarding and support/help references
- settings text that still says Zulip

### Wave 3: Long-Tail Inherited Surfaces

- integration catalog and docs
- deep admin/help content
- low-traffic templates
- optional internal symbol cleanup

## Implementation Strategy

### Workstream A: Introduce a Brand Configuration Layer

Current problem:

- branding is spread across templates, assets, settings, and desktop strings
- there is no obvious single source of truth for product name, logo, support URLs, help URLs, or legal destinations

Recommendation:

- add a Foundry brand configuration surface in Foundry Core
- make templates pull from configured brand values where possible
- centralize:
  - product name
  - login page title
  - help center URL
  - legal URLs
  - logo asset paths
  - metadata image paths

Why this matters:

- it prevents reintroducing Zulip strings later
- it reduces the cost of keeping desktop and browser surfaces aligned

### Workstream B: Portico/Auth Surface Migration

Files to prioritize:

- `services/foundry-core/app/templates/zerver/login.html`
- `services/foundry-core/app/templates/zerver/footer.html`
- `services/foundry-core/app/templates/zerver/marketing_nav.html`
- `services/foundry-core/app/templates/zerver/meta_tags.html`
- related signup and account templates under `services/foundry-core/app/templates/zerver/`

Tasks:

- replace visible Zulip product naming with Foundry
- replace Zulip logos and nav classes where needed
- swap external links to Foundry-owned destinations
- remove `Powered by Zulip` from user-facing core product surfaces

### Workstream C: Image and Access-Gating Surface Migration

Files to prioritize:

- `services/foundry-core/app/web/templates/login_to_view_image_button.hbs`
- `services/foundry-core/app/web/templates/login_to_access.hbs`

Tasks:

- replace copy and icons with Foundry equivalents
- ensure the access-gating experience matches Foundry terminology for organization/community/account
- align this with the in-app image-viewer fix so external browser fallbacks are minimized

### Workstream D: Desktop Shell Cleanup

Files to prioritize:

- `packages/desktop/index.html`
- `packages/desktop/src/menu.ts`
- `packages/desktop/src-tauri/capabilities/default.json`
- `packages/app/src/views/settings-servers.tsx`

Tasks:

- replace remaining visible Zulip naming in the desktop shell
- update help center targets and desktop menu labels
- make server settings copy Foundry-first while still correctly describing organization URLs and auth
- once replaced, archive any obsolete legacy desktop branding artifacts rather than leaving them in active product paths

### Workstream E: Bot/System Identity Cleanup

Files to prioritize:

- `services/foundry-core/app/static/images/static_avatars/notification-bot.png`
- `services/foundry-core/app/static/images/static_avatars/notification-bot-medium.png`
- `services/foundry-core/app/zproject/default_settings.py`

Tasks:

- replace visible avatar assets
- audit user-facing bot naming defaults
- confirm message history renders the new branding correctly

## Detailed Delivery Plan

Phase 0: Audit and brand source-of-truth

- Define official Foundry brand assets, legal links, help links, and support destinations.
- Inventory active templates using Zulip logos or copy.
- Decide which surfaces are intentionally still upstream-facing and which are product-facing.

Phase 1: P0 user-facing auth and access flows

- Login
- Signup/account discovery
- Footer/nav
- Image and private-content gating

Phase 2: Desktop shell and bot identity

- Desktop title/menu/settings copy cleanup
- Notification bot avatar and visible bot copy
- Meta tag/logo asset cleanup

Phase 3: Secondary product surfaces

- confirmation pages
- onboarding copy
- browser-side settings/help references

Phase 4: Long-tail cleanup backlog

- integration docs
- rare portico pages
- deep inherited strings that do not affect normal Foundry use

## Testing and Validation Matrix

### Core Manual Paths

Validate these exact flows in a deployed dev environment:

1. Desktop user clicks an image while browser is not logged in.
2. Browser unauthenticated user lands on login/signup flow.
3. Spectator or gated-content user sees login-to-access messaging.
4. User opens desktop settings and server settings.
5. User receives notification bot content.
6. User shares or previews a browser page that uses OG metadata.

### Expected Outcomes

- No core path exposes Zulip as the visible product brand.
- No core path sends users to Zulip-owned product/help/legal destinations unless explicitly intended.
- Foundry logo, naming, and support/help/legal framing are consistent.

## Completion Criteria for Core Migration

The migration should be considered complete for review only when:

- all P0 and P1 usability surfaces above are rebranded and shipped
- automated tests pass
- the changes are deployed to a dev environment
- the review flows are manually exercised end-to-end
- the user confirms that the experience no longer feels like a mixed Foundry/Zulip product

## Explicit Non-Goals for This Phase

These should not block the core migration sign-off:

- renaming every internal `zulip` type, variable, or generated binding
- rewriting every integration document and translation immediately
- removing every upstream attribution or technical reference that is not user-facing

Those items should be tracked separately so the core migration can finish in a defined, testable way.
