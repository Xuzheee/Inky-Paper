//! User-owned completion acknowledgements and note organization.
//! The public Paper transaction supplies request-id caching and persists the result.
use crate::paper::{Action, PaperState, Task};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[cfg(test)]
#[path = "paper_followup_tests.rs"]
mod tests;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompletionAcknowledgement {
    pub task_id: String,
    pub completion_key: String,
    pub acknowledged_at: i64,
}

fn keys(v: &Value, allowed: &[&str]) -> Result<(), String> {
    for key in v
        .as_object()
        .ok_or("INVALID_INPUT: object required")?
        .keys()
    {
        if key != "requestId" && !allowed.contains(&key.as_str()) {
            return Err(format!("INVALID_INPUT: unknown field {key}"));
        }
    }
    Ok(())
}

fn text(v: &Value, key: &str, max: usize) -> Result<String, String> {
    let value = v[key]
        .as_str()
        .ok_or(format!("INVALID_INPUT: {key}"))?
        .trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(format!("INVALID_INPUT: {key}"));
    }
    Ok(value.into())
}

fn revision(actual: u64, expected: Option<u64>, label: &str) -> Result<(), String> {
    if expected != Some(actual) {
        return Err(format!("CONFLICT: {label}已有更新，请核对后重试。"));
    }
    Ok(())
}

pub(crate) fn note_revision(note: &Value) -> Result<u64, String> {
    match note.get("revision") {
        None => Ok(1),
        Some(value) => value
            .as_u64()
            .filter(|r| *r > 0)
            .ok_or("INVALID_STATE: note revision".into()),
    }
}

/// Keep the legacy create_task(originNoteId) path consistent with organize_note.
/// Existing conversions cannot be redirected to another task.
pub(crate) fn mark_note_converted(note: &mut Value, task_id: &str, t: i64) -> Result<(), String> {
    let current = note_revision(note)?;
    if let Some(previous) = note["convertedTaskId"].as_str() {
        if previous != task_id {
            return Err("CONFLICT: 这条笔记已经转换为另一项任务。".into());
        }
        if note["organization"].as_str() == Some("converted") {
            return Ok(());
        }
    }
    let next = current
        .checked_add(1)
        .ok_or("INVALID_STATE: note revision overflow")?;
    let object = note.as_object_mut().ok_or("INVALID_STATE: note")?;
    object.insert("convertedTaskId".into(), json!(task_id));
    object.insert("organization".into(), json!("converted"));
    object.insert("linkedTaskId".into(), Value::Null);
    object.insert("revision".into(), json!(next));
    object.insert("organizedAt".into(), json!(t));
    Ok(())
}

/// Keys track completion facts, not task/step title revisions.
/// This shape must stay identical to shared/planning.ts taskCompletionPrompt.
pub(crate) fn completion_key(s: &PaperState, task_id: &str) -> String {
    let mut steps: Vec<_> = s
        .planning
        .steps
        .iter()
        .filter(|step| step.task_id == task_id)
        .collect();
    steps.sort_by(|a, b| a.id.cmp(&b.id));
    let facts: Vec<_> = steps
        .iter()
        .map(|step| {
            let mut manual: Vec<_> = s
                .planning
                .manual_step_changes
                .iter()
                .filter(|change| change.task_id == task_id && change.step_id == step.id)
                .map(|change| change.id.as_str())
                .collect();
            manual.sort_unstable();
            let mut sessions: Vec<_> = s
                .sessions
                .iter()
                .filter(|session| {
                    session.task_id.as_deref() == Some(task_id)
                        && session.action.as_ref().map(|a| a.id.as_str()) == Some(step.id.as_str())
                        && session.kind == "focus"
                        && session.status == "finished"
                        && session
                            .feedback
                            .as_ref()
                            .and_then(|f| f["outcome"].as_str())
                            == Some("step_completed")
                })
                .map(|session| session.id.as_str())
                .collect();
            sessions.sort_unstable();
            json!([step.id, manual, sessions])
        })
        .collect();
    json!([task_id, facts]).to_string()
}

fn acknowledge(s: &mut PaperState, v: &Value, t: i64) -> Result<Value, String> {
    keys(v, &["taskId", "expectedTaskRevision", "steps"])?;
    let task_id = text(v, "taskId", 100)?;
    let task = s
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .ok_or("NOT_FOUND: task")?;
    revision(task.revision, v["expectedTaskRevision"].as_u64(), "任务")?;
    if task.completed {
        return Err("TASK_COMPLETED: 整个任务已经完成。".into());
    }
    if s.sessions.iter().any(|session| {
        session.task_id.as_deref() == Some(&task_id) && crate::paper::active(session)
    }) {
        return Err("ACTIVE_SESSION: 请先保存并结束当前一轮。".into());
    }
    let expected = v["steps"].as_array().ok_or("INVALID_INPUT: steps")?;
    let mut roster = BTreeMap::new();
    for item in expected {
        keys(item, &["id", "revision"])?;
        let id = text(item, "id", 100)?;
        let rev = item["revision"]
            .as_u64()
            .ok_or("INVALID_INPUT: step revision")?;
        if roster.insert(id, rev).is_some() {
            return Err("INVALID_INPUT: duplicate step id".into());
        }
    }
    let steps: Vec<_> = s
        .planning
        .steps
        .iter()
        .filter(|step| step.task_id == task_id)
        .collect();
    if steps.is_empty() || steps.len() != roster.len() {
        return Err("CONFLICT: 步骤集合已有更新，请核对整个任务。".into());
    }
    for step in steps {
        revision(step.revision, roster.get(&step.id).copied(), "步骤")?;
        if !step.completed {
            return Err("CONFLICT: 仍有未完成步骤，请核对整个任务。".into());
        }
    }
    let key = completion_key(s, &task_id);
    if let Some(ack) = s
        .planning
        .task_completion_acknowledgements
        .iter()
        .find(|ack| ack.task_id == task_id && ack.completion_key == key)
    {
        return Ok(json!({"acknowledgement":ack,"reused":true}));
    }
    let ack = TaskCompletionAcknowledgement {
        task_id,
        completion_key: key,
        acknowledged_at: t,
    };
    s.planning
        .task_completion_acknowledgements
        .retain(|old| old.task_id != ack.task_id);
    s.planning
        .task_completion_acknowledgements
        .push(ack.clone());
    Ok(json!({"acknowledgement":ack,"reused":false}))
}

