# Shared Context Database Schema

## Purpose

This schema defines the MVP shared-context data model for the hackathon. The database is designed to test whether the agent can retrieve and synthesize information shared across a team of users.

The initial synthetic project uses three users: **John, Mary, and Bob**.

The database should support four core product behaviors:

1. **Prevent duplicate work** — identify when another teammate is already working on something related.
2. **Reuse and handoff existing work** — surface completed work, documentation, and handoff information.
3. **Handle conflicting information** — identify contradictory claims and surface the disagreement rather than presenting one claim as definitive.
4. **Understand overall project state** — synthesize distributed context about completed work, ongoing work, blockers, dependencies, and decisions.

## Design Principles

- Keep the schema intentionally minimal for the MVP.
- Use one generic `SharedContextRecord` model with two content types: `chat` and `artifact`.
- Do not create separate database entities for tasks, decisions, knowledge, blockers, or project state. These are semantic concepts that the LLM should infer from shared context.
- Preserve the original content verbatim.
- Store provenance so users can understand who contributed the information.
- Infer work status dynamically at retrieval time rather than storing a potentially stale status field.
- Represent detected conflicts as separate shared-context records so they can be retrieved directly.
- Use timestamps to support temporal queries such as "What has the team completed today?"
- Keep relationships/dependencies implicit; the agent should infer them from context rather than requiring explicit relationship records.

## Schema

### `SharedContextRecord`

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | Yes | Unique identifier for the shared-context record. |
| `type` | enum: `chat`, `artifact` | Yes | Describes the form/source of the shared context. |
| `content` | text | Yes | Original content, preserved verbatim. |
| `source_user_id` | string/null | Yes | User who created the context. For system-generated records, this may be null or use a system identifier depending on implementation. |
| `artifact_type` | string/null | No | Semantic subtype for artifacts, e.g. `documentation`, `handoff`, or `conflict`. Not used for chat records. |
| `source_record_ids` | array of strings | No | IDs of records that an LLM-generated artifact was derived from. Empty for ordinary chat records. |
| `created_at` | timestamp | Yes | Time at which the shared-context record was created. |

## Field Semantics

### `type`

Only two values are needed for the MVP:

- `chat` — a chat message or relevant excerpt that has been made available to shared context.
- `artifact` — textual content with metadata, such as an uploaded document or an LLM-generated report.

The type describes the **form of the context**, not its semantic meaning. A chat record can contain a task, decision, blocker, or project knowledge. An artifact can contain documentation, a handoff, or a conflict.

### `source_user_id`

Shared context is private by default. A chat message enters shared context only when the system's sharing logic determines it should be shared, based on agent behavior and/or admin configuration.

For ordinary records, `source_user_id` identifies the teammate who created the context.

### `artifact_type`

This is optional and should only be used when it is useful to identify the nature of an artifact. It should remain flexible rather than becoming a large controlled taxonomy.

Examples:

- `documentation`
- `handoff`
- `conflict`

A conflict is therefore still a `SharedContextRecord`, rather than a separate top-level database entity.

### `source_record_ids`

This provides lightweight provenance for generated artifacts.

For example, if John and Mary's messages disagree about the database, an LLM-generated conflict artifact can reference both original records:

```text
source_record_ids: ["C006", "C007"]
