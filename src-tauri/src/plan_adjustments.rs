//! Versioned, user-adopted plan changes. Proposal previews never mutate the plan.
use crate::paper::{PaperState, Task};
use crate::paper_planning::{DayItem, Step};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[cfg(test)]
#[path = "plan_adjustments_tests.rs"]
mod tests;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub id: String,
    pub revision: u64,
    pub groups: Vec<Group>,
    pub created_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub reason: String,
    pub actions: Vec<Value>,
    pub before: Value,
    pub after: Value,
    pub adopted_at: Option<i64>,
    guards: Guards,
    generated_ids: Vec<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Guards {
    tasks: BTreeMap<String, u64>,
    steps: BTreeMap<String, u64>,
    day_items: BTreeMap<String, u64>,
    // Full date membership prevents a preview from overlooking new/reordered plans.
    dates: BTreeMap<String, Vec<(String, u64)>>,
    absent_steps: BTreeSet<String>,
}

fn keys(v: &Value, allowed: &[&str]) -> Result<(), String> {
    for k in v
        .as_object()
        .ok_or("INVALID_INPUT: object required")?
        .keys()
    {
        if !allowed.contains(&k.as_str()) {
            return Err(format!("INVALID_INPUT: unknown field {k}"));
        }
    }
    Ok(())
}
fn text(v: &Value, key: &str, max: usize) -> Result<String, String> {
    let s = v[key]
        .as_str()
        .ok_or_else(|| format!("INVALID_INPUT: {key}"))?
        .trim();
    if s.is_empty() || s.chars().count() > max {
        return Err(format!("INVALID_INPUT: {key}"));
    }
    Ok(s.to_owned())
}
fn id(v: &Value, key: &str) -> Result<String, String> {
    let id = text(v, key, 100)?;
    uuid::Uuid::parse_str(&id).map_err(|_| format!("INVALID_INPUT: UUID {key}"))?;
    Ok(id)
}
fn date(v: &Value, key: &str, nullable: bool) -> Result<Option<String>, String> {
    if nullable && v[key].is_null() {
        return Ok(None);
    }
    let d = text(v, key, 10)?;
    let parsed =
        chrono::NaiveDate::parse_from_str(&d, "%Y-%m-%d").map_err(|_| "INVALID_INPUT: date")?;
    if parsed.format("%Y-%m-%d").to_string() != d {
        return Err("INVALID_INPUT: date".into());
    }
    Ok(Some(d))
}
fn rev(v: &Value, key: &str, actual: u64) -> Result<(), String> {
    if v[key].as_u64() != Some(actual) {
        return Err(format!("CONFLICT: {key} 已变化，请核对最新内容。"));
    }
    Ok(())
}
fn time(v: &Value) -> Result<(Option<u32>, Option<u32>), String> {
    let minutes = |key: &str, min: u64, max: u64| -> Result<Option<u32>, String> {
        if v[key].is_null() {
            return Ok(None);
        }
        let n = v[key]
            .as_u64()
            .filter(|n| (min..=max).contains(n))
            .ok_or_else(|| format!("INVALID_INPUT: {key}"))?;
        Ok(Some(n as u32))
    };
    let start = minutes("startMinute", 0, 1439)?;
    let duration = minutes("durationMinutes", 1, 1440)?;
    if let Some(start) = start {
        if duration.is_none_or(|duration| start + duration > 1440) {
            return Err("INVALID_INPUT: 日程需在同一天内且包含时长。".into());
        }
    }
    Ok((start, duration))
}
fn schedule_for(item: &DayItem, action: &Value) -> Result<(Option<u32>, Option<u32>), String> {
    let mut input =
        json!({"startMinute":item.start_minute,"durationMinutes":item.duration_minutes});
    for key in ["startMinute", "durationMinutes"] {
        if let Some(value) = action.get(key) {
            input[key] = value.clone();
        }
    }
    if action.get("durationMinutes").is_some_and(Value::is_null)
        && action.get("startMinute").is_none()
    {
        input["startMinute"] = Value::Null;
    }
    time(&input)
}
fn pair<'a>(s: &'a PaperState, a: &Value) -> Result<(&'a Task, &'a Step), String> {
    let tid = id(a, "taskId")?;
    let sid = id(a, "stepId")?;
    let task = s
        .tasks
        .iter()
        .find(|t| t.id == tid)
        .ok_or("NOT_FOUND: task")?;
    let step = s
        .planning
        .steps
        .iter()
        .find(|x| x.id == sid && x.task_id == tid)
        .ok_or("CONFLICT: 步骤与任务已不一致。")?;
    Ok((task, step))
}
fn item<'a>(s: &'a PaperState, iid: &str) -> Result<&'a DayItem, String> {
    s.planning
        .day_items
        .iter()
        .find(|x| x.id == iid && x.removed_at.is_none())
        .ok_or_else(|| "CONFLICT: 安排已不存在或取消。".into())
}
fn members(s: &PaperState, date: &str) -> Vec<(String, u64)> {
    let mut out: Vec<_> = s
        .planning
        .day_items
        .iter()
        .filter(|x| x.date == date && x.removed_at.is_none())
        .map(|x| (x.id.clone(), x.revision))
        .collect();
    out.sort();
    out
}
fn inspected_items(v: &Value) -> Result<Vec<(String, u64)>, String> {
    let items = v["items"]
        .as_array()
        .filter(|x| !x.is_empty() && x.len() <= 366)
        .ok_or("INVALID_INPUT: items")?;
    let mut seen = BTreeSet::new();
    items
        .iter()
        .map(|x| {
            keys(x, &["id", "revision"])?;
            let iid = id(x, "id")?;
            let revision = x["revision"]
                .as_u64()
                .filter(|r| *r > 0)
                .ok_or("INVALID_INPUT: revision")?;
            if !seen.insert(iid.clone()) {
                return Err("INVALID_INPUT: duplicate item".into());
            }
            Ok((iid, revision))
        })
        .collect()
}
fn guard_date(s: &PaperState, guards: &mut Guards, date: &str) {
    guards.dates.insert(date.to_owned(), members(s, date));
}
fn guard_item(s: &PaperState, guards: &mut Guards, item: &DayItem) -> Result<(), String> {
    let task = s
        .tasks
        .iter()
        .find(|t| t.id == item.task_id)
        .ok_or("CONFLICT: task")?;
    let step = s
        .planning
        .steps
        .iter()
        .find(|x| x.id == item.step_id && x.task_id == item.task_id)
        .ok_or("CONFLICT: step")?;
    guards.tasks.insert(task.id.clone(), task.revision);
    guards.steps.insert(step.id.clone(), step.revision);
    guards.day_items.insert(item.id.clone(), item.revision);
    Ok(())
}

