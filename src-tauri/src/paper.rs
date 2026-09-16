use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::Path, sync::Mutex};
use tauri::Emitter;
use uuid::Uuid;

pub struct PaperDb(pub Mutex<Connection>);
#[cfg(test)]
#[path = "p0p1_data_tests.rs"]
mod p0p1_data_tests;
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperState {
    pub tasks: Vec<Task>,
    pub sessions: Vec<Session>,
    pub notes: Vec<Value>,
    #[serde(default)]
    pub coach: crate::coach::CoachState,
    #[serde(default)]
    pub planning: crate::paper_planning::PlanningState,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub due: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default = "default_priority")]
    pub priority: String,
    pub completed: bool,
    pub next_action: Option<Action>,
    pub revision: u64,
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub id: String,
    pub text: String,
    pub completed: bool,
    pub source: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub task_id: Option<String>,
    pub task_title: String,
    pub action: Option<Action>,
    pub task_revision: Option<u64>,
    pub kind: String,
    pub status: String,
    pub revision: u64,
    pub planned_seconds: u64,
    pub elapsed_seconds: u64,
    pub started_at: i64,
    pub last_resumed_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub pause_count: u32,
    pub resume_cue: Option<String>,
    pub feedback: Option<Value>,
}
fn default_category() -> String {
    "work".into()
}
fn default_priority() -> String {
    "medium".into()
}
fn choice(v: &Value, key: &str, default: &str, allowed: &[&str]) -> Result<String, String> {
    let value = match v.get(key) {
        None => default,
        Some(value) => value.as_str().ok_or(format!("INVALID_INPUT: {key}"))?,
    };
    if !allowed.contains(&value) {
        return Err(format!("INVALID_INPUT: {key}"));
    }
    Ok(value.into())
}
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn text(v: &Value, k: &str, max: usize) -> Result<String, String> {
    let s = v[k].as_str().ok_or(format!("INVALID_INPUT: {k}"))?.trim();
    if s.is_empty() || s.chars().count() > max {
        return Err(format!("INVALID_INPUT: {k}"));
    }
    Ok(s.into())
}
pub(crate) fn optional(v: &Value, k: &str, max: usize) -> Result<Option<String>, String> {
    if v.get(k).is_none() || v[k].is_null() {
        return Ok(None);
    }
    let s = v[k].as_str().ok_or("INVALID_INPUT: text required")?.trim();
    if s.chars().count() > max {
        return Err(format!("INVALID_INPUT: {k} too long"));
    }
    Ok(if s.is_empty() { None } else { Some(s.into()) })
}
pub(crate) fn due_date(v: &Value) -> Result<Option<String>, String> {
    let value = optional(v, "dueDate", 10)?;
    if let Some(date) = &value {
        let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| "INVALID_INPUT: 截止日期")?;
        if parsed.format("%Y-%m-%d").to_string() != *date {
            return Err("INVALID_INPUT: 截止日期需为 YYYY-MM-DD".into());
        }
    }
    Ok(value)
}
fn keys(v: &Value, allowed: &[&str]) -> Result<(), String> {
    let o = v.as_object().ok_or("INVALID_INPUT: object required")?;
    for k in o.keys() {
        if !allowed.contains(&k.as_str()) {
            return Err(format!("INVALID_INPUT: unknown field {k}"));
        }
    }
    Ok(())
}
fn rev(input: &Value, current: u64) -> Result<(), String> {
    if input["expectedRevision"].as_u64() != Some(current) {
        Err("CONFLICT: 内容已有更新。草稿仍保留，请核对最新内容后再保存。".into())
    } else {
        Ok(())
    }
}
pub fn open(path: &Path) -> Result<Connection, String> {
    let c = Connection::open(path).map_err(err)?;
    crate::paper_migration::prepare(&c, path)?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS paper_state(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS paper_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS paper_requests(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);").map_err(err)?;
    c.execute(
        "INSERT OR IGNORE INTO paper_state VALUES(1,?1)",
        [serde_json::to_string(&PaperState::default()).unwrap()],
    )
    .map_err(err)?;
    Ok(c)
}
pub(crate) fn load(c: &Connection) -> Result<PaperState, String> {
    let s: String = c
        .query_row("SELECT data FROM paper_state WHERE id=1", [], |r| r.get(0))
        .map_err(err)?;
    serde_json::from_str(&s).map_err(err)
}
pub(crate) fn event(c: &Connection, kind: &str, source: &str, data: Value) -> Result<(), String> {
    c.execute(
        "INSERT INTO paper_events(data) VALUES(?1)",
        [json!({"id":id(),"at":now(),"kind":kind,"source":source,"utcOffsetMinutes":chrono::Local::now().offset().local_minus_utc()/60,"data":data}).to_string()],
    )
    .map_err(err)?;
    Ok(())
}
pub(crate) fn elapsed(s: &Session, t: i64) -> u64 {
    s.elapsed_seconds
        .saturating_add(
            s.last_resumed_at
                .map(|x| ((t - x).max(0) / 1000) as u64)
                .unwrap_or(0),
        )
        .min(s.planned_seconds)
}
pub(crate) fn active(s: &Session) -> bool {
    matches!(s.status.as_str(), "running" | "paused" | "waiting")
}
fn current_session<'a>(s: &'a mut PaperState, v: &Value) -> Result<&'a mut Session, String> {
    let sid = text(v, "sessionId", 100)?;
    let session = s
        .sessions
        .iter_mut()
        .find(|s| s.id == sid)
        .ok_or("NOT_FOUND: session")?;
    rev(v, session.revision)?;
    Ok(session)
}

