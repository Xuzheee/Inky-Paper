//! Explicit, date-scoped planning constraints. Estimates are never inferred from timers.
use crate::paper::PaperState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[cfg(test)]
#[path = "planning_context_tests.rs"]
mod tests;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContextState {
    pub days: Vec<DayConstraint>,
    pub projects: Vec<Project>,
    pub preferences: Vec<Preference>,
    pub preferences_revision: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preference {
    pub id: String,
    pub text: String,
    pub scope: String,
    pub date: Option<String>,
    pub project_id: Option<String>,
    pub enabled: bool,
    pub revision: u64,
    pub confirmed_at: i64,
    pub updated_at: i64,
    pub source: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub criteria: String,
    pub reference_links: Vec<String>,
    pub archived: bool,
    pub revision: u64,
    pub updated_at: i64,
    pub source: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayConstraint {
    pub date: String,
    pub revision: u64,
    pub available_minutes: Option<u32>,
    pub unavailable: Vec<UnavailableInterval>,
    pub updated_at: i64,
    pub source: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableInterval {
    pub start_minute: u32,
    pub end_minute: u32,
}

fn date(value: &str) -> Result<(), String> {
    let parsed = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "INVALID_INPUT: date must be YYYY-MM-DD")?;
    if parsed.format("%Y-%m-%d").to_string() != value {
        return Err("INVALID_INPUT: date must be YYYY-MM-DD".into());
    }
    Ok(())
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

fn union(mut intervals: Vec<(u32, u32)>) -> Vec<(u32, u32)> {
    intervals.sort_unstable();
    let mut merged: Vec<(u32, u32)> = Vec::new();
    for (start, end) in intervals {
        if let Some(last) = merged.last_mut().filter(|last| start <= last.1) {
            last.1 = last.1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    merged
}

fn constraint<'a>(s: &'a PaperState, date: &str) -> Result<Option<&'a DayConstraint>, String> {
    let mut matching = s
        .planning
        .context
        .days
        .iter()
        .filter(|day| day.date == date);
    let result = matching.next();
    if matching.next().is_some() {
        return Err("INVALID_STATE: duplicate day constraints".into());
    }
    Ok(result)
}

/// Only explicit reservations count as estimated effort; fixed-time intervals are a separate union.
pub fn day_capacity(s: &PaperState, for_date: &str) -> Result<Value, String> {
    date(for_date)?;
    let constraints = constraint(s, for_date)?;
    let available = constraints.and_then(|day| day.available_minutes);
    if available.is_some_and(|minutes| minutes > 1440) {
        return Err("INVALID_STATE: day available minutes".into());
    }
    let unavailable = match constraints {
        Some(day) => {
            if day
                .unavailable
                .iter()
                .any(|range| range.start_minute >= range.end_minute || range.end_minute > 1440)
            {
                return Err("INVALID_STATE: unavailable interval".into());
            }
            union(
                day.unavailable
                    .iter()
                    .map(|range| (range.start_minute, range.end_minute))
                    .collect(),
            )
        }
        None => Vec::new(),
    };
    let tasks: HashMap<_, _> = s
        .tasks
        .iter()
        .map(|task| (task.id.as_str(), task))
        .collect();
    let steps: HashMap<_, _> = s
        .planning
        .steps
        .iter()
        .map(|step| (step.id.as_str(), step))
        .collect();
    let mut reserved = 0_u64;
    let mut unestimated = 0_usize;
    let mut timed: Vec<(&str, u32, u32)> = Vec::new();
    for item in s
        .planning
        .day_items
        .iter()
        .filter(|item| item.date == for_date && item.removed_at.is_none())
    {
        let Some(task) = tasks
            .get(item.task_id.as_str())
            .filter(|task| !task.completed)
        else {
            continue;
        };
        let Some(_) = steps
            .get(item.step_id.as_str())
            .filter(|step| step.task_id == task.id && !step.completed)
        else {
            continue;
        };
        match item.duration_minutes {
            Some(minutes) => {
                if minutes == 0 || minutes > 1440 {
                    return Err("INVALID_STATE: reservation minutes".into());
                }
                reserved += u64::from(minutes);
                if let Some(start) = item.start_minute {
                    let end = start
                        .checked_add(minutes)
                        .filter(|end| *end <= 1440)
                        .ok_or("INVALID_STATE: scheduled interval must be within its date")?;
                    timed.push((&item.id, start, end));
                }
            }
            None => {
                if item.start_minute.is_some() {
                    return Err("INVALID_STATE: start time needs an explicit duration".into());
                }
                unestimated += 1;
            }
        }
    }
    // Stable pair order makes duplicate/read-only requests independent of storage order.
    timed.sort_unstable_by(|a, b| a.0.cmp(b.0));
    let occupied: u64 = union(timed.iter().map(|(_, start, end)| (*start, *end)).collect())
        .iter()
        .map(|(start, end)| u64::from(end - start))
        .sum();
    let mut overlap_pairs = Vec::new();
    let mut unavailable_conflicts = Vec::new();
    for (index, (id, start, end)) in timed.iter().enumerate() {
        for (other_id, other_start, other_end) in timed.iter().skip(index + 1) {
            if (*start).max(*other_start) < (*end).min(*other_end) {
                overlap_pairs.push(json!({"first":id,"second":other_id}));
            }
        }
        for (blocked_start, blocked_end) in &unavailable {
            let overlap_start = (*start).max(*blocked_start);
            let overlap_end = (*end).min(*blocked_end);
            if overlap_start < overlap_end {
                unavailable_conflicts
                    .push(json!({"itemId":id,"startMinute":overlap_start,"endMinute":overlap_end}));
            }
        }
    }
    Ok(json!({
        "date":for_date,"availableMinutes":available,"reservedMinutes":reserved,
        "unestimatedCount":unestimated,"calendarOccupiedMinutes":occupied,
        "overlapPairs":overlap_pairs,"unavailableConflicts":unavailable_conflicts,
        "overBudget":available.map(|minutes| reserved > u64::from(minutes)),
        "fullyEstimated":unestimated == 0,
    }))
}

fn response(s: &PaperState, for_date: &str) -> Result<Value, String> {
    Ok(json!({"constraints":constraint(s, for_date)?,"capacity":day_capacity(s, for_date)?}))
}

fn text(v: &Value, key: &str, max: usize, allow_empty: bool) -> Result<String, String> {
    let value = v[key]
        .as_str()
        .ok_or(format!("INVALID_INPUT: {key}"))?
        .trim();
    if (!allow_empty && value.is_empty()) || value.chars().count() > max {
        return Err(format!("INVALID_INPUT: {key}"));
    }
    Ok(value.into())
}

fn project<'a>(s: &'a PaperState, id: &str) -> Result<Option<&'a Project>, String> {
    let mut matching = s
        .planning
        .context
        .projects
        .iter()
        .filter(|project| project.id == id);
    let found = matching.next();
    if matching.next().is_some() {
        return Err("INVALID_STATE: duplicate project id".into());
    }
    Ok(found)
}

fn save_project(s: &mut PaperState, v: &Value, source: &str, t: i64) -> Result<Value, String> {
    if source != "user" {
        return Err("FORBIDDEN: 项目由用户编辑。".into());
    }
    keys(
        v,
        &[
            "projectId",
            "expectedRevision",
            "title",
            "goal",
            "criteria",
            "referenceLinks",
            "archived",
            "requestId",
        ],
    )?;
    let id = text(v, "projectId", 100, false)?;
    let previous_revision = project(s, &id)?
        .map(|project| project.revision)
        .unwrap_or(0);
    if v["expectedRevision"].as_u64() != Some(previous_revision) {
        return Err("CONFLICT: 项目已有更新，请核对后重试。".into());
    }
    let title = text(v, "title", 100, false)?;
    let goal = text(v, "goal", 2000, true)?;
    let criteria = text(v, "criteria", 2000, true)?;
    let links = v["referenceLinks"]
        .as_array()
        .ok_or("INVALID_INPUT: referenceLinks")?;
    if links.len() > 10 {
        return Err("INVALID_INPUT: referenceLinks 最多10条。".into());
    }
    let mut reference_links = Vec::new();
    for link in links {
        let value = link.as_str().ok_or("INVALID_INPUT: reference link")?.trim();
        // Parse only: reference links are untrusted, unread context and never fetched here.
        let url = reqwest::Url::parse(value).map_err(|_| "INVALID_INPUT: reference link URL")?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err("INVALID_INPUT: reference links must use http or https".into());
        }
        reference_links.push(value.to_owned());
    }
    let archived = v["archived"]
        .as_bool()
        .ok_or("INVALID_INPUT: archived must be boolean")?;
    let revision = previous_revision
        .checked_add(1)
        .ok_or("INVALID_STATE: project revision overflow")?;
    let next = Project {
        id: id.clone(),
        title,
        goal,
        criteria,
        reference_links,
        archived,
        revision,
        updated_at: t,
        source: source.into(),
    };
    let mut draft = s.clone();
    match draft
        .planning
        .context
        .projects
        .iter_mut()
        .find(|project| project.id == id)
    {
        Some(project) => *project = next.clone(),
        None => draft.planning.context.projects.push(next.clone()),
    }
    *s = draft;
    Ok(json!({"project":next}))
}

