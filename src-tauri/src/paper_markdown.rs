//! Readable journals are projections of committed Paper data. Personal notes are never rewritten.
use crate::paper::{self, PaperDb, PaperState};
use chrono::{Local, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
fn root(c: &Connection) -> Option<PathBuf> {
    c.path()
        .filter(|p| !p.is_empty() && *p != ":memory:")
        .and_then(|p| Path::new(p).parent())
        .map(|p| p.join("工作记录"))
}
fn valid_date(date: &str) -> Result<(), String> {
    let parsed =
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "INVALID_INPUT: date")?;
    if parsed.format("%Y-%m-%d").to_string() != date {
        return Err("INVALID_INPUT: date".into());
    }
    Ok(())
}
fn text(v: &Value, field: &str) -> String {
    v[field].as_str().unwrap_or("").to_string()
}
fn cell(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('|', "&#124;")
        .replace(['\n', '\r'], " ")
}
fn date_at(at: i64) -> String {
    Local
        .timestamp_millis_opt(at)
        .single()
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}
fn time_at(v: &Value) -> String {
    v.as_i64()
        .and_then(|at| Local.timestamp_millis_opt(at).single())
        .map(|d| d.format("%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "进行中".into())
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(error)?;
        file.write_all(content.as_bytes()).map_err(error)?;
        file.sync_all().map_err(error)?;
        drop(file);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            if unsafe {
                MoveFileExW(
                    from.as_ptr(),
                    to.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(error(std::io::Error::last_os_error()));
            }
        }
        #[cfg(not(windows))]
        fs::rename(&temp, path).map_err(error)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn ensure_personal(path: &Path, title: &str) -> Result<(), String> {
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut file) => file
            .write_all(personal_template(title).as_bytes())
            .map_err(error),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(error(e)),
    }
}
fn personal_template(title: &str) -> String {
    format!("# {title}\n\n这里由你自由记录。自动同步不会改写这个文件。\n")
}

const NOTES_LIMIT: u64 = 131_072;
fn read_note(path: &Path) -> Result<String, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(error(e)),
    };
    let mut bytes = Vec::new();
    file.take(NOTES_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() as u64 > NOTES_LIMIT {
        return Err("NOTES_TOO_LARGE: 请将个人笔记控制在每份 128KB 内再请求总结。".into());
    }
    String::from_utf8(bytes).map_err(error)
}

// Scan file metadata on a background tick; read contents only for a changed note.
// The cache stays in this independent database and is not a second editable record.
fn notes_hash(c: &Connection, dir: &Path) -> Result<String, String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS paper_journal_notes(path TEXT PRIMARY KEY,stamp TEXT NOT NULL,hash TEXT NOT NULL);").map_err(error)?;
    let mut paths = BTreeSet::from([dir.join("个人笔记.md")]);
    for entry in fs::read_dir(dir.join("每日")).map_err(error)? {
        let entry = entry.map_err(error)?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name
            .strip_suffix(".个人笔记.md")
            .is_some_and(|date| valid_date(date).is_ok())
        {
            paths.insert(entry.path());
        }
    }
    let mut fingerprint = Vec::new();
    for path in paths {
        let key = path.to_string_lossy().to_string();
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(error(e)),
        };
        let stamp = format!(
            "{}:{:?}",
            metadata.len(),
            metadata.modified().map_err(error)?
        );
        let cached: Option<String> = c
            .query_row(
                "SELECT hash FROM paper_journal_notes WHERE path=?1 AND stamp=?2",
                params![key, stamp],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?;
        let value = match cached {
            Some(value) => value,
            None => {
                let value = hash(&read_note(&path)?);
                c.execute("INSERT INTO paper_journal_notes(path,stamp,hash) VALUES(?1,?2,?3) ON CONFLICT(path) DO UPDATE SET stamp=excluded.stamp,hash=excluded.hash", params![key,stamp,value]).map_err(error)?;
                value
            }
        };
        fingerprint.push((key, value));
    }
    Ok(hash(&json!(fingerprint).to_string()))
}

