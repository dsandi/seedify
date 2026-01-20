#!/bin/bash
# seedify-manual.sh - Run seedify steps manually
# Usage: ./seedify-manual.sh

set -e  # Exit on error

# Configuration - EDIT THESE
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-your_db}"
DB_USER="${DB_USER:-your_user}"
DB_PASSWORD="${DB_PASSWORD:-your_password}"
QUERIES_FILE="${QUERIES_FILE:-.seedify/queries.jsonl}"

# Derived paths
JAILER_HOME="$HOME/.seedify/jailer"
JDBC_URL="jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}"
SEEDIFY_DIR=".seedify"
DATAMODEL_DIR="${SEEDIFY_DIR}/datamodel"
EXTRACTION_CSV="${SEEDIFY_DIR}/extraction.csv"
OUTPUT_SQL="${SEEDIFY_DIR}/seed.sql"

echo "=== Step 1: Analyze queries ==="
ANALYSIS=$(npx seedify analyze "${QUERIES_FILE}")
TABLE=$(echo "$ANALYSIS" | jq -r '.conditions[0].table')
CONDITION=$(echo "$ANALYSIS" | jq -r '.conditions[0].condition')
echo "  Found: $TABLE WHERE $CONDITION"

echo "=== Step 2: Clean up old files ==="
rm -rf "${DATAMODEL_DIR}" "${EXTRACTION_CSV}"
mkdir -p "${DATAMODEL_DIR}"

echo "=== Step 3: Build data model ==="
"${JAILER_HOME}/jailer.sh" build-model \
  -datamodel "${DATAMODEL_DIR}" \
  org.postgresql.Driver \
  "${JDBC_URL}" \
  "${DB_USER}" \
  "${DB_PASSWORD}"

echo "=== Step 4: Create extraction model ==="
echo "${TABLE}; ${CONDITION}" > "${EXTRACTION_CSV}"
echo "  Created: ${EXTRACTION_CSV}"

echo "=== Step 5: Export data ==="
"${JAILER_HOME}/jailer.sh" export \
  "${EXTRACTION_CSV}" \
  -datamodel "${DATAMODEL_DIR}" \
  -e "${OUTPUT_SQL}" \
  -format SQL \
  -scope LOCAL_DATABASE \
  -local-database-storage "${SEEDIFY_DIR}/tmp" \
  -use-rowid-if-needed \
  org.postgresql.Driver \
  "${JDBC_URL}" \
  "${DB_USER}" \
  "${DB_PASSWORD}"

echo "=== Step 6: Cleanup ==="
rm -rf "${SEEDIFY_DIR}/tmp"
echo "  Removed temp files"

echo "=== Done! ==="
echo "Output: ${OUTPUT_SQL}"
