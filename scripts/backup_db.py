#!/usr/bin/env python3
"""
RentFlow Automated PostgreSQL Backup Script
Generates a timestamped, compressed PostgreSQL archive using pg_dump.

Usage:
  python scripts/backup_db.py [output_dir]

Restoration Guide:
  To restore a backup into a target database:
    pg_restore -h <host> -U <user> -d <dbname> -v <backup_file.dump>
  Note: Never perform a restore without validating the backup integrity first.
"""

import os
import sys
import subprocess
import datetime
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
env_file = ROOT_DIR / '.env'
if env_file.exists():
    load_dotenv(dotenv_path=env_file)


def create_backup(target_dir: str = 'backups') -> str:
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_dir = Path(target_dir).resolve()
    backup_dir.mkdir(parents=True, exist_ok=True)

    backup_file = backup_dir / f"rentflow_backup_{timestamp}.dump"

    # Database parameters from environment
    pg_host = os.environ.get('PGHOST', '127.0.0.1')
    pg_port = os.environ.get('PGPORT', '5432')
    pg_user = os.environ.get('PGUSER', 'postgres')
    pg_db = os.environ.get('PGDATABASE', 'rentflow')
    pg_password = os.environ.get('PGPASSWORD')

    # Also extract from DATABASE_URL if PGPASSWORD is not directly set
    if not pg_password and os.environ.get('DATABASE_URL'):
        from urllib.parse import urlparse
        parsed = urlparse(os.environ['DATABASE_URL'])
        if parsed.password:
            pg_password = parsed.password
        if parsed.hostname:
            pg_host = parsed.hostname
        if parsed.port:
            pg_port = str(parsed.port)
        if parsed.username:
            pg_user = parsed.username
        if parsed.path and len(parsed.path) > 1:
            pg_db = parsed.path[1:]

    if not pg_password:
        print("[!] Error: PostgreSQL password is required. Set PGPASSWORD or DATABASE_URL in the environment.", file=sys.stderr)
        sys.exit(1)

    env = os.environ.copy()
    env['PGPASSWORD'] = pg_password

    # Locate pg_dump executable
    pg_dump_bin = 'pg_dump'
    if sys.platform == 'win32':
        import shutil
        if not shutil.which('pg_dump'):
            candidates = [
                r"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe",
                r"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe",
                r"C:\Program Files\PostgreSQL\15\bin\pg_dump.exe",
            ]
            for cand in candidates:
                if Path(cand).exists():
                    pg_dump_bin = cand
                    break

    cmd = [
        pg_dump_bin,
        '-h', pg_host,
        '-p', str(pg_port),
        '-U', pg_user,
        '-F', 'c',  # Custom binary compressed format (fast and flexible for pg_restore)
        '-b',       # Include large objects
        '-v',       # Verbose
        '-f', str(backup_file),
        pg_db
    ]

    print(f"[*] Starting non-destructive PostgreSQL backup of database '{pg_db}'...")
    print(f"[*] Destination: {backup_file}")

    try:
        res = subprocess.run(cmd, env=env, check=True, capture_output=True, text=True)
        size_bytes = backup_file.stat().st_size
        print(f"[SUCCESS] Backup completed successfully!")
        print(f"    File: {backup_file}")
        print(f"    Size: {size_bytes / 1024:.2f} KB")
        return str(backup_file)
    except FileNotFoundError:
        print("[!] Error: 'pg_dump' utility not found on PATH. Ensure PostgreSQL client tools are installed.", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"[!] Backup failed: {e.stderr}", file=sys.stderr)
        sys.exit(e.returncode)


if __name__ == '__main__':
    dest = sys.argv[1] if len(sys.argv) > 1 else 'backups'
    create_backup(dest)
