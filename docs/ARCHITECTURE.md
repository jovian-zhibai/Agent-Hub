# Architecture Documentation

This document describes the technical architecture of Agent Hub.

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Components](#components)
- [Data Flow](#data-flow)
- [Security Architecture](#security-architecture)
- [Database Schema](#database-schema)
- [API Design](#api-design)
- [Technology Stack](#technology-stack)

---

## Overview

Agent Hub is a full-stack web application for managing AI agents, their API keys, permissions, and costs. It consists of three main components:

1. **Web Dashboard** - Next.js-based UI for management
2. **CLI Tool** - Command-line interface for agent connection
3. **SDK** - TypeScript library for agent integration

```
┌─────────────────────────────────────────────┐
│             Agent Hub System                │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │   Web    │  │   CLI    │  │   SDK    │ │
│  │Dashboard │  │   Tool   │  │ (Agent)  │ │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘ │
│        │             │              │      │
│        └─────────────┼──────────────┘      │
│                      │                     │
│              ┌───────▼────────┐            │
│              │   API Layer    │            │
│              │   (Next.js)    │            │
│              └───────┬────────┘            │
│                      │                     │
│              ┌───────▼────────┐            │
│              │   PostgreSQL   │            │
│              │    Database    │            │
│              └────────────────┘            │
└─────────────────────────────────────────────┘
```

---

## System Architecture

### High-Level Architecture

```
┌─────────────┐
│   Browser   │
│  (Client)   │
└──────┬──────┘
       │ HTTPS
       │
┌──────▼──────────────────────────┐
│      Next.js Application        │
│  ┌──────────────────────────┐   │
│  │   Frontend (React)       │   │
│  │   - Dashboard pages      │   │
│  │   - Components           │   │
│  │   - State management     │   │
│  └─────────┬────────────────┘   │
│            │                     │
│  ┌─────────▼────────────────┐   │
│  │   API Routes (Next.js)   │   │
│  │   - Authentication       │   │
│  │   - Agent management     │   │
│  │   - Key management       │   │
│  │   - Telemetry            │   │
│  └─────────┬────────────────┘   │
└────────────┼─────────────────────┘
             │
    ┌────────▼────────┐
    │  Prisma ORM     │
    └────────┬────────┘
             │
    ┌────────▼────────┐
    │   PostgreSQL    │
    │    Database     │
    └─────────────────┘
```

### Local Agent Integration

```
┌───────────────────────────────────────┐
│     Local Development Machine         │
│                                       │
│  ┌─────────────┐  ┌─────────────┐   │
│  │  AI Agent   │  │  AI Agent   │   │
│  │ (OpenCode)  │  │   (Claude)  │   │
│  └──────┬──────┘  └──────┬──────┘   │
│         │                 │          │
│         │  ┌──────────────┘          │
│         │  │                         │
│    ┌────▼──▼────┐                    │
│    │ Agent Hub  │                    │
│    │    SDK     │                    │
│    └──────┬─────┘                    │
│           │                          │
└───────────┼──────────────────────────┘
            │ HTTP/HTTPS
            │
    ┌───────▼─────────┐
    │  Agent Hub API  │
    │   (Cloud/VPS)   │
    └─────────────────┘
```

---

## Components

### 1. Web Dashboard (Frontend)

**Technology**: Next.js 16, React 19, Tailwind CSS

**Structure**:
```
src/app/
├── (dashboard)/          # Authenticated pages
│   ├── page.tsx          # Dashboard home
│   ├── agents/           # Agent management
│   ├── keys/             # Key management
│   └── settings/         # Settings
├── api/                  # API routes
│   └── v1/               # API version 1
│       ├── auth/         # Authentication
│       ├── agents/       # Agent endpoints
│       ├── keys/         # Key endpoints
│       └── telemetry/    # Telemetry endpoints
└── components/           # React components
```

**Key Features**:
- Server-side rendering (SSR)
- SWR for data fetching and caching
- Real-time updates via polling
- Responsive design

### 2. API Layer

**Technology**: Next.js API Routes, Prisma ORM

**Design Principles**:
- RESTful API design
- Versioned endpoints (`/api/v1/`)
- JWT-based authentication
- Rate limiting
- Input validation with Zod

**Middleware Stack**:
```
Request
  ↓
Rate Limiting
  ↓
Authentication
  ↓
Input Validation
  ↓
Business Logic
  ↓
Database Access
  ↓
Response
```

### 3. CLI Tool

**Technology**: Node.js, Commander.js

**Commands**:
- `agent-hub connect` - Scan and register local agents
- `agent-hub sync` - Sync configuration from server
- `agent-hub status` - Show connection status

**Workflow**:
```
1. User runs `agent-hub connect`
2. CLI scans for agent config files
3. CLI authenticates with server
4. CLI registers discovered agents
5. CLI saves config to ~/.agent-hub/config.json
```

### 4. SDK

**Technology**: TypeScript

**Core Classes**:
- `KeyManager` - Manages API keys and failover
- `PermissionChecker` - Validates tool permissions
- `DataReporter` - Reports telemetry
- `LocalCache` - Caches configuration

**Integration**:
```typescript
import { KeyManager, PermissionChecker } from '@agent-hub/sdk';

const keyManager = new KeyManager(cache);
const checker = new PermissionChecker(cache);

// Get active key
const key = await keyManager.getActiveKey();

// Check permission
const allowed = await checker.check({
  toolType: 'bash',
  toolName: 'execute',
});
```

---

## Data Flow

### Agent Registration Flow

```
┌────────┐                   ┌──────────┐                  ┌──────────┐
│  CLI   │                   │   API    │                  │ Database │
└───┬────┘                   └─────┬────┘                  └─────┬────┘
    │                              │                             │
    │  POST /api/v1/auth/login     │                             │
    ├─────────────────────────────>│                             │
    │                              │  Query account              │
    │                              ├────────────────────────────>│
    │                              │<────────────────────────────┤
    │  { token, agentToken }       │                             │
    │<─────────────────────────────┤                             │
    │                              │                             │
    │  POST /api/v1/agents         │                             │
    │  { name, machineId, ... }    │                             │
    ├─────────────────────────────>│                             │
    │                              │  Insert agent               │
    │                              ├────────────────────────────>│
    │                              │<────────────────────────────┤
    │  { agent }                   │                             │
    │<─────────────────────────────┤                             │
    │                              │                             │
```

### Key Failover Flow

```
┌────────┐         ┌──────────┐        ┌──────────────┐
│ Agent  │         │   SDK    │        │  API Server  │
└───┬────┘         └─────┬────┘        └──────┬───────┘
    │                    │                     │
    │  Call API with Key │                     │
    ├───────────────────>│                     │
    │                    │  Use Key #1         │
    │                    ├────────────────────>│
    │                    │                     │
    │                    │  429 Rate Limited   │
    │                    │<────────────────────┤
    │                    │                     │
    │                    │  Mark Key #1 failed │
    │                    │  Switch to Key #2   │
    │                    │                     │
    │                    │  Retry with Key #2  │
    │                    ├────────────────────>│
    │                    │                     │
    │                    │  200 OK             │
    │  Success           │<────────────────────┤
    │<───────────────────┤                     │
    │                    │                     │
```

### Permission Check Flow

```
┌────────┐         ┌────────────────┐        ┌──────────┐
│ Agent  │         │ PermissionChk  │        │  Server  │
└───┬────┘         └────────┬───────┘        └─────┬────┘
    │                       │                      │
    │  Execute tool         │                      │
    ├──────────────────────>│                      │
    │                       │                      │
    │                       │  Load rules (cache)  │
    │                       │                      │
    │                       │  Check tool type     │
    │                       │  Check path patterns │
    │                       │                      │
    │  "allow" / "deny"     │                      │
    │<──────────────────────┤                      │
    │                       │                      │
    │  (if ask)             │                      │
    │  Report to user       │                      │
    │                       │                      │
```

---

## Security Architecture

### Authentication & Authorization

**Token Types**:
1. **Access Token** (JWT)
   - Short-lived (24 hours)
   - Used for dashboard API calls
   - Contains: userId, email, issued timestamp

2. **Agent Token** (JWT)
   - Long-lived (90 days)
   - Used for SDK/CLI → API communication
   - Contains: accountId, issued timestamp

**Token Flow**:
```
Login → Generate Tokens → Store in httpOnly cookie (web) or config file (CLI)
```

### API Key Encryption

**Algorithm**: AES-256-GCM

**Process**:
```
Plaintext Key
    ↓
Generate Random IV (16 bytes)
    ↓
Encrypt with Master Key
    ↓
Generate Auth Tag
    ↓
Store: IV:Ciphertext:AuthTag
```

**Master Key**:
- Stored in environment variable `KEY_ENCRYPTION_KEY`
- Must be 32 bytes (64 hex characters)
- Generated during setup

### Rate Limiting

**Strategy**: In-memory (development) or Redis (production)

**Presets**:
- **Strict**: 5 req / 15 min (auth endpoints)
- **Standard**: 100 req / 1 min (API endpoints)
- **Generous**: 1000 req / 1 min (read operations)

### Input Validation

**Tool**: Zod schemas

**Example**:
```typescript
const createKeySchema = z.object({
  providerId: z.string().min(1),
  keyValue: z.string().min(1),
  scope: z.enum(["personal", "workspace"]),
});

const data = validate(createKeySchema, requestBody);
```

---

## Database Schema

### Entity Relationship

```
┌──────────┐       ┌──────────┐       ┌──────────┐
│ Account  │──────<│  Agent   │>──────│   Key    │
└──────────┘       └──────────┘       └──────────┘
                        │                   │
                        │                   │
                    ┌───▼──────────┐    ┌──▼────────┐
                    │ Permission   │    │ Provider  │
                    └──────────────┘    └───────────┘
                        │
                        │
                    ┌───▼───────────┐
                    │ TelemetryLog  │
                    └───────────────┘
```

### Core Tables

**Account**
- id, name, email, passwordHash
- plan (free/pro/team)
- Created/updated timestamps

**Agent**
- id, accountId, name, framework
- status, machineId, projectPath
- safetyMode, monthlyBudget

**Key**
- id, accountId, providerId
- keyEncrypted, keyPrefix
- protocol, scope, health
- initialBalance, burnRate

**KeyBinding** (M:N relationship)
- agentId, keyId, priority, status

**Permission**
- agentId, rules (JSON)
- safetyMode, version

**TelemetryLog**
- agentId, keyId, eventType
- payload (JSON), reportedAt

---

## API Design

### REST Principles

**Base URL**: `/api/v1/`

**HTTP Methods**:
- `GET` - Retrieve resources
- `POST` - Create resources
- `PATCH` - Update resources
- `DELETE` - Remove resources

**Response Format**:
```json
{
  "success": true|false,
  "data": {...},
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### Endpoint Structure

```
/api/v1/
├── auth/
│   ├── login           POST
│   ├── register        POST
│   └── refresh         POST
├── agents/
│   ├── /               GET, POST
│   └── /:id/
│       ├── /           GET, PATCH, DELETE
│       ├── permissions GET, PATCH
│       ├── key-bindings GET, PUT
│       └── cost-trend  GET
├── keys/
│   ├── /               GET, POST
│   └── /:id/
│       ├── /           GET, PATCH, DELETE
│       ├── test        POST
│       └── usage       GET
└── telemetry/
    └── batch           POST
```

### API Versioning

**Strategy**: URL versioning (`/api/v1/`, `/api/v2/`)

**Deprecation Process**:
1. Announce deprecation 3 months in advance
2. Add `Deprecated` header to responses
3. Maintain old version for 6 months
4. Remove after transition period

---

## Technology Stack

### Frontend
- **Framework**: Next.js 16 (App Router)
- **UI Library**: React 19
- **Styling**: Tailwind CSS 4
- **State Management**: React hooks + SWR
- **Form Validation**: React Hook Form + Zod
- **Charts**: Recharts

### Backend
- **Runtime**: Node.js 20
- **Framework**: Next.js API Routes
- **ORM**: Prisma 7
- **Database**: PostgreSQL 16
- **Authentication**: jsonwebtoken
- **Password Hashing**: bcryptjs
- **Encryption**: Node.js crypto (AES-256-GCM)

### Development
- **Language**: TypeScript 6
- **Testing**: Vitest
- **Linting**: ESLint
- **Formatting**: Prettier
- **CI/CD**: GitHub Actions

### Deployment
- **Containerization**: Docker
- **Orchestration**: Docker Compose
- **Reverse Proxy**: nginx (recommended)
- **TLS**: Let's Encrypt

---

## Performance Considerations

### Database Optimization

**Indexes**:
```sql
-- Frequently queried fields
CREATE INDEX idx_keys_account_provider ON keys(account_id, provider_id);
CREATE INDEX idx_telemetry_agent_time ON telemetry_logs(agent_id, reported_at DESC);
CREATE INDEX idx_agents_account_status ON agents(account_id, status);
```

**Query Optimization**:
- Use `select` to limit returned fields
- Include relations only when needed
- Use pagination for large datasets
- Aggregate data at write time when possible

### Caching Strategy

**Client-side** (SWR):
- Cache API responses
- Revalidate on focus
- Deduplicate requests

**Server-side** (Future):
- Redis for session data
- Redis for rate limit counters
- PostgreSQL materialized views for analytics

### API Performance

**Targets**:
- P50 response time: <100ms
- P95 response time: <300ms
- P99 response time: <1000ms

**Optimization**:
- Database connection pooling
- Efficient queries (avoid N+1)
- Response compression
- CDN for static assets

---

## Scalability

### Horizontal Scaling

**Stateless Design**:
- No session state in memory
- Rate limiting via Redis
- JWT for authentication

**Load Balancing**:
```
        ┌──────────────┐
        │ Load Balancer│
        └───────┬──────┘
       ┌────────┴────────┐
   ┌───▼───┐        ┌───▼───┐
   │ App 1 │        │ App 2 │
   └───┬───┘        └───┬───┘
       └────────┬────────┘
           ┌────▼────┐
           │  Redis  │
           └────┬────┘
           ┌────▼────┐
           │   PG    │
           └─────────┘
```

### Database Scaling

**Vertical Scaling**:
- Increase CPU/RAM
- Faster storage (NVMe SSD)

**Read Replicas**:
- Master for writes
- Replicas for reads
- Connection pooling (PgBouncer)

**Partitioning** (future):
- Partition telemetry by time
- Archive old data

---

## Monitoring & Observability

### Metrics to Track

**Application**:
- API response times
- Error rates
- Active users
- Request throughput

**Database**:
- Query performance
- Connection pool usage
- Slow queries
- Table sizes

**Business**:
- Active agents
- API key usage
- Cost tracking
- Permission denials

### Logging

**Structured Logs** (Future):
```json
{
  "timestamp": "2026-06-20T10:00:00Z",
  "level": "info",
  "service": "api",
  "message": "Key failover triggered",
  "context": {
    "agentId": "...",
    "fromKeyId": "...",
    "toKeyId": "...",
    "reason": "rate_limited"
  }
}
```

### Health Checks

**Endpoint**: `/api/health`

**Checks**:
- ✅ Database connectivity
- ✅ API responsiveness
- (Future) Redis connectivity
- (Future) External API availability

---

## Future Architecture Improvements

### Short-term (v1.1)
- [ ] Redis for rate limiting
- [ ] WebSocket for real-time updates
- [ ] Background job processing
- [ ] Structured logging

### Medium-term (v1.5)
- [ ] Multi-region deployment
- [ ] Read replicas
- [ ] S3 for backups
- [ ] Prometheus metrics

### Long-term (v2.0)
- [ ] Microservices architecture
- [ ] Kubernetes deployment
- [ ] GraphQL API
- [ ] Event sourcing

---

## References

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL Best Practices](https://wiki.postgresql.org/wiki/Don't_Do_This)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)

---

**Last Updated**: 2026-06-20  
**Version**: 1.0  
**Maintainer**: Agent Hub Team