// Every action is inspected against the same original state, before any action applies.
fn inspect(s: &PaperState, a: &Value, guards: &mut Guards) -> Result<(), String> {
    let kind = a["kind"].as_str().ok_or("INVALID_INPUT: kind")?;
    let common = [
        "kind",
        "taskId",
        "stepId",
        "expectedTaskRevision",
        "expectedStepRevision",
    ];
    let mut allowed = common.to_vec();
    allowed.extend(match kind {
        "continue" => vec!["items", "date"],
        "reschedule" => vec![
            "itemId",
            "expectedItemRevision",
            "date",
            "startMinute",
            "durationMinutes",
        ],
        "reservation" => vec!["itemId", "expectedItemRevision", "durationMinutes"],
        "narrow" => vec![
            "newStepId",
            "text",
            "expectedResult",
            "plannedSeconds",
            "date",
        ],
        "reorder" => vec!["date", "items"],
        _ => return Err("INVALID_INPUT: adjustment kind".into()),
    });
    if kind == "reorder" {
        allowed = vec!["kind", "date", "items"];
    }
    keys(a, &allowed)?;
    if kind == "reorder" {
        let d = date(a, "date", false)?.unwrap();
        let mut expected = inspected_items(a)?;
        expected.sort();
        if expected != members(s, &d) {
            return Err("CONFLICT: 这一天的完整安排或版本已变化。".into());
        }
        for (iid, _) in expected {
            guard_item(s, guards, item(s, &iid)?)?;
        }
        guard_date(s, guards, &d);
        return Ok(());
    }
    let (task, step) = pair(s, a)?;
    rev(a, "expectedTaskRevision", task.revision)?;
    rev(a, "expectedStepRevision", step.revision)?;
    if task.completed || step.completed {
        return Err("TASK_COMPLETED: 任务或步骤已完成，请核对最新状态。".into());
    }
    guards.tasks.insert(task.id.clone(), task.revision);
    guards.steps.insert(step.id.clone(), step.revision);
    match kind {
        "continue" => {
            let d = date(a, "date", false)?.unwrap();
            for (iid, revision) in inspected_items(a)? {
                let target = item(s, &iid)?;
                if target.task_id != task.id
                    || target.step_id != step.id
                    || target.revision != revision
                    || target.date >= d
                    || target.resolved_at.is_some()
                {
                    return Err("CONFLICT: 只能继续目标日之前尚未处理的所选安排。".into());
                }
                guard_item(s, guards, target)?;
            }
            guard_date(s, guards, &d);
        }
        "reschedule" | "reservation" => {
            let iid = id(a, "itemId")?;
            let target = item(s, &iid)?;
            if target.task_id != task.id || target.step_id != step.id {
                return Err("CONFLICT: 安排不属于所选步骤。".into());
            }
            rev(a, "expectedItemRevision", target.revision)?;
            guard_item(s, guards, target)?;
            guard_date(s, guards, &target.date);
            if kind == "reschedule" {
                let d = date(a, "date", false)?.unwrap();
                schedule_for(target, a)?;
                guard_date(s, guards, &d);
                if s.planning.day_items.iter().any(|x| {
                    x.id != iid && x.step_id == step.id && x.date == d && x.removed_at.is_none()
                }) {
                    return Err("CONFLICT: 目标日已有这一步的安排。".into());
                }
            } else {
                if a.get("durationMinutes").is_none() {
                    return Err(
                        "INVALID_INPUT: durationMinutes required (null cancels reservation)".into(),
                    );
                }
                let duration = time(&json!({"durationMinutes":a["durationMinutes"]}))?.1;
                if duration.is_some_and(|duration| {
                    target
                        .start_minute
                        .is_some_and(|start| start + duration > 1440)
                }) {
                    return Err("INVALID_INPUT: 预留时长超出当天。".into());
                }
            }
        }
        "narrow" => {
            let sid = id(a, "newStepId")?;
            if s.planning.steps.iter().any(|step| step.id == sid) {
                return Err("CONFLICT: 新步骤标识已存在。".into());
            }
            text(a, "text", 300)?;
            crate::paper::optional(a, "expectedResult", 2000)?;
            if !a["plannedSeconds"]
                .as_u64()
                .is_some_and(|n| (60..=7200).contains(&n))
            {
                return Err("INVALID_INPUT: plannedSeconds must be 60–7200".into());
            }
            if let Some(d) = date(a, "date", true)? {
                guard_date(s, guards, &d);
            }
            guards.absent_steps.insert(sid);
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn validate(s: &PaperState, guards: &Guards, active: bool) -> Result<(), String> {
    if guards
        .tasks
        .iter()
        .any(|(id, rev)| !s.tasks.iter().any(|x| x.id == *id && x.revision == *rev))
        || guards.steps.iter().any(|(id, rev)| {
            !s.planning
                .steps
                .iter()
                .any(|x| x.id == *id && x.revision == *rev)
        })
        || guards.day_items.iter().any(|(id, rev)| {
            !s.planning
                .day_items
                .iter()
                .any(|x| x.id == *id && x.revision == *rev && x.removed_at.is_none())
        })
        || guards
            .dates
            .iter()
            .any(|(date, expected)| members(s, date) != *expected)
        || guards
            .absent_steps
            .iter()
            .any(|id| s.planning.steps.iter().any(|x| x.id == *id))
    {
        return Err("CONFLICT: 调整依据已变化，请保留草稿并重新核对。".into());
    }
    if active
        && s.sessions.iter().any(|session| {
            session.kind == "focus"
                && session.status != "finished"
                && session
                    .task_id
                    .as_ref()
                    .is_some_and(|id| guards.tasks.contains_key(id))
        })
    {
        return Err("ACTIVE_SESSION: 受影响任务仍有未保存的会话，请先保存本轮。".into());
    }
    Ok(())
}
fn next_order(s: &PaperState, date: &str) -> u64 {
    s.planning
        .day_items
        .iter()
        .filter(|x| x.date == date)
        .map(|x| x.order)
        .max()
        .map_or(0, |n| n + 1)
}
fn new_item(
    s: &mut PaperState,
    iid: &str,
    task: &str,
    step: &str,
    date: &str,
) -> Result<DayItem, String> {
    if s.planning.day_items.iter().any(|x| x.id == iid) {
        return Err("CONFLICT: 新安排标识已存在。".into());
    }
    let item = DayItem {
        id: iid.into(),
        task_id: task.into(),
        step_id: step.into(),
        date: date.into(),
        revision: 1,
        order: next_order(s, date),
        ..DayItem::default()
    };
    s.planning.day_items.push(item.clone());
    Ok(item)
}

// Version checks have already run once against the initial state. Structural
// invariants are checked again here so incompatible selected actions fail atomically.
fn apply(s: &mut PaperState, a: &Value, generated: &str, now: i64) -> Result<(), String> {
    let kind = a["kind"].as_str().unwrap();
    if kind == "reorder" {
        let d = a["date"].as_str().unwrap();
        let items = inspected_items(a)?;
        let wanted: BTreeSet<_> = items.iter().map(|x| x.0.as_str()).collect();
        let current: BTreeSet<_> = s
            .planning
            .day_items
            .iter()
            .filter(|x| x.date == d && x.removed_at.is_none())
            .map(|x| x.id.as_str())
            .collect();
        if wanted != current {
            return Err(
                "CONFLICT: 排序依赖的日期范围已变化，请将依赖动作放在同一组并重新提案。".into(),
            );
        }
        for (order, (iid, _)) in items.iter().enumerate() {
            let item = s
                .planning
                .day_items
                .iter_mut()
                .find(|x| x.id == *iid)
                .unwrap();
            if item.order != order as u64 {
                item.order = order as u64;
                item.revision += 1;
            }
        }
        return Ok(());
    }
    let (task, step) = pair(s, a)?;
    let (tid, sid) = (task.id.clone(), step.id.clone());
    if task.completed || step.completed {
        return Err("TASK_COMPLETED: 任务或步骤已完成。".into());
    }
    match kind {
        "continue" => {
            let d = a["date"].as_str().unwrap();
            let targets = inspected_items(a)?;
            for (iid, _) in &targets {
                let i = item(s, iid)?;
                if i.task_id != tid
                    || i.step_id != sid
                    || i.date.as_str() >= d
                    || i.resolved_at.is_some()
                {
                    return Err("CONFLICT: 继续安排的来源已变化。".into());
                }
            }
            let target = match s.planning.day_items.iter().find(|x| {
                x.task_id == tid && x.step_id == sid && x.date == d && x.removed_at.is_none()
            }) {
                Some(item) => item.clone(),
                None => new_item(s, generated, &tid, &sid, d)?,
            };
            for (iid, _) in targets {
                let i = s
                    .planning
                    .day_items
                    .iter_mut()
                    .find(|x| x.id == iid)
                    .unwrap();
                i.resolved_at = Some(now);
                i.resolution = Some("continued".into());
                i.continued_to = Some(target.id.clone());
                i.revision += 1;
            }
        }
        "reschedule" | "reservation" => {
            let iid = a["itemId"].as_str().unwrap();
            let target = item(s, iid)?.clone();
            if target.task_id != tid || target.step_id != sid {
                return Err("CONFLICT: 安排所属步骤已变化。".into());
            }
            if kind == "reschedule" {
                let d = a["date"].as_str().unwrap();
                if s.planning.day_items.iter().any(|x| {
                    x.id != iid && x.step_id == sid && x.date == d && x.removed_at.is_none()
                }) {
                    return Err("CONFLICT: 目标日已有这一步的安排。".into());
                }
                let order = next_order(s, d);
                let (start, duration) = schedule_for(&target, a)?;
                let i = s
                    .planning
                    .day_items
                    .iter_mut()
                    .find(|x| x.id == iid)
                    .unwrap();
                if i.date != d {
                    i.date = d.into();
                    i.order = order;
                    i.resolved_at = None;
                    i.resolution = None;
                    i.continued_to = None;
                }
                i.start_minute = start;
                i.duration_minutes = duration;
                i.revision += 1;
            } else {
                let duration = time(&json!({"durationMinutes":a["durationMinutes"]}))?.1;
                if duration
                    .is_some_and(|n| target.start_minute.is_some_and(|start| start + n > 1440))
                {
                    return Err("INVALID_INPUT: 预留时长超出当天。".into());
                }
                let i = s
                    .planning
                    .day_items
                    .iter_mut()
                    .find(|x| x.id == iid)
                    .unwrap();
                i.duration_minutes = duration;
                if duration.is_none() {
                    i.start_minute = None;
                }
                i.revision += 1;
            }
        }
        "narrow" => {
            let new_sid = a["newStepId"].as_str().unwrap();
            if s.planning.steps.iter().any(|x| x.id == new_sid) {
                return Err("CONFLICT: 新步骤标识已存在。".into());
            }
            s.planning.steps.push(Step {
                id: new_sid.into(),
                task_id: tid.clone(),
                text: text(a, "text", 300)?,
                expected_result: crate::paper::optional(a, "expectedResult", 2000)?,
                planned_seconds: a["plannedSeconds"].as_u64().unwrap(),
                completed: false,
                revision: 1,
                source: "user".into(),
                created_at: now,
                updated_at: now,
            });
            let task = s.tasks.iter_mut().find(|x| x.id == tid).unwrap();
            task.revision += 1;
            task.updated_at = now;
            if let Some(d) = a["date"].as_str() {
                new_item(s, generated, &tid, new_sid, d)?;
            }
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn diff(before: &PaperState, after: &PaperState, guards: &Guards) -> (Value, Value) {
    fn changed<T: Serialize>(before: &[T], after: &[T]) -> (Vec<Value>, Vec<Value>) {
        let b: BTreeMap<String, Value> = before
            .iter()
            .map(|x| {
                let v = serde_json::to_value(x).unwrap();
                (v["id"].as_str().unwrap().into(), v)
            })
            .collect();
        let a: BTreeMap<String, Value> = after
            .iter()
            .map(|x| {
                let v = serde_json::to_value(x).unwrap();
                (v["id"].as_str().unwrap().into(), v)
            })
            .collect();
        let ids: BTreeSet<_> = b
            .keys()
            .chain(a.keys())
            .filter(|id| b.get(*id) != a.get(*id))
            .collect();
        (
            ids.iter().filter_map(|id| b.get(*id).cloned()).collect(),
            ids.iter().filter_map(|id| a.get(*id).cloned()).collect(),
        )
    }
    let (mut bt, mut at) = changed(&before.tasks, &after.tasks);
    let (mut bs, mut ast) = changed(&before.planning.steps, &after.planning.steps);
    // Unchanged parent/step context keeps previews readable without trusting a model title.
    for id in guards.tasks.keys() {
        if !bt.iter().any(|x| x["id"] == *id) {
            if let Some(t) = before.tasks.iter().find(|t| t.id == *id) {
                bt.push(json!(t));
            }
        }
        if !at.iter().any(|x| x["id"] == *id) {
            if let Some(t) = after.tasks.iter().find(|t| t.id == *id) {
                at.push(json!(t));
            }
        }
    }
    for id in guards.steps.keys() {
        if !bs.iter().any(|x| x["id"] == *id) {
            if let Some(t) = before.planning.steps.iter().find(|t| t.id == *id) {
                bs.push(json!(t));
            }
        }
        if !ast.iter().any(|x| x["id"] == *id) {
            if let Some(t) = after.planning.steps.iter().find(|t| t.id == *id) {
                ast.push(json!(t));
            }
        }
    }
    let (mut bi, mut ai) = changed(&before.planning.day_items, &after.planning.day_items);
    let context_ids: BTreeSet<_> = guards
        .day_items
        .keys()
        .cloned()
        .chain(
            before
                .planning
                .day_items
                .iter()
                .chain(&after.planning.day_items)
                .filter(|i| guards.dates.contains_key(&i.date) && i.removed_at.is_none())
                .map(|i| i.id.clone()),
        )
        .collect();
    for id in context_ids {
        if !bi.iter().any(|x| x["id"] == id) {
            if let Some(i) = before.planning.day_items.iter().find(|i| i.id == id) {
                bi.push(json!(i));
            }
        }
        if !ai.iter().any(|x| x["id"] == id) {
            if let Some(i) = after.planning.day_items.iter().find(|i| i.id == id) {
                ai.push(json!(i));
            }
        }
    }
    for (items, state, tasks, steps) in [
        (&bi, before, &mut bt, &mut bs),
        (&ai, after, &mut at, &mut ast),
    ] {
        for item in items {
            if let Some(t) = state
                .tasks
                .iter()
                .find(|t| Some(t.id.as_str()) == item["taskId"].as_str())
            {
                if !tasks.iter().any(|x| x["id"] == t.id) {
                    tasks.push(json!(t));
                }
            }
            if let Some(step) = state
                .planning
                .steps
                .iter()
                .find(|step| Some(step.id.as_str()) == item["stepId"].as_str())
            {
                if !steps.iter().any(|x| x["id"] == step.id) {
                    steps.push(json!(step));
                }
            }
        }
    }
    (
        json!({"tasks":bt,"steps":bs,"dayItems":bi}),
        json!({"tasks":at,"steps":ast,"dayItems":ai}),
    )
}
fn group(
    s: &PaperState,
    v: &Value,
    generated: Option<Vec<String>>,
    now: i64,
) -> Result<Group, String> {
    keys(v, &["id", "reason", "actions"])?;
    let gid = id(v, "id")?;
    let reason = text(v, "reason", 2000)?;
    let actions = v["actions"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 20)
        .ok_or("INVALID_INPUT: actions must contain 1–20 entries")?
        .clone();
    let generated_ids = generated
        .filter(|ids| ids.len() == actions.len())
        .unwrap_or_else(|| {
            actions
                .iter()
                .map(|_| uuid::Uuid::new_v4().to_string())
                .collect()
        });
    let mut guards = Guards::default();
    for a in &actions {
        inspect(s, a, &mut guards)?;
    }
    let mut preview = s.clone();
    for (a, id) in actions.iter().zip(&generated_ids) {
        apply(&mut preview, a, id, now)?;
    }
    let (before, after) = diff(s, &preview, &guards);
    Ok(Group {
        id: gid,
        reason,
        actions,
        before,
        after,
        adopted_at: None,
        guards,
        generated_ids,
    })
}
fn groups(v: &Value) -> Result<&Vec<Value>, String> {
    let groups = v["groups"]
        .as_array()
        .filter(|x| !x.is_empty() && x.len() <= 20)
        .ok_or("INVALID_INPUT: groups must contain 1–20 entries")?;
    let mut ids = BTreeSet::new();
    for g in groups {
        if !ids.insert(id(g, "id")?) {
            return Err("INVALID_INPUT: duplicate group".into());
        }
    }
    Ok(groups)
}
fn unique_new_steps(groups: &[Group]) -> Result<(), String> {
    let mut created = BTreeSet::new();
    for g in groups {
        for a in &g.actions {
            if a["kind"] == "narrow" && !created.insert(a["newStepId"].as_str().unwrap()) {
                return Err("INVALID_INPUT: duplicate newStepId".into());
            }
        }
    }
    Ok(())
}
fn independent_groups(s: &PaperState, groups: &[Group]) -> Result<(), String> {
    let mut footprints: Vec<(BTreeSet<String>, BTreeSet<String>, BTreeSet<String>)> = Vec::new();
    for group in groups.iter().filter(|g| g.adopted_at.is_none()) {
        let (mut writes, mut reorder_dates, mut membership_dates) =
            (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
        for a in &group.actions {
            match a["kind"].as_str().unwrap() {
                "reschedule" => {
                    let iid = a["itemId"].as_str().unwrap();
                    writes.insert(iid.to_owned());
                    let target = item(s, iid)?;
                    let date = a["date"].as_str().unwrap();
                    if target.date != date {
                        membership_dates.insert(target.date.clone());
                        membership_dates.insert(date.to_owned());
                    }
                }
                "reservation" => {
                    writes.insert(a["itemId"].as_str().unwrap().to_owned());
                }
                "continue" => {
                    writes.extend(inspected_items(a)?.into_iter().map(|x| x.0));
                    membership_dates.insert(a["date"].as_str().unwrap().to_owned());
                }
                "reorder" => {
                    writes.extend(inspected_items(a)?.into_iter().map(|x| x.0));
                    reorder_dates.insert(a["date"].as_str().unwrap().to_owned());
                }
                "narrow" => {
                    if let Some(date) = a["date"].as_str() {
                        membership_dates.insert(date.to_owned());
                    }
                }
                _ => unreachable!(),
            }
        }
        for (old_writes, old_reorder, old_membership) in &footprints {
            if !writes.is_disjoint(old_writes)
                || !reorder_dates.is_disjoint(old_reorder)
                || !reorder_dates.is_disjoint(old_membership)
                || !membership_dates.is_disjoint(old_reorder)
            {
                return Err(
                    "INVALID_INPUT: 不同调整组有共同写入或排序依赖，请合并到同一组。".into(),
                );
            }
        }
        footprints.push((writes, reorder_dates, membership_dates));
    }
    Ok(())
}
fn refresh_versions(s: &PaperState, a: &mut Value) {
    if let Some(t) = s
        .tasks
        .iter()
        .find(|t| Some(t.id.as_str()) == a["taskId"].as_str())
    {
        a["expectedTaskRevision"] = json!(t.revision);
    }
    if let Some(step) = s
        .planning
        .steps
        .iter()
        .find(|step| Some(step.id.as_str()) == a["stepId"].as_str())
    {
        a["expectedStepRevision"] = json!(step.revision);
    }
    if let Some(i) = s
        .planning
        .day_items
        .iter()
        .find(|i| Some(i.id.as_str()) == a["itemId"].as_str())
    {
        a["expectedItemRevision"] = json!(i.revision);
    }
    if let Some(items) = a.get_mut("items").and_then(Value::as_array_mut) {
        for item in items {
            if let Some(i) = s
                .planning
                .day_items
                .iter()
                .find(|i| Some(i.id.as_str()) == item["id"].as_str())
            {
                item["revision"] = json!(i.revision);
            }
        }
    }
}

pub(crate) fn execute(
    s: &mut PaperState,
    op: &str,
    v: &Value,
    source: &str,
    now: i64,
) -> Result<Value, String> {
    // Keep direct module callers atomic too. paper_execute persists this only after success.
    let mut next = s.clone();
    let result = execute_inner(&mut next, op, v, source, now)?;
    *s = next;
    Ok(result)
}
fn execute_inner(
    s: &mut PaperState,
    op: &str,
    v: &Value,
    source: &str,
    now: i64,
) -> Result<Value, String> {
    let allowed = match op {
        "propose_plan_adjustment" => vec!["batchId", "groups", "requestId"],
        "get_plan_adjustment" => vec!["batchId"],
        "revise_plan_adjustment" => vec!["batchId", "expectedRevision", "groups", "requestId"],
        "adopt_plan_adjustment" => vec!["batchId", "expectedRevision", "groupIds", "requestId"],
        _ => return Err("INVALID_INPUT: adjustment operation".into()),
    };
    keys(v, &allowed)?;
    if matches!(op, "revise_plan_adjustment" | "adopt_plan_adjustment") && source != "user" {
        return Err("FORBIDDEN: 采用和修改候选只能由本地用户操作。".into());
    }
    let bid = id(v, "batchId")?;
    if op == "propose_plan_adjustment" {
        if s.planning.adjustments.iter().any(|b| b.id == bid) {
            return Err("CONFLICT: 调整批次已存在。".into());
        }
        let groups = groups(v)?
            .iter()
            .map(|g| group(s, g, None, now))
            .collect::<Result<Vec<_>, _>>()?;
        // Distinct groups cannot create the same step; same-parent groups remain valid.
        unique_new_steps(&groups)?;
        independent_groups(s, &groups)?;
        let batch = Batch {
            id: bid,
            revision: 1,
            groups,
            created_at: now,
        };
        s.planning.adjustments.push(batch.clone());
        return Ok(json!({"batch":batch}));
    }
    let index = s
        .planning
        .adjustments
        .iter()
        .position(|b| b.id == bid)
        .ok_or("NOT_FOUND: adjustment batch")?;
    let mut batch = s.planning.adjustments[index].clone();
    if op == "get_plan_adjustment" {
        return Ok(json!({"batch":batch}));
    }
    rev(v, "expectedRevision", batch.revision)?;
    if op == "revise_plan_adjustment" {
        for input in groups(v)? {
            let gid = id(input, "id")?;
            let index = batch
                .groups
                .iter()
                .position(|g| g.id == gid)
                .ok_or("NOT_FOUND: adjustment group")?;
            let existing = &batch.groups[index];
            if existing.adopted_at.is_some() {
                return Err("CONFLICT: 已采用的组不能修改。".into());
            }
            validate(s, &existing.guards, false)?;
            batch.groups[index] = group(s, input, Some(existing.generated_ids.clone()), now)?;
        }
        independent_groups(s, &batch.groups)?;
    } else {
        let ids = v["groupIds"]
            .as_array()
            .filter(|ids| !ids.is_empty() && ids.len() <= 20)
            .ok_or("INVALID_INPUT: groupIds")?;
        let mut selected = BTreeSet::new();
        for gid in ids {
            let gid = gid.as_str().ok_or("INVALID_INPUT: groupId")?;
            if !selected.insert(gid.to_owned()) {
                return Err("INVALID_INPUT: duplicate groupId".into());
            }
            let g = batch
                .groups
                .iter()
                .find(|g| g.id == gid)
                .ok_or("NOT_FOUND: adjustment group")?;
            if g.adopted_at.is_some() {
                return Err("CONFLICT: 这一组已采用，请刷新候选。".into());
            }
            validate(s, &g.guards, true)?;
        }
        let initial = s.clone();
        for g in batch.groups.iter_mut().filter(|g| selected.contains(&g.id)) {
            let before = s.clone();
            for (a, id) in g.actions.iter().zip(&g.generated_ids) {
                apply(s, a, id, now)?;
            }
            (g.before, g.after) = diff(&before, s, &g.guards);
            g.adopted_at = Some(now);
        }
        for g in batch.groups.iter_mut().filter(|g| g.adopted_at.is_none()) {
            // A stale external change never becomes accepted just because another
            // group was adopted. Only clean guards may follow this batch's own writes.
            if validate(&initial, &g.guards, false).is_err() {
                continue;
            }
            let mut actions = g.actions.clone();
            for a in &mut actions {
                refresh_versions(s, a);
            }
            if let Ok(fresh) = group(
                s,
                &json!({"id":g.id,"reason":g.reason,"actions":actions}),
                Some(g.generated_ids.clone()),
                now,
            ) {
                *g = fresh;
            }
        }
    }
    unique_new_steps(&batch.groups)?;
    batch.revision += 1;
    s.planning.adjustments[index] = batch.clone();
    Ok(json!({"batch":batch}))
}
