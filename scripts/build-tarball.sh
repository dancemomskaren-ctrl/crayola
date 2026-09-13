#!/bin/bash
# Quick build script to create a properly-structured tarball
cd /home/annamaeacorrigan/crayola-audit/crayola
tar czf /home/annamaeacorrigan/crayola-current.tar.gz \
  packages/core/src/db.ts \
  packages/core/src/index.ts \
  packages/core/src/templates.ts \
  packages/api/src/index.ts \
  packages/ai/src/index.ts \
  packages/web/src/App.tsx
sha256sum /home/annamaeacorrigan/crayola-current.tar.gz
