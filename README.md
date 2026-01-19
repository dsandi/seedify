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
  --db-name your_db \
  --db-user postgres \
  --db-password secret
```

Output: `./output/seed.sql`

## CLI Commands

```bash
seedify generate <queries.jsonl> [options]  # Main command
seedify install                             # Install Jailer
seedify check                               # Check environment
```

### Generate Options

| Option | Description |
|--------|-------------|
| `-o, --output` | Output SQL file (default: `./output/seed.sql`) |
| `--db-url` | PostgreSQL URL |
| `--db-host` | Host (default: localhost) |
| `--db-port` | Port (default: 5432) |
| `--db-name` | Database name (required) |
| `--db-user` | Username (required) |
| `--db-password` | Password |

## API

```javascript
const seedify = require('seedify');

// Capture
seedify.start();
seedify.dump('./queries.jsonl');
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