fn organize(s: &mut PaperState, v: &Value, source: &str, t: i64) -> Result<Value, String> {
    keys(
        v,
        &[
            "noteId",
            "expectedRevision",
            "mode",
            "targetTaskId",
            "expectedTaskRevision",
            "title",
            "taskId",
            "nextAction",
        ],
    )?;
    let note_id = text(v, "noteId", 100)?;
    let index = s
        .notes
        .iter()
        .position(|note| note["id"].as_str() == Some(&note_id))
        .ok_or("NOT_FOUND: note")?;
    let current = note_revision(&s.notes[index])?;
    revision(current, v["expectedRevision"].as_u64(), "笔记")?;
    let mode = text(v, "mode", 20)?;
    if !matches!(mode.as_str(), "keep" | "link" | "convert") {
        return Err("INVALID_INPUT: mode".into());
    }
    if let Some(converted) = s.notes[index]["convertedTaskId"]
        .as_str()
        .map(str::to_owned)
    {
        if mode != "convert" {
            return Err("CONFLICT: 已转换的笔记保留原任务关系，不能重新关联。".into());
        }
        let task = s
            .tasks
            .iter()
            .find(|task| task.id == converted)
            .ok_or("CONFLICT: 原转换任务已不存在，请核对笔记来源。")?
            .clone();
        mark_note_converted(&mut s.notes[index], &task.id, t)?;
        return Ok(json!({"note":s.notes[index],"task":task,"reused":true}));
    }
    if mode == "convert" {
        let task_id = match crate::paper::optional(v, "taskId", 100)? {
            Some(id) => {
                uuid::Uuid::parse_str(&id).map_err(|_| "INVALID_INPUT: UUID taskId required")?;
                id
            }
            None => uuid::Uuid::new_v4().to_string(),
        };
        if s.tasks.iter().any(|task| task.id == task_id) {
            return Err("CONFLICT: taskId 已被其他任务使用，请核对转换对象。".into());
        }
        let title = match v.get("title") {
            None => {
                let original = s.notes[index]["text"]
                    .as_str()
                    .ok_or("INVALID_STATE: note text")?
                    .trim();
                if original.is_empty() {
                    return Err("INVALID_INPUT: title".into());
                }
                original.chars().take(300).collect()
            }
            Some(_) => text(v, "title", 300)?,
        };
        let next_action = crate::paper::optional(v, "nextAction", 300)?.map(|text| Action {
            id: uuid::Uuid::new_v4().to_string(),
            text,
            completed: false,
            source: source.into(),
        });
        let task = Task {
            id: task_id,
            title,
            due: None,
            due_date: None,
            category: "work".into(),
            priority: "medium".into(),
            completed: false,
            next_action,
            revision: 1,
            source: source.into(),
            created_at: t,
            updated_at: t,
            completed_at: None,
        };
        mark_note_converted(&mut s.notes[index], &task.id, t)?;
        s.tasks.insert(0, task.clone());
        return Ok(json!({"note":s.notes[index],"task":task,"reused":false}));
    }
    let target = if mode == "link" {
        let target_id = text(v, "targetTaskId", 100)?;
        let task = s
            .tasks
            .iter()
            .find(|task| task.id == target_id)
            .ok_or("NOT_FOUND: target task")?;
        revision(
            task.revision,
            v["expectedTaskRevision"].as_u64(),
            "目标任务",
        )?;
        Some(task.clone())
    } else {
        None
    };
    let organization = if mode == "keep" { "kept" } else { "linked" };
    let linked = target.as_ref().map(|task| task.id.as_str());
    if s.notes[index]["organization"].as_str() == Some(organization)
        && s.notes[index]["linkedTaskId"].as_str() == linked
    {
        return Ok(json!({"note":s.notes[index],"task":target,"reused":true}));
    }
    let next = current
        .checked_add(1)
        .ok_or("INVALID_STATE: note revision overflow")?;
    let note = s.notes[index]
        .as_object_mut()
        .ok_or("INVALID_STATE: note")?;
    note.insert("organization".into(), json!(organization));
    note.insert("linkedTaskId".into(), json!(linked));
    note.insert("revision".into(), json!(next));
    note.insert("organizedAt".into(), json!(t));
    Ok(json!({"note":s.notes[index],"task":target,"reused":false}))
}

pub fn execute(
    s: &mut PaperState,
    action: &str,
    v: &Value,
    source: &str,
    t: i64,
) -> Result<Value, String> {
    if source != "user" {
        return Err("FORBIDDEN: 只能由用户确认任务和整理笔记。".into());
    }
    let mut draft = s.clone();
    let out = match action {
        "acknowledge_task_completion" => acknowledge(&mut draft, v, t)?,
        "organize_note" => organize(&mut draft, v, source, t)?,
        _ => return Err("UNKNOWN_ACTION".into()),
    };
    *s = draft;
    Ok(out)
}