fn set_task_project(s: &mut PaperState, v: &Value, source: &str, t: i64) -> Result<Value, String> {
    if source != "user" {
        return Err("FORBIDDEN: 任务归属由用户编辑。".into());
    }
    keys(
        v,
        &[
            "taskId",
            "expectedTaskRevision",
            "projectId",
            "expectedProjectRevision",
            "requestId",
        ],
    )?;
    let task_id = text(v, "taskId", 100, false)?;
    let task_index = s
        .tasks
        .iter()
        .position(|task| task.id == task_id)
        .ok_or("NOT_FOUND: task")?;
    let previous_revision = s.tasks[task_index].revision;
    if v["expectedTaskRevision"].as_u64() != Some(previous_revision) {
        return Err("CONFLICT: 任务已有更新，请核对后重试。".into());
    }
    let target = match v.get("projectId") {
        Some(Value::Null) => None,
        Some(_) => {
            let project_id = text(v, "projectId", 100, false)?;
            let target = project(s, &project_id)?.ok_or("NOT_FOUND: project")?;
            if v["expectedProjectRevision"].as_u64() != Some(target.revision) {
                return Err("CONFLICT: 项目已有更新，请核对后重试。".into());
            }
            if target.archived {
                return Err("CONFLICT: 项目已归档，请先恢复项目再关联。".into());
            }
            Some(target.clone())
        }
        None => return Err("INVALID_INPUT: projectId required (null clears association)".into()),
    };
    let revision = previous_revision
        .checked_add(1)
        .ok_or("INVALID_STATE: task revision overflow")?;
    let mut draft = s.clone();
    let task = &mut draft.tasks[task_index];
    task.project_id = target.as_ref().map(|project| project.id.clone());
    task.revision = revision;
    task.updated_at = t;
    task.source = source.into();
    let out = json!({"task":task,"project":target});
    *s = draft;
    Ok(out)
}