// Each UI and Agent mutation is one serialized transaction. No snapshot replacement API is exposed.
pub fn execute(
    c: &mut Connection,
    action: &str,
    v: Value,
    source: &str,
) -> Result<(Value, bool), String> {
    if action == "save_daily_summary" {
        let cached = v["requestId"]
            .as_str()
            .map(|request_id| {
                c.query_row(
                    "SELECT 1 FROM paper_requests WHERE id=?1",
                    [request_id],
                    |_| Ok(()),
                )
                .optional()
                .map(|r| r.is_some())
            })
            .transpose()
            .map_err(err)?
            .unwrap_or(false);
        if !cached && c.path().is_some_and(|p| !p.is_empty() && p != ":memory:") {
            let (_, notes_version) =
                crate::paper_markdown::personal_context(c, v["date"].as_str().unwrap_or(""))?;
            if v["expectedNotesVersion"].as_str() != Some(&notes_version) {
                return Err(
                    "CONFLICT: 个人笔记已有更新或未读取，请重新读取当天记录再生成总结。".into(),
                );
            }
        }
    }
    let (mut result, changed) = execute_inner(c, action, v, source, None)?;
    let journal = crate::paper_markdown::sync(c, changed);
    if result.is_object() {
        result["journal"] = journal;
    }
    if action == "get_daily_record" {
        crate::paper_markdown::enrich_day(c, &mut result)?;
    }
    Ok((result, changed))
}

pub fn runtime_tick(
    c: &mut Connection,
    sample: fn() -> Option<Value>,
) -> Result<(Value, bool), String> {
    let (mut result, changed) =
        execute_inner(c, "runtime_tick", json!({}), "system", Some(sample))?;
    result["journal"] = crate::paper_markdown::sync(c, false);
    Ok((result, changed))
}

