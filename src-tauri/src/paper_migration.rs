//! Additive Paper schema boundary. Never rewrite the legacy JSON while upgrading.
//! A 0.6.4 executable must not write a v1 database: rollback restores the verified
//! pre-upgrade copy to a separate path after retaining all post-upgrade data.
use rusqlite::{Connection, OpenFlags, Transaction, TransactionBehavior};
use std::path::{Path, PathBuf};

const SCHEMA_VERSION: i64 = 1;

fn err(error: impl std::fmt::Display) -> String {
    format!("PAPER_MIGRATION: {error}")
}

fn version(c: &Connection) -> Result<i64, String> {
    c.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(err)
}

fn has_table(c: &Connection, name: &str) -> Result<bool, String> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |row| row.get(0),
    )
    .map_err(err)
}

fn state(c: &Connection) -> Result<String, String> {
    let data: String = c
        .query_row("SELECT data FROM paper_state WHERE id=1", [], |row| {
            row.get(0)
        })
        .map_err(err)?;
    // This verifies compatibility without inserting nullable fields or modifying
    // the original task, session, manual fact, or note snapshots.
    serde_json::from_str::<crate::paper::PaperState>(&data).map_err(err)?;
    Ok(data)
}

#[derive(Debug, PartialEq)]
struct Snapshot {
    state: String,
    events: Option<Vec<(i64, String)>>,
    requests: Option<Vec<(String, String, String)>>,
}

fn snapshot(c: &Connection) -> Result<Snapshot, String> {
    let events = if has_table(c, "paper_events")? {
        let mut query = c
            .prepare("SELECT seq,data FROM paper_events ORDER BY seq")
            .map_err(err)?;
        let rows = query
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(err)?;
        Some(rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?)
    } else {
        None
    };
    let requests = if has_table(c, "paper_requests")? {
        let mut query = c
            .prepare("SELECT id,fingerprint,result FROM paper_requests ORDER BY id")
            .map_err(err)?;
        let rows = query
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(err)?;
        Some(rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?)
    } else {
        None
    };
    Ok(Snapshot {
        state: state(c)?,
        events,
        requests,
    })
}

fn backup_path(path: &Path) -> Result<PathBuf, String> {
    let mut name = path
        .file_name()
        .ok_or_else(|| err("数据库路径缺少文件名"))?
        .to_os_string();
    name.push(".pre-schema-1.sqlite");
    Ok(path.with_file_name(name))
}

fn verified_backup(c: &Connection, path: &Path) -> Result<Snapshot, String> {
    let destination = backup_path(path)?;
    if destination.exists() {
        return Err(err(format!(
            "升级前备份已存在，未覆盖；请核对后再升级：{}",
            destination.display()
        )));
    }
    // VACUUM INTO includes committed WAL contents; a raw copy of the open .db
    // file would not. A failed or incomplete backup never advances user_version.
    c.execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])
        .map_err(err)?;
    let backup =
        Connection::open_with_flags(&destination, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    let mut query = backup.prepare("PRAGMA integrity_check").map_err(err)?;
    let rows = query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(err)?;
    let checks = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
    if checks != ["ok"] || version(&backup)? != 0 {
        return Err(err("升级前备份校验失败，数据库版本未升级"));
    }
    snapshot(&backup)
}

