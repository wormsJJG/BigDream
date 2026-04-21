#!/usr/bin/env python3
"""
Placeholder resource kept for packaging compatibility.

This project currently does not reference this script from the runtime codebase,
but electron-builder expects the file because it is listed in extraResources.
Replace this file with the real implementation before enabling any feature that
depends on packet capture ingestion.
"""

import sys


def main() -> int:
    sys.stderr.write(
        "pcap_receiver.py is a packaging placeholder and has no active runtime behavior.\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