fn execute_inner(
    c: &mut Connection,
    action: &str,
    v: Value,
    source: &str,
    sample: Option<fn() -> Option<Value>>,
) -> Result<(Value, bool), String> {
    let tx = c.transaction().map_err(err)?;
    let fingerprint = json!([action, &v, source]).to_string();
    let read = matches!(
        action,
        "get_state"
            | "runtime_tick"
            | "list_tasks"
            | "get_task"
            | "read_history"
            | "read_events"
            | "get_coach_context"
            | "get_coach_prompt"
            | "coach_observe"
            | "coach_analysis_status"
            | "get_plan_batch"
            | "get_daily_record"
    );
    let request_id = if read {
        None
    } else {
        let s = text(&v, "requestId", 100)?;
        Uuid::parse_str(&s).map_err(|_| "INVALID_INPUT: UUID requestId required")?;
        Some(s)
    };
    if let Some(r) = &request_id {
        let cached: Option<(String, String)> = tx
            .query_row(
                "SELECT fingerprint,result FROM paper_requests WHERE id=?1",
                [r],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((f, result)) = cached {
            if f != fingerprint {
                return Err("REQUEST_ID_REUSED: use a new ID for a different operation".into());
            }
            return Ok((serde_json::from_str(&result).map_err(err)?, false));
        }
    }
    let mut s = load(&tx)?;
    let t = now();
    let before_sessions = s.sessions.clone();
    let mut changed = crate::paper_planning::reconcile_steps(&mut s);
    if changed {
        event(
            &tx,
            "planning_steps_reconciled",
            "system",
            json!({"stepCount":s.planning.steps.len()}),
        )?;
    }
    let expired_work_ids: Vec<_> = s
        .coach
        .blocks
        .iter()
        .filter(|block| block.status == "active" && block.planned_end_at <= t)
        .map(|block| block.id.clone())
        .collect();
    changed |= crate::coach::maintain(&mut s, t);
    if !expired_work_ids.is_empty() {
        event(
            &tx,
            "work_blocks_expired",
            "system",
            json!({"blockIds":expired_work_ids}),
        )?;
    }
    for session in &mut s.sessions {
        if session.status == "running" && elapsed(session, t) >= session.planned_seconds {
            session.ended_at = Some(
                session.last_resumed_at.unwrap_or(t)
                    + ((session.planned_seconds - session.elapsed_seconds) * 1000) as i64,
            );
            session.elapsed_seconds = session.planned_seconds;
            session.last_resumed_at = None;
            session.status = "waiting".into();
            session.revision += 1;
            event(
                &tx,
                "timer_elapsed",
                "system",
                json!({"session":session,"basis":"wall_clock_not_verified_attention"}),
            )?;
            changed = true;
        }
    }
    changed |= crate::paper_planning::reconcile_intervals(&before_sessions, &mut s, t);
    let operation_sessions = s.sessions.clone();
    let before_items = s.planning.day_items.clone();
    let result = match action {
        "runtime_tick" => {
            let sample = sample.ok_or("FORBIDDEN: runtime only")?;
            if crate::coach::current(&s).is_some_and(|b| b.status == "active")
                && s.coach.settings.enabled
            {
                if let Some(activity) = sample() {
                    crate::coach::execute(&mut s, &tx, "coach_observe", &activity, "system", t)?;
                    changed = true;
                }
            }
            // Runtime only needs the current work and last activity, not a copy of all history.
            let runtime_state = PaperState {
                coach: crate::coach::CoachState {
                    blocks: crate::coach::current(&s).cloned().into_iter().collect(),
                    activities: s.coach.activities.last().cloned().into_iter().collect(),
                    settings: s.coach.settings.clone(),
                    last_analysis_at: s.coach.last_analysis_at,
                    ..Default::default()
                },
                ..Default::default()
            };
            json!({"state": runtime_state, "prompt": crate::coach::prompt(&s, t)})
        }
        "get_state" => {
            keys(&v, &[])?;
            json!({"state":s})
        }
        "list_tasks" => {
            keys(&v, &["offset", "limit", "completed", "query"])?;
            let offset = v["offset"].as_u64().unwrap_or(0) as usize;
            let limit = v["limit"].as_u64().unwrap_or(30).clamp(1, 100) as usize;
            let q = v["query"].as_str().unwrap_or("").to_lowercase();
            let items: Vec<_> = s
                .tasks
                .iter()
                .filter(|t| {
                    t.title.to_lowercase().contains(&q)
                        && v["completed"]
                            .as_bool()
                            .map(|b| b == t.completed)
                            .unwrap_or(true)
                })
                .collect();
            json!({"items":items.iter().skip(offset).take(limit).collect::<Vec<_>>(),"totalCount":items.len(),"nextOffset":if offset+limit<items.len(){Some(offset+limit)}else{None}})
        }
        "get_task" => {
            keys(&v, &["taskId"])?;
            let tid = text(&v, "taskId", 100)?;
            let task = s
                .tasks
                .iter()
                .find(|t| t.id == tid)
                .ok_or("NOT_FOUND: task")?;
            json!({"task":task,"activeSession":s.sessions.iter().find(|x|x.task_id.as_deref()==Some(&tid)&&active(x)),"steps":s.planning.steps.iter().filter(|x|x.task_id==tid).collect::<Vec<_>>(),"dayItems":s.planning.day_items.iter().filter(|x|x.task_id==tid).collect::<Vec<_>>()})
        }
        "read_history" => {
            keys(&v, &["taskId", "offset", "limit"])?;
            let offset = v["offset"].as_u64().unwrap_or(0) as usize;
            let limit = v["limit"].as_u64().unwrap_or(30).clamp(1, 100) as usize;
            let items: Vec<_> = s
                .sessions
                .iter()
                .rev()
                .filter(|x| {
                    v["taskId"]
                        .as_str()
                        .map(|tid| x.task_id.as_deref() == Some(tid))
                        .unwrap_or(true)
                })
                .collect();
            let page: Vec<Value> = items
                .iter()
                .skip(offset)
                .take(limit)
                .map(|session| {
                    let mut value = serde_json::to_value(session).expect("session serializes");
                    value["clockElapsedSeconds"] = json!(elapsed(session, t));
                    value
                })
                .collect();
            let notes: Vec<_> = s
                .notes
                .iter()
                .filter(|n| {
                    v["taskId"]
                        .as_str()
                        .map(|tid| n["taskId"].as_str() == Some(tid))
                        .unwrap_or(true)
                })
                .collect();
            json!({"items":page,"sampledAt":t,"totalCount":items.len(),"nextOffset":if offset+limit<items.len(){Some(offset+limit)}else{None},"notes":notes,"basis":"clockElapsedSeconds includes current running interval; elapsedSeconds is accumulated stopped time. Clock intervals are not verified attention. Unrecorded time is unknown. Do not infer energy."})
        }
        "read_events" => {
            keys(&v, &["after", "limit"])?;
            let after = v["after"].as_u64().unwrap_or(0);
            let limit = v["limit"].as_u64().unwrap_or(50).clamp(1, 100);
            let mut stmt = tx
                .prepare("SELECT seq,data FROM paper_events WHERE seq>?1 ORDER BY seq LIMIT ?2")
                .map_err(err)?;
            let items=stmt.query_map(params![after,limit],|r|Ok((r.get::<_,u64>(0)?,r.get::<_,String>(1)?))).map_err(err)?.map(|r|{let (seq,d)=r.map_err(err)?;Ok(json!({"cursor":seq,"event":serde_json::from_str::<Value>(&d).map_err(err)?}))}).collect::<Result<Vec<Value>,String>>()?;
            json!({"nextCursor":items.last().map(|x|x["cursor"].clone()).unwrap_or(json!(after)),"items":items})
        }
        "create_task" => {
            keys(
                &v,
                &[
                    "requestId",
                    "taskId",
                    "title",
                    "due",
                    "dueDate",
                    "nextAction",
                    "category",
                    "priority",
                    "originNoteId",
                ],
            )?;
            let requested_tid = text(&v, "taskId", 100)?;
            let note_index = if let Some(nid) = optional(&v, "originNoteId", 100)? {
                Some(
                    s.notes
                        .iter()
                        .position(|n| n["id"].as_str() == Some(&nid))
                        .ok_or("NOT_FOUND: note")?,
                )
            } else {
                None
            };
            let tid = note_index
                .and_then(|i| s.notes[i]["convertedTaskId"].as_str())
                .unwrap_or(&requested_tid)
                .to_string();
            Uuid::parse_str(&tid).map_err(|_| "INVALID_INPUT: UUID taskId required")?;
            if let Some(task) = s.tasks.iter().find(|x| x.id == tid) {
                json!({"task":task})
            } else {
                let task = Task {
                    id: tid,
                    title: text(&v, "title", 300)?,
                    due: optional(&v, "due", 100)?,
                    due_date: due_date(&v)?,
                    category: choice(&v, "category", "work", &["work", "study", "life", "idea"])?,
                    priority: choice(&v, "priority", "medium", &["high", "medium", "low"])?,
                    completed: false,
                    next_action: optional(&v, "nextAction", 300)?.map(|text| Action {
                        id: id(),
                        text,
                        completed: false,
                        source: source.into(),
                    }),
                    revision: 1,
                    source: source.into(),
                    created_at: t,
                    updated_at: t,
                    completed_at: None,
                };
                s.tasks.insert(0, task.clone());
                if let Some(i) = note_index {
                    s.notes[i]["convertedTaskId"] = json!(task.id);
                    event(
                        &tx,
                        "note_converted",
                        source,
                        json!({"noteId":s.notes[i]["id"],"taskId":task.id}),
                    )?;
                }
                event(&tx, action, source, json!({"task":task}))?;
                changed = true;
                json!({"task":task})
            }
        }
        "update_task" => {
            keys(&v, &["requestId", "taskId", "expectedRevision", "patch"])?;
            let tid = text(&v, "taskId", 100)?;
            let patch = &v["patch"];
            keys(
                patch,
                &[
                    "title",
                    "due",
                    "dueDate",
                    "nextAction",
                    "completed",
                    "category",
                    "priority",
                ],
            )?;
            if patch.as_object().unwrap().is_empty() {
                return Err("INVALID_INPUT: empty patch".into());
            }
            if patch.get("completed").is_some()
                && s.sessions
                    .iter()
                    .any(|x| x.task_id.as_deref() == Some(&tid) && active(x))
            {
                return Err("ACTIVE_SESSION: 请先结束这一轮，再修改任务完成状态。".into());
            }
            let task = s
                .tasks
                .iter_mut()
                .find(|x| x.id == tid)
                .ok_or("NOT_FOUND: task")?;
            rev(&v, task.revision)?;
            if patch.get("title").is_some() {
                task.title = text(patch, "title", 300)?
            }
            if patch.get("category").is_some() {
                task.category = choice(
                    patch,
                    "category",
                    "work",
                    &["work", "study", "life", "idea"],
                )?;
            }
            if patch.get("priority").is_some() {
                task.priority = choice(patch, "priority", "medium", &["high", "medium", "low"])?;
            }
            if patch.get("due").is_some() {
                task.due = optional(patch, "due", 100)?
            }
            if patch.get("dueDate").is_some() {
                task.due_date = due_date(patch)?;
            }
            if patch.get("nextAction").is_some() {
                let next = optional(patch, "nextAction", 300)?;
                if next.as_deref() != task.next_action.as_ref().map(|x| x.text.as_str())
                    || task
                        .next_action
                        .as_ref()
                        .map(|x| x.completed)
                        .unwrap_or(false)
                {
                    task.next_action = next.map(|text| Action {
                        id: id(),
                        text,
                        completed: false,
                        source: source.into(),
                    })
                }
            }
            if let Some(x) = patch.get("completed") {
                let b = x
                    .as_bool()
                    .ok_or("INVALID_INPUT: completed must be boolean")?;
                task.completed = b;
                task.completed_at = if b { Some(t) } else { None }
            }
            task.updated_at = t;
            task.revision += 1;
            task.source = source.into();
            event(&tx, action, source, json!({"task":task}))?;
            changed = true;
            json!({"task":task})
        }
        "start_session" => {
            keys(
                &v,
                &[
                    "requestId",
                    "taskId",
                    "expectedRevision",
                    "plannedSeconds",
                    "kind",
                    "stepId",
                    "expectedStepRevision",
                    "dayItemId",
                ],
            )?;
            if s.sessions.iter().any(active) {
                return Err("ACTIVE_SESSION: 请先结束当前一轮。".into());
            }
            if v["kind"].as_str() == Some("focus") {
                if let Some(b) = crate::coach::current(&s).filter(|b| b.status == "active") {
                    if v["taskId"].as_str() != Some(&b.task_id) {
                        return Err("WORK_TARGET_MISMATCH: 请先明确切换本段工作目标。".into());
                    }
                }
            }
            let kind = text(&v, "kind", 10)?;
            if !matches!(kind.as_str(), "focus" | "rest") {
                return Err("INVALID_INPUT: kind".into());
            }
            let planned = v["plannedSeconds"]
                .as_u64()
                .ok_or("INVALID_INPUT: plannedSeconds")?;
            if !(60..=7200).contains(&planned) {
                return Err("INVALID_INPUT: duration must be 60–7200 seconds".into());
            }
            let (task_id, task_title, task_revision, action_snapshot) = if kind == "focus" {
                let tid = text(&v, "taskId", 100)?;
                let selected_step = if let Some(sid) = optional(&v, "stepId", 100)? {
                    let step = s
                        .planning
                        .steps
                        .iter()
                        .find(|x| x.id == sid && x.task_id == tid)
                        .ok_or("NOT_FOUND: step")?
                        .clone();
                    if v["expectedStepRevision"].as_u64() != Some(step.revision) {
                        return Err("CONFLICT: 步骤已有更新，请重新选择。".into());
                    }
                    if step.completed {
                        return Err("ACTION_COMPLETED".into());
                    }
                    Some(step)
                } else {
                    None
                };
                if let Some(iid) = optional(&v, "dayItemId", 100)? {
                    let item = s
                        .planning
                        .day_items
                        .iter()
                        .find(|x| x.id == iid && x.removed_at.is_none())
                        .ok_or("NOT_FOUND: daily plan item")?;
                    if item.task_id != tid
                        || selected_step.as_ref().map(|x| &x.id) != Some(&item.step_id)
                    {
                        return Err(
                            "INVALID_INPUT: daily item must match selected task and step".into(),
                        );
                    }
                }
                let task = s
                    .tasks
                    .iter_mut()
                    .find(|x| x.id == tid)
                    .ok_or("NOT_FOUND: task")?;
                rev(&v, task.revision)?;
                if task.completed {
                    return Err("TASK_COMPLETED".into());
                }
                if let Some(step) = selected_step {
                    if task.next_action.as_ref().map(|x| &x.id) != Some(&step.id) {
                        task.next_action = Some(crate::paper_planning::action(&step));
                        task.revision += 1;
                        task.updated_at = t;
                        event(
                            &tx,
                            "selected_step_for_session",
                            source,
                            json!({"task":task}),
                        )?;
                    }
                }
                if task
                    .next_action
                    .as_ref()
                    .map(|a| a.completed)
                    .unwrap_or(false)
                {
                    return Err("ACTION_COMPLETED: 请设置下一步。".into());
                }
                if task.next_action.is_none() {
                    task.next_action = Some(Action {
                        id: id(),
                        text: task.title.clone(),
                        completed: false,
                        source: source.into(),
                    });
                    task.revision += 1;
                    task.updated_at = t;
                    event(&tx, "default_action_created", source, json!({"task":task}))?;
                }
                (
                    Some(task.id.clone()),
                    task.title.clone(),
                    Some(task.revision),
                    task.next_action.clone(),
                )
            } else {
                (None, "休息".into(), None, None)
            };
            let session = Session {
                id: id(),
                task_id,
                task_title,
                action: action_snapshot,
                task_revision,
                kind,
                status: "running".into(),
                revision: 1,
                planned_seconds: planned,
                elapsed_seconds: 0,
                started_at: t,
                last_resumed_at: Some(t),
                ended_at: None,
                pause_count: 0,
                resume_cue: None,
                feedback: None,
            };
            s.sessions.push(session.clone());
            crate::paper_planning::link_session(&mut s, &session, &v);
            event(
                &tx,
                action,
                source,
                json!({"session":session,"dayItemId":v.get("dayItemId")}),
            )?;
            changed = true;
            json!({"session":session})
        }
        "pause_session" | "resume_session" | "end_session" | "save_cue" => {
            keys(
                &v,
                &["requestId", "sessionId", "expectedRevision", "resumeCue"],
            )?;
            let session = current_session(&mut s, &v)?;
            match action {
                "pause_session" => {
                    if session.status != "running" {
                        return Err("INVALID_STATE".into());
                    }
                    session.elapsed_seconds = elapsed(session, t);
                    session.last_resumed_at = None;
                    session.status = "paused".into();
                    session.pause_count += 1
                }
                "resume_session" => {
                    if session.status != "paused" {
                        return Err("INVALID_STATE".into());
                    }
                    session.last_resumed_at = Some(t);
                    session.status = "running".into()
                }
                "end_session" => {
                    if !active(session) {
                        return Err("INVALID_STATE".into());
                    }
                    session.elapsed_seconds = elapsed(session, t);
                    session.last_resumed_at = None;
                    session.status = "waiting".into();
                    if session.ended_at.is_none() {
                        session.ended_at = Some(t)
                    }
                }
                _ => {
                    if !active(session) {
                        return Err("INVALID_STATE".into());
                    }
                    session.resume_cue = optional(&v, "resumeCue", 500)?
                }
            }
            session.revision += 1;
            event(&tx, action, source, json!({"session":session}))?;
            changed = true;
            json!({"session":session})
        }
        "finish_session" => {
            keys(
                &v,
                &[
                    "requestId",
                    "sessionId",
                    "expectedRevision",
                    "outcome",
                    "output",
                    "blocker",
                    "nextCue",
                ],
            )?;
            let outcome = text(&v, "outcome", 30)?;
            if !matches!(
                outcome.as_str(),
                "step_completed" | "stopped" | "rest_ended"
            ) {
                return Err("INVALID_INPUT: outcome".into());
            }
            let snapshot = {
                let session = current_session(&mut s, &v)?;
                if !active(session) {
                    return Err("INVALID_STATE".into());
                }
                if (session.kind == "rest") != (outcome == "rest_ended") {
                    return Err("INVALID_INPUT: outcome does not match session kind".into());
                }
                session.elapsed_seconds = elapsed(session, t);
                session.last_resumed_at = None;
                session.status = "finished".into();
                if session.ended_at.is_none() {
                    session.ended_at = Some(t)
                }
                session.feedback = Some(
                    json!({"outcome":outcome,"output":optional(&v,"output",2000)?,"blocker":optional(&v,"blocker",2000)?,"nextCue":optional(&v,"nextCue",500)?}),
                );
                session.revision += 1;
                session.clone()
            };
            if outcome == "step_completed" {
                crate::paper_planning::complete_step(&mut s, &snapshot, t);
                if let Some(task) = s
                    .tasks
                    .iter_mut()
                    .find(|x| Some(&x.id) == snapshot.task_id.as_ref())
                {
                    if let Some(a) = &mut task.next_action {
                        if snapshot.action.as_ref().map(|x| &x.id) == Some(&a.id) {
                            a.completed = true;
                            task.revision += 1;
                            task.updated_at = t;
                        }
                    }
                }
            }
            event(
                &tx,
                action,
                source,
                json!({"session":snapshot,"parentTaskAutoCompleted":false}),
            )?;
            changed = true;
            json!({"session":snapshot})
        }
        "capture_note" => {
            keys(&v, &["requestId", "text", "sessionId"])?;
            let context = if let Some(sid) = optional(&v, "sessionId", 100)? {
                Some(
                    s.sessions
                        .iter()
                        .find(|x| x.id == sid)
                        .ok_or("NOT_FOUND: session")?,
                )
            } else {
                None
            };
            let note = json!({"id":id(),"text":text(&v,"text",2000)?,"createdAt":t,"source":source,
                    "sessionId":context.map(|x| &x.id),"taskId":context.and_then(|x| x.task_id.as_ref()),
                    "taskTitle":context.map(|x| &x.task_title),"action":context.and_then(|x| x.action.as_ref())});
            s.notes.push(note.clone());
            event(&tx, action, source, note.clone())?;
            changed = true;
            json!({"note":note})
        }
        "workbench_save_step"
        | "workbench_move_item"
        | "continue_plan_items"
        | "cancel_plan_items" => {
            let out = crate::workbench_plan::execute(&mut s, action, &v, source, t)?;
            event(&tx, action, source, out.clone())?;
            changed = true;
            out
        }
        "get_plan_batch" | "get_daily_record" | "propose_plan_batch" | "adopt_plan_cards"
        | "select_step" | "prepare_step" | "set_step_completed" | "remove_plan_item"
        | "save_daily_summary" => {
            let out = crate::paper_planning::execute(&mut s, action, &v, source, t)?;
            if !matches!(action, "get_plan_batch" | "get_daily_record") {
                event(&tx, action, source, out.clone())?;
                changed = true;
            }
            out
        }
        "get_coach_context"
        | "get_coach_prompt"
        | "start_work"
        | "update_work"
        | "set_work_mode"
        | "end_work"
        | "switch_work_task"
        | "coach_settings"
        | "coach_observe"
        | "coach_analysis_status"
        | "label_activity"
        | "coach_prompt_shown"
        | "respond_coach_prompt"
        | "propose_coaching_action"
        | "respond_coach_proposal" => {
            let out = crate::coach::execute(&mut s, &tx, action, &v, source, t)?;
            changed |= !matches!(action, "get_coach_context" | "get_coach_prompt");
            out
        }
        _ => return Err("UNKNOWN_ACTION".into()),
    };
    if matches!(
        action,
        "start_session"
            | "pause_session"
            | "resume_session"
            | "end_session"
            | "finish_session"
            | "save_cue"
    ) {
        crate::coach::after_session(&mut s, action, &result, t);
    }
    changed |= crate::paper_planning::reconcile_steps(&mut s);
    changed |= crate::paper_planning::reconcile_intervals(&operation_sessions, &mut s, t);
    crate::paper_planning::record_plan_changes(&mut s, &before_items, action, source, t);
    if changed {
        tx.execute(
            "UPDATE paper_state SET data=?1 WHERE id=1",
            [serde_json::to_string(&s).map_err(err)?],
        )
        .map_err(err)?;
    }
    if let Some(r) = request_id {
        tx.execute(
            "INSERT INTO paper_requests VALUES(?1,?2,?3)",
            params![r, fingerprint, result.to_string()],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok((result, changed))
}
#[tauri::command]
pub fn paper_execute(
    app: tauri::AppHandle,
    db: tauri::State<PaperDb>,
    action: String,
    input: Value,
) -> Result<Value, String> {
    let mut c = db.0.lock().map_err(err)?;
    let (v, changed) = execute(&mut c, &action, input, "user")?;
    if changed {
        let _ = app.emit("paper:changed", ());
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        open(Path::new(":memory:")).unwrap()
    }
    fn call(c: &mut Connection, a: &str, mut v: Value) -> Result<Value, String> {
        if !matches!(
            a,
            "get_state" | "get_task" | "read_history" | "read_events" | "list_tasks"
        ) {
            v["requestId"] = json!(id())
        }
        execute(c, a, v, "user").map(|x| x.0)
    }
    fn task(c: &mut Connection) -> Task {
        let v = call(
            c,
            "create_task",
            json!({"taskId":id(),"title":"产品方案","nextAction":"列出状态"}),
        )
        .unwrap();
        serde_json::from_value(v["task"].clone()).unwrap()
    }
    #[test]
    fn converting_note_is_atomic_and_does_not_duplicate_tasks() {
        let mut c = db();
        let n =
            call(&mut c, "capture_note", json!({"text":"整理暂停流程"})).unwrap()["note"].clone();
        let first = call(
            &mut c,
            "create_task",
            json!({"taskId":id(),"title":"整理暂停流程","originNoteId":n["id"]}),
        )
        .unwrap();
        let retry = call(
            &mut c,
            "create_task",
            json!({"taskId":id(),"title":"整理暂停流程","originNoteId":n["id"]}),
        )
        .unwrap();
        assert_eq!(first["task"]["id"], retry["task"]["id"]);
        let state = load(&c).unwrap();
        assert_eq!(state.tasks.len(), 1);
        assert_eq!(state.notes[0]["convertedTaskId"], first["task"]["id"]);
        assert!(call(
            &mut c,
            "create_task",
            json!({"taskId":id(),"title":"错误","originNoteId":"missing"})
        )
        .is_err());
        assert_eq!(load(&c).unwrap().tasks.len(), 1);
    }
    #[test]
    fn focus_notes_keep_snapshot_and_filter_by_task() {
        let mut c = db();
        let t = task(&mut c);
        let session = call(
            &mut c,
            "start_session",
            json!({"taskId":t.id,"expectedRevision":1,"kind":"focus","plannedSeconds":1500}),
        )
        .unwrap()["session"]
            .clone();
        call(&mut c, "update_task", json!({"taskId":t.id,"expectedRevision":1,"patch":{"title":"新标题","nextAction":"新的安排"}})).unwrap();
        let note = call(
            &mut c,
            "capture_note",
            json!({"text":"想到一个状态","sessionId":session["id"]}),
        )
        .unwrap()["note"]
            .clone();
        assert_eq!(note["taskTitle"], "产品方案");
        assert_eq!(note["action"]["text"], "列出状态");
        assert_eq!(note["sessionId"], session["id"]);
        call(&mut c, "capture_note", json!({"text":"未关联的随手记"})).unwrap();
        let other = task(&mut c);
        assert_eq!(
            call(&mut c, "read_history", json!({"taskId":t.id})).unwrap()["notes"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            call(&mut c, "read_history", json!({"taskId":other.id})).unwrap()["notes"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert!(call(
            &mut c,
            "capture_note",
            json!({"text":"不存在的轮次","sessionId":"missing"})
        )
        .is_err());
    }
    #[test]
    fn stale_write_and_duplicate_request() {
        let mut c = db();
        let t = task(&mut c);
        let v = json!({"requestId":id(),"taskId":t.id,"expectedRevision":1,"patch":{"title":"新的方案"}});
        let a = execute(&mut c, "update_task", v.clone(), "agent").unwrap();
        assert_eq!(a.0, execute(&mut c, "update_task", v, "agent").unwrap().0);
        assert!(call(
            &mut c,
            "update_task",
            json!({"taskId":t.id,"expectedRevision":1,"patch":{"title":"覆盖"}})
        )
        .unwrap_err()
        .contains("CONFLICT"));
    }
    #[test]
    fn step_finish_keeps_parent_and_preserves_agent_next_step() {
        let mut c = db();
        let t = task(&mut c);
        let session = call(
            &mut c,
            "start_session",
            json!({"taskId":t.id,"expectedRevision":1,"kind":"focus","plannedSeconds":1500}),
        )
        .unwrap()["session"]
            .clone();
        call(
            &mut c,
            "update_task",
            json!({"taskId":t.id,"expectedRevision":1,"patch":{"nextAction":"Agent 新的一步"}}),
        )
        .unwrap();
        call(
            &mut c,
            "finish_session",
            json!({"sessionId":session["id"],"expectedRevision":1,"outcome":"step_completed"}),
        )
        .unwrap();
        let state = load(&c).unwrap();
        assert!(!state.tasks[0].completed);
        assert!(!state.tasks[0].next_action.as_ref().unwrap().completed);
        assert_eq!(state.sessions[0].action.as_ref().unwrap().text, "列出状态");
    }
    #[test]
    fn pause_resume_and_no_parent_completion() {
        let mut c = db();
        let t = task(&mut c);
        let a = call(
            &mut c,
            "start_session",
            json!({"taskId":t.id,"expectedRevision":1,"kind":"focus","plannedSeconds":1500}),
        )
        .unwrap()["session"]
            .clone();
        call(
            &mut c,
            "pause_session",
            json!({"sessionId":a["id"],"expectedRevision":1}),
        )
        .unwrap();
        assert!(call(
            &mut c,
            "update_task",
            json!({"taskId":t.id,"expectedRevision":1,"patch":{"completed":true}})
        )
        .is_err());
        call(
            &mut c,
            "resume_session",
            json!({"sessionId":a["id"],"expectedRevision":2}),
        )
        .unwrap();
        call(
            &mut c,
            "finish_session",
            json!({"sessionId":a["id"],"expectedRevision":3,"outcome":"step_completed"}),
        )
        .unwrap();
        let s = load(&c).unwrap();
        assert_eq!(s.sessions[0].pause_count, 1);
        assert!(!s.tasks[0].completed);
        assert!(s.tasks[0].next_action.as_ref().unwrap().completed);
        assert!(s.sessions[0].feedback.as_ref().unwrap()["blocker"].is_null());
    }
    #[test]
    fn elapsed_caps_and_pause_excluded() {
        let s = Session {
            id: id(),
            task_id: None,
            task_title: "".into(),
            action: None,
            task_revision: None,
            kind: "rest".into(),
            status: "running".into(),
            revision: 1,
            planned_seconds: 300,
            elapsed_seconds: 20,
            started_at: 0,
            last_resumed_at: Some(1000),
            ended_at: None,
            pause_count: 0,
            resume_cue: None,
            feedback: None,
        };
        assert_eq!(elapsed(&s, 31000), 50);
        assert_eq!(elapsed(&s, 400000), 300);
        let mut p = s.clone();
        p.last_resumed_at = None;
        assert_eq!(elapsed(&p, 400000), 20);
    }
    #[test]
    fn persistence_and_event_cursor() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("paper.db");
        let mut c = open(&path).unwrap();
        task(&mut c);
        drop(c);
        let mut c = open(&path).unwrap();
        assert_eq!(load(&c).unwrap().tasks.len(), 1);
        let e = call(&mut c, "read_events", json!({"after":0})).unwrap();
        assert_eq!(e["items"].as_array().unwrap().len(), 1);
        assert!(
            call(&mut c, "read_events", json!({"after":e["nextCursor"]})).unwrap()["items"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn task_without_step_gets_a_stable_action_and_stays_pending() {
        let mut c = db();
        let task = call(
            &mut c,
            "create_task",
            json!({"taskId":id(),"title":"写两句话"}),
        )
        .unwrap()["task"]
            .clone();
        let session = call(
            &mut c,
            "start_session",
            json!({"taskId":task["id"],"expectedRevision":1,"kind":"focus","plannedSeconds":60}),
        )
        .unwrap()["session"]
            .clone();
        assert!(session["action"]["id"].is_string());
        call(
            &mut c,
            "finish_session",
            json!({"sessionId":session["id"],"expectedRevision":1,"outcome":"step_completed"}),
        )
        .unwrap();
        let state = load(&c).unwrap();
        assert!(!state.tasks[0].completed);
        assert!(state.tasks[0].next_action.as_ref().unwrap().completed);
    }
    #[test]
    fn expired_session_reconciles_once_after_restart() {
        let mut c = db();
        call(
            &mut c,
            "start_session",
            json!({"kind":"rest","plannedSeconds":60}),
        )
        .unwrap();
        let mut state = load(&c).unwrap();
        state.sessions[0].last_resumed_at = Some(now() - 61000);
        c.execute(
            "UPDATE paper_state SET data=?1",
            [serde_json::to_string(&state).unwrap()],
        )
        .unwrap();
        call(&mut c, "get_state", json!({})).unwrap();
        call(&mut c, "get_state", json!({})).unwrap();
        let state = load(&c).unwrap();
        assert_eq!(state.sessions[0].status, "waiting");
        assert_eq!(state.sessions[0].elapsed_seconds, 60);
        let events = call(&mut c, "read_events", json!({})).unwrap();
        assert_eq!(
            events["items"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|x| x["event"]["kind"] == "timer_elapsed")
                .count(),
            1
        );
    }
    #[test]
    fn rejected_patch_does_not_partially_save() {
        let mut c = db();
        let task = task(&mut c);
        assert!(call(&mut c,"update_task",json!({"taskId":task.id,"expectedRevision":1,"patch":{"title":"不应保存","completed":"invalid"}})).is_err());
        let saved = load(&c).unwrap();
        assert_eq!(saved.tasks[0].title, task.title);
        assert_eq!(saved.tasks[0].revision, 1);
    }
    #[test]
    fn task_metadata_roundtrip_and_legacy_defaults() {
        let mut c = db();
        let created = call(
            &mut c,
            "create_task",
            json!({"taskId":id(),"title":"分类验证","category":"study","priority":"high"}),
        )
        .unwrap()["task"]
            .clone();
        assert_eq!(created["category"], "study");
        assert_eq!(created["priority"], "high");
        let updated = call(
            &mut c,
            "update_task",
            json!({"taskId":created["id"],"expectedRevision":1,"patch":{"priority":"low"}}),
        )
        .unwrap();
        assert_eq!(updated["task"]["priority"], "low");
        assert!(call(
            &mut c,
            "update_task",
            json!({"taskId":created["id"],"expectedRevision":2,"patch":{"category":"invalid"}})
        )
        .is_err());
        let mut legacy = created;
        legacy.as_object_mut().unwrap().remove("category");
        legacy.as_object_mut().unwrap().remove("priority");
        let task: Task = serde_json::from_value(legacy).unwrap();
        assert_eq!(task.category, "work");
        assert_eq!(task.priority, "medium");
    }
}
