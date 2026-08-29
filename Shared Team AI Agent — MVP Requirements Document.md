# Shared Team AI Agent — MVP Requirements Document

## 1. Product Overview

Build a collaborative AI workspace where multiple members of a software team each have their **own private chat interface**, but all chats connect to a **shared team agent and shared team context**.

The goal is to reduce duplicated work and fragmented knowledge across teammates.

For example:

- John asks the agent about authentication.
- John's work is shared as chat records in team context.
- The system preserves who contributed the information and when.
- Later, Mary asks about authentication from a separate chat.
- The agent retrieves John's shared context records and tells Mary what is already done before recommending duplicate work.

The key idea is:

**Private conversations + shared team awareness.**

---

# 2. Primary User Experience

Each teammate should have their own chat:

```text
John → Chat A ─┐
Mary → Chat B ─┼→ Shared Team Agent
Bob  → Chat C ─┘
                         │
                         ▼
                  Shared Team State
```

Users should NOT need to see everyone else's complete conversations.

Instead, useful information from each user's work should be represented as **shared context records** — chat excerpts and artifacts that preserve original content and provenance.

See `SHARED_CONTEXT_SCHEMA.md` and the canonical fixture at `app/data/data.json`.

---

# 3. MVP Goals

The MVP should prove the following hypothesis:

> A shared AI agent can prevent duplicated work by knowing what other teammates have already done.

The initial application should demonstrate:

1. Multiple users can have separate conversations.
2. The agent has access to shared team context.
3. Work completed by one user becomes available to another user quickly.
4. The agent can detect when a user is about to duplicate existing work.
5. The agent can tell users who previously worked on something.
6. Shared information includes provenance: who said/did something and when.
7. The agent infers facts, opinions, proposals, decisions, and work status from shared context at retrieval time rather than relying on stored status fields.

---

# 4. Core Demo Scenario

The seeded fixture in `app/data/data.json` defines the canonical demo narrative for **John, Mary, and Bob**.

### Step 1 — John completes authentication

Shared context includes:

```text
C001 (chat, John): Google OAuth login flow and callback are working locally.
C016 (chat, John): Authentication implementation is complete and ready for integration.
```

### Step 2 — Mary asks about overlapping work

Mary's chat record (C002) says she is still working on callback handling, while John's records say authentication is complete.

When another teammate asks about login or authentication, the agent should retrieve the relevant records and explain:

- John has completed the authentication implementation.
- Mary may still be working on callback handling.
- The teammate should coordinate before duplicating work.

### Step 3 — Expense API handoff

Mary's artifact records document and hand off the Expense API:

```text
C003 (chat): Expense API supports GET, POST, DELETE.
C004 (artifact, documentation): API endpoint documentation.
C015 (artifact, handoff): API is ready for dashboard integration.
```

Bob's chat (C009) says he is waiting on the Expense API before starting the dashboard.

### Step 4 — Database conflict

John and Mary disagree about the database:

```text
C006 (chat, John): PostgreSQL.
C007 (chat, Mary): MongoDB.
C008 (artifact, conflict): Unresolved disagreement; source_record_ids = [C006, C007].
```

The agent must surface the conflict rather than silently choosing one side.

The exact response format is not important. The important behavior is that the agent retrieves shared context records before recommending duplicate work or presenting one conflicting claim as definitive.

---

# 5. Shared Team State

Do NOT implement shared context as simply one giant conversation transcript.

Use one generic **`SharedContextRecord`** model with two content types:

```text
chat      — a chat message or excerpt shared with the team
artifact  — documentation, handoff notes, or conflict summaries
```

Semantic concepts such as tasks, decisions, blockers, facts, opinions, and work status are **inferred by the agent at retrieval time** from record content. They are not stored as separate database entities or status fields.

Each record should contain:

```text
id
type
content
source_user_id
artifact_type (optional; e.g. documentation, handoff, conflict)
source_record_ids (optional provenance links)
created_at
```

