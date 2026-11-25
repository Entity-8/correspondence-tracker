#!/usr/bin/env python3
"""
Khoarzmi-Compatible SQLite to Microsoft SQL Server Migration Converter.
Generates production-ready T-SQL migration scripts from SQLite databases.
Handles identity columns, type mapping, Unicode strings, filtered unique indexes,
and deferred foreign keys with orphan detection.
"""

import os
import sys
import sqlite3
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("mssql_converter")

def _tsql_type(sqlite_type: str, is_key: bool) -> str:
    """Map a SQLite declared type to a T-SQL one."""
    t = (sqlite_type or "").strip().upper()
    if not t:
        return "NVARCHAR(450)" if is_key else "NVARCHAR(MAX)"
    if "INT" in t:
        return "BIGINT" if "BIG" in t else "INT"
    if any(k in t for k in ("CHAR", "CLOB", "TEXT")):
        return "NVARCHAR(450)" if is_key else "NVARCHAR(MAX)"
    if "BLOB" in t:
        return "VARBINARY(MAX)"
    if any(k in t for k in ("REAL", "FLOA", "DOUB")):
        return "FLOAT"
    if any(k in t for k in ("NUMERIC", "DECIMAL")):
        return "DECIMAL(18,6)"
    if "BOOL" in t:
        return "BIT"
    if "DATE" in t or "TIME" in t:
        return "DATETIME2"
    return "NVARCHAR(450)" if is_key else "NVARCHAR(MAX)"

