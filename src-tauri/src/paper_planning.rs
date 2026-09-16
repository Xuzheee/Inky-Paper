//! Shared plans and execution facts. SQLite is authoritative; Markdown is a readable projection.
use crate::paper::{Action, PaperState, Session, Task};
use chrono::{NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[cfg(test)]
#[path = "paper_planning_tests.rs"]
mod tests;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanningState {
    pub steps: Vec<Step>,
    pub batches: Vec<Batch>,
    pub day_items: Vec<DayItem>,
    pub summaries: Vec<Summary>,
    pub intervals: Vec<Interval>,
    pub session_links: Vec<SessionLink>,
    pub manual_step_changes: Vec<ManualStepChange>,
    pub prepared: Option<PreparedStep>,
    pub plan_changes: Vec<PlanChange>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedStep {
    pub task_id: String,
    pub step_id: String,
    pub day_item_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChange {
    pub id: String,
    pub operation: String,
    pub source: String,
    pub recorded_at: i64,
    pub before: Option<DayItem>,
    pub after: Option<DayItem>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: String,
    pub task_id: String,
    pub text: String,
    pub expected_result: Option<String>,
    pub planned_seconds: u64,
    pub completed: bool,
    pub revision: u64,
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub task_id: String,
    pub task_title: Option<String>,
    pub expected_task_revision: Option<u64>,
    pub step_id: Option<String>,
    pub expected_step_revision: Option<u64>,
    pub text: String,
    pub expected_result: Option<String>,
    pub planned_seconds: u64,
    pub adopted_step_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub id: String,
    pub revision: u64,
    pub cards: Vec<Card>,
    pub created_at: i64,
}
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayItem {
    pub id: String,
    pub date: String,
    pub task_id: String,
    pub step_id: String,
    pub order: u64,
    pub revision: u64,
    pub removed_at: Option<i64>,
    #[serde(default)]
    pub start_minute: Option<u32>,
    #[serde(default)]
    pub duration_minutes: Option<u32>,
    #[serde(default)]
    pub resolved_at: Option<i64>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub continued_to: Option<String>,
}
pub(crate) fn record_plan_changes(s: &mut PaperState, before: &[DayItem], operation: &str, source: &str, t: i64) {
    for after in &s.planning.day_items {
        let old = before.iter().find(|x| x.id == after.id);
        if old != Some(after) {
            s.planning.plan_changes.push(PlanChange {
                id: id(), operation: operation.into(), source: source.into(), recorded_at: t,
                before: old.cloned(), after: Some(after.clone()),
            });
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub date: String,
    pub body: String,
    pub source_version: String,
    pub source_as_of: i64,
    pub created_at: i64,
    pub source: String,
    pub utc_offset_minutes: i32,
    #[serde(default)]
    pub source_notes_version: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Interval {
    pub session_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLink {
    pub session_id: String,
    pub day_item_id: String,
    pub plan_date: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualStepChange {
    pub id: String,
    pub task_id: String,
    pub task_title: String,
    pub step_id: String,
    pub step_text: String,
    pub completed: bool,
    pub recorded_at: i64,
}
pub(crate) fn link_session(s: &mut PaperState, session: &Session, input: &Value) {
    if let Some(item) = input["dayItemId"]
        .as_str()
        .and_then(|iid| s.planning.day_items.iter().find(|x| x.id == iid))
    {
        s.planning.session_links.push(SessionLink {
            session_id: session.id.clone(),
            day_item_id: item.id.clone(),
            plan_date: item.date.clone(),
        });
    }
}
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn keys(v: &Value, allowed: &[&str]) -> Result<(), String> {
    for k in v
        .as_object()
        .ok_or("INVALID_INPUT: object required")?
        .keys()
    {
        if k != "requestId" && !allowed.contains(&k.as_str()) {
            return Err(format!("INVALID_INPUT: unknown field {k}"));
        }
    }
    Ok(())
}
fn text(v: &Value, k: &str, max: usize) -> Result<String, String> {
    let value = v[k].as_str().ok_or(format!("INVALID_INPUT: {k}"))?.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(format!("INVALID_INPUT: {k}"));
    }
    Ok(value.into())
}
fn optional(v: &Value, k: &str, max: usize) -> Result<Option<String>, String> {
    if v.get(k).is_none() || v[k].is_null() || v[k].as_str() == Some("") {
        return Ok(None);
    }
    text(v, k, max).map(Some)
}
fn uuid(v: &Value, k: &str) -> Result<String, String> {
    let value = text(v, k, 100)?;
    uuid::Uuid::parse_str(&value).map_err(|_| format!("INVALID_INPUT: UUID {k} required"))?;
    Ok(value)
}
fn duration(v: &Value, fallback: u64) -> Result<u64, String> {
    let seconds = match v.get("plannedSeconds") {
        None => fallback,
        Some(x) => x.as_u64().ok_or("INVALID_INPUT: plannedSeconds")?,
    };
    if !(60..=7200).contains(&seconds) {
        return Err("INVALID_INPUT: plannedSeconds must be 60–7200".into());
    }
    Ok(seconds)
}
fn check_revision(actual: u64, expected: Option<u64>, what: &str) -> Result<(), String> {
    if expected != Some(actual) {
        return Err(format!("CONFLICT: {what}已有更新。请核对差异后重新采用。"));
    }
    Ok(())
}
fn date(v: &Value) -> Result<String, String> {
    let date = text(v, "date", 10)?;
    date_bounds(&date, 0)?;
    Ok(date)
}
pub(crate) fn offset(v: &Value) -> Result<i32, String> {
    match v.get("utcOffsetMinutes") {
        None => Ok(chrono::Local::now().offset().local_minus_utc() / 60),
        Some(value) => {
            let offset = value.as_i64().ok_or("INVALID_INPUT: utcOffsetMinutes")?;
            if !(-840..=840).contains(&offset) {
                return Err("INVALID_INPUT: utcOffsetMinutes".into());
            }
            Ok(offset as i32)
        }
    }
}
fn date_bounds(date: &str, offset: i32) -> Result<(i64, i64), String> {
    if date.len() != 10 || !(-840..=840).contains(&offset) {
        return Err("INVALID_INPUT: date or utcOffsetMinutes".into());
    }
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| "INVALID_INPUT: date must be YYYY-MM-DD")?;
    if day.format("%Y-%m-%d").to_string() != date {
        return Err("INVALID_INPUT: date must be YYYY-MM-DD".into());
    }
    let start = chrono::Utc
        .from_utc_datetime(&day.and_hms_opt(0, 0, 0).unwrap())
        .timestamp_millis()
        - i64::from(offset) * 60_000;
    Ok((start, start + 86_400_000))
}

/// Import legacy current actions once; keep old UI/coach mutations compatible with persisted steps.
pub(crate) fn reconcile_steps(s: &mut PaperState) -> bool {
    let mut changed = false;
    for task in &s.tasks {
        let Some(action) = &task.next_action else {
            continue;
        };
        if let Some(step) = s
            .planning
            .steps
            .iter_mut()
            .find(|x| x.id == action.id && x.task_id == task.id)
        {
            if step.completed != action.completed || step.text != action.text {
                step.completed = action.completed;
                step.text = action.text.clone();
                step.revision += 1;
                step.updated_at = task.updated_at;
                changed = true;
            }
        } else {
            s.planning.steps.push(Step {
                id: action.id.clone(),
                task_id: task.id.clone(),
                text: action.text.clone(),
                expected_result: None,
                planned_seconds: 1500,
                completed: action.completed,
                revision: 1,
                source: action.source.clone(),
                created_at: task.created_at,
                updated_at: task.updated_at,
            });
            changed = true;
        }
    }
    changed
}
pub(crate) fn action(step: &Step) -> Action {
    Action {
        id: step.id.clone(),
        text: step.text.clone(),
        completed: step.completed,
        source: step.source.clone(),
    }
}
pub(crate) fn complete_step(s: &mut PaperState, session: &Session, t: i64) {
    let Some(snapshot) = session.action.as_ref() else {
        return;
    };
    if let Some(step) = s
        .planning
        .steps
        .iter_mut()
        .find(|x| x.id == snapshot.id && Some(&x.task_id) == session.task_id.as_ref())
    {
        if !step.completed {
            step.completed = true;
            step.revision += 1;
            step.updated_at = t;
        }
    }
}
/// New sessions retain every running interval. Existing sessions keep their explicitly limited legacy precision.
pub(crate) fn reconcile_intervals(before: &[Session], s: &mut PaperState, t: i64) -> bool {
    let mut changed = false;
    let previous: std::collections::HashMap<_, _> =
        before.iter().map(|x| (x.id.as_str(), x)).collect();
    let tracked: std::collections::HashSet<_> = s
        .planning
        .intervals
        .iter()
        .map(|x| x.session_id.clone())
        .collect();
    for session in &s.sessions {
        let old = previous.get(session.id.as_str()).copied();
        // WorkStart creates its clock through coach.rs. Connect only newly created sessions;
        // never guess a historical plan link, and keep an explicit selection's date intact.
        if old.is_none()
            && !s
                .planning
                .session_links
                .iter()
                .any(|x| x.session_id == session.id)
        {
            let day = chrono::Local
                .timestamp_millis_opt(session.started_at)
                .single()
                .map(|x| x.format("%Y-%m-%d").to_string());
            if let Some(item) = s.planning.day_items.iter().find(|item| {
                item.removed_at.is_none()
                    && Some(&item.date) == day.as_ref()
                    && Some(&item.task_id) == session.task_id.as_ref()
                    && session
                        .action
                        .as_ref()
                        .is_some_and(|action| action.id == item.step_id)
            }) {
                s.planning.session_links.push(SessionLink {
                    session_id: session.id.clone(),
                    day_item_id: item.id.clone(),
                    plan_date: item.date.clone(),
                });
                changed = true;
            }
        }
        if old.is_some() && !tracked.contains(&session.id) {
            continue;
        }
        if old.is_none()
            || old.is_some_and(|x| x.status != "running" && session.status == "running")
        {
            if session.status == "running" {
                s.planning.intervals.push(Interval {
                    session_id: session.id.clone(),
                    started_at: session.last_resumed_at.unwrap_or(session.started_at),
                    ended_at: None,
                });
                changed = true;
            }
        }
        if let Some(old) = old.filter(|x| x.status == "running" && session.status != "running") {
            if let Some(interval) = s
                .planning
                .intervals
                .iter_mut()
                .rev()
                .find(|x| x.session_id == session.id && x.ended_at.is_none())
            {
                // Match the clock's whole-second accumulation, including planned-duration capping.
                interval.ended_at = Some(
                    (interval.started_at
                        + session.elapsed_seconds.saturating_sub(old.elapsed_seconds) as i64
                            * 1000)
                        .min(t),
                );
                changed = true;
            }
        }
    }
    changed
}

pub(crate) fn daily_record(
    s: &PaperState,
    date: &str,
    offset: i32,
    t: i64,
) -> Result<Value, String> {
    let (start, end) = date_bounds(date, offset)?;
    let mut plan_items: Vec<_> = s
        .planning
        .day_items
        .iter()
        .filter(|x| x.date == date && x.removed_at.is_none())
        .collect();
    plan_items.sort_by_key(|x| x.order);
    let plans: Vec<_> = plan_items
        .iter()
        .map(|item| {
            let mut item_value = serde_json::to_value(item).unwrap();
            item_value["task"] = json!(s.tasks.iter().find(|x| x.id == item.task_id));
            item_value["step"] = json!(s.planning.steps.iter().find(|x| x.id == item.step_id));
            item_value
        })
        .collect();
    let mut sessions = Vec::new();
    let mut session_facts = Vec::new();
    let mut grouped_intervals: std::collections::HashMap<&str, Vec<&Interval>> =
        std::collections::HashMap::new();
    for interval in &s.planning.intervals {
        grouped_intervals
            .entry(interval.session_id.as_str())
            .or_default()
            .push(interval);
    }
    let links: std::collections::HashMap<_, _> = s
        .planning
        .session_links
        .iter()
        .map(|x| (x.session_id.as_str(), x))
        .collect();
    for session in &s.sessions {
        let intervals = grouped_intervals
            .get(session.id.as_str())
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let legacy = intervals.is_empty();
        let (daily_ms, daily_seconds): (i64, u64) = intervals
            .iter()
            .map(|interval| {
                let stop = interval.ended_at.unwrap_or_else(|| {
                    interval.started_at
                        + crate::paper::elapsed(session, t).saturating_sub(session.elapsed_seconds)
                            as i64
                            * 1000
                });
                let from = interval.started_at.max(start);
                let to = stop.min(end).min(t);
                if to <= from {
                    return (0, 0);
                }
                // Partition the clock's whole seconds by cumulative endpoints. Independent
                // flooring of each day's milliseconds would lose a second at midnight.
                let seconds = ((to - interval.started_at) / 1000
                    - (from - interval.started_at) / 1000) as u64;
                (to - from, seconds)
            })
            .fold((0, 0), |sum, span| (sum.0 + span.0, sum.1 + span.1));
        let starts_here = (start..end).contains(&session.started_at);
        let ends_here = session.ended_at.is_some_and(|x| (start..end).contains(&x));
        if !starts_here && !ends_here && daily_ms == 0 {
            continue;
        }
        let mut value = serde_json::to_value(session).unwrap();
        value["dailyMilliseconds"] = json!(if legacy {
            if starts_here {
                crate::paper::elapsed(session, t) * 1000
            } else {
                0
            }
        } else {
            daily_ms as u64
        });
        let plan_link = links.get(session.id.as_str()).copied();
        value["dayItemId"] = json!(plan_link.map(|x| &x.day_item_id));
        value["planDate"] = json!(plan_link.map(|x| &x.plan_date));
        value["dailySeconds"] = json!(if legacy {
            if starts_here {
                crate::paper::elapsed(session, t)
            } else {
                0
            }
        } else {
            daily_seconds
        });
        value["timePrecision"] = json!(if legacy {
            "legacy_start_date"
        } else {
            "recorded_intervals"
        });
        sessions.push(value);
        session_facts.push(json!({"session":session,"intervals":intervals,"planLink":plan_link}));
    }
    let notes: Vec<_> = s
        .notes
        .iter()
        .filter(|x| {
            x["createdAt"]
                .as_i64()
                .is_some_and(|at| (start..end).contains(&at))
        })
        .collect();
    let work_blocks: Vec<_> = s
        .coach
        .blocks
        .iter()
        .filter(|x| {
            (start..end).contains(&x.started_at)
                || x.ended_at.is_some_and(|at| (start..end).contains(&at))
        })
        .collect();
    let manual_step_changes: Vec<_> = s
        .planning
        .manual_step_changes
        .iter()
        .filter(|change| (start..end).contains(&change.recorded_at))
        .collect();
    let mut facts = json!({"date":date,"utcOffsetMinutes":offset,"plans":plans,"sessions":session_facts,"notes":notes,"workBlocks":work_blocks});
    let plan_changes: Vec<_> = s.planning.plan_changes.iter().filter(|change|
        change.before.as_ref().is_some_and(|x| x.date == date)
        || change.after.as_ref().is_some_and(|x| x.date == date)
        || (start..end).contains(&change.recorded_at)).collect();
    if !plan_changes.is_empty() { facts["planChanges"] = json!(plan_changes); }
    // Keep existing summaries valid on days with no newly supported manual facts.
    if !manual_step_changes.is_empty() {
        facts["manualStepChanges"] = json!(manual_step_changes);
    }
    let data_version = format!("{:x}", Sha256::digest(facts.to_string().as_bytes()));
    let summaries: Vec<_> = s
        .planning
        .summaries
        .iter()
        .filter(|x| x.date == date)
        .map(|summary| {
            let mut value = serde_json::to_value(summary).unwrap();
            let clock_continued = s.sessions.iter().any(|session| {
                session.status == "running"
                    && session.last_resumed_at.is_some_and(|resumed| {
                        let running_end = resumed
                            + crate::paper::elapsed(session, t)
                                .saturating_sub(session.elapsed_seconds)
                                as i64
                                * 1000;
                        running_end.min(end) > summary.source_as_of.max(start).max(resumed)
                    })
            });
            value["hasNewRecords"] = json!(
                summary.source_version != data_version
                    || summary.utc_offset_minutes != offset
                    || clock_continued
            );
            value
        })
        .collect();
    Ok(
        json!({"date":date,"utcOffsetMinutes":offset,"planItems":plans,"planChanges":plan_changes,"sessions":sessions,"manualStepChanges":manual_step_changes,"notes":notes,"workBlocks":work_blocks,"summaries":summaries,"dataVersion":data_version,"sampledAt":t,
        "basis":"Clock intervals are recorded time, not verified attention. Pauses are excluded. New sessions split at the requested local midnight. Legacy sessions without intervals are assigned to their start date; exact legacy daily allocation is unavailable. Missing output and unrecorded time remain unknown."}),
    )
}

pub(crate) fn execute(
    s: &mut PaperState,
    operation: &str,
    v: &Value,
    source: &str,
    t: i64,
) -> Result<Value, String> {
    match operation {
        "get_plan_batch" => {
            keys(v, &["batchId"])?;
            let bid = uuid(v, "batchId")?;
            let batch = s
                .planning
                .batches
                .iter()
                .find(|x| x.id == bid)
                .ok_or("NOT_FOUND: batch")?;
            let task_ids: Vec<_> = batch.cards.iter().map(|x| &x.task_id).collect();
            Ok(
                json!({"batch":batch,"tasks":s.tasks.iter().filter(|x| task_ids.contains(&&x.id)).collect::<Vec<_>>(),"steps":s.planning.steps.iter().filter(|x| task_ids.contains(&&x.task_id)).collect::<Vec<_>>(),"dayItems":s.planning.day_items.iter().filter(|x| task_ids.contains(&&x.task_id)).collect::<Vec<_>>()}),
            )
        }
        "propose_plan_batch" => {
            keys(v, &["batchId", "cards"])?;
            let bid = uuid(v, "batchId")?;
            if s.planning.batches.iter().any(|x| x.id == bid) {
                return Err(
                    "CONFLICT: batchId already exists; reuse the original requestId for retries"
                        .into(),
                );
            }
            let inputs = v["cards"].as_array().ok_or("INVALID_INPUT: cards")?;
            if inputs.is_empty() || inputs.len() > 30 {
                return Err("INVALID_INPUT: use 1–30 cards".into());
            }
            let mut cards: Vec<Card> = Vec::new();
            for input in inputs {
                keys(
                    input,
                    &[
                        "id",
                        "taskId",
                        "taskTitle",
                        "expectedTaskRevision",
                        "stepId",
                        "expectedStepRevision",
                        "text",
                        "expectedResult",
                        "plannedSeconds",
                    ],
                )?;
                let cid = uuid(input, "id")?;
                if cards.iter().any(|x| x.id == cid) {
                    return Err("INVALID_INPUT: duplicate card id".into());
                }
                let tid = uuid(input, "taskId")?;
                let title = optional(input, "taskTitle", 300)?;
                let task = s.tasks.iter().find(|x| x.id == tid);
                if let Some(task) = task {
                    check_revision(
                        task.revision,
                        input["expectedTaskRevision"].as_u64(),
                        "任务",
                    )?;
                    if task.completed {
                        return Err("TASK_COMPLETED".into());
                    }
                } else if title.is_none() {
                    return Err("INVALID_INPUT: new task requires taskTitle".into());
                }
                if task.is_none()
                    && cards
                        .iter()
                        .any(|x| x.task_id == tid && x.task_title != title)
                {
                    return Err(
                        "INVALID_INPUT: cards for one new task must use the same taskTitle".into(),
                    );
                }
                let sid = optional(input, "stepId", 100)?;
                if let Some(sid) = &sid {
                    uuid::Uuid::parse_str(sid)
                        .map_err(|_| "INVALID_INPUT: UUID stepId required")?;
                    let step = s
                        .planning
                        .steps
                        .iter()
                        .find(|x| x.id == *sid && x.task_id == tid)
                        .ok_or("NOT_FOUND: step")?;
                    check_revision(
                        step.revision,
                        input["expectedStepRevision"].as_u64(),
                        "步骤",
                    )?;
                    if step.completed {
                        return Err("ACTION_COMPLETED".into());
                    }
                }
                let existing_step = sid
                    .as_ref()
                    .and_then(|sid| s.planning.steps.iter().find(|x| x.id == *sid));
                let expected_result = if input.get("expectedResult").is_some() {
                    optional(input, "expectedResult", 2000)?
                } else {
                    existing_step.and_then(|x| x.expected_result.clone())
                };
                let planned_seconds = duration(
                    input,
                    existing_step.map(|x| x.planned_seconds).unwrap_or(1500),
                )?;
                cards.push(Card {
                    id: cid,
                    task_id: tid,
                    task_title: title,
                    expected_task_revision: input["expectedTaskRevision"].as_u64(),
                    step_id: sid,
                    expected_step_revision: input["expectedStepRevision"].as_u64(),
                    text: text(input, "text", 300)?,
                    expected_result,
                    planned_seconds,
                    adopted_step_id: None,
                });
            }
            let batch = Batch {
                id: bid,
                revision: 1,
                cards,
                created_at: t,
            };
            s.planning.batches.push(batch.clone());
            Ok(json!({"batch":batch}))
        }
        "adopt_plan_cards" => adopt(s, v, source, t),
        "set_step_completed" => {
            if source != "user" {
                return Err("FORBIDDEN: 仅允许用户手动修改步骤完成状态。".into());
            }
            keys(
                v,
                &[
                    "taskId",
                    "stepId",
                    "expectedTaskRevision",
                    "expectedStepRevision",
                    "completed",
                ],
            )?;
            let tid = uuid(v, "taskId")?;
            let sid = uuid(v, "stepId")?;
            let completed = v["completed"]
                .as_bool()
                .ok_or("INVALID_INPUT: completed must be boolean")?;
            if s.sessions.iter().any(|session| {
                session.task_id.as_ref() == Some(&tid) && crate::paper::active(session)
            }) {
                return Err("ACTIVE_SESSION: 请先结束这一轮，再修改步骤完成状态。".into());
            }
            let task = s
                .tasks
                .iter_mut()
                .find(|task| task.id == tid)
                .ok_or("NOT_FOUND: task")?;
            check_revision(task.revision, v["expectedTaskRevision"].as_u64(), "任务")?;
            let step = s
                .planning
                .steps
                .iter_mut()
                .find(|step| step.id == sid && step.task_id == tid)
                .ok_or("NOT_FOUND: step")?;
            check_revision(step.revision, v["expectedStepRevision"].as_u64(), "步骤")?;
            let manual_change = if step.completed != completed {
                step.completed = completed;
                step.revision += 1;
                step.updated_at = t;
                if let Some(action) = task.next_action.as_mut().filter(|action| action.id == sid) {
                    action.completed = completed;
                    task.revision += 1;
                    task.updated_at = t;
                }
                Some(ManualStepChange {
                    id: id(),
                    task_id: tid,
                    task_title: task.title.clone(),
                    step_id: sid,
                    step_text: step.text.clone(),
                    completed,
                    recorded_at: t,
                })
            } else {
                None
            };
            let out = json!({"task":task,"step":step,"manualStepChange":manual_change});
            if let Some(change) = manual_change {
                s.planning.manual_step_changes.push(change);
            }
            Ok(out)
        }
        "select_step" | "prepare_step" => {
            if operation == "prepare_step" && source != "user" {
                return Err("FORBIDDEN: 准备下一步仅由用户操作。".into());
            }
            if operation == "prepare_step" && s.sessions.iter().any(crate::paper::active) {
                return Err("ACTIVE_SESSION: 本轮番茄钟还未结束，请先回到 Inky 保存本轮。".into());
            }
            keys(
                v,
                &[
                    "taskId",
                    "stepId",
                    "expectedRevision",
                    "expectedStepRevision",
                    "dayItemId",
                ],
            )?;
            let tid = uuid(v, "taskId")?;
            let sid = uuid(v, "stepId")?;
            let step = s
                .planning
                .steps
                .iter()
                .find(|x| x.id == sid && x.task_id == tid)
                .ok_or("NOT_FOUND: step")?
                .clone();
            check_revision(step.revision, v["expectedStepRevision"].as_u64(), "步骤")?;
            if step.completed {
                return Err("ACTION_COMPLETED".into());
            }
            let item = if operation == "prepare_step" {
                match v["dayItemId"].as_str() {
                    Some(iid) => Some(s.planning.day_items.iter()
                        .find(|x| x.id == iid && x.task_id == tid && x.step_id == sid && x.removed_at.is_none())
                        .ok_or("CONFLICT: 这条安排已变化，请刷新后重试。")?.clone()),
                    None if v["dayItemId"].is_null() => None,
                    None => return Err("INVALID_INPUT: dayItemId".into()),
                }
            } else { None };
            let task = s
                .tasks
                .iter_mut()
                .find(|x| x.id == tid)
                .ok_or("NOT_FOUND: task")?;
            check_revision(task.revision, v["expectedRevision"].as_u64(), "任务")?;
            if task.completed {
                return Err("TASK_COMPLETED".into());
            }
            if task.next_action.as_ref().map(|x| &x.id) != Some(&sid) {
                task.next_action = Some(action(&step));
                task.revision += 1;
                task.updated_at = t;
            }
            if operation == "prepare_step" {
                s.planning.prepared = Some(PreparedStep { task_id: tid, step_id: sid, day_item_id: item.as_ref().map(|x| x.id.clone()) });
            }
            Ok(json!({"task":task,"step":step,"item":item,"prepared":s.planning.prepared}))
        }
        "remove_plan_item" => {
            keys(v, &["planItemId", "expectedRevision"])?;
            let iid = uuid(v, "planItemId")?;
            let item = s
                .planning
                .day_items
                .iter_mut()
                .find(|x| x.id == iid)
                .ok_or("NOT_FOUND: daily plan item")?;
            check_revision(item.revision, v["expectedRevision"].as_u64(), "日计划")?;
            if item.removed_at.is_none() {
                item.removed_at = Some(t);
                item.revision += 1;
            }
            Ok(json!({"item":item}))
        }
        "get_daily_record" => {
            keys(v, &["date", "utcOffsetMinutes"])?;
            daily_record(s, &date(v)?, offset(v)?, t)
        }
        "save_daily_summary" => {
            keys(
                v,
                &[
                    "date",
                    "utcOffsetMinutes",
                    "expectedDataVersion",
                    "expectedNotesVersion",
                    "sourceAsOf",
                    "body",
                ],
            )?;
            let date = date(v)?;
            let offset = offset(v)?;
            let record = daily_record(s, &date, offset, t)?;
            let expected = text(v, "expectedDataVersion", 100)?;
            if record["dataVersion"].as_str() != Some(expected.as_str()) {
                return Err("CONFLICT: 当天记录已有更新，请重新读取后生成总结。".into());
            }
            let source_as_of = v["sourceAsOf"]
                .as_i64()
                .filter(|x| *x >= 0 && *x <= t)
                .ok_or("INVALID_INPUT: sourceAsOf must be the read's sampledAt")?;
            let summary = Summary {
                id: id(),
                date,
                body: text(v, "body", 16000)?,
                source_version: expected,
                source_as_of,
                created_at: t,
                source: source.into(),
                utc_offset_minutes: offset,
                source_notes_version: optional(v, "expectedNotesVersion", 100)?,
            };
            s.planning.summaries.push(summary.clone());
            Ok(json!({"summary":summary}))
        }
        _ => Err("UNKNOWN_ACTION".into()),
    }
}

fn adopt(s: &mut PaperState, v: &Value, source: &str, t: i64) -> Result<Value, String> {
    keys(
        v,
        &[
            "batchId",
            "expectedRevision",
            "date",
            "cardIds",
            "cardOverrides",
        ],
    )?;
    let date = date(v)?;
    let bid = uuid(v, "batchId")?;
    let bi = s
        .planning
        .batches
        .iter()
        .position(|x| x.id == bid)
        .ok_or("NOT_FOUND: batch")?;
    let mut batch = s.planning.batches[bi].clone();
    check_revision(batch.revision, v["expectedRevision"].as_u64(), "候选卡片")?;
    let ids = v["cardIds"].as_array().ok_or("INVALID_INPUT: cardIds")?;
    if ids.is_empty() || ids.len() > 30 {
        return Err("INVALID_INPUT: select 1–30 cards".into());
    }
    let selected = ids
        .iter()
        .map(|x| {
            x.as_str()
                .map(str::to_string)
                .ok_or("INVALID_INPUT: cardIds".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut unique = std::collections::HashSet::new();
    if selected.iter().any(|x| !unique.insert(x.clone())) {
        return Err("INVALID_INPUT: duplicate card selection".into());
    }
    let overrides = match v.get("cardOverrides") {
        None => Vec::new(),
        Some(x) => x.as_array().ok_or("INVALID_INPUT: cardOverrides")?.clone(),
    };
    let mut override_ids = std::collections::HashSet::new();
    for patch in &overrides {
        keys(
            patch,
            &[
                "cardId",
                "text",
                "expectedResult",
                "plannedSeconds",
                "expectedTaskRevision",
                "expectedStepRevision",
            ],
        )?;
        let cid = text(patch, "cardId", 100)?;
        if !selected.contains(&cid) || !override_ids.insert(cid) {
            return Err("INVALID_INPUT: overrides must target distinct selected cards".into());
        }
    }
    // Validate all selected targets before applying any part, including shared parent revisions.
    for cid in &selected {
        let card = batch
            .cards
            .iter()
            .find(|x| x.id == *cid)
            .ok_or("NOT_FOUND: card")?;
        let patch = overrides.iter().find(|x| x["cardId"].as_str() == Some(cid));
        if let Some(task) = s.tasks.iter().find(|x| x.id == card.task_id) {
            let expected = patch
                .and_then(|x| x["expectedTaskRevision"].as_u64())
                .or(card.expected_task_revision);
            check_revision(task.revision, expected, "任务")?;
            if task.completed {
                return Err("TASK_COMPLETED".into());
            }
        } else if card.expected_task_revision.is_some() {
            return Err("NOT_FOUND: task".into());
        }
        if let Some(sid) = card.adopted_step_id.as_ref().or(card.step_id.as_ref()) {
            let step = s
                .planning
                .steps
                .iter()
                .find(|x| x.id == *sid && x.task_id == card.task_id)
                .ok_or("NOT_FOUND: step")?;
            let expected = patch
                .and_then(|x| x["expectedStepRevision"].as_u64())
                .or(card.expected_step_revision);
            check_revision(step.revision, expected, "步骤")?;
            if step.completed {
                return Err("ACTION_COMPLETED".into());
            }
        }
    }
    let mut items = Vec::new();
    let mut mappings = Vec::new();
    let mut order = s
        .planning
        .day_items
        .iter()
        .filter(|x| x.date == date && x.removed_at.is_none())
        .map(|x| x.order)
        .max()
        .map(|x| x + 1)
        .unwrap_or(0);
    for cid in &selected {
        let card = batch.cards.iter_mut().find(|x| x.id == *cid).unwrap();
        let patch = overrides.iter().find(|x| x["cardId"].as_str() == Some(cid));
        if let Some(patch) = patch {
            if patch.get("text").is_some() {
                card.text = text(patch, "text", 300)?;
            }
            if patch.get("expectedResult").is_some() {
                card.expected_result = optional(patch, "expectedResult", 2000)?;
            }
            card.planned_seconds = duration(patch, card.planned_seconds)?;
        }
        if !s.tasks.iter().any(|x| x.id == card.task_id) {
            s.tasks.push(Task {
                id: card.task_id.clone(),
                title: card
                    .task_title
                    .clone()
                    .ok_or("INVALID_INPUT: new task requires taskTitle")?,
                due: None,
                due_date: None,
                category: "work".into(),
                priority: "medium".into(),
                completed: false,
                next_action: None,
                revision: 1,
                source: source.into(),
                created_at: t,
                updated_at: t,
                completed_at: None,
            });
        }
        let old_step = card
            .adopted_step_id
            .as_ref()
            .or(card.step_id.as_ref())
            .and_then(|sid| s.planning.steps.iter().find(|x| x.id == *sid))
            .cloned();
        let step = if let Some(old) = old_step.filter(|x| x.text == card.text) {
            let step = s
                .planning
                .steps
                .iter_mut()
                .find(|x| x.id == old.id)
                .unwrap();
            if step.expected_result != card.expected_result
                || step.planned_seconds != card.planned_seconds
            {
                step.expected_result = card.expected_result.clone();
                step.planned_seconds = card.planned_seconds;
                step.revision += 1;
                step.updated_at = t;
            }
            step.clone()
        } else {
            let step = Step {
                id: id(),
                task_id: card.task_id.clone(),
                text: card.text.clone(),
                expected_result: card.expected_result.clone(),
                planned_seconds: card.planned_seconds,
                completed: false,
                revision: 1,
                source: source.into(),
                created_at: t,
                updated_at: t,
            };
            s.planning.steps.push(step.clone());
            step
        };
        card.adopted_step_id = Some(step.id.clone());
        let task = s.tasks.iter_mut().find(|x| x.id == card.task_id).unwrap();
        if task.next_action.is_none() {
            task.next_action = Some(action(&step));
            task.updated_at = t;
            task.revision += 1;
        }
        let existing = s
            .planning
            .day_items
            .iter_mut()
            .find(|x| x.date == date && x.step_id == step.id);
        let item = if let Some(item) = existing {
            if item.removed_at.is_some() {
                item.removed_at = None;
                item.order = order;
                item.revision += 1;
                order += 1;
            }
            item.clone()
        } else {
            let item = DayItem {
                id: id(),
                date: date.clone(),
                task_id: card.task_id.clone(),
                step_id: step.id.clone(),
                order,
                revision: 1,
                removed_at: None,
                start_minute: None,
                duration_minutes: None,
                ..DayItem::default()
            };
            order += 1;
            s.planning.day_items.push(item.clone());
            item
        };
        mappings.push(
            json!({"cardId":cid,"taskId":card.task_id,"stepId":step.id,"planItemId":item.id}),
        );
        items.push(item);
    }
    // Account for this transaction's own shared-parent updates while preserving untouched stale candidates.
    for card in &mut batch.cards {
        if selected.contains(&card.id) {
            card.expected_task_revision = s
                .tasks
                .iter()
                .find(|x| x.id == card.task_id)
                .map(|x| x.revision);
            card.expected_step_revision = s
                .planning
                .steps
                .iter()
                .find(|x| Some(&x.id) == card.adopted_step_id.as_ref())
                .map(|x| x.revision);
        }
    }
    batch.revision += 1;
    s.planning.batches[bi] = batch.clone();
    Ok(json!({"batch":batch,"items":items,"mappings":mappings}))
}