Example from the seed fixture:

```json
{
  "id": "C008",
  "type": "artifact",
  "source_user_id": null,
  "content": "Conflict detected: John proposed PostgreSQL while Mary proceeded with MongoDB. The database decision is unresolved.",
  "artifact_type": "conflict",
  "source_record_ids": ["C006", "C007"],
  "created_at": "2026-08-29T11:15:00"
}
```

Canonical seed data: `app/data/data.json`. Runtime storage: SQLite (`team_memory.db`).

---

# 6. Information Authority

The system must NOT treat everything a user says as equally authoritative.

The agent should distinguish between facts, opinions, proposals, decisions, and work-in-progress **by reading the content of shared context records**, not by relying on stored type or status fields.

Examples that may appear inside `content`:

### Fact

> The Expense API supports GET, POST, and DELETE.

### Opinion

> I think we should use PostgreSQL.

### Proposal / conflicting claim

> I thought we had decided to use MongoDB.

### Work in progress

> I'm currently working on the authentication flow.

### Blocker

> The balance calculation is currently blocked because I'm not sure whether pending expenses should be included.

These remain separate **semantic** concepts. The database stores only `chat` and `artifact` record types.

---

# 7. Conflicting Information

The agent should NOT silently choose one person's opinion over another.

Example from the seed data:

John (C006):

> I think we should use PostgreSQL for the database because the relational structure fits the project.

Mary (C007):

> I thought we had decided to use MongoDB. I already started setting up the MongoDB connection.

The system should represent this disagreement as a **conflict artifact** (C008) that references both source records via `source_record_ids`.

The agent should respond approximately:

> There is an unresolved database disagreement.
>
> John proposed PostgreSQL.
> Mary proceeded with MongoDB.
>
> No confirmed team decision has been recorded yet.

Do NOT build a complicated organizational hierarchy system for the MVP. Conflict artifacts plus provenance are sufficient.

---

# 8. Privacy Model

Not every message should automatically become shared team context.

For the MVP, support two categories:

### Private conversation

Regular conversation between the user and their agent.

### Shared team information

Information intentionally written into team state.

The MVP may use an explicit action such as:

```text
Share with Team
```

or allow the agent to propose:

> This looks like useful team context. Share it with the team?

Avoid automatically publishing every conversation.

---

# 9. Work Lifecycle

Work status is **not stored** in the database. The agent infers whether work is complete, in progress, blocked, or superseded from the content and timestamps of shared context records.

Example chat records:

```text
C002 (Mary): I'm currently working on the authentication flow...
C016 (John): The authentication implementation is complete and ready for integration.
C005 (Mary): The balance calculation is currently blocked...
```

When Bob asks to implement authentication, the agent should retrieve C001, C002, and C016 and explain that John has completed authentication while Mary may still be working on callback handling.

When someone asks about the balance calculation, the agent should surface C005, C013, and C014 and explain the blocker.

There is no `in_progress` / `complete` / `superseded` column. Those are retrieval-time interpretations.

---

# 10. Near-Real-Time Sharing

Shared information should become available to other users within a few seconds.

Do NOT implement continuous synchronization.

Use event-driven updates.

Useful events include:

```text
User explicitly shares a chat or artifact record
New shared context record created
```

Target behavior:

```text
Mary shares Expense API handoff artifact (C015)
        ↓
Shared context updated in SQLite
        ↓
Bob asks about dashboard integration
        ↓
Agent retrieves C015 and related records
```

Expected latency should feel effectively immediate to the user.

---

# 11. Runloop Integration

Runloop should be used as the execution environment for coding agents.

Runloop is NOT responsible for shared team memory.

Conceptual architecture:

```text
                     APPLICATION
                         │
             ┌───────────┴───────────┐
             │                       │
        Team Context              Agent Layer
             │                       │
             │                 Codex / LLM Agent
             │                       │
             │                       ▼
             │                Runloop Devbox
             │                       │
             │              ┌────────┼─────────┐
             │              │        │         │
             │            Files    Tests    Commands
             │
             └──── Shared State Database
```

