# Contributing to Agent Hub

First off, thank you for considering contributing to Agent Hub! It's people like you that make Agent Hub such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

**Bug Report Template:**

```markdown
**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected behavior**
A clear description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Environment:**
 - OS: [e.g. macOS 13.0]
 - Node.js version: [e.g. 18.16.0]
 - Agent Hub version: [e.g. 1.0.0]
 - Browser: [e.g. Chrome 120]

**Additional context**
Add any other context about the problem here.
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

- A clear and descriptive title
- A detailed description of the proposed feature
- Why this enhancement would be useful to most Agent Hub users
- Possible implementation approach (if you have ideas)

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following our coding standards
3. **Add tests** if you've added code that should be tested
4. **Ensure the test suite passes** (`npm test`)
5. **Update documentation** if you've changed APIs or added features
6. **Write clear commit messages** following our commit conventions
7. **Submit your pull request**

## Development Setup

### Prerequisites

- Node.js 18 or higher
- PostgreSQL 14 or higher
- Git

### Setup Steps

```bash
# 1. Fork and clone your fork
git clone https://github.com/YOUR_USERNAME/agent-hub.git
cd agent-hub

# 2. Add upstream remote
git remote add upstream https://github.com/original/agent-hub.git

# 3. Install dependencies and setup
npm run setup

# 4. Create a feature branch
git checkout -b feature/my-feature

# 5. Start development server
npm run dev
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Type checking
npm run type-check

# Linting
npm run lint
```

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Avoid `any` types - use `unknown` or proper typing
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

```typescript
// Good
interface UserProfile {
  id: string;
  email: string;
  name: string;
}

/**
 * Fetch user profile by ID.
 * @param userId - The user's unique identifier
 * @returns User profile or null if not found
 */
async function getUserProfile(userId: string): Promise<UserProfile | null> {
  // ...
}

// Bad
async function getUser(id: any) {
  // ...
}
```

### React Components

- Use functional components with hooks
- Extract complex logic into custom hooks
- Keep components focused and single-purpose
- Add prop types documentation

```typescript
interface ButtonProps {
  /** Button label text */
  label: string;
  /** Click handler */
  onClick: () => void;
  /** Visual style variant */
  variant?: 'primary' | 'secondary';
  /** Whether button is disabled */
  disabled?: boolean;
}

export function Button({ label, onClick, variant = 'primary', disabled }: ButtonProps) {
  // ...
}
```

### API Routes

- Validate all inputs using Zod schemas
- Return consistent error formats
- Add proper error handling
- Include logging for debugging

```typescript
import { validate, createKeySchema } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = validate(createKeySchema, body);
    
    // Process request...
    
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    // Handle errors appropriately
  }
}
```

### Database

- Use Prisma migrations for schema changes
- Add indexes for frequently queried fields
- Use transactions for multi-step operations
- Document complex queries

```typescript
// Use transactions for related operations
await prisma.$transaction(async (tx) => {
  const agent = await tx.agent.create({ data: agentData });
  await tx.permission.create({ data: { agentId: agent.id, ...permData } });
});
```

## Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that don't affect the meaning of the code
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **test**: Adding or updating tests
- **chore**: Changes to build process or auxiliary tools

### Examples

```
feat(key-management): add automatic key rotation
fix(api): handle null provider in key test endpoint
docs(readme): update installation instructions
test(crypto): add encryption round-trip tests
refactor(dashboard): extract metric card component
```

## Project Structure

```
agent-hub/
├── src/
│   ├── app/              # Next.js pages and API routes
│   ├── components/       # Reusable React components
│   ├── lib/              # Utility functions and helpers
│   └── hooks/            # Custom React hooks
├── packages/
│   ├── cli/              # Command-line interface
│   └── sdk/              # TypeScript SDK for agents
├── prisma/
│   ├── schema.prisma     # Database schema
│   ├── migrations/       # Database migrations
│   └── seed.ts           # Seed data for development
└── scripts/              # Build and deployment scripts
```

## Adding a New Feature

### 1. Plan Your Feature

- Create a GitHub issue describing the feature
- Discuss the implementation approach
- Get feedback from maintainers

### 2. Implement

- Create a feature branch
- Write code following our standards
- Add comprehensive tests
- Update relevant documentation

### 3. Test Thoroughly

- Unit tests for utilities and functions
- Integration tests for API endpoints
- Manual testing in the UI
- Test edge cases and error scenarios

### 4. Submit for Review

- Push to your fork
- Create a pull request with a clear description
- Link related issues
- Respond to review feedback

## Adding Tests

We use Vitest for testing. Place tests next to the code they test:

```
src/lib/
├── crypto.ts
└── __tests__/
    └── crypto.test.ts
```

### Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { functionToTest } from '../module';

describe('functionToTest', () => {
  it('should handle valid input', () => {
    const result = functionToTest('valid-input');
    expect(result).toBe('expected-output');
  });

  it('should throw error for invalid input', () => {
    expect(() => functionToTest('invalid')).toThrow('Error message');
  });
});
```

## Documentation

### Code Documentation

- Add JSDoc comments for all exported functions, classes, and types
- Include parameter descriptions and return types
- Add usage examples for complex APIs

### User Documentation

- Update README.md for user-facing changes
- Add API documentation for new endpoints
- Include migration guides for breaking changes

## Release Process

Releases are managed by maintainers. The process is:

1. Version bump following semantic versioning
2. Update CHANGELOG.md
3. Create a Git tag
4. Publish to npm (for SDK/CLI packages)
5. Create GitHub release with notes

## Questions?

Feel free to:
- Open a discussion on GitHub
- Ask in pull request comments
- Contact maintainers directly

Thank you for contributing to Agent Hub! 🎉
