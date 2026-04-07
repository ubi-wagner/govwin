#!/usr/bin/env bash
set -e

echo "=== Type Check ==="
cd frontend && npx tsc --noEmit && cd ..

echo "=== Frontend Unit Tests ==="
cd frontend && npm test && cd ..

echo "=== Pipeline Tests ==="
cd pipeline && python -m pytest tests/ -v && cd ..

echo "=== All tests passed ==="