fn save_projection(c: &Connection, path: &Path, content: &str) -> Result<Option<String>, String> {
    let key = path.to_string_lossy().to_string();
    let old_hash: Option<String> = c
        .query_row(
            "SELECT hash FROM paper_journal_files WHERE path=?1",
            [&key],
            |r| r.get(0),
        )
        .optional()
        .map_err(error)?;
    let existing = match fs::read_to_string(path) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(error(e)),
    };
    if existing.as_deref() == Some(content) {
        c.execute("INSERT INTO paper_journal_files(path,hash) VALUES(?1,?2) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash", params![key,hash(content)]).map_err(error)?;
        return Ok(None);
    }
    let mut preserved = None;
    if let Some(old) = &existing {
        if old_hash.as_ref().is_none_or(|h| h != &hash(old)) {
            let backup = path.with_extension(format!("手改备份-{}.md", uuid::Uuid::new_v4()));
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&backup)
                .map_err(error)?;
            file.write_all(old.as_bytes()).map_err(error)?;
            file.sync_all().map_err(error)?;
            preserved = Some(backup.to_string_lossy().to_string());
        }
    }
    atomic_write(path, content)?;
    c.execute("INSERT INTO paper_journal_files(path,hash) VALUES(?1,?2) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash", params![key,hash(content)]).map_err(error)?;
    Ok(preserved)
}

fn render_tasks(s: &PaperState) -> String {
    let mut out = "# 全部任务\n\n由 Inky Paper 自动同步。任务通过 Paper 或 Coach 调整；个人文字请写在[个人笔记](个人笔记.md)。\n\n".to_string();
    for t in &s.tasks {
        out.push_str(&format!(
            "## {}{}\n\n<!-- task:{} -->\n",
            if t.completed { "已完成 · " } else { "" },
            cell(&t.title),
            t.id
        ));
        if let Some(due) = &t.due {
            out.push_str(&format!("期限：{}\n\n", cell(due)));
        }
        {
            for step in s.planning.steps.iter().filter(|step| step.task_id == t.id) {
                out.push_str(&format!(
                    "- [{}] {}{} <!-- step:{} -->\n",
                    if step.completed { "x" } else { " " },
                    cell(&step.text),
                    if t.next_action.as_ref().is_some_and(|a| a.id == step.id) {
                        "（当前步骤）"
                    } else {
                        ""
                    },
                    step.id
                ));
                if let Some(result) = &step.expected_result {
                    out.push_str(&format!("  - 预期结果：{}\n", cell(result)));
                }
            }
        }
        out.push('\n');
    }
    if s.tasks.is_empty() {
        out.push_str("还没有任务。在 Paper 添加，或询问 Coach 帮你拆分。\n");
    }
    out
}

