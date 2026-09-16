//! Read-only, request-scoped Coach facts. Never trust frontend titles or facts.
use crate::paper::{PaperState, Task};
use crate::paper_planning::{DayItem, Step};
use chrono::{Local, NaiveDate};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const PLAN_LIMIT: usize = 40;
const UNPLANNED_LIMIT: usize = 20;
const SELECTED_LIMIT: usize = 20;
const REVIEW_LIMIT: usize = 60;
const NOTE_CHAR_LIMIT: usize = 12_000;

fn strict_date(value: &Value, field: &str) -> Result<String, String> {
    let date = value[field]
        .as_str()
        .ok_or_else(|| format!("INVALID_INPUT: {field}"))?;
    let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| format!("INVALID_INPUT: {field}"))?;
    if date.len() != 10 || parsed.format("%Y-%m-%d").to_string() != date {
        return Err(format!("INVALID_INPUT: {field}"));
    }
    Ok(date.to_owned())
}

fn optional_id(value: &Value, field: &str) -> Result<Option<String>, String> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(id)) if uuid::Uuid::parse_str(id).is_ok() => Ok(Some(id.clone())),
        _ => Err(format!("INVALID_INPUT: {field}")),
    }
}

#[derive(Default)]
struct Versions {
    tasks: BTreeMap<String, u64>,
    steps: BTreeMap<String, u64>,
    day_items: BTreeMap<String, u64>,
}
impl Versions {
    fn include(&mut self, task: Option<&Task>, step: Option<&Step>, item: Option<&DayItem>) {
        if let Some(task) = task {
            self.tasks.insert(task.id.clone(), task.revision);
        }
        if let Some(step) = step {
            self.steps.insert(step.id.clone(), step.revision);
        }
        if let Some(item) = item {
            self.day_items.insert(item.id.clone(), item.revision);
        }
    }
}

fn row(state: &PaperState, item: &DayItem, versions: &mut Versions) -> Option<Value> {
    let task = state.tasks.iter().find(|task| task.id == item.task_id)?;
    let step = state
        .planning
        .steps
        .iter()
        .find(|step| step.id == item.step_id && step.task_id == task.id)?;
    versions.include(Some(task), Some(step), Some(item));
    Some(json!({"task":task,"step":step,"item":item}))
}

