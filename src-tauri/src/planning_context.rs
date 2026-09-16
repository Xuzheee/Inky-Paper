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

pub fn execute(
    s: &mut PaperState,
    action: &str,
    v: &Value,
    source: &str,
    t: i64,
) -> Result<Value, String> {
    match action {
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
