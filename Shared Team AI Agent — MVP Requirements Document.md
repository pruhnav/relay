# Shared Team AI Agent — MVP Requirements Document

## 1. Product Overview

Build a collaborative AI workspace where multiple members of a software team each have their **own private chat interface**, but all chats connect to a **shared team agent and shared team context**.

The goal is to reduce duplicated work and fragmented knowledge across teammates.

For example:

- Person A asks the agent to build authentication.
- Person A completes the feature.
- The system records that authentication has been completed, who worked on it, what changed, and where the implementation lives.
- Later, Person B asks about authentication from a separate chat.
- The agent knows Person A already completed the work and tells Person B instead of starting from scratch.

The key idea is:

**Private conversations + shared team awareness.**

---

# 2. Primary User Experience

Each teammate should have their own chat:

```text
Person A → Chat A ─┐
Person B → Chat B ─┼→ Shared Team Agent
Person C → Chat C ─┘
                         │
                         ▼
                  Shared Team State
```

Users should NOT need to see everyone else's complete conversations.

Instead, useful information from each user's work should be represented in structured shared team state.

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
7. The system distinguishes between confirmed team information and individual opinions.

---

# 4. Core Demo Scenario

The following flow should work end-to-end.

### Step 1 — Person A starts work

Person A asks:

> Build Google authentication for the backend.

The coding agent performs the work.

The system should eventually record something similar to:

```text
Feature: Google Authentication
Owner: Person A
Status: Complete
Description: Google OAuth backend authentication implemented
Relevant Files:
- auth.py
- routes.py

Endpoint:
/auth/google

Source:
Commit abc123

Updated:
12:42 PM
```

---

### Step 2 — Person B opens a separate chat

Person B asks:

> I need to implement login. Where should I start?

Instead of treating this as a new task, the agent should respond approximately:

> Person A already implemented the backend Google authentication flow.
>
> The `/auth/google` endpoint exists and the main implementation is in `auth.py` and `routes.py`.
>
> You can continue by implementing the frontend integration.

The exact response format is not important.

The important behavior is that the agent retrieves existing team context before recommending duplicate work.

---

# 5. Shared Team State

Do NOT implement shared context as simply one giant conversation transcript.

Create structured team state.

At minimum support these information types:

```text
Features / Work
Decisions
Tasks
Facts
Proposals
Opinions
```

Each record should contain metadata such as:

```text
id
team_id
type
title
description
author/user
timestamp
status
source
related files
related commit
```

Example:

```json
{
  "type": "feature",
  "title": "Google Authentication",
  "description": "Backend Google OAuth flow implemented.",
  "author": "Person A",
  "status": "complete",
  "files": [
    "auth.py",
    "routes.py"
  ],
  "source": "commit abc123"
}
```

---

# 6. Information Authority

The system must NOT treat everything a user says as equally authoritative.

Distinguish between:

### Fact

Example:

> The backend currently uses FastAPI.

### Opinion

Example:

> I think MongoDB would be better.

### Proposal

Example:

> We should move authentication to Auth0.

### Decision

Example:

> We decided to use PostgreSQL.

### Work Status

Example:

> Person A is currently implementing authentication.

These should remain separate concepts.

---

# 7. Conflicting Information

The agent should NOT silently choose one person's opinion over another.

Example:

Person A says:

> We should use MongoDB.

Person B says:

> We should use PostgreSQL.

The system should represent these as competing proposals unless a decision has been explicitly recorded.

The agent should respond approximately:

> There are currently conflicting database proposals.
>
> Person A proposed MongoDB.
> Person B proposed PostgreSQL.
>
> No confirmed team decision has been recorded yet.

Once someone records:

> We decided to use PostgreSQL.

the shared state should contain:

```text
Database: PostgreSQL
Status: Confirmed Decision
Previous MongoDB proposal: Superseded
```

Do NOT build a complicated organizational hierarchy system for the MVP.

Simple provenance + information types are sufficient.

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

Shared work should support a simple status lifecycle:

```text
Draft
↓
In Progress
↓
Complete
↓
Superseded
```

At minimum implement:

```text
in_progress
complete
superseded
```

Example:

```text
Authentication
Owner: Person A
Status: In Progress
```

Person B asking to implement authentication should receive:

> Person A is already working on authentication.

After completion:

> Person A completed authentication.

---

# 10. Near-Real-Time Sharing

Shared information should become available to other users within a few seconds.

Do NOT implement continuous synchronization.

Use event-driven updates.

Useful events include:

```text
User explicitly shares information
Agent completes a task
Feature marked complete
Commit created
Decision confirmed
```

Target behavior:

```text
Person A completes work
        ↓
Shared state updated
        ↓
Person B asks related question
        ↓
Agent retrieves new state
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
PostgreSQL

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

Stores structured shared knowledge.

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

## TeamContextItem

```text
id
team_id
author_id
type
title
content
status
created_at
updated_at
source_type
source_reference
```

Possible `type` values:

```text
fact
opinion
proposal
decision
task
feature
```

Possible `status` values:

```text
in_progress
complete
confirmed
superseded
```

---

# 16. Context Retrieval

When a user sends a message, the application should retrieve relevant team context before calling the model.

Do NOT send every team context item every time.

For the MVP, a simple keyword/text search is acceptable.

If straightforward, use embeddings/vector search.

Example:

User:

> How should I implement authentication?

Retrieve:

```text
Google Authentication
Person A
Complete

/auth/google
auth.py
routes.py
```

Include these records in the model's context.

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
│ AI: Person A already implemented...     │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│ Ask your agent...                 Send  │
└─────────────────────────────────────────┘
```

Each user should have a separate conversation.

---

## Team Activity / Context

Provide a basic page/sidebar showing shared state:

```text
TEAM ACTIVITY

✓ Google Authentication
  Person A
  Complete

→ Frontend Dashboard
  Person B
  In Progress

✓ Database Decision
  PostgreSQL
```

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
Build authentication.

Agent:

I found that Person A is already implementing Google
OAuth authentication.

Status: In Progress
Started: 30 minutes ago

Would you like to:

1. View their current work
2. Work on a different part of authentication
3. Continue independently
```

---

# 19. Source / Provenance

Every shared item must retain where it came from.

Examples:

```text
Person A
Chat conversation
Commit abc123
Agent task #53
Manual team decision
```

The agent should preferably be able to say:

> Person A completed this.

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
Person A performs work
       ↓
Their agent records useful shared state
       ↓
Person B independently asks about the same problem
       ↓
Person B's agent knows Person A's work exists
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

Shared structured team context database.

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

Use two browser sessions representing two teammates.

### Person A

Ask:

> Build backend Google authentication.

Agent performs or simulates implementation and records:

```text
Google Authentication
Owner: Person A
Status: Complete
```

### Person B

In a separate account/chat, ask:

> I need to work on login. What should I build?

Agent responds:

> Person A already completed the backend authentication flow.
>
> The `/auth/google` endpoint is available.
>
> The remaining work is frontend integration.

Then show the Team Activity page.

This is the minimum compelling demonstration of the product.