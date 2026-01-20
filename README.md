# Seedify

Capture SQL queries from your tests, then extract only the data you need from your database.

## Install

```bash
npm install seedify
```

## Usage

### 1. Capture queries in your tests

```javascript
// test/setup.js
const seedify = require('seedify');

before(() => seedify.start());

after(async () => {
  await seedify.dump('./queries.jsonl');
});
```

### 2. Run your tests

```bash
npm test  # Creates queries.jsonl
```

### 3. Install Jailer (one-time)

```bash
npx seedify install  # Requires Java 11+
```

### 4. Generate seeder

```bash
npx seedify generate ./queries.jsonl \
  --db-host your-staging-db.com \
  --db-name your_db \
  --db-user postgres \
  --db-password secret
```

Output: `.seedify/seed.sql`

## CLI Commands

```bash
seedify generate <queries.jsonl> [options]  # Analyze + generate subset
seedify install                             # Install Jailer
seedify uninstall                           # Remove Jailer
seedify check                               # Check environment
```

### Generate Options

| Option | Description |
|--------|-------------|
| `-o, --output` | Output SQL file (default: `.seedify/seed.sql`) |
| `--db-url` | PostgreSQL URL (e.g., `postgresql://user:pass@host/db`) |
| `--db-host` | Database host (default: `localhost`) |
| `--db-port` | Database port (default: `5432`) |
| `--db-name` | Database name (required) |
| `--db-user` | Database username (required) |
| `--db-password` | Database password |

## API

```javascript
const seedify = require('seedify');

// Capture
seedify.start();
await seedify.dump('./queries.jsonl');
seedify.stop();

// Analyze (if needed separately)
const analysis = await seedify.analyzeFile('./queries.jsonl');
```

## Supported Patterns

- `WHERE id = $1`
- `WHERE id IN ($1, $2)`
- `WHERE id = ANY($1)`
- `WHERE table.column = 'value'`

## License

MIT