fn preference<'a>(s: &'a PaperState, id: &str) -> Result<Option<&'a Preference>, String> {
    let mut matching = s
        .planning
        .context
        .preferences
        .iter()
        .filter(|preference| preference.id == id);
    let found = matching.next();
    if matching.next().is_some() {
        return Err("INVALID_STATE: duplicate preference id".into());
    }
    Ok(found)
}

/// This is the whole currently applicable set, including an empty set after disable/delete.
/// Historical conversation and events are never promoted back into this set.
pub fn active_preferences<'a>(
    s: &'a PaperState,
    for_date: &str,
    project_ids: &[String],
) -> Result<Vec<&'a Preference>, String> {
    date(for_date)?;
    let mut active: Vec<_> = s
        .planning
        .context
        .preferences
        .iter()
        .filter(|preference| {
            if !preference.enabled || preference.source != "user" {
                return false;
            }
            match preference.scope.as_str() {
                "global" => preference.date.is_none() && preference.project_id.is_none(),
                "day" => {
                    preference.date.as_deref() == Some(for_date) && preference.project_id.is_none()
                }
                "project" => {
                    preference.date.is_none()
                        && preference.project_id.as_ref().is_some_and(|id| {
                            project_ids.contains(id)
                                && s.planning
                                    .context
                                    .projects
                                    .iter()
                                    .any(|project| &project.id == id && !project.archived)
                        })
                }
                _ => false,
            }
        })
        .collect();
    active.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(active)
}

