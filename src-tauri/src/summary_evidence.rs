//! Date-scoped summary evidence and connection-local receipts for genuine reads.
use crate::paper::PaperState;
use crate::paper_markdown::PersonalEvidenceContext;
use crate::paper_planning::Summary;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[cfg(test)]
#[path = "summary_evidence_tests.rs"]
mod tests;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub kind: String,
    pub id: String,
    pub label: String,
    pub snapshot: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextStart {
    pub task_id: String,
    pub step_id: String,
    pub day_item_id: Option<String>,
    pub cue: Option<String>,
}

/// Created only after the public Paper boundary verifies notes and the read receipt.
pub(crate) struct PreparedInput {
    date: String,
    offset: i32,
    data_version: String,
    source_as_of: i64,
    notes: PersonalEvidenceContext,
    new_format: bool,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn keys(v: &Value, allowed: &[&str]) -> Result<(), String> {
    for key in v
        .as_object()
        .ok_or("INVALID_INPUT: object required")?
        .keys()
    {
        if !allowed.contains(&key.as_str()) {
            return Err(format!("INVALID_INPUT: unknown field {key}"));
        }
    }
    Ok(())
}
fn text(v: &Value, field: &str, max: usize) -> Result<String, String> {
    let value = v[field]
        .as_str()
        .ok_or(format!("INVALID_INPUT: {field}"))?
        .trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(format!("INVALID_INPUT: {field}"));
    }
    Ok(value.into())
}

fn receipt_table(c: &Connection) -> Result<(), String> {
    c.execute_batch("CREATE TEMP TABLE IF NOT EXISTS paper_summary_reads(id INTEGER PRIMARY KEY,date TEXT NOT NULL,utc_offset INTEGER NOT NULL,data_version TEXT NOT NULL,notes_version TEXT NOT NULL,sampled_at INTEGER NOT NULL,UNIQUE(date,utc_offset,data_version,notes_version,sampled_at));").map_err(err)
}

/// No domain event, revision or personal-note content is written by this bounded TEMP cache.
pub(crate) fn register_read(c: &Connection, day: &Value) -> Result<(), String> {
    receipt_table(c)?;
    let date = text(day, "date", 10)?;
    let offset = crate::paper_planning::offset(day)?;
    let data = text(day, "dataVersion", 100)?;
    let notes = text(day, "notesVersion", 100)?;
    let sampled_at = day["sampledAt"]
        .as_i64()
        .ok_or("INVALID_STATE: read sampledAt")?;
    c.execute("INSERT OR IGNORE INTO temp.paper_summary_reads(date,utc_offset,data_version,notes_version,sampled_at) VALUES(?1,?2,?3,?4,?5)",params![date,offset,data,notes,sampled_at]).map_err(err)?;
    c.execute("DELETE FROM temp.paper_summary_reads WHERE id IN (SELECT id FROM temp.paper_summary_reads ORDER BY id DESC LIMIT -1 OFFSET 4096)",[]).map_err(err)?;
    Ok(())
}

fn input_keys(v: &Value) -> Result<(), String> {
    keys(
        v,
        &[
            "requestId",
            "date",
            "utcOffsetMinutes",
            "expectedDataVersion",
            "expectedNotesVersion",
            "sourceAsOf",
            "body",
            "evidenceRefs",
            "nextStart",
        ],
    )
}

pub(crate) fn prepare(c: &Connection, v: &Value, source: &str) -> Result<PreparedInput, String> {
    input_keys(v)?;
    let date = text(v, "date", 10)?;
    let offset = crate::paper_planning::offset(v)?;
    let data_version = text(v, "expectedDataVersion", 100)?;
    let source_as_of = v["sourceAsOf"]
        .as_i64()
        .filter(|at| *at >= 0 && *at <= chrono::Utc::now().timestamp_millis())
        .ok_or("INVALID_INPUT: sourceAsOf must be the read's sampledAt")?;
    let new_format =
        v.get("evidenceRefs").is_some() || v.get("nextStart").is_some() || source != "user";
    if new_format && !v["evidenceRefs"].is_array() {
        return Err("INVALID_INPUT: evidenceRefs is required for a new summary".into());
    }
    let notes = crate::paper_markdown::personal_evidence_context(c, &date)?;
    let needs_notes = new_format
        || c.path()
            .is_some_and(|path| !path.is_empty() && path != ":memory:");
    if needs_notes && v["expectedNotesVersion"].as_str() != Some(&notes.version) {
        return Err("CONFLICT: 个人笔记已有更新或未读取，请重新读取当天记录再生成总结。".into());
    }
    if new_format {
        receipt_table(c)?;
        let read = c.query_row("SELECT 1 FROM temp.paper_summary_reads WHERE date=?1 AND utc_offset=?2 AND data_version=?3 AND notes_version=?4 AND sampled_at=?5",
            params![date,offset,data_version,notes.version,source_as_of], |_|Ok(())).optional().map_err(err)?;
        if read.is_none() {
            return Err("CONFLICT: 总结读取凭据已失效或未实际读取，请重新读取当天记录。".into());
        }
    }
    Ok(PreparedInput {
        date,
        offset,
        data_version,
        source_as_of,
        notes,
        new_format,
    })
}