fn render_day(day: &Value) -> String {
    let date = text(day, "date");
    let mut out = format!("# {date}\n\n自动同步的计划与工作记录。计时不代表有效专注；未填写的反馈保持未知。\n\n[个人复盘]({date}.个人笔记.md) · [全部任务](../任务.md)\n\n## 今日计划\n\n");
    let empty = vec![];
    let plans = day["planItems"].as_array().unwrap_or(&empty);
    for item in plans {
        let step = &item["step"];
        out.push_str(&format!(
            "- [{}] {} · {} <!-- step:{}; plan:{} -->\n",
            if step["completed"] == true { "x" } else { " " },
            cell(&text(&item["task"], "title")),
            cell(&text(step, "text")),
            text(step, "id"),
            text(item, "id")
        ));
        let result = text(step, "expectedResult");
        if !result.is_empty() {
            out.push_str(&format!("  - 预期结果：{}\n", cell(&result)));
        }
    }
    if plans.is_empty() {
        out.push_str("今天尚未安排卡片，临时工作也会记在下方。\n");
    }
    out.push_str("\n## 实际记录\n\n| 起止时间 | 任务与动作 | 本日计时 | 结果与反馈 |\n| --- | --- | --- | --- |\n");
    let sessions = day["sessions"].as_array().unwrap_or(&empty);
    for session in sessions {
        let seconds = session["dailySeconds"].as_u64().unwrap_or(0);
        let feedback = &session["feedback"];
        let outcome = match feedback["outcome"].as_str() {
            Some("step_completed") => "这一步完成",
            Some("rest_ended") => "休息结束",
            _ if session["status"] == "finished" => "本轮结束，步骤未确认完成",
            _ => "本轮未结束",
        };
        let mut notes = format!(
            "{}；{}",
            if session["kind"] == "rest" {
                "休息"
            } else {
                "工作"
            },
            outcome
        );
        for (key, label) in [
            ("output", "产出"),
            ("blocker", "卡点"),
            ("nextCue", "下次起点"),
        ] {
            let v = text(feedback, key);
            if !v.is_empty() {
                notes.push_str(&format!("；{label}：{}", cell(&v)));
            }
        }
        let action = text(&session["action"], "text");
        out.push_str(&format!(
            "| {}—{} | {} · {} | {} 分 {} 秒 | {} |\n",
            time_at(&session["startedAt"]),
            time_at(&session["endedAt"]),
            cell(&text(session, "taskTitle")),
            cell(&action),
            seconds / 60,
            seconds % 60,
            notes
        ));
    }
    if sessions.is_empty() {
        out.push_str("\n尚无番茄钟记录。\n");
    }
    let manual_changes = day["manualStepChanges"].as_array().unwrap_or(&empty);
    if !manual_changes.is_empty() {
        out.push_str("\n### 手动步骤记录\n\n");
        for change in manual_changes {
            out.push_str(&format!(
                "- {} · {}：{} · {}（未计时）\n",
                time_at(&change["recordedAt"]),
                cell(&text(change, "taskTitle")),
                cell(&text(change, "stepText")),
                if change["completed"] == true {
                    "手动完成"
                } else {
                    "撤销完成"
                },
            ));
        }
    }
    let work_blocks = day["workBlocks"].as_array().unwrap_or(&empty);
    if !work_blocks.is_empty() {
        out.push_str("\n### 工作时段与进展\n\n");
        for block in work_blocks {
            let progress = match block["progress"].as_str() {
                Some("achieved") => "完成本段预期",
                Some("advanced") => "推进了一些",
                Some("blocked") => "卡住了",
                _ => "进展未填写",
            };
            out.push_str(&format!(
                "- {}—{} · {}：{}\n",
                time_at(&block["startedAt"]),
                time_at(&block["endedAt"]),
                cell(&text(block, "goal")),
                progress
            ));
            for (field, label) in [
                ("output", "产出"),
                ("blocker", "卡点"),
                ("resumeCue", "下次起点"),
            ] {
                let value = text(block, field);
                if !value.is_empty() {
                    out.push_str(&format!("  - {label}：{}\n", cell(&value)));
                }
            }
        }
    }
    out.push_str(
        "\n计时取最近保存的执行状态；跨天旧记录的精度以应用中的记录说明为准。\n\n## 随手记\n\n",
    );
    for note in day["notes"].as_array().unwrap_or(&empty) {
        out.push_str(&format!("- {}\n", cell(&text(note, "text"))));
    }
    out.push_str("\n## 每日工作总结\n\n");
    let summaries = day["summaries"].as_array().unwrap_or(&empty);
    if summaries.is_empty() {
        out.push_str("尚未请求 Coach 总结。需要时，在 Hermes 中说“总结这一天的工作”。\n");
    }
    for summary in summaries.iter().rev() {
        out.push_str(&format!(
            "### 用户请求生成的总结 · {}\n\n记录截至：{}{}\n\n{}\n\n",
            time_at(&summary["createdAt"]),
            time_at(&summary["sourceAsOf"]),
            if summary["hasNewRecords"] == true {
                "；此后有新记录，可询问 Coach 更新。"
            } else {
                ""
            },
            text(summary, "body")
        ));
    }
    out
}

pub fn personal_context(c: &Connection, date: &str) -> Result<(String, String), String> {
    valid_date(date)?;
    let Some(dir) = root(c) else {
        return Ok((String::new(), hash("")));
    };
    let mut content = String::new();
    for path in [
        dir.join("个人笔记.md"),
        dir.join("每日").join(format!("{date}.个人笔记.md")),
    ] {
        let mut note = read_note(&path)?;
        // Creating an untouched personal-note template adds no new user evidence.
        if note == personal_template("个人笔记")
            || note == personal_template(&format!("{date} · 个人复盘"))
        {
            note.clear();
        }
        content.push_str(&format!(
            "\n## {}\n{}\n",
            path.file_name().unwrap_or_default().to_string_lossy(),
            note
        ));
    }
    Ok((content.clone(), hash(&content)))
}