def _tsql_literal(v) -> str:
    """Escape values for T-SQL script generation."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (bytes, bytearray)):
        return "0x" + v.hex()
    return "N'" + str(v).replace("'", "''") + "'"

def generate_mssql_migration(db_path: str, out_path: str, exclude_values=()) -> str:
    """Read SQLite database and generate Microsoft SQL Server migration script."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"SQLite database not found at {db_path}")

    excluded_markers = {v for v in exclude_values if isinstance(v, str) and v}
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()]

    # Pass 1: Load schema and rows for every table
    meta = {}
    for t in tables:
        cols = cur.execute(f'PRAGMA table_info("{t}")').fetchall()
        if not cols:
            continue
        colnames = [c["name"] for c in cols]
        pks = [c["name"] for c in cols if c["pk"]]
        fks = []
        for fk in cur.execute(f'PRAGMA foreign_key_list("{t}")').fetchall():
            fks.append({"from": fk["from"], "table": fk["table"], "to": fk["to"]})
        rows = [tuple(r) for r in cur.execute(f'SELECT * FROM "{t}"').fetchall()]
        meta[t] = {
            "cols": cols,
            "colnames": colnames,
            "pks": pks,
            "fks": fks,
            "rows": rows,
            "drop": set()
        }

    def _fk_target(fk):
        parent = meta.get(fk["table"])
        if fk["to"]:
            return fk["to"]
        if parent and len(parent["pks"]) == 1:
            return parent["pks"][0]
        return "id"

    # Pass 2: Exclusion markers
    if excluded_markers:
        for t, m in meta.items():
            for i, r in enumerate(m["rows"]):
                if any(isinstance(v, str) and v in excluded_markers for v in r):
                    m["drop"].add(i)
        changed = True
        while changed:
            changed = False
            for t, m in meta.items():
                for fk in m["fks"]:
                    parent = meta.get(fk["table"])
                    if not parent or fk["from"] not in m["colnames"]:
                        continue
                    tcol = _fk_target(fk)
                    if tcol not in parent["colnames"]:
                        continue
                    pidx = parent["colnames"].index(tcol)
                    dropped_keys = {parent["rows"][j][pidx] for j in parent["drop"]}
                    if not dropped_keys:
                        continue
                    cidx = m["colnames"].index(fk["from"])
                    for i, r in enumerate(m["rows"]):
                        if i not in m["drop"] and r[cidx] is not None and r[cidx] in dropped_keys:
                            m["drop"].add(i)
                            changed = True

    out = [
        "-- Microsoft SQL Server migration, generated from the app's SQLite database.",
        "-- Generated using Khoarzmi-compatible converter engine.",
        "-- Apply with:  sqlcmd -S <server> -U <user> -P <pw> -d <database> -i mssql_migration.sql",
        "SET QUOTED_IDENTIFIER ON;",
        "SET XACT_ABORT ON;   -- a runtime error aborts the current batch instead of half-applying it",
        "GO",
        "",
    ]
    fk_stmts = []
    n_excluded = 0

    # Pass 3: Emit tables + data
    for t in tables:
        m = meta.get(t)
        if not m:
            continue
        cols, pks = m["cols"], m["pks"]

        uniques = []
        skipped_idx = []
        for idx in cur.execute(f'PRAGMA index_list("{t}")').fetchall():
            if not idx["unique"] or idx["origin"] == "pk":
                continue
            icols = [r["name"] for r in cur.execute(f'PRAGMA index_info("{idx["name"]}")').fetchall()]
            if any(c is None for c in icols) or idx["partial"]:
                sql = cur.execute("SELECT sql FROM sqlite_master WHERE name=?", (idx["name"],)).fetchone()
                skipped_idx.append((sql[0] if sql and sql[0] else idx["name"]))
                continue
            if icols and icols not in uniques:
                uniques.append(icols)

        unique_cols = {c for group in uniques for c in group}
        ident = (pks[0] if len(pks) == 1 and len(
            [c for c in cols if c["pk"] and "INT" in (c["type"] or "").upper()]) == 1 else None)

        defs = []
        for c in cols:
            is_key = c["name"] in pks or bool(c["pk"]) or c["name"] in unique_cols
            piece = f'    [{c["name"]}] {_tsql_type(c["type"], is_key)}'
            if c["name"] == ident:
                piece += " IDENTITY(1,1)"
            if c["notnull"] or c["pk"]:
                piece += " NOT NULL"
            defs.append(piece)

        if pks:
            defs.append("    PRIMARY KEY (" + ", ".join(f"[{p}]" for p in pks) + ")")

        nullable = {c["name"] for c in cols if not c["notnull"] and not c["pk"]}
        filtered_unique_stmts = []
        for group in uniques:
            if any(c in nullable for c in group):
                iname = f"UX_{t}_{'_'.join(group)}"[:120]
                filtered_unique_stmts.append(
                    f"CREATE UNIQUE INDEX [{iname}] ON [{t}] ("
                    + ", ".join(f"[{c}]" for c in group) + ") WHERE "
                    + " AND ".join(f"[{c}] IS NOT NULL" for c in group) + ";"
                )
            else:
                defs.append("    UNIQUE (" + ", ".join(f"[{c}]" for c in group) + ")")

        for sql in skipped_idx:
            out.append(f"-- NOTE: not translated: {' '.join(sql.split())}")
        out.append(f"IF OBJECT_ID('[{t}]', 'U') IS NOT NULL DROP TABLE [{t}];")
        out.append(f"CREATE TABLE [{t}] (")
        out.append(",\n".join(defs))
        out.append(");")
        out.extend(filtered_unique_stmts)
        out.append("GO")
        out.append("")

        kept_rows = [r for i, r in enumerate(m["rows"]) if i not in m["drop"]]
        n_excluded += len(m["drop"])

        for fk in m["fks"]:
            parent = meta.get(fk["table"])
            tcol = _fk_target(fk)
            orphans = 0
            if parent and fk["from"] in m["colnames"] and tcol in parent["colnames"]:
                pidx = parent["colnames"].index(tcol)
                cidx = m["colnames"].index(fk["from"])
                parent_keys = {r[pidx] for j, r in enumerate(parent["rows"]) if j not in parent["drop"]}
                orphans = sum(1 for r in kept_rows if r[cidx] is not None and r[cidx] not in parent_keys)
            stmt = (f"ALTER TABLE [{t}] {'WITH NOCHECK ' if orphans else ''}ADD FOREIGN KEY "
                    f"([{fk['from']}]) REFERENCES [{fk['table']}] ([{tcol}]);")
            if orphans:
                fk_stmts.append(f"-- WARNING: {orphans} row(s) in [{t}].[{fk['from']}] reference a missing row; added WITH NOCHECK")
            fk_stmts.append(stmt)

        if kept_rows:
            names = ", ".join(f"[{c['name']}]" for c in cols)
            if ident:
                out.append(f"SET IDENTITY_INSERT [{t}] ON;")
            for r in kept_rows:
                vals = ", ".join(_tsql_literal(v) for v in r)
                out.append(f"INSERT INTO [{t}] ({names}) VALUES ({vals});")
            if ident:
                out.append(f"SET IDENTITY_INSERT [{t}] OFF;")
            out.append("GO")
            out.append("")

    if fk_stmts:
        out.append("-- Foreign keys, applied after every table exists.")
        out.extend(fk_stmts)
        out.append("GO")
        out.append("")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    conn.close()

    logger.info("Successfully converted %s -> %s (%d tables, %d FKs, %d rows excluded)",
                db_path, out_path, len(meta), len([x for x in fk_stmts if not x.startswith("--")]), n_excluded)
    return out_path

if __name__ == "__main__":
    db_file = sys.argv[1] if len(sys.argv) > 1 else "app.db"
    out_file = sys.argv[2] if len(sys.argv) > 2 else "mssql_migration.sql"
    generate_mssql_migration(db_file, out_file)
    print(f"Migration written to {out_file}")
