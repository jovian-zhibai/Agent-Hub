# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- AES-256-GCM encryption for API key storage
- Real provider API testing (OpenAI, Anthropic, OpenRouter)
- Comprehensive input validation using Zod schemas
- Unit tests for crypto utilities
- CI/CD pipeline with GitHub Actions
- Security policy and vulnerability reporting process
- Contribution guidelines
- Issue and PR templates

### Changed
- Refactored README with comprehensive documentation
- Improved error handling across API routes
- Enhanced TypeScript types and strict mode compliance

### Fixed
- Key encryption now properly implemented (was placeholder)
- Key testing endpoint now performs real API calls (was mock)
- Import paths for crypto utilities in key routes

### Security
- All API keys now encrypted at rest with AES-256-GCM
- Added input validation to prevent injection attacks
- Improved error messages to avoid information leakage

## [1.0.0] - 2026-06-19

### Added
- Initial release of Agent Hub
- Web dashboard for agent management
- CLI tool for connecting agents
- SDK for agent integration
- PostgreSQL database with Prisma ORM
- Multi-key management with automatic failover
- Permission system for tool control
- Cost tracking and monitoring
- Support for OpenCode and Claude agents

### Features
- **Key Management**: Add, test, and monitor multiple API keys
- **Agent Dashboard**: View all connected agents and their status
- **Permission Control**: Fine-grained tool and path-based permissions
- **Cost Analytics**: Real-time token usage and cost tracking
- **Automatic Failover**: Seamless key switching when primary fails

### Database
- Complete Prisma schema with all core models
- Database migrations for PostgreSQL
- Seed data for development

### CLI
- `agent-hub connect`: Connect local agents
- `agent-hub sync`: Sync configuration from server
- Interactive setup wizard

### API
- RESTful API with versioning (v1)
- JWT authentication
- Agent CRUD operations
- Key management endpoints
- Telemetry reporting
- Dashboard statistics

### UI
- Modern dashboard built with Next.js and Tailwind CSS
- Responsive design for mobile and desktop
- Real-time metrics and charts
- Dark theme support

[Unreleased]: https://github.com/yourusername/agent-hub/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yourusername/agent-hub/releases/tag/v1.0.0