/// Use the same note version for application/Agent reads and the Markdown summary.
pub fn enrich_day(c: &Connection, day: &mut Value) -> Result<(), String> {
    let (notes, notes_version) = personal_context(c, &text(day, "date"))?;
    day["personalNotes"] = json!(notes);
    day["notesVersion"] = json!(notes_version);
    if let Some(summaries) = day["summaries"].as_array_mut() {
        for summary in summaries {
            let changed = summary["sourceNotesVersion"]
                .as_str()
                .is_none_or(|old| old != notes_version);
            summary["hasNewRecords"] = json!(summary["hasNewRecords"] == true || changed);
        }
    }
    Ok(())
}

pub fn sync(c: &Connection, force: bool) -> Value {
    let Some(dir) = root(c) else {
        return json!({"available":false,"synced":true});
    };
    let mut backups = vec![];
    let result = (|| -> Result<Value, String> {
        fs::create_dir_all(dir.join("每日")).map_err(error)?;
        c.execute_batch("CREATE TABLE IF NOT EXISTS paper_journal_files(path TEXT PRIMARY KEY,hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS paper_journal_status(id INTEGER PRIMARY KEY CHECK(id=1),seq INTEGER NOT NULL,day TEXT NOT NULL,data TEXT NOT NULL);").map_err(error)?;
        let seq: i64 = c
            .query_row("SELECT COALESCE(MAX(seq),0) FROM paper_events", [], |r| {
                r.get(0)
            })
            .map_err(error)?;
        let today = Local::now().format("%Y-%m-%d").to_string();
        ensure_personal(&dir.join("个人笔记.md"), "个人笔记")?;
        ensure_personal(
            &dir.join("每日").join(format!("{today}.个人笔记.md")),
            &format!("{today} · 个人复盘"),
        )?;
        let current_notes_hash = notes_hash(c, &dir)?;
        if !force {
            let cached: Option<String> = c
                .query_row(
                    "SELECT data FROM paper_journal_status WHERE id=1 AND seq=?1 AND day=?2",
                    params![seq, today],
                    |r| r.get(0),
                )
                .optional()
                .map_err(error)?;
            if let Some(data) = cached {
                if dir.join("任务.md").is_file()
                    && dir.join("每日").join(format!("{today}.md")).is_file()
                {
                    let status: Value = serde_json::from_str(&data).map_err(error)?;
                    if status["notesHash"].as_str() == Some(&current_notes_hash) {
                        return Ok(status);
                    }
                }
            }
        }
        let s = paper::load(c)?;
        if let Some(path) = save_projection(c, &dir.join("任务.md"), &render_tasks(&s))? {
            backups.push(path);
        }
        let mut days = BTreeSet::from([today.clone()]);
        for session in &s.sessions {
            days.insert(date_at(session.started_at));
            if let Some(end) = session.ended_at {
                days.insert(date_at(end));
            }
        }
        for block in &s.coach.blocks {
            days.insert(date_at(block.started_at));
            if let Some(end) = block.ended_at {
                days.insert(date_at(end));
            }
        }
        for note in &s.notes {
            if let Some(at) = note["createdAt"].as_i64() {
                days.insert(date_at(at));
            }
        }
        for item in &s.planning.day_items {
            days.insert(item.date.clone());
        }
        for change in &s.planning.manual_step_changes {
            days.insert(date_at(change.recorded_at));
        }
        for summary in &s.planning.summaries {
            days.insert(summary.date.clone());
        }
        let now = Local::now().timestamp_millis();
        let sessions: BTreeMap<_, _> = s
            .sessions
            .iter()
            .map(|session| (session.id.as_str(), session))
            .collect();
        // Only recorded running intervals span days. A multi-day pause must not
        // generate an empty journal for every intervening day of the user's history.
        for interval in &s.planning.intervals {
            let Some(session) = sessions.get(interval.session_id.as_str()) else {
                continue;
            };
            let stop = interval.ended_at.unwrap_or_else(|| {
                interval.started_at
                    + paper::elapsed(session, now).saturating_sub(session.elapsed_seconds) as i64
                        * 1000
            });
            let first = date_at(interval.started_at);
            let last = date_at(stop.min(now));
            if let (Ok(mut day), Ok(end)) = (
                chrono::NaiveDate::parse_from_str(&first, "%Y-%m-%d"),
                chrono::NaiveDate::parse_from_str(&last, "%Y-%m-%d"),
            ) {
                while day <= end {
                    days.insert(day.to_string());
                    let Some(next) = day.succ_opt() else { break };
                    day = next;
                }
            }
        }
        let offset = Local::now().offset().local_minus_utc() / 60;
        for day in days.iter().filter(|d| !d.is_empty()) {
            valid_date(day)?;
            let mut record = crate::paper_planning::daily_record(
                &s,
                day,
                offset,
                Local::now().timestamp_millis(),
            )?;
            ensure_personal(
                &dir.join("每日").join(format!("{day}.个人笔记.md")),
                &format!("{day} · 个人复盘"),
            )?;
            enrich_day(c, &mut record)?;
            if let Some(path) = save_projection(
                c,
                &dir.join("每日").join(format!("{day}.md")),
                &render_day(&record),
            )? {
                backups.push(path);
            }
        }
        let status = json!({"available":true,"synced":true,"directory":dir,"preservedEdits":backups,"notesHash":notes_hash(c,&dir)?,"syncedAt":Local::now().timestamp_millis()});
        c.execute("INSERT INTO paper_journal_status VALUES(1,?1,?2,?3) ON CONFLICT(id) DO UPDATE SET seq=excluded.seq,day=excluded.day,data=excluded.data",params![seq,today,status.to_string()]).map_err(error)?;
        Ok(status)
    })();
    result.unwrap_or_else(|e| json!({"available":true,"synced":false,"directory":dir,"error":format!("记录已保存在应用，Markdown 待同步：{e}"),"preservedEdits":backups}))
}

