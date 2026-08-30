# Relay — shared team AI workspace

![Relay — Shared memory. Standardized tools.](app/static/images/relay-readme-banner.png)

Relay gives each person a private AI chat while making approved organizational knowledge and tools available across the team. It is designed for consulting and research teams that want to reuse completed work, avoid duplicate effort, and provide a consistent set of AI capabilities without requiring every user to manage technical integrations.

## What it demonstrates

- **Private conversations:** each person sees only their own conversations.
- **Shared team memory:** verified work, handoffs, documentation, and conflicts are stored as structured records that Relay retrieves before answering related questions.
- **Admin-managed capabilities:** an administrator can make prompts, reference documents, skills, HTTP functions, and remote MCP servers available to everyone in the organization.
- **Governed external calls:** tool activity is recorded with the conversation it belongs to. MCP calls can require the conversation owner’s approval.

## Hackathon quick start

### Prerequisites

- Docker Desktop (or Docker Engine with the Compose plugin)
- An OpenAI API key for the complete live demo

No GitHub, Context7, or DeepWiki API key is needed for the preconfigured demo capabilities. The OpenAI key is the only key judges need to supply for live chat responses and live tool/MCP calls.

### Run locally

Relay runs entirely in Docker. From a fresh clone:

1. Create your private environment file from the tracked template:

   ```sh
   cp .env.example .env
   ```

2. Edit `.env` and replace the placeholder:

   ```dotenv
   OPENAI_API_KEY=your_openai_api_key
   ```

   `.env` is intentionally ignored by Git and must not be committed.

3. Build and start the development service:

   ```sh
   docker compose up --build --detach
   ```

4. Open [http://localhost:8000](http://localhost:8000).

The service is named `dev`, bind-mounts this project at `/workspace`, and publishes port `8000`.

### Keys and environment variables

| Variable | Needed for | Required? |
| --- | --- | --- |
| `OPENAI_API_KEY` | Live Relay responses and live HTTP/MCP capability calls | Yes for the full hackathon demo |
| `OPENAI_MODEL` | Override the default `gpt-5` model | No |
| `RELAY_TOOL_HEADER_ENV_ALLOWLIST` and the referenced key variables | A custom administrator-created HTTP tool that requires an API-key header | No |
| `RELAY_COOKIE_SECURE=true` | An HTTPS deployment | No; leave unset locally |

If no `OPENAI_API_KEY` is provided, Relay starts in **demo mode**. Judges can still sign in, browse shared memory, inspect the admin configuration, and explore the UI, but Relay cannot produce live model responses or call external tools/MCP servers.

Useful commands:

```sh
# Follow application logs
docker compose logs --follow dev

# Confirm the service is healthy
docker compose exec -T dev python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health').read().decode())"

# Stop the service
docker compose down
```

## Demo accounts

| User | Role | Email | Password |
| --- | --- | --- | --- |
| John | Administrator | `john@northstar.consulting` | `Northstar-John-2026!` |
| Mary | Member | `mary@northstar.consulting` | `Northstar-Mary-2026!` |
| Bob | Member | `bob@northstar.consulting` | `Northstar-Bob-2026!` |

These are local demo credentials only.

## Explore shared knowledge

The initial shared-memory records live in [`app/data/data.json`](app/data/data.json). They include completed authentication work, an Expense API handoff, dashboard work, and an unresolved PostgreSQL/MongoDB conflict.

1. Sign in as Mary or Bob.
2. Ask a question that overlaps existing work, such as:

   - `What is the current database decision?`
   - `Can I start the dashboard work?`
   - `What is already complete for authentication?`

3. Relay searches the team memory before responding and identifies the relevant work, owner, and conflict or handoff details.
4. Open the **Team memory** panel to browse the same structured records. The **+ Share work** button publishes a useful outcome to the team without exposing the rest of a private conversation.

To see the cross-user behavior, share a short handoff while signed in as one user, then sign in as another and ask a related question. The later response can reuse the shared record instead of proposing duplicate work.

## Explore shared tools and MCP servers

The initial administrator configuration includes two read-only HTTP functions for GitHub repository and issue search, plus Context7 and DeepWiki MCP server definitions. Live execution requires `OPENAI_API_KEY`.

1. Sign in as **John**.
2. Select **Agent configuration** in the left rail.
3. Use the **Tools** and **MCP servers** tabs to review the organization-wide capability library.
4. Return to a private conversation and ask Relay to use a capability, for example:

   - `Use the GitHub issue search tool to find open Next.js issues about sourcemaps.`
   - `Use the configured documentation MCP server to look up the current Next.js routing guidance.`

5. Relay shows a compact activity row directly beneath the response that triggered the call. Select **View result** for details. If a server requires approval, the conversation owner can approve or reject it there.

Only John can change organization-wide configuration. Members receive the enabled capabilities automatically, but do not see editable configuration controls.

## Add an organization-wide capability

As John, open **Agent configuration** and select **+ Add resource**. Choose one of the available types:

- **HTTP function tool:** a public HTTPS `GET` or `POST` endpoint with an input JSON Schema.
- **Remote MCP server:** a public HTTPS MCP server plus its explicit allowlist of tools and approval policy.
- **Markdown or SKILL.md:** team reference material applied to subsequent responses.
- **Prompt template:** an organization-wide response instruction.

Relay validates remote endpoints and blocks non-HTTPS, local, private, link-local, multicast, and reserved addresses. If an HTTP tool needs a secret header, configure an environment-variable reference and include its name in `RELAY_TOOL_HEADER_ENV_ALLOWLIST`; never paste raw credentials into the tool form.

## Project layout

```text
app/main.py             FastAPI routes, retrieval, authorization, and capability execution
app/database.py         SQLite schema, migrations, demo accounts, and capability seeds
app/data/data.json      Canonical seeded shared-memory records
app/static/             Browser UI
docs/interface-contract.json  API and behavior contract
compose.yaml            Containerized development service
Dockerfile              Development image and Python dependencies
```

## Data behavior

SQLite data is stored at `app/team_memory.db` and is bind-mounted with the project. The canonical records from `app/data/data.json` are loaded only when shared memory is empty, so normal restarts preserve conversations, published work, and administrator configuration.
