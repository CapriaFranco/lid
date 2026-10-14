#!/usr/bin/env python3
"""Export one Neon database and validate a migration against an isolated Docker clone.

The dump contains production data and must be kept private. This script requires
two interactive confirmations before it connects to Neon or creates local files.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[1]
BACKUP_DIR = ROOT / ".backups-local"
CONTAINER = "lid-pg18-validation"
TARGET_DATABASE = "lid_backup_test"
IMAGE = "postgres:18-alpine"
MIGRATION_IN_CONTAINER = "/tmp/migration_vit_system_admin.sql"


class WorkflowError(RuntimeError):
    pass


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        if key:
            values[key] = value
    return values


def database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"].strip()
    for env_path in (ROOT / ".env.local", ROOT / ".env"):
        value = read_env_file(env_path).get("DATABASE_URL")
        if value:
            return value
    raise WorkflowError("No encontré DATABASE_URL en el entorno, .env.local o .env.")


def source_details(connection_url: str) -> tuple[str, str]:
    try:
        parsed = urlsplit(connection_url)
        host = parsed.hostname or ""
        database = unquote(parsed.path.lstrip("/"))
        query = dict(part.split("=", 1) for part in parsed.query.split("&") if "=" in part)
    except Exception as error:
        raise WorkflowError("DATABASE_URL no tiene un formato PostgreSQL válido.") from error
    if parsed.scheme not in ("postgres", "postgresql") or not host.endswith(".neon.tech"):
        raise WorkflowError("Por seguridad, el origen debe ser una URL de Neon PostgreSQL.")
    if query.get("sslmode", "").lower() not in ("require", "verify-full"):
        raise WorkflowError("DATABASE_URL debe exigir TLS mediante sslmode=require o verify-full.")
    if not database:
        raise WorkflowError("No pude identificar la base dentro de DATABASE_URL.")
    return host, database


def run(args: list[str], *, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            args,
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE if capture else None,
            check=False,
        )
    except FileNotFoundError as error:
        raise WorkflowError(f"No se encontró el ejecutable requerido: {args[0]}.") from error
    if check and result.returncode:
        detail = (result.stderr or "").strip()
        detail = re.sub(r"postgres(?:ql)?://\S+", "[URL REDACTADA]", detail, flags=re.I)
        if len(detail) > 800:
            detail = detail[-800:]
        raise WorkflowError(detail or f"El comando terminó con código {result.returncode}.")
    return result


def docker_is_running() -> bool:
    result = run(["docker", "inspect", "--format", "{{.State.Running}}", CONTAINER], check=False)
    return result.returncode == 0 and result.stdout.strip().lower() == "true"


def assert_local_container() -> None:
    result = run(["docker", "inspect", "--format", "{{.Config.Image}}", CONTAINER], check=False)
    if result.returncode:
        print(f"Creando el contenedor aislado {CONTAINER} con PostgreSQL 18…")
        run(
            [
                "docker", "run", "--detach", "--name", CONTAINER, "--network", "none",
                "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=postgres", IMAGE,
            ]
        )
        result = run(["docker", "inspect", "--format", "{{.Config.Image}}", CONTAINER])
    image = result.stdout.strip().lower()
    if image != IMAGE.lower():
        raise WorkflowError(
            f"El contenedor {CONTAINER} usa {result.stdout.strip()}, no {IMAGE}; no lo voy a modificar."
        )
    if not docker_is_running():
        print(f"Iniciando únicamente el contenedor local {CONTAINER}…")
        run(["docker", "start", CONTAINER])
    for _ in range(30):
        ready = run(["docker", "exec", CONTAINER, "pg_isready", "-U", "postgres", "-d", "postgres"], check=False)
        if ready.returncode == 0:
            return
        time.sleep(1)
    raise WorkflowError(f"PostgreSQL no quedó listo dentro de {CONTAINER}.")


def confirm_copy(host: str, database: str, dump_path: Path) -> None:
    if not sys.stdin.isatty():
        raise WorkflowError("Ejecuta este script en una terminal interactiva para confirmar la copia.")
    print("\nALCANCE DE LA COPIA")
    print(f"Origen: Neon {host} / base {database} (solo lectura).")
    print(f"Destino: archivo local privado {dump_path} y Docker aislado {CONTAINER}/{TARGET_DATABASE} (PostgreSQL 18, sin puerto publicado).")
    print("El dump incluye esquema, datos, funciones/procedimientos, índices y tablas de autenticación.")
    print("Puede contener nombres, teléfonos, códigos, hashes de contraseñas y sesiones/tokens activos.")
    print("El archivo y el clon local deben tratarse como secretos; Neon se usará solo en lectura.")
    first = input("Primera confirmación: escribe COPIAR DATOS DE PRODUCCION: ").strip()
    if first != "COPIAR DATOS DE PRODUCCION":
        raise WorkflowError("Copia cancelada: no se recibió la primera confirmación exacta.")
    print("\nConfirmación final: se descargará la base real y se importará en el PostgreSQL local aislado.")
    second = input("Segunda confirmación: escribe CONFIRMAR BACKUP LOCAL: ").strip()
    if second != "CONFIRMAR BACKUP LOCAL":
        raise WorkflowError("Copia cancelada: no se recibió la segunda confirmación exacta.")


def docker_mount(path: Path, target: str) -> str:
    return f"type=bind,source={path.resolve()},target={target}"


def pg_dump(connection_url: str, dump_path: Path) -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    partial_path = dump_path.with_suffix(dump_path.suffix + ".partial")
    partial_path.unlink(missing_ok=True)
    parsed = urlsplit(connection_url)
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in {"sslmode", "sslrootcert"}
    ]
    # PostgreSQL 18 treats sslmode=require as certificate-verifying when a CA
    # file is configured. Use the image's trusted roots and verify the hostname
    # explicitly instead of disabling TLS verification to work around Alpine's
    # lack of a per-user root.crt.
    query.extend((("sslmode", "verify-full"), ("sslrootcert", "system")))
    verified_connection_url = urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment)
    )
    with tempfile.TemporaryDirectory(prefix="lid-pgdump-env-") as temp_dir:
        env_file = Path(temp_dir) / "source.env"
        env_file.write_text(f"DATABASE_URL={verified_connection_url}\n", encoding="utf-8")
        try:
            run(
                [
                    "docker", "run", "--rm", "--network", "bridge",
                    "--env-file", str(env_file),
                    "--mount", docker_mount(BACKUP_DIR, "/backup"),
                    IMAGE, "sh", "-ec",
                    "pg_dump --format=custom --no-owner --no-acl --dbname=\"$DATABASE_URL\" "
                    f"--file=/backup/{partial_path.name}",
                ]
            )
        except Exception:
            partial_path.unlink(missing_ok=True)
            raise
    if not partial_path.is_file() or partial_path.stat().st_size == 0:
        partial_path.unlink(missing_ok=True)
        raise WorkflowError("pg_dump no generó un archivo válido.")
    partial_path.replace(dump_path)
    run(
        [
            "docker", "run", "--rm", "--mount", docker_mount(BACKUP_DIR, "/backup"),
            IMAGE, "pg_restore", "--list", f"/backup/{dump_path.name}",
        ]
    )


def local_query(sql: str, *, database: str = "postgres", check: bool = True) -> str:
    result = run(
        ["docker", "exec", CONTAINER, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At", "-c", sql],
        check=check,
    )
    return result.stdout.strip()


def restore_and_migrate(dump_path: Path) -> tuple[str, str]:
    assert_local_container()
    exists = local_query(
        f"SELECT 1 FROM pg_database WHERE datname = '{TARGET_DATABASE}'"
    )
    if exists:
        raise WorkflowError(
            f"La base local {TARGET_DATABASE} ya existe. No la voy a sobrescribir; elige otro destino o renómbrala manualmente."
        )

    local_query(f"CREATE DATABASE {TARGET_DATABASE}")
    container_dump = f"/tmp/{dump_path.name}"
    try:
        run(["docker", "cp", str(dump_path), f"{CONTAINER}:{container_dump}"])
        run(
            [
                "docker", "exec", CONTAINER, "pg_restore", "--no-owner", "--no-acl",
                "--exit-on-error", "-U", "postgres", "-d", TARGET_DATABASE, container_dump,
            ]
        )
        run(["docker", "cp", str(ROOT / "sql" / "migration_vit_system_admin.sql"), f"{CONTAINER}:{MIGRATION_IN_CONTAINER}"])
        run(
            [
                "docker", "exec", CONTAINER, "psql", "-X", "-v", "ON_ERROR_STOP=1",
                "-U", "postgres", "-d", TARGET_DATABASE, "-f", MIGRATION_IN_CONTAINER,
            ]
        )
        overview_sql = (
            "SELECT jsonb_build_object('database', s->'database', 'database_size_bytes', "
            "s->'database_size_bytes', 'counts', s->'counts', 'audit_events', "
            "jsonb_array_length(s->'audit')) FROM "
            "(SELECT vit_admin_system_snapshot('127.0.0.1', 'docker-validation@local.invalid', false) AS s) q"
        )
        overview = local_query(overview_sql, database=TARGET_DATABASE)
        backup_sql = (
            "WITH result AS (SELECT vit_admin_system_snapshot('127.0.0.1', "
            "'docker-validation@local.invalid', true)->'backup' AS b) "
            "SELECT jsonb_build_object('format', b->>'format', 'version', b->>'version', "
            "'table_counts', (SELECT jsonb_object_agg(key, jsonb_array_length(value)) "
            "FROM jsonb_each(b->'data'))) FROM result"
        )
        export_check = local_query(backup_sql, database=TARGET_DATABASE)
        return overview, export_check
    finally:
        run(["docker", "exec", CONTAINER, "rm", "-f", container_dump], check=False)


def main() -> int:
    try:
        connection_url = database_url()
        host, database = source_details(connection_url)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        dump_path = BACKUP_DIR / f"lid-{database}-full-{timestamp}.dump"
        assert_local_container()
        confirm_copy(host, database, dump_path)
        print("\nCreando dump lógico; puede tardar según el tamaño de la base…")
        pg_dump(connection_url, dump_path)
        print(f"Dump creado y validado: {dump_path} ({dump_path.stat().st_size:,} bytes).")
        print(f"Restaurando en Docker local: {TARGET_DATABASE}…")
        overview, export_check = restore_and_migrate(dump_path)
        print("Migración aplicada y funciones comprobadas en el clon local.")
        print(f"Resumen (solo metadatos y conteos): {overview}")
        print(f"Prueba de exportación (solo metadatos y conteos): {export_check}")
        print("El origen Neon no se modificó. El dump queda en .backups-local y está excluido de Git.")
        return 0
    except WorkflowError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("Cancelado.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
