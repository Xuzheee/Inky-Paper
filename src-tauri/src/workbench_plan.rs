//! User edits from the workbench use the same versioned Paper transaction.
use crate::paper::{PaperState, Task};
use crate::paper_planning::{action, DayItem, Step};
use serde_json::{json, Value};

fn text(v: &Value, k: &str) -> Result<String, String> {
    let s = v[k].as_str().unwrap_or("").trim();
    if s.is_empty() || s.chars().count() > 300 {
        return Err(format!("INVALID_INPUT: {k}"));
    }
    Ok(s.into())
}
fn uuid(v: &Value, k: &str) -> Result<String, String> {
    let s = text(v, k)?;
    uuid::Uuid::parse_str(&s).map_err(|_| format!("INVALID_INPUT: {k}"))?;
    Ok(s)
}
fn revision(v: &Value, k: &str, n: u64) -> Result<(), String> {
    if v[k].as_u64() != Some(n) {
        return Err("CONFLICT: 内容已更新，请保留草稿并核对最新内容。".into());
    }
    Ok(())
}
fn day(v: &Value) -> Result<Option<String>, String> {
    if v["date"].is_null() {
        return Ok(None);
    }
    let s = text(v, "date")?;
    let d = chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").map_err(|_| "INVALID_INPUT: 日期")?;
    if d.format("%Y-%m-%d").to_string() != s {
        return Err("INVALID_INPUT: 日期".into());
    }
    Ok(Some(s))
}
fn time(v: &Value) -> Result<(Option<u32>, Option<u32>), String> {
    if v["startMinute"].is_null() {
        if !v["durationMinutes"].is_null() {
            return Err("INVALID_INPUT: 请同时填写开始时间与时长。".into());
        }
        return Ok((None, None));
    }
    let start = v["startMinute"].as_u64().ok_or("INVALID_INPUT: 开始时间")?;
    let duration = v["durationMinutes"].as_u64().ok_or("INVALID_INPUT: 时长")?;
    if start >= 1440 || !(1..=1440).contains(&duration) || start + duration > 1440 {
        return Err("INVALID_INPUT: 日程需在同一天内，时长至少 1 分钟。".into());
    }
    Ok((Some(start as u32), Some(duration as u32)))
}
pub(crate) fn execute(
    s: &mut PaperState,
    op: &str,
    v: &Value,
    source: &str,
    now: i64,
) -> Result<Value, String> {
    if source != "user" {
        return Err("FORBIDDEN: 工作台编辑仅由用户操作。".into());
    }
    if matches!(op, "continue_plan_items" | "cancel_plan_items") {
        return resolve_items(s, op, v, now);
    }
    let allowed = if op == "workbench_move_item" {
        vec![
            "requestId",
            "itemId",
            "expectedItemRevision",
            "date",
            "startMinute",
            "durationMinutes",
            "beforeItemId",
        ]
    } else {
        vec![
            "requestId",
            "taskId",
            "stepId",
            "expectedTaskRevision",
            "expectedStepRevision",
            "title",
            "text",
            "category",
            "plannedSeconds",
            "date",
            "itemId",
            "expectedItemRevision",
            "startMinute",
            "durationMinutes",
            "priority",
            "due",
            "dueDate",
            "expectedResult",
        ]
    };
    for k in v.as_object().ok_or("INVALID_INPUT: object")?.keys() {
        if !allowed.contains(&k.as_str()) {
            return Err(format!("INVALID_INPUT: {k}"));
        }
    }
    let date = day(v)?;
    let (start, duration) = time(v)?;
    if date.is_none() && start.is_some() {
        return Err("INVALID_INPUT: 请先选择日期。".into());
    }
    if op == "workbench_move_item" {
        let iid = uuid(v, "itemId")?;
        let target = s
            .planning
            .day_items
            .iter()
            .find(|x| x.id == iid && x.removed_at.is_none())
            .ok_or("NOT_FOUND: 日计划")?
            .clone();
        revision(v, "expectedItemRevision", target.revision)?;
        let before = v["beforeItemId"].as_str();
        if let Some(bid) = before {
            if bid == iid
                || !s.planning.day_items.iter().any(|x| {
                    x.id == bid && Some(&x.date) == date.as_ref() && x.removed_at.is_none()
                })
            {
                return Err("CONFLICT: 排序位置已变化，请重试。".into());
            }
        }
        if let Some(d) = &date {
            if s.planning.day_items.iter().any(|x| {
                x.id != iid && x.date == *d && x.step_id == target.step_id && x.removed_at.is_none()
            }) {
                return Err("CONFLICT: 这一步已在目标日期中。".into());
            }
        }
        let mut order: Vec<_> = s
            .planning
            .day_items
            .iter()
            .filter(|x| x.id != iid && Some(&x.date) == date.as_ref() && x.removed_at.is_none())
            .map(|x| (x.order, x.id.clone()))
            .collect();
        order.sort_by_key(|x| x.0);
        let insert = before
            .and_then(|bid| order.iter().position(|x| x.1 == bid))
            .unwrap_or(order.len());
        order.insert(insert, (0, iid.clone()));
        for (index, (_, id)) in order.iter().enumerate() {
            let item = s
                .planning
                .day_items
                .iter_mut()
                .find(|x| x.id == *id)
                .unwrap();
            if item.id == iid {
                if let Some(d) = &date {
                    if item.date != *d { item.resolved_at = None; item.resolution = None; item.continued_to = None; }
                    item.date = d.clone();
                }
                item.removed_at = if date.is_none() { Some(now) } else { None };
                item.start_minute = start;
                item.duration_minutes = duration;
                item.revision += 1;
            } else if item.order != index as u64 {
                item.revision += 1;
            }
            item.order = index as u64;
        }
        return Ok(json!({"item":s.planning.day_items.iter().find(|x|x.id==iid)}));
    }
    let tid = uuid(v, "taskId")?;
    let sid = uuid(v, "stepId")?;
    let title = text(v, "title")?;
    let step_text = text(v, "text")?;
    let category = v["category"].as_str().unwrap_or("work");
    if !["work", "study", "life", "idea"].contains(&category) {
        return Err("INVALID_INPUT: category".into());
    }
    let seconds = v["plannedSeconds"]
        .as_u64()
        .ok_or("INVALID_INPUT: plannedSeconds")?;
    if !(60..=7200).contains(&seconds) {
        return Err("INVALID_INPUT: 首轮时长需为 1–120 分钟。".into());
    }
    if let Some(task) = s.tasks.iter_mut().find(|x| x.id == tid) {
        revision(v, "expectedTaskRevision", task.revision)?;
        task.title = title;
        task.category = category.into();
        metadata(task, v)?;
        task.revision += 1;
        task.updated_at = now;
    } else {
        if v["expectedTaskRevision"].as_u64().is_some() {
            return Err("NOT_FOUND: task".into());
        }
        s.tasks.push(Task {
            id: tid.clone(),
            title,
            category: category.into(),
            due: None,
            due_date: None,
            priority: "medium".into(),
            completed: false,
            next_action: None,
            revision: 1,
            source: "user".into(),
            created_at: now,
            updated_at: now,
            completed_at: None,
        });
        metadata(s.tasks.last_mut().unwrap(), v)?;
    }
    let step = if let Some(step) = s.planning.steps.iter_mut().find(|x| x.id == sid) {
        if step.task_id != tid {
            return Err("INVALID_INPUT: 步骤不属于此任务。".into());
        }
        revision(v, "expectedStepRevision", step.revision)?;
        step.text = step_text;
        step.planned_seconds = seconds;
        if v.get("expectedResult").is_some() {
            step.expected_result = crate::paper::optional(v, "expectedResult", 1000)?;
        }
        step.revision += 1;
        step.updated_at = now;
        step.clone()
    } else {
        if v["expectedStepRevision"].as_u64().is_some() {
            return Err("NOT_FOUND: step".into());
        }
        let step = Step {
            id: sid.clone(),
            task_id: tid.clone(),
            text: step_text,
            expected_result: crate::paper::optional(v, "expectedResult", 1000)?,
            planned_seconds: seconds,
            completed: false,
            revision: 1,
            source: "user".into(),
            created_at: now,
            updated_at: now,
        };
        s.planning.steps.push(step.clone());
        step
    };
    let task = s.tasks.iter_mut().find(|x| x.id == tid).unwrap();
    if task.next_action.is_none() || task.next_action.as_ref().is_some_and(|x| x.id == sid) {
        task.next_action = Some(action(&step));
    }
    let task_out = task.clone();
    let item_out =
        if let Some(iid) = v["itemId"].as_str() {
            if let Some(d) = &date {
                if s.planning.day_items.iter().any(|x| {
                    x.id != iid && x.date == *d && x.step_id == sid && x.removed_at.is_none()
                }) {
                    return Err("CONFLICT: 这一步已在目标日期中。".into());
                }
            }
            let order = s
                .planning
                .day_items
                .iter()
                .filter(|x| Some(&x.date) == date.as_ref())
                .map(|x| x.order)
                .max()
                .unwrap_or(0)
                + 1;
            let item = s
                .planning
                .day_items
                .iter_mut()
                .find(|x| x.id == iid && x.step_id == sid)
                .ok_or("NOT_FOUND: 日计划")?;
            revision(v, "expectedItemRevision", item.revision)?;
            if let Some(d) = &date {
                if item.date != *d {
                    item.order = order;
                    item.resolved_at = None;
                    item.resolution = None;
                    item.continued_to = None;
                }
                item.date = d.clone();
            }
            item.removed_at = if date.is_none() { Some(now) } else { None };
            item.start_minute = start;
            item.duration_minutes = duration;
            item.revision += 1;
            Some(item.clone())
        } else if let Some(d) = date {
            if s.planning
                .day_items
                .iter()
                .any(|x| x.date == d && x.step_id == sid && x.removed_at.is_none())
            {
                return Err("CONFLICT: 这一步已在这一天，请打开现有安排。".into());
            }
            let order = s
                .planning
                .day_items
                .iter()
                .filter(|x| x.date == d)
                .map(|x| x.order)
                .max()
                .unwrap_or(0)
                + 1;
            let item = DayItem {
                id: uuid::Uuid::new_v4().to_string(),
                date: d,
                task_id: tid,
                step_id: sid,
                order,
                revision: 1,
                removed_at: None,
                start_minute: start,
                duration_minutes: duration,
                ..DayItem::default()
            };
            s.planning.day_items.push(item.clone());
            Some(item)
        } else {
            None
        };
    Ok(json!({"task":task_out,"step":step,"item":item_out}))
}