fn save_preference(s: &mut PaperState, v: &Value, source: &str, t: i64) -> Result<Value, String> {
    if source != "user" {
        return Err("FORBIDDEN: 偏好需要用户明确确认。".into());
    }
    keys(
        v,
        &[
            "preferenceId",
            "expectedRevision",
            "text",
            "scope",
            "date",
            "projectId",
            "enabled",
            "requestId",
        ],
    )?;
    let id = text(v, "preferenceId", 100, false)?;
    let previous = preference(s, &id)?;
    let previous_revision = previous.map(|preference| preference.revision).unwrap_or(0);
    if v["expectedRevision"].as_u64() != Some(previous_revision) {
        return Err("CONFLICT: 偏好已有更新，请核对后重试。".into());
    }
    let body = text(v, "text", 1000, false)?;
    let scope = text(v, "scope", 20, false)?;
    let enabled = v["enabled"]
        .as_bool()
        .ok_or("INVALID_INPUT: enabled must be boolean")?;
    // Fields outside the chosen scope must be explicit nulls, not guessed or silently carried over.
    let (for_date, project_id) = match scope.as_str() {
        "global"
            if v.get("date") == Some(&Value::Null) && v.get("projectId") == Some(&Value::Null) =>
        {
            (None, None)
        }
        "day" if v.get("projectId") == Some(&Value::Null) => {
            let value = text(v, "date", 10, false)?;
            date(&value)?;
            (Some(value), None)
        }
        "project" if v.get("date") == Some(&Value::Null) => {
            let project_id = text(v, "projectId", 100, false)?;
            let target = project(s, &project_id)?.ok_or("NOT_FOUND: preference project")?;
            let disabling_existing = !enabled
                && previous.is_some_and(|preference| {
                    preference.scope == "project"
                        && preference.project_id.as_deref() == Some(project_id.as_str())
                });
            if target.archived && !disabling_existing {
                return Err("CONFLICT: 项目已归档，不能保存为当前项目偏好。".into());
            }
            (None, Some(project_id))
        }
        _ => return Err(
            "INVALID_INPUT: preference scope requires matching date/projectId and null elsewhere"
                .into(),
        ),
    };
    if let Some(previous) = previous.filter(|preference| {
        preference.text == body
            && preference.scope == scope
            && preference.date == for_date
            && preference.project_id == project_id
            && preference.enabled == enabled
            && preference.source == "user"
    }) {
        return Ok(
            json!({"preference":previous,"preferencesRevision":s.planning.context.preferences_revision,"reused":true}),
        );
    }
    let revision = previous_revision
        .checked_add(1)
        .ok_or("INVALID_STATE: preference revision overflow")?;
    let set_revision = s
        .planning
        .context
        .preferences_revision
        .checked_add(1)
        .ok_or("INVALID_STATE: preferences revision overflow")?;
    let next = Preference {
        id: id.clone(),
        text: body,
        scope,
        date: for_date,
        project_id,
        enabled,
        revision,
        confirmed_at: t,
        updated_at: t,
        source: source.into(),
    };
    let mut draft = s.clone();
    match draft
        .planning
        .context
        .preferences
        .iter_mut()
        .find(|preference| preference.id == id)
    {
        Some(preference) => *preference = next.clone(),
        None => draft.planning.context.preferences.push(next.clone()),
    }
    draft.planning.context.preferences_revision = set_revision;
    *s = draft;
    Ok(json!({"preference":next,"preferencesRevision":set_revision,"reused":false}))
}