/// Run immediately after opening the connection, before creating Paper tables.
/// Existing v0 files are backed up next to the source as
/// `<database filename>.pre-schema-1.sqlite`; new/in-memory databases need no copy.
pub fn prepare(c: &Connection, path: &Path) -> Result<(), String> {
    let current = version(c)?;
    if current > SCHEMA_VERSION || current < 0 {
        return Err(err(format!(
            "数据库版本 {current} 不受当前应用支持；未修改数据库"
        )));
    }
    if current == SCHEMA_VERSION {
        return Ok(());
    }
    let existing = has_table(c, "paper_state")?;
    if existing {
        state(c)?;
    }
    let disk = c.path().filter(|value| !value.is_empty());
    let backup = if existing && disk.is_some() {
        // Do not let a mismatched argument place the backup beside another file.
        let connected = std::fs::canonicalize(disk.unwrap()).map_err(err)?;
        let supplied = std::fs::canonicalize(path).map_err(err)?;
        if connected != supplied {
            return Err(err("数据库连接与备份路径不一致，未升级"));
        }
        Some(verified_backup(c, path)?)
    } else {
        None
    };
    let transaction = Transaction::new_unchecked(c, TransactionBehavior::Immediate).map_err(err)?;
    if version(&transaction)? != 0 {
        return Err(err("数据库版本在备份期间变化，未升级"));
    }
    if let Some(saved) = backup {
        // Acquire the write lock and compare with the consistent copy before the
        // marker changes. Concurrent writes must never escape the rollback copy.
        if snapshot(&transaction)? != saved {
            return Err(err("数据库在备份期间有新记录，保留备份且未升级"));
        }
    }
    transaction
        .pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(err)?;
    transaction.commit().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../scripts/fixtures/p0p1/legacy-state.json"
        ))
        .unwrap()
    }

    fn legacy(c: &Connection) {
        let fixture = fixture();
        c.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE paper_state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL); CREATE TABLE paper_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL); CREATE TABLE paper_requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);").unwrap();
        c.execute(
            "INSERT INTO paper_state VALUES(1,?1)",
            [fixture["state"].to_string()],
        )
        .unwrap();
        for event in fixture["events"].as_array().unwrap() {
            c.execute(
                "INSERT INTO paper_events(seq,data) VALUES(?1,?2)",
                rusqlite::params![event["seq"].as_i64().unwrap(), event["data"].to_string()],
            )
            .unwrap();
        }
        for request in fixture["requests"].as_array().unwrap() {
            c.execute(
                "INSERT INTO paper_requests(id,fingerprint,result) VALUES(?1,?2,?3)",
                rusqlite::params![
                    request["id"].as_str().unwrap(),
                    request["fingerprint"].as_str().unwrap(),
                    request["result"].as_str().unwrap()
                ],
            )
            .unwrap();
        }
    }

    #[test]
    fn new_and_memory_databases_mark_version_without_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new.sqlite");
        let c = Connection::open(&path).unwrap();
        prepare(&c, &path).unwrap();
        assert_eq!(version(&c).unwrap(), 1);
        assert!(!has_table(&c, "paper_state").unwrap());
        assert!(!backup_path(&path).unwrap().exists());
        let memory = Connection::open_in_memory().unwrap();
        legacy(&memory);
        let before = snapshot(&memory).unwrap();
        prepare(&memory, Path::new(":memory:")).unwrap();
        assert_eq!(version(&memory).unwrap(), 1);
        assert_eq!(snapshot(&memory).unwrap(), before);
    }

    #[test]
    fn legacy_wal_backup_preserves_all_facts_and_requests_and_reopen_does_not_repeat() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.sqlite");
        let c = Connection::open(&path).unwrap();
        legacy(&c);
        let before = snapshot(&c).unwrap();
        prepare(&c, &path).unwrap();
        assert_eq!(version(&c).unwrap(), 1);
        assert_eq!(snapshot(&c).unwrap(), before);
        let backup_path = backup_path(&path).unwrap();
        let backup =
            Connection::open_with_flags(&backup_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(version(&backup).unwrap(), 0);
        assert_eq!(snapshot(&backup).unwrap(), before);
        drop(backup);
        let backup_bytes = std::fs::read(&backup_path).unwrap();
        drop(c);
        let reopened = Connection::open(&path).unwrap();
        prepare(&reopened, &path).unwrap();
        assert_eq!(std::fs::read(&backup_path).unwrap(), backup_bytes);
        assert_eq!(snapshot(&reopened).unwrap(), before);
    }

    #[test]
    fn backup_failure_keeps_version_zero_and_existing_content_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blocked.sqlite");
        let c = Connection::open(&path).unwrap();
        legacy(&c);
        let before = snapshot(&c).unwrap();
        let backup = backup_path(&path).unwrap();
        std::fs::create_dir(&backup).unwrap();
        assert!(prepare(&c, &path).unwrap_err().contains("备份已存在"));
        assert_eq!(version(&c).unwrap(), 0);
        assert_eq!(snapshot(&c).unwrap(), before);
        assert!(backup.is_dir());
    }

    #[test]
    fn invalid_state_and_unknown_version_reject_before_backup_or_marker_changes() {
        let dir = tempfile::tempdir().unwrap();
        let invalid_path = dir.path().join("invalid.sqlite");
        let invalid = Connection::open(&invalid_path).unwrap();
        legacy(&invalid);
        invalid
            .execute("UPDATE paper_state SET data=?1", ["{\"tasks\":false}"])
            .unwrap();
        assert!(prepare(&invalid, &invalid_path).is_err());
        assert_eq!(version(&invalid).unwrap(), 0);
        assert!(!backup_path(&invalid_path).unwrap().exists());
        let newer_path = dir.path().join("newer.sqlite");
        let newer = Connection::open(&newer_path).unwrap();
        legacy(&newer);
        newer.pragma_update(None, "user_version", 2).unwrap();
        let before = snapshot(&newer).unwrap();
        assert!(prepare(&newer, &newer_path).unwrap_err().contains("版本 2"));
        assert_eq!(version(&newer).unwrap(), 2);
        assert_eq!(snapshot(&newer).unwrap(), before);
        assert!(!backup_path(&newer_path).unwrap().exists());
    }

    #[test]
    fn mismatched_path_cannot_place_backup_beside_another_database() {
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("source.sqlite");
        let other_path = dir.path().join("other.sqlite");
        let c = Connection::open(&source_path).unwrap();
        legacy(&c);
        let other = Connection::open(&other_path).unwrap();
        assert!(prepare(&c, &other_path).unwrap_err().contains("路径不一致"));
        assert_eq!(version(&c).unwrap(), 0);
        assert_eq!(version(&other).unwrap(), 0);
        assert!(!backup_path(&source_path).unwrap().exists());
        assert!(!backup_path(&other_path).unwrap().exists());
    }

    #[test]
    fn rollback_rehearsal_retains_post_upgrade_data_and_restores_only_to_a_separate_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("upgraded.sqlite");
        let retained_path = dir.path().join("post-upgrade-retained.sqlite");
        let restored_path = dir.path().join("restored-legacy.sqlite");
        let c = Connection::open(&path).unwrap();
        legacy(&c);
        let old = snapshot(&c).unwrap();
        prepare(&c, &path).unwrap();
        let mut after: Value = serde_json::from_str(&old.state).unwrap();
        after["notes"].as_array_mut().unwrap().push(json!({
            "id":"90000000-0000-4000-8000-000000000001",
            "text":"升级后新增的合成笔记，回退时不能丢弃",
            "createdAt":fixture()["metadata"]["sampledAt"],
            "source":"user"
        }));
        c.execute("UPDATE paper_state SET data=?1", [after.to_string()])
            .unwrap();
        let upgraded = snapshot(&c).unwrap();
        c.execute("VACUUM INTO ?1", [retained_path.to_string_lossy().as_ref()])
            .unwrap();
        let retained =
            Connection::open_with_flags(&retained_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(snapshot(&retained).unwrap(), upgraded);
        assert_eq!(version(&retained).unwrap(), 1);
        assert!(!restored_path.exists());
        std::fs::copy(backup_path(&path).unwrap(), &restored_path).unwrap();
        let restored =
            Connection::open_with_flags(&restored_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(version(&restored).unwrap(), 0);
        assert_eq!(snapshot(&restored).unwrap(), old);
        assert_eq!(snapshot(&c).unwrap(), upgraded);
        assert_eq!(version(&c).unwrap(), 1);
        assert_ne!(restored_path, path);
    }
}