fn metadata(task: &mut Task, v: &Value) -> Result<(), String> {
    if let Some(priority) = v.get("priority") {
        let value = priority.as_str().ok_or("INVALID_INPUT: priority")?;
        if !["high", "medium", "low"].contains(&value) {
            return Err("INVALID_INPUT: priority".into());
        }
        task.priority = value.into();
    }
    if v.get("due").is_some() { task.due = crate::paper::optional(v, "due", 100)?; }
    if v.get("dueDate").is_some() { task.due_date = crate::paper::due_date(v)?; }
    Ok(())
}

// The complete inspected set is submitted; a changed/missing/new item rejects the whole operation.
fn resolve_items(s: &mut PaperState, op: &str, v: &Value, now: i64) -> Result<Value, String> {
    for key in v.as_object().ok_or("INVALID_INPUT: object")?.keys() {
        if !["requestId", "taskId", "stepId", "expectedTaskRevision", "expectedStepRevision", "items", "date", "scope"].contains(&key.as_str()) {
            return Err(format!("INVALID_INPUT: {key}"));
        }
    }
    let tid = uuid(v, "taskId")?;
    let sid = uuid(v, "stepId")?;
    let task = s.tasks.iter().find(|x| x.id == tid).ok_or("NOT_FOUND: task")?;
    let step = s.planning.steps.iter().find(|x| x.id == sid && x.task_id == tid).ok_or("NOT_FOUND: step")?;
    revision(v, "expectedTaskRevision", task.revision)?;
    revision(v, "expectedStepRevision", step.revision)?;
    if task.completed || step.completed { return Err("CONFLICT: 任务或步骤已完成，请核对最新状态。".into()); }
    let items = v["items"].as_array().filter(|x| !x.is_empty() && x.len() <= 366).ok_or("INVALID_INPUT: items")?;
    let mut ids = std::collections::BTreeSet::new();
    for input in items {
        if input.as_object().is_none_or(|o| o.keys().any(|k| k != "id" && k != "revision")) {
            return Err("INVALID_INPUT: item version".into());
        }
        let iid = uuid(input, "id")?;
        if !ids.insert(iid.clone()) { return Err("INVALID_INPUT: duplicate item".into()); }
        let item = s.planning.day_items.iter().find(|x| x.id == iid && x.task_id == tid && x.step_id == sid && x.removed_at.is_none()).ok_or("CONFLICT: 安排已变化。")?;
        revision(input, "revision", item.revision)?;
    }
    if op == "cancel_plan_items" {
        match v["scope"].as_str() {
            Some("selected") => {},
            Some("unexecuted") => {
                let current: std::collections::BTreeSet<_> = s.planning.day_items.iter()
                    .filter(|x| x.task_id == tid && x.step_id == sid && x.removed_at.is_none()
                        && !s.planning.session_links.iter().any(|link| link.day_item_id == x.id))
                    .map(|x| x.id.clone()).collect();
                if current != ids { return Err("CONFLICT: 未执行安排已变化，请重新核对取消范围。".into()); }
            },
            _ => return Err("INVALID_INPUT: scope".into()),
        }
        for item in s.planning.day_items.iter_mut().filter(|x| ids.contains(&x.id)) {
            item.removed_at = Some(now);
            item.resolved_at = Some(now);
            item.resolution = Some("cancelled".into());
            item.revision += 1;
        }
        let remaining = s.planning.day_items.iter().filter(|x| x.task_id == tid && x.step_id == sid && x.removed_at.is_none()).count();
        return Ok(json!({"cancelledItemIds":ids,"remainingActiveCount":remaining}));
    }
    let date = day(v)?.ok_or("INVALID_INPUT: target date")?;
    if s.planning.day_items.iter().any(|x| ids.contains(&x.id) && (x.date >= date || x.resolved_at.is_some())) {
        return Err("CONFLICT: 只能继续目标日之前尚未处理的安排。".into());
    }
    let target = if let Some(item) = s.planning.day_items.iter().find(|x| x.task_id == tid && x.step_id == sid && x.date == date && x.removed_at.is_none()) {
        item.clone()
    } else {
        let item = DayItem {
            id: uuid::Uuid::new_v4().to_string(), date: date.clone(), task_id: tid, step_id: sid,
            order: s.planning.day_items.iter().filter(|x| x.date == date).map(|x| x.order).max().unwrap_or(0) + 1,
            revision: 1, ..DayItem::default()
        };
        s.planning.day_items.push(item.clone());
        item
    };
    for item in s.planning.day_items.iter_mut().filter(|x| ids.contains(&x.id)) {
        item.resolved_at = Some(now);
        item.resolution = Some("continued".into());
        item.continued_to = Some(target.id.clone());
        item.revision += 1;
    }
    Ok(json!({"item":target,"continuedItemIds":ids}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paper;
    fn edit() -> Value {
        json!({"requestId":uuid::Uuid::new_v4().to_string(),"taskId":uuid::Uuid::new_v4().to_string(),"stepId":uuid::Uuid::new_v4().to_string(),"title":"设计工作台","text":"画三列布局","category":"work","plannedSeconds":900,"date":"2026-09-15","startMinute":600,"durationMinutes":30})
    }
    #[test]
    fn transactions_retry_conflict_and_immutable_session() {
        let mut c = paper::open(std::path::Path::new(":memory:")).unwrap();
        let v = edit();
        let (out, _) = paper::execute(&mut c, "workbench_save_step", v.clone(), "user").unwrap();
        let (retry, changed) =
            paper::execute(&mut c, "workbench_save_step", v.clone(), "user").unwrap();
        assert!(!changed);
        assert_eq!(out["item"], retry["item"]);
        assert!(
            paper::execute(&mut c, "workbench_save_step", edit(), "hermes")
                .unwrap_err()
                .contains("FORBIDDEN")
        );
        let (session,_)=paper::execute(&mut c,"start_session",json!({"requestId":uuid::Uuid::new_v4().to_string(),"taskId":v["taskId"],"expectedRevision":1,"kind":"focus","plannedSeconds":900}),"user").unwrap();
        let before = paper::load(&c).unwrap().sessions;
        assert!(!session["session"].is_null());
        let mut update = v.clone();
        update["requestId"] = json!(uuid::Uuid::new_v4().to_string());
        update["expectedTaskRevision"] = json!(1);
        update["expectedStepRevision"] = json!(1);
        update["itemId"] = out["item"]["id"].clone();
        update["expectedItemRevision"] = json!(1);
        update["date"] = json!("2026-09-16");
        update["text"] = json!("画新的布局");
        paper::execute(&mut c, "workbench_save_step", update.clone(), "user").unwrap();
        assert_eq!(
            serde_json::to_value(before).unwrap(),
            serde_json::to_value(paper::load(&c).unwrap().sessions).unwrap()
        );
        update["requestId"] = json!(uuid::Uuid::new_v4().to_string());
        assert!(
            paper::execute(&mut c, "workbench_save_step", update, "user")
                .unwrap_err()
                .contains("CONFLICT")
        );
    }
    #[test]
    fn invalid_schedule_rolls_back_and_legacy_fields_default() {
        let mut c = paper::open(std::path::Path::new(":memory:")).unwrap();
        let mut v = edit();
        v["startMinute"] = json!(1435);
        assert!(paper::execute(&mut c, "workbench_save_step", v, "user").is_err());
        assert!(paper::load(&c).unwrap().tasks.is_empty());
        let legacy = json!({"id":"a","date":"2026-09-15","taskId":"t","stepId":"s","order":0,"revision":1,"removedAt":null});
        let item: DayItem = serde_json::from_value(legacy).unwrap();
        assert_eq!(item.start_minute, None);
    }
}
