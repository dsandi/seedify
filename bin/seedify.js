#!/usr/bin/env node
/**
 * Seedify CLI - Generate minimal test database seeders
 * 
 * Commands:
 *   generate    Analyze queries + extract subset with Jailer (main command)
 *   install     Download and install Jailer locally
 *   check       Verify environment setup
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

// Import analyzer
const analyzerPath = path.join(__dirname, '..', 'src', 'analyzer');
let analyzer;
try {
    analyzer = require(analyzerPath);
} catch (e) {
    analyzer = require('seedify/src/analyzer');
}

const JAILER_VERSION = '16.3.2';
const JAILER_HOME = process.env.JAILER_HOME || path.join(require('os').homedir(), '.seedify', 'jailer');

// Simple logger with timestamps and step tracking
const log = {
    step: 0,
    totalSteps: 0,

    init(total) {
        this.step = 0;
        this.totalSteps = total;
    },

    info(msg) {
        console.log(`  ${msg}`);
    },

    stepStart(msg) {
        this.step++;
        console.log(`\n[${this.step}/${this.totalSteps}] ${msg}`);
    },

    success(msg) {
        console.log(`  ✓ ${msg}`);
    },

    error(msg) {
        console.error(`  ✗ ${msg}`);
    },

    header(msg) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`  ${msg}`);
        console.log('='.repeat(50));
    },

    footer(msg) {
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`  ${msg}`);
        console.log('─'.repeat(50));
    }
};

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command || command === '--help' || command === '-h') {
        printHelp();
        process.exit(0);
    }

    switch (command) {
        case 'generate':
            await runGenerate(args.slice(1));
            break;
        case 'install':
            await runInstall();
            break;
        case 'uninstall':
            await runUninstall();
            break;
        case 'check':
            await runCheck();
            break;
        default:
            console.error(`Unknown command: ${command}`);
            printHelp();
            process.exit(1);
    }
}

function printHelp() {
    console.log(`
Seedify - Generate minimal test database seeders

Usage:
  seedify generate <queries.jsonl> [options]    Analyze + generate subset
  seedify install                               Install Jailer locally
  seedify uninstall                             Remove Jailer installation
  seedify check                                 Check environment

Generate Options:
  <queries.jsonl>         Captured queries file (required)
  -o, --output <file>     Output SQL file (default: ./output/seed.sql)
  --db-url <url>          PostgreSQL URL (e.g., postgresql://user:pass@host/db)
  --db-host <host>        Database host (default: localhost)
  --db-port <port>        Database port (default: 5432)
  --db-name <name>        Database name (required)
  --db-user <user>        Database user (required)
  --db-password <pass>    Database password

Examples:
  seedify generate ./queries.jsonl --db-name mydb --db-user postgres
  seedify generate ./queries.jsonl --db-url postgresql://user:pass@host/db
`);
}

async function runGenerate(args) {
    const options = parseArgs(args);

    // Validate required args
    if (!options.inputFile) {
        console.error('ERROR: Queries file required');
        console.error('Usage: seedify generate <queries.jsonl> --db-name <db> --db-user <user>');
        process.exit(1);
    }

    if (!options.dbName || !options.dbUser) {
        console.error('ERROR: Database name and user required');
        console.error('Use: --db-name <name> --db-user <user>');
        console.error('Or:  --db-url postgresql://user:pass@host/db');
        process.exit(1);
    }

    log.header('Seedify - Generating Test Seeder');
    log.init(4);

    // Step 1: Validate inputs
    log.stepStart('Validating inputs...');

    try {
        await fs.access(options.inputFile);
        log.success(`Found queries file: ${options.inputFile}`);
    } catch {
        log.error(`Queries file not found: ${options.inputFile}`);
        process.exit(1);
    }

    const jailerPath = path.join(JAILER_HOME, 'jailer.sh');
    try {
        await fs.access(jailerPath);
        log.success(`Jailer installed at: ${JAILER_HOME}`);
    } catch {
        log.error('Jailer not installed. Run: seedify install');
        process.exit(1);
    }

    log.info(`Database: ${options.dbHost}:${options.dbPort}/${options.dbName}`);
    log.info(`Output: ${options.outputFile}`);

    // Step 2: Analyze queries
    log.stepStart('Analyzing captured queries...');

    let analysis, jailerConditions;
    try {
        analysis = await analyzer.analyzeFile(options.inputFile);
        jailerConditions = analyzer.generateJailerConditions(analysis);

        log.success(`Analyzed ${analysis.queryCount} queries`);
        log.success(`Found ${analysis.tables.length} tables`);
        log.success(`Extracted ${jailerConditions.length} conditions`);

        if (analysis.tables.length > 0) {
            log.info(`Tables: ${analysis.tables.slice(0, 5).join(', ')}${analysis.tables.length > 5 ? '...' : ''}`);
        }
    } catch (e) {
        log.error(`Failed to analyze: ${e.message}`);
        process.exit(1);
    }

    if (jailerConditions.length === 0) {
        log.error('No conditions extracted from queries');
        log.info('Your queries may not have simple WHERE clauses');
        log.info('Try adding more specific test queries');
        process.exit(1);
    }

    // Step 3: Build Jailer data model
    log.stepStart('Building database model with Jailer...');

    const jdbcUrl = `jdbc:postgresql://${options.dbHost}:${options.dbPort}/${options.dbName}`;
    const tempDir = path.join(require('os').tmpdir(), 'seedify-' + Date.now());
    const dataModelDir = path.join(tempDir, 'datamodel');

    try {
        await fs.mkdir(tempDir, { recursive: true });

        execSync(
            `"${jailerPath}" build-model "${jdbcUrl}" "${options.dbUser}" "${options.dbPassword}" "${dataModelDir}"`,
            { cwd: JAILER_HOME, stdio: 'pipe' }
        );
        log.success('Database model built');
    } catch (e) {
        log.error('Failed to connect to database');
        log.info('Check your connection details and try again');
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
        process.exit(1);
    }

    // Step 4: Extract subset
    log.stepStart('Extracting database subset...');

    const firstCond = jailerConditions[0];
    log.info(`Subject: ${firstCond.table} WHERE ${firstCond.condition}`);

    try {
        await fs.mkdir(path.dirname(options.outputFile), { recursive: true });

        execSync(
            `"${jailerPath}" export -e "${dataModelDir}" -where "${firstCond.condition}" -format SQL "${firstCond.table}" "${jdbcUrl}" "${options.dbUser}" "${options.dbPassword}" "${options.outputFile}"`,
            { cwd: JAILER_HOME, stdio: 'pipe' }
        );

        const stat = await fs.stat(options.outputFile);
        const content = await fs.readFile(options.outputFile, 'utf-8');
        const lines = content.split('\n').length;

        log.success(`Generated: ${options.outputFile}`);
        log.success(`Size: ${(stat.size / 1024).toFixed(1)} KB (${lines} lines)`);
    } catch (e) {
        log.error('Jailer extraction failed');
        log.info(e.message);
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
        process.exit(1);
    }

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });

    log.footer('Done! Seeder file generated successfully.');
}

function parseArgs(args) {
    const options = {
        inputFile: null,
        outputFile: './output/seed.sql',
        dbHost: process.env.DB_HOST || 'localhost',
        dbPort: process.env.DB_PORT || '5432',
        dbName: process.env.DB_NAME || null,
        dbUser: process.env.DB_USER || null,
        dbPassword: process.env.DB_PASSWORD || ''
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        if (!arg.startsWith('-') && !options.inputFile) {
            options.inputFile = arg;
            continue;
        }

        switch (arg) {
            case '-o':
            case '--output':
                options.outputFile = next; i++;
                break;
            case '--db-url':
                try {
                    const url = new URL(next);
                    options.dbHost = url.hostname;
                    options.dbPort = url.port || '5432';
                    options.dbName = url.pathname.slice(1);
                    options.dbUser = url.username;
                    options.dbPassword = decodeURIComponent(url.password);
                } catch { }
                i++;
                break;
            case '--db-host': options.dbHost = next; i++; break;
            case '--db-port': options.dbPort = next; i++; break;
            case '--db-name': options.dbName = next; i++; break;
            case '--db-user': options.dbUser = next; i++; break;
            case '--db-password': options.dbPassword = next; i++; break;
        }
    }

    return options;
}

async function runInstall() {
    log.header('Seedify - Installing Jailer');
    log.init(3);

    // Step 1: Check Java
    log.stepStart('Checking Java installation...');
    try {
        const javaVersion = execSync('java -version 2>&1').toString().split('\n')[0];
        log.success(javaVersion);
    } catch {
        log.error('Java not found');
        log.info('Install Java 11+:');
        log.info('  macOS:  brew install openjdk@17');
        log.info('          Then: sudo ln -sfn $(brew --prefix openjdk@17)/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk');
        log.info('  Ubuntu: sudo apt install openjdk-17-jdk');
        process.exit(1);
    }

    // Step 2: Check if already installed
    log.stepStart('Checking existing installation...');
    const jailerScript = path.join(JAILER_HOME, 'jailer.sh');
    try {
        await fs.access(jailerScript);
        log.success(`Already installed at: ${JAILER_HOME}`);
        log.info('To reinstall, delete the directory first:');
        log.info(`  rm -rf "${JAILER_HOME}"`);
        return;
    } catch {
        log.info('Not installed, proceeding...');
    }

    // Step 3: Download and install
    log.stepStart(`Downloading Jailer ${JAILER_VERSION}...`);

    const downloadUrl = `https://github.com/Wisser/Jailer/releases/download/v${JAILER_VERSION}/jailer_${JAILER_VERSION}.zip`;
    const zipPath = path.join(JAILER_HOME, 'jailer.zip');

    try {
        await fs.mkdir(JAILER_HOME, { recursive: true });
        log.info(`URL: ${downloadUrl}`);

        execSync(`curl -L "${downloadUrl}" -o "${zipPath}"`, { stdio: 'pipe' });
        log.success('Downloaded');

        log.info('Extracting...');
        execSync(`unzip -o "${zipPath}" -d "${JAILER_HOME}"`, { stdio: 'pipe' });

        // Find the extracted directory (could be jailer_X.X.X or jailer-X.X.X or similar)
        const entries = await fs.readdir(JAILER_HOME, { withFileTypes: true });
        const extractedDir = entries.find(e => e.isDirectory() && e.name.startsWith('jailer'));

        if (extractedDir) {
            const extractedPath = path.join(JAILER_HOME, extractedDir.name);
            log.info(`Found: ${extractedDir.name}`);

            // Move contents up one level
            const files = await fs.readdir(extractedPath);
            for (const file of files) {
                const src = path.join(extractedPath, file);
                const dest = path.join(JAILER_HOME, file);
                await fs.rename(src, dest);
            }
            await fs.rmdir(extractedPath);
        }

        // Clean up zip
        await fs.unlink(zipPath);

        // Make scripts executable on Unix
        if (process.platform !== 'win32') {
            try {
                execSync(`chmod +x "${JAILER_HOME}"/*.sh`, { stdio: 'pipe' });
            } catch {
                // Ignore chmod errors
            }
        }

        // Verify installation
        try {
            await fs.access(jailerScript);
            log.success(`Installed to: ${JAILER_HOME}`);
        } catch {
            log.error('Installation incomplete - jailer.sh not found');
            log.info(`Check contents of: ${JAILER_HOME}`);
            process.exit(1);
        }
    } catch (e) {
        log.error(`Installation failed: ${e.message}`);
        log.info(`Try manually:`);
        log.info(`  1. Download: ${downloadUrl}`);
        log.info(`  2. Extract to: ${JAILER_HOME}`);
        process.exit(1);
    }

    log.footer('Jailer installed successfully!');
}

async function runCheck() {
    log.header('Seedify - Environment Check');

    // Java
    log.info('Java:');
    try {
        const v = execSync('java -version 2>&1').toString().split('\n')[0];
        log.success(v);
    } catch {
        log.error('Not installed');
    }

    // Jailer
    log.info('Jailer:');
    try {
        await fs.access(path.join(JAILER_HOME, 'jailer.sh'));
        log.success(`Installed at ${JAILER_HOME}`);
    } catch {
        log.error('Not installed. Run: seedify install');
    }
}

async function runUninstall() {
    log.header('Seedify - Uninstalling Jailer');

    try {
        await fs.access(JAILER_HOME);
    } catch {
        log.info('Jailer is not installed.');
        return;
    }

    log.info(`Removing: ${JAILER_HOME}`);

    try {
        await fs.rm(JAILER_HOME, { recursive: true, force: true });
        log.success('Jailer uninstalled successfully.');
    } catch (e) {
        log.error(`Failed to remove: ${e.message}`);
        log.info(`Try manually: rm -rf "${JAILER_HOME}"`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
