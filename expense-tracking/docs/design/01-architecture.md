# Architecture Overview

## System Components

```
┌─────────────┐       ┌─────────────────────┐
│  iOS App    │◄─────►│  Go Server          │
│  (offline   │ sync  │  ┌───────────────┐  │
│   first)    │       │  │CLI Interface  │  │
└─────────────┘       │  └───────────────┘  │
                      │  ┌───────────────┐  │
                      │  │ HTTP API      │  │
                      │  └───────────────┘  │
                      │  ┌───────────────┐  │
                      │  │SQLite (sqlc)  │  │
                      │  └───────────────┘  │
                      └─────────────────────┘
```

## Go Server

The server is the source of truth. It exposes two interfaces:

- **CLI** — A structured, machine-friendly command-line interface. Designed for direct human use and for coding agents to interact with programmatically. Commands output structured text (or JSON with a flag) for easy parsing.
- **HTTP API** — Used by the iOS client for syncing. RESTful endpoints that accept and return JSON.

Both interfaces share the same core service layer. The CLI is not a wrapper around HTTP calls — it talks directly to the service layer.

### Layering

```
 CLI commands ─┐
               ├──► Service Layer ──► Repository (sqlc) ──► SQLite
HTTP handlers ─┘
```

- **Service Layer**: Business logic — validation, categorization, budget checks.
- **Repository**: Data access via sqlc-generated code. No business logic here.
- **SQLite**: Single-file database. Simple deployment, easy backups.

## iOS App

The iOS app is offline-first. It maintains a local SQLite database and syncs with the server when connectivity is available.

- Local-first UI: all reads come from the local DB.
- Background sync pushes local changes to the server and pulls remote changes.
- Transaction detection via iOS Shortcuts automation (primary) or FinanceKit (future) surfaces Apple Pay transactions as suggestions. See [06-apple-pay-automation.md](06-apple-pay-automation.md).

## Key Design Decisions

- **SQLite everywhere**: Both server and iOS client use SQLite. This keeps the data model consistent and simplifies sync logic.
- **Server is source of truth**: Conflicts are resolved server-side. The server assigns canonical IDs and timestamps.
- **CLI-first development**: The CLI is the primary way to develop and test the system. Every operation that the iOS app can do should be doable via CLI.
- **Single-user system**: This is a personal expense tracker. No multi-tenancy, no auth (for now). The server runs on a personal machine or home server.