/// `input` is the UI scope, not an authoritative source of task or execution facts.
/// The caller holds PaperDb's mutex; this function does not execute mutations or sync files.
pub(crate) fn build(c: &Connection, input: Value, message: &str) -> Result<Value, String> {
    if !input.is_object() {
        return Err("INVALID_INPUT: context".into());
    }
    if message.trim().is_empty() || message.chars().count() > 16_000 {
        return Err("INVALID_INPUT: message must contain 1–16000 characters".into());
    }
    let date = strict_date(&input, "date")?;
    let view_date = if input.get("viewDate").is_some() {
        strict_date(&input, "viewDate")?
    } else {
        date.clone()
    };
    let task_id = optional_id(&input, "selectedTaskId")?;
    let step_id = optional_id(&input, "selectedStepId")?;
    let item_id = optional_id(&input, "selectedDayItemId")?;
    if (step_id.is_some() && task_id.is_none()) || (item_id.is_some() && step_id.is_none()) {
        return Err("INVALID_INPUT: 选择步骤/安排时需要对应任务与步骤".into());
    }
    let now = Local::now();
    let sampled_at = now.timestamp_millis();
    let offset = now.offset().local_minus_utc() / 60;
    let state = crate::paper::load(c)?;
    let task = task_id
        .as_ref()
        .map(|id| {
            state
                .tasks
                .iter()
                .find(|task| task.id == *id)
                .ok_or("CONFLICT: 所选任务已不存在，请刷新后重试")
        })
        .transpose()?;
    let step = step_id
        .as_ref()
        .map(|id| {
            state
                .planning
                .steps
                .iter()
                .find(|step| step.id == *id && Some(&step.task_id) == task_id.as_ref())
                .ok_or("CONFLICT: 所选步骤与任务已不一致，请刷新后重试")
        })
        .transpose()?;
    let item = item_id
        .as_ref()
        .map(|id| {
            state
                .planning
                .day_items
                .iter()
                .find(|item| {
                    item.id == *id
                        && Some(&item.task_id) == task_id.as_ref()
                        && Some(&item.step_id) == step_id.as_ref()
                        && item.removed_at.is_none()
                        && item.date == date
                })
                .ok_or("CONFLICT: 所选安排或日期已变化，请刷新后重试")
        })
        .transpose()?;
    let intent = match input["intent"].as_str() {
        Some("plan") => "plan",
        Some("stuck") => "stuck",
        Some("review") => "review",
        _ => "auto",
    };
    let mut versions = Versions::default();
    versions.include(task, step, item);
    let mut facts = json!({"selection":{"task":task,"step":step,"dayItem":item}});
    facts["dayConstraints"] = json!(state.planning.context.days.iter().find(|d|d.date == date));
    facts["capacity"] = crate::planning_context::day_capacity(&state,&date)?;
    let latest_session = step_id.as_ref().and_then(|id| state.sessions.iter().filter(|s| s.kind == "focus" && s.status == "finished" && s.task_id.as_ref() == task_id.as_ref() && s.action.as_ref().is_some_and(|a| a.id == *id)).max_by(|a,b| a.ended_at.unwrap_or(a.started_at).cmp(&b.ended_at.unwrap_or(b.started_at)).then_with(|| a.id.cmp(&b.id))));
    facts["selection"]["nextCue"] = latest_session.and_then(|s| {
        let cue = s.feedback.as_ref().and_then(|f|f["nextCue"].as_str()).filter(|c|!c.trim().is_empty()).or(s.resume_cue.as_deref().filter(|c|!c.trim().is_empty()))?;
        Some(json!({"text":cue.trim(),"sessionId":s.id}))
    }).unwrap_or(Value::Null);
    let mut truncated = json!({});
    let mut counts = json!({});
    let mut data_version = Value::Null;
    let mut notes_version = Value::Null;
    match intent {
        "plan" => {
            let mut items: Vec<_> = state
                .planning
                .day_items
                .iter()
                .filter(|item| item.date == date && item.removed_at.is_none())
                .collect();
            items.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
            counts["dayPlan"] = json!(items.len());
            truncated["dayPlan"] = json!(items.len() > PLAN_LIMIT);
            facts["dayPlan"] = json!(items
                .into_iter()
                .take(PLAN_LIMIT)
                .filter_map(|item| row(&state, item, &mut versions))
                .collect::<Vec<_>>());
            // A selected task may have other steps or arrangements needed for a
            // continuation decision; unrelated future/past plans stay outside this request.
            let selected_steps: Vec<_> = state
                .planning
                .steps
                .iter()
                .filter(|step| Some(&step.task_id) == task_id.as_ref())
                .collect();
            counts["selectedTaskSteps"] = json!(selected_steps.len());
            truncated["selectedTaskSteps"] = json!(selected_steps.len() > SELECTED_LIMIT);
            facts["selectedTaskSteps"] = json!(selected_steps
                .into_iter()
                .take(SELECTED_LIMIT)
                .map(|step| {
                    versions.include(task, Some(step), None);
                    step
                })
                .collect::<Vec<_>>());
            let mut arrangements: Vec<_> = state
                .planning
                .day_items
                .iter()
                .filter(|item| {
                    item.removed_at.is_none()
                        && Some(&item.task_id) == task_id.as_ref()
                        && step_id.as_ref().is_none_or(|id| item.step_id == *id)
                })
                .collect();
            arrangements.sort_by(|a, b| {
                a.date
                    .cmp(&b.date)
                    .then_with(|| a.order.cmp(&b.order))
                    .then_with(|| a.id.cmp(&b.id))
            });
            counts["selectedArrangements"] = json!(arrangements.len());
            truncated["selectedArrangements"] = json!(arrangements.len() > SELECTED_LIMIT);
            facts["selectedArrangements"] = json!(arrangements
                .into_iter()
                .take(SELECTED_LIMIT)
                .filter_map(|item| row(&state, item, &mut versions))
                .collect::<Vec<_>>());
            let scheduled: BTreeSet<_> = state
                .planning
                .day_items
                .iter()
                .filter(|item| item.removed_at.is_none())
                .map(|item| (item.task_id.as_str(), item.step_id.as_str()))
                .collect();
            let mut unplanned = Vec::new();
            for task in state.tasks.iter().filter(|task| !task.completed) {
                let steps: Vec<_> = state
                    .planning
                    .steps
                    .iter()
                    .filter(|step| step.task_id == task.id)
                    .collect();
                if steps.is_empty() {
                    unplanned.push((task, None));
                } else {
                    unplanned.extend(
                        steps
                            .into_iter()
                            .filter(|step| {
                                !step.completed
                                    && !scheduled.contains(&(task.id.as_str(), step.id.as_str()))
                            })
                            .map(|step| (task, Some(step))),
                    );
                }
            }
            // Relevant task first, then explicit priority. Ordering does not assert
            // the user's available time, preference, or a commitment to the plan.
            unplanned.sort_by_key(|(task, step)| {
                (
                    task_id.as_ref() != Some(&task.id),
                    match task.priority.as_str() {
                        "high" => 0,
                        "medium" => 1,
                        _ => 2,
                    },
                    task.id.as_str(),
                    step.map(|step| step.id.as_str()),
                )
            });
            counts["unplanned"] = json!(unplanned.len());
            truncated["unplanned"] = json!(unplanned.len() > UNPLANNED_LIMIT);
            facts["unplanned"] = json!(unplanned
                .into_iter()
                .take(UNPLANNED_LIMIT)
                .map(|(task, step)| {
                    versions.include(Some(task), step, None);
                    json!({"task":task,"step":step})
                })
                .collect::<Vec<_>>());
        }
        "stuck" => {
            let session = step_id.as_ref().and_then(|id| {
                state
                    .sessions
                    .iter()
                    .filter(|session| {
                        session.kind == "focus"
                            && session.status == "finished"
                            && session.task_id.as_ref() == task_id.as_ref()
                            && session
                                .action
                                .as_ref()
                                .is_some_and(|action| action.id == *id)
                    })
                    .max_by(|a, b| {
                        a.ended_at
                            .unwrap_or(a.started_at)
                            .cmp(&b.ended_at.unwrap_or(b.started_at))
                            .then_with(|| a.id.cmp(&b.id))
                    })
            });
            facts["latestStepSession"] = json!(session);
            facts["feedbackScope"] =
                json!("仅为所选步骤最近一次已结束会话的用户反馈；缺失保持未知。");
        }
        "review" => {
            let mut record =
                crate::paper_planning::daily_record(&state, &date, offset, sampled_at)?;
            crate::paper_markdown::enrich_day(c, &mut record)?;
            data_version = record["dataVersion"].clone();
            notes_version = record["notesVersion"].clone();
            for key in [
                "planItems",
                "planChanges",
                "sessions",
                "manualStepChanges",
                "notes",
                "workBlocks",
                "summaries",
            ] {
                if let Some(items) = record[key].as_array_mut() {
                    counts[key] = json!(items.len());
                    truncated[key] = json!(items.len() > REVIEW_LIMIT);
                    if items.len() > REVIEW_LIMIT {
                        if key == "planItems" {
                            items.truncate(REVIEW_LIMIT);
                        } else {
                            items.drain(..items.len() - REVIEW_LIMIT);
                        }
                    }
                }
            }
            if let Some(notes) = record["personalNotes"].as_str() {
                let count = notes.chars().count();
                counts["personalNotesCharacters"] = json!(count);
                truncated["personalNotes"] = json!(count > NOTE_CHAR_LIMIT);
                if count > NOTE_CHAR_LIMIT {
                    record["personalNotes"] =
                        json!(notes.chars().take(NOTE_CHAR_LIMIT).collect::<String>());
                }
            }
            facts["dailyRecord"] = record;
        }
        _ => {}
    }
    let mut relevant_tasks: BTreeSet<&str> = versions.tasks.keys().map(String::as_str).collect();
    for item in &state.planning.day_items { if item.date==date && item.removed_at.is_none() { relevant_tasks.insert(&item.task_id); } }
    let project_ids: BTreeSet<&str> = state.tasks.iter().filter(|task| relevant_tasks.contains(task.id.as_str())).filter_map(|task|task.project_id.as_deref()).collect();
    let projects:Vec<_>=state.planning.context.projects.iter().filter(|p|project_ids.contains(p.id.as_str())).collect();
    counts["projects"]=json!(projects.len()); truncated["projects"]=json!(projects.len()>20);
    facts["projects"]=json!(projects.into_iter().take(20).collect::<Vec<_>>());
    facts["referenceLinksRule"]=json!("参考链接仅由用户填写保存，系统尚未读取其网页内容。");
    Ok(json!({
        "schemaVersion":2,"date":date,"viewDate":view_date,
        "today":now.format("%Y-%m-%d").to_string(),"utcOffsetMinutes":offset,
        "sampledAt":sampled_at,"intent":intent,"resolvedIntent":intent,
        "selectedTaskId":task_id,"selectedStepId":step_id,"selectedDayItemId":item_id,
        "taskTitle":task.map(|task| &task.title),"stepText":step.map(|step| &step.text),
        "temporaryConstraints":{"text":message,"scope":"request"},
        "latestFacts":facts,
        "versions":{"tasks":versions.tasks,"steps":versions.steps,"dayItems":versions.day_items,"dataVersion":data_version,"notesVersion":notes_version},
        "truncated":truncated,"scopeCounts":counts,
        "factsRule":"事实只限本次读取范围；被截断的范围须按需再读。首轮时长不是总工时，未报告的精力、产出和原因保持未知。"
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    const DATE: &str = "2030-03-04";
    fn db() -> Connection {
        let c = crate::paper::open(std::path::Path::new(":memory:")).unwrap();
        let fixture: Value = serde_json::from_str(include_str!(
            "../../scripts/fixtures/p0p1/legacy-state.json"
        ))
        .unwrap();
        c.execute(
            "UPDATE paper_state SET data=?1",
            [fixture["state"].to_string()],
        )
        .unwrap();
        c
    }
    fn ids(c: &Connection) -> (String, String, String) {
        let s = crate::paper::load(c).unwrap();
        let item = s
            .planning
            .day_items
            .iter()
            .find(|item| item.date == DATE)
            .unwrap();
        (item.task_id.clone(), item.step_id.clone(), item.id.clone())
    }
    fn input(c: &Connection, intent: &str) -> Value {
        let (task, step, item) = ids(c);
        json!({"date":DATE,"selectedTaskId":task,"selectedStepId":step,"selectedDayItemId":item,"intent":intent})
    }
    fn unchanged(c: &Connection) -> (String, i64, i64, i64) {
        (
            c.query_row("SELECT data FROM paper_state WHERE id=1", [], |r| r.get(0))
                .unwrap(),
            c.query_row("SELECT COUNT(*) FROM paper_events", [], |r| r.get(0))
                .unwrap(),
            c.query_row("SELECT COUNT(*) FROM paper_requests", [], |r| r.get(0))
                .unwrap(),
            c.query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap(),
        )
    }

    #[test]
    fn legacy_scope_is_upgraded_and_forged_titles_dates_and_facts_are_replaced() {
        let c = db();
        let mut v = input(&c, "nonsense");
        v["taskTitle"] = json!("过期标题");
        v["stepText"] = json!("伪造步骤");
        v["today"] = json!("1999-01-01");
        v["utcOffsetMinutes"] = json!(-840);
        v["latestFacts"] = json!({"energy":"high"});
        let before = unchanged(&c);
        let result = build(&c, v, "今天只有45分钟，但不确定先做什么").unwrap();
        assert_eq!(result["schemaVersion"], 2);
        assert_eq!(result["intent"], "auto");
        assert_eq!(result["viewDate"], DATE);
        assert_eq!(result["today"], Local::now().format("%Y-%m-%d").to_string());
        assert_eq!(
            result["utcOffsetMinutes"],
            Local::now().offset().local_minus_utc() / 60
        );
        assert_eq!(result["taskTitle"], "今日写作");
        assert_eq!(result["stepText"], "写今天的简短提纲");
        assert!(result["latestFacts"]["energy"].is_null());
        assert_eq!(
            result["temporaryConstraints"],
            json!({"text":"今天只有45分钟，但不确定先做什么","scope":"request"})
        );
        assert!(result["availableMinutes"].is_null());
        assert_eq!(unchanged(&c), before);
    }

    #[test]
    fn invalid_dates_missing_targets_and_mismatched_selection_are_rejected_without_writes() {
        let c = db();
        let original = input(&c, "plan");
        let before = unchanged(&c);
        for (field, value) in [
            ("date", json!("2030-02-30")),
            ("date", json!("2030-3-04")),
            ("viewDate", json!("../2030-03-04")),
            ("selectedTaskId", json!("not-an-id")),
            (
                "selectedTaskId",
                json!("10000000-0000-4000-8000-000000000003"),
            ),
            ("selectedStepId", Value::Null),
            ("date", json!("2030-03-05")),
        ] {
            let mut v = original.clone();
            v[field] = value;
            assert!(build(&c, v, "规划一下").is_err(), "{field}");
        }
        assert_eq!(unchanged(&c), before);
    }

    #[test]
    fn planning_includes_only_the_day_selected_object_and_bounded_unplanned_work() {
        let c = db();
        let result = build(&c, input(&c, "plan"), "安排一下").unwrap();
        assert_eq!(
            result["latestFacts"]["dayPlan"].as_array().unwrap().len(),
            3
        );
        assert!(result["latestFacts"]["dayPlan"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["item"]["date"] == DATE));
        assert!(!result["latestFacts"].to_string().contains("下周阅读"));
        assert_eq!(
            result["latestFacts"]["unplanned"].as_array().unwrap().len(),
            2
        );
        assert!(result["latestFacts"]["sessions"].is_null());
        assert_eq!(result["truncated"]["dayPlan"], false);
        let (task, step, item) = ids(&c);
        assert_eq!(result["versions"]["tasks"][task], 1);
        assert_eq!(result["versions"]["steps"][step], 1);
        assert_eq!(result["versions"]["dayItems"][item], 1);
    }

    #[test]
    fn stuck_reads_only_latest_feedback_for_exact_step_without_inventing_a_blocker() {
        let c = db();
        let state = crate::paper::load(&c).unwrap();
        let session = &state.sessions[0];
        let v = json!({"date":DATE,"intent":"stuck","selectedTaskId":session.task_id,"selectedStepId":session.action.as_ref().unwrap().id});
        let result = build(&c, v, "这一步有点难开始").unwrap();
        assert_eq!(result["latestFacts"]["latestStepSession"]["id"], session.id);
        assert_eq!(
            result["latestFacts"]["latestStepSession"]["feedback"]["nextCue"],
            "从第七条继续核对"
        );
        assert!(result["latestFacts"]["latestStepSession"]["feedback"]["blocker"].is_null());
        let missing = build(&c, input(&c, "stuck"), "我卡住了").unwrap();
        assert!(missing["latestFacts"]["latestStepSession"].is_null());
    }

    #[test]
    fn alternating_steps_keep_the_latest_exact_session_and_do_not_revive_an_old_cue() {
        let c = db();
        let mut state = crate::paper::load(&c).unwrap();
        let original = state.sessions[0].clone();
        let a = original.action.as_ref().unwrap().id.clone();
        let b = state.planning.steps[1].clone();
        let mut last_b = original.clone();
        last_b.id = uuid::Uuid::new_v4().to_string();
        last_b.action.as_mut().unwrap().id = b.id.clone();
        last_b.action.as_mut().unwrap().text = b.text;
        last_b.ended_at = original.ended_at.map(|at| at + 3000);
        last_b.feedback = Some(json!({"nextCue":"B 的续做提示"}));
        let mut last_a = original.clone();
        last_a.id = uuid::Uuid::new_v4().to_string();
        last_a.ended_at = original.ended_at.map(|at| at + 2000);
        last_a.feedback = Some(json!({"nextCue":null,"blocker":null,"output":null}));
        last_a.resume_cue = None;
        state.sessions.extend([last_b.clone(), last_a.clone()]);
        c.execute(
            "UPDATE paper_state SET data=?1",
            [serde_json::to_string(&state).unwrap()],
        )
        .unwrap();
        let scope = json!({"date":DATE,"intent":"stuck","selectedTaskId":original.task_id,"selectedStepId":a});
        let result = build(&c, scope.clone(), "回到 A").unwrap();
        let latest = &result["latestFacts"]["latestStepSession"];
        assert_eq!(latest["id"], last_a.id);
        assert!(latest["feedback"]["nextCue"].is_null());
        assert!(latest["resumeCue"].is_null());
        assert!(!latest.to_string().contains("从第七条继续核对"));
        assert!(!latest.to_string().contains("B 的续做提示"));
        state.sessions.last_mut().unwrap().resume_cue = Some("A 本轮暂停时的起点".into());
        c.execute(
            "UPDATE paper_state SET data=?1",
            [serde_json::to_string(&state).unwrap()],
        )
        .unwrap();
        let result = build(&c, scope, "继续 A").unwrap();
        assert_eq!(
            result["latestFacts"]["latestStepSession"]["resumeCue"],
            "A 本轮暂停时的起点"
        );
    }

    #[test]
    fn review_reuses_daily_record_versions_and_reads_notes_without_export_or_model_calls() {
        let c = db();
        let before = unchanged(&c);
        let result = build(&c, json!({"date":DATE,"intent":"review"}), "回顾一下").unwrap();
        let record = &result["latestFacts"]["dailyRecord"];
        assert_eq!(record["date"], DATE);
        assert_eq!(record["manualStepChanges"].as_array().unwrap().len(), 2);
        assert_eq!(result["versions"]["dataVersion"], record["dataVersion"]);
        assert_eq!(result["versions"]["notesVersion"], record["notesVersion"]);
        assert_eq!(
            result["versions"]["dataVersion"].as_str().unwrap().len(),
            64
        );
        assert_eq!(
            result["versions"]["notesVersion"].as_str().unwrap().len(),
            64
        );
        assert_eq!(unchanged(&c), before);
    }

    #[test]
    fn review_picks_up_edited_personal_notes_without_generating_markdown() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::paper::open(&dir.path().join("synthetic.sqlite")).unwrap();
        let notes_dir = dir.path().join("工作记录").join("每日");
        let scope = json!({"date":DATE,"intent":"review"});
        build(&c, scope.clone(), "回顾").unwrap();
        assert!(!notes_dir.exists());
        std::fs::create_dir_all(&notes_dir).unwrap();
        let notes_path = notes_dir.join(format!("{DATE}.个人笔记.md"));
        std::fs::write(&notes_path, "第一版个人记录").unwrap();
        let before = unchanged(&c);
        let first = build(&c, scope.clone(), "回顾").unwrap();
        assert!(first["latestFacts"]["dailyRecord"]["personalNotes"]
            .as_str()
            .unwrap()
            .contains("第一版个人记录"));
        std::fs::write(&notes_path, "本人修改后的个人记录").unwrap();
        let second = build(&c, scope, "再回顾").unwrap();
        assert_ne!(
            first["versions"]["notesVersion"],
            second["versions"]["notesVersion"]
        );
        assert_eq!(
            first["versions"]["dataVersion"],
            second["versions"]["dataVersion"]
        );
        assert_eq!(
            std::fs::read_to_string(&notes_path).unwrap(),
            "本人修改后的个人记录"
        );
        assert!(!notes_dir.join(format!("{DATE}.md")).exists());
        assert_eq!(unchanged(&c), before);
    }

    #[test]
    fn large_scopes_are_bounded_and_marked_instead_of_appearing_complete() {
        let c = db();
        let mut state = crate::paper::load(&c).unwrap();
        let task = state.tasks[1].clone();
        let step = state.planning.steps[2].clone();
        let item = state.planning.day_items[2].clone();
        for index in 0..90 {
            let mut t = task.clone();
            t.id = uuid::Uuid::new_v4().to_string();
            let mut s = step.clone();
            s.id = uuid::Uuid::new_v4().to_string();
            s.task_id = t.id.clone();
            let mut i = item.clone();
            i.id = uuid::Uuid::new_v4().to_string();
            i.task_id = t.id.clone();
            i.step_id = s.id.clone();
            i.order = (index + 3) as u64;
            state.tasks.push(t);
            state.planning.steps.push(s);
            if index < 60 {
                state.planning.day_items.push(i);
            }
        }
        c.execute(
            "UPDATE paper_state SET data=?1",
            [serde_json::to_string(&state).unwrap()],
        )
        .unwrap();
        let result = build(&c, json!({"date":DATE,"intent":"plan"}), "安排一下").unwrap();
        assert_eq!(
            result["latestFacts"]["dayPlan"].as_array().unwrap().len(),
            PLAN_LIMIT
        );
        assert_eq!(
            result["latestFacts"]["unplanned"].as_array().unwrap().len(),
            UNPLANNED_LIMIT
        );
        assert_eq!(result["truncated"]["dayPlan"], true);
        assert_eq!(result["truncated"]["unplanned"], true);
        assert_eq!(result["scopeCounts"]["dayPlan"], 63);
        assert_eq!(result["scopeCounts"]["unplanned"], 32);
    }
}