#[tauri::command]
pub fn open_work_journal(
    db: tauri::State<PaperDb>,
    date: Option<String>,
    personal: Option<bool>,
) -> Result<(), String> {
    let c = db.0.lock().map_err(error)?;
    let status = sync(&c, true);
    if status["synced"] != true {
        return Err(text(&status, "error"));
    }
    let dir = root(&c).ok_or("记录目录不可用")?;
    let path = if let Some(date) = date {
        valid_date(&date)?;
        let path = dir.join("每日").join(format!(
            "{date}{}.md",
            if personal.unwrap_or(false) {
                ".个人笔记"
            } else {
                ""
            }
        ));
        if !path.is_file() {
            return Err("这一天还没有记录".into());
        }
        path
    } else {
        dir
    };
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(path)
            .spawn()
            .map_err(error)?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_step_changes_export_without_a_plan_or_clock_after_each_commit() {
        let temp = tempfile::tempdir().unwrap();
        let mut c = paper::open(&temp.path().join("paper.sqlite3")).unwrap();
        let saved = paper::execute(
            &mut c,
            "create_task",
            json!({
                "requestId":uuid::Uuid::new_v4().to_string(),
                "taskId":uuid::Uuid::new_v4().to_string(),
                "title":"未安排番茄钟的任务","nextAction":"手工核对材料"
            }),
            "user",
        )
        .unwrap()
        .0;
        let task = &saved["task"];
        let date = Local::now().format("%Y-%m-%d").to_string();
        let day_path = root(&c).unwrap().join("每日").join(format!("{date}.md"));
        let completed = paper::execute(
            &mut c,
            "set_step_completed",
            json!({
                "requestId":uuid::Uuid::new_v4().to_string(),"taskId":task["id"],
                "stepId":task["nextAction"]["id"],"expectedTaskRevision":task["revision"],
                "expectedStepRevision":1,"completed":true
            }),
            "user",
        )
        .unwrap()
        .0;
        assert_eq!(completed["journal"]["synced"], true);
        let markdown = fs::read_to_string(&day_path).unwrap();
        assert!(markdown.contains("手动步骤记录"));
        assert!(markdown.contains("未安排番茄钟的任务：手工核对材料 · 手动完成（未计时）"));
        assert!(markdown.contains("尚无番茄钟记录"));
        assert!(fs::read_to_string(root(&c).unwrap().join("任务.md"))
            .unwrap()
            .contains("- [x] 手工核对材料"));
        paper::execute(&mut c, "set_step_completed", json!({
            "requestId":uuid::Uuid::new_v4().to_string(),"taskId":task["id"],
            "stepId":task["nextAction"]["id"],"expectedTaskRevision":completed["task"]["revision"],
            "expectedStepRevision":completed["step"]["revision"],"completed":false
        }), "user").unwrap();
        let markdown = fs::read_to_string(day_path).unwrap();
        assert!(markdown.contains("手动完成（未计时）"));
        assert!(markdown.contains("撤销完成（未计时）"));
        assert!(fs::read_to_string(root(&c).unwrap().join("任务.md"))
            .unwrap()
            .contains("- [ ] 手工核对材料"));
        assert!(paper::load(&c).unwrap().sessions.is_empty());
    }

    #[test]
    fn historical_manual_step_facts_export_their_day_without_other_records() {
        let temp = tempfile::tempdir().unwrap();
        let c = paper::open(&temp.path().join("paper.sqlite3")).unwrap();
        let mut state = paper::load(&c).unwrap();
        let at = Local
            .with_ymd_and_hms(2025, 1, 2, 9, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        state
            .planning
            .manual_step_changes
            .push(crate::paper_planning::ManualStepChange {
                id: uuid::Uuid::new_v4().to_string(),
                task_id: "old-task".into(),
                task_title: "原任务标题".into(),
                step_id: "old-step".into(),
                step_text: "原步骤文字".into(),
                completed: true,
                recorded_at: at,
            });
        c.execute(
            "UPDATE paper_state SET data=?1",
            [serde_json::to_string(&state).unwrap()],
        )
        .unwrap();
        assert_eq!(sync(&c, true)["synced"], true);
        let markdown = fs::read_to_string(root(&c).unwrap().join("每日/2025-01-02.md")).unwrap();
        assert!(markdown.contains("原任务标题：原步骤文字 · 手动完成（未计时）"));
        assert!(markdown.contains("尚无番茄钟记录"));
    }

    #[test]
    fn generated_files_preserve_manual_edits_and_do_not_touch_notes() {
        let temp = tempfile::tempdir().unwrap();
        let c = paper::open(&temp.path().join("paper.sqlite3")).unwrap();
        assert_eq!(sync(&c, true)["synced"], true);
        let dir = root(&c).unwrap();
        fs::write(dir.join("个人笔记.md"), "我自己写的内容").unwrap();
        fs::write(dir.join("任务.md"), "手动更改自动区").unwrap();
        let status = sync(&c, true);
        assert_eq!(status["synced"], true);
        assert_eq!(status["preservedEdits"].as_array().unwrap().len(), 1);
        assert_eq!(
            fs::read_to_string(status["preservedEdits"][0].as_str().unwrap()).unwrap(),
            "手动更改自动区"
        );
        assert_eq!(
            fs::read_to_string(dir.join("个人笔记.md")).unwrap(),
            "我自己写的内容"
        );
        let date = Local::now().format("%Y-%m-%d").to_string();
        let (body, version) = personal_context(&c, &date).unwrap();
        assert!(body.contains("我自己写的内容"));
        fs::write(dir.join("个人笔记.md"), "又写了一句").unwrap();
        assert_ne!(personal_context(&c, &date).unwrap().1, version);
    }
    #[test]
    fn export_error_reports_pending_without_erasing_database() {
        let temp = tempfile::tempdir().unwrap();
        let mut c = paper::open(&temp.path().join("paper.sqlite3")).unwrap();
        fs::write(root(&c).unwrap(), "block directory").unwrap();
        let input = json!({"requestId":uuid::Uuid::new_v4().to_string(),"taskId":uuid::Uuid::new_v4().to_string(),"title":"保存成功的任务"});
        let (saved, changed) =
            paper::execute(&mut c, "create_task", input.clone(), "user").unwrap();
        assert!(changed);
        assert_eq!(saved["journal"]["synced"], false);
        assert_eq!(paper::load(&c).unwrap().tasks[0].title, "保存成功的任务");
        // A retry returns the same committed write even while export is unavailable.
        let (_, changed) = paper::execute(&mut c, "create_task", input, "user").unwrap();
        assert!(!changed);
        assert_eq!(paper::load(&c).unwrap().tasks.len(), 1);
        fs::remove_file(root(&c).unwrap()).unwrap();
        assert_eq!(sync(&c, false)["synced"], true);
        assert!(fs::read_to_string(root(&c).unwrap().join("任务.md"))
            .unwrap()
            .contains("保存成功的任务"));
    }

    #[test]
    fn handwritten_notes_invalidate_summary_export_without_a_database_event() {
        let temp = tempfile::tempdir().unwrap();
        let mut c = paper::open(&temp.path().join("paper.sqlite3")).unwrap();
        let date = Local::now().format("%Y-%m-%d").to_string();
        let record = paper::execute(&mut c, "get_daily_record", json!({"date":date}), "hermes")
            .unwrap()
            .0;
        paper::execute(&mut c,"save_daily_summary",json!({"requestId":uuid::Uuid::new_v4().to_string(),"date":date,"expectedDataVersion":record["dataVersion"],"expectedNotesVersion":record["notesVersion"],"sourceAsOf":record["sampledAt"],"body":"原总结保留"}),"hermes").unwrap();
        let day_path = root(&c).unwrap().join("每日").join(format!("{date}.md"));
        let before = fs::read_to_string(&day_path).unwrap();
        assert!(before.contains("原总结保留"));
        assert!(!before.contains("此后有新记录"));
        let old_seq: i64 = c
            .query_row("SELECT MAX(seq) FROM paper_events", [], |r| r.get(0))
            .unwrap();
        let note_path = root(&c)
            .unwrap()
            .join("每日")
            .join(format!("{date}.个人笔记.md"));
        fs::write(&note_path, "我补充了重要的完成情况").unwrap();
        assert_eq!(sync(&c, false)["synced"], true);
        let after = fs::read_to_string(day_path).unwrap();
        assert!(after.contains("原总结保留"));
        assert!(after.contains("此后有新记录"));
        assert_eq!(
            fs::read_to_string(note_path).unwrap(),
            "我补充了重要的完成情况"
        );
        let new_seq: i64 = c
            .query_row("SELECT MAX(seq) FROM paper_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(old_seq, new_seq);
        let latest = paper::execute(&mut c, "get_daily_record", json!({"date":date}), "hermes")
            .unwrap()
            .0;
        assert_eq!(latest["summaries"][0]["hasNewRecords"], true);
        assert!(latest["personalNotes"]
            .as_str()
            .unwrap()
            .contains("我补充了重要的完成情况"));
    }

    #[test]
    fn creating_a_historical_note_template_does_not_invalidate_a_new_summary() {
        let temp = tempfile::tempdir().unwrap();
        let mut c = paper::open(&temp.path().join("paper.sqlite3")).unwrap();
        let date = "2024-03-02";
        let record = paper::execute(&mut c, "get_daily_record", json!({"date":date}), "hermes")
            .unwrap()
            .0;
        paper::execute(&mut c,"save_daily_summary",json!({"requestId":uuid::Uuid::new_v4().to_string(),"date":date,"expectedDataVersion":record["dataVersion"],"expectedNotesVersion":record["notesVersion"],"sourceAsOf":record["sampledAt"],"body":"空白保持未知"}),"hermes").unwrap();
        let markdown =
            fs::read_to_string(root(&c).unwrap().join("每日").join(format!("{date}.md"))).unwrap();
        assert!(markdown.contains("空白保持未知"));
        assert!(!markdown.contains("此后有新记录"));
    }

    #[test]
    fn work_without_a_pomodoro_exports_its_day_and_feedback() {
        let temp = tempfile::tempdir().unwrap();
        let c = paper::open(&temp.path().join("paper.sqlite3")).unwrap();
        let mut state = paper::load(&c).unwrap();
        let at = Local
            .with_ymd_and_hms(2025, 1, 2, 9, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let task: paper::Task=serde_json::from_value(json!({"id":"task","title":"历史工作","due":null,"category":"work","priority":"medium","completed":false,"nextAction":null,"revision":1,"source":"user","createdAt":at,"updatedAt":at,"completedAt":null})).unwrap();
        state.tasks.push(task);
        crate::coach::execute(&mut state,&c,"start_work",&json!({"taskId":"task","expectedRevision":1,"plannedEndAt":at+3600000,"plannedSeconds":0}),"user",at).unwrap();
        let work = state.coach.blocks[0].clone();
        crate::coach::execute(&mut state,&c,"end_work",&json!({"blockId":work.id,"expectedRevision":work.revision,"progress":"advanced","output":"整理出三个问题","blocker":"等待材料"}),"user",at+1800000).unwrap();
        c.execute(
            "UPDATE paper_state SET data=?1",
            [serde_json::to_string(&state).unwrap()],
        )
        .unwrap();
        assert_eq!(sync(&c, true)["synced"], true);
        let markdown = fs::read_to_string(root(&c).unwrap().join("每日/2025-01-02.md")).unwrap();
        assert!(markdown.contains("推进了一些"));
        assert!(markdown.contains("整理出三个问题"));
        assert!(markdown.contains("等待材料"));
        assert!(markdown.contains("尚无番茄钟记录"));
    }

    #[test]
    fn oversized_personal_note_is_bounded_and_never_overwritten() {
        let temp = tempfile::tempdir().unwrap();
        let c = paper::open(&temp.path().join("paper.sqlite3")).unwrap();
        assert_eq!(sync(&c, true)["synced"], true);
        let path = root(&c).unwrap().join("个人笔记.md");
        let content = "a".repeat(NOTES_LIMIT as usize + 1);
        fs::write(&path, &content).unwrap();
        assert!(personal_context(&c, "2026-09-13")
            .unwrap_err()
            .starts_with("NOTES_TOO_LARGE"));
        assert_eq!(fs::read_to_string(path).unwrap(), content);
        assert!(personal_context(&c, "../2026-09-13").is_err());
    }

    #[test]
    fn midnight_intervals_split_daily_time_without_expanding_years_of_paused_history() {
        let temp = tempfile::tempdir().unwrap();
        let c = paper::open(&temp.path().join("paper.sqlite3")).unwrap();
        let mut state = paper::load(&c).unwrap();
        let started = Local
            .with_ymd_and_hms(2025, 1, 2, 23, 50, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let ended = started + 25 * 60000;
        let session: paper::Session=serde_json::from_value(json!({"id":"midnight","taskId":null,"taskTitle":"跨午夜的工作","action":null,"taskRevision":null,"kind":"focus","status":"finished","revision":2,"plannedSeconds":1500,"elapsedSeconds":1500,"startedAt":started,"lastResumedAt":null,"endedAt":ended,"pauseCount":0,"resumeCue":null,"feedback":null})).unwrap();
        state.sessions.push(session.clone());
        state
            .planning
            .intervals
            .push(crate::paper_planning::Interval {
                session_id: session.id,
                started_at: started,
                ended_at: Some(ended),
            });
        let mut paused = state.sessions[0].clone();
        paused.id = "old-paused".into();
        paused.status = "paused".into();
        paused.elapsed_seconds = 60;
        paused.ended_at = None;
        paused.started_at = Local
            .with_ymd_and_hms(2020, 1, 1, 9, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        state
            .planning
            .intervals
            .push(crate::paper_planning::Interval {
                session_id: paused.id.clone(),
                started_at: paused.started_at,
                ended_at: Some(paused.started_at + 60000),
            });
        state.sessions.push(paused);
        c.execute(
            "UPDATE paper_state SET data=?1",
            [serde_json::to_string(&state).unwrap()],
        )
        .unwrap();
        assert_eq!(sync(&c, true)["synced"], true);
        let dir = root(&c).unwrap().join("每日");
        assert!(fs::read_to_string(dir.join("2025-01-02.md"))
            .unwrap()
            .contains("10 分 0 秒"));
        assert!(fs::read_to_string(dir.join("2025-01-03.md"))
            .unwrap()
            .contains("15 分 0 秒"));
        assert!(!dir.join("2020-01-02.md").exists());
        assert!(!dir.join("2024-12-31.md").exists());
        let generated_count = fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| !entry.file_name().to_string_lossy().contains("个人笔记"))
            .count();
        assert_eq!(generated_count, 4); // Start day, two interval days, and today.
    }
}
