# Publish

Publishes the open note to **dev.to**, **WordPress.com** or **Hashnode**. It
makes a draft by default, and keeps the post's ID on the note, so publishing
again updates the same post instead of making a new one.

## Which targets, and why not Ghost or self-hosted WordPress

A plugin's manifest lists the exact hosts it may reach; Kanso refuses
wildcards and cannot ask you for a host at install time. So only services
with a fixed host are supported:

| Target | Host |
|---|---|
| dev.to | `dev.to` |
| WordPress.com | `public-api.wordpress.com` |
| Hashnode | `gql.hashnode.com` |

**Ghost** is not included. Its Admin API lives on each site's own address
(`*.ghost.io` or a custom domain), which can't be listed in a fixed manifest, and
it needs a signed JWT (HMAC-SHA256) per request, which the plugin sandbox has no
means to compute. **Self-hosted WordPress** (WordPress.org) has the same host
problem. A site hosted on WordPress.com works, including a custom domain, since
requests go to `public-api.wordpress.com`.

## Setup

Paste each token you use under its secret name in Settings › Plugins ›
Publish. At install, choose the notebooks the plugin may read and change; saving
the post ID on a note needs its notebook to be one of them.

| Secret | Where it comes from | Minimum scope |
|---|---|---|
| `devto-key` | dev.to › Settings › Extensions › DEV Community API Keys | An API key acts as you; there are no narrower scopes |
| `wordpress-token` | An OAuth2 bearer token for your site, from an app made at developer.wordpress.com/apps | Access to the one site |
| `hashnode-token` | Hashnode › Account settings › Developer › Personal Access Token | Account access. Hashnode now requires a Pro plan on the publication for API use |

Then run **Publish: settings and links** and set:

- **Publish to**: the target.
- **Status**: `draft` (default) or `publish`.
- **Tags**: comma separated, at most 4 for dev.to, 10 for WordPress.com. Hashnode ignores them.
- **WordPress.com site**: for example `myblog.wordpress.com` (or the numeric site ID).
- **Hashnode publication ID**: from the publication's dashboard URL or settings.

## Use

Open a note and run **Publish the open note** (or press **Publish this note**
in the panel). The note's title is the post title; a leading `# Title` heading
that repeats it is dropped from the body. dev.to and Hashnode get the Markdown
as is. WordPress.com gets HTML converted by the plugin, with all text escaped
and only `http`, `https` and `mailto` links kept.

The post ID is saved under the note's plugin data, per target (and per site or
publication), so you can send one note to several places. Publishing again
updates that post. **Publish: forget the post made from this note** drops the
stored ID so the next publish creates a new post; it never deletes anything.

Hashnode notes: its API creates drafts and publishes them, and edits published
posts, but cannot edit an existing draft. If a draft exists and the status is
still `draft`, the plugin says so and does nothing; set `publish` to publish the
draft, after which later runs update the post. The Hashnode calls follow
Hashnode's documented `createDraft`, `publishDraft` and `updatePost` mutations;
Hashnode's API is gated behind a Pro plan, so this target could not be run
against the live service when the plugin was written.

## Why each permission

| Permission | Why |
|---|---|
| `commands` | The publish and forget commands |
| `editor`: `note.read` | Read the open note |
| `notes.read` / `notes.write` | Read and store the post ID in the note's plugin data (you choose the notebooks). The note's text is never changed |
| `ui: panel` | The settings and links panel |
| `secrets` | The three tokens above, read only for the target in use, never logged or shown |
| `network` | `dev.to`, `public-api.wordpress.com`, `gql.hashnode.com`, over HTTPS |

401, 403 and 429 answers are shown as plain messages; tokens never appear in
messages or logs.

Tests: `node --test plugins/app.kanso.publish/tests`.
