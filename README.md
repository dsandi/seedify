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

beforeAll(() => seedify.start());

afterAll(async () => {
  await seedify.dump();  // Writes to .seedify/queries.jsonl
});
```

### 2. Install Jailer (one-time)

```bash
npx seedify install  # Requires Java 11+
```

### 3. Generate seeder

```bash
npx seedify generate .seedify/queries.jsonl \
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
| `--debug` | Show verbose Jailer output for troubleshooting |

## API

```javascript
const seedify = require('seedify');

// Capture
seedify.start();
await seedify.dump();
seedify.stop();

// Analyze (if needed separately)
const analysis = await seedify.analyzeFile('.seedify/queries.jsonl');
```

## Supported Patterns

| Pattern | Example |
|---------|---------|
| Equality | `WHERE id = $1` |
| Table-qualified | `WHERE table.column = $1` |
| IN clause | `WHERE id IN ($1, $2, $3)` |
| NOT IN | `WHERE status NOT IN ($1, $2)` |
| ANY (array) | `WHERE id = ANY($1)` |
| Comparison | `WHERE amount >= $1`, `<=`, `>`, `<`, `!=`, `<>` |
| BETWEEN | `WHERE date BETWEEN $1 AND $2` |
| LIKE / ILIKE | `WHERE name LIKE $1` |
| IS NULL | `WHERE deleted_at IS NULL` |
| IS NOT NULL | `WHERE verified_at IS NOT NULL` |
| String literals | `WHERE username = 'alice'` |
| Numeric literals | `WHERE status = 1` |

## Manual Script

For debugging or running steps individually, use `seedify-manual.sh`:

```bash
# Make executable
chmod +x seedify-manual.sh

# Set environment variables and run
DB_HOST=your-host DB_NAME=your_db DB_USER=your_user DB_PASSWORD=secret ./seedify-manual.sh
```

The script runs these steps:
1. `npx seedify analyze` - Extracts table/conditions from queries.jsonl
2. `jailer.sh build-model` - Analyzes database schema
3. Creates `extraction.csv` - Tells Jailer what to extract
4. `jailer.sh export` - Exports the data subset

You can also use the analyze command standalone:

```bash
npx seedify analyze .seedify/queries.jsonl
```

## License

MIT
