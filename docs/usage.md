# Usage

[中文](usage.zh-CN.md) | **English**

## How memories reach the context

Before every model request the plugin assembles a small memory block into the system prompt:

1. **Core and important** (never faded) — ordered by importance and freshness, within the core budget;
2. **Relevant to the current message** — scored with Han bigrams, latin words, phrase and tag bonuses, top N, within the relevant budget;
3. A trailing hint that more detail is available through `memory_search`.

Defaults: 850 characters total (roughly 850 Chinese tokens), 360 for the core tier, at most 6 related items, minimum score 0.08. The **Injection** tab previews exactly what a given sentence would inject and the estimated tokens.

## Tiers and decay

| Tier | Enters when | Decays |
| --- | --- | --- |
| core | pinned manually / `pin=true` | never |
| important | importance ≥ 0.82, or a normal memory used ≥ 4 times | never |
| normal | default | yes |
| faded | after the last decay step | already faded |

Default ladder for the normal tier (editable in **Injection → decay rules**):

- 100 days: first extractive compression (long text down to ~170 characters);
- 200 days: second compression (~90 characters);
- 300 days: key points only (body cleared, still searchable, dimmed in the star map);
- after another 600 days: purged, leaving a tombstone so sync cannot resurrect it.

Retrieval, reads and injections refresh the "last used" clock, so memories you actually use do not fade. Editing the body also resets the clock.

## Tools

| Tool | Purpose |
| --- | --- |
| `memory_save` | Store a memory; optional `tags`, `importance` (0-1), `pin` |
| `memory_search` | Fuzzy search ranked by relevance, tier and freshness; returns id, date, tier, excerpt |
| `memory_get` | Read the full text and metadata by id |
| `memory_update` | Change body, tags, importance, pin, tier |
| `memory_forget` | Delete (irreversible) |

Save stable preferences, identity background, project conventions, important decisions and commitments. Do not save small talk, transient state, or one-off intermediate steps. Each memory should stand on its own with an explicit subject and conclusion.

## Panel

- **Star map**: node size = importance, color = tier, position = tier ring plus tag/link edges; click for details and edit in place.
- **Memories**: search, filter by tier, add, edit inline, pin/unpin, forget; core and important are grouped separately.
- **Devices**: sync folder, peer URL, git auto-sync, share package, sync config, sync now, last report.
- **Injection**: budget sliders, decay rules, live preview with a token estimate.

## Sync

### Channels

1. **Shared folder**: any cloud drive or Syncthing folder; each device writes `memory-nebula.<account>.<device>.json` and records merge.
2. **Peer URL**: `http://<ip>:<port>` plus the sync token; best on the same LAN.
3. **Git repository**: point the sync folder at a private repository clone; the plugin runs `pull → commit → push` automatically, which works across networks without a cloud client.

### Merge rules

- Each memory carries a `rev`; the higher rev wins, `updatedAt` breaks a tie;
- Deletions write tombstones with a rev, so the other device deletes too;
- Concurrent edits to the same memory: last writer wins (text is replaced, never concatenated);
- Each device writes only its own snapshot file, so git normally never conflicts.

### Config sync

- Portable: injection budgets, relevant limit/threshold, decay days, `git/sharePackage/sessions/intervalMinutes/plugins/autoImportSessions`;
- Device-local: `folder`, peers, token, `enabled`, and the config-sync switch itself;
- `config/desired.json` carries `version` and `from`; the newer version publishes, the other applies without republishing, so two devices converge instead of rewriting each other forever;
- A device that has never published (version 0) applies an established remote config, or seeds the file from its own settings when none exists.

### Sessions and the plugin package

- Session archives: logs idle for more than 3 minutes are copied to `sessions/<device>/`; importing only adds sessions missing locally, never overwrites, and needs a DSH restart to appear;
- Plugin package: with "share package" on, the bundle is copied to `plugins/memory-nebula/`, so another device can install from the repository instead of a hand-copied zip.

## Data and backup

- Local: `DSH_HOME/memory-nebula/memories.json` (memories, device id, account id, sync token, local settings) and `sync-report.json`;
- Remote: your private data repository;
- Backup: keep the data repository. Do not hand-edit `memories.json` while DSH runs; the in-memory store overwrites it.

## FAQ

**A memory is not found.**
Try different keywords; no hit does not mean it never happened. Faded memories keep only key points by design.

**Too much or too little injection.**
Adjust total budget, core budget, relevant limit and minimum score in the Injection tab; changes apply immediately.

**Two devices disagree.**
Check the merge and git status in the last sync report. When `git.ok=false`, fix credentials or network; the next cycle retries.

**Does the server need to stay on?**
Only while it participates in sync. Closing DSH pauses it; the next start continues.

**Can the data repository be public?**
No. It holds plaintext memories. Only this kit repository is public.