Runloop should be used when the agent needs to:

- open the repository
- inspect code
- edit code
- run commands
- run tests
- build the project
- inspect git state
- potentially create commits

For the first implementation, isolate each coding session or user appropriately.

---

# 12. Codex / Agent Responsibilities

The coding agent should be capable of:

1. Understanding user requests.
2. Checking shared team context before starting significant work.
3. Identifying related existing work.
4. Warning the user about potential duplication.
5. Performing coding work through Runloop.
6. Summarizing completed work.
7. Producing structured information that can be added to shared team state.

Before beginning a task, the approximate agent flow should be:

```text
User request
    ↓
Search team context
    ↓
Is related work already happening?
    │
 ┌──┴───┐
Yes     No
 │       │
Inform   Continue
user     task
```

---

# 13. Suggested Architecture

Use a simple web application.

Recommended initial stack:

```text
Frontend:
React / Next.js

Backend:
Python + FastAPI
OR
TypeScript + Node

Database:
SQLite (team_memory.db)

Shared context seed:
app/data/data.json

Agent:
OpenAI / Codex-compatible agent tooling

Execution:
Runloop
```

Choose whichever backend language results in the simplest implementation.

Prioritize functionality over infrastructure sophistication.

---

# 14. Suggested Backend Components

Create clear separation between:

```text
User Service
Team Service
Chat Service
Agent Service
Team Context Service
Runloop Service
```

Responsibilities:

### Chat Service

Stores individual chat conversations.

### Team Context Service

Stores shared context records (`SharedContextRecord`) in SQLite, seeded from `app/data/data.json`.

### Agent Service

Handles LLM interaction and retrieves relevant shared context.

### Runloop Service

Creates/manages agent execution environments.

### Team Service

Tracks team membership.

---

# 15. Minimal Data Model

## User

```text
id
name
email
```

## Team

```text
id
name
```

## TeamMember

```text
team_id
user_id
```

## Conversation

```text
id
user_id
team_id
created_at
```

## Message

```text
id
conversation_id
role
content
created_at
```

## SharedContextRecord

```text
id
team_id
type                chat | artifact
content
source_user_id
artifact_type       optional: documentation, handoff, conflict, etc.
source_record_ids   JSON array of related record ids
created_at
```

Records are immutable after creation. Semantic meaning (task, decision, blocker, work status) is inferred by the agent from `content`.

Seed fixture: `app/data/data.json` (16 demo records for John, Mary, and Bob).

---

# 16. Context Retrieval

When a user sends a message, the application should retrieve relevant team context before calling the model.

Do NOT send every team context item every time.

For the MVP, a simple keyword/text search is acceptable.

If straightforward, use embeddings/vector search.

Example:

User:

> How should I implement authentication?

Retrieve matching records such as:

```text
C001 — John: Google OAuth login flow and callback working locally
C016 — John: Authentication implementation complete and ready for integration
C002 — Mary: Still working on callback handling
```

Include the matched records (and any `source_record_ids` provenance links) in the model's context.

---

# 17. UI Requirements

The UI can be extremely simple.

Required screens:

## Team Chat

```text
┌─────────────────────────────────────────┐
│ Team: Hackathon Project                 │
├─────────────────────────────────────────┤
│                                         │
│ User: How should I implement login?     │
│                                         │
│ AI: John already shared authentication context... │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│ Ask your agent...                 Send  │
└─────────────────────────────────────────┘
```

Each user should have a separate conversation.

---

## Team Activity / Context

Provide a basic sidebar showing shared context records:

```text
TEAM MEMORY

chat · John
Google OAuth login flow and callback are working locally.

artifact · handoff · Mary
Expense API handoff notes: implementation is complete...

artifact · conflict
Conflict detected: John proposed PostgreSQL while Mary proceeded with MongoDB.
```

