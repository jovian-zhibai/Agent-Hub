# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

### How to Report

Send an email to **security@agent-hub.dev** (or open a private security advisory on GitHub) with:

1. **Description**: Detailed description of the vulnerability
2. **Impact**: What could an attacker accomplish?
3. **Reproduction**: Step-by-step instructions to reproduce
4. **Fix Suggestions**: If you have ideas on how to fix it

### What to Expect

- **Acknowledgment**: We'll acknowledge your report within 48 hours
- **Assessment**: We'll assess the vulnerability and its impact within 7 days
- **Fix Timeline**: Critical issues will be fixed within 14 days, others within 30 days
- **Disclosure**: We'll coordinate disclosure with you

### Vulnerability Disclosure Process

1. Security issue is reported privately
2. We confirm the issue and determine severity
3. We develop and test a fix
4. We release a security update
5. We publish a security advisory with credit to the reporter (if desired)

## Security Best Practices

### For Users

1. **Keep Updated**: Always use the latest version
2. **Secure Environment Variables**: Never commit `.env` files
3. **Strong Secrets**: Use the auto-generated secrets from `npm run setup`
4. **Database Security**: Use strong PostgreSQL passwords
5. **HTTPS Only**: Always use HTTPS in production
6. **Regular Audits**: Run `npm audit` regularly

### For Contributors

1. **No Secrets in Code**: Never hardcode API keys, passwords, or tokens
2. **Input Validation**: Always validate and sanitize user input
3. **SQL Injection**: Use Prisma ORM (never raw SQL strings)
4. **XSS Protection**: Sanitize user-generated content
5. **CSRF Protection**: Use Next.js built-in CSRF protection
6. **Rate Limiting**: Implement rate limiting on sensitive endpoints

## Known Security Features

### Implemented

- ✅ **AES-256-GCM Encryption**: All API keys encrypted at rest
- ✅ **JWT Authentication**: Secure token-based authentication
- ✅ **Input Validation**: Zod schemas for all API inputs
- ✅ **SQL Injection Protection**: Prisma ORM with parameterized queries
- ✅ **Password Hashing**: bcrypt for password storage
- ✅ **HTTPS Ready**: TLS/SSL support for production

### Roadmap

- 🔄 **Rate Limiting**: Per-endpoint and per-user rate limits
- 🔄 **2FA Support**: Two-factor authentication
- 🔄 **Audit Logging**: Comprehensive security event logging
- 🔄 **Content Security Policy**: CSP headers
- 🔄 **Security Headers**: HSTS, X-Frame-Options, etc.

## Security Considerations

### API Keys

- Keys are encrypted with AES-256-GCM before database storage
- Master encryption key (`KEY_ENCRYPTION_KEY`) must be kept secure
- Keys are never logged or exposed in API responses
- Use environment variables, never hardcode keys

### Authentication

- JWT tokens expire after 24 hours
- Tokens are signed with `JWT_SECRET`
- No session cookies in localStorage (XSS protection)
- Refresh token rotation coming in v1.1

### Database

- Use strong passwords for PostgreSQL
- Enable PostgreSQL SSL in production
- Regular backups
- Principle of least privilege for database users

### Deployment

- Never expose `.env` files
- Use environment variables for all secrets
- Enable HTTPS/TLS
- Keep Node.js and dependencies updated
- Use a reverse proxy (nginx, Caddy) in production

## Security Tools

We use the following tools to maintain security:

- **npm audit**: Dependency vulnerability scanning
- **Snyk**: Continuous security monitoring
- **ESLint**: Static code analysis
- **TypeScript**: Type safety to prevent common bugs
- **Prisma**: ORM to prevent SQL injection

## Hall of Fame

We appreciate security researchers who help keep Agent Hub secure:

<!-- Add names of security researchers who reported vulnerabilities -->

## Contact

For security concerns:
- Email: security@agent-hub.dev
- GPG Key: [Coming soon]

For general questions:
- GitHub Issues: https://github.com/yourusername/agent-hub/issues
- Discussions: https://github.com/yourusername/agent-hub/discussions