impl PreparedInput {
    /// A second check just before committing catches edits made while the SQL transaction ran.
    pub(crate) fn recheck_notes(&self, c: &Connection) -> Result<(), String> {
        if crate::paper_markdown::personal_evidence_context(c, &self.date)?.version
            != self.notes.version
        {
            return Err("CONFLICT: 保存期间个人笔记已有更新，请重新读取当天记录。".into());
        }
        Ok(())
    }
}

fn array<'a>(record: &'a Value, key: &str) -> &'a [Value] {
    record[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn object_by_id(record: &Value, list: &str, id: &str) -> Result<Value, String> {
    array(record, list)
        .iter()
        .find(|item| item["id"].as_str() == Some(id))
        .cloned()
        .ok_or_else(|| format!("INVALID_INPUT: {list} reference is outside this day's record"))
}
fn short(value: &Value, field: &str) -> String {
    value[field]
        .as_str()
        .unwrap_or("")
        .chars()
        .take(160)
        .collect()
}

fn evidence(
    s: &PaperState,
    record: &Value,
    v: &Value,
    input: &PreparedInput,
) -> Result<Vec<Evidence>, String> {
    let refs = v["evidenceRefs"]
        .as_array()
        .ok_or("INVALID_INPUT: evidenceRefs")?;
    if refs.len() > 24 {
        return Err("INVALID_INPUT: at most 24 evidence references".into());
    }
    let mut used = BTreeSet::new();
    let mut out = Vec::new();
    for item in refs {
        keys(item, &["kind", "id", "quote"])?;
        let kind = text(item, "kind", 30)?;
        let id = text(item, "id", 100)?;
        let quote = match item.get("quote") {
            None => None,
            Some(value) => {
                let quote = value.as_str().ok_or("INVALID_INPUT: evidence quote")?;
                if quote.trim().is_empty() || quote.chars().count() > 2000 {
                    return Err("INVALID_INPUT: evidence quote must have 1–2000 characters".into());
                }
                Some(quote)
            }
        };
        let quote_key = if kind == "personalNote" {
            quote.unwrap_or("")
        } else {
            ""
        };
        if !used.insert((kind.clone(), id.clone(), quote_key.to_string())) {
            return Err("INVALID_INPUT: duplicate evidence reference".into());
        }
        let (label, snapshot) = match kind.as_str() {
            "session" => {
                let mut snapshot = object_by_id(record, "sessions", &id)?;
                if let Some(session) = s.sessions.iter().find(|session| session.id == id) {
                    snapshot["clockElapsedSeconds"] =
                        json!(crate::paper::elapsed(session, input.source_as_of));
                }
                let label = format!(
                    "执行：{} · {}",
                    short(&snapshot, "taskTitle"),
                    short(&snapshot["action"], "text")
                );
                (label, snapshot)
            }
            "step" => {
                let snapshot = array(record, "planItems")
                    .iter()
                    .map(|item| &item["step"])
                    .find(|step| step["id"].as_str() == Some(&id))
                    .cloned()
                    .ok_or("INVALID_INPUT: step reference is outside this day's planned steps")?;
                (
                    format!("当前计划步骤：{}", short(&snapshot, "text")),
                    snapshot,
                )
            }
            "manualChange" => {
                let snapshot = object_by_id(record, "manualStepChanges", &id)?;
                (
                    format!(
                        "{}：{}",
                        if snapshot["completed"] == true {
                            "手动完成"
                        } else {
                            "撤销完成"
                        },
                        short(&snapshot, "stepText")
                    ),
                    snapshot,
                )
            }
            "note" => {
                let snapshot = object_by_id(record, "notes", &id)?;
                (format!("随手记：{}", short(&snapshot, "text")), snapshot)
            }
            "planChange" => {
                let snapshot = object_by_id(record, "planChanges", &id)?;
                (
                    format!("安排变更：{}", short(&snapshot, "operation")),
                    snapshot,
                )
            }
            "personalNote" => {
                if id != input.date {
                    return Err("INVALID_INPUT: personal note must match the summary date".into());
                }
                let quote = quote.ok_or("INVALID_INPUT: personal note needs an exact quote")?;
                if !input.notes.bodies.iter().any(|body| body.contains(quote)) {
                    return Err(
                        "INVALID_INPUT: personal note quote is not in the original note body"
                            .into(),
                    );
                }
                (
                    format!("个人笔记：{}", input.date),
                    json!({"date":input.date,"quote":quote,"notesVersion":input.notes.version}),
                )
            }
            _ => return Err("INVALID_INPUT: unsupported evidence kind".into()),
        };
        out.push(Evidence {
            kind,
            id,
            label,
            snapshot,
        });
    }
    Ok(out)
}

fn next_start(s: &PaperState, record: &Value, v: &Value) -> Result<Option<NextStart>, String> {
    if v.get("nextStart").is_none() || v["nextStart"].is_null() {
        return Ok(None);
    }
    let next = &v["nextStart"];
    keys(next, &["taskId", "stepId", "dayItemId", "cue"])?;
    let task_id = text(next, "taskId", 100)?;
    let step_id = text(next, "stepId", 100)?;
    if !s.tasks.iter().any(|task| task.id == task_id)
        || !s
            .planning
            .steps
            .iter()
            .any(|step| step.id == step_id && step.task_id == task_id)
    {
        return Err("INVALID_INPUT: next start task and step do not match".into());
    }
    let plans: Vec<_> = array(record, "planItems")
        .iter()
        .filter(|item| item["taskId"] == task_id && item["stepId"] == step_id)
        .collect();
    let sessions: Vec<_> = array(record, "sessions")
        .iter()
        .filter(|session| session["taskId"] == task_id && session["action"]["id"] == step_id)
        .collect();
    let manual = array(record, "manualStepChanges")
        .iter()
        .any(|change| change["taskId"] == task_id && change["stepId"] == step_id);
    if plans.is_empty() && sessions.is_empty() && !manual {
        return Err("INVALID_INPUT: next start is outside this day's recorded steps".into());
    }
    let day_item_id = crate::paper::optional(next, "dayItemId", 100)?;
    if let Some(id) = &day_item_id {
        let scoped = plans.iter().any(|item| item["id"].as_str() == Some(id))
            || sessions
                .iter()
                .any(|session| session["dayItemId"].as_str() == Some(id));
        if !scoped
            || !s
                .planning
                .day_items
                .iter()
                .any(|item| item.id == *id && item.task_id == task_id && item.step_id == step_id)
        {
            return Err(
                "INVALID_INPUT: next start plan source does not match the recorded step".into(),
            );
        }
    }
    Ok(Some(NextStart {
        task_id,
        step_id,
        day_item_id,
        cue: crate::paper::optional(next, "cue", 500)?,
    }))
}

pub(crate) fn save(
    s: &mut PaperState,
    v: &Value,
    source: &str,
    t: i64,
    prepared: Option<&PreparedInput>,
) -> Result<Value, String> {
    input_keys(v)?;
    let date = text(v, "date", 10)?;
    let offset = crate::paper_planning::offset(v)?;
    let current = crate::paper_planning::daily_record(s, &date, offset, t)?;
    let expected = text(v, "expectedDataVersion", 100)?;
    if current["dataVersion"].as_str() != Some(&expected) {
        return Err("CONFLICT: 当天记录已有更新，请重新读取后生成总结。".into());
    }
    let source_as_of = v["sourceAsOf"]
        .as_i64()
        .filter(|at| *at >= 0 && *at <= t)
        .ok_or("INVALID_INPUT: sourceAsOf must be the read's sampledAt")?;
    let new_format =
        v.get("evidenceRefs").is_some() || v.get("nextStart").is_some() || source != "user";
    let (evidence, next_start) = if new_format {
        let input = prepared
            .filter(|input| {
                input.new_format
                    && input.date == date
                    && input.offset == offset
                    && input.data_version == expected
                    && input.source_as_of == source_as_of
            })
            .ok_or("CONFLICT: missing trusted summary read; read the day again")?;
        let read = crate::paper_planning::daily_record(s, &date, offset, source_as_of)?;
        (evidence(s, &read, v, input)?, next_start(s, &read, v)?)
    } else {
        (Vec::new(), None)
    };
    let summary = Summary {
        id: uuid::Uuid::new_v4().to_string(),
        date,
        body: text(v, "body", 16000)?,
        source_version: expected,
        source_as_of,
        created_at: t,
        source: source.into(),
        utc_offset_minutes: offset,
        source_notes_version: crate::paper::optional(v, "expectedNotesVersion", 100)?,
        evidence,
        next_start,
    };
    s.planning.summaries.push(summary.clone());
    Ok(json!({"summary":summary}))
}