Filters: All, Chat, Artifacts, Conflicts.

This page is primarily useful for demonstrating the underlying system.

---

# 18. Important Agent Behavior

Every meaningful task request should follow this pattern:

```text
1. Understand request.
2. Search team context.
3. Check for duplicate/related work.
4. Inform user if relevant work exists.
5. Only begin new work if appropriate.
6. Execute work.
7. Summarize results.
8. Offer to share/update team context.
```

Example:

```text
User:
I need to implement login.

Agent:

I found shared context from John saying Google OAuth authentication is complete
and ready for integration (C016). Mary is still working on callback handling (C002).

You should coordinate with Mary before duplicating authentication work.
```

---

# 19. Source / Provenance

Every shared item must retain where it came from.

Examples:

```text
John
Chat record C001
Conflict artifact C008 with source_record_ids [C006, C007]
Manual share via "Share with Team"
```

The agent should preferably be able to say:

> John shared that authentication is complete.

rather than:

> According to my memory...

Provenance is an important part of the product.

---

# 20. Non-Goals for MVP

Do NOT implement:

- Slack integration
- Jira integration
- Google Drive integration
- enterprise permissions
- complex role hierarchies
- automated manager authority
- cross-company federation
- support for every AI provider
- sophisticated knowledge graphs
- autonomous sharing of every message
- complete conflict resolution
- production-grade authentication
- billing
- enterprise security infrastructure

Focus on proving the core collaborative-agent interaction.

---

# 21. Primary Success Criteria

The demo should make this scenario obvious:

```text
John performs work and shares context
       ↓
Shared context records are stored in SQLite
       ↓
Mary independently asks about the same problem
       ↓
Mary's agent retrieves John's shared records
       ↓
Duplicate work is avoided
```

A successful demo should make someone immediately understand:

> "If our entire team used AI this way, the agents would know what everyone else is already doing."

---

# 22. Stretch Goals

Only attempt these after the core interaction works.

### Git Awareness

Automatically generate team context when commits are created.

### Semantic Search

Use embeddings to retrieve related team work.

### Agent Handoff

Person B can continue directly from Person A's agent work.

### Active Work Awareness

Detect tasks currently being worked on.

### Decision History

Show:

```text
MongoDB proposed
↓
PostgreSQL proposed
↓
PostgreSQL selected
```

### Notifications

Warn users when someone begins overlapping work.

### Team Summary

Allow:

> What has the team accomplished today?

Agent responds using shared context.

---

# 23. Product Principle

The product is NOT:

> Everyone can see everyone's AI chats.

The product IS:

> Everyone can privately work with AI while their agents maintain useful shared awareness of what the team knows, decides, and builds.

---

# 24. Implementation Priority

Build in this order:

### Phase 1

Multiple users + separate chat sessions.

### Phase 2

Shared context database (`SharedContextRecord`) seeded from `app/data/data.json`.

### Phase 3

Retrieve shared context before each agent response.

### Phase 4

Allow users/agents to publish completed work into shared context.

### Phase 5

Duplicate-work detection.

### Phase 6

Runloop coding execution.

### Phase 7

Polish the demo and optionally add git integration.

Do not begin stretch goals until Phases 1–5 work reliably.

---

# 25. Core Demo Script

Use three browser sessions representing John, Mary, and Bob (or at least two).

### John

Ask:

> What has the team completed on authentication?

Agent should cite C001 and C016 and note Mary's in-progress callback work (C002).

### Mary

Ask:

> Is anyone already working on the dashboard?

Agent should cite C009 (Bob waiting on Expense API), C011 (Mary's dashboard requirements), and C012 (John has not started).

### Bob

Ask:

> What database are we using?

Agent should retrieve C008 and explain the unresolved PostgreSQL vs MongoDB conflict, citing C006 and C007.

Then show the Team Memory sidebar with chat, artifact, and conflict filters.

This is the minimum compelling demonstration of the product.