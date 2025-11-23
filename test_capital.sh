#!/bin/bash
node startTrend.js \
  --key=bg_341563e7ffde3387dd8d85b38d039671 \
  --secret=e3b3e24d8d80de7739b0fd5553a9a908ab1894a39710491bb0b0807c332991fe \
  --passphrase=123abcABCD \
  --symbol=XRPUSDT_UMCBL \
  --capital=1 \
  --leverage=10 2>&1 | head -15