fn delete_preference(s: &mut PaperState, v: &Value, source: &str) -> Result<Value, String> {
    if source != "user" {
        return Err("FORBIDDEN: 偏好需要用户明确删除。".into());
    }
    keys(v, &["preferenceId", "expectedRevision", "requestId"])?;
    let id = text(v, "preferenceId", 100, false)?;
    let previous = preference(s, &id)?.ok_or("NOT_FOUND: preference")?;
    if v["expectedRevision"].as_u64() != Some(previous.revision) {
        return Err("CONFLICT: 偏好已有更新，请核对后重试。".into());
    }
    let set_revision = s
        .planning
        .context
        .preferences_revision
        .checked_add(1)
        .ok_or("INVALID_STATE: preferences revision overflow")?;
    let mut draft = s.clone();
    draft
        .planning
        .context
        .preferences
        .retain(|preference| preference.id != id);
    draft.planning.context.preferences_revision = set_revision;
    *s = draft;
    Ok(json!({"deletedId":id,"preferencesRevision":set_revision}))
}

pub fn execute(
    s: &mut PaperState,
    action: &str,
    v: &Value,
    source: &str,
    t: i64,
) -> Result<Value, String> {
    match action {
        "save_preference" => save_preference(s, v, source, t),
        "delete_preference" => delete_preference(s, v, source),
        "save_project" => save_project(s, v, source, t),
        "set_task_project" => set_task_project(s, v, source, t),
        "get_day_capacity" => {
            keys(v, &["date"])?;
            let for_date = v["date"].as_str().ok_or("INVALID_INPUT: date")?;
            response(s, for_date)
        }
        "save_day_constraints" => {
            if source != "user" {
                return Err("FORBIDDEN: 日期时间预算由用户设置。".into());
            }
            keys(
                v,
                &[
                    "date",
                    "expectedRevision",
                    "availableMinutes",
                    "unavailable",
                    "requestId",
                ],
            )?;
            let for_date = v["date"].as_str().ok_or("INVALID_INPUT: date")?;
            date(for_date)?;
            let existing = constraint(s, for_date)?;
            let previous_revision = existing.map(|day| day.revision).unwrap_or(0);
            if v["expectedRevision"].as_u64() != Some(previous_revision) {
                return Err("CONFLICT: 当天时间预算已有更新，请核对后重试。".into());
            }
            // An explicit null clears only the budget. Omitted fields cannot accidentally clear an edited day.
            let available = match v.get("availableMinutes") {
                Some(Value::Null) => None,
                Some(minutes) => Some(
                    minutes
                        .as_u64()
                        .filter(|minutes| *minutes <= 1440)
                        .ok_or("INVALID_INPUT: availableMinutes must be null or 0–1440")?
                        as u32,
                ),
                None => {
                    return Err(
                        "INVALID_INPUT: availableMinutes required (null means unknown)".into(),
                    )
                }
            };
            let intervals = v["unavailable"]
                .as_array()
                .ok_or("INVALID_INPUT: unavailable")?;
            let mut unavailable = Vec::new();
            for interval in intervals {
                keys(interval, &["startMinute", "endMinute"])?;
                let start = interval["startMinute"]
                    .as_u64()
                    .filter(|minute| *minute < 1440)
                    .ok_or("INVALID_INPUT: unavailable startMinute")?
                    as u32;
                let end = interval["endMinute"]
                    .as_u64()
                    .filter(|minute| *minute <= 1440)
                    .ok_or("INVALID_INPUT: unavailable endMinute")?
                    as u32;
                if start >= end {
                    return Err("INVALID_INPUT: unavailable interval requires start < end".into());
                }
                unavailable.push(UnavailableInterval {
                    start_minute: start,
                    end_minute: end,
                });
            }
            let next_revision = previous_revision
                .checked_add(1)
                .ok_or("INVALID_STATE: day revision overflow")?;
            let day = DayConstraint {
                date: for_date.into(),
                revision: next_revision,
                available_minutes: available,
                unavailable,
                updated_at: t,
                source: source.into(),
            };
            let mut draft = s.clone();
            match draft
                .planning
                .context
                .days
                .iter_mut()
                .find(|existing| existing.date == for_date)
            {
                Some(existing) => *existing = day,
                None => draft.planning.context.days.push(day),
            }
            let out = response(&draft, for_date)?;
            *s = draft;
            Ok(out)
        }
        _ => Err("UNKNOWN_ACTION".into()),
    }
}
